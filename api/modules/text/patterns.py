"""
Filipino fake news pattern analyzer.

Detects linguistic signals specific to Tagalog/Taglish disinformation and
produces human-readable explanation categories that actually tell the user
WHY the content is flagged — not just which words mattered to the model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List


@dataclass
class Signal:
    category: str
    detail: str
    severity: str          # "high" | "medium" | "low"
    matched: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Pattern libraries
# ---------------------------------------------------------------------------

# Common clickbait / alarm words in Filipino social media
_SENSATIONAL_EN = {
    "BREAKING", "URGENT", "VIRAL", "SHOCKING", "LEAKED", "EXPOSED",
    "BOMBSHELL", "EXCLUSIVE", "MUST SEE", "MUST READ", "SHARE NOW",
    "SHARE THIS", "TRENDING", "UNBELIEVABLE", "INCREDIBLE",
}
_SENSATIONAL_TL = {
    "GRABE", "GULAT", "HALA", "LINDOL", "NAPAKALAKING", "MAINIT",
    "MALAKING BALITA", "KUMAKALAT NA",
}

# Filipino hearsay / unverified-claim markers
# raw / daw = "allegedly" / "supposedly" (second-hand info)
# umano / diumano = "reportedly" (often used without citing the reporter)
_HEARSAY_PATTERNS: list[str] = [
    r"\braw\b",
    r"\bdaw\b",
    r"\bumano\b",
    r"\bdiumano\b",
    r"\bsabi raw\b",
    r"\bayon daw\b",
    r"\bmayroon daw\b",
    r"\bwika raw\b",
    r"\bsinasabing\b",
    r"\bsinasabi raw\b",
]

# Emotional manipulation markers
_EMOTIONAL_PATTERNS: list[str] = [
    r"!!!+",               # three or more exclamation marks
    r"\?\?\?+",            # three or more question marks
    r"\b[A-Z]{6,}\b",      # ALL-CAPS words of 6+ chars (screaming)
]

# Missing source / vague attribution
_VAGUE_SOURCE_PATTERNS: list[str] = [
    r"\b(isang|a|an)\s+(source|tao|doktor|eksperto|opisyal|insider)\b",
    r"\bnagsabi ng hindi nagpakilala\b",
    r"\banonymous\b",
    r"\bconfidential\b",
    r"\bunnamed\b",
    r"\bdi nagpakilala\b",
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze(text: str, label: str, confidence: float) -> dict:
    """
    Detect Filipino disinformation patterns in text and return an explanation dict.

    Parameters
    ----------
    text       : raw post text (Filipino / English / Taglish)
    label      : model label — "fake" | "real"
    confidence : model P(fake) score in [0, 1]

    Returns
    -------
    dict
        summary  : str    — one-paragraph human-readable verdict explanation
        reasons  : list   — categorized signals with severity
        (to be merged into the full explanation dict alongside LIME top_words)
    """
    signals: List[Signal] = []
    words_upper = set(text.upper().split())

    # 1. Sensationalism
    matched_en = words_upper & _SENSATIONAL_EN
    matched_tl = words_upper & _SENSATIONAL_TL
    matched_sens = matched_en | matched_tl
    if matched_sens:
        signals.append(Signal(
            category="Sensationalist language",
            detail=(
                f"High-alarm terms detected: "
                f"{', '.join(sorted(matched_sens)[:5])}. "
                "These words are disproportionately common in Filipino clickbait and fake news headlines."
            ),
            severity="high",
            matched=sorted(matched_sens),
        ))

    # 2. Filipino hearsay markers
    matched_hearsay: list[str] = []
    for pat in _HEARSAY_PATTERNS:
        found = re.findall(pat, text, re.IGNORECASE)
        matched_hearsay.extend(m.strip() for m in found)
    if matched_hearsay:
        unique = list(dict.fromkeys(matched_hearsay))[:5]
        signals.append(Signal(
            category="Unverified claim markers",
            detail=(
                f"Filipino hearsay markers found: "
                f"{', '.join(repr(w) for w in unique)}. "
                "'Raw' and 'daw' mean 'allegedly/supposedly' and indicate second-hand, "
                "unattributed information. 'Umano/diumano' means 'reportedly' without citing a source."
            ),
            severity="high" if len(unique) >= 2 else "medium",
            matched=unique,
        ))

    # 3. Emotional manipulation
    matched_emotional: list[str] = []
    for pat in _EMOTIONAL_PATTERNS:
        matched_emotional.extend(re.findall(pat, text))
    if matched_emotional:
        signals.append(Signal(
            category="Emotional manipulation",
            detail=(
                "Excessive punctuation or prolonged ALL-CAPS usage detected. "
                "These formatting patterns are designed to provoke an emotional reaction "
                "rather than inform, and are strongly associated with misinformation."
            ),
            severity="medium",
            matched=matched_emotional[:4],
        ))

    # 4. Vague / missing attribution
    matched_vague: list[str] = []
    for pat in _VAGUE_SOURCE_PATTERNS:
        matched_vague.extend(re.findall(pat, text, re.IGNORECASE))
    if matched_vague:
        signals.append(Signal(
            category="Missing source attribution",
            detail=(
                "The post refers to unnamed or anonymous sources "
                f"({', '.join(repr(m.strip()) for m in matched_vague[:3])}). "
                "Credible reporting cites specific, named, verifiable sources."
            ),
            severity="medium",
            matched=[m.strip() for m in matched_vague[:4]],
        ))

    # 5. Very short post with no context (only flag when model also says fake)
    word_count = len(text.split())
    if word_count < 25 and label == "fake":
        signals.append(Signal(
            category="Lacks supporting context",
            detail=(
                f"The post is very short ({word_count} words) and contains no "
                "supporting detail, links, or source citation. Isolated claims without "
                "context are a common format for disinformation."
            ),
            severity="low",
        ))

    summary = _build_summary(label, confidence, signals)

    return {
        "summary": summary,
        "reasons": [
            {
                "category": s.category,
                "detail": s.detail,
                "severity": s.severity,
                "matched": s.matched,
            }
            for s in signals
        ],
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_summary(label: str, confidence: float, signals: List[Signal]) -> str:
    pct = round(confidence * 100)

    if label == "fake":
        if not signals:
            return (
                f"The model classified this as likely disinformation ({pct}% confidence) "
                "based on the overall language pattern, though no specific high-risk phrases "
                "were identified by the rule-based analyzer. "
                "Check the word highlights below — the model found patterns in word combinations "
                "rather than individual terms."
            )
        cats = _oxford_join([s.category.lower() for s in signals])
        high = [s for s in signals if s.severity == "high"]
        severity_note = (
            f" {len(high)} of these signal{'s' if len(high) != 1 else ''} "
            f"{'are' if len(high) != 1 else 'is'} high-severity."
            if high else ""
        )
        return (
            f"This post is likely disinformation ({pct}% confidence). "
            f"Signals detected: {cats}.{severity_note} "
            "These patterns are consistently associated with Filipino fake news and clickbait."
        )
    else:
        if not signals:
            return (
                f"No disinformation signals were detected ({pct}% confidence this is real). "
                "The language and structure are consistent with credible reporting — "
                "no sensationalist terms, hearsay markers, or missing attribution found."
            )
        cats = _oxford_join([s.category.lower() for s in signals])
        return (
            f"Classified as likely real ({pct}% confidence), though some caution flags were noted: "
            f"{cats}. These signals alone do not indicate disinformation."
        )


def _oxford_join(items: list) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"
