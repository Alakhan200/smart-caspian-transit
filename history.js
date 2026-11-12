const historySection = document.createElement("section");

historySection.className = "card";
historySection.style.marginTop = "24px";

historySection.innerHTML = `
  <h2>История проверок</h2>

  <p class="muted">
    Последние 20 проверок груза SCT-001.
    Результаты сохраняются на сервере.
  </p>

  <button id="history-refresh" type="button">
    Обновить историю
  </button>

  <p
    id="history-status"
    role="status"
    aria-live="polite"
  ></p>

  <ol id="history-list"></ol>
`;

document.querySelector("main").append(historySection);

const historyButton = document.querySelector("#history-refresh");
const historyStatus = document.querySelector("#history-status");
const historyList = document.querySelector("#history-list");

let historyBusy = false;
let historyReloadPending = false;

function historyDate(value) {
  return new Date(value).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Moscow"
  }) + " МСК";
}

async function refreshHistory() {
  if (historyBusy) {
    historyReloadPending = true;
    return;
  }

  historyBusy = true;
  historyButton.disabled = true;
  historyStatus.textContent = "Загружаем историю…";
  historyList.replaceChildren();

  try {
    const response = await fetch(
      "http://127.0.0.1:8000/api/customs/SCT-001/history",
      {
        cache: "no-store",
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!response.ok) {
      throw new Error(`Ошибка API: ${response.status}`);
    }

    const data = await response.json();

    for (const record of data.items) {
      const item = document.createElement("li");
      item.style.marginBottom = "16px";

      const passed =
        record.status === "ready_for_demo_submission";

      const title = document.createElement("strong");

      title.textContent =
        `Проверка №${record.id} — ` +
        (passed ? "сведения согласованы" : "найдены расхождения");

      title.style.color = passed
        ? "#a7f3d0"
        : "#fde68a";

      const date = document.createElement("p");
      date.className = "muted";
      date.textContent = historyDate(record.created_at);

      const details = document.createElement("p");

      details.textContent =
        `Инвойс ${record.invoice_number}: ` +
        `${record.invoice_weight} т. ` +
        `Упаковочный лист ${record.packing_number}: ` +
        `${record.packing_weight} т. ` +
        `Вес груза при проверке: ${record.cargo_weight} т.`;

      item.append(title, date, details);
      historyList.append(item);
    }

    historyStatus.textContent = data.items.length
      ? `Показано проверок: ${data.items.length}. В таможню не отправлено.`
      : "Проверок пока нет. Заполни форму выше.";
  } catch (error) {
    historyStatus.textContent =
      "Не удалось загрузить историю. Проверь сервер " +
      "и нажми «Обновить историю».";

    console.error(error);
  } finally {
    historyButton.disabled = false;
    historyBusy = false;

    if (historyReloadPending) {
      historyReloadPending = false;
      refreshHistory();
    }
  }
}

historyButton.addEventListener("click", refreshHistory);

document.addEventListener(
  "customs-check-saved",
  refreshHistory
);

refreshHistory();