import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from clearance import authorize
from timeline import build_plan


DB_FILE = Path(__file__).parent / "transit.db"

router = APIRouter(
    prefix="/api/shipments/SCT-001/twin",
    tags=["Симуляция перевозки"],
)

STAGES = [
    (
        "at_port",
        "Груз в порту",
        "Порт Астрахань",
        [46.3479, 48.0336],
    ),
    (
        "loading",
        "Началась погрузка",
        "Порт Астрахань — погрузка",
        [46.3479, 48.0336],
    ),
    (
        "at_sea",
        "Паром отправился",
        "Каспийское море — условная точка",
        [42.5, 49.0],
    ),
    (
        "arrived",
        "Груз прибыл",
        "Порт Энзели",
        [37.4727, 49.4622],
    ),
]


class Command(BaseModel):
    action: Literal["next", "reset"]
    expectedVersion: int = Field(ge=0)

    rail_delay: float = Field(
        default=0, ge=0, le=168, allow_inf_nan=False
    )

    wind_speed: float = Field(
        default=18, ge=0, le=100, allow_inf_nan=False
    )

    port_load: float = Field(
        default=90, ge=0, le=100, allow_inf_nan=False
    )


def now():
    return datetime.now(timezone.utc).isoformat()


def connect():
    db = sqlite3.connect(
        DB_FILE,
        timeout=10,
        isolation_level=None,
    )

    db.row_factory = sqlite3.Row

    db.executescript("""
        CREATE TABLE IF NOT EXISTS twin_state (
            shipment_id TEXT PRIMARY KEY,
            stage INTEGER NOT NULL,
            version INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS twin_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shipment_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            occurred_at TEXT NOT NULL,
            message TEXT NOT NULL,
            source TEXT NOT NULL
        );
    """)

    # Добавляем поля, сохраняя существующие записи.
    db.execute("BEGIN IMMEDIATE")

    try:
        additions = [
            ("twin_state", "plan_json"),
            ("twin_events", "model_time"),
            ("twin_events", "scenario_id"),
        ]

        for table, column in additions:
            columns = {
                row["name"]
                for row in db.execute(
                    f"PRAGMA table_info({table})"
                )
            }

            if column not in columns:
                db.execute(
                    f"ALTER TABLE {table} "
                    f"ADD COLUMN {column} TEXT"
                )

        db.execute("""
            INSERT OR IGNORE INTO twin_state (
                shipment_id, stage, version, updated_at
            ) VALUES (?, ?, ?, ?)
        """, ("SCT-001", 0, 0, now()))

        db.commit()
    except Exception:
        db.rollback()
        db.close()
        raise

    return db


def snapshot(db):
    row = db.execute(
        "SELECT * FROM twin_state WHERE shipment_id=?",
        ("SCT-001",),
    ).fetchone()

    index = row["stage"]
    stage = STAGES[index]

    plan = (
        json.loads(row["plan_json"])
        if row["plan_json"]
        else None
    )

    events = db.execute("""
        SELECT *
        FROM twin_events
        WHERE shipment_id=?
        ORDER BY id DESC
        LIMIT 30
    """, ("SCT-001",)).fetchall()

    return {
        "shipmentId": "SCT-001",
        "stage": index,
        "status": stage[0],
        "title": stage[1],
        "location": stage[2],
        "coordinates": stage[3],
        "version": row["version"],
        "updatedAt": row["updated_at"],
        "modelTime": (
            plan["stageTimes"][index] if plan else None
        ),
        "plan": plan,
        "needsReset": index > 0 and plan is None,
        "nextAction": (
            STAGES[index + 1][1] if index < 3 else None
        ),
        "source": "simulation",
        "events": [dict(event) for event in events],
    }


@router.get("")
def get_twin():
    db = connect()

    try:
        db.execute("BEGIN")
        return snapshot(db)
    finally:
        db.close()


