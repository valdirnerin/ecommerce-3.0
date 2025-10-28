from __future__ import annotations

from decimal import Decimal, InvalidOperation, getcontext


getcontext().prec = 28


def _normalize_string(value: str) -> str:
    """Normalize different number formats to the canonical decimal representation.

    The calculator is used mainly in Spanish speaking locales where users often
    input decimals with a comma separator (e.g. "0,25") and optional thousand
    separators (e.g. "1.234,50"). The previous implementation delegated the
    parsing to ``Decimal`` directly which raises ``InvalidOperation`` for those
    strings producing the confusing message "The string did not match the
    expected pattern" in the UI.  We now strip common formatting characters and
    convert the decimal separator to a dot before instantiating ``Decimal``.
    """

    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Empty string cannot be converted to Decimal")

    # Remove currency symbols and spaces that may sneak in when copying values
    # from spreadsheets or other sources.
    for symbol in ("$", "USD", "ARS", "%"):
        cleaned = cleaned.replace(symbol, "")
    cleaned = cleaned.replace(" ", "")

    if "," in cleaned and "." in cleaned:
        # Determine which symbol is the decimal separator by looking at the
        # rightmost occurrence. Everything preceding it should be thousands
        # separators that need to be dropped.
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "")
            cleaned = cleaned.replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(".", "")
        cleaned = cleaned.replace(",", ".")
    else:
        cleaned = cleaned.replace(",", "")

    return cleaned


def to_decimal(value: float | int | str | Decimal) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if isinstance(value, str):
        normalized = _normalize_string(value)
    else:
        normalized = value

    try:
        return Decimal(normalized)
    except InvalidOperation as error:
        raise ValueError(f"Invalid decimal value: {value}") from error


def quantize(value: Decimal, digits: str = "0.01") -> Decimal:
    return value.quantize(Decimal(digits))

