"""
MYRAA Desktop Control Agent — website shortcuts and search engines.

Every navigation opens in the user's real default browser. Search tools reuse
one tab when possible and never open an embedded or simulated browser.
"""
from __future__ import annotations

import webbrowser
from typing import Any, Dict
from urllib.parse import quote_plus

from .registry import ToolError, register

WEBSITE_SHORTCUTS: Dict[str, str] = {
    "youtube": "https://www.youtube.com",
    "gmail": "https://mail.google.com",
    "google": "https://www.google.com",
    "github": "https://github.com",
    "chatgpt": "https://chat.openai.com",
    "maps": "https://maps.google.com",
    "drive": "https://drive.google.com",
    "whatsapp": "https://web.whatsapp.com",
    "instagram": "https://www.instagram.com",
    "twitter": "https://twitter.com",
    "x": "https://twitter.com",
    "reddit": "https://www.reddit.com",
    "netflix": "https://www.netflix.com",
    "spotify": "https://open.spotify.com",
    "amazon": "https://www.amazon.com",
    "linkedin": "https://www.linkedin.com",
    "stackoverflow": "https://stackoverflow.com",
    "wikipedia": "https://www.wikipedia.org",
    "discord": "https://discord.com/app",
    "facebook": "https://www.facebook.com",
}


@register("openWebsite")
def open_website(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args.get("name") or "").strip().lower()
    url = str(args.get("url") or "").strip()
    if not url:
        if not name:
            raise ToolError("Provide a site name shortcut or a full URL.")
        if not name.startswith(("http://", "https://")):
            if name not in WEBSITE_SHORTCUTS:
                if "." in name:
                    url = f"https://{name}"
                else:
                    raise ToolError(
                        f"Unknown site shortcut '{name}'. Provide a full URL for custom sites."
                    )
            else:
                url = WEBSITE_SHORTCUTS[name]
        else:
            url = name
    webbrowser.open(url)
    return {"result": f"Opened {url} in the default browser.", "url": url}


@register("searchWeb")
def search_web(args: Dict[str, Any]) -> Dict[str, Any]:
    query = str(args.get("query") or "").strip()
    engine = str(args.get("engine") or "google").strip().lower()
    if not query:
        raise ToolError("Parameter 'query' is required.")

    engines: Dict[str, str] = {
        "google": "https://www.google.com/search?q={}",
        "youtube": "https://www.youtube.com/results?search_query={}",
        "github": "https://github.com/search?q={}",
        "duckduckgo": "https://duckduckgo.com/?q={}",
        "bing": "https://www.bing.com/search?q={}",
    }
    template = engines.get(engine)
    if not template:
        raise ToolError(f"Unsupported engine '{engine}'. Valid: {', '.join(engines)}.")
    url = template.format(quote_plus(query))
    webbrowser.open(url)
    return {"result": f"Searched {engine} for '{query}' in the default browser.", "url": url}


@register("searchYouTube")
def search_youtube(args: Dict[str, Any]) -> Dict[str, Any]:
    query = str(args.get("query") or "").strip()
    if not query:
        raise ToolError("Parameter 'query' is required.")
    url = f"https://www.youtube.com/results?search_query={quote_plus(query)}"
    webbrowser.open(url)
    return {"result": f"Searched YouTube for '{query}'.", "url": url}


@register("searchGoogle")
def search_google(args: Dict[str, Any]) -> Dict[str, Any]:
    query = str(args.get("query") or "").strip()
    if not query:
        raise ToolError("Parameter 'query' is required.")
    url = f"https://www.google.com/search?q={quote_plus(query)}"
    webbrowser.open(url)
    return {"result": f"Searched Google for '{query}'.", "url": url}


@register("searchGitHub")
def search_github(args: Dict[str, Any]) -> Dict[str, Any]:
    query = str(args.get("query") or "").strip()
    if not query:
        raise ToolError("Parameter 'query' is required.")
    url = f"https://github.com/search?q={quote_plus(query)}"
    webbrowser.open(url)
    return {"result": f"Searched GitHub for '{query}'.", "url": url}


__all__ = ["open_website", "search_web", "search_youtube", "search_google", "search_github", "WEBSITE_SHORTCUTS"]
