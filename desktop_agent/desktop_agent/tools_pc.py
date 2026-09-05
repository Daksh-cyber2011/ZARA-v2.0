"""
PC control: system volume and (gated) power actions.

Volume:
  Uses pycaw + comtypes for precise scalar control on Windows when available,
  with a graceful media-key fallback (VK_VOLUME_UP/DOWN/MUTE via keybd_event)
  through pyautogui.

Power:
  shutdown / restart / sleep / lock are DANGEROUS and require the two-step
  confirmation flow (tools_confirmation). `executePowerAction` consumes the
  token before running anything destructive.
"""
from __future__ import annotations

import ctypes
import os
import platform
import subprocess
import time
from typing import Any, Dict, Optional

from .registry import ToolError, register
from .tools_confirmation import ACTION_LABEL, DANGEROUS_ACTIONS, consume_token

_vol_backend = None
_vol_backend_failed = False


def _init_pycaw():
    """Return an IAudioEndpointVolume COM interface, or None."""
    global _vol_backend, _vol_backend_failed
    if _vol_backend is not None:
        return _vol_backend
    if _vol_backend_failed:
        return None
    try:
        from ctypes import POINTER, cast

        import comtypes
        from comtypes import CLSCTX_ALL
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

        devices = AudioUtilities.GetSpeakers()
        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        volume = cast(interface, POINTER(IAudioEndpointVolume))
        _vol_backend = volume
        return volume
    except Exception:
        _vol_backend_failed = True
        return None


def _get_volume_interface():
    return _init_pycaw()


_VOL_CACHE: Dict[str, Any] = {}


def _current_volume() -> float:
    """Returns current master volume in 0.0..1.0 (best effort)."""
    backend = _get_volume_interface()
    if backend is not None:
        try:
            scalar, _ = backend.GetMasterVolumeLevelScalar()
            return float(scalar)
        except Exception:
            pass
    if platform.system() == "Windows":
        try:
            # Fallback probe via keyboard stepping is unreliable to read; the
            # media-key path below adjusts relative to an assumed 0.5 anchor.
            return float(_VOL_CACHE.get("assumed", 0.5))
        except Exception:
            return 0.5
    return 0.5


def _set_volume_scalar(value: float) -> bool:
    value = max(0, min(1, float(value)))
    backend = _get_volume_interface()
    if backend is not None:
        try:
            backend.SetMasterVolumeLevelScalar(value, None)
            _VOL_CACHE["assumed"] = value
            return True
        except Exception:
            return False
    return False


VK_VOLUME_MUTE = 173
VK_VOLUME_UP = 175
VK_VOLUME_DOWN = 174
KEYEVENTF_KEYUP = 2


def _press_vk(vk: int) -> None:
    try:
        ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
        time.sleep(0.03)
        ctypes.windll.user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
    except Exception:
        try:
            import pyautogui

            if vk == VK_VOLUME_UP:
                pyautogui.press("volumeup")
            elif vk == VK_VOLUME_DOWN:
                pyautogui.press("volumedown")
            elif vk == VK_VOLUME_MUTE:
                pyautogui.press("volumemute")
        except Exception:
            raise ToolError("Volume control is unavailable on this system.")


def _set_volume_via_keys(target: float) -> None:
    """Approximate target volume by stepping media keys. Coarse but reliable."""
    current = _current_volume()
    diff = target - current
    steps = int(abs(diff) / 0.02) + 1
    vk = VK_VOLUME_UP if diff > 0 else VK_VOLUME_DOWN
    for _ in range(min(steps, 50)):
        _press_vk(vk)
        time.sleep(0.01)
    _VOL_CACHE["assumed"] = target


def _toggle_mute_pycaw() -> Optional[bool]:
    """Returns True when now muted, False when unmuted, None when unknown."""
    backend = _get_volume_interface()
    if backend is None:
        try:
            _press_vk(VK_VOLUME_MUTE)
            return None
        except Exception:
            return None
    try:
        muted = bool(backend.GetMute())
        backend.SetMute(not muted, None)
        return not muted
    except Exception:
        return None


@register("volumeUp")
def volume_up(args: Dict[str, Any]) -> Dict[str, Any]:
    step = float(args.get("amount") or 0.1)
    new = min(1, _current_volume() + step)
    if not _set_volume_scalar(new):
        _set_volume_via_keys(new)
    return {"result": f"Volume increased to {int(new * 100)}%."}


@register("volumeDown")
def volume_down(args: Dict[str, Any]) -> Dict[str, Any]:
    step = float(args.get("amount") or 0.1)
    new = max(0, _current_volume() - step)
    if not _set_volume_scalar(new):
        _set_volume_via_keys(new)
    return {"result": f"Volume decreased to {int(new * 100)}%."}


