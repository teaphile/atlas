from functools import lru_cache
from pathlib import Path
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ATLAS_", env_file=str(ROOT / ".env"), extra="ignore", hide_input_in_errors=True
    )
    database_path: str = str(ROOT / ".runtime" / "atlas.sqlite3")
    frontend_path: str = str(ROOT / "frontend" / "dist")
    collect: bool = True
    auth_required: bool = False
    api_key: str = Field("", repr=False)
    firms_map_key: str = Field("", repr=False)
    http_timeout: float = Field(12, ge=1, le=45)
    max_response_bytes: int = Field(4_000_000, ge=1000, le=10_000_000)
    max_cache_entries: int = Field(384, ge=10, le=2000)
    rate_limit_per_minute: int = Field(120, ge=1, le=1000)
    user_agent: str = "ATLAS-Earth-Intelligence/1.0 (public environmental research dashboard)"

    @model_validator(mode="after")
    def valid_auth(self):
        if self.auth_required and (
            not 32 <= len(self.api_key) <= 256
            or not self.api_key.isascii()
            or self.api_key.strip() != self.api_key
            or self.api_key.lower() in {"change-me", "secret"}
        ):
            raise ValueError("ATLAS_AUTH_REQUIRED needs a random ATLAS_API_KEY of at least 32 characters")
        return self


@lru_cache
def settings() -> Settings:
    return Settings()
