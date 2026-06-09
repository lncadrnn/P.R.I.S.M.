r"""
LIMETextExplainer: word-level importance scores for the TextClassifier.

Design choices for Taglish (Filipino/English code-switched text):
  - split_expression=str.split       : word-level tokenisation; the default
                                       \W+ regex can mangle hyphenated
                                       Tagalog compounds.
  - bow=False                        : word order matters for transformers.
  - mask_string=tokenizer.unk_token  : keep perturbed strings in-vocabulary
                                       so token-count stays stable.
  - random_state=42                  : reproducible explanations across runs.

LIME operates at word granularity while the underlying model tokenises into
subword pieces; this is intentional — word-level explanations are more
human-readable for Tagalog speakers even though a slight granularity mismatch
exists.

Usage:
    explainer = LIMETextExplainer(tokenizer=tokenizer)
    result = explainer.explain(text, predict_fn, num_features=10)
    # result["top_words"] → [{"word": "...", "weight": 0.12}, ...]
"""

from __future__ import annotations

from typing import Callable

import numpy as np
from lime.lime_text import LimeTextExplainer as _LimeCore

from .patterns import analyze as pattern_analyze

# Label constants (must match model training convention)
LABEL_REAL = 0
LABEL_FAKE = 1
CLASS_NAMES = ["real", "fake"]


class LIMETextExplainer:
    """
    Wraps lime.lime_text.LimeTextExplainer with transformer-friendly defaults
    and a simple dict-returning API consumed by TextDetector.

    Parameters
    ----------
    tokenizer
        The HuggingFace tokenizer for the model being explained.
        Used only to retrieve `.unk_token` for mask_string.
    num_samples : int
        Number of perturbed instances LIME generates per explanation.
        500 is fast for iteration; use 1500 for production quality.
    """

    def __init__(self, tokenizer, num_samples: int = 1500):
        mask_string = getattr(tokenizer, "unk_token", "[UNK]") or "[UNK]"

        self._lime = _LimeCore(
            class_names=CLASS_NAMES,
            split_expression=str.split,   # word-level, not regex \W+
            bow=False,                     # word order matters for transformers
            mask_string=mask_string,       # perturbed text stays in-vocabulary
            random_state=42,               # reproducible
        )
        self.num_samples = num_samples

    def explain(
        self,
        text: str,
        predict_fn: Callable[[list[str]], np.ndarray],
        label: str,
        confidence: float,
        num_features: int = 10,
    ) -> dict:
        """
        Compute a full explanation: Filipino pattern signals + LIME word weights.

        Parameters
        ----------
        text : str
        predict_fn : callable — (list[str]) -> np.ndarray shape (N, 2)
        label : str — "fake" | "real" from the primary inference pass
        confidence : float — P(fake) from the primary inference pass
        num_features : int — max LIME words to highlight

        Returns
        -------
        dict with:
            method      : "pattern+LIME"
            summary     : str — human-readable paragraph explaining the verdict
            reasons     : list — categorized Filipino pattern signals with severity
            top_words   : list — LIME word weights for highlight rendering
        """
        # --- Filipino pattern analysis (rule-based, language-aware) ---
        pattern_result = pattern_analyze(text, label, confidence)

        # --- LIME word-level importance ---
        exp = self._lime.explain_instance(
            text,
            predict_fn,
            num_features=num_features,
            num_samples=self.num_samples,
            top_labels=1,
        )
        top_label_idx = exp.available_labels()[0]
        word_weights = exp.as_list(label=top_label_idx)
        top_words = [
            {
                "word": word,
                "weight": round(float(weight), 6),
                "direction": "supports" if weight > 0 else "opposes",
            }
            for word, weight in sorted(word_weights, key=lambda x: abs(x[1]), reverse=True)
        ]

        return {
            "method": "pattern+LIME",
            "summary": pattern_result["summary"],
            "reasons": pattern_result["reasons"],
            "top_words": top_words,
            # Wire-ready contract for the extension's "Verified Source Links"
            # panel. Populated once the fact-check retrieval layer (Vera Files,
            # AFP, GMA, ABS-CBN matching) lands; empty until then so the UI can
            # render a clean "no matched sources yet" state without fake data.
            # Each entry: {"title": str, "url": str, "publisher": str}.
            "sources": [],
        }
