"""
PRISM FastAPI inference server.

Run from the api/ directory:
    uvicorn main:app --reload

Routes:
    GET  /health          → liveness check
    POST /scan/image      → image-only verdict (VerdictResponse)
    POST /scan            → multimodal verdict (ScanResponse)  ← text/video stubs
"""

import io
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from modules.image import ImageDetector
from fusion import fuse
from schemas.verdict import ScanResponse, VerdictResponse


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

detector: ImageDetector | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global detector
    detector = ImageDetector()
    yield
    detector = None


app = FastAPI(
    title="PRISM API",
    version="0.1.0",
    description="Multimodal disinformation detection — image module active",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten to extension origin in production
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "modules": {"image": "active", "text": "stub", "video": "stub"}}


@app.post("/scan/image", response_model=VerdictResponse)
async def scan_image(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload must be an image file")
    raw = await file.read()
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=422, detail="Could not decode image")
    return detector.predict(image)


@app.post("/scan", response_model=ScanResponse)
async def scan(
    image: UploadFile = File(None),
    text: str = Form(None),
):
    """
    Multimodal scan. Send whichever modalities are present.
    Text and video modules return None until implemented.
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
        verdicts["text"] = None  # placeholder until text module is implemented

    return fuse(verdicts)
