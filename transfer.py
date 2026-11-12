from datetime import datetime, timedelta
from math import ceil


def calculate_transfer(rail_delay_hours):
    # Деморасписание:
    # груз готов за 3 часа до отправления;
    # приём закрывается за 2 часа;
    # следующий рейс через сутки.
    planned_ready = datetime.fromisoformat(
        "2026-11-12T21:00:00+00:00"
    )

    planned_departure = datetime.fromisoformat(
        "2026-11-13T00:00:00+00:00"
    )

    cutoff = planned_departure - timedelta(hours=2)

    actual_ready = planned_ready + timedelta(
        hours=rail_delay_hours
    )

    interval = timedelta(hours=24)

    missed = max(
        0,
        ceil((actual_ready - cutoff) / interval),
    )

    departure = planned_departure + missed * interval

    return {
        "plannedReadyAt": planned_ready.isoformat(),
        "actualReadyAt": actual_ready.isoformat(),
        "plannedDepartureAt": planned_departure.isoformat(),
        "loadingCutoffAt": cutoff.isoformat(),
        "nextDepartureAt": departure.isoformat(),
        "railDelayHours": rail_delay_hours,
        "missedDepartures": missed,
        "additionalDelayHours": missed * 24,
        "status": "missed" if missed else "on_time",
        "source": "demo_schedule",
    }
