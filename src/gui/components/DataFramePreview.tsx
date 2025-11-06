/**
 * Data frame preview grid with toolbar
 */

import React, { useState, useMemo, memo } from "react";
import "./DataFramePreview.css";

interface DataFramePreviewProps {
  data?: any[][];
  columns?: string[];
  rowCount?: number;
  columnCount?: number;
  onCancel?: () => void;
  onExport?: (format: "csv" | "xlsx" | "pbit") => void;
  onConnectExcel?: () => void;
  isExecuting?: boolean;
  isInitializing?: boolean;
}

// Memoized table row component for performance
const TableRow = memo(({ row, rowIdx }: { row: any[]; rowIdx: number }) => (
  <tr>
    {row.map((cell, cellIdx) => (
      <td key={cellIdx} className="dataframe-cell">
        {String(cell ?? "")}
      </td>
    ))}
  </tr>
));

TableRow.displayName = "TableRow";

// Memoized table header component
const TableHeader = memo(({ columns }: { columns: string[] }) => (
  <thead>
    <tr>
      {columns.map((col, idx) => (
        <th key={idx} className="dataframe-header">
          <div className="dataframe-header-content">
            <span>{col}</span>
            <button
              className="dataframe-header-menu"
              title="Column Menu"
            >
              ⋮
            </button>
          </div>
        </th>
      ))}
    </tr>
  </thead>
));

TableHeader.displayName = "TableHeader";

export const DataFramePreview = memo(function DataFramePreview({
  data = [],
  columns = [],
  rowCount = 0,
  columnCount = 0,
  onCancel,
  onExport,
  onConnectExcel,
  isExecuting = false,
  isInitializing = false,
}: DataFramePreviewProps) {
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [columnSearch, setColumnSearch] = useState("");
  const [showColumnSearch, setShowColumnSearch] = useState(false);
  const columnSearchRef = React.useRef<HTMLInputElement>(null);

  const handleExport = () => {
    // Show export menu or dialog
    const format = prompt("Export format (csv/xlsx/pbit):", "csv");
    if (format && (format === "csv" || format === "xlsx" || format === "pbit")) {
      onExport?.(format);
    }
  };

  const handleFindColumn = () => {
    setShowColumnSearch(true);
    setTimeout(() => columnSearchRef.current?.focus(), 0);
  };

  // Memoize expensive calculations
  const { previewData, previewColumns, displayedRows, totalRows, isDisabled } = useMemo(() => {
    const previewData = data.length > 0 ? data : [];
    const previewColumns =
      columns.length > 0
        ? columns
        : Array.from({ length: columnCount || 5 }, (_, i) => `Column${i + 1}`);
    const displayedRows = Math.min(previewData.length, 100);
    const totalRows = rowCount || previewData.length;
    const isDisabled = isInitializing || (data.length === 0 && !isExecuting);
    
    return { previewData, previewColumns, displayedRows, totalRows, isDisabled };
  }, [data, columns, columnCount, rowCount, isInitializing, isExecuting]);

  // Memoize the sliced data for table rendering (only first 100 rows)
  // Use a more efficient slice that avoids creating intermediate arrays
  const tableRows = useMemo(() => {
    if (previewData.length === 0) return [];
    const maxRows = Math.min(previewData.length, 100);
    // Direct array creation is faster than slice for small arrays
    if (previewData.length <= 100) return previewData;
    const result: any[][] = [];
    for (let i = 0; i < maxRows; i++) {
      result[i] = previewData[i];
    }
    return result;
  }, [previewData]);

  return (
    <div className={`dataframe-preview ${isDisabled ? "dataframe-preview-disabled" : ""}`}>
      <div className="dataframe-toolbar">
        {isExecuting ? (
          <button
            className="toolbar-button toolbar-button-danger"
            onClick={onCancel}
            title="Cancel Execution"
          >
            <span>⏹</span>
            <span>Cancel</span>
          </button>
        ) : null}

        <div className="toolbar-separator" />

        <button
          className={`toolbar-button ${filterEnabled ? "toolbar-button-active" : ""}`}
          onClick={() => setFilterEnabled(!filterEnabled)}
          title="Toggle Filter"
        >
          <span className="codicon">&#xea6b;</span>
          <span>Filter</span>
        </button>

        <button
          className="toolbar-button"
          onClick={handleFindColumn}
          title="Find Column (/)"
        >
          <span className="codicon">&#xea6d;</span>
          <span>Find Column</span>
        </button>
        {showColumnSearch && (
          <input
            ref={columnSearchRef}
            type="text"
            className="toolbar-column-search"
            placeholder="Search column..."
            value={columnSearch}
            onChange={(e) => setColumnSearch(e.target.value)}
            onBlur={() => {
              if (!columnSearch) {
                setShowColumnSearch(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setColumnSearch("");
                setShowColumnSearch(false);
              }
            }}
          />
        )}

        <div className="toolbar-separator" />

        <button
          className="toolbar-button"
          onClick={onConnectExcel}
          title="Connect Excel"
        >
          <span className="codicon">&#xea72;</span>
          <span>Connect Excel</span>
        </button>

        <button
          className="toolbar-button"
          onClick={handleExport}
          title="Export"
        >
          <span className="codicon">&#xea72;</span>
          <span>Export</span>
        </button>
      </div>

      <div className="dataframe-grid-container">
        {isInitializing ? (
          <div className="dataframe-empty">
            <div className="spinner-ring"></div>
          </div>
        ) : previewData.length === 0 ? (
          <div className="dataframe-empty">
            <p>No data to preview</p>
            <p className="dataframe-empty-hint">
              Connect to a data source or run a query to see results
            </p>
          </div>
        ) : (
          <table className="dataframe-grid">
            <TableHeader columns={previewColumns} />
            <tbody>
              {tableRows.map((row, rowIdx) => (
                <TableRow key={rowIdx} row={row} rowIdx={rowIdx} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer always visible - shows during initialization too */}
      <div className="dataframe-footer">
        {isInitializing 
          ? "Initializing..."
          : previewData.length === 0
            ? "No data"
            : displayedRows === 1
              ? "Showing 1 of 1 row"
              : `Showing ${displayedRows} of ${totalRows} rows`}
      </div>
    </div>
  );
});

