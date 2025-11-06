/**
 * Data frame preview grid with toolbar
 */

import React, { useState } from "react";
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

export function DataFramePreview({
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

  // Sample data for preview
  const previewData = data.length > 0 ? data : [];
  const previewColumns =
    columns.length > 0
      ? columns
      : Array.from({ length: columnCount || 5 }, (_, i) => `Column${i + 1}`);

  const isDisabled = isInitializing || (data.length === 0 && !isExecuting);
  
  // Calculate actual number of rows being displayed (max 100 for preview)
  const displayedRows = Math.min(previewData.length, 100);
  const totalRows = rowCount || previewData.length;

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
            <thead>
              <tr>
                {previewColumns.map((col, idx) => (
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
            <tbody>
              {previewData.slice(0, 100).map((row, rowIdx) => (
                <tr key={rowIdx}>
                  {row.map((cell, cellIdx) => (
                    <td key={cellIdx} className="dataframe-cell">
                      {String(cell ?? "")}
                    </td>
                  ))}
                </tr>
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
}

