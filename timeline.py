import json
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

from transfer import calculate_transfer


def predict_port_delay(wind_speed, port_load):
    weather = (
        12 if wind_speed >= 15
        else 4 if wind_speed >= 10
        else 0
    )

    port = (
        6 if port_load >= 85
        else 2 if port_load >= 65
        else 0
    )

    reasons = []

    if weather:
        reasons.append(
            f"Ветер {wind_speed:g} м/с: +{weather} ч"
        )

    if port:
        reasons.append(
            f"Загрузка порта {port_load:g}%: +{port} ч"
        )

    delay = weather + port

    return {
        "delayHours": delay,
        "reason": (
            "; ".join(reasons)
            or "Факторы задержки не выявлены"
        ),
        "riskLevel": (
            "high" if delay >= 12
            else "medium" if delay
            else "low"
        ),
        "method": "demo_rules",
    }


def build_plan(
    rail_delay=0,
    wind_speed=18,
    port_load=90,
    scenario_id=None,
):
    transfer = calculate_transfer(rail_delay)
    prediction = predict_port_delay(wind_speed, port_load)

    port_delay = (
        6 if port_load >= 85
        else 2 if port_load >= 65
        else 0
    )

    ready = datetime.fromisoformat(
        transfer["actualReadyAt"]
    )

    sailing = datetime.fromisoformat(
        transfer["nextDepartureAt"]
    )

    shipment = json.loads(
        (Path(__file__).parent / "shipment.json")
        .read_text(encoding="utf-8")
    )

    scheduled = shipment["scheduledArrival"]

    arrival = datetime.fromisoformat(
        scheduled.replace("Z", "+00:00")
    ) + timedelta(
        hours=(
            prediction["delayHours"]
            + transfer["additionalDelayHours"]
        )
    )

    # Портовая задержка сдвигает отправление.
    # Погодная задержка увеличивает время морского участка.
    times = [
        ready,
        max(ready, sailing - timedelta(hours=2)),
        sailing + timedelta(hours=port_delay),
        arrival,
    ]

    if any(
        first > second
        for first, second in zip(times, times[1:])
    ):
        raise ValueError(
            "Времена демосценария противоречат друг другу"
        )

    total = (
        prediction["delayHours"]
        + transfer["additionalDelayHours"]
    )

    prediction["delayHours"] = total
    prediction["riskLevel"] = (
        "high" if total >= 12
        else "medium" if total
        else "low"
    )

    if transfer["additionalDelayHours"]:
        prediction["reason"] = (
            f"Пропуск рейса: "
            f"+{transfer['additionalDelayHours']} ч. "
            + prediction["reason"]
        )

    return {
        "scenarioId": scenario_id or uuid4().hex,
        "inputs": {
            "rail_delay": rail_delay,
            "wind_speed": wind_speed,
            "port_load": port_load,
        },
        "stageTimes": [
            value.isoformat() for value in times
        ],
        "scheduledArrival": scheduled,
        "estimatedArrival": arrival.isoformat(),
        "prediction": prediction,
        "transfer": transfer,
        "source": "simulation",
    }
