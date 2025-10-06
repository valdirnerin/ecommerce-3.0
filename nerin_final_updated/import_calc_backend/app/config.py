from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings


class EnvironmentSettings(BaseSettings):
    """Application level configuration loaded from environment variables."""

    database_url: str = Field(
        default="sqlite:///" + str(Path(__file__).resolve().parent.parent / "import_calculator.db"),
        description="SQLAlchemy connection string",
    )
    default_timezone: str = Field(default="America/Argentina/Buenos_Aires")
    log_level: str = Field(default="INFO")
    payment_provider_token: Optional[str] = None
    environment: str = Field(default="dev")

    model_config = {
        "env_prefix": "IMPORT_CALC_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }


class DefaultRates(BaseModel):
    name: str
    di_rate: str
    iva_rate: str
    perc_iva_rate: str
    perc_ganancias_rate: str
    apply_tasa_estadistica: bool = True
    mp_rate: str = "0.05"
    mp_iva_rate: str = "0.21"
    notes: Optional[str] = None
    rounding_step: Optional[int] = None
    psychological_prices: Optional[List[str]] = None


@lru_cache()
def get_settings() -> EnvironmentSettings:
    return EnvironmentSettings()


def get_defaults_path() -> Path:
    return Path(__file__).resolve().parent.parent / "config" / "defaults.yaml"

