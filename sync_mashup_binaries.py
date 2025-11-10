"""Synchronise Microsoft Mashup runtime binaries from Power BI Desktop.

This helper copies the Microsoft-provided DLLs/EXEs that the Power Query
engine relies on into the local build output directories so the DirectCommand
Python wrapper and ConsoleWrapper can execute without assembly mismatches.
"""

from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path
from typing import Iterable, List, Set


DEFAULT_SOURCE = Path(
    os.environ.get("POWERBI_DESKTOP_BIN", r"C:\Program Files\Microsoft Power BI Desktop\bin")
)

DEFAULT_TARGETS = [
    Path("PowerQueryNet/Engine/bin/Release"),
    Path("PowerQueryNet/ConsoleWrapper/bin/Release"),
]

ALIASES = {
    "Microsoft.Mashup.Container.NetFX40.exe": "Microsoft.Mashup.Container.NetFX45.exe",
    "Microsoft.Mashup.Container.NetFX40.exe.config": "Microsoft.Mashup.Container.NetFX45.exe.config",
}

FALLBACK_NAMES = {
    "Microsoft.Mashup.Container.NetFX45.exe",
    "Microsoft.Mashup.Container.NetFX45.exe.config",
    "Microsoft.Mashup.Container.NetFX40.exe",
    "Microsoft.Mashup.Container.NetFX40.exe.config",
    "System.Memory.dll",
}

PREFIXES = ("Microsoft.", "System.", "PRIVATE_", "Kernel", "msdia")
ALLOWED_SUFFIXES = {".dll", ".exe", ".config"}


def gather_required_names(targets: Iterable[Path]) -> Set[str]:
    names: Set[str] = set()
    for target in targets:
        if not target.exists():
            continue
        for entry in target.iterdir():
            if not entry.is_file():
                continue
            if entry.suffix.lower() not in ALLOWED_SUFFIXES:
                continue
            if entry.name.startswith(PREFIXES):
                names.add(entry.name)
    names.update(FALLBACK_NAMES)
    return names


def copy_runtime_files(source: Path, targets: Iterable[Path], names: Iterable[str]) -> tuple[List[str], List[tuple[Path, Path]]]:
    missing: List[str] = []
    copied_summary: List[tuple[Path, Path]] = []
    for name in sorted(set(names)):
        candidate = source / name
        alias = ALIASES.get(name)
        if not candidate.exists() and alias:
            candidate = source / alias

        if not candidate.exists():
            missing.append(name)
            continue

        for target in targets:
            target.mkdir(parents=True, exist_ok=True)
            shutil.copy2(candidate, target / name)
            copied_summary.append((candidate, target / name))

    return missing, copied_summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help="Power BI Desktop bin directory (defaults to the standard installation path)",
    )
    parser.add_argument(
        "--targets",
        type=Path,
        nargs="*",
        default=DEFAULT_TARGETS,
        help="Target directories to copy runtime files into",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    source = args.source
    if not source.exists():
        raise SystemExit(f"Source directory '{source}' does not exist. Set POWERBI_DESKTOP_BIN or pass --source.")

    targets = [path.resolve() for path in args.targets]
    names = gather_required_names(targets)

    missing, copied_summary = copy_runtime_files(source, targets, names)

    print(f"Copied {len(copied_summary)} files from '{source}' into {len(targets)} target(s).")
    for original, dest in copied_summary:
        print(f"  Copied {original.name} -> {dest}")
    if missing:
        print("The following files were not found in the source directory:")
        for name in missing:
            print(f"  - {name}")


if __name__ == "__main__":
    main()


