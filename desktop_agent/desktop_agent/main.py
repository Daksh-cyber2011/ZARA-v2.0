"""
MYRAA Desktop Control Agent — FastAPI entrypoint.

Single dispatch endpoint POST /execute { tool, args } -> { result } | { error }.
MYRAA's Node bridge (server.ts) calls this over HTTP on 127.0.0.1:8765.

Run:
    uvicorn desktop_agent.main:app --host 127.0.0.1 --port 8765
or:
    python -m desktop_agent.main

Environment:
    MYRAA_AGENT_HOST   default 127.0.0.1
    MYRAA_AGENT_PORT   default 8765
    MYRAA_DATA_DIR     where logs/ is written (default: cwd)
"""
from __future__ import annotations

import logging
import os
import traceback
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import __version__
from .perception import collect_snapshot
from .registry import DESKTOP_TOOL_NAMES, TOOLS, ToolError, load_all

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("myraa.desktop")

load_all()
log.info("Loaded %d desktop tools: %s", len(TOOLS), ", ".join(sorted(TOOLS)))


def _resolve_data_dir() -> str:
    data_dir = os.environ.get("MYRAA_DATA_DIR") or os.getcwd()
    try:
        os.makedirs(os.path.join(data_dir, "logs"), exist_ok=True)
    except Exception:
        pass
    return data_dir


def _configure_logging(data_dir: str) -> None:
    try:
        logging.basicConfig(
            level=logging.INFO,
            format="[%(asctime)s] [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
            handlers=[
                logging.FileHandler(os.path.join(data_dir, "logs", "agent.log"), encoding="utf-8"),
                logging.StreamHandler(),
            ],
            force=True,
        )
    except Exception:
        pass


data_dir = _resolve_data_dir()
_configure_logging(data_dir)


def _short_args(args: Dict[str, Any]) -> str:
    """Log argument names only; values may contain personal or secret data."""
    return "{keys=[" + ", ".join(sorted(args.keys())) + "]}"


class ExecuteRequest(BaseModel):
    tool: str
    args: Dict[str, Any] = {}


class ExecuteResponse(BaseModel):
    ok: bool
    result: Any = None
    tool: str | None = None
    error: str | None = None


app = FastAPI(
    title="MYRAA Desktop Control Agent",
    version=__version__,
    description="JARVIS-style desktop automation backend for MYRAA.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "name": "MYRAA Desktop Control Agent",
        "version": __version__,
        "tools": sorted(TOOLS.keys()),
        "tool_count": len(TOOLS),
    }


@app.get("/tools")
def list_tools() -> Dict[str, Any]:
    return {"tools": sorted(TOOLS.keys()), "count": len(TOOLS)}


@app.get("/observe")
def observe() -> Dict[str, Any]:
    """Desktop telemetry for the server's perception engine."""
    return collect_snapshot()


@app.post("/execute", response_model=ExecuteResponse)
def execute(req: ExecuteRequest) -> ExecuteResponse:
    tool = req.tool
    args = req.args or {}
    log.info("EXEC tool=%s args=%s", tool, _short_args(args))
    if tool not in TOOLS:
        known = ", ".join(sorted(TOOLS.keys()))
        return ExecuteResponse(ok=False, error=f"Unknown tool '{tool}'. Known tools: {known}", tool=tool)
    handler = TOOLS[tool]
    try:
        out = handler(args)
        result_text = ""
        if isinstance(out, dict):
            result_text = str(out.get("result", out))
        else:
            result_text = str(out)
        log.info("DONE tool=%s -> %s", tool, result_text[:160])
        return ExecuteResponse(ok=True, result=out, tool=tool)
    except ToolError as e:
        log.warning("ToolError in %s: %s", tool, e.message)
        return ExecuteResponse(ok=False, error=e.message, tool=tool)
    except Exception as e:
        log.error("Unhandled error in %s: %s\n%s", tool, e, traceback.format_exc())
        return ExecuteResponse(ok=False, error=str(e), tool=tool)


def main() -> None:
    """Allow `python -m desktop_agent.main` to launch uvicorn."""
    import uvicorn

    host = os.environ.get("MYRAA_AGENT_HOST", "127.0.0.1")
    port = int(os.environ.get("MYRAA_AGENT_PORT", "8765"))
    log.info("Launching uvicorn on %s:%d", host, port)
    uvicorn.run("desktop_agent.main:app", host=host, port=port, reload=False, log_level="info")


if __name__ == "__main__":
    main()
