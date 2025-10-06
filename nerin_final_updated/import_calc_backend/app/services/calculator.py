from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP
from typing import Dict, List, Optional, Tuple

from ..schemas import AdditionalTaxInput, CalculationParameters
from ..utils.decimal_utils import quantize, to_decimal

LOGGER = logging.getLogger(__name__)


@dataclass
class CalculationResult:
    breakdown: Dict[str, Decimal]
    additional_taxes: List[Dict[str, Decimal]]
    costo_puesto_ars: Decimal
    precio_neto_ars: Decimal
    precio_final_ars: Decimal
    utilidad: Decimal
    margen: Decimal
    comision_mp: Decimal
    iva_comision_mp: Decimal
    mp_fee_total: Decimal
    quantity: int
    totals: Dict[str, Decimal]
    unitary: Dict[str, Decimal]


def _convert_cost_to_usd(amount: Decimal, currency: str, exchange_rate: Decimal) -> Decimal:
    if currency == "USD":
        return amount
    return quantize(amount / exchange_rate, "0.0001")


def _calculate_additional_taxes(
    params: CalculationParameters,
    cif_usd: Decimal,
    di_usd: Decimal,
    tasa_est_usd: Decimal,
) -> Tuple[List[Dict[str, Decimal]], Decimal, Decimal]:
    taxes_details: List[Dict[str, Decimal]] = []
    taxes_total_ars = Decimal("0")
    taxes_total_usd = Decimal("0")

    cif_based: List[Tuple[AdditionalTaxInput, Decimal]] = []
    base_iva_based: List[Tuple[AdditionalTaxInput, Decimal]] = []

    for tax in params.additional_taxes:
        if tax.base == "CIF":
            amount_usd = quantize(cif_usd * tax.rate, "0.0001")
            cif_based.append((tax, amount_usd))
        elif tax.base == "BaseIVA":
            base_iva_based.append((tax, Decimal("0")))
        else:
            taxes_details.append({
                "name": tax.name,
                "amount_ars": quantize(tax.amount_ars, "0.01"),
                "amount_usd": quantize(tax.amount_ars / params.tc_aduana, "0.0001"),
            })
            taxes_total_ars += quantize(tax.amount_ars, "0.01")

    subtotal_base_iva = cif_usd + di_usd + tasa_est_usd + sum(amount for _, amount in cif_based)

    for tax, _ in base_iva_based:
        amount_usd = quantize(subtotal_base_iva * tax.rate, "0.0001")
        taxes_details.append({
            "name": tax.name,
            "amount_usd": amount_usd,
            "amount_ars": quantize(amount_usd * params.tc_aduana, "0.01"),
        })
        taxes_total_usd += amount_usd
        subtotal_base_iva += amount_usd

    for tax, amount_usd in cif_based:
        taxes_details.append({
            "name": tax.name,
            "amount_usd": amount_usd,
            "amount_ars": quantize(amount_usd * params.tc_aduana, "0.01"),
        })
        taxes_total_usd += amount_usd

    return taxes_details, taxes_total_usd, taxes_total_ars


def _round_price(value: Decimal, rounding_rule) -> Decimal:
    if rounding_rule is None:
        return quantize(value)

    step = rounding_rule.step
    mode = rounding_rule.mode

    if step <= 0:
        return quantize(value)

    divided = value / step
    if mode == "nearest":
        rounded = divided.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    elif mode == "up":
        rounded = divided.quantize(Decimal("1"), rounding=ROUND_CEILING)
    else:
        rounded = divided.quantize(Decimal("1"), rounding=ROUND_FLOOR)

    candidate = rounded * step
    candidate = quantize(candidate)

    endings = rounding_rule.psychological_endings or []
    for ending in endings:
        try:
            ending_decimal = to_decimal(ending)
        except Exception:  # pragma: no cover - invalid user supplied endings
            continue
        ending_fraction = quantize(ending_decimal % 1, "0.01")
        base_floor = candidate.quantize(Decimal("1"), rounding=ROUND_FLOOR)
        candidate_with_ending = base_floor + ending_fraction
        if candidate_with_ending <= 0:
            continue
        if mode == "up" and candidate_with_ending < candidate:
            continue
        if mode == "down" and candidate_with_ending > candidate:
            continue
        candidate = quantize(candidate_with_ending)
        break

    return quantize(candidate)


