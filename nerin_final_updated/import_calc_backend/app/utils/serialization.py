from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi.encoders import jsonable_encoder


def to_serializable(data: Any) -> Any:
    """Ensure Decimal and other non-JSON types are converted safely."""

    if isinstance(data, Decimal):
        return str(data)
    if isinstance(data, dict):
        return {key: to_serializable(value) for key, value in data.items()}
    if isinstance(data, (list, tuple, set)):
        return [to_serializable(item) for item in data]
    return jsonable_encoder(data)

