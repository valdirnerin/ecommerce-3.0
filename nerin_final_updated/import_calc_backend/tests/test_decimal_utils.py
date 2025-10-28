from decimal import Decimal

import pytest

from app.utils.decimal_utils import to_decimal


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("0,25", Decimal("0.25")),
        ("1.234,5", Decimal("1234.5")),
        ("1.234.567,89", Decimal("1234567.89")),
        ("  $ 9,99 ", Decimal("9.99")),
        ("0.25", Decimal("0.25")),
    ],
)
def test_to_decimal_accepts_locale_formats(raw, expected):
    assert to_decimal(raw) == expected


def test_to_decimal_rejects_empty_string():
    with pytest.raises(ValueError):
        to_decimal("")


def test_to_decimal_rejects_percent_values():
    with pytest.raises(ValueError):
        to_decimal("25%")
