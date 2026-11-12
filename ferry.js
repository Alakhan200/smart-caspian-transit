const railFields = document.createElement("div");

railFields.className = "fields";

railFields.innerHTML = `
  <label for="rail-delay">
    Задержка прибытия поезда, ч
    <input
      id="rail-delay"
      type="number"
      min="0"
      max="168"
      step="0.1"
      value="0"
      required
    >
  </label>
`;

document.querySelector("#calculate-button").before(railFields);

const ferrySection = document.createElement("section");

ferrySection.className = "card";
ferrySection.style.marginTop = "24px";

ferrySection.innerHTML = `
  <h2>Стыковка с паромом</h2>

  <p
    id="ferry-status"
    role="status"
    aria-live="polite"
  >
    Ожидаем расчёт…
  </p>

  <ul id="ferry-details"></ul>

  <small>
    Деморасписание: рейс раз в 24 часа,
    приём груза закрывается за 2 часа.
    Готовность груза к погрузке учитывает только задержку поезда.
    Погода и загрузка порта добавляют отдельную задержку
    после выбора рейса. Отмены рейсов не моделируются.
  </small>
`;

document.querySelector("main").append(ferrySection);

const ferryStatus = document.querySelector("#ferry-status");
const ferryDetails = document.querySelector("#ferry-details");

function ferryDate(value) {
  return new Date(value).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow"
  }) + " МСК";
}

document.addEventListener("shipment-loaded", event => {
  const transfer = event.detail.transfer;

  ferryDetails.replaceChildren();

  if (!transfer) {
    ferryStatus.textContent =
      "Расчёт стыковки ещё не подключён к API.";
    return;
  }

  const missed = transfer.status === "missed";

  ferryStatus.textContent = missed
    ? "Груз не успевает на плановый рейс. " +
      `Пропущено отправлений: ${transfer.missedDepartures}. ` +
      `Дополнительная задержка: ${transfer.additionalDelayHours} ч.`
    : "Груз успевает на плановый рейс. " +
      "Дополнительной задержки из-за стыковки нет.";

  ferryStatus.style.color = missed
    ? "#fde68a"
    : "#a7f3d0";

  const rows = [
    ["Плановая готовность груза", transfer.plannedReadyAt],
    [
      "Готовность с учётом задержки поезда",
      transfer.actualReadyAt
    ],
    [
      "Закрытие приёма на плановый рейс",
      transfer.loadingCutoffAt
    ],
    ["Плановое отправление", transfer.plannedDepartureAt],
    [
      "Доступное отправление по расписанию",
      transfer.nextDepartureAt
    ]
  ];

  for (const [label, value] of rows) {
    const item = document.createElement("li");

    item.textContent = `${label}: ${ferryDate(value)}`;

    ferryDetails.append(item);
  }
});

document.addEventListener("shipment-loading", () => {
  ferryStatus.textContent = "Проверяем стыковку…";
  ferryStatus.style.color = "";
  ferryDetails.replaceChildren();
});

document.addEventListener("shipment-load-error", () => {
  ferryStatus.textContent =
    "Не удалось проверить стыковку. Повтори расчёт.";

  ferryDetails.replaceChildren();
});