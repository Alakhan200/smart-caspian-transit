(() => {
  const host = document.querySelector("#customs-form")
    .closest("section");

  // Новый процесс занимает вкладку «Документы».
  // Старую проверку и её API сохраняем для совместимости.
  [...host.children].forEach(child => {
    child.hidden = true;
  });

  const panel = document.createElement("div");

  panel.innerHTML = `
    <h2>Предварительное оформление</h2>

    <p class="muted">
      Локальный имитатор таможни.
      Документы представлены сведениями и отметками
      о включении в демокомплект. Файлы не загружаются.
    </p>

    <label>
      API-ключ с сервера
      <input
        id="clearance-key"
        type="password"
        autocomplete="off"
        placeholder="Вставь ключ из своего терминала"
      >
    </label>

    <form id="clearance-form">
      <div class="fields">
        <label>
          Отправитель
          <input name="sender" maxlength="200" required>
        </label>

        <label>
          Получатель
          <input name="consignee" maxlength="200" required>
        </label>

        <label>
          Номер инвойса
          <input name="invoiceNumber" maxlength="100">
        </label>

        <label>
          Номер упаковочного листа
          <input name="packingListNumber" maxlength="100">
        </label>

        <label>
          Вес нетто в инвойсе, т
          <input
            name="invoiceWeightTonnes"
            type="number"
            min="0.001"
            max="100000"
            step="0.001"
            value="12"
            required
          >
        </label>

        <label>
          Вес нетто в упаковочном листе, т
          <input
            name="packingWeightTonnes"
            type="number"
            min="0.001"
            max="100000"
            step="0.001"
            value="12"
            required
          >
        </label>
      </div>

      <label class="clearance-checkbox">
        <input name="invoiceIncluded" type="checkbox">
        Инвойс включён в демокомплект
      </label>

      <label class="clearance-checkbox">
        <input name="packingListIncluded" type="checkbox">
        Упаковочный лист включён в демокомплект
      </label>

      <div class="clearance-actions">
        <button id="clearance-save" type="submit">
          Сохранить заявку
        </button>
      </div>
    </form>

    <div class="clearance-actions">
      <button id="clearance-validate" type="button" disabled>
        1. Проверить
      </button>

      <button id="clearance-submit" type="button" disabled>
        2. Отправить в имитатор
      </button>

      <button id="clearance-process" type="button" disabled>
        3. Получить решение
      </button>

      <button id="clearance-new" type="button">
        Новая заявка
      </button>
    </div>

    <p
      id="clearance-message"
      role="status"
      aria-live="polite"
    >
      Создай заявку или открой сохранённую.
    </p>

    <p id="clearance-state"></p>
    <ul id="clearance-checks"></ul>

    <h3>События заявки</h3>
    <ol id="clearance-events"></ol>

    <div class="clearance-actions">
      <button id="clearance-refresh" type="button">
        Загрузить сохранённые заявки
      </button>
    </div>

    <ul id="clearance-saved"></ul>

    <small>
      Статус «Согласовано в имитаторе» не является таможенным
      разрешением. Ключ не сохраняется в браузерное хранилище.
      В демоверсии используется один общий ключ, без ролей пользователей.
    </small>
  `;

  host.append(panel);

  const $ = selector => panel.querySelector(selector);
  const form = $("#clearance-form");
  const message = $("#clearance-message");

  const states = {
    draft: "Черновик",
    needs_correction: "Нужны исправления",
    ready: "Готово к отправке",
    submitted_demo: "Передано имитатору",
    preapproved_demo: "Согласовано в имитаторе"
  };

  const api =
    "http://127.0.0.1:8000/api/clearance/applications";

  let current = null;
  let dirty = false;
  let busy = false;

  function syncButtons() {
    const status = current?.status;

    const locked = [
      "submitted_demo",
      "preapproved_demo"
    ].includes(status);

    form.querySelectorAll("input").forEach(input => {
      input.disabled = busy || locked;
    });

    $("#clearance-save").disabled = busy || locked;
    $("#clearance-new").disabled = busy;
    $("#clearance-refresh").disabled = busy;

    $("#clearance-validate").disabled =
      busy ||
      dirty ||
      !["draft", "needs_correction", "ready"].includes(status);

    $("#clearance-submit").disabled =
      busy || dirty || status !== "ready";

    $("#clearance-process").disabled =
      busy || status !== "submitted_demo";

    $("#clearance-saved").querySelectorAll("button")
      .forEach(button => {
        button.disabled = busy;
      });
  }

  async function request(url, method = "GET", body) {
    const key = $("#clearance-key").value.trim();

    if (!key) {
      throw new Error("Введи API-ключ.");
    }

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : "Проверь обязательные поля и положительный вес."
      );
    }

    return data;
  }

  function formatTime(value) {
    return new Date(value).toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow"
    }) + " МСК";
  }

  function render(data) {
    current = data;
    dirty = false;

    for (const [name, value] of Object.entries(data.data)) {
      const field = form.elements.namedItem(name);

      if (field.type === "checkbox") {
        field.checked = value;
      } else {
        field.value = value;
      }
    }

    $("#clearance-state").textContent =
      `Заявка ${data.id.slice(0, 12).toUpperCase()} · ` +
      states[data.status] +
      (data.reference ? ` · ${data.reference}` : "");

    const checks = $("#clearance-checks");
    checks.replaceChildren();

    data.checks.forEach(check => {
      const item = document.createElement("li");

      item.textContent =
        `${check.passed ? "✓" : "✕"} ${check.title}`;

      checks.append(item);
    });

    const events = $("#clearance-events");
    events.replaceChildren();

    data.events.forEach(event => {
      const item = document.createElement("li");

      item.textContent =
        `${formatTime(event.occurred_at)} — ${event.message}`;

      events.append(item);
    });
  }

  async function run(task) {
    if (busy) return;

    busy = true;
    syncButtons();
    message.textContent = "Выполняем запрос…";

    try {
      await task();

      message.textContent =
        "Сохранено. Настоящая таможня не подключена.";
    } catch (error) {
      const connectionError =
        error.name === "TimeoutError" ||
        error instanceof TypeError;

      message.textContent = connectionError
        ? "Нет ответа от API. Проверь сервер и обнови " +
          "сохранённые заявки перед повторной отправкой."
        : error.message;
    } finally {
      busy = false;
      syncButtons();
    }
  }

  async function loadSaved() {
    const data = await request(api);
    const list = $("#clearance-saved");

    list.replaceChildren();

    if (!data.items.length) {
      list.textContent = "Сохранённых заявок пока нет.";
      return;
    }

    data.items.forEach(item => {
      const row = document.createElement("li");
      const button = document.createElement("button");

      button.type = "button";

      button.textContent =
        `${item.id.slice(0, 12).toUpperCase()} · ` +
        `${states[item.status]} · ` +
        formatTime(item.updated_at);

      button.addEventListener("click", () => {
        if (dirty) {
          message.textContent =
            "Сначала сохрани изменения или нажми " +
            "«Новая заявка», чтобы их сбросить.";
          return;
        }

        run(async () => {
          render(await request(api + "/" + item.id));
        });
      });

      row.append(button);
      list.append(row);
    });
  }

  form.addEventListener("input", () => {
    dirty = true;

    message.textContent =
      "Сведения изменены. Сохрани заявку " +
      "и выполни проверку заново.";

    $("#clearance-checks").replaceChildren();
    syncButtons();
  });

  form.addEventListener("submit", event => {
    event.preventDefault();

    const data = Object.fromEntries(new FormData(form));

    data.invoiceIncluded =
      form.elements.invoiceIncluded.checked;

    data.packingListIncluded =
      form.elements.packingListIncluded.checked;

    data.invoiceWeightTonnes =
      Number(data.invoiceWeightTonnes);

    data.packingWeightTonnes =
      Number(data.packingWeightTonnes);

    run(async () => {
      render(await request(
        current ? api + "/" + current.id : api,
        current ? "PUT" : "POST",
        data
      ));

      await loadSaved();
    });
  });

  for (const action of ["validate", "submit", "process"]) {
    $("#clearance-" + action).addEventListener("click", () => {
      run(async () => {
        render(await request(
          api + "/" + current.id + "/" + action,
          "POST"
        ));

        await loadSaved();
      });
    });
  }

  $("#clearance-refresh").addEventListener("click", () => {
    run(loadSaved);
  });

  $("#clearance-new").addEventListener("click", () => {
    current = null;
    dirty = false;
    form.reset();

    [
      "#clearance-state",
      "#clearance-checks",
      "#clearance-events"
    ].forEach(selector => {
      $(selector).replaceChildren();
    });

    message.textContent =
      "Новая заявка. Заполни сведения и сохрани.";

    syncButtons();
  });

  syncButtons();
})();