/**
 * Error banner component for displaying parsing errors and stale data warnings
 */

import React from "react";
import "./ErrorBanner.css";

interface ErrorBannerProps {
  message: string;
  type?: "error" | "warning";
  onDismiss?: () => void;
}

export function ErrorBanner({ message, type = "error", onDismiss }: ErrorBannerProps) {
  return (
    <div className={`error-banner error-banner-${type}`}>
      <span className="error-banner-icon">{type === "error" ? "⚠" : "ℹ"}</span>
      <span className="error-banner-message">{message}</span>
      {onDismiss && (
        <button className="error-banner-dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}

