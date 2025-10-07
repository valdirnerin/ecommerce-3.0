from __future__ import annotations

from decimal import Decimal, getcontext


getcontext().prec = 28


def to_decimal(value: float | int | str | Decimal) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    return Decimal(value)


def quantize(value: Decimal, digits: str = "0.01") -> Decimal:
    return value.quantize(Decimal(digits))

