from __future__ import annotations
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Kind(StrEnum):
    earthquake = "earthquake"
    fire = "fire"
    storm = "storm"
    flood = "flood"
    volcano = "volcano"
    drought = "drought"
    weather = "weather"
    aircraft = "aircraft"
    camera = "camera"
    satellite = "satellite"
    space = "space"
    news = "news"
    cyber = "cyber"
    other = "other"


class ScientificInput(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def reject_booleans(cls, value):
        if isinstance(value, bool):
            raise ValueError("Boolean is not a numeric scientific input")
        return value


class Point(ScientificInput):
    model_config = ConfigDict(allow_inf_nan=False)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class Event(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: str = Field(max_length=300)
    source_id: str
    source_record_id: str
    kind: Kind
    title: str = Field(max_length=600)
    description: str = Field(default="", max_length=2500)
    point: Point | None = None
    occurred_at: datetime | None = None
    updated_at: datetime | None = None
    expires_at: datetime | None = None
    severity: Literal["info", "low", "moderate", "high", "critical", "unknown"] = "unknown"
    nature: Literal["observation", "model", "forecast", "bulletin", "catalog", "news"] = "observation"
    url: str = ""
    attributes: dict[str, Any] = Field(default_factory=dict)

    @field_validator("url")
    @classmethod
    def safe_url(cls, value: str) -> str:
        from urllib.parse import urlsplit

        try:
            p = urlsplit(value)
            return (
                value
                if p.scheme in {"http", "https"} and p.hostname and not p.username and not p.password
                else ""
            )
        except ValueError:
            return ""

    @field_validator("occurred_at", "updated_at", "expires_at")
    @classmethod
    def utc_date(cls, v):
        return v.replace(tzinfo=timezone.utc) if v and v.tzinfo is None else v


class Payload(BaseModel):
    events: list[Event] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)
    upstream_time: datetime | None = None
    warnings: list[str] = Field(default_factory=list)
    record_count: int = Field(default=0, ge=0)


class SourceDefinition(BaseModel):
    id: str
    name: str
    provider: str
    category: str
    scope: Literal["global", "regional", "location", "context", "service"]
    nature: str
    coverage: str
    ttl_seconds: int
    max_stale_seconds: int
    docs_url: str
    attribution: str
    license_note: str
    description: str
    key_env: str | None = None
    enabled_by_default: bool = False


class Envelope(BaseModel):
    source_id: str
    status: Literal["fresh", "stale", "empty", "unavailable", "disabled", "idle", "refreshing"]
    fetched_at: datetime | None = None
    checked_at: datetime | None = None
    upstream_time: datetime | None = None
    age_seconds: float | None = None
    latency_ms: int | None = None
    error_code: str | None = None
    warnings: list[str] = Field(default_factory=list)
    payload: Payload = Field(default_factory=Payload)


class AOIRequest(ScientificInput):
    geometry: dict[str, Any]
    kinds: list[Kind] | None = Field(default=None, max_length=20)
    hours: int = Field(default=168, ge=1, le=720)
    minimum_priority: int = Field(default=0, ge=0, le=5)
    end: datetime | None = None

    @field_validator("end")
    @classmethod
    def require_timezone(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("Use a timezone-aware cutoff")
        return value


class ErosionScenario(ScientificInput):
    rainfall_erosivity: float = Field(ge=0, le=20000, description="R: MJ·mm/(ha·h·year)")
    soil_erodibility: float = Field(ge=0, le=1, description="K: t·h/(MJ·mm)")
    slope_percent: float = Field(ge=0, le=100)
    slope_length_m: float = Field(ge=1, le=2000)
    cover_factor: float = Field(ge=0, le=1)
    practice_factor: float = Field(ge=0, le=1)
    alternative_cover_factor: float = Field(ge=0, le=1)
    model_config = ConfigDict(allow_inf_nan=False)


class ComparisonRequest(ScientificInput):
    points: list[Point] = Field(min_length=2, max_length=3)
    base_c: float = Field(default=10, ge=-10, le=49)
    cap_c: float = Field(default=30, ge=-9, le=50)
