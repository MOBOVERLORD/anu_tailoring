from __future__ import annotations

import asyncio
import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import text

from app.database import engine
from app.schema import ensure_database_is_current


PROJECT_ROOT = Path(__file__).resolve().parent.parent
# Stable, application-specific signed bigint used only to serialize migrations.
MIGRATION_LOCK_KEY = 0x564153545249564F


async def _schema_is_current() -> bool:
    try:
        await ensure_database_is_current()
    except RuntimeError as exc:
        print(f"[startup] {exc}", flush=True)
        return False
    return True


async def apply_pending_migrations() -> None:
    """Upgrade an outdated schema once, even during concurrent instance starts."""
    try:
        if await _schema_is_current():
            print("[startup] Database schema is current.", flush=True)
            return

        async with engine.connect() as lock_connection:
            print("[startup] Waiting for the database migration lock.", flush=True)
            await lock_connection.execute(
                text("SELECT pg_advisory_lock(:key)"),
                {"key": MIGRATION_LOCK_KEY},
            )
            # Session-level advisory locks survive a commit. Ending the implicit
            # transaction avoids holding an idle transaction while Alembic runs.
            await lock_connection.commit()
            try:
                # Another instance may have completed the upgrade while this one
                # waited for the advisory lock.
                if await _schema_is_current():
                    print(
                        "[startup] Database schema was upgraded by another instance.",
                        flush=True,
                    )
                    return

                print("[startup] Applying Alembic migrations.", flush=True)
                result = subprocess.run(
                    [sys.executable, "-m", "alembic", "upgrade", "head"],
                    cwd=PROJECT_ROOT,
                    check=False,
                )
                if result.returncode != 0:
                    raise RuntimeError(
                        "Alembic migration failed with exit code "
                        f"{result.returncode}; refusing to start the API."
                    )

                await ensure_database_is_current()
                print("[startup] Database migrations completed.", flush=True)
            finally:
                await lock_connection.execute(
                    text("SELECT pg_advisory_unlock(:key)"),
                    {"key": MIGRATION_LOCK_KEY},
                )
                await lock_connection.commit()
    finally:
        await engine.dispose()


def _server_command() -> list[str]:
    raw_port = os.environ.get("PORT", "8080")
    try:
        port = int(raw_port)
    except ValueError as exc:
        raise RuntimeError(f"PORT must be an integer, received {raw_port!r}.") from exc
    if not 1 <= port <= 65535:
        raise RuntimeError(f"PORT must be between 1 and 65535, received {port}.")

    return [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "0.0.0.0",
        "--port",
        str(port),
    ]


def main() -> None:
    arguments = sys.argv[1:]
    if arguments not in ([], ["--migrate-only"]):
        raise SystemExit("Usage: python -m app.production_startup [--migrate-only]")

    asyncio.run(apply_pending_migrations())
    if arguments == ["--migrate-only"]:
        return

    command = _server_command()
    os.execv(sys.executable, command)


if __name__ == "__main__":
    main()
