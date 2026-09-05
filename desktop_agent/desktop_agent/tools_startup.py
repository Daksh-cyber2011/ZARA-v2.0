"""
MYRAA Desktop Control Agent — Windows auto-start management.

Creates/removes a per-user Run-key entry that silently launches MYRAA's
executable when Windows logs in.  MYRAA_EXECUTABLE is set by the Electron
main process for packaged builds so the entry always points at the real app.
"""
from __future__ import annotations

import os
import platform
from typing import Any, Dict

from .registry import ToolError, register

RUN_KEY_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"
MYRAA_VALUE_NAME = "MYRAA"


def _executable_path() -> str:
    candidate = os.environ.get("MYRAA_EXECUTABLE")
    if candidate:
        return candidate
    raise ToolError(
        "MYRAA_EXECUTABLE is not set; the packaged app provides it. Auto-start "
        "cannot be configured for a development run."
    )


def _open_run_key(write: bool = False):
    import winreg

    access = winreg.KEY_SET_VALUE if write else winreg.KEY_QUERY_VALUE
    return winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY_PATH, 0, access | winreg.KEY_WOW64_64KEY)


@register("enableAutoStart")
def enable_auto_start(_args: Dict[str, Any]) -> Dict[str, Any]:
    if platform.system() != "Windows":
        raise ToolError("Auto-start is only supported on Windows.")
    try:
        import winreg

        exe = _executable_path()
        with _open_run_key(write=True) as key:
            winreg.SetValueEx(key, MYRAA_VALUE_NAME, 0, winreg.REG_SZ, f'"{exe}"')
    except Exception as error:
        raise ToolError(f"Could not enable auto-start: {error}") from error
    return {"result": "MYRAA will start automatically when Windows logs in."}


@register("disableAutoStart")
def disable_auto_start(_args: Dict[str, Any]) -> Dict[str, Any]:
    if platform.system() != "Windows":
        raise ToolError("Auto-start is only supported on Windows.")
    try:
        import winreg

        with _open_run_key(write=True) as key:
            try:
                winreg.DeleteValue(key, MYRAA_VALUE_NAME)
            except FileNotFoundError:
                return {"result": "MYRAA auto-start was already disabled."}
    except Exception as error:
        raise ToolError(f"Could not disable auto-start: {error}") from error
    return {"result": "MYRAA auto-start disabled."}


@register("getAutoStartStatus")
def get_auto_start_status(_args: Dict[str, Any]) -> Dict[str, Any]:
    if platform.system() != "Windows":
        return {"result": "Auto-start is only supported on Windows.", "enabled": False}
    try:
        import winreg

        with _open_run_key() as key:
            value, _type = winreg.QueryValueEx(key, MYRAA_VALUE_NAME)
        return {"result": "MYRAA auto-start is enabled.", "enabled": True, "command": value}
    except FileNotFoundError:
        return {"result": "MYRAA auto-start is disabled.", "enabled": False}
    except Exception as error:
        raise ToolError(f"Could not read auto-start status: {error}") from error


__all__ = ["enable_auto_start", "disable_auto_start", "get_auto_start_status"]
