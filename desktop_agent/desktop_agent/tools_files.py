"""
MYRAA Desktop Control Agent — safe file operations.

All operations are scoped to safe user folders (Desktop, Documents, Downloads,
Pictures, Music, Videos, Home and their children). deleteFile sends files to
the Recycle Bin by default; a permanent hard delete requires permanent=true.
"""
from __future__ import annotations

import glob
import os
import platform
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from .registry import ToolError, register

if platform.system() == "Windows":
    try:
        import send2trash
    except ImportError:
        send2trash = None
else:
    send2trash = None


def _alias_roots() -> Dict[str, Path]:
    home = Path.home()
    roots = {
        "home": home,
        "desktop": home / "Desktop",
        "documents": home / "Documents",
        "downloads": home / "Downloads",
        "pictures": home / "Pictures",
        "music": home / "Music",
        "videos": home / "Videos",
    }
    return {key: value for key, value in roots.items() if value.exists()}


def _resolve_safe_path(raw: str) -> Path:
    """Resolve `raw` inside the safe roots; refuse anything outside."""
    if not raw or not raw.strip():
        raise ToolError("A file path is required.")
    cleaned = raw.strip().replace("/", os.sep).replace("\\", os.sep)
    cleaned = cleaned.strip(os.sep)
    roots = _alias_roots()

    first, _, _rest = cleaned.partition(os.sep)
    anchor = roots.get(first.lower())
    if anchor is None:
        # Absolute path form: validate it lives under a safe root.
        candidate = Path(raw if os.path.isabs(raw) else (Path.home() / cleaned)).resolve()
    else:
        candidate = (anchor / _rest).resolve() if _rest else anchor.resolve()

    candidate = candidate.resolve()
    allowed = any(
        candidate == root or root in candidate.parents or str(candidate).lower().startswith(str(root).lower())
        for root in roots.values()
    )
    if not allowed:
        raise ToolError(
            "File operations are limited to Desktop, Documents, Downloads, Pictures, Music, Videos, and Home."
        )
    return candidate


def _require_file(path: Path) -> Path:
    if not path.exists():
        raise ToolError(f"File not found: {path.name}")
    if not path.is_file():
        raise ToolError(f"Path is not a file: {path}")
    return path


