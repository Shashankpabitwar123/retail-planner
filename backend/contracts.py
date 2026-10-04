from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic import BaseModel, ConfigDict, Field, field_validator, ValidationError
from .domain import DataError


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ImportSettings(StrictModel):
    mapping: dict[str, str]
    layout: Literal["daily", "transactions", "wide"] = "daily"
    date_format: Literal["ISO", "MDY", "DMY"] = "ISO"
    number_format: Literal["dot", "comma"] = "dot"
    timezone: str = "Etc/UTC"
    coverage_start: str = Field(max_length=10)
    coverage_end: str = Field(max_length=10)
    coverage_confirmed: bool = False
    gross_sales_confirmed: bool = False
    missing_days_zero: bool = False
    deduplicate_events: bool = False
    store_id: str = Field(default="", max_length=120)
    synthetic: bool = False
    coverage_upload_id: str = Field(default="", max_length=64)
    date_status_upload_id: str = Field(default="", max_length=64)
    compare_review_id: str = Field(default="", max_length=64)
    event_labels: dict[str, Literal["sale", "return", "cancellation"]] = Field(
        default_factory=dict
    )
    exclude_product_ids: list[str] = Field(default_factory=list, max_length=100)
    allow_product_renames: bool = False
    quantity_basis: Literal["gross_completed_sales", "positive_invoice_units_proxy"] = (
        "gross_completed_sales"
    )
    demo_proxy_confirmed: bool = False

    @field_validator("timezone")
    @classmethod
    def zone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Use a valid IANA store timezone.")
        return value

    @field_validator("mapping")
    @classmethod
    def mapping_keys(cls, value):
        allowed = {
            "date",
            "product_id",
            "product_name",
            "units",
            "event_id",
            "event_type",
            "store_id",
            "date_status",
        }
        if set(value) - allowed:
            raise ValueError("Unknown mapping fields.")
        return value


class Incoming(StrictModel):
    id: str = Field(min_length=1, max_length=120)
    date: str = Field(max_length=10)
    units: int = Field(gt=0, le=1_000_000_000)
    status: Literal["open", "received", "cancelled"] = "open"


class InventorySettings(StrictModel):
    product_id: str = Field(min_length=1, max_length=120)
    stock: int = Field(ge=0, le=1_000_000_000)
    snapshot_date: str = Field(max_length=10)
    lead_days: int = Field(ge=1, le=28)
    review_days: int = Field(ge=1, le=28)
    buffer_days: int = Field(ge=0, le=28)
    pack_size: int = Field(ge=1, le=1_000_000_000)
    minimum_order: int = Field(ge=0, le=1_000_000_000)
    mode: Literal["historical_replay", "current"]
    confirmed: bool
    incoming: list[Incoming] = Field(default_factory=list, max_length=100)


def validate(model, value):
    try:
        return model.model_validate(value).model_dump()
    except ValidationError as exc:
        fields = ", ".join(".".join(str(v) for v in e["loc"]) for e in exc.errors()[:4])
        raise DataError(
            "Check these settings: "
            + fields
            + ". Values must use the expected format and range."
        )
