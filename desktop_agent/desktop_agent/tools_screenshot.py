"""
MYRAA Desktop Control Agent — screenshots and screen reading.

takeScreenshot captures the full screen; when `include_image` is true the
base64 JPEG is returned for the multimodal bridge (the Node server routes
image capture through Electron's private IPC for privacy scoping).
analyzeScreenshot / readScreen OCR the screen or the active window when a
tesseract binary is available; otherwise they fail with a clear message
instead of pretending to read text.
"""
from __future__ import annotations

import base64
import io
import os
import platform
import time
from datetime import datetime
from typing import Any, Dict, Optional

from .registry import ToolError, register
from .tools_input import _active_window


def _capture_image(max_dim: int = 1280) -> tuple[bytes, int, int]:
    """Capture the primary screen; returns (jpeg_bytes, width, height)."""
    try:
        import mss
        from PIL import Image

        with mss.mss() as sct:
            frame = sct.grab(sct.monitors[1])
            image = Image.frombytes("RGB", frame.size, frame.bgra, "raw", "BGRX")
    except ImportError as error:
        raise ToolError("Screenshot capture requires the mss and pillow packages.") from error

    width, height = image.size
    if max(image.size) > max_dim:
        ratio = max_dim / max(image.size)
        image = image.resize((max(1, int(width * ratio)), max(1, int(height * ratio))))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=72)
    return buffer.getvalue(), width, height


def _ocr_image(image_bytes: bytes, max_chars: int) -> str:
    try:
        import pytesseract
        from PIL import Image
    except ImportError as error:
        raise ToolError(
            "Screen reading requires OCR support (pillow + pytesseract with the "
            "tesseract binary installed)."
        ) from error
    image = Image.open(io.BytesIO(image_bytes))
    text = pytesseract.image_to_string(image)
    text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if not text:
        raise ToolError("No readable text was found on the screen.")
    return text[:max_chars]


@register("takeScreenshot")
def take_screenshot(args: Dict[str, Any]) -> Dict[str, Any]:
    include_image = bool(args.get("include_image", False))
    max_dim = max(320, min(1920, int(args.get("max_dim") or 1280)))
    data, width, height = _capture_image(max_dim)
    payload: Dict[str, Any] = {"result": f"Captured the screen ({width}x{height}).", "width": width, "height": height}
    if include_image:
        payload["image_base64"] = base64.b64encode(data).decode("ascii")
        payload["image_mime"] = "image/jpeg"
    return payload


@register("saveScreenshot")
def save_screenshot(args: Dict[str, Any]) -> Dict[str, Any]:
    prefix = str(args.get("name") or "myraa").strip().replace(" ", "_") or "myraa"
    home = os.path.expanduser("~")
    folder = os.path.join(home, "Pictures", "MyraaScreenshots")
    os.makedirs(folder, exist_ok=True)
    filename = f"{prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
    path = os.path.join(folder, filename)
    try:
        import mss
        from PIL import Image

        with mss.mss() as sct:
            frame = sct.grab(sct.monitors[1])
            image = Image.frombytes("RGB", frame.size, frame.bgra, "raw", "BGRX")
        image.save(path, format="PNG")
    except ImportError as error:
        raise ToolError("Screenshot capture requires the mss and pillow packages.") from error
    return {"result": f"Saved screenshot as {filename} in Pictures/MyraaScreenshots.", "path": path}


@register("analyzeScreenshot")
def analyze_screenshot(args: Dict[str, Any]) -> Dict[str, Any]:
    max_chars = max(200, min(20_000, int(args.get("max_chars") or 1500)))
    data, width, height = _capture_image(1440)
    text = _ocr_image(data, max_chars)
    return {"result": text, "width": width, "height": height}


@register("readScreen")
def read_screen(args: Dict[str, Any]) -> Dict[str, Any]:
    max_chars = max(200, min(20_000, int(args.get("max_chars") or 1500)))
    active = _active_window()
    data, _width, _height = _capture_image(1440)
    text = _ocr_image(data, max_chars)
    title = active.get("title") or "unknown window"
    return {"result": f"Active window '{title}' shows:\n{text}", "active_window": active}


@register("viewScreen")
def view_screen(args: Dict[str, Any]) -> Dict[str, Any]:
    """Capture for the AI's eyes; the bridge also pushes the frame to Gemini."""
    max_dim = max(320, min(1920, int(args.get("max_dim") or 1024)))
    keep_file = bool(args.get("keep_file", False))
    data, width, height = _capture_image(max_dim)
    active = _active_window()
    payload: Dict[str, Any] = {
        "result": f"Captured display ({width}x{height}).",
        "width": width,
        "height": height,
        "active_window": active.get("title"),
        "image_base64": base64.b64encode(data).decode("ascii"),
        "image_mime": "image/jpeg",
        "capture_backend": "mss",
    }
    if keep_file:
        temp_dir = os.path.join(os.path.expanduser("~"), "AppData", "Local", "Temp") if platform.system() == "Windows" else "/tmp"
        os.makedirs(temp_dir, exist_ok=True)
        path = os.path.join(temp_dir, f"myraa_view_{int(time.time())}.jpg")
        with open(path, "wb") as handle:
            handle.write(data)
        payload["saved_path"] = path
    return payload


__all__ = ["take_screenshot", "save_screenshot", "analyze_screenshot", "read_screen", "view_screen"]
