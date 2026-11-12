const API_URL = "http://127.0.0.1:8000/api/shipments/SCT-001";

const form = document.querySelector("#conditions-form");
const calculateButton = document.querySelector("#calculate-button");
const alternativeButton = document.querySelector("#alternative-button");
const alternativeBlock = document.querySelector("#alternative");
const loading = document.querySelector("#loading");
const shipmentSection = document.querySelector("#shipment");

function formatDate(value) {
  return new Date(value).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow"
  }) + " МСК";
}

function renderShipment(shipment) {
  document.querySelector("#cargo-title").textContent =
    `${shipment.id} · ${shipment.cargo}`;

  document.querySelector("#cargo-info").textContent =
    `${shipment.weightTonnes} т · ${shipment.currentLocation}`;

  const transportNames = {
    rail: "ж/д",
    sea: "море",
    road: "авто"
  };

  document.querySelector("#route").textContent = [
    shipment.route[0].from,
    ...shipment.route.map(step => {
      const transport = transportNames[step.transport] || step.transport;
      return ` → (${transport}) → ${step.to}`;
    })
  ].join("");

  document.querySelector("#scheduled-arrival").textContent =
    formatDate(shipment.scheduledArrival);

  document.querySelector("#arrival").textContent =
    formatDate(shipment.estimatedArrival);

  document.querySelector("#co2").textContent =
    `${shipment.co2Kg} кг`;

  const prediction = document.querySelector("#prediction");

  prediction.textContent =
    `Ожидаемая задержка: ${shipment.prediction.delayHours} ч. ` +
    shipment.prediction.reason;

  prediction.dataset.risk = shipment.prediction.riskLevel;

  const riskNames = {
    low: "Низкий риск",
    medium: "Средний риск",
    high: "Высокий риск"
  };

  const badge = document.querySelector("#risk-badge");

  badge.textContent = riskNames[shipment.prediction.riskLevel];
  badge.dataset.risk = shipment.prediction.riskLevel;

  const option = shipment.alternative;
  const hours = option.durationDifferenceHours;
  const cost = option.costDifferencePercent;

  const timeText = hours < 0
    ? `на ${Math.abs(hours)} ч быстрее`
    : hours > 0
      ? `на ${hours} ч дольше`
      : "столько же по времени";

  const costText = cost > 0
    ? `на ${cost}% дороже`
    : cost < 0
      ? `на ${Math.abs(cost)}% дешевле`
      : "стоимость та же";

  document.querySelector("#alternative-title").textContent =
    option.title;

  document.querySelector("#alternative-comparison").textContent =
    `${timeText}, ${costText}. ` +
    `Выбросы CO₂: ${option.co2Kg} кг ` +
    `(текущий маршрут: ${shipment.co2Kg} кг).`;

  document.querySelector("#alternative-arrival").textContent =
    `Прибытие по альтернативе: ${formatDate(option.estimatedArrival)}`;

  document.querySelector("#alternative-assumption").textContent =
    option.assumption;

  alternativeBlock.hidden = true;
  alternativeButton.textContent = "Показать альтернативу";
  alternativeButton.setAttribute("aria-expanded", "false");

  const documents = document.querySelector("#documents");

  documents.replaceChildren();

  shipment.customs.documents.forEach(doc => {
    const item = document.createElement("li");

    item.textContent =
      `${doc.title} — ${doc.provided ? "загружен" : "отсутствует"}`;

    item.dataset.provided = String(doc.provided);
    documents.append(item);
  });
}

async function loadShipment() {
  const url = new URL(API_URL);

  const fields = {
    rail_delay: "#rail-delay",
    wind_speed: "#wind-speed",
    port_load: "#port-load",
    alternative_wind_speed: "#alternative-wind-speed",
    alternative_port_load: "#alternative-port-load"
  };

  for (const [parameter, selector] of Object.entries(fields)) {
    url.searchParams.set(
      parameter,
      document.querySelector(selector).value
    );
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`Ошибка API: ${response.status}`);
  }

  return response.json();
}

async function updateForecast() {
  calculateButton.disabled = true;
  loading.hidden = false;
  loading.textContent = "Рассчитываем прогноз…";
  shipmentSection.hidden = true;

  document.dispatchEvent(new Event("shipment-loading"));

  try {
    const shipment = await loadShipment();

    renderShipment(shipment);

    document.dispatchEvent(
      new CustomEvent("shipment-loaded", {
        detail: shipment
      })
    );

    shipmentSection.hidden = false;
    loading.textContent =
      "Прогноз обновлён для указанных условий.";
  } catch (error) {
    loading.textContent =
      "Не удалось получить прогноз. Проверь, что Python-сервер " +
      "работает на порту 8000, а страница открыта через Live Server " +
      "на порту 5500. Затем повтори расчёт.";

    document.dispatchEvent(new Event("shipment-load-error"));

    console.error(error);
  } finally {
    calculateButton.disabled = false;
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  updateForecast();
});

alternativeButton.addEventListener("click", () => {
  alternativeBlock.hidden = !alternativeBlock.hidden;

  alternativeButton.textContent = alternativeBlock.hidden
    ? "Показать альтернативу"
    : "Скрыть альтернативу";

  alternativeButton.setAttribute(
    "aria-expanded",
    String(!alternativeBlock.hidden)
  );
});

updateForecast();