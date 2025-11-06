/**
 * VS Code-style status bar
 */

import React from "react";
import "./StatusBar.css";

interface StatusBarProps {
  currentQuery?: string;
  currentStep?: string;
  rowCount?: number;
  columnCount?: number;
  connectionState?: "excel" | "local" | "unsaved";
  diagnosticsCount?: number;
  lastRunTime?: Date;
  cursorLine?: number;
  cursorCol?: number;
  error?: string;
  engineType?: "powerbi" | "excel" | null;
  elapsedMs?: number;
  onShowLogs?: () => void;
  isInitializing?: boolean;
}

export function StatusBar({
  currentQuery = "Untitled",
  currentStep,
  rowCount = 0,
  columnCount = 0,
  connectionState = "unsaved",
  diagnosticsCount = 0,
  lastRunTime,
  cursorLine = 1,
  cursorCol = 1,
  error,
  engineType,
  elapsedMs,
  onShowLogs,
  isInitializing = false,
}: StatusBarProps) {
  const formatConnectionState = () => {
    switch (connectionState) {
      case "excel":
        return "Excel connected";
      case "local":
        return "Local file";
      default:
        return "Unsaved";
    }
  };

  const formatLastRunTime = () => {
    if (!lastRunTime) return "";
    const now = new Date();
    const diff = now.getTime() - lastRunTime.getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {isInitializing ? (
          <span className="status-bar-item status-bar-initializing">
            Initializing...
          </span>
        ) : (
          <>
            <span className="status-bar-item">
              {currentQuery}
              {currentStep && ` • ${currentStep}`}
            </span>
            {(rowCount > 0 || columnCount > 0) && (
              <span className="status-bar-item">
                {rowCount.toLocaleString()} rows × {columnCount} cols
              </span>
            )}
          </>
        )}
      </div>

      <div className="status-bar-center">
        <span
          className={`status-bar-item status-bar-connection status-bar-connection-${connectionState}`}
        >
          {formatConnectionState()}
        </span>
        {engineType && (
          <span className="status-bar-item" title="Mashup Engine">
            Engine: {engineType === "powerbi" ? "Power BI" : "Excel"}
          </span>
        )}
        {elapsedMs !== undefined && elapsedMs > 0 && (
          <span className="status-bar-item" title="Execution time">
            {elapsedMs}ms
          </span>
        )}
      </div>

      <div className="status-bar-right">
        {error && (
          <span className="status-bar-item status-bar-error" title={error}>
            ⚠ {error.length > 50 ? error.substring(0, 50) + "..." : error}
          </span>
        )}
        {diagnosticsCount > 0 && !error && (
          <span className="status-bar-item status-bar-error">
            ⚠
            {diagnosticsCount} problems
          </span>
        )}
        {lastRunTime && !error && (
          <span className="status-bar-item">{formatLastRunTime()}</span>
        )}
        {!error && (
          <>
            <span className="status-bar-item">
              Ln {cursorLine}, Col {cursorCol}
            </span>
            {onShowLogs && (
              <span 
                className="status-bar-item status-bar-clickable" 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  console.log("[StatusBar] Logs button clicked");
                  onShowLogs();
                }}
                title="Show main process logs"
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                📋 Logs
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

