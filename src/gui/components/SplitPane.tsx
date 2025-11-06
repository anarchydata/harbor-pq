/**
 * Draggable split pane component
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import "./SplitPane.css";

interface SplitPaneProps {
  children: React.ReactNode;
  defaultSize?: number; // Percentage for first pane
  minSize?: number;
  maxSize?: number;
  direction?: "horizontal" | "vertical";
  onResize?: (size: number) => void;
  storageKey?: string;
}

export function SplitPane({
  children,
  defaultSize = 50,
  minSize = 10,
  maxSize = 90,
  direction = "horizontal",
  onResize,
  storageKey,
}: SplitPaneProps) {
  const [size, setSize] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) return parseFloat(saved);
    }
    return defaultSize;
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);

  const saveSize = useCallback(
    (newSize: number) => {
      setSize(newSize);
      if (storageKey) {
        localStorage.setItem(storageKey, newSize.toString());
      }
      onResize?.(newSize);
    },
    [storageKey, onResize]
  );

  // Update size if defaultSize changes externally
  useEffect(() => {
    if (defaultSize !== size && storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (!saved) {
        setSize(defaultSize);
      }
    }
  }, [defaultSize, storageKey, size]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // Only left mouse button
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      startPosRef.current = direction === "horizontal" ? e.clientX : e.clientY;
      startSizeRef.current = size;
      console.log("[SplitPane] Mouse down on gutter, starting drag");
    },
    [direction, size]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const containerSize =
        direction === "horizontal" ? containerRect.width : containerRect.height;
      const currentPos = direction === "horizontal" ? e.clientX : e.clientY;
      const startPos = startPosRef.current;

      const delta = currentPos - startPos;
      const deltaPercent = (delta / containerSize) * 100;
      const newSize = Math.max(
        minSize,
        Math.min(maxSize, startSizeRef.current + deltaPercent)
      );

      saveSize(newSize);
    },
    [isDragging, direction, minSize, maxSize, saveSize]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    saveSize(defaultSize);
  }, [defaultSize, saveSize]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor =
        direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp, direction]);

  const childrenArray = React.Children.toArray(children);
  if (childrenArray.length !== 2) {
    console.warn("SplitPane expects exactly 2 children");
    return <div>{children}</div>;
  }

  const isHorizontal = direction === "horizontal";
  const firstPaneStyle: React.CSSProperties = isHorizontal
    ? { width: `${size}%` }
    : { height: `${size}%` };
  const secondPaneStyle: React.CSSProperties = isHorizontal
    ? { width: `${100 - size}%` }
    : { height: `${100 - size}%` };

  // CRITICAL: Gutter MUST be visible from the start - use explicit inline styles
  const gutterStyle: React.CSSProperties = isHorizontal
    ? {
        width: '4px',
        minWidth: '4px',
        maxWidth: '4px',
        height: '100%',
        flexShrink: 0,
        flexGrow: 0,
        visibility: 'visible',
        display: 'block',
        opacity: 1,
        position: 'relative',
        zIndex: 100,
        background: 'var(--border, #3c3c3c)',
        cursor: 'col-resize',
      }
    : {
        height: '6px',
        minHeight: '6px',
        maxHeight: '6px',
        width: '100%',
        flexShrink: 0,
        flexGrow: 0,
        visibility: 'visible',
        display: 'block',
        opacity: 1,
        position: 'relative',
        zIndex: 100,
        background: 'var(--border, #3c3c3c)',
        cursor: 'row-resize',
        borderTop: '1px solid var(--border, #3c3c3c)',
        borderBottom: '1px solid var(--border, #3c3c3c)',
        boxSizing: 'border-box',
        margin: 0,
        padding: 0,
        alignSelf: 'stretch', // Force to stretch to container width
      };

  return (
    <div
      ref={containerRef}
      className={`split-pane ${isHorizontal ? "split-pane-horizontal" : "split-pane-vertical"}`}
      style={{ 
        display: 'flex', 
        height: '100%', 
        width: '100%',
        margin: 0,
        padding: 0,
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      <div className="split-pane-first" style={firstPaneStyle}>
        {childrenArray[0]}
      </div>
      <div
        className={`split-pane-gutter ${isDragging ? "split-pane-gutter-dragging" : ""}`}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        style={gutterStyle}
        title={direction === "horizontal" ? "Drag to resize horizontally" : "Drag to resize vertically"}
      />
      <div className="split-pane-second" style={secondPaneStyle}>
        {childrenArray[1]}
      </div>
    </div>
  );
}

