"""
TextClassifier: HuggingFace sequence classification wrapper for Filipino fake news detection.

Architecture:
  Model — iceman2434/xlm-roberta-base-fake-news-detection-tl
          XLM-RoBERTa-base fine-tuned on ~18.5k Filipino/Taglish news samples
          (combined jcblaise + SEACrowd datasets). Ships a TRAINED 2-class head,
          so it gives genuine fake/real predictions out of the box — no local
          training required. Reported accuracy ~95%, F1 ~95%.

The model handles Taglish (code-switched Filipino/English) natively via
XLM-RoBERTa's multilingual SentencePiece tokenizer.

NOTE: This is the inference default. For training your own model from scratch,
the training scripts use a separate backbone (see training/text/) — that path
fine-tunes jcblaise/roberta-tagalog-base on FakeNewsNet/Vera Files and writes
models/text_detector.pt, which TextDetector will load in preference to this hub
checkpoint when present.
"""

import torch
import torch.nn as nn
from transformers import AutoModelForSequenceClassification, AutoTokenizer


# Fine-tuned Filipino/Taglish fake-news classifier with a TRAINED head.
# from_pretrained loads its existing 2-class weights directly — do not bolt on
# a fresh randomly-initialised head (that is what made predictions random before).
MODEL_ID = "iceman2434/xlm-roberta-base-fake-news-detection-tl"
MAX_LENGTH = 256

# Binary classification. The fake-class index is read from the model's own
# config.id2label at load time (see TextClassifier.fake_index), not assumed.
NUM_LABELS = 2


class TextClassifier(nn.Module):
    """
    Thin wrapper around AutoModelForSequenceClassification.

    Parameters
    ----------
    model_id : str
        HuggingFace model/tokenizer identifier.
    freeze_backbone : bool
        If True, only the classification head parameters require gradients.
        Useful for the warmup phase of two-phase fine-tuning.
    """

    def __init__(
        self,
        model_id: str = MODEL_ID,
        freeze_backbone: bool = False,
    ):
        super().__init__()
        self.model_id = model_id
        self.max_length = MAX_LENGTH

        self.transformer = AutoModelForSequenceClassification.from_pretrained(
            model_id,
            num_labels=NUM_LABELS,
            ignore_mismatched_sizes=False,
        )

        if freeze_backbone:
            # Freeze every parameter except the classifier head.
            # The head attribute name varies by model family; for XLM-RoBERTa
            # it is `classifier`; fall back to freezing the full backbone body.
            for name, param in self.transformer.named_parameters():
                if not name.startswith("classifier"):
                    param.requires_grad = False

    def fake_index(self) -> int:
        """
        Return the logit index corresponding to the 'fake' class.

        Reads the model's own config.id2label rather than assuming a fixed
        order, so a checkpoint trained with either label convention works.
        Falls back to index 1 when labels are generic (LABEL_0/LABEL_1).
        """
        id2label = getattr(self.transformer.config, "id2label", None) or {}
        for idx, label in id2label.items():
            if "fake" in str(label).lower() or "false" in str(label).lower():
                return int(idx)
        return 1  # convention: 0 = real, 1 = fake

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: torch.Tensor,
    ) -> torch.Tensor:
        """
        Parameters
        ----------
        input_ids : (B, L)
        attention_mask : (B, L)

        Returns
        -------
        logits : (B, 2)   — raw (un-softmaxed) scores for [real, fake]
        """
        outputs = self.transformer(
            input_ids=input_ids,
            attention_mask=attention_mask,
        )
        return outputs.logits  # (B, 2)

    def unfreeze(self):
        """Unfreeze all parameters for end-to-end fine-tuning (phase 2)."""
        for param in self.transformer.parameters():
            param.requires_grad = True


def load_tokenizer(model_id: str = MODEL_ID) -> AutoTokenizer:
    """Return the SentencePiece tokenizer associated with the model."""
    return AutoTokenizer.from_pretrained(model_id)
