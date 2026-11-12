(() => {
  const host = document.querySelector("#history-list")
    .closest("section");

  const panel = document.createElement("section");
  panel.className = "twin-panel";

  panel.innerHTML = `
    <h2>События перевозки</h2>

    <p class="muted">
      Виртуальные часы. События следуют расписанию сценария,
      а не скорости нажатия кнопок. GPS не подключён.
    </p>

    <p id="twin-clock"></p>

    <p
      id="twin-state"
      role="status"
      aria-live="polite"
    >
      Загружаем состояние…
    </p>

    <div class="clearance-actions">
      <button id="twin-next" type="button" disabled>
        Следующее событие
      </button>

      <button id="twin-refresh" type="button">
        Обновить состояние
      </button>

      <button id="twin-reset" type="button" disabled>
        Начать сценарий заново
      </button>
    </div>

    <p class="muted">
      Ключ для записи — на вкладке «Документы».
      Параметры фиксируются при начале погрузки.
      Изменить их можно после перезапуска сценария.
    </p>

    <div
  class="clearance-actions"
  role="group"
  aria-label="Фильтр событий"
>
  <button
    id="journal-current"
    type="button"
    aria-pressed="true"
  >
    Текущий сценарий
  </button>

  <button
    id="journal-all"
    type="button"
    aria-pressed="false"
  >
    Вся история
  </button>
</div>

<p
  id="journal-status"
  class="muted"
  role="status"
  aria-live="polite"
></p>

<ol id="twin-events"></ol>

<button id="journal-more" type="button" hidden>
  Показать ещё
</button>
  `;

  host.prepend(panel);

  const $ = selector => panel.querySelector(selector);

  const base =
    "http://127.0.0.1:8000/api/shipments/SCT-001";

  const fields = {
    rail_delay: "#rail-delay",
    wind_speed: "#wind-speed",
    port_load: "#port-load",
    alternative_wind_speed: "#alternative-wind-speed",
    alternative_port_load: "#alternative-port-load"
  };

  let state = null;
  let busy = false;

  function formatTime(value) {
    if (!value) return "не задано";

    return new Date(value).toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow"
    }) + " МСК";
  }

  function readInputs() {
    return Object.fromEntries(
      Object.entries(fields).map(([key, selector]) => [
        key,
        Number(document.querySelector(selector).value)
      ])
    );
  }

  function syncButtons() {
    $("#twin-next").disabled =
      busy || !state?.nextAction || state.needsReset;

    $("#twin-reset").disabled = busy || !state;
    $("#twin-refresh").disabled = busy;

    $("#twin-next").textContent =
      state?.nextAction || "Перевозка завершена";

    document.querySelectorAll("#conditions-form input")
      .forEach(input => {
        input.disabled = (state?.stage ?? 0) > 0;
      });
  }

  function projectState() {
    if (!state) return;

    document.querySelector("#cargo-info").textContent =
      `12 т · ${state.location}`;

    const tag = document.querySelector(".cargo-tag");

    if (tag) {
      tag.textContent = [
        "В порту",
        "Погрузка",
        "В море",
        "Прибыл"
      ][state.stage];

      tag.dataset.risk = state.stage === 3
        ? "low"
        : state.plan?.prediction.riskLevel || "unknown";
    }

    const route = document.querySelector(".mini-route");

    if (route) {
      route.replaceChildren();

      const places = state.stage === 2
        ? ["Москва", "Астрахань", "Каспийское море", "Энзели"]
        : ["Москва", "Астрахань", "Энзели"];

      places.forEach((place, index) => {
        const span = document.createElement("span");
        span.textContent = place;

        if (index === (state.stage < 2 ? 1 : 2)) {
          span.className = "current-stop";
        }

        route.append(span);
      });
    }

    const alternative = document.querySelector("#alternative");

    const alternativeButton =
      document.querySelector("#alternative-button");

    alternativeButton.disabled = state.stage > 0;

    if (state.stage > 0) {
      alternative.hidden = true;

      alternativeButton.textContent =
        "Смена порта недоступна на этом этапе";

      alternativeButton.setAttribute(
        "aria-expanded",
        "false"
      );
    } else {
      alternativeButton.textContent = alternative.hidden
        ? "Показать альтернативу"
        : "Скрыть альтернативу";
    }

    const arrival = document.querySelector("#arrival");
    const label = arrival.previousElementSibling;

    if (label) {
      label.textContent = state.stage === 3
        ? "Прибытие · модельное время"
        : "Прибытие · расчёт сценария";
    }

    if (state.stage > 0 && state.plan) {
      for (const [name, value] of Object.entries(
        state.plan.inputs
      )) {
        document.querySelector(fields[name]).value = value;
      }

      const arrived = state.stage === 3;
      const badge = document.querySelector("#risk-badge");

      badge.textContent = [
        "",
        "Погрузка · симуляция",
        "В море · симуляция",
        "Прибыл · симуляция"
      ][state.stage];

      badge.dataset.risk = arrived
        ? "low"
        : state.plan.prediction.riskLevel;

      arrival.textContent = formatTime(
        arrived
          ? state.modelTime
          : state.plan.estimatedArrival
      );

      const prediction = document.querySelector("#prediction");

      prediction.textContent =
        `${arrived ? "Итог сценария" : "Расчёт сценария"}: ` +
        `+${state.plan.prediction.delayHours} ч к плану. ` +
        `${state.plan.prediction.reason}. ` +
        "Параметры зафиксированы; это не онлайн-прогноз.";

      prediction.dataset.risk = arrived
        ? "low"
        : state.plan.prediction.riskLevel;
    }

    if (state.needsReset) {
      arrival.textContent = "Начни сценарий заново";

      document.querySelector("#prediction").textContent =
        "У старого сценария нет виртуальной шкалы времени. " +
        "Записи сохранены в журнале.";
    }

    syncButtons();

    document.dispatchEvent(
      new CustomEvent("twin-updated", {
        detail: state
      })
    );
  }

  let journalScope = "current";
