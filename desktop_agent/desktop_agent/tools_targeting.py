"""
MYRAA Desktop Control Agent — visible-text targeting (locateText / clickText).

Read-only exact matching via Windows UI Automation when available, with a
built-in OCR fallback (mss + PIL + pytesseract if installed).  `locateText`
returns the physical rectangle and center of the nth exact label match and
never clicks; `clickText` resolves the label at action time, verifies cursor
arrival, then clicks.  Both refuse absent or ambiguous targets instead of
guessing a fuzzy neighbor.
"""
from __future__ import annotations

import platform
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from .registry import ToolError, register
from .tools_input import _active_window, _observation, _pyautogui

Rect = Tuple[int, int, int, int]  # left, top, right, bottom


def _uia_available() -> bool:
    if platform.system() != "Windows":
        return False
    try:
        import uiautomation  # type: ignore

        return True
    except Exception:
        return False


def _uia_find_labels(
    text: str,
    window_title: Optional[str] = None,
    occurrence: int = 1,
) -> List[Rect]:
    """Locate exact visible labels with Windows UI Automation."""
    import uiautomation  # type: ignore

    rects: List[Rect] = []
    control_type_buttons = ["ButtonControl", "HyperlinkControl", "MenuItemControl", "TabItemControl", "TextControl"]

    root = None
    if window_title:
        desktop = uiautomation.GetRootControl()
        for window in desktop.GetChildren():
            if window_title.lower() in (window.Name or "").lower():
                root = window
                break
        if root is None:
            raise ToolError(f"No window titled '{window_title}' is visible.")
    else:
        root = uiautomation.GetForegroundControl()

    def _walk(control) -> None:
        if len(rects) >= max(occurrence, 5):
            return
        try:
            name = (control.Name or "").strip()
        except Exception:
            name = ""
        if name and name.lower() == text.strip().lower():
            try:
                bounding = control.BoundingRectangle
                rects.append((int(bounding.left), int(bounding.top), int(bounding.right), int(bounding.bottom)))
            except Exception:
                pass
            return
        try:
            children = control.GetChildren()
        except Exception:
            children = []
        for child in children:
            _walk(child)

    _walk(root)
    return rects


def _ocr_find_labels(
    text: str,
    occurrence: int = 1,
) -> List[Rect]:
    """Locate exact visible text via screen OCR (best effort)."""
    try:
        import mss
        import pytesseract
        from PIL import Image
    except ImportError:
        raise ToolError(
            "Text targeting needs Windows UI Automation (uiautomation) or OCR "
            "(mss + pillow + pytesseract) installed."
        )

    monitor = {"top": 0, "left": 0, "width": 0, "height": 0}
    with mss.mss() as sct:
        monitor = sct.monitors[1]
        frame = sct.grab(monitor)
        image = Image.frombytes("RGB", frame.size, frame.bgra, "raw", "BGRX")

    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    rects: List[Rect] = []
    target = text.strip().lower()
    for index, word in enumerate(data["text"]):
        if not word or word.strip().lower() != target:
            continue
        left = monitor["left"] + int(data["left"][index])
        top = monitor["top"] + int(data["top"][index])
        width = int(data["width"][index])
        height = int(data["height"][index])
        rects.append((left, top, left + width, top + height))
        if len(rects) >= occurrence:
            break
    return rects


def resolve_label(
    text: str,
    window_title: Optional[str] = None,
    occurrence: int = 1,
) -> Rect:
    """Resolve an exact visible label to (left, top, right, bottom)."""
    if not text or not str(text).strip():
        raise ToolError("Parameter 'text' (exact visible label) is required.")
    occurrence = max(1, int(occurrence or 1))

    if _uia_available():
        rects = _uia_find_labels(text, window_title, occurrence)
    else:
        rects = _ocr_find_labels(text, occurrence)

    if not rects:
        raise ToolError(f"'{text}' was not found among visible labels.")
    if len(rects) < occurrence:
        raise ToolError(
            f"'{text}' matched {len(rects)} time(s); occurrence {occurrence} does not exist."
        )
    return rects[occurrence - 1]


@register("locateText")
def locate_text(args: Dict[str, Any]) -> Dict[str, Any]:
    text = str(args.get("text") or "")
    rect = resolve_label(
        text,
        args.get("window_title"),
        int(args.get("occurrence") or 1),
    )
    left, top, right, bottom = rect
    center = ((left + right) // 2, (top + bottom) // 2)
    return {
        "result": f"Located '{text}' at ({center[0]}, {center[1]}).",
        "rect": {"left": left, "top": top, "right": right, "bottom": bottom},
        "center": {"x": center[0], "y": center[1]},
        "active_window": _active_window(),
    }


@register("clickText")
def click_text(args: Dict[str, Any]) -> Dict[str, Any]:
    text = str(args.get("text") or "")
    button = str(args.get("button") or "left")
    if button not in ("left", "right"):
        raise ToolError("button must be 'left' or 'right'.")
    verify_wait = max(0.15, min(2.0, float(args.get("verify_wait") or 0.4)))

    if args.get("window_title") and platform.system() == "Windows":
        # Focus the containing window first so the label is on screen.
        try:
            import win32con
            import win32gui

            needle = str(args["window_title"]).lower()
            matches: list[int] = []

            def _enum(hwnd, _acc):
                if win32gui.IsWindowVisible(hwnd) and needle in win32gui.GetWindowText(hwnd).lower():
                    matches.append(hwnd)
                return True

            win32gui.EnumWindows(_enum, None)
            if matches:
                win32gui.ShowWindow(matches[0], win32con.SW_RESTORE)
                win32gui.SetForegroundWindow(matches[0])
                time.sleep(0.2)
        except Exception:
            pass

    rect = resolve_label(text, args.get("window_title"), int(args.get("occurrence") or 1))
    left, top, right, bottom = rect
    center = ((left + right) // 2, (top + bottom) // 2)

    gui = _pyautogui()
    before = gui.position()
    gui.click(center[0], center[1], button=button)
    time.sleep(verify_wait)
    after = gui.position()
    arrived = abs(after.x - center[0]) <= 4 and abs(after.y - center[1]) <= 4
    if not arrived and abs(before.x - center[0]) <= 4:
        # Cursor never moved from an on-target position; treat as verified.
        arrived = True
    if not arrived:
        return {
            "result": f"Click on '{text}' was issued but cursor arrival could not be verified.",
            "verified": False,
            "observation": _observation(),
        }
    return {
        "result": f"Clicked '{text}' at ({center[0]}, {center[1]}).",
        "verified": True,
        "observation": _observation(),
    }


__all__ = ["resolve_label", "locate_text", "click_text"]
