from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..schemas import (
    CalculationCreateRequest,
    CalculationParameters,
    CalculationResponse,
    PaymentNotificationRequest,
    PresetCreateRequest,
    PresetResponse,
)
from ..services.calculator import calculate_import_cost
from ..services.exporter import default_filename, export_to_csv, export_to_xlsx
from ..services.notifications import process_payment_notification
from ..services.presets import create_preset, ensure_default_presets, get_preset, list_presets
from ..storage.database import get_session
from ..storage.models import Calculation
from ..utils.serialization import to_serializable

LOGGER = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["calculator"])


@router.on_event("startup")
def startup_event() -> None:
    ensure_default_presets()


@router.post("/calculations", response_model=CalculationResponse)
def create_calculation(request: CalculationCreateRequest) -> CalculationResponse:
    parameters_data = request.parameters.model_dump()
    preset_name = request.preset_name

    if preset_name:
        preset = get_preset(preset_name)
        if not preset:
            raise HTTPException(status_code=404, detail="Preset not found")
        merged = {**preset.parameters, **parameters_data}
        parameters = CalculationParameters.model_validate(merged)
    else:
        parameters = request.parameters

    result = calculate_import_cost(parameters)

    stored_result: Dict[str, Any] = {
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

    with get_session() as session:
        calculation = Calculation(
            parameters=to_serializable(parameters.model_dump()),
            results=stored_result,
            order_reference=parameters.order_reference,
            preset_name=preset_name,
            mp_fee_applied=float(result.mp_fee_total),
        )
        session.add(calculation)
        session.commit()
        session.refresh(calculation)

    LOGGER.info("Calculation created", extra={"id": calculation.id, "order_reference": parameters.order_reference})

    return CalculationResponse(
        calculation_id=calculation.id,
        created_at=calculation.created_at,
        parameters=calculation.parameters,
        results=calculation.results,
    )


@router.get("/calculations/{calculation_id}", response_model=CalculationResponse)
def get_calculation(calculation_id: int) -> CalculationResponse:
    with get_session() as session:
        calculation = session.get(Calculation, calculation_id)
        if not calculation:
            raise HTTPException(status_code=404, detail="Calculation not found")
    return CalculationResponse(
        calculation_id=calculation.id,
        created_at=calculation.created_at,
        parameters=calculation.parameters,
        results=calculation.results,
    )


@router.get("/calculations/{calculation_id}/export")
def export_calculation(calculation_id: int, format: str = "csv") -> StreamingResponse:
    with get_session() as session:
        calculation = session.get(Calculation, calculation_id)
        if not calculation:
            raise HTTPException(status_code=404, detail="Calculation not found")

    breakdown = calculation.results.get("breakdown", {})

    if format == "csv":
        content = export_to_csv(breakdown)
        filename = default_filename("calculo", "csv")
        media_type = "text/csv"
    elif format == "xlsx":
        content = export_to_xlsx(breakdown)
        filename = default_filename("calculo", "xlsx")
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        raise HTTPException(status_code=400, detail="Unsupported export format")

    return StreamingResponse(iter([content]), media_type=media_type, headers={"Content-Disposition": f"attachment; filename={filename}"})


@router.post("/presets", response_model=PresetResponse)
def create_preset_route(payload: PresetCreateRequest) -> PresetResponse:
    preset = create_preset(payload.name, payload.description, payload.parameters)
    return PresetResponse(id=preset.id, name=preset.name, description=preset.description, parameters=preset.parameters)


@router.get("/presets", response_model=list[PresetResponse])
def list_presets_route() -> list[PresetResponse]:
    presets = list_presets()
    return [PresetResponse(id=p.id, name=p.name, description=p.description, parameters=p.parameters) for p in presets]


@router.post("/payments/notify")
def payment_notification(payload: PaymentNotificationRequest) -> Dict[str, Any]:
    notification, calculation = process_payment_notification(payload)
    response: Dict[str, Any] = {
        "payment_id": notification.payment_id,
        "order_reference": notification.order_reference,
        "fee_total": notification.fee_total,
    }
    if calculation:
        response["calculation_id"] = calculation.id
        response["updated_results"] = calculation.results
    return response

