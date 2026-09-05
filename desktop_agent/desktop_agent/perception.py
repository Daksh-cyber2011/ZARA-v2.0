"""
MYRAA Desktop Control Agent — desktop perception (/observe).

Returns a compact desktop telemetry snapshot the Node server feeds into its
situation model: active window, visible applications, disk usage, recent
Downloads items, and Windows input-idle seconds.  Best-effort everywhere —
never raises, so a probe failure can never take the agent down.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

from .registry import ToolError


def _active_window() -> Dict[str, Any]:
    if os.name != "nt":
        return {"title": None, "application": None, "pid": None}
    try:
        import win32gui
        import win32process
        import psutil

        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return {"title": None, "application": None, "pid": None}
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        title = win32gui.GetWindowText(hwnd) or None
        application = None
        try:
            application = psutil.Process(pid).name()
        except Exception:
            pass
        return {"title": title, "application": application, "pid": int(pid)}
    except Exception:
        return {"title": None, "application": None, "pid": None}


def _visible_applications(limit: int = 12) -> List[Dict[str, Any]]:
    if os.name != "nt":
        return []
    try:
        import win32gui
        import win32process
        import psutil

        result: List[Dict[str, Any]] = []

        def _enum(hwnd, _acc):
            if not win32gui.IsWindowVisible(hwnd):
                return True
            title = win32gui.GetWindowText(hwnd)
            if not title:
                return True
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            try:
                name = psutil.Process(pid).name()
            except Exception:
                name = None
            result.append({"name": name, "title": title, "pid": int(pid)})
            return len(result) < limit

        win32gui.EnumWindows(_enum, None)
        return result
    except Exception:
        return []


def _disk_snapshot() -> Dict[str, Any] | None:
    try:
        import shutil

        usage = shutil.disk_usage(os.path.expanduser("~"))
        return {
            "path": os.path.expanduser("~"),
            "freeBytes": usage.free,
            "totalBytes": usage.total,
            "percentUsed": round(usage.used / usage.total * 100.0, 1),
        }
    except Exception:
        return None


def _recent_downloads(limit: int = 5) -> List[Dict[str, Any]]:
    downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
    items: List[Dict[str, Any]] = []
    try:
        entries = [
            os.path.join(downloads_dir, name)
            for name in os.listdir(downloads_dir)
            if not name.startswith(".")
        ]
        entries.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        now = time.time()
        for path in entries[: limit * 3]:
            try:
                stat = os.stat(path)
            except OSError:
                continue
            age_hours = (now - stat.st_mtime) / 3600.0
            if age_hours > 24:
                break
            partial = path.endswith((".crdownload", ".part", ".tmp"))
            items.append(
                {
                    "name": os.path.basename(path),
                    "path": path,
                    "size": stat.st_size,
                    "modifiedAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                    "status": "downloading" if partial else "complete",
                }
            )
            if len(items) >= limit:
                break
    except Exception:
        pass
    return items


def _user_idle_seconds() -> float:
    if os.name != "nt":
        return 0.0
    try:
        import ctypes

        class LASTINPUTINFO(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

        info = LASTINPUTINFO()
        info.cbSize = ctypes.sizeof(LASTINPUTINFO)
        if ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
            millis = ctypes.windll.kernel32.GetTickCount() - info.dwTime
            return max(0.0, millis / 1000.0)
        return 0.0
    except Exception:
        return 0.0


def collect_snapshot() -> Dict[str, Any]:
    """Build the full desktop telemetry snapshot (never raises)."""
    try:
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "activeWindow": _active_window(),
            "applications": [item.get("name") for item in _visible_applications()],
            "disk": _disk_snapshot(),
            "downloads": _recent_downloads(),
            "userIdleSeconds": round(_user_idle_seconds(), 2),
        }
    except Exception as exc:  # pragma: no cover - defensive
        raise ToolError(f"Desktop observation failed: {exc}") from exc
