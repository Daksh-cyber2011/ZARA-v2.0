"""
MYRAA Desktop Control Agent — window management.

minimizeWindow / maximizeWindow / closeWindow target the active window or the
best title match; switchApplication focuses a named window or cycles Alt+Tab.
"""
from __future__ import annotations

import platform
import time
from typing import Any, Dict, Optional

from .registry import ToolError, register

if platform.system() == "Windows":
    import win32con
    import win32gui


def _foreground() -> Optional[int]:
    try:
        return win32gui.GetForegroundWindow() or None
    except Exception:
        return None


def _find_window(title: Optional[str]) -> int:
    """Resolve a target hwnd: exact active window when no title is given."""
    if platform.system() != "Windows":
        raise ToolError("Window management is only supported on Windows.")
    if not title:
        hwnd = _foreground()
        if not hwnd:
            raise ToolError("Could not identify the active window.")
        return hwnd

    needle = str(title).lower().strip()
    matches: list[int] = []

    def _enum(hwnd, _acc):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        window_title = win32gui.GetWindowText(hwnd)
        if window_title and needle in window_title.lower():
            matches.append(hwnd)
        return True

    win32gui.EnumWindows(_enum, None)
    if not matches:
        raise ToolError(f"No visible window matched '{title}'.")
    return matches[0]


def _focus(hwnd: int) -> None:
    try:
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
        time.sleep(0.12)
    except Exception:
        pass


@register("minimizeWindow")
def minimize_window(args: Dict[str, Any]) -> Dict[str, Any]:
    hwnd = _find_window(args.get("title"))
    _focus(hwnd)
    win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
    return {"result": f"Minimized '{win32gui.GetWindowText(hwnd) or 'window'}'."}


@register("maximizeWindow")
def maximize_window(args: Dict[str, Any]) -> Dict[str, Any]:
    hwnd = _find_window(args.get("title"))
    _focus(hwnd)
    win32gui.ShowWindow(hwnd, win32con.SW_MAXIMIZE)
    return {"result": f"Maximized '{win32gui.GetWindowText(hwnd) or 'window'}'."}


@register("closeWindow")
def close_window(args: Dict[str, Any]) -> Dict[str, Any]:
    hwnd = _find_window(args.get("title"))
    _focus(hwnd)
    win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
    return {"result": f"Closed '{win32gui.GetWindowText(hwnd) or 'window'}'."}


@register("switchApplication")
def switch_application(args: Dict[str, Any]) -> Dict[str, Any]:
    title = args.get("title")
    if platform.system() != "Windows":
        raise ToolError("Application switching is only supported on Windows.")
    if title:
        hwnd = _find_window(title)
        _focus(hwnd)
        return {"result": f"Switched to '{win32gui.GetWindowText(hwnd)}'."}
    try:
        import pyautogui

        pyautogui.hotkey("alt", "tab")
        return {"result": "Cycled to the next window with Alt+Tab."}
    except Exception as error:
        raise ToolError(f"Could not switch applications: {error}") from error


__all__ = ["minimize_window", "maximize_window", "close_window", "switch_application"]