let journalCursor = null;
let journalGeneration = 0;
let journalBusy = false;

async function loadJournal(reset = true) {
  if (!reset && journalBusy) return;

  const generation = reset
    ? ++journalGeneration
    : journalGeneration;

  const list = $("#twin-events");
  const more = $("#journal-more");

  if (reset) {
    list.replaceChildren();
    journalCursor = null;
    more.hidden = true;
  }

  journalBusy = true;
  more.disabled = true;

  $("#journal-current").setAttribute(
    "aria-pressed",
    String(journalScope === "current")
  );

  $("#journal-all").setAttribute(
    "aria-pressed",
    String(journalScope === "all")
  );

  $("#journal-status").textContent = "Загружаем события…";

  try {
    const url = new URL(base + "/twin/history");
    url.searchParams.set("scope", journalScope);

    if (journalCursor !== null) {
      url.searchParams.set("before", journalCursor);
    }

    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error("Не удалось загрузить журнал");
    }

    const data = await response.json();

    // Запоздавший ответ предыдущего фильтра пропускаем.
    if (generation !== journalGeneration) return;

    for (const event of data.items) {
      const item = document.createElement("li");

      item.textContent = event.model_time
        ? `${formatTime(event.model_time)} — ${event.message}. ` +
          `Записано: ${formatTime(event.occurred_at)}`
        : `${event.message} · старая запись без модельного времени. ` +
          `Записано: ${formatTime(event.occurred_at)}`;

      if (journalScope === "all" && event.scenario_id) {
        item.textContent +=
          ` · сценарий ${event.scenario_id.slice(0, 6)}`;
      }

      list.append(item);
    }

    journalCursor = data.nextBefore;
    more.hidden = !data.hasMore;

    const count = list.children.length;

    $("#journal-status").textContent = count
      ? `${journalScope === "current"
          ? "Текущий сценарий"
          : "Вся история"} · показано событий: ${count}` +
        (data.hasMore ? ", есть более ранние" : "")
      : journalScope === "current"
        ? "В текущем сценарии пока нет событий. " +
          "Предыдущие записи доступны во «Всей истории»."
        : "История пока пуста.";
  } catch (error) {
    if (generation === journalGeneration) {
      $("#journal-status").textContent =
        "Не удалось загрузить события. " +
        "Нажми нужный фильтр, чтобы повторить.";
    }
  } finally {
    if (generation === journalGeneration) {
      journalBusy = false;
      more.disabled = false;
    }
  }
}

  function render(data) {
  state = data;

  $("#twin-clock").textContent =
    `Модельное время: ${formatTime(data.modelTime)}`;

  $("#twin-state").textContent = data.needsReset
    ? "Старый сценарий: нажми «Начать сценарий заново»."
    : `${data.title} · ${data.location} · версия ${data.version}`;

  loadJournal();
  projectState();
}

  async function refresh() {
    const url = new URL(base);

    for (const [key, value] of Object.entries(readInputs())) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error("Не удалось загрузить состояние");
    }

    render((await response.json()).twin);
  }

  async function run(action) {
    if (busy) return;

    busy = true;
    syncButtons();

    try {
      if (action) {
        const key = document.querySelector("#clearance-key")
          ?.value.trim();

        if (!key) {
          throw new Error(
            "Введи API-ключ на вкладке «Документы»."
          );
        }

        const values = readInputs();

        const response = await fetch(base + "/twin/events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + key
          },
          body: JSON.stringify({
            action,
            expectedVersion: state.version,
            rail_delay: values.rail_delay,
            wind_speed: values.wind_speed,
            port_load: values.port_load
          }),
          signal: AbortSignal.timeout(10000)
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            typeof data.detail === "string"
              ? data.detail
              : "Ошибка записи события"
          );
        }

        render(data);

        document.querySelector("#conditions-form")
          .requestSubmit();
      } else {
        await refresh();
      }
    } catch (error) {
      const connectionError =
        error instanceof TypeError ||
        error.name === "TimeoutError";

      $("#twin-state").textContent = connectionError
        ? "Нет ответа. Обнови состояние перед повторной записью."
        : error.message;
    } finally {
      busy = false;
      syncButtons();
    }
  }

  document.addEventListener("shipment-loaded", event => {
    if (event.detail.twin) {
      render(event.detail.twin);
    }
  });

  $("#twin-next").addEventListener("click", () => {
    run("next");
  });

  $("#twin-reset").addEventListener("click", () => {
    run("reset");
  });

  $("#twin-refresh").addEventListener("click", () => {
    run();
  });

  $("#journal-current").addEventListener("click", () => {
    journalScope = "current";
    loadJournal();
  });

  $("#journal-all").addEventListener("click", () => {
    journalScope = "all";
    loadJournal();
  });

  $("#journal-more").addEventListener("click", () => {
    loadJournal(false);
  });

  run();
})();