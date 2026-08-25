from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

from app.database import engine


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def migration_heads() -> tuple[str, ...]:
    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    return tuple(ScriptDirectory.from_config(config).get_heads())


async def ensure_database_is_current() -> None:
    """Fail fast when deployment skipped its explicit migration step."""
    expected = set(migration_heads())
    async with engine.connect() as connection:
        has_version_table = await connection.run_sync(
            lambda sync_connection: inspect(sync_connection).has_table(
                "alembic_version"
            )
        )
        if not has_version_table:
            raise RuntimeError(
                "Database migrations have not been applied. Run "
                "`python -m alembic upgrade head` before starting Vastrivo."
            )
        rows = await connection.execute(text("SELECT version_num FROM alembic_version"))
        current = {row[0] for row in rows}

    if current != expected:
        raise RuntimeError(
            "Database schema is out of date "
            f"(current: {sorted(current) or ['none']}; expected: {sorted(expected)}). "
            "Run `python -m alembic upgrade head` before starting Vastrivo."
        )
