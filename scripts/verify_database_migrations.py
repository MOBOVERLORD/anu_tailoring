"""Exercise production startup migrations in a disposable PostgreSQL database."""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from uuid import uuid4

from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings


DATABASE_PREFIX = "vastrivo_migration_verify_"


def database_url(database_name: str) -> str:
    url = make_url(settings.database_url).set(database=database_name)
    return url.render_as_string(hide_password=False)


async def execute_maintenance(statement: str) -> None:
    engine = create_async_engine(
        database_url(os.getenv("POSTGRES_MAINTENANCE_DB", "postgres")),
        isolation_level="AUTOCOMMIT",
    )
    try:
        async with engine.connect() as connection:
            await connection.execute(text(statement))
    finally:
        await engine.dispose()


async def verify_schema(database_name: str) -> tuple[int, str]:
    engine = create_async_engine(database_url(database_name))
    try:
        async with engine.connect() as connection:
            tables = await connection.run_sync(
                lambda sync_connection: set(
                    inspect(sync_connection).get_table_names()
                )
            )
            required = {
                "users",
                "designs",
                "products",
                "orders",
                "deliveries",
                "vendor_customer_relationships",
                "alembic_version",
            }
            missing = required - tables
            if missing:
                raise AssertionError(f"Migration omitted tables: {sorted(missing)}")
            revision = await connection.scalar(
                text("SELECT version_num FROM alembic_version")
            )
            if not revision:
                raise AssertionError("Alembic did not record a database revision")
            return len(tables), str(revision)
    finally:
        await engine.dispose()


def main() -> None:
    source_url = make_url(settings.database_url)
    if not source_url.drivername.startswith("postgresql"):
        raise RuntimeError("Migration verification requires PostgreSQL")

    database_name = f"{DATABASE_PREFIX}{uuid4().hex[:12]}"
    asyncio.run(execute_maintenance(f'CREATE DATABASE "{database_name}"'))
    try:
        environment = {**os.environ, "DATABASE_URL": database_url(database_name)}
        subprocess.run(
            [
                sys.executable,
                "-m",
                "app.production_startup",
                "--migrate-only",
            ],
            check=True,
            env=environment,
        )
        table_count, revision = asyncio.run(verify_schema(database_name))
        print(
            "Fresh database migration passed: "
            f"{table_count} tables at revision {revision}"
        )
    finally:
        asyncio.run(
            execute_maintenance(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                f"WHERE datname = '{database_name}' AND pid <> pg_backend_pid()"
            )
        )
        asyncio.run(execute_maintenance(f'DROP DATABASE "{database_name}"'))


if __name__ == "__main__":
    main()
