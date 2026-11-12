const emissionsSection = document.createElement("section");

emissionsSection.className = "card";
emissionsSection.style.marginTop = "24px";

emissionsSection.innerHTML = `
  <h2>Расчёт CO₂ по маршрутам</h2>

  <p class="muted">
    Вес груза × расстояние × коэффициент транспорта.
  </p>

  <p
    id="emissions-status"
    role="status"
    aria-live="polite"
  ></p>

  <div id="emissions-details"></div>

  <small>
    Расстояния и коэффициенты демонстрационные.
    Учитываем весь путь, включая пройденный ж/д участок,
    без портовых операций и хранения.
    Это условная транспортная оценка,
    не сертифицированный углеродный след.
  </small>
`;

document.querySelector("main").append(emissionsSection);

const emissionsStatus =
  document.querySelector("#emissions-status");

const emissionsDetails =
  document.querySelector("#emissions-details");

function emissionsNumber(value) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 3
  }).format(value);
}

function renderEmissions(shipment) {
  emissionsDetails.replaceChildren();

  if (!shipment.emissions || !shipment.alternative.emissions) {
    emissionsStatus.textContent =
      "Расчёт CO₂ пока не подключён в API.";
    return;
  }

  emissionsStatus.textContent =
    `Вес груза: ${emissionsNumber(shipment.weightTonnes)} т. ` +
    "Данные демонстрационные.";

  const routes = [
    ["Текущий маршрут", shipment.emissions],
    [
      shipment.alternative.title,
      shipment.alternative.emissions
    ]
  ];

  for (const [title, result] of routes) {
    const heading = document.createElement("h3");

    heading.textContent =
      `${title}: ${emissionsNumber(result.totalCo2Kg)} кг CO₂`;

    const list = document.createElement("ul");

    for (const segment of result.segments) {
      const item = document.createElement("li");

      item.textContent =
        `${segment.from} → ${segment.to} ` +
        `(${segment.transportTitle}): ` +
        `${emissionsNumber(result.weightTonnes)} т × ` +
        `${emissionsNumber(segment.distanceKm)} км × ` +
        `${emissionsNumber(segment.factorKgCo2PerTonneKm)} ` +
        `кг CO₂/(т·км) = ` +
        `${emissionsNumber(segment.co2Kg)} кг CO₂`;

      list.append(item);
    }

    emissionsDetails.append(heading, list);
  }

  const difference =
    shipment.alternative.co2Kg - shipment.co2Kg;

  const comparison = document.createElement("p");

  comparison.textContent = difference > 0
    ? `Альтернатива увеличивает оценку выбросов на ${
        emissionsNumber(difference)
      } кг CO₂.`
    : difference < 0
      ? `Альтернатива уменьшает оценку выбросов на ${
          emissionsNumber(-difference)
        } кг CO₂.`
      : "Оценки выбросов маршрутов совпадают.";

  emissionsDetails.append(comparison);
}

document.addEventListener("shipment-loaded", event => {
  renderEmissions(event.detail);
});

document.addEventListener("shipment-loading", () => {
  emissionsStatus.textContent = "Обновляем расчёт…";
  emissionsDetails.replaceChildren();
});

document.addEventListener("shipment-load-error", () => {
  emissionsStatus.textContent =
    "Не удалось получить расчёт CO₂. Повтори загрузку прогноза.";

  emissionsDetails.replaceChildren();
});

emissionsStatus.textContent = "Ожидаем данные груза…";