def calculate_import_cost(params: CalculationParameters, mp_fee_override: Optional[Decimal] = None) -> CalculationResult:
    LOGGER.info("Starting calculation", extra={"target": params.target, "order_reference": params.order_reference})

    exchange_rate = params.tc_aduana

    cif_components = {
        "FOB": _convert_cost_to_usd(params.costs.fob.amount, params.costs.fob.currency, exchange_rate),
        "Freight": _convert_cost_to_usd(
            params.costs.freight.amount, params.costs.freight.currency, exchange_rate
        ),
        "Insurance": _convert_cost_to_usd(
            params.costs.insurance.amount, params.costs.insurance.currency, exchange_rate
        ),
    }

    cif_usd = quantize(sum(cif_components.values()), "0.0001")
    di_usd = quantize(cif_usd * params.di_rate, "0.0001")
    tasa_est_usd = quantize(cif_usd * Decimal("0.03") if params.apply_tasa_estadistica else Decimal("0"), "0.0001")

    additional_taxes_details, additional_taxes_usd, additional_taxes_ars = _calculate_additional_taxes(
        params, cif_usd, di_usd, tasa_est_usd
    )

    base_iva_usd = cif_usd + di_usd + tasa_est_usd + additional_taxes_usd
    iva_usd = quantize(base_iva_usd * params.iva_rate, "0.0001")
    perc_iva_usd = quantize(base_iva_usd * params.perc_iva_rate, "0.0001")

    tributos_ars_base = quantize(
        (base_iva_usd + iva_usd + perc_iva_usd + di_usd + tasa_est_usd) * exchange_rate, "0.01"
    )
    perc_ganancias_ars = quantize(tributos_ars_base * params.perc_ganancias_rate, "0.01")

    breakdown = {
        "CIF_USD": cif_usd,
        "DI_USD": di_usd,
        "Tasa_Estadistica_USD": tasa_est_usd,
        "Base_IVA_USD": base_iva_usd,
        "IVA_USD": iva_usd,
        "Percepcion_IVA_USD": perc_iva_usd,
        "Percepcion_Ganancias_ARS": perc_ganancias_ars,
        "Gastos_Locales_ARS": quantize(params.gastos_locales_ars, "0.01"),
        "Costos_Salida_ARS": quantize(params.costos_salida_ars, "0.01"),
    }

    for key, value in cif_components.items():
        breakdown[f"{key}_USD"] = quantize(value, "0.0001")

    cif_ars = quantize(cif_usd * exchange_rate, "0.01")
    di_ars = quantize(di_usd * exchange_rate, "0.01")
    tasa_est_ars = quantize(tasa_est_usd * exchange_rate, "0.01")
    iva_ars = quantize(iva_usd * exchange_rate, "0.01")
    perc_iva_ars = quantize(perc_iva_usd * exchange_rate, "0.01")
    additional_taxes_ars += quantize(additional_taxes_usd * exchange_rate, "0.01")

    costo_puesto_ars = quantize(
        cif_ars
        + di_ars
        + tasa_est_ars
        + iva_ars
        + perc_iva_ars
        + perc_ganancias_ars
        + additional_taxes_ars
        + params.gastos_locales_ars,
        "0.01",
    )

    mp_rate = params.mp_rate
    mp_iva_rate = params.mp_iva_rate

    precio_neto = Decimal("0")
    comision_mp = Decimal("0")
    iva_comision = Decimal("0")
    mp_fee_total = Decimal("0")

    if params.target == "margen":
        denominator = Decimal("1") - (mp_rate * (Decimal("1") + mp_iva_rate)) - params.margen_objetivo
        if denominator <= 0:
            raise ValueError("The provided parameters produce a negative or zero denominator")
        precio_neto = quantize((costo_puesto_ars + params.costos_salida_ars) / denominator)
        comision_mp = quantize(precio_neto * mp_rate)
        iva_comision = quantize(comision_mp * mp_iva_rate)
        mp_fee_total = comision_mp + iva_comision
    else:
        precio_neto = quantize(params.precio_neto_input_ars)
        if mp_fee_override is not None:
            mp_fee_total = quantize(mp_fee_override)
            if mp_iva_rate > 0:
                divisor = Decimal("1") + mp_iva_rate
                comision_mp = quantize(mp_fee_total / divisor)
                iva_comision = quantize(mp_fee_total - comision_mp)
            else:
                comision_mp = mp_fee_total
                iva_comision = Decimal("0")
        else:
            comision_mp = quantize(precio_neto * mp_rate)
            iva_comision = quantize(comision_mp * mp_iva_rate)
            mp_fee_total = comision_mp + iva_comision

    utilidad = quantize(precio_neto - costo_puesto_ars - params.costos_salida_ars - mp_fee_total)
    margen = Decimal("0") if precio_neto == 0 else quantize(utilidad / precio_neto, "0.0001")

    if precio_neto < 0:
        LOGGER.warning("Precio neto negativo", extra={"precio_neto": float(precio_neto)})

    precio_neto = _round_price(precio_neto, params.rounding)

    if params.target == "margen" or params.rounding is not None:
        # Recalculate dependent values after rounding or when a real fee must adapt to rounded price
        if mp_fee_override is not None and params.target == "precio":
            mp_fee_total = quantize(mp_fee_override)
            if mp_iva_rate > 0:
                divisor = Decimal("1") + mp_iva_rate
                comision_mp = quantize(mp_fee_total / divisor)
                iva_comision = quantize(mp_fee_total - comision_mp)
            else:
                comision_mp = mp_fee_total
                iva_comision = Decimal("0")
        else:
            comision_mp = quantize(precio_neto * mp_rate)
            iva_comision = quantize(comision_mp * mp_iva_rate)
            mp_fee_total = comision_mp + iva_comision

        utilidad = quantize(precio_neto - costo_puesto_ars - params.costos_salida_ars - mp_fee_total)
        margen = Decimal("0") if precio_neto == 0 else quantize(utilidad / precio_neto, "0.0001")

    precio_final = quantize(precio_neto * (Decimal("1") + params.iva_rate))

    totals = {
        "costo_puesto_total": quantize(costo_puesto_ars * params.quantity),
        "precio_neto_total": quantize(precio_neto * params.quantity),
        "precio_final_total": quantize(precio_final * params.quantity),
        "utilidad_total": quantize(utilidad * params.quantity),
    }

    unitary = {
        "costo_puesto_unitario": quantize(costo_puesto_ars / params.quantity),
        "precio_neto_unitario": quantize(precio_neto),
        "precio_final_unitario": quantize(precio_final),
        "utilidad_unitaria": quantize(utilidad / params.quantity),
    }

    breakdown.update(
        {
            "CIF_ARS": cif_ars,
            "DI_ARS": di_ars,
            "Tasa_Estadistica_ARS": tasa_est_ars,
            "IVA_ARS": iva_ars,
            "Percepcion_IVA_ARS": perc_iva_ars,
            "Additional_Taxes_ARS": additional_taxes_ars,
            "Comision_MP_ARS": comision_mp,
            "IVA_Comision_MP_ARS": iva_comision,
            "MP_Fee_Total_ARS": mp_fee_total,
            "Utilidad_ARS": utilidad,
            "Margen": margen,
        }
    )

    return CalculationResult(
        breakdown=breakdown,
        additional_taxes=additional_taxes_details,
        costo_puesto_ars=costo_puesto_ars,
        precio_neto_ars=precio_neto,
        precio_final_ars=precio_final,
        utilidad=utilidad,
        margen=margen,
        comision_mp=comision_mp,
        iva_comision_mp=iva_comision,
        mp_fee_total=mp_fee_total,
        quantity=params.quantity,
        totals=totals,
        unitary=unitary,
    )

