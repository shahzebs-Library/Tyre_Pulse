"""Application settings loaded from environment variables (12-factor)."""

from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime configuration. No defaults for secrets - the process
    refuses to start without DATABASE_URL and ANALYTICS_SERVICE_KEY."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: SecretStr = Field(description="Supabase Postgres DSN (postgresql://...)")
    analytics_service_key: SecretStr = Field(description="Shared secret for x-service-key auth")
    allowed_origins: str = Field(default="", description="Comma-separated CORS origins")
    log_level: str = Field(default="INFO")
    service_name: str = Field(default="tyre-pulse-analytics")

    db_pool_min_size: int = Field(default=1, ge=0, le=50)
    db_pool_max_size: int = Field(default=10, ge=1, le=100)
    db_command_timeout_s: float = Field(default=30.0, gt=0, le=300)
    db_statement_timeout_ms: int = Field(default=25_000, gt=0, le=300_000)
    max_rows: int = Field(default=100_000, ge=1_000, le=1_000_000, description="Row cap per query")

    @field_validator("analytics_service_key")
    @classmethod
    def _key_strength(cls, v: SecretStr) -> SecretStr:
        if len(v.get_secret_value()) < 16:
            raise ValueError("ANALYTICS_SERVICE_KEY must be at least 16 characters")
        return v

    @field_validator("log_level")
    @classmethod
    def _valid_level(cls, v: str) -> str:
        upper = v.upper()
        if upper not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError(f"invalid LOG_LEVEL: {v}")
        return upper

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # fields come from the environment
