"""Compatibility alias that exposes the Python wrapper under the historic name.

The original project shipped an informal ``powerquerynet`` package.  The code
now lives in the maintained ``py_powerquerynet`` package.  This shim preserves
existing imports while delegating all behaviour to the supported module.
"""

from __future__ import annotations

import importlib
import sys
from types import ModuleType
from typing import Iterable


_PKG_NAME = "py_powerquerynet"
_pkg = importlib.import_module(_PKG_NAME)


def _export_public_members(module: ModuleType, destination: dict) -> None:
    names: Iterable[str]
    if hasattr(module, "__all__") and module.__all__:  # type: ignore[attr-defined]
        names = module.__all__  # type: ignore[assignment]
    else:
        names = (name for name in dir(module) if not name.startswith("_"))

    for name in names:
        destination[name] = getattr(module, name)


_export_public_members(_pkg, globals())

__all__ = getattr(_pkg, "__all__", [])  # type: ignore[assignment]
__path__ = list(getattr(_pkg, "__path__", []))  # type: ignore[assignment]


def __getattr__(name: str):  # pragma: no cover - simple forwarding
    return getattr(_pkg, name)


def __dir__():  # pragma: no cover - interactive convenience
    return sorted(set(globals()) | set(dir(_pkg)))


for _submodule in ("command", "command_direct", "exceptions"):
    alias = f"{__name__}.{_submodule}"
    target = f"{_PKG_NAME}.{_submodule}"
    module = importlib.import_module(target)
    sys.modules.setdefault(alias, module)


