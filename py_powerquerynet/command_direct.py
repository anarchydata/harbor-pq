"""Thin re-export layer for the legacy direct command helpers."""

from PowerQueryNet.command_direct import (
    CommandCredentials,
    DirectCommand,
    DirectCommandError,
    DirectCommandResult,
    DirectCommandTable,
)

__all__ = [
    "CommandCredentials",
    "DirectCommand",
    "DirectCommandError",
    "DirectCommandResult",
    "DirectCommandTable",
]


