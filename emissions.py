from decimal import Decimal, ROUND_HALF_UP


# Демонстрационные коэффициенты, кг CO₂ на тонно-километр.
# Не нормативные значения — позднее заменим данными из источников.
FACTORS = {
    "rail": {
        "title": "Ж/д",
        "kgCo2PerTonneKm": "0.020",
    },
    "road": {
        "title": "Авто",
        "kgCo2PerTonneKm": "0.100",
    },
    "sea": {
        "title": "Море",
        "kgCo2PerTonneKm": "0.015",
    },
}

# Расстояния условные, для демонстрации расчёта.
CURRENT_ROUTE = [
    ("Москва", "Астрахань", "rail", 1400),
    ("Астрахань", "Энзели", "sea", 1000),
]

ALTERNATIVE_ROUTE = [
    ("Москва", "Астрахань", "rail", 1400),
    ("Астрахань", "Махачкала", "road", 500),
    ("Махачкала", "Энзели", "sea", 700),
]


def round_kg(value):
    return float(
        value.quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP,
        )
    )


def calculate_route(weight_tonnes, route):
    weight = Decimal(str(weight_tonnes))

    if not weight.is_finite() or weight <= 0:
        raise ValueError("Вес груза должен быть положительным")

    segments = []
    total = Decimal("0")

    for origin, destination, transport, distance in route:
        factor = Decimal(
            FACTORS[transport]["kgCo2PerTonneKm"]
        )

        emission = weight * Decimal(str(distance)) * factor
        total += emission

        segments.append({
            "from": origin,
            "to": destination,
            "transport": transport,
            "transportTitle": FACTORS[transport]["title"],
            "distanceKm": distance,
            "factorKgCo2PerTonneKm": float(factor),
            "co2Kg": round_kg(emission),
        })

    return {
        "totalCo2Kg": round_kg(total),
        "weightTonnes": float(weight),
        "segments": segments,
        "method": "tonne_km_demo",
        "formula": (
            "Вес, т × расстояние, км × "
            "коэффициент, кг CO₂/(т·км)"
        ),
        "dataSource": (
            "Демонстрационные расстояния и коэффициенты, "
            "без внешнего источника"
        ),
        "scope": (
            "Весь маршрут, включая пройденный ж/д участок. "
            "Без портовых операций и хранения."
        ),
    }


def add_emissions(shipment):
    current = calculate_route(
        shipment["weightTonnes"],
        CURRENT_ROUTE,
    )

    alternative = calculate_route(
        shipment["weightTonnes"],
        ALTERNATIVE_ROUTE,
    )

    shipment["emissions"] = current
    shipment["co2Kg"] = current["totalCo2Kg"]

    shipment["alternative"]["emissions"] = alternative
    shipment["alternative"]["co2Kg"] = alternative["totalCo2Kg"]

    return shipment
