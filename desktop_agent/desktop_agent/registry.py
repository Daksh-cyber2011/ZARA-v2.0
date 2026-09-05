"""
MYRAA Desktop Control Agent — Central tool registry.

Each tool module registers handlers into a flat dict `TOOLS` mapping
tool_name -> callable(args: dict) -> dict.

Handlers return a plain dict, typically {"result": "<status string>"}.
Errors should raise ToolError(message) so main.py can map them to {error}.
Shared state such as confirmation tokens lives on the `State` object so
handlers stay stateless and easy to test.
"""
from __future__ import annotations

import importlib
import threading
from typing import Any, Callable, Dict


class ToolError(Exception):
    """Raised by tool handlers to return a clean error message."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class State:
    """Process-wide shared state for tool handlers."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.confirmations: Dict[str, Dict[str, Any]] = {}


STATE = State()
TOOLS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {}


def register(name: str):
    """Decorator to register a handler under a tool name."""

    def decorator(func: Callable[[Dict[str, Any]], Dict[str, Any]]):
        TOOLS[name] = func
        return func

    return decorator


DESKTOP_TOOL_NAMES = [
    # applications / websites / search
    "openApplication",
    "closeApplication",
    "openWebsite",
    "searchWeb",
    "searchYouTube",
    "searchGoogle",
    "searchGitHub",
    # files
    "createFile",
    "readFile",
    "renameFile",
    "deleteFile",
    "moveFile",
    "openFolder",
    "listFiles",
    "searchFiles",
    # pc control (volume + gated power)
    "volumeUp",
    "volumeDown",
    "muteToggle",
    "setVolume",
    "requestPowerAction",
    "executePowerAction",
    # windows
    "minimizeWindow",
    "maximizeWindow",
    "closeWindow",
    "switchApplication",
    # generic mouse / keyboard / desktop observation
    "locateText",
    "clickText",
    "moveMouse",
    "click",
    "doubleClick",
    "rightClick",
    "drag",
    "scroll",
    "typeText",
    "pressKey",
    "hotkey",
    "getCursorPosition",
    "getActiveWindow",
    "listVisibleWindows",
    "waitForUi",
    "observeDesktopState",
    # clipboard
    "copySelected",
    "pasteClipboard",
    "getClipboard",
    "clearClipboard",
    # screenshot / screen reading
    "takeScreenshot",
    "saveScreenshot",
    "analyzeScreenshot",
    "readScreen",
    "viewScreen",
    # coding assistance
    "createPythonFile",
    "runPythonScript",
    "createProjectFolder",
    "writeCodeFile",
    # system information
    "systemInfo",
    "gpuInfo",
    "temperatureInfo",
    # brightness control (V2)
    "brightnessUp",
    "brightnessDown",
    "setBrightness",
    # Windows auto-start management (V2)
    "enableAutoStart",
    "disableAutoStart",
    "getAutoStartStatus",
]

_MODULE_NAMES = [
    "tools_confirmation",
    "tools_applications",
    "tools_websites",
    "tools_search",
    "tools_files",
    "tools_pc",
    "tools_windows",
    "tools_targeting",
    "tools_input",
    "tools_clipboard",
    "tools_screenshot",
    "tools_coding",
    "tools_system",
    "tools_startup",
]

__all__ = [
    "TOOLS",
    "STATE",
    "DESKTOP_TOOL_NAMES",
    "ToolError",
    "register",
    "load_all",
]


def load_all() -> None:
    """Import every tool module so its @register decorators run."""
    for mod_name in _MODULE_NAMES:
        importlib.import_module(f".{mod_name}", package="desktop_agent")
