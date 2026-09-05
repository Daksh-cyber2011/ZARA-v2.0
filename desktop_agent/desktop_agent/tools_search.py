"""
MYRAA Desktop Control Agent — search tools (module alias).

The search implementations live in tools_websites.py; this module exists so
registry._MODULE_NAMES can load "tools_search" for backwards compatibility
with the frozen-agent tool layout.
"""
from .tools_websites import (  # noqa: F401
    search_web,
    search_youtube,
    search_google,
    search_github,
)

__all__ = ["search_web", "search_youtube", "search_google", "search_github"]
