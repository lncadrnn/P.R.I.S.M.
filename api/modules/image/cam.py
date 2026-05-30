"""
GradCAM implementation for the CNN branch of CNNViTHybrid.

Hooks into the target layer's forward/backward passes to produce a spatial
heatmap showing which image regions most influenced the prediction.
The heatmap is returned as a base64-encoded PNG overlay for the XAI payload.
"""

import io
import base64
import numpy as np
import cv2
import torch
import torch.nn as nn
from PIL import Image


class GradCAM:
    def __init__(self, target_layer: nn.Module):
        self._activations: torch.Tensor | None = None
        self._gradients: torch.Tensor | None = None

        target_layer.register_forward_hook(self._fwd_hook)
        target_layer.register_full_backward_hook(self._bwd_hook)

    def _fwd_hook(self, _module, _input, output):
        self._activations = output.detach()

    def _bwd_hook(self, _module, _grad_in, grad_out):
        self._gradients = grad_out[0].detach()

    def generate(self) -> np.ndarray | None:
        if self._gradients is None or self._activations is None:
            return None
        weights = self._gradients.mean(dim=(2, 3), keepdim=True)   # (B, C, 1, 1)
        cam = (weights * self._activations).sum(dim=1, keepdim=True)  # (B, 1, H, W)
        cam = torch.relu(cam).squeeze().cpu().numpy()                 # (H, W)
        lo, hi = cam.min(), cam.max()
        if hi > lo:
            cam = (cam - lo) / (hi - lo)
        return cam

    def reset(self):
        self._activations = None
        self._gradients = None


def cam_to_heatmap_b64(cam: np.ndarray, original_image: Image.Image) -> str:
    """
    Blend a GradCAM heatmap onto the original image and return as base64 PNG.
    """
    w, h = original_image.size
    cam_resized = cv2.resize(cam, (w, h))
    heatmap = cv2.applyColorMap(np.uint8(255 * cam_resized), cv2.COLORMAP_JET)
    heatmap = cv2.cvtColor(heatmap, cv2.COLOR_BGR2RGB)

    orig_np = np.array(original_image.convert("RGB"))
    blended = cv2.addWeighted(orig_np, 0.55, heatmap, 0.45, 0)

    buf = io.BytesIO()
    Image.fromarray(blended).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")
