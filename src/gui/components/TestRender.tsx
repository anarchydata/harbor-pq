/**
 * Simple test component to verify React is rendering
 */
import React from "react";

export function TestRender() {
  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "#ff0000",
      color: "#ffffff",
      padding: "20px",
      zIndex: 99999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "24px",
    }}>
      REACT IS RENDERING - If you see this, React works!
    </div>
  );
}

