"""High-level PowerQueryNet command wrapper built on DirectCommand."""

from __future__ import annotations

import csv
import html
import importlib
import io
from dataclasses import dataclass
from enum import Enum, IntFlag
from typing import Dict, Iterator, List, Optional

from .command_direct import CommandCredentials, DirectCommandTable
from .exceptions import PowerQueryNetError

_direct_impl = importlib.import_module("PowerQueryNet.command_direct")


class ExecuteOutputFlags(IntFlag):
    """Bit-flags that control which result formats are generated."""

    NONE = 0
    DATATABLE = 1 << 0
    CSV = 1 << 1
    JSON = 1 << 2
    HTML = 1 << 3
    XML = 1 << 4
    ALL = DATATABLE | CSV | JSON | HTML | XML


class SqlTableAction(Enum):
    """Placeholder enum mirroring the legacy API surface."""

    NONE = 0
    CREATE = 1
    REPLACE = 2
    APPEND = 3


@dataclass
class CommandResult:
    """Container for the outputs returned by :class:`Command`."""

    data_table: Optional[DirectCommandTable] = None
    json: Optional[str] = None
    csv: Optional[str] = None
    html: Optional[str] = None
    xml: Optional[str] = None
    exception_message: Optional[str] = None


@dataclass
class Query:
    """Representation of a single Power Query definition."""

    name: str
    expression: str


class Queries:
    """Simple collection used to mirror the historical API."""

    def __init__(self) -> None:
        self._items: Dict[str, Query] = {}
        self._order: List[str] = []

    def add(self, name: str, expression: str) -> None:
        normalized = expression or ""
        if name not in self._items:
            self._order.append(name)
        self._items[name] = Query(name=name, expression=normalized)

    def get(self, name: str) -> Optional[Query]:
        return self._items.get(name)

    def __iter__(self) -> Iterator[Query]:
        for key in self._order:
            yield self._items[key]

    def __len__(self) -> int:  # pragma: no cover - trivial
        return len(self._items)

    @property
    def first(self) -> Optional[Query]:  # pragma: no cover - trivial
        return self._items[self._order[0]] if self._order else None


class Command:
    """Execute M code using the DirectCommand .NET implementation."""

    def __init__(self, credentials: Optional[CommandCredentials] = None) -> None:
        self._credentials = credentials or CommandCredentials()
        _direct_impl._initialise_assemblies()  # type: ignore[attr-defined]
        self._command = _direct_impl._DotNetCommand(self._credentials.inner)  # type: ignore[attr-defined]
        self._disposed = False

    def __enter__(self) -> "Command":  # pragma: no cover - trivial
        return self

    def __exit__(self, exc_type, exc, tb) -> None:  # pragma: no cover - trivial
        self.cleanup()

    def execute(
        self,
        *,
        query_name: str,
        m_code: Optional[str] = None,
        queries: Optional[Queries] = None,
        output_flags: ExecuteOutputFlags = ExecuteOutputFlags.DATATABLE,
    ) -> CommandResult:
        if self._disposed:
            raise PowerQueryNetError("Command has been disposed")

        mashup = _build_mashup(query_name=query_name, m_code=m_code, queries=queries)

        try:
            data_table = self._command.Execute(query_name, mashup)
        except Exception as exc:  # pragma: no cover - depends on runtime
            raise PowerQueryNetError(str(exc)) from exc

        result = CommandResult()

        if data_table is not None:
            table = _direct_impl._datatable_to_python(data_table)  # type: ignore[attr-defined]
            if ExecuteOutputFlags.DATATABLE in output_flags:
                result.data_table = table

            if ExecuteOutputFlags.JSON in output_flags:
                result.json = _direct_impl._rows_to_json(table.columns, table.rows)  # type: ignore[attr-defined]

            if ExecuteOutputFlags.CSV in output_flags:
                result.csv = _table_to_csv(table)

            if ExecuteOutputFlags.HTML in output_flags:
                result.html = _table_to_html(table)

            if ExecuteOutputFlags.XML in output_flags:
                result.xml = _table_to_xml(table)

        return result

    def cleanup(self) -> None:
        if not self._disposed and self._command is not None:
            try:
                self._command.Dispose()
            finally:
                self._disposed = True

    def __del__(self):  # pragma: no cover - best effort cleanup
        try:
            self.cleanup()
        except Exception:
            pass


def _build_mashup(
    *,
    query_name: str,
    m_code: Optional[str],
    queries: Optional[Queries],
) -> str:
    if not query_name:
        raise PowerQueryNetError("query_name must be provided")

    definitions: List[str] = ["section Section1;", ""]

    seen: Dict[str, None] = {}

    if queries:
        for query in queries:
            definitions.append(_format_query_definition(query.name, query.expression))
            definitions.append("")
            seen[query.name] = None

    if m_code is not None:
        definitions.append(_format_query_definition(query_name, m_code))
        definitions.append("")
    elif query_name not in seen:
        raise PowerQueryNetError(f"No M code provided for query '{query_name}'.")

    mashup = "\r\n".join(definitions)
    if not mashup.endswith("\r\n"):
        mashup += "\r\n"
    return mashup


def _format_query_definition(name: str, expression: str) -> str:
    formatted_name = _format_query_name(name)
    normalized_expression = _normalize_line_endings(expression.strip())
    return f"shared {formatted_name} = {normalized_expression};"


def _format_query_name(name: str) -> str:
    escaped = name.replace('"', '""')
    if any(ch.isspace() for ch in escaped) or "#" in escaped:
        return f'#"{escaped}"'
    return escaped


def _normalize_line_endings(value: str) -> str:
    return value.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")


def _table_to_csv(table: DirectCommandTable) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(table.columns)
    for row in table.rows:
        writer.writerow(["" if cell is None else cell for cell in row])
    return buffer.getvalue()


def _table_to_html(table: DirectCommandTable) -> str:
    rows_html: List[str] = []
    header_cells = ''.join(f"<th>{html.escape(str(col))}</th>" for col in table.columns)
    rows_html.append(f"<tr>{header_cells}</tr>")

    for row in table.rows:
        cells = ''.join(
            f"<td>{html.escape('' if cell is None else str(cell))}</td>" for cell in row
        )
        rows_html.append(f"<tr>{cells}</tr>")

    body = "".join(rows_html)
    return f"<table>{body}</table>"


def _table_to_xml(table: DirectCommandTable) -> str:
    rows: List[str] = []
    for row in table.rows:
        columns = []
        for column_name, cell in zip(table.columns, row):
            safe_value = "" if cell is None else str(cell)
            columns.append(
                f"    <{_sanitize_xml_tag(column_name)}>{html.escape(safe_value)}</{_sanitize_xml_tag(column_name)}>")
        rows.append("  <Row>\n" + "\n".join(columns) + "\n  </Row>")
    return "<Rows>\n" + "\n".join(rows) + "\n</Rows>"


def _sanitize_xml_tag(value: str) -> str:
    sanitized = ''.join(ch for ch in value if ch.isalnum() or ch in ("_", "-"))
    return sanitized or "Column"


__all__ = [
    "Command",
    "CommandCredentials",
    "CommandResult",
    "ExecuteOutputFlags",
    "Queries",
    "Query",
    "SqlTableAction",
]