@router.post(
    "/events",
    dependencies=[Depends(authorize)],
)
def add_event(command: Command):
    db = connect()

    try:
        db.execute("BEGIN IMMEDIATE")
        state = snapshot(db)

        if state["version"] != command.expectedVersion:
            raise HTTPException(
                409,
                "Состояние изменилось. Обнови состояние.",
            )

        if command.action == "next" and (
            state["needsReset"] or state["stage"] == 3
        ):
            raise HTTPException(
                409,
                "Начни сценарий заново.",
            )

        if command.action == "reset" or state["stage"] == 0:
            previous_id = (
                state["plan"]["scenarioId"]
                if state["plan"] and command.action != "reset"
                else None
            )

            plan = build_plan(
                command.rail_delay,
                command.wind_speed,
                command.port_load,
                previous_id,
            )
        else:
            # После начала погрузки план фиксирован.
            plan = state["plan"]

        index = (
            0 if command.action == "reset"
            else state["stage"] + 1
        )

        version = state["version"] + 1
        recorded = now()

        message = (
            "Новый сценарий: груз в Астрахани"
            if command.action == "reset"
            else STAGES[index][1]
        )

        db.execute("""
            UPDATE twin_state
            SET stage=?, version=?, updated_at=?, plan_json=?
            WHERE shipment_id=?
        """, (
            index,
            version,
            recorded,
            json.dumps(plan, ensure_ascii=False),
            "SCT-001",
        ))

        db.execute("""
            INSERT INTO twin_events (
                shipment_id, version, occurred_at,
                message, source, model_time, scenario_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            "SCT-001",
            version,
            recorded,
            message,
            "simulation",
            plan["stageTimes"][index],
            plan["scenarioId"],
        ))

        result = snapshot(db)
        db.commit()
        return result
    finally:
        db.close()


def apply_twin(shipment):
    state = get_twin()

    if state["stage"] == 0:
        conditions = shipment["conditions"]

        scenario_id = (
            state["plan"]["scenarioId"]
            if state["plan"]
            else "preview"
        )

        state["plan"] = build_plan(
            shipment["transfer"]["railDelayHours"],
            conditions["windSpeedMps"],
            conditions["portLoadPercent"],
            scenario_id,
        )

        state["modelTime"] = state["plan"]["stageTimes"][0]

    shipment["twin"] = state
    shipment["status"] = state["status"]
    shipment["currentLocation"] = state["location"]
    shipment["updatedAt"] = state["updatedAt"]

    shipment["actualArrival"] = (
        state["modelTime"] if state["stage"] == 3 else None
    )

    shipment["route"][0]["status"] = "completed"

    shipment["route"][1]["status"] = (
        "completed" if state["stage"] == 3
        else "in_progress" if state["stage"] == 2
        else "pending"
    )

    shipment["alternative"]["available"] = (
        state["stage"] == 0
    )

    if state["stage"] > 0:
        if state["plan"]:
            plan = state["plan"]

            shipment["estimatedArrival"] = (
                plan["estimatedArrival"]
            )

            shipment["prediction"] = plan["prediction"]
            shipment["scheduledArrival"] = plan["scheduledArrival"]
            shipment["transfer"] = plan["transfer"]

            shipment["conditions"] = {
                "windSpeedMps": plan["inputs"]["wind_speed"],
                "portLoadPercent": plan["inputs"]["port_load"],
                "railDelayHours": plan["inputs"]["rail_delay"],
                "source": "frozen_simulation",
            }
        else:
            shipment["estimatedArrival"] = None

            shipment["prediction"] = {
                "delayHours": None,
                "riskLevel": "unknown",
                "reason": "Старый сценарий: начни заново",
                "method": "not_available",
            }

    return shipment


@router.get("/history")
def get_history(
    scope: Literal["current", "all"] = "current",
    before: int | None = None,
):
    if before is not None and before <= 0:
        raise HTTPException(422, "Некорректный номер события")

    db = connect()

    try:
        db.execute("BEGIN")

        row = db.execute(
            "SELECT plan_json FROM twin_state WHERE shipment_id=?",
            ("SCT-001",),
        ).fetchone()

        plan = (
            json.loads(row["plan_json"])
            if row["plan_json"]
            else None
        )

        scenario_id = plan["scenarioId"] if plan else None

        if scope == "current" and not scenario_id:
            return {
                "items": [],
                "hasMore": False,
                "nextBefore": None,
            }

        conditions = ["shipment_id=?"]
        values = ["SCT-001"]

        if scope == "current":
            conditions.append("scenario_id=?")
            values.append(scenario_id)

        if before is not None:
            conditions.append("id<?")
            values.append(before)

        rows = db.execute(
            "SELECT * FROM twin_events WHERE "
            + " AND ".join(conditions)
            + " ORDER BY id DESC LIMIT 31",
            values,
        ).fetchall()

        items = [dict(item) for item in rows[:30]]
        has_more = len(rows) > 30

        return {
            "items": items,
            "hasMore": has_more,
            "nextBefore": (
                items[-1]["id"] if has_more else None
            ),
        }
    finally:
        db.close()
