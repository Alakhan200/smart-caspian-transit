import json
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from customs import router as customs_router
from emissions import add_emissions
from transfer import calculate_transfer

from clearance import router as clearance_router
from twin import router as twin_router, apply_twin
from timeline import predict_port_delay

app = FastAPI(title="Smart Caspian Transit API")

app.include_router(customs_router)
app.include_router(clearance_router)
app.include_router(twin_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)

SHIPMENT_FILE = Path(__file__).parent / "shipment.json"


def predict_delay(wind_speed, port_load):
    return predict_port_delay(wind_speed, port_load)


@app.get("/api/shipments/SCT-001")
def get_shipment(
    rail_delay: float = Query(default=0, ge=0, le=168),
    wind_speed: float = Query(default=18, ge=0, le=100),
    port_load: float = Query(default=90, ge=0, le=100),
    alternative_wind_speed: float | None = Query(
        default=None, ge=0, le=100
    ),
    alternative_port_load: float | None = Query(
        default=None, ge=0, le=100
    ),
):
    shipment = json.loads(
        SHIPMENT_FILE.read_text(encoding="utf-8")
    )

    alt_wind = (
        wind_speed
        if alternative_wind_speed is None
        else alternative_wind_speed
    )

    alt_load = (
        port_load
        if alternative_port_load is None
        else alternative_port_load
    )

    current = predict_delay(wind_speed, port_load)
    alternate = predict_delay(alt_wind, alt_load)

    transfer = calculate_transfer(rail_delay)
    connection_delay = transfer["additionalDelayHours"]

    if connection_delay:
        current["reason"] = (
            f"Пропущено рейсов: {transfer['missedDepartures']}, "
            f"добавлено {connection_delay} ч к плану. "
            + current["reason"]
        )
    elif rail_delay:
        current["reason"] = (
            "Задержка поезда укладывается в запас до погрузки. "
            + current["reason"]
        )

    current["delayHours"] += connection_delay
    total_delay = current["delayHours"]

    current["riskLevel"] = (
        "high"
        if total_delay >= 12
        else "medium" if total_delay else "low"
    )

    shipment["transfer"] = transfer
    shipment["prediction"] = current

    shipment["conditions"] = {
        "windSpeedMps": wind_speed,
        "portLoadPercent": port_load,
        "source": "demo",
    }

    scheduled = datetime.fromisoformat(
        shipment["scheduledArrival"].replace("Z", "+00:00")
    )

    shipment["estimatedArrival"] = (
        scheduled + timedelta(hours=total_delay)
    ).isoformat()

    alternative = shipment["alternative"]
    extra = alternative["demoExtraHours"]

    # Условно считаем, что альтернатива может отправиться
    # после прибытия груза без ожидания отдельного расписания.
    alternative_delay = (
        extra + rail_delay + alternate["delayHours"]
    )

    alternative["estimatedArrival"] = (
        scheduled + timedelta(hours=alternative_delay)
    ).isoformat()

    alternative["durationDifferenceHours"] = (
        alternative_delay - total_delay
    )

    alternative["prediction"] = alternate

    alternative["conditions"] = {
        "windSpeedMps": alt_wind,
        "portLoadPercent": alt_load,
        "source": "demo",
    }

    alternative["assumption"] = (
        f"Демосценарий: объезд добавляет {extra} ч "
        f"и задержку поезда {rail_delay:g} ч. "
        f"Задержка по условиям Махачкалы: "
        f"{alternate['delayHours']} ч. "
        f"{alternate['reason']}. "
        "У альтернативы условно свободное отправление "
        "после прибытия груза. Отмены рейсов не моделируются."
    )

    return apply_twin(add_emissions(shipment))
