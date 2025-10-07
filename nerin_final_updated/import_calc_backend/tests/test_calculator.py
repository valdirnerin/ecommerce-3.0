from __future__ import annotations

from decimal import Decimal

import pytest

from app.schemas import AdditionalTaxInput, CalculationParameters, CostBreakdownInput, MoneyInput, RoundingRule
from app.services.calculator import calculate_import_cost


@pytest.fixture
def base_parameters() -> dict:
    return {
        "costs": CostBreakdownInput(
            fob=MoneyInput(amount="100", currency="USD"),
            freight=MoneyInput(amount="5", currency="USD"),
            insurance=MoneyInput(amount="1", currency="USD"),
        ),
        "tc_aduana": Decimal("980"),
        "di_rate": Decimal("0.08"),
        "apply_tasa_estadistica": True,
        "iva_rate": Decimal("0.21"),
        "perc_iva_rate": Decimal("0.20"),
        "perc_ganancias_rate": Decimal("0.06"),
        "gastos_locales_ars": Decimal("8000"),
        "costos_salida_ars": Decimal("2500"),
        "mp_rate": Decimal("0.05"),
        "mp_iva_rate": Decimal("0.21"),
        "target": "margen",
        "margen_objetivo": Decimal("0.25"),
    }


def test_case_base_with_tasa_estadistica(base_parameters):
    params = CalculationParameters(**base_parameters)
    result = calculate_import_cost(params)
    assert result.breakdown["Tasa_Estadistica_USD"] == Decimal("3.18")
    assert result.costo_puesto_ars > Decimal("0")
    assert result.precio_final_ars > result.costo_puesto_ars


def test_exempt_tasa_estadistica(base_parameters):
    params = CalculationParameters(**{**base_parameters, "apply_tasa_estadistica": False})
    result = calculate_import_cost(params)
    assert result.breakdown["Tasa_Estadistica_USD"] == Decimal("0")


def test_different_di_rate(base_parameters):
    params = CalculationParameters(**{**base_parameters, "di_rate": Decimal("0.12")})
    result = calculate_import_cost(params)
    assert result.breakdown["DI_USD"] == Decimal("12.72")


def test_margin_target_price_solution(base_parameters):
    params = CalculationParameters(**base_parameters)
    result = calculate_import_cost(params)
    assert result.margen == Decimal("0.2500")
    assert result.precio_neto_ars > result.costo_puesto_ars


def test_price_target_with_real_fee(base_parameters):
    params = CalculationParameters(**{**base_parameters, "target": "precio", "precio_neto_input_ars": Decimal("75000")})
    result = calculate_import_cost(params, mp_fee_override=Decimal("5000"))
    assert result.mp_fee_total == Decimal("5000.00")
    assert result.margen == result.breakdown["Margen"]


def test_additional_taxes_and_rounding(base_parameters):
    params = CalculationParameters(
        **{
            **base_parameters,
            "additional_taxes": [
                AdditionalTaxInput(name="Imp Interno", base="CIF", rate=Decimal("0.10")),
                AdditionalTaxInput(name="Eco", base="ARS", amount_ars=Decimal("1500")),
            ],
            "rounding": RoundingRule(step=Decimal("10"), mode="nearest", psychological_endings=[".99"]),
        }
    )
    result = calculate_import_cost(params)
    assert any(tax["name"] == "Imp Interno" for tax in result.additional_taxes)
    assert result.precio_neto_ars % Decimal("10") != 0  # due to psychological ending

