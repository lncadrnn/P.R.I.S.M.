"""
PRISM FastAPI inference server.

Run from the api/ directory:
    python main.py

Routes:
    GET  /health          -- liveness check
    GET  /fetch-url       -- scrape text + image from a URL
    POST /scan/text       -- text-only verdict (VerdictResponse)
    POST /scan/image      -- image-only verdict (VerdictResponse)
    POST /scan/video      -- video-only verdict (VerdictResponse)
    POST /scan            -- multimodal verdict (ScanResponse)
"""

import io
import os
import tempfile
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image

from modules.image import ImageDetector
from modules.text import TextDetector
from modules.video import VideoDetector
from fusion import fuse
from schemas.verdict import ScanResponse, VerdictResponse


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
    version="0.1.0",
    description="Multimodal disinformation detection — image, text, and video modules active",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten to extension origin in production
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class TextScanRequest(BaseModel):
    text: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "modules": {"image": "active", "text": "active", "video": "active"},
    }


_SCRAPE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

_OG = lambda soup, prop: (  # noqa: E731
    (soup.find("meta", property=prop) or {}).get("content", "").strip()
)


@app.get("/fetch-url")
async def fetch_url(url: str = Query(..., description="Public URL to scrape")):
    """
    Scrape Open Graph text and image from any public URL.
    Works best with news articles and public social media posts.
    Returns {text, image_url} — both may be empty strings if the page blocks bots.
    """
    try:
        async with httpx.AsyncClient(
            headers=_SCRAPE_HEADERS, follow_redirects=True, timeout=12
        ) as client:
            resp = await client.get(url)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach URL: {exc}")

    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"URL returned HTTP {resp.status_code}",
        )

    soup = BeautifulSoup(resp.content, "html.parser")

    # --- Text: prefer og:description, fall back to og:title, then <title>
    text = (
        _OG(soup, "og:description")
        or _OG(soup, "og:title")
        or (soup.find("title") or {}).get_text("", strip=True)
    )

    # --- Image: og:image
    image_url = _OG(soup, "og:image")

    return {"text": text, "image_url": image_url}


@app.post("/scan/text", response_model=VerdictResponse)
async def scan_text(body: TextScanRequest):
    """Text-only fake news detection using XLM-RoBERTa fine-tuned on Filipino/Taglish news."""
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="Request body must include a non-empty 'text' field")
    return text_detector.predict(body.text)


@app.post("/scan/image", response_model=VerdictResponse)
async def scan_image(file: UploadFile = File(...)):
    """Image-only AI-generated image detection using CNN-ViT hybrid."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload must be an image file")
    raw = await file.read()
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=422, detail="Could not decode image")
    return detector.predict(image)


@app.post("/scan/video", response_model=VerdictResponse)
async def scan_video(file: UploadFile = File(...)):
    """
    Video-only deepfake detection using ELA + optical-flow forensics.

    Accepts any video container supported by OpenCV (mp4, avi, mov, mkv, webm).
    The file is written to a temporary path on disk, analysed, then deleted.
    """
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Upload must be a video file")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Uploaded video file is empty")

    original_name = file.filename or "upload.mp4"
    ext = os.path.splitext(original_name)[-1] or ".mp4"

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
    verdicts: dict = {"image": None, "text": None, "video": None}

    if image:
        raw = await image.read()
        try:
            img = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception:
            raise HTTPException(status_code=422, detail="Could not decode image")
        verdicts["image"] = detector.predict(img)

    if text:
        verdicts["text"] = text_detector.predict(text)

    if video:
        raw = await video.read()
        if raw:
            original_name = video.filename or "upload.mp4"
            ext = os.path.splitext(original_name)[-1] or ".mp4"
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                tmp.write(raw)
                tmp_path = tmp.name
            try:
                verdicts["video"] = video_detector.predict(tmp_path)
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    return fuse(verdicts)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
