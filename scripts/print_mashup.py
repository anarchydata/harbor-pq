"""
Utility script to inspect the Power Query mashup payload embedded in an Excel workbook.

Usage:
    python scripts/print_mashup.py <path_to_xlsx>

The script opens the workbook as a zip archive in memory and prints:
  - The custom XML metadata (`customXml/itemProps1.xml`)
  - The DataMashup XML wrapper (`customXml/item1.xml`)
  - The decoded base64 length of the embedded DataMashup payload

Nothing is unpacked to disk beyond reading the zipped entries.
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path
from zipfile import ZipFile


CUSTOM_XML_PATH = "customXml/item1.xml"
CUSTOM_XML_PROPS_PATH = "customXml/itemProps1.xml"


def read_zip_entry(zip_path: Path, entry_name: str) -> bytes:
    with ZipFile(zip_path, "r") as archive:
        try:
            with archive.open(entry_name) as entry:
                return entry.read()
        except KeyError as exc:
            raise FileNotFoundError(f"Entry '{entry_name}' not found in '{zip_path}'.") from exc


def extract_base64_payload(item_xml: str) -> str | None:
    prefix = ">"
    suffix = "<"
    start = item_xml.find(prefix)
    if start == -1:
        return None
    start += len(prefix)
    end = item_xml.rfind(suffix)
    if end == -1 or end <= start:
        return None
    return item_xml[start:end]


def main(arguments: list[str]) -> int:
    if len(arguments) != 2:
        print("Usage: python scripts/print_mashup.py <path_to_xlsx>", file=sys.stderr)
        return 1

    workbook_path = Path(arguments[1]).expanduser().resolve()
    if not workbook_path.exists():
        print(f"Workbook not found: {workbook_path}", file=sys.stderr)
        return 1

    try:
        item_props_bytes = read_zip_entry(workbook_path, CUSTOM_XML_PROPS_PATH)
        item_xml_bytes = read_zip_entry(workbook_path, CUSTOM_XML_PATH)
    except FileNotFoundError as err:
        print(err, file=sys.stderr)
        return 1

    item_props_text = item_props_bytes.decode("utf-8", errors="replace")

    # item1.xml is UTF-16 by convention, but fall back to UTF-8 if decoding fails.
    try:
        item_xml_text = item_xml_bytes.decode("utf-16")
    except UnicodeDecodeError:
        item_xml_text = item_xml_bytes.decode("utf-8", errors="replace")

    payload = extract_base64_payload(item_xml_text)
    decoded_length = len(base64.b64decode(payload)) if payload else 0

    print("=== customXml/itemProps1.xml ===")
    print(item_props_text.strip())
    print("\n=== customXml/item1.xml ===")
    print(item_xml_text.strip())
    print("\n=== customXml/item1.xml (repr) ===")
    print(repr(item_xml_text))

    if payload:
        print(f"\nBase64 payload length: {len(payload)} chars")
        print(f"Decoded DataMashup size: {decoded_length} bytes")
    else:
        print("\nDataMashup payload not found in customXml/item1.xml")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