@register("createFile")
def create_file(args: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(args.get("path") or "")
    content = args.get("content")
    overwrite = bool(args.get("overwrite", False))
    path = _resolve_safe_path(raw)
    if path.exists() and path.is_dir():
        raise ToolError(f"'{path.name}' is a folder.")
    if path.exists() and not overwrite:
        raise ToolError(f"'{path.name}' already exists. Set overwrite=true to replace it.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(content if content is not None else ""), encoding="utf-8")
    return {"result": f"Created {path.name} in {path.parent.name or 'Home'}.", "path": str(path)}


@register("readFile")
def read_file(args: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(args.get("path") or "")
    max_chars = int(args.get("max_chars") or 8000)
    path = _require_file(_resolve_safe_path(raw))
    data = path.read_text(encoding="utf-8", errors="replace")
    truncated = len(data) > max_chars
    return {
        "result": data[:max_chars],
        "path": str(path),
        "truncated": truncated,
        "total_chars": len(data),
    }


@register("renameFile")
def rename_file(args: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(args.get("path") or "")
    new_name = str(args.get("new_name") or "").strip()
    if not new_name:
        raise ToolError("Parameter 'new_name' is required.")
    if any(sep in new_name for sep in ("/", "\\")):
        raise ToolError("new_name must be a file name, not a path.")
    path = _require_file(_resolve_safe_path(raw))
    target = path.with_name(new_name)
    if target.exists():
        raise ToolError(f"'{new_name}' already exists.")
    path.rename(target)
    return {"result": f"Renamed '{path.name}' to '{new_name}'.", "path": str(target)}


@register("deleteFile")
def delete_file(args: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(args.get("path") or "")
    permanent = bool(args.get("permanent", False))
    path = _require_file(_resolve_safe_path(raw))
    if permanent or send2trash is None:
        if permanent:
            path.unlink()
            return {"result": f"Permanently deleted '{path.name}'."}
        path.unlink(missing_ok=True)
        return {"result": f"Deleted '{path.name}'."}
    send2trash.send2trash(str(path))
    return {"result": f"Moved '{path.name}' to the Recycle Bin."}


@register("moveFile")
def move_file(args: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(args.get("path") or "")
    destination = str(args.get("destination") or "")
    source = _require_file(_resolve_safe_path(raw))
    try:
        target = _resolve_safe_path(destination)
    except ToolError:
        raise ToolError("Destination must be a safe folder or file path.")
    if target.exists() and target.is_dir():
        target = target / source.name
    shutil.move(str(source), str(target))
    return {"result": f"Moved '{source.name}' to '{target.parent.name or 'Home'}'.", "path": str(target)}


@register("openFolder")
def open_folder(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args.get("name") or "").strip().lower()
    raw = str(args.get("path") or "").strip()
    roots = _alias_roots()
    folder: Optional[Path]
    if raw:
        folder = _resolve_safe_path(raw)
    elif name:
        folder = roots.get(name)
        if folder is None:
            raise ToolError(
                f"Unknown folder alias '{name}'. Valid: {', '.join(sorted(roots))}."
            )
    else:
        raise ToolError("Provide a folder name alias or a path.")
    if not folder.exists():
        raise ToolError(f"Folder not found: {folder}")
    try:
        if platform.system() == "Windows":
            os.startfile(str(folder))  # type: ignore[attr-defined]
        elif platform.system() == "Darwin":
            import subprocess

            subprocess.Popen(["open", str(folder)])
        else:
            import subprocess

            subprocess.Popen(["xdg-open", str(folder)])
    except Exception as error:
        raise ToolError(f"Could not open folder: {error}") from error
    return {"result": f"Opened folder '{folder.name or 'Home'}'."}


@register("listFiles")
def list_files(args: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(args.get("path") or "")
    name = str(args.get("name") or "").strip().lower()
    pattern = str(args.get("pattern") or "*")
    if raw:
        folder = _resolve_safe_path(raw)
    else:
        folder = _alias_roots().get(name) or Path.home()
    if not folder.exists() or not folder.is_dir():
        raise ToolError(f"Folder not found: {folder}")
    entries = sorted(folder.glob(pattern), key=lambda item: item.name.lower())
    files: List[Dict[str, Any]] = []
    for entry in entries[:200]:
        try:
            stat = entry.stat()
        except OSError:
            continue
        files.append(
            {
                "name": entry.name,
                "is_dir": entry.is_dir(),
                "size": stat.st_size if not entry.is_dir() else None,
            }
        )
    listing = ", ".join(f"{item['name']}{'/' if item['is_dir'] else ''}" for item in files[:50])
    return {
        "result": f"{len(files)} item(s): {listing}" if files else "The folder is empty.",
        "files": files,
    }


@register("searchFiles")
def search_files(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args.get("name") or "").strip()
    extension = str(args.get("extension") or "").strip().lstrip(".")
    folder_raw = str(args.get("folder") or "home")
    limit = max(1, min(100, int(args.get("limit") or 100)))
    if not name and not extension:
        raise ToolError("Provide a filename glob or an extension to search for.")

    roots = _alias_roots()
    folder = roots.get(folder_raw.lower()) or _resolve_safe_path(folder_raw)
    if not folder.exists():
        raise ToolError(f"Folder not found: {folder}")

    pattern = name if ("*" in name or "?" in name) else f"*{name}*"
    if extension and not name:
        pattern = f"*.{extension}"

    matches: List[Dict[str, Any]] = []
    for path in folder.rglob(pattern):
        try:
            stat = path.stat()
        except OSError:
            continue
        if path.is_file():
            matches.append({"name": path.name, "path": str(path), "size": stat.st_size})
        if len(matches) >= limit:
            break
    if not matches:
        return {"result": f"No files matching '{pattern}' under {folder.name or 'Home'}."}
    listing = ", ".join(item["name"] for item in matches[:20])
    return {
        "result": f"Found {len(matches)} file(s): {listing}",
        "files": matches,
    }


__all__ = [
    "create_file",
    "read_file",
    "rename_file",
    "delete_file",
    "move_file",
    "open_folder",
    "list_files",
    "search_files",
]
