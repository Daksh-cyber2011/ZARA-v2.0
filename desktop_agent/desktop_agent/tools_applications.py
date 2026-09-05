"""
Universal Windows application discovery, launch, and graceful close.

Known apps still take the fast path. Unknown names are resolved from PATH,
App Paths, installed-program registry entries, Start-menu shortcuts, and UWP
Start apps. As a final human-style fallback MYRAA uses Windows Search. Closing
targets real visible windows/processes instead of rejecting names that are not
in a hard-coded allow-list.
"""
from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from .registry import ToolError, register

if platform.system() == "Windows":
    import win32con
    import win32gui
    import win32process
    import psutil


# ---------------------------------------------------------------------------
# Known-app fast paths (msrun aliases and direct executables)
# ---------------------------------------------------------------------------
_KNOWN_APPS: Dict[str, Dict[str, Any]] = {
    "notepad": {"exe": "notepad.exe"},
    "calculator": {"exe": "calc.exe"},
    "calc": {"exe": "calc.exe"},
    "paint": {"exe": "mspaint.exe"},
    "cmd": {"exe": "cmd.exe"},
    "command prompt": {"exe": "cmd.exe"},
    "powershell": {"exe": "powershell.exe"},
    "task manager": {"exe": "taskmgr.exe"},
    "file explorer": {"exe": "explorer.exe"},
    "explorer": {"exe": "explorer.exe"},
    "settings": {"exe": "ms-settings:"},
    "control panel": {"exe": "control.exe"},
    "registry editor": {"exe": "regedit.exe"},
    "charmap": {"exe": "charmap.exe"},
    "snipping tool": {"exe": "snippingtool.exe"},
    "wordpad": {"exe": "write.exe"},
    "run dialog": {"exe": None, "shell": "explorer.exe shell:::{2559a1f3-21d7-11d4-bdaf-00c04f60b9f0}"},
}


def _normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def _windows_directories() -> Iterable[Path]:
    home = Path.home()
    return [
        home / "Desktop",
        home / "AppData" / "Roaming" / "Microsoft" / "Windows" / "Start Menu",
        Path(os.environ.get("ProgramData", "C:/ProgramData")) / "Microsoft" / "Windows" / "Start Menu",
    ]


def _resolve_via_registry(name: str) -> Optional[str]:
    """Look up an App Paths or installed-programs entry for `name`."""
    if platform.system() != "Windows":
        return None
    try:
        import winreg
    except ImportError:
        return None

    candidates = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]
    lowered = name.lower()
    for hive, path in candidates:
        try:
            root = winreg.OpenKey(hive, path)
        except OSError:
            continue
        with root:
            index = 0
            while True:
                try:
                    subkey_name = winreg.EnumKey(root, index)
                except OSError:
                    break
                index += 1
                if lowered not in subkey_name.lower() and lowered not in subkey_name.lower().replace(".exe", ""):
                    continue
                try:
                    with winreg.OpenKey(root, subkey_name) as subkey:
                        value, _ = winreg.QueryValueEx(subkey, "")
                        if isinstance(value, str) and value.strip():
                            return value.strip()
                except OSError:
                    continue
    return None


def _resolve_via_start_menu(name: str) -> Optional[Path]:
    """Find the newest Start-menu shortcut whose file name contains `name`."""
    if platform.system() != "Windows":
        return None
    lowered = name.replace(" ", "")
    best: Optional[Path] = None
    for directory in _windows_directories():
        for candidate in directory.rglob("*.lnk"):
            stem = candidate.stem.lower().replace(" ", "")
            if lowered in stem:
                if best is None or candidate.stat().st_mtime > best.stat().st_mtime:
                    best = candidate
    return best


def _launch_shortcut(path: Path) -> None:
    try:
        os.startfile(str(path))  # type: ignore[attr-defined]  # Windows-only
    except Exception as error:
        raise ToolError(f"Could not open '{path.stem}': {error}") from error


def _launch_uwp(name: str) -> bool:
    """Try launching a UWP app through the shell:AppsFolder view."""
    if platform.system() != "Windows":
        return False
    try:
        output = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-StartApps | ConvertTo-Json -Compress"],
            capture_output=True, text=True, timeout=10,
        )
        import json
        data = json.loads(output.stdout or "[]")
        if isinstance(data, dict):
            data = [data]
        for app in data:
            app_name = str(app.get("Name", "")).lower()
            if name in app_name:
                app_id = app.get("AppID")
                if app_id:
                    subprocess.Popen(
                        ["explorer.exe", f"shell:AppsFolder\\{app_id}"],
                        shell=False,
                    )
                    return True
    except Exception:
        pass
    return False


