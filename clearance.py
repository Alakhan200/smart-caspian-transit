import hmac
import json
import os
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator


BASE = Path(__file__).parent
DB_FILE = BASE / "transit.db"

bearer = HTTPBearer(auto_error=False)


def authorize(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    expected = os.environ.get("CLEARANCE_API_TOKEN", "")

    if not expected:
        raise HTTPException(
            503,
            "На сервере не задан CLEARANCE_API_TOKEN",
        )

    if credentials is None or not hmac.compare_digest(
        credentials.credentials.encode(),
        expected.encode(),
    ):
        raise HTTPException(
            401,
            "Неверный API-ключ",
            headers={"WWW-Authenticate": "Bearer"},
        )


router = APIRouter(
    prefix="/api/clearance",
    tags=["Демо pre-clearance"],
    dependencies=[Depends(authorize)],
)


class ApplicationData(BaseModel):
    sender: str = Field(min_length=1, max_length=200)
    consignee: str = Field(min_length=1, max_length=200)

    invoiceNumber: str = Field(default="", max_length=100)
    packingListNumber: str = Field(default="", max_length=100)

    invoiceWeightTonnes: float = Field(
        gt=0,
        le=100000,
        allow_inf_nan=False,
    )

    packingWeightTonnes: float = Field(
        gt=0,
        le=100000,
        allow_inf_nan=False,
    )

    invoiceIncluded: bool = False
    packingListIncluded: bool = False

    @field_validator(
        "sender",
        "consignee",
        "invoiceNumber",
        "packingListNumber",
        mode="before",
    )
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value


def connect():
    db = sqlite3.connect(
        DB_FILE,
        timeout=10,
        isolation_level=None,
    )
    db.row_factory = sqlite3.Row

    db.executescript("""
        CREATE TABLE IF NOT EXISTS clearance_applications (
            id TEXT PRIMARY KEY,
            shipment_id TEXT NOT NULL,
            status TEXT NOT NULL,
            data TEXT NOT NULL,
            checks TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            reference TEXT
        );

        CREATE TABLE IF NOT EXISTS clearance_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id TEXT NOT NULL,
            status TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            message TEXT NOT NULL
        );
    """)

    return db


def now():
    return datetime.now(timezone.utc).isoformat()


def event(db, app_id, status, message):
    db.execute("""
        INSERT INTO clearance_events (
            application_id, status, occurred_at, message
        ) VALUES (?, ?, ?, ?)
    """, (app_id, status, now(), message))


def get_row(db, app_id):
    row = db.execute(
        "SELECT * FROM clearance_applications WHERE id=?",
        (app_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(404, "Заявка не найдена")

    return row


def serialize(db, row):
    result = dict(row)
    result["data"] = json.loads(result["data"])
    result["checks"] = json.loads(result["checks"])

    rows = db.execute("""
        SELECT status, occurred_at, message
        FROM clearance_events
        WHERE application_id=?
        ORDER BY id
    """, (row["id"],)).fetchall()

    result["events"] = [dict(item) for item in rows]
    result["service"] = "local_customs_simulator"
    result["sentToRealCustoms"] = False

    return result


def inspect_documents(data):
    shipment = json.loads(
        (BASE / "shipment.json").read_text(encoding="utf-8")
    )

    cargo_weight = Decimal(str(shipment["weightTonnes"]))

    return [
        {
            "title": "Инвойс включён в демокомплект и указан его номер",
            "passed": (
                data["invoiceIncluded"]
                and bool(data["invoiceNumber"])
            ),
        },
        {
            "title": "Упаковочный лист включён и указан его номер",
            "passed": (
                data["packingListIncluded"]
                and bool(data["packingListNumber"])
            ),
        },
        {
            "title": "Вес инвойса совпадает с весом груза",
            "passed": (
                Decimal(str(data["invoiceWeightTonnes"]))
                == cargo_weight
            ),
        },
        {
            "title": "Вес упаковочного листа совпадает с весом груза",
            "passed": (
                Decimal(str(data["packingWeightTonnes"]))
                == cargo_weight
            ),
        },
    ]


@router.get("/applications")
def list_applications():
    db = connect()

    try:
        rows = db.execute("""
            SELECT id, status, updated_at, reference
            FROM clearance_applications
            ORDER BY updated_at DESC
            LIMIT 20
        """).fetchall()

        return {"items": [dict(row) for row in rows]}
    finally:
        db.close()


@router.post("/applications", status_code=201)
def create_application(data: ApplicationData):
    db = connect()

    try:
        db.execute("BEGIN IMMEDIATE")

        app_id = uuid4().hex
        timestamp = now()

        db.execute("""
            INSERT INTO clearance_applications (
                id, shipment_id, status, data, checks,
                created_at, updated_at, reference
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            app_id,
            "SCT-001",
            "draft",
            json.dumps(data.model_dump(), ensure_ascii=False),
            "[]",
            timestamp,
            timestamp,
            None,
        ))

        event(
            db,
            app_id,
            "draft",
            "Создана демонстрационная заявка",
        )

        result = serialize(db, get_row(db, app_id))
        db.commit()
        return result
    finally:
        db.close()


@router.get("/applications/{app_id}")
def read_application(app_id: str):
    db = connect()

    try:
        return serialize(db, get_row(db, app_id))
    finally:
        db.close()


@router.put("/applications/{app_id}")
def update_application(app_id: str, data: ApplicationData):
    db = connect()

    try:
        db.execute("BEGIN IMMEDIATE")
        row = get_row(db, app_id)

        if row["status"] not in (
            "draft",
            "needs_correction",
            "ready",
        ):
            raise HTTPException(
                409,
                "Отправленную заявку редактировать нельзя. Создай новую.",
            )

        db.execute("""
            UPDATE clearance_applications
            SET data=?, status=?, checks=?, updated_at=?
            WHERE id=?
        """, (
            json.dumps(data.model_dump(), ensure_ascii=False),
            "draft",
            "[]",
            now(),
            app_id,
        ))

        event(
            db,
            app_id,
            "draft",
            "Сведения изменены, требуется повторная проверка",
        )

        result = serialize(db, get_row(db, app_id))
        db.commit()
        return result
    finally:
        db.close()


@router.post("/applications/{app_id}/{action}")
def change_status(app_id: str, action: str):
    if action not in ("validate", "submit", "process"):
        raise HTTPException(404, "Действие не найдено")

    db = connect()

    try:
        db.execute("BEGIN IMMEDIATE")
        row = get_row(db, app_id)

        status = row["status"]
        reference = row["reference"]

        checks = inspect_documents(json.loads(row["data"]))
        passed = all(check["passed"] for check in checks)

        if action == "validate" and status in (
            "draft",
            "needs_correction",
            "ready",
        ):
            status = "ready" if passed else "needs_correction"

            message = (
                "Проверка пройдена"
                if passed
                else "Заявка возвращена на исправление"
            )

        elif action == "submit" and status == "ready":
            status = "submitted_demo"
            message = "Заявка передана локальному имитатору таможни"

        elif action == "process" and status == "submitted_demo":
            status = (
                "preapproved_demo"
                if passed
                else "needs_correction"
            )

            reference = (
                "SIM-" + app_id[:12].upper()
                if passed
                else None
            )

            message = (
                "Имитатор предварительно согласовал сведения"
                if passed
                else "Имитатор обнаружил расхождения"
            )

        else:
            raise HTTPException(
                409,
                "Действие недоступно в текущем статусе",
            )

        db.execute("""
            UPDATE clearance_applications
            SET status=?, checks=?, reference=?, updated_at=?
            WHERE id=?
        """, (
            status,
            json.dumps(checks, ensure_ascii=False),
            reference,
            now(),
            app_id,
        ))

        event(db, app_id, status, message)

        result = serialize(db, get_row(db, app_id))
        db.commit()
        return result
    finally:
        db.close()
