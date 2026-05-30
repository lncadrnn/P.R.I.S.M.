from schemas.verdict import VerdictResponse, ScanResponse

# Research-paper weights: text 40%, image 35%, video 25%
_WEIGHTS: dict[str, float] = {"text": 0.40, "image": 0.35, "video": 0.25}


def fuse(verdicts: dict[str, VerdictResponse | None]) -> ScanResponse:
    """
    Combine module verdicts into one credibility verdict.
    confidence on each VerdictResponse = P(fake).
    Missing/None modalities are excluded; weights are re-normalised.

    A module that returns label="unknown" (e.g. an untrained model abstaining,
    or a modality that failed/declined to score) is treated like an absent
    modality: it is kept in `modules` for display but excluded from the
    weighted average so it cannot drag the fused score toward real or fake.
    """
    # Scored = present AND actually committed to a real/fake call.
    scored = {k: v for k, v in verdicts.items()
              if v is not None and v.label in ("real", "fake")}
    abstained = [k for k, v in verdicts.items()
                 if v is not None and v.label not in ("real", "fake")]

    if not scored:
        return ScanResponse(
            label="unknown",
            confidence=0.0,
            modules=verdicts,
            explanation={
                "error": "no conclusive modalities",
                "abstained": abstained,
            },
        )
    present = scored

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
            "modules_abstained": abstained,
            "weights_applied": {k: _WEIGHTS.get(k) for k in present},
        },
    )
