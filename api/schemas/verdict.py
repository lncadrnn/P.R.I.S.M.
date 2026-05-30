from pydantic import BaseModel, Field
from typing import Any


class VerdictResponse(BaseModel):
    """
    Shared output contract for every forensic module.
    confidence = P(fake): 0.0 = certainly real, 1.0 = certainly fake.
    label is derived from confidence >= 0.5.
    """
    label: str = Field(..., pattern="^(real|fake|unknown)$")
    confidence: float = Field(..., ge=0.0, le=1.0)
    explanation: dict[str, Any]


class ScanResponse(BaseModel):
    """Final fused verdict returned by POST /scan."""
    label: str
    confidence: float
    modules: dict[str, VerdictResponse | None]
    explanation: dict[str, Any]
