"""
MYRAA Desktop Control Agent — coding assistance.

createPythonFile / writeCodeFile / createProjectFolder build files and project
scaffolds inside the safe user folders; runPythonScript executes a Python file
with output capture and a hard timeout.
"""
from __future__ import annotations

import os
import subprocess
import sys
from typing import Any, Dict, List

from .registry import ToolError, register
from .tools_files import _resolve_safe_path


@register("createPythonFile")
def create_python_file(args: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(args.get("path") or "")
    content = str(args.get("content") or "")
    overwrite = bool(args.get("overwrite", False))
    if not raw.lower().endswith(".py"):
        raw += ".py"
    path = _resolve_safe_path(raw)
    if path.exists() and not overwrite:
        raise ToolError(f"'{path.name}' already exists. Set overwrite=true to replace it.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {"result": f"Created Python file '{path.name}'.", "path": str(path)}


@register("writeCodeFile")
def write_code_file(args: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(args.get("path") or "")
    content = str(args.get("content") or "")
    language = str(args.get("language") or "").strip().lower()
    overwrite = bool(args.get("overwrite", False))
    known_extensions = {
        "python": ".py",
        "javascript": ".js",
        "typescript": ".ts",
        "html": ".html",
        "css": ".css",
        "java": ".java",
        "c": ".c",
        "cpp": ".cpp",
        "csharp": ".cs",
        "go": ".go",
        "rust": ".rs",
        "ruby": ".rb",
        "php": ".php",
        "shell": ".sh",
        "batch": ".bat",
        "json": ".json",
        "yaml": ".yaml",
        "markdown": ".md",
    }
    if language in known_extensions and not raw.lower().endswith(known_extensions[language]):
        raw += known_extensions[language]
    path = _resolve_safe_path(raw)
    if path.exists() and not overwrite:
        raise ToolError(f"'{path.name}' already exists. Set overwrite=true to replace it.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {"result": f"Created '{path.name}' ({path.suffix or 'txt'}).", "path": str(path)}


@register("createProjectFolder")
def create_project_folder(args: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(args.get("path") or "")
    subfolders = args.get("subfolders") if isinstance(args.get("subfolders"), list) else []
    scaffold_standard = bool(args.get("scaffold_standard", False))
    files = args.get("files") if isinstance(args.get("files"), dict) else {}
    if not raw.strip():
        raise ToolError("Parameter 'path' (project root) is required.")
    root = _resolve_safe_path(raw)
    if root.exists() and root.is_file():
        raise ToolError(f"'{root.name}' is a file; project root must be a folder.")
    root.mkdir(parents=True, exist_ok=True)

    created: List[str] = []
    for name in subfolders:
        folder = root / str(name)
        folder.mkdir(parents=True, exist_ok=True)
        created.append(str(name))
    if scaffold_standard:
        for name in ("src", "tests", "docs"):
            folder = root / name
            folder.mkdir(parents=True, exist_ok=True)
            if name not in created:
                created.append(name)
    for relative, content in files.items():
        target = (root / str(relative)).resolve()
        if not str(target).startswith(str(root.resolve())):
            raise ToolError("Starter files must live inside the project folder.")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(content), encoding="utf-8")
        created.append(str(relative))

    listing = ", ".join(created[:20]) if created else "no subfolders"
    return {"result": f"Created project '{root.name}' with {listing}.", "path": str(root)}


@register("runPythonScript")
def run_python_script(args: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(args.get("path") or "")
    script_args = args.get("args") if isinstance(args.get("args"), list) else []
    timeout = max(1, min(600, int(args.get("timeout") or 30)))
    path = _resolve_safe_path(raw)
    if not path.exists() or not path.is_file():
        raise ToolError(f"Script not found: {path.name}")
    if not path.suffix.lower() == ".py":
        raise ToolError("runPythonScript executes .py files only.")
    try:
        completed = subprocess.run(
            [sys.executable, str(path), *[str(arg) for arg in script_args]],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(path.parent),
        )
    except subprocess.TimeoutExpired as error:
        raise ToolError(f"Script timed out after {timeout} seconds.") from error
    stdout = (completed.stdout or "")[-8000:]
    stderr = (completed.stderr or "")[-4000:]
    if completed.returncode == 0:
        result = f"Script finished with exit code 0."
        if stdout.strip():
            result += f" Output:\n{stdout.strip()[:2000]}"
    else:
        result = f"Script failed with exit code {completed.returncode}."
        if stderr.strip():
            result += f" Error:\n{stderr.strip()[:2000]}"
    return {
        "result": result,
        "exit_code": completed.returncode,
        "stdout": stdout,
        "stderr": stderr,
    }


__all__ = ["create_python_file", "write_code_file", "create_project_folder", "run_python_script"]
