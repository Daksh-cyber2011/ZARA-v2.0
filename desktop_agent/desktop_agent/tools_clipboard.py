"""
MYRAA Desktop Control Agent — clipboard operations.

copySelected sends Ctrl+C and reads back the clipboard; pasteClipboard writes
the clipboard (when text is supplied) then sends Ctrl+V.  Logging never
includes clipboard contents.
"""
from __future__ import annotations

import time
from typing import Any, Dict

from .registry import ToolError, register
from .tools_input import _observation, _pyautogui


def _read_clipboard() -> str:
    if clipboard_backend() is not None:
        return clipboard_backend()()
    raise ToolError("Clipboard access is unavailable on this system.")


def _write_clipboard(text: str) -> None:
    backend = clipboard_backend(write=True)
    if backend is None:
        raise ToolError("Clipboard access is unavailable on this system.")
    backend(text)


def clipboard_backend(write: bool = False):
    """Return a read/write callable for the platform clipboard, or None."""
    try:
        import pyperclip

        return pyperclip.paste if not write else pyperclip.copy
    except ImportError:
        pass
    try:
        import tkinter

        root = tkinter.Tk()
        root.withdraw()

        def _read() -> str:
            return root.clipboard_get()

        def _write(text: str) -> None:
            root.clipboard_clear()
            root.clipboard_append(text)
            root.update()

        root.destroy()
        return _read if not write else _write
    except Exception:
        return None


@register("copySelected")
def copy_selected(args: Dict[str, Any]) -> Dict[str, Any]:
    wait = max(0.05, min(2.0, float(args.get("wait") or 0.35)))
    gui = _pyautogui()
    gui.hotkey("ctrl", "c")
    time.sleep(wait)
    text = _read_clipboard()
    if not text:
        return {"result": "Clipboard is empty after copying; there may be nothing selected.", "chars": 0}
    return {"result": f"Copied {len(text)} characters to the clipboard.", "chars": len(text), "text": text[:2000]}


@register("pasteClipboard")
def paste_clipboard(args: Dict[str, Any]) -> Dict[str, Any]:
    text = args.get("text")
    if isinstance(text, str) and text:
        _write_clipboard(text)
    gui = _pyautogui()
    gui.hotkey("ctrl", "v")
    return {"result": "Pasted the clipboard into the active input.", "observation": _observation()}


@register("getClipboard")
def get_clipboard(args: Dict[str, Any]) -> Dict[str, Any]:
    max_chars = max(1, min(100_000, int(args.get("max_chars") or 1000)))
    text = _read_clipboard()
    if not text:
        return {"result": "The clipboard is empty."}
    return {"result": text[:max_chars], "chars": len(text), "truncated": len(text) > max_chars}


@register("clearClipboard")
def clear_clipboard(_args: Dict[str, Any]) -> Dict[str, Any]:
    _write_clipboard("")
    return {"result": "Clipboard cleared."}


__all__ = ["copy_selected", "paste_clipboard", "get_clipboard", "clear_clipboard"]
