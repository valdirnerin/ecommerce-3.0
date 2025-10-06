from __future__ import annotations

import logging
from datetime import datetime

import pytz
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .config import get_settings
from .logger import configure_logging
from .storage.database import init_db

configure_logging()
settings = get_settings()

app = FastAPI(title="Import Cost Calculator", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
def startup() -> None:
    init_db()
    logging.getLogger(__name__).info("Application started", extra={"environment": settings.environment})


@app.get("/health")
def health_check() -> dict[str, str]:
    tz = pytz.timezone(settings.default_timezone)
    now = datetime.now(tz).isoformat()
    return {"status": "ok", "timestamp": now}

