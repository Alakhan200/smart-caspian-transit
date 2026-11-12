(() => {
  const main = document.querySelector("main");
  const conditions = document.querySelector("#conditions-form");
  const shipment = document.querySelector("#shipment");

  const mapCard = document.querySelector("#map").closest("section");

  function findSection(selector) {
    return document.querySelector(selector)?.closest("section");
  }

  const sections = {
    overview: mapCard,
    documents: findSection("#customs-form"),
    emissions: findSection("#emissions-details"),
    ferry: findSection("#ferry-details"),
    history: findSection("#history-list")
  };

  const shell = document.createElement("div");
  shell.className = "workspace";

  shell.innerHTML = `
    <header class="appbar">
      <a
        class="brand"
        href="#overview"
        aria-label="Caspian Transit — обзор"
      >
        <span class="brand-mark">ct</span>
        <span>caspian<span class="brand-light">transit</span></span>
      </a>

      <span class="appbar-caption">
        Операционный центр / Север–Юг
      </span>

      <span class="demo-label">Демосценарий</span>
    </header>

    <aside class="cargo-sidebar">
      <p class="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p>

      <h2>Перевозки <span class="count">1</span></h2>

      <div class="selected-cargo">
        <div class="cargo-row">
          <strong>SCT-001</strong>
          <span class="cargo-tag">В порту</span>
        </div>

        <p>Комплектующие</p>
        <span class="muted">12 т · ж/д + море</span>

        <div class="mini-route">
          <span>Москва</span>

          <span class="current-stop">
            Астрахань
            <small>Текущее положение</small>
          </span>

          <span>Энзели</span>
        </div>
      </div>

      <div class="sidebar-note">
        <span class="eyebrow">КАСПИЙСКОЕ ЗВЕНО</span>

        <p>
          Астрахань → Энзели<br>
          Ж/д + морской транспорт.
        </p>

        <small>
          Положение и условия заданы для демонстрации.
        </small>
      </div>
    </aside>

    <div class="workspace-body">
      <div class="page-heading">
        <div>
          <p class="eyebrow">МУЛЬТИМОДАЛЬНАЯ ПЕРЕВОЗКА</p>
          <h1>Москва <span>→</span> Энзели</h1>
        </div>

        <button
          id="open-simulation"
          type="button"
          aria-haspopup="dialog"
        >
          Условия сценария
          <span aria-hidden="true">+</span>
        </button>
      </div>

      <nav class="view-nav" aria-label="Разделы перевозки">
        <button
          type="button"
          data-view="overview"
          aria-current="page"
        >
          Обзор
        </button>

        <button type="button" data-view="documents">
          Документы
        </button>

        <button type="button" data-view="ferry">
          Стыковка
        </button>

        <button type="button" data-view="emissions">
          Выбросы CO₂
        </button>

        <button type="button" data-view="history">
          История
        </button>
      </nav>

      <div class="work-grid">
        <div class="view-content"></div>

        <aside
          class="shipment-panel"
          aria-label="Состояние груза"
        ></aside>
      </div>

      <footer class="workspace-footer">
        <span>Smart Caspian Transit</span>
        <span>Расчётный прототип · время МСК</span>
      </footer>
    </div>
  `;

  const content = shell.querySelector(".view-content");

  // Переносим существующие блоки, сохраняя их обработчики.
  Object.entries(sections).forEach(([key, section]) => {
    if (!section) return;

    section.classList.add("view-panel");
    section.dataset.view = key;
    section.hidden = key !== "overview";

    content.append(section);
  });

  shell.querySelector(".shipment-panel").append(
    document.querySelector("#loading"),
    shipment
  );

  // Демонстрационный комплект файлов переносим к документам.
  const files = shipment.querySelector("#documents");

  if (files && sections.documents) {
    const block = document.createElement("div");
    block.className = "files-summary";

    const heading = files.previousElementSibling;

    if (heading?.tagName === "H3") {
      heading.textContent = "Файлы · демонстрационный комплект";
      block.append(heading);
    }

    const note = files.nextElementSibling;

    block.append(files);

    if (note?.tagName === "P") {
      block.append(note);
    }

    sections.documents.append(block);
  }

  main.querySelector(":scope > header")?.remove();

  const dialog = document.createElement("dialog");
  dialog.className = "simulation-dialog";

  dialog.setAttribute(
    "aria-labelledby",
    "simulation-title"
  );

  dialog.innerHTML = `
    <div class="dialog-top">
      <span id="simulation-title">Условия сценария</span>

      <button
        type="button"
        id="close-simulation"
        aria-label="Закрыть условия"
      >
        Закрыть ×
      </button>
    </div>
  `;

  dialog.append(conditions);
  main.replaceChildren(shell, dialog);

  const opener = document.querySelector("#open-simulation");

  opener.addEventListener("click", () => {
    dialog.showModal();
  });

  document.querySelector("#close-simulation")
    .addEventListener("click", () => {
      dialog.close();
    });

  dialog.addEventListener("click", event => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  conditions.addEventListener("submit", () => {
    dialog.close();
  });

  function switchView(key) {
    if (!sections[key]) return;

    Object.entries(sections).forEach(([name, section]) => {
      if (section) {
        section.hidden = name !== key;
      }
    });

    shell.querySelectorAll(".view-nav button")
      .forEach(button => {
        if (button.dataset.view === key) {
          button.setAttribute("aria-current", "page");
        } else {
          button.removeAttribute("aria-current");
        }
      });

    // Leaflet пересчитывает размеры после смены компоновки.
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }

  shell.querySelectorAll(".view-nav button")
    .forEach(button => {
      button.addEventListener("click", () => {
        switchView(button.dataset.view);
      });
    });

  shell.querySelector(".brand")
    .addEventListener("click", event => {
      event.preventDefault();
      switchView("overview");
    });

  function updateCargoTag(delay, risk) {
    const tag = shell.querySelector(".cargo-tag");

    tag.textContent = delay
      ? `+${delay} ч к плану`
      : "По плану";

    tag.dataset.risk = risk;
  }

  document.addEventListener("shipment-loaded", event => {
    updateCargoTag(
      event.detail.prediction.delayHours,
      event.detail.prediction.riskLevel
    );
  });

  // Если API успел ответить до подключения этого файла.
  if (!shipment.hidden) {
    const text = shipment.querySelector("#prediction").textContent;
    const match = text.match(/задержка:\s*(\d+(?:[.,]\d+)?)/i);

    if (match) {
      updateCargoTag(
        Number(match[1].replace(",", ".")),
        shipment.querySelector("#prediction").dataset.risk
      );
    }
  }

  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
  });
})();

document.querySelector(".map-card > .muted").textContent =
  "Серый — ж/д участок · светло-зелёный — море · " +
  "песочный пунктир — альтернативный маршрут";