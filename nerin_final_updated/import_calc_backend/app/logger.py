from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .config import get_settings


_LOG_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
_LOG_FILE = Path(__file__).resolve().parent.parent / "logs" / "app.log"
_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

settings = get_settings()


def configure_logging() -> None:
    logger = logging.getLogger()
    if any(isinstance(handler, RotatingFileHandler) for handler in logger.handlers):
        return

    logger.setLevel(settings.log_level.upper())
    formatter = logging.Formatter(_LOG_FORMAT)

    file_handler = RotatingFileHandler(_LOG_FILE, maxBytes=2_000_000, backupCount=5)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

