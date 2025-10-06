from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Dict

from openpyxl import Workbook


def export_to_csv(data: Dict[str, str | int | float]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Concepto", "Valor"])
    for key, value in data.items():
        writer.writerow([key, value])
    return buffer.getvalue().encode("utf-8")


def export_to_xlsx(data: Dict[str, str | int | float]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Calculo"
    ws.append(["Concepto", "Valor"])
    for key, value in data.items():
        ws.append([key, value])
    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def default_filename(prefix: str, extension: str) -> str:
    return f"{prefix}-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.{extension}"

