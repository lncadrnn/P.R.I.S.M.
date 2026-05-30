from schemas.verdict import VerdictResponse, ScanResponse

# Research-paper weights: text 40%, image 35%, video 25%
_WEIGHTS: dict[str, float] = {"text": 0.40, "image": 0.35, "video": 0.25}


def fuse(verdicts: dict[str, VerdictResponse | None]) -> ScanResponse:
    """
    Combine module verdicts into one credibility verdict.
    confidence on each VerdictResponse = P(fake).
    Missing/None modalities are excluded; weights are re-normalised.
    """
    present = {k: v for k, v in verdicts.items() if v is not None}

    if not present:
        return ScanResponse(
            label="unknown",
            confidence=0.0,
            modules=verdicts,
            explanation={"error": "no modalities analysed"},
        )

    total_weight = sum(_WEIGHTS.get(k, 1.0 / len(present)) for k in present)
    fake_score = sum(
        v.confidence * _WEIGHTS.get(k, 1.0 / len(present))
        for k, v in present.items()
    ) / total_weight

    label = "fake" if fake_score >= 0.5 else "real"
    return ScanResponse(
        label=label,
        confidence=round(fake_score, 4),
        modules=verdicts,
        explanation={
            "fusion_score": round(fake_score, 4),
            "modules_used": list(present.keys()),
            "weights_applied": {k: _WEIGHTS.get(k) for k in present},
        },
    )
