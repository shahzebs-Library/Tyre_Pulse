"""asyncpg connection pool lifecycle."""

import logging

import asyncpg

from analytics.config import Settings

logger = logging.getLogger(__name__)


async def create_pool(settings: Settings) -> asyncpg.Pool:
    """Create the shared pool. A server-side statement timeout bounds every
    query so a pathological plan can never pin a worker."""
    pool = await asyncpg.create_pool(
        dsn=settings.database_url.get_secret_value(),
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
        command_timeout=settings.db_command_timeout_s,
        server_settings={"statement_timeout": str(settings.db_statement_timeout_ms)},
    )
    logger.info(
        "database pool created",
        extra={"min_size": settings.db_pool_min_size, "max_size": settings.db_pool_max_size},
    )
    return pool


async def close_pool(pool: asyncpg.Pool) -> None:
    await pool.close()
    logger.info("database pool closed")
