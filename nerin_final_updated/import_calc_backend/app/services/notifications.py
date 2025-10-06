from __future__ import annotations

import logging
from decimal import Decimal
from typing import Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from ..schemas import CalculationParameters, PaymentNotificationRequest
from ..storage.database import get_session
from ..storage.models import Calculation, PaymentNotification
from ..utils.decimal_utils import to_decimal
from ..utils.serialization import to_serializable
from .calculator import calculate_import_cost

LOGGER = logging.getLogger(__name__)


def save_payment_notification(payload: PaymentNotificationRequest) -> PaymentNotification:
    notification = PaymentNotification(
        payment_id=payload.payment_id,
        order_reference=payload.order_reference,
        amount=float(payload.amount),
        currency=payload.currency,
        fee_total=float(payload.fee_total),
        fee_breakdown=to_serializable(payload.fee_breakdown),
        raw_payload=to_serializable(payload.raw_payload),
    )
    with get_session() as session:
        try:
            session.add(notification)
            session.commit()
            session.refresh(notification)
            LOGGER.info("Payment notification stored", extra={"payment_id": payload.payment_id})
        except IntegrityError:
            session.rollback()
            notification = session.exec(
                select(PaymentNotification).where(PaymentNotification.payment_id == payload.payment_id)
            ).one()
            LOGGER.info("Payment notification already processed", extra={"payment_id": payload.payment_id})
    return notification


def apply_real_fee_to_calculation(
    order_reference: str,
    fee_total: Decimal,
    fee_breakdown: Optional[dict] = None,
) -> Optional[Calculation]:
    with get_session() as session:
        calculation = session.exec(
            select(Calculation).where(Calculation.order_reference == order_reference).order_by(Calculation.id.desc())
        ).first()
        if not calculation:
            LOGGER.warning("No calculation found for order", extra={"order_reference": order_reference})
            return None

        params = CalculationParameters.model_validate(calculation.parameters)
        price_reference_raw = calculation.results.get("precio_neto_ars")
        if price_reference_raw is None:
            price_reference_raw = (
                calculation.results.get("unitary", {}).get("precio_neto_unitario")
            )
        price_reference = Decimal(str(price_reference_raw))

        params.target = "precio"
        params.precio_neto_input_ars = price_reference

        result = calculate_import_cost(params, mp_fee_override=to_decimal(fee_total))

        calculation.results = to_serializable(
            {
                "precio_neto_ars": str(result.precio_neto_ars),
                "precio_final_ars": str(result.precio_final_ars),
                "utilidad_ars": str(result.utilidad),
                "margen": str(result.margen),
                "costo_puesto_ars": str(result.costo_puesto_ars),
                "breakdown": to_serializable(result.breakdown),
                "additional_taxes": to_serializable(result.additional_taxes),
                "totals": to_serializable(result.totals),
                "unitary": to_serializable(result.unitary),
            }
        )
        calculation.mp_fee_applied = float(fee_total)
        calculation.mp_fee_details = to_serializable(fee_breakdown or {})
        session.add(calculation)
        session.commit()
        session.refresh(calculation)
        LOGGER.info(
            "Calculation updated with real fee",
            extra={"order_reference": order_reference, "fee_total": float(fee_total)},
        )
        return calculation


def process_payment_notification(payload: PaymentNotificationRequest) -> Tuple[PaymentNotification, Optional[Calculation]]:
    notification = save_payment_notification(payload)
    calculation = None
    if payload.order_reference:
        calculation = apply_real_fee_to_calculation(
            payload.order_reference, payload.fee_total, payload.fee_breakdown
        )
    return notification, calculation

