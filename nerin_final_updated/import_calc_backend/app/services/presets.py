from __future__ import annotations

import logging
from typing import List, Optional

import yaml
from sqlmodel import select

from ..config import DefaultRates, get_defaults_path
from ..storage.database import get_session, init_db
from ..storage.models import Preset
from ..utils.serialization import to_serializable

LOGGER = logging.getLogger(__name__)


def load_default_presets() -> List[Preset]:
    path = get_defaults_path()
    if not path.exists():
        return []

    with path.open("r", encoding="utf-8") as file:
        payload = yaml.safe_load(file) or []

    presets: List[Preset] = []
    for item in payload:
        model = DefaultRates(**item)
        params = {
            "di_rate": model.di_rate,
            "iva_rate": model.iva_rate,
            "perc_iva_rate": model.perc_iva_rate,
            "perc_ganancias_rate": model.perc_ganancias_rate,
            "apply_tasa_estadistica": model.apply_tasa_estadistica,
            "mp_rate": model.mp_rate,
            "mp_iva_rate": model.mp_iva_rate,
        }
        if model.rounding_step:
            params["rounding"] = {
                "step": model.rounding_step,
                "mode": "nearest",
                "psychological_endings": model.psychological_prices,
            }
        presets.append(
            Preset(name=model.name, description=model.notes, parameters=to_serializable(params))
        )
    return presets


def ensure_default_presets() -> None:
    init_db()
    defaults = load_default_presets()
    if not defaults:
        return

    with get_session() as session:
        for preset in defaults:
            exists = session.exec(select(Preset).where(Preset.name == preset.name)).first()
            if exists:
                continue
            session.add(preset)
        session.commit()


def list_presets() -> List[Preset]:
    with get_session() as session:
        results = session.exec(select(Preset)).all()
        return list(results)


def get_preset(name: str) -> Optional[Preset]:
    with get_session() as session:
        return session.exec(select(Preset).where(Preset.name == name)).first()


def create_preset(name: str, description: Optional[str], parameters: dict) -> Preset:
    serialized = to_serializable(parameters)
    preset = Preset(name=name, description=description, parameters=serialized)
    with get_session() as session:
        session.add(preset)
        session.commit()
        session.refresh(preset)
    LOGGER.info("Preset created", extra={"name": name})
    return preset

