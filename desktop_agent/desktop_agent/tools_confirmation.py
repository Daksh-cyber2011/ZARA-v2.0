"""
MYRAA Desktop Control Agent — two-step confirmation for dangerous actions.

`requestPowerAction` (tools_pc) creates a single-use token here; the model must
speak the confirmation out loud, and only after an explicit user "yes" may it
call `executePowerAction` with that token.  Tokens expire in 60 seconds.
"""
from __future__ import annotations

import secrets
import time
from typing import Any, Dict

from .registry import STATE, ToolError, register

TOKEN_TTL_SECONDS = 60.0

ACTION_LABEL = {
    "shutdown": "shut down the computer",
    "restart": "restart the computer",
    "sleep": "put the computer to sleep",
    "lock": "lock the computer",
}

DANGEROUS_ACTIONS = set(ACTION_LABEL.keys())


def issue_token(action: str) -> Dict[str, Any]:
    action = action.strip().lower()
    if action not in DANGEROUS_ACTIONS:
        raise ToolError(f"Unknown dangerous action '{action}'. Valid: {', '.join(sorted(DANGEROUS_ACTIONS))}.")
    token = secrets.token_urlsafe(16)
    with STATE.lock:
        # One pending confirmation at a time keeps the flow linear.
        STATE.confirmations.clear()
        STATE.confirmations[token] = {
            "action": action,
            "createdAt": time.time(),
            "expiresAt": time.time() + TOKEN_TTL_SECONDS,
        }
    return {
        "result": (
            f"Confirmation required to {ACTION_LABEL[action]}. Ask the user to confirm out loud, "
            f"then call executePowerAction with the execute_token."
        ),
        "confirmation_id": token,
        "execute_token": token,
        "action": action,
        "expires_in_seconds": int(TOKEN_TTL_SECONDS),
        "confirmation_required": True,
    }


def consume_token(action: str, token: str) -> None:
    """Verify and burn a confirmation token. Raises ToolError when invalid."""
    if not token:
        raise ToolError("This action requires prior confirmation via requestPowerAction.")
    with STATE.lock:
        pending = STATE.confirmations.pop(token, None)
    if not pending:
        raise ToolError("Confirmation token is invalid or was already used.")
    if time.time() > pending["expiresAt"]:
        raise ToolError("Confirmation token expired; request the action again.")
    if pending["action"] != action:
        raise ToolError("Confirmation token does not match the requested action.")


@register("requestPowerAction")
def request_power_action(args: Dict[str, Any]) -> Dict[str, Any]:
    action = str(args.get("action") or "").strip().lower()
    return issue_token(action)


__all__ = ["issue_token", "consume_token", "ACTION_LABEL", "DANGEROUS_ACTIONS", "request_power_action"]
