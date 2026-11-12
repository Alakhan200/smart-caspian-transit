import json
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, field_validator


router = APIRouter(
    prefix="/api/customs",
    tags=["Проверка документов"],
)

BASE_DIR = Path(__file__).parent
SHIPMENT_FILE = BASE_DIR / "shipment.json"
DB_FILE = BASE_DIR / "transit.db"


def connect_db():
    connection = sqlite3.connect(DB_FILE, timeout=10)
    connection.row_factory = sqlite3.Row

    connection.execute("""
        CREATE TABLE IF NOT EXISTS document_checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shipment_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            invoice_number TEXT NOT NULL,
            packing_number TEXT NOT NULL,
            invoice_weight TEXT NOT NULL,
            packing_weight TEXT NOT NULL,
            cargo_weight TEXT NOT NULL,
            status TEXT NOT NULL
        )
    """)

    connection.commit()
    return connection


class DocumentCheck(BaseModel):
    invoiceNumber: str = Field(
        min_length=1,
        max_length=100,
    )

    packingListNumber: str = Field(
        min_length=1,
        max_length=100,
    )

    invoiceWeightTonnes: Decimal = Field(
        gt=0,
        le=100000,
        max_digits=12,
        decimal_places=3,
    )

    packingWeightTonnes: Decimal = Field(
        gt=0,
        le=100000,
        max_digits=12,
        decimal_places=3,
    )

    @field_validator(
        "invoiceNumber",
        "packingListNumber",
        mode="before",
    )
    @classmethod
    def trim_number(cls, value):
        return value.strip() if isinstance(value, str) else value


@router.post("/SCT-001/check")
def check_documents(data: DocumentCheck):
    shipment = json.loads(
        SHIPMENT_FILE.read_text(encoding="utf-8")
    )

    weight = Decimal(str(shipment["weightTonnes"]))

    checks = [
        {
            "title": "Вес в инвойсе совпадает с весом груза",
            "passed": data.invoiceWeightTonnes == weight,
        },
        {
            "title": "Вес в упаковочном листе совпадает с весом груза",
            "passed": data.packingWeightTonnes == weight,
        },
        {
            "title": "Вес в обоих документах совпадает",
            "passed": (
                data.invoiceWeightTonnes
                == data.packingWeightTonnes
            ),
        },
    ]

    ready = all(check["passed"] for check in checks)

    status = (
        "ready_for_demo_submission"
        if ready
        else "needs_correction"
    )

    created_at = datetime.now(timezone.utc).isoformat()

    connection = connect_db()

    try:
        with connection:
            cursor = connection.execute("""
                INSERT INTO document_checks (
                    shipment_id,
                    created_at,
                    invoice_number,
                    packing_number,
                    invoice_weight,
                    packing_weight,
                    cargo_weight,
                    status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                shipment["id"],
                created_at,
                data.invoiceNumber,
                data.packingListNumber,
                str(data.invoiceWeightTonnes),
                str(data.packingWeightTonnes),
                str(weight),
                status,
            ))

            check_id = cursor.lastrowid
    finally:
        connection.close()

    return {
        "checkId": check_id,
        "createdAt": created_at,
        "shipmentId": shipment["id"],
        "status": status,
        "message": (
            "Сведения прошли демопроверку"
            if ready
            else "Исправь расхождения в весе"
        ),
        "cargoWeightTonnes": float(weight),
        "checks": checks,
        "submittedToCustoms": False,
    }


@router.get("/SCT-001/history")
def get_history(
    limit: int = Query(default=20, ge=1, le=100),
):
    connection = connect_db()

    try:
        rows = connection.execute("""
            SELECT *
            FROM document_checks
            WHERE shipment_id = ?
            ORDER BY id DESC
            LIMIT ?
        """, ("SCT-001", limit)).fetchall()
    finally:
        connection.close()

    return {
        "items": [dict(row) for row in rows]
    }
