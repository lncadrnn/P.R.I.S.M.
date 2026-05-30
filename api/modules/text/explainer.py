"""
LIMETextExplainer: word-level importance scores for the TextClassifier.

Design choices for Taglish (Filipino/English code-switched text):
  - split_expression=str.split       : word-level tokenisation; the default
                                       r'\W+' regex can mangle hyphenated
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
        num_features: int = 10,
    ) -> dict:
        """
        Compute word-level importance for a single text.

        Parameters
        ----------
        text : str
            The raw input string (Filipino, English, or Taglish).
        predict_fn : callable
            Accepts a list[str], returns np.ndarray of shape (N, 2) with
            class probabilities [P(real), P(fake)] summing to 1.0 per row.
            Must be the same function used for inference.
        num_features : int
            Maximum number of words to highlight in the explanation.

        Returns
        -------
        dict with keys:
            method      : "LIME"
            top_words   : list of {"word": str, "weight": float, "direction": str}
                          sorted by |weight| descending.
                          Positive weight → word pushes toward the top label.
                          Negative weight → word pushes against the top label.
            predicted_label : "real" | "fake"
            num_samples : int (how many perturbations were used)
            note        : brief methodology note
        """
        exp = self._lime.explain_instance(
            text,
            predict_fn,
            num_features=num_features,
            num_samples=self.num_samples,
            top_labels=1,
        )

        # available_labels() returns labels in descending score order; index 0
        # is the top predicted label.
        top_label_idx = exp.available_labels()[0]
        predicted_label = CLASS_NAMES[top_label_idx]

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
            "method": "LIME",
            "top_words": top_words,
            "predicted_label": predicted_label,
            "num_samples": self.num_samples,
            "note": (
                "Word-level importance scores. Positive weight = word supports "
                f"the '{predicted_label}' classification; negative = opposes it."
            ),
        }
