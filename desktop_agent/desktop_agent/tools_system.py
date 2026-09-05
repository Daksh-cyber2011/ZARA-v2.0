"""
MYRAA Desktop Control Agent — system information.

systemInfo (CPU/RAM/disk/uptime), gpuInfo (NVIDIA stats via nvidia-smi),
temperatureInfo (best-effort thermal readings).
"""
from __future__ import annotations

import platform
import shutil
import subprocess
from datetime import datetime
from typing import Any, Dict

from .registry import ToolError, register


def _psutil():
    try:
        import psutil

        return psutil
    except ImportError:
        return None


@register("systemInfo")
def system_info(_args: Dict[str, Any]) -> Dict[str, Any]:
    psutil = _psutil()
    if psutil is None:
        raise ToolError("System information requires the psutil package.")

    cpu_percent = psutil.cpu_percent(interval=0.4)
    memory = psutil.virtual_memory()
    disk = shutil.disk_usage("/")
    boot = datetime.fromtimestamp(psutil.boot_time())
    uptime_hours = (datetime.now() - boot).total_seconds() / 3600.0

    summary = (
        f"CPU at {cpu_percent:.0f}%, RAM at {memory.percent:.0f}% "
        f"({memory.used // (1 << 30)}/{memory.total // (1 << 30)} GB used), "
        f"disk {int(disk.used / disk.total * 100)}% used, "
        f"up {uptime_hours:.1f} hours."
    )
    return {
        "result": summary,
        "cpu_percent": cpu_percent,
        "memory_percent": memory.percent,
        "memory_used_gb": memory.used // (1 << 30),
        "memory_total_gb": memory.total // (1 << 30),
        "disk_percent": int(disk.used / disk.total * 100),
        "uptime_hours": round(uptime_hours, 1),
        "platform": platform.platform(),
    }


@register("gpuInfo")
def gpu_info(_args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        query = ",".join(
            ["utilization.gpu", "memory.used", "memory.total", "temperature.gpu", "name"]
        )
        completed = subprocess.run(
            ["nvidia-smi", f"--query-gpu={query}", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=6,
        )
        if completed.returncode != 0:
            raise ToolError("No NVIDIA GPU is reporting through nvidia-smi.")
        fields = [part.strip() for part in completed.stdout.strip().split(",")]
        if len(fields) < 5:
            raise ToolError("nvidia-smi returned an unexpected format.")
        name = fields[4]
        summary = (
            f"{name}: {fields[0]}% utilization, "
            f"{fields[1]}/{fields[2]} MB VRAM, {fields[3]}C."
        )
        return {
            "result": summary,
            "gpu_name": name,
            "utilization_percent": fields[0],
            "memory_used_mb": fields[1],
            "memory_total_mb": fields[2],
            "temperature_c": fields[3],
        }
    except FileNotFoundError:
        raise ToolError("nvidia-smi is not installed; no NVIDIA GPU stats available.")


@register("temperatureInfo")
def temperature_info(_args: Dict[str, Any]) -> Dict[str, Any]:
    psutil = _psutil()
    if psutil is None:
        raise ToolError("Temperature readings require the psutil package.")
    if not hasattr(psutil, "sensors_temperatures"):
        raise ToolError("Temperature sensors are not supported on this platform.")
    try:
        temps = psutil.sensors_temperatures()  # type: ignore[attr-defined]
    except Exception as error:
        raise ToolError(f"Could not read temperature sensors: {error}") from error
    if not temps:
        raise ToolError(
            "No temperature sensors are exposed by the operating system (common on many Windows PCs)."
        )
    readings = []
    for name, entries in temps.items():
        for entry in entries[:2]:
            label = entry.label or name
            readings.append(f"{label}: {entry.current:.0f}C")
    return {"result": "; ".join(readings), "sensors": {k: [e.current for e in v[:4]] for k, v in temps.items()}}


__all__ = ["system_info", "gpu_info", "temperature_info"]
