/**
 * Log panel component - displays main process logs inline
 */

import React, { useState, useEffect, useRef } from "react";
import "./LogPanel.css";

interface LogEntry {
  id: string;
  timestamp: number;
  level: "log" | "warn" | "error" | "info";
  message: string;
}

interface LogPanelProps {
  onClose?: () => void;
}

export function LogPanel({ onClose }: LogPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Listen for log messages from main process
    if (window.electronAPI?.onLogMessage) {
      const handleLogMessage = (logData: { level: string; message: string; timestamp?: number }) => {
        const newLog: LogEntry = {
          id: Date.now() + "-" + Math.random(),
          timestamp: logData.timestamp || Date.now(),
          level: (logData.level as LogEntry["level"]) || "log",
          message: logData.message || "",
        };
        setLogs((prev) => {
          const updated = [...prev, newLog];
          // Keep only last 1000 logs
          return updated.slice(-1000);
        });
      };

      window.electronAPI.onLogMessage(handleLogMessage);

      // Cleanup
      return () => {
        // Note: We can't easily remove listeners in the current setup
        // but this is fine since the component will unmount
      };
    }
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom
    if (autoScroll && logContentRef.current) {
      logContentRef.current.scrollTop = logContentRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const ms = date.getMilliseconds().toString().padStart(3, "0");
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) + "." + ms;
  };

  const getLogClass = (level: LogEntry["level"]) => {
    switch (level) {
      case "error":
        return "log-entry-error";
      case "warn":
        return "log-entry-warn";
      case "info":
        return "log-entry-info";
      default:
        return "log-entry-log";
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  return (
    <div className="log-panel">
      <div className="log-panel-header">
        <span className="log-panel-title">Main Process Logs</span>
        <div className="log-panel-actions">
          <label className="log-panel-toggle">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <button onClick={clearLogs} className="log-panel-button">
            Clear
          </button>
          {onClose && (
            <button onClick={onClose} className="log-panel-close" title="Close">
              ×
            </button>
          )}
        </div>
      </div>
      <div className="log-panel-content" ref={logContentRef}>
        {logs.length === 0 ? (
          <div className="log-panel-empty">No logs yet. Main process logs will appear here.</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className={`log-entry ${getLogClass(log.level)}`}>
              <span className="log-time">{formatTime(log.timestamp)}</span>
              <span className="log-level">[{log.level.toUpperCase()}]</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}


