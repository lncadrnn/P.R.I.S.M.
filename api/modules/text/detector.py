"""
TextDetector: inference pipeline for Filipino/Taglish fake news detection.

Usage:
    detector = TextDetector()
    result = detector.predict("Ang gobyerno ay nagdeklara ng emergency.")
    # result.label        → "fake" | "real"
    # result.confidence   → P(fake) in [0, 1]
    # result.explanation  → {"method": "LIME", "top_words": [...], ...}

Model: iceman2434/xlm-roberta-base-fake-news-detection-tl
  Fine-tuned on 18,522 Filipino/Taglish news samples.
  Accuracy 95.46%, F1 95.40% (combined jcblaise + SEACrowd datasets).
"""

import os

import numpy as np
import torch
import torch.nn.functional as F

from .model import TextClassifier, load_tokenizer, MODEL_ID, MAX_LENGTH
from .explainer import LIMETextExplainer
from schemas.verdict import VerdictResponse


_MODEL_PATH_DEFAULT = os.path.join(
    os.path.dirname(__file__), "../../../models/text_detector.pt"
)


class TextDetector:
    """
    End-to-end text forensics detector.

    Parameters
    ----------
    model_path : str | None
        Path to a saved state_dict (.pt file).  Falls back to the module-
        relative default path.  If the file does not exist the model runs
        with HuggingFace pretrained weights only (demo / evaluation mode).
    device : str | None
        "cuda" or "cpu".  Auto-detected when None.
    """

    def __init__(self, model_path: str | None = None, device: str | None = None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")

        # Tokenizer — loaded from HuggingFace hub (cached after first run)
        self.tokenizer = load_tokenizer(MODEL_ID)

        # Model
        self.model = TextClassifier(model_id=MODEL_ID)
        self.model.to(self.device)

        path = model_path or _MODEL_PATH_DEFAULT
        if path and os.path.isfile(path):
            state = torch.load(path, map_location=self.device, weights_only=True)
            self.model.load_state_dict(state)
            print(f"[TextDetector] Loaded weights from {path}")
        else:
            print("[TextDetector] No weights found — running untrained model (demo only)")

        self.model.eval()

        # LIME explainer — shares the tokenizer's unk_token for masking
        self.explainer = LIMETextExplainer(
            tokenizer=self.tokenizer,
            num_samples=1500,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _tokenize(self, texts: list[str]) -> dict[str, torch.Tensor]:
        """Tokenise a batch of strings and move tensors to self.device."""
        encoded = self.tokenizer(
            texts,
            return_tensors="pt",
            truncation=True,
            padding=True,
            max_length=MAX_LENGTH,
        )
        return {k: v.to(self.device) for k, v in encoded.items()}

    @torch.no_grad()
    def _predict_proba(self, texts: list[str]) -> np.ndarray:
        """
        LIME-compatible predict function.

        Parameters
        ----------
        texts : list[str]
            Batch of (possibly perturbed) strings from LIME.

        Returns
        -------
        np.ndarray of shape (N, 2) — [P(real), P(fake)] per row.
        """
        encoded = self._tokenize(texts)
        logits = self.model(
            input_ids=encoded["input_ids"],
            attention_mask=encoded["attention_mask"],
        )  # (N, 2)
        probs = F.softmax(logits, dim=-1)
        return probs.cpu().numpy()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict(self, text: str) -> VerdictResponse:
        """
        Run fake news detection on a single text string.

        Parameters
        ----------
        text : str
            Raw news text in Filipino, English, or Taglish.

        Returns
        -------
        VerdictResponse
            label      : "fake" if P(fake) >= 0.5 else "real"
            confidence : P(fake) rounded to 4 decimal places
            explanation: LIME word-importance dict
        """
        # --- Primary inference ---
        encoded = self._tokenize([text])
        with torch.no_grad():
            logits = self.model(
                input_ids=encoded["input_ids"],
                attention_mask=encoded["attention_mask"],
            )  # (1, 2)
        probs = F.softmax(logits, dim=-1)          # (1, 2)
        fake_prob = probs[0, 1].item()             # P(fake)

        label = "fake" if fake_prob >= 0.5 else "real"

        # --- Pattern + LIME explanation ---
        explanation = self.explainer.explain(
            text,
            predict_fn=self._predict_proba,
            label=label,
            confidence=round(fake_prob, 4),
            num_features=10,
        )

        return VerdictResponse(
            label=label,
            confidence=round(fake_prob, 4),
            explanation=explanation,
        )