def _resolve_executable(name: str) -> Optional[str]:
    """Resolve `name` through PATH + App Paths registry."""
    direct = shutil.which(name)
    if direct:
        return direct
    with_ext = shutil.which(f"{name}.exe")
    if with_ext:
        return with_ext
    return _resolve_via_registry(name)


def _open_application(name: str) -> str:
    if not name:
        raise ToolError("Parameter 'name' is required.")
    normalized = _normalize_name(name)

    known = _KNOWN_APPS.get(normalized)
    if known:
        if known.get("shell"):
            subprocess.Popen(known["shell"].split())
            return f"Opened {name}."
        target = known.get("exe")
        if isinstance(target, str) and target.endswith(":"):
            subprocess.Popen(["explorer.exe", target])
            return f"Opened {name}."
        try:
            subprocess.Popen([target])
            return f"Opened {name}."
        except Exception:
            pass  # fall through to universal discovery

    resolved = _resolve_executable(normalized)
    if resolved:
        subprocess.Popen([resolved])
        return f"Opened {name}."

    shortcut = _resolve_via_start_menu(normalized)
    if shortcut:
        _launch_shortcut(shortcut)
        return f"Opened {shortcut.stem}."

    if _launch_uwp(normalized):
        return f"Opened {name}."

    # Final human-style fallback: drive Windows Search, type the name, Enter.
    if platform.system() == "Windows":
        try:
            import pyautogui

            pyautogui.press("win")
            time.sleep(0.7)
            pyautogui.write(name, interval=0.03)
            time.sleep(0.9)
            pyautogui.press("enter")
            return f"Opened {name} through Windows Search."
        except Exception as error:
            raise ToolError(f"Could not open '{name}': {error}") from error

    raise ToolError(f"Application '{name}' was not found on this system.")


def _find_matching_windows(name: str) -> list[tuple[int, str, int]]:
    """Return (hwnd, title, pid) for visible windows matching `name`."""
    if platform.system() != "Windows":
        return []
    lowered = _normalize_name(name).replace(" ", "")
    matches: list[tuple[int, str, int]] = []

    def _enum(hwnd, _acc):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        title = win32gui.GetWindowText(hwnd)
        if not title:
            return True
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        try:
            process = psutil.Process(pid).name().lower().replace(".exe", "")
        except Exception:
            process = ""
        haystack = _normalize_name(title).replace(" ", "")
        if lowered in haystack or lowered in process:
            matches.append((hwnd, title, pid))
        return True

    win32gui.EnumWindows(_enum, None)
    return matches


def _close_application(name: str, force: bool = False) -> str:
    if not name:
        raise ToolError("Parameter 'name' is required.")
    if platform.system() != "Windows":
        raise ToolError("Application close is only supported on Windows.")

    matches = _find_matching_windows(name)
    if matches:
        for hwnd, title, _pid in matches[:5]:
            try:
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                win32gui.SetForegroundWindow(hwnd)
                time.sleep(0.15)
                if force:
                    import pyautogui

                    pyautogui.hotkey("alt", "f4")
                else:
                    win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
            except Exception:
                continue
        time.sleep(0.4)
        return f"Closed {len(matches[:5])} window(s) matching '{name}'."

    # No window: match background processes by name.
    lowered = name.lower().replace(" ", "").replace(".exe", "")
    killed = 0
    for process in psutil.process_iter(["pid", "name"]):
        pname = (process.info.get("name") or "").lower()
        if lowered and lowered in pname.replace(".exe", ""):
            if force:
                process.kill()
            else:
                process.terminate()
            killed += 1
            if killed >= 5:
                break
    if killed:
        return f"Terminated {killed} background process(es) matching '{name}'."
    raise ToolError(f"No running application or window matched '{name}'.")


@register("openApplication")
def open_application(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args.get("name") or "").strip()
    result = _open_application(name)
    return {"result": result}


@register("closeApplication")
def close_application(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args.get("name") or "").strip()
    force = bool(args.get("force", False))
    result = _close_application(name, force)
    return {"result": result}


__all__ = ["open_application", "close_application"]