@register("setVolume")
def set_volume(args: Dict[str, Any]) -> Dict[str, Any]:
    if "percent" in args:
        pct = float(args["percent"])
    elif "level" in args:
        pct = float(args["level"])
    else:
        raise ToolError("Parameter 'percent' (0-100) is required.")
    pct = max(0, min(100, pct))
    if not _set_volume_scalar(pct / 100.0):
        _set_volume_via_keys(pct / 100.0)
    return {"result": f"Volume set to {int(pct)}%."}


@register("muteToggle")
def mute_toggle(args: Dict[str, Any]) -> Dict[str, Any]:
    muted = _toggle_mute_pycaw()
    if muted is True:
        return {"result": "Muted."}
    if muted is False:
        return {"result": "Unmuted."}
    return {"result": "Toggled mute."}


def _run_power(action: str) -> str:
    """Execute the actual OS power command. Caller must have confirmed first."""
    system = platform.system()
    if action == "lock":
        if system == "Windows":
            ctypes.windll.user32.LockWorkStation()
            return "Computer locked."
        return "Lock is only configured for Windows."
    if action == "sleep":
        if system == "Windows":
            os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
            return "Computer going to sleep."
        subprocess.run(["systemctl", "suspend"], check=False)
        return "Computer going to sleep."
    if action == "restart":
        if system == "Windows":
            subprocess.run(["shutdown", "/r", "/t", "5"], check=False)
            return "Computer restarting in 5 seconds."
        subprocess.run(["shutdown", "-r", "now"], check=False)
        return "Computer restarting."
    if action == "shutdown":
        if system == "Windows":
            subprocess.run(["shutdown", "/s", "/t", "10"], check=False)
            return "Computer shutting down in 10 seconds."
        subprocess.run(["shutdown", "-h", "now"], check=False)
        return "Computer shutting down."
    raise ToolError(f"Unknown power action '{action}'.")


@register("executePowerAction")
def execute_power_action(args: Dict[str, Any]) -> Dict[str, Any]:
    action = str(args.get("action") or "").strip().lower()
    token = str(args.get("execute_token") or args.get("confirmation_id") or "")
    if action not in DANGEROUS_ACTIONS:
        raise ToolError(
            f"Unknown power action '{action}'. Valid: {', '.join(sorted(DANGEROUS_ACTIONS))}."
        )
    consume_token(action, token)
    msg = _run_power(action)
    return {"result": msg, "action": action}


@register("requestPowerAction")
def request_power_action(args: Dict[str, Any]) -> Dict[str, Any]:
    from .tools_confirmation import issue_token

    return issue_token(str(args.get("action") or ""))


_cancel = lambda args: subprocess.run(["shutdown", "/a"], check=False) or {
    "result": "Cancelled pending shutdown/restart timer."
}

_sbc = None


def _brightness_backend():
    """Return the screen_brightness_control module, or None if unavailable."""
    global _sbc
    if _sbc is not None:
        return _sbc
    try:
        import screen_brightness_control as sbc

        _sbc = sbc
        return sbc
    except Exception:
        return None


def _current_brightness() -> int:
    sbc = _brightness_backend()
    if sbc is None:
        raise ToolError("Brightness control is unavailable on this system.")
    try:
        return int(sbc.get_brightness()[0])
    except Exception as error:
        raise ToolError(f"Could not read brightness: {error}") from error


def _set_brightness(pct: float) -> int:
    pct = max(0, min(100, pct))
    sbc = _brightness_backend()
    if sbc is None:
        raise ToolError("Brightness control is unavailable on this system.")
    try:
        sbc.set_brightness(int(round(pct)))
        return int(pct)
    except Exception as error:
        raise ToolError(f"Could not set brightness: {error}") from error


@register("brightnessUp")
def brightness_up(args: Dict[str, Any]) -> Dict[str, Any]:
    step = float(args.get("amount") or 10)
    current = _current_brightness()
    new = _set_brightness(current + step)
    return {"result": f"Brightness increased to {new}%.", "brightness": new}


@register("brightnessDown")
def brightness_down(args: Dict[str, Any]) -> Dict[str, Any]:
    step = float(args.get("amount") or 10)
    current = _current_brightness()
    new = _set_brightness(current - step)
    return {"result": f"Brightness decreased to {new}%.", "brightness": new}


@register("setBrightness")
def set_brightness(args: Dict[str, Any]) -> Dict[str, Any]:
    if "percent" in args:
        pct = float(args["percent"])
    elif "level" in args:
        pct = float(args["level"])
    else:
        raise ToolError("Parameter 'percent' (0-100) is required.")
    new = _set_brightness(pct)
    return {"result": f"Brightness set to {new}%.", "brightness": new}


__all__ = [
    "volume_up",
    "volume_down",
    "set_volume",
    "mute_toggle",
    "execute_power_action",
    "request_power_action",
    "brightness_up",
    "brightness_down",
    "set_brightness",
]
