from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import Column, DateTime, JSON, UniqueConstraint
from sqlmodel import Field, SQLModel


class Calculation(SQLModel, table=True):
    __tablename__ = "calculations"

    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    parameters: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    results: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    order_reference: Optional[str] = Field(default=None, index=True)
    preset_name: Optional[str] = Field(default=None)
    mp_fee_applied: Optional[float] = Field(default=None, description="Fee total applied in ARS")
    mp_fee_details: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON, nullable=True))


class Preset(SQLModel, table=True):
    __tablename__ = "presets"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    description: Optional[str] = None
    parameters: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class PaymentNotification(SQLModel, table=True):
    __tablename__ = "payment_notifications"
    __table_args__ = (UniqueConstraint("payment_id", name="uq_payment_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    payment_id: str = Field(index=True)
    order_reference: Optional[str] = Field(default=None, index=True)
    amount: float
    currency: str
    fee_total: float
    fee_breakdown: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    raw_payload: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    received_at: datetime = Field(default_factory=datetime.utcnow)

