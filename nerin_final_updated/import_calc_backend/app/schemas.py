from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .utils.decimal_utils import to_decimal


class MoneyInput(BaseModel):
    amount: Decimal = Field(..., description="Numeric amount as decimal")
    currency: Literal["USD", "ARS"] = Field(default="USD")

    @field_validator("amount", mode="before")
    @classmethod
    def _validate_amount(cls, value: Any) -> Decimal:
        return to_decimal(value)


class CostBreakdownInput(BaseModel):
    fob: MoneyInput = Field(...)
    freight: MoneyInput = Field(...)
    insurance: MoneyInput = Field(...)


class AdditionalTaxInput(BaseModel):
    name: str
    base: Literal["CIF", "BaseIVA", "ARS"]
    rate: Optional[Decimal] = None
    amount_ars: Optional[Decimal] = Field(default=None, description="Fixed amount in ARS if base is ARS")

    @model_validator(mode="after")
    def validate_consistency(self) -> "AdditionalTaxInput":
        if self.base == "ARS" and self.amount_ars is None:
            raise ValueError("amount_ars is required when base is ARS")
        if self.base != "ARS" and self.rate is None:
            raise ValueError("rate is required when base is CIF or BaseIVA")
        return self

    @field_validator("rate", mode="before")
    @classmethod
    def _validate_rate(cls, value: Any) -> Optional[Decimal]:
        if value is None:
            return value
        return to_decimal(value)

    @field_validator("amount_ars", mode="before")
    @classmethod
    def _validate_amount(cls, value: Any) -> Optional[Decimal]:
        if value is None:
            return value
        return to_decimal(value)


class RoundingRule(BaseModel):
    step: Decimal = Field(default=Decimal("1"))
    mode: Literal["nearest", "up", "down"] = Field(default="nearest")
    psychological_endings: Optional[List[str]] = Field(
        default=None,
        description="List of endings to apply such as '0.99'. The first valid ending will be used.",
    )

    @field_validator("step", mode="before")
    @classmethod
    def _validate_step(cls, value: Any) -> Decimal:
        return to_decimal(value)


class CalculationParameters(BaseModel):
    costs: CostBreakdownInput
    tc_aduana: Decimal
    di_rate: Decimal
    apply_tasa_estadistica: bool = True
    iva_rate: Decimal = Field(default=Decimal("0.21"))
    perc_iva_rate: Decimal = Field(default=Decimal("0.20"))
    perc_ganancias_rate: Decimal = Field(default=Decimal("0.06"))
    additional_taxes: List[AdditionalTaxInput] = Field(default_factory=list)
    gastos_locales_ars: Decimal = Field(default=Decimal("0"))
    costos_salida_ars: Decimal = Field(default=Decimal("0"))
    mp_rate: Decimal = Field(default=Decimal("0.0"))
    mp_iva_rate: Decimal = Field(default=Decimal("0.21"))
    target: Literal["margen", "precio"]
    margen_objetivo: Optional[Decimal] = None
    precio_neto_input_ars: Optional[Decimal] = None
    quantity: int = Field(default=1, ge=1)
    rounding: Optional[RoundingRule] = None
    order_reference: Optional[str] = None

    @model_validator(mode="after")
    def validate_rates(self) -> "CalculationParameters":
        if not (Decimal("0") <= self.di_rate <= Decimal("1")):
            raise ValueError("di_rate must be between 0 and 1")
        if self.mp_rate is not None and self.mp_rate >= Decimal("1"):
            raise ValueError("mp_rate must be lower than 1")
        if self.target == "margen":
            if self.margen_objetivo is None:
                raise ValueError("margen_objetivo is required when target is 'margen'")
            if self.margen_objetivo >= Decimal("1"):
                raise ValueError("margen_objetivo must be lower than 1")
        if self.target == "precio" and self.precio_neto_input_ars is None:
            raise ValueError("precio_neto_input_ars is required when target is 'precio'")
        return self

    @field_validator(
        "tc_aduana",
        "di_rate",
        "iva_rate",
        "perc_iva_rate",
        "perc_ganancias_rate",
        "gastos_locales_ars",
        "costos_salida_ars",
        "mp_rate",
        "mp_iva_rate",
        "margen_objetivo",
        "precio_neto_input_ars",
        mode="before",
    )
    @classmethod
    def _convert_decimal(cls, value: Any) -> Optional[Decimal]:
        if value is None:
            return value
        return to_decimal(value)


class CalculationResponse(BaseModel):
    calculation_id: int
    created_at: datetime
    parameters: Dict[str, Any]
    results: Dict[str, Any]


class CalculationCreateRequest(BaseModel):
    preset_name: Optional[str] = None
    parameters: CalculationParameters


class PresetCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    parameters: Dict[str, Any]


class PresetResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    parameters: Dict[str, Any]


class PaymentNotificationRequest(BaseModel):
    payment_id: str
    order_reference: Optional[str] = None
    amount: Decimal
    currency: str
    fee_total: Decimal
    fee_breakdown: Dict[str, Any] = Field(default_factory=dict)
    raw_payload: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("amount", "fee_total", mode="before")
    @classmethod
    def _to_decimal(cls, value: Any) -> Decimal:
        return to_decimal(value)


class ExportResponse(BaseModel):
    filename: str
    content_type: str
    data: bytes

