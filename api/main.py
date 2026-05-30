"""
PRISM FastAPI inference server.

Run from the api/ directory:
    python main.py

Routes:
    GET  /health          -- liveness check
    POST /scan/text       -- text-only verdict (VerdictResponse)
    POST /scan/image      -- image-only verdict (VerdictResponse)
    POST /scan/video      -- video-only verdict (VerdictResponse)
    POST /scan            -- multimodal verdict (ScanResponse)
    POST /scan/extension  -- JSON multimodal verdict for the browser extension
"""

import io
import ipaddress
import os
import socket
import tempfile
from contextlib import asynccontextmanager
from typing import Callable, Optional
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from PIL import Image

from modules.image import ImageDetector
from modules.text import TextDetector
from modules.video import VideoDetector
from fusion import fuse
from schemas.verdict import ScanResponse, VerdictResponse


# ---------------------------------------------------------------------------
# Limits & config
# ---------------------------------------------------------------------------

MAX_IMAGE_BYTES = 10 * 1024 * 1024    # 10 MB cap on any image (upload or fetch)
MAX_VIDEO_BYTES = 100 * 1024 * 1024   # 100 MB cap on uploaded video
FETCH_TIMEOUT = 10                    # seconds for remote image fetch

_SCRAPE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

detector: Optional[ImageDetector] = None
text_detector: Optional[TextDetector] = None
video_detector: Optional[VideoDetector] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global detector, text_detector, video_detector
    detector = ImageDetector()
    text_detector = TextDetector()
    video_detector = VideoDetector()
    yield
    detector = None
    text_detector = None
    video_detector = None


app = FastAPI(
    title="PRISM API",
    version="0.2.0",
    description="Multimodal disinformation detection — image, text, and video modules",
    lifespan=lifespan,
)

# Least-privilege CORS: only the local web app and any Chrome extension origin.
# (The unpacked extension's ID is install-specific, so allow the scheme via regex
# rather than the wildcard "*" the audit flagged.)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://.*|moz-extension://.*|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def _unhandled_exception(request: Request, exc: Exception):
    """Never leak a stack trace to the client."""
    print(f"[PRISM] Unhandled error on {request.url.path}: {exc!r}")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class TextScanRequest(BaseModel):
    text: str


class ExtensionScanRequest(BaseModel):
    text: Optional[str] = None
    image_urls: Optional[list[str]] = None
    platform: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_ready(*detectors) -> None:
    """503 if any required detector has not finished loading."""
    if any(d is None for d in detectors):
        raise HTTPException(status_code=503, detail="Models are still loading; retry shortly")


def _safe_predict(fn: Callable, *args):
    """
    Run a module's predict() and degrade to None on failure so one broken
    modality does not 500 the whole multimodal request (fusion handles None).
    """
    try:
        return fn(*args)
    except Exception as exc:  # noqa: BLE001 — deliberate per-module isolation
        print(f"[PRISM] module predict failed: {exc!r}")
        return None


async def _read_upload_capped(upload: UploadFile, max_bytes: int) -> bytes:
    """Read an UploadFile, rejecting anything over max_bytes with 413."""
    data = bytearray()
    while True:
        chunk = await upload.read(1 << 16)
        if not chunk:
            break
        data.extend(chunk)
        if len(data) > max_bytes:
            raise HTTPException(status_code=413, detail="File too large")
    return bytes(data)


def _is_public_http_url(url: str) -> bool:
    """
    SSRF guard: only http(s) URLs whose every resolved address is public.
    Blocks loopback, private, link-local, reserved, and multicast ranges so a
    caller cannot make the server fetch internal/metadata endpoints.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except Exception:
        return False
    for info in infos:
        try:
            addr = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if (addr.is_private or addr.is_loopback or addr.is_link_local
                or addr.is_reserved or addr.is_multicast or addr.is_unspecified):
            return False
    return True


async def _fetch_image_capped(client: httpx.AsyncClient, url: str) -> Optional[bytes]:
    """Stream-fetch a remote image, enforcing content-type and the size cap."""
    async with client.stream("GET", url) as resp:
        if resp.status_code != 200:
            return None
        if not resp.headers.get("content-type", "").startswith("image/"):
            return None
        data = bytearray()
        async for chunk in resp.aiter_bytes():
            data.extend(chunk)
            if len(data) > MAX_IMAGE_BYTES:
                return None
        return bytes(data)


def _decode_image(raw: bytes) -> Image.Image:
    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=422, detail="Could not decode image")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    """Friendly landing payload so the bare API URL isn't a bare 404."""
    return {
        "name": "PRISM API",
        "description": "Multimodal disinformation detection — text, image, video",
        "docs": "/docs",
        "health": "/health",
        "endpoints": ["/scan", "/scan/text", "/scan/image", "/scan/video", "/scan/extension"],
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "modules": {
            "image": "ready" if detector is not None else "loading",
            "text": "ready" if text_detector is not None else "loading",
            "video": "ready" if video_detector is not None else "loading",
        },
    }


