function initializeRouteMap() {
  const container = document.querySelector("#map");

  if (typeof L === "undefined") {
    container.textContent =
      "Не удалось загрузить карту. Проверь подключение к интернету.";
    return;
  }

  const cities = {
    moscow: [55.7558, 37.6173],
    astrakhan: [46.3479, 48.0336],
    makhachkala: [42.9849, 47.5047],
    anzali: [37.4727, 49.4622]
  };

  const map = L.map("map", {
    scrollWheelZoom: false
  });
  map.attributionControl.setPrefix(
  '<a href="https://leafletjs.com/" target="_blank" rel="noopener">Leaflet</a>'
);

  L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">' +
        "OpenStreetMap</a> contributors"
    }
  ).addTo(map);

  function addPoint(coordinates, color, description) {
    return L.circleMarker(coordinates, {
      radius: 8,
      color: "#ffffff",
      weight: 2,
      fillColor: color,
      fillOpacity: 1
    })
      .addTo(map)
      .bindPopup(description);
  }

  const railRoute = L.polyline(
    [cities.moscow, cities.astrakhan],
    {
      color: "#64748b",
      weight: 4
    }
  ).addTo(map);

  railRoute.bindPopup(
    "Москва → Астрахань<br>Ж/д участок пройден. Схема маршрута."
  );

  const seaRoute = L.polyline(
    [cities.astrakhan, cities.anzali],
    {
      color: "#2563eb",
      weight: 4
    }
  ).addTo(map);

  seaRoute.bindPopup(
    "Астрахань → Энзели<br>Планируемый морской участок. Схема маршрута."
  );

  const alternativeRoute = L.polyline(
    [
      cities.astrakhan,
      cities.makhachkala,
      cities.anzali
    ],
    {
      color: "#f97316",
      weight: 4,
      dashArray: "10 8"
    }
  );

  alternativeRoute.bindPopup(
    "Астрахань → Махачкала → Энзели<br>" +
    "Условная альтернатива: авто + море. Схема маршрута."
  );

  addPoint(
    cities.moscow,
    "#64748b",
    "Москва<br>Начало маршрута"
  );

  const cargoPoint = addPoint(
    cities.astrakhan,
    "#2563eb",
    "Астрахань<br>Груз SCT-001 находится в порту.<br>" +
    "Демонстрационное положение, без GPS-слежения."
  );

  document.addEventListener("twin-updated", event => {
  const state = event.detail;

  cargoPoint.setLatLng(state.coordinates);

  const description = document.createElement("div");

  description.textContent =
    `${state.title}. ${state.location}. ` +
    "Демонстрационное положение, без GPS-слежения.";

  cargoPoint.setPopupContent(description);

  seaRoute.setStyle({
    opacity: state.stage === 3 ? 0.55 : 0.95
  });
});

  const alternativePort = L.circleMarker(
    cities.makhachkala,
    {
      radius: 8,
      color: "#ffffff",
      weight: 2,
      fillColor: "#f97316",
      fillOpacity: 1
    }
  ).bindPopup("Махачкала<br>Альтернативный порт");

  addPoint(
    cities.anzali,
    "#10b981",
    "Энзели<br>Пункт назначения"
  );

  const bounds = L.latLngBounds(Object.values(cities));

  map.fitBounds(bounds, {
    padding: [30, 30]
  });

  cargoPoint.openPopup();

  function syncAlternativeRoute() {
    const isVisible =
      !document.querySelector("#shipment").hidden &&
      !document.querySelector("#alternative").hidden;

    if (isVisible) {
      alternativeRoute.addTo(map);
      alternativePort.addTo(map);
    } else {
      map.removeLayer(alternativeRoute);
      map.removeLayer(alternativePort);
    }
  }

  // Следим за состоянием интерфейса: кнопка альтернативы
  // и новый расчёт автоматически обновляют карту.
  const observer = new MutationObserver(syncAlternativeRoute);

  observer.observe(document.querySelector("#alternative"), {
    attributes: true,
    attributeFilter: ["hidden"]
  });

  observer.observe(document.querySelector("#shipment"), {
    attributes: true,
    attributeFilter: ["hidden"]
  });

  syncAlternativeRoute();
}

initializeRouteMap();