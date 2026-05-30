"""
TextClassifier: HuggingFace sequence classification wrapper for Filipino fake news detection.

Architecture:
  Base — iceman2434/xlm-roberta-base-fake-news-detection-tl
         (XLM-RoBERTa fine-tuned on 18,522 Filipino/Taglish news samples)
         Reported accuracy: 95.46%, F1: 95.40%
  Head  — AutoModelForSequenceClassification (2-class: real=0, fake=1)

The model handles Taglish (code-switched Filipino/English) natively via
XLM-RoBERTa's multilingual SentencePiece tokenizer.
"""

import torch
import torch.nn as nn
from transformers import AutoModelForSequenceClassification, AutoTokenizer


# jcblaise/roberta-tagalog-large is trained on Filipino Wikipedia, CommonCrawl,
# and OSCAR corpus by DLSU-NLP — the strongest open Filipino language model.
# It has a Tagalog-specific SentencePiece vocabulary and handles Taglish
# code-switching significantly better than xlm-roberta-base.
# Fine-tune this backbone on FakeNewsNet + Vera Files for best accuracy.
MODEL_ID = "jcblaise/roberta-tagalog-large"
MAX_LENGTH = 256

# Binary classification: 0 = real, 1 = fake
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