@app.post("/scan/extension", response_model=ScanResponse)
async def scan_extension(body: ExtensionScanRequest):
    """
    JSON endpoint for the browser extension.
    Accepts text and a list of image URLs already loaded in the browser.
    Fetches the first usable, SSRF-safe image server-side and runs all modules.
    """
    _require_ready(text_detector, detector)

    has_text = bool(body.text and body.text.strip())
    has_images = bool(body.image_urls)
    if not has_text and not has_images:
        raise HTTPException(status_code=400, detail="Provide 'text' and/or 'image_urls'")

    verdicts: dict = {"image": None, "text": None, "video": None}

    if has_text:
        verdicts["text"] = _safe_predict(text_detector.predict, body.text.strip())

    if has_images:
        async with httpx.AsyncClient(
            headers=_SCRAPE_HEADERS, timeout=FETCH_TIMEOUT, follow_redirects=True
        ) as client:
            for url in body.image_urls[:3]:
                if not _is_public_http_url(url):
                    continue
                try:
                    raw = await _fetch_image_capped(client, url)
                except Exception:
                    continue
                if not raw:
                    continue
                try:
                    img = Image.open(io.BytesIO(raw)).convert("RGB")
                except Exception:
                    continue
                verdicts["image"] = _safe_predict(detector.predict, img)
                break

    return fuse(verdicts)


@app.post("/scan/text", response_model=VerdictResponse)
async def scan_text(body: TextScanRequest):
    """Text-only fake news detection (fine-tuned Filipino/Taglish XLM-RoBERTa)."""
    _require_ready(text_detector)
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="Request body must include a non-empty 'text' field")
    return text_detector.predict(body.text)


@app.post("/scan/image", response_model=VerdictResponse)
async def scan_image(file: UploadFile = File(...)):
    """Image-only AI-generated image detection (CNN-ViT hybrid + GradCAM)."""
    _require_ready(detector)
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload must be an image file")
    raw = await _read_upload_capped(file, MAX_IMAGE_BYTES)
    image = _decode_image(raw)
    return detector.predict(image)


@app.post("/scan/video", response_model=VerdictResponse)
async def scan_video(file: UploadFile = File(...)):
    """
    Video-only deepfake detection using ELA + optical-flow forensics.

    Accepts any video container supported by OpenCV (mp4, avi, mov, mkv, webm).
    The file is written to a temporary path on disk, analysed, then deleted.
    """
    _require_ready(video_detector)
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Upload must be a video file")

    raw = await _read_upload_capped(file, MAX_VIDEO_BYTES)
    if not raw:
        raise HTTPException(status_code=422, detail="Uploaded video file is empty")

    ext = os.path.splitext(file.filename or "upload.mp4")[-1] or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name

    try:
        result = video_detector.predict(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return result


@app.post("/scan", response_model=ScanResponse)
async def scan(
    image: UploadFile = File(None),
    text: str = Form(None),
    video: UploadFile = File(None),
):
    """
    Multimodal scan. Send whichever modalities are present in the post.
    Absent modalities are excluded from the fused score; weights are re-normalised.
    """
    _require_ready(detector, text_detector, video_detector)

    has_text = bool(text and text.strip())
    if not image and not has_text and not video:
        raise HTTPException(status_code=400, detail="Provide at least one of: image, text, video")

    verdicts: dict = {"image": None, "text": None, "video": None}

    if image:
        raw = await _read_upload_capped(image, MAX_IMAGE_BYTES)
        img = _decode_image(raw)
        verdicts["image"] = _safe_predict(detector.predict, img)

    if has_text:
        verdicts["text"] = _safe_predict(text_detector.predict, text)

    if video:
        raw = await _read_upload_capped(video, MAX_VIDEO_BYTES)
        if raw:
            ext = os.path.splitext(video.filename or "upload.mp4")[-1] or ".mp4"
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                tmp.write(raw)
                tmp_path = tmp.name
            try:
                verdicts["video"] = _safe_predict(video_detector.predict, tmp_path)
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    return fuse(verdicts)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
