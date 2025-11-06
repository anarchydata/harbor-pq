/**
 * Keyboard shortcuts hook
 */

import { useEffect, useRef } from "react";

interface ShortcutHandlers {
  runAll?: () => void;
  renameAllSteps?: () => void;
  save?: () => void;
  switchQuery?: () => void;
  toggleLogPanel?: () => void;
  focusColumnSearch?: () => void;
  findInGrid?: () => void;
  selectAll?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Allow Ctrl+Enter in chat
        if (e.ctrlKey && e.key === "Enter" && target.tagName === "TEXTAREA") {
          // Let the textarea handle it
          return;
        }
        // Allow Ctrl+S, Ctrl+F in inputs
        if (
          (e.ctrlKey && e.key === "s") ||
          (e.ctrlKey && e.key === "f") ||
          (e.key === "Escape")
        ) {
          // Continue to handle these
        } else {
          return;
        }
      }

      // Editor shortcuts
      if (e.ctrlKey && e.key === "F5") {
        e.preventDefault();
        handlersRef.current.runAll?.();
        return;
      }

      // Ctrl+K R - Rename all steps
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        const handleR = (e2: KeyboardEvent) => {
          if (e2.key === "r" || e2.key === "R") {
            e2.preventDefault();
            handlersRef.current.renameAllSteps?.();
            document.removeEventListener("keydown", handleR);
          } else if (e2.key !== "k" && !e2.ctrlKey) {
            document.removeEventListener("keydown", handleR);
          }
        };
        document.addEventListener("keydown", handleR);
        return;
      }


      // Ctrl+S - Save
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        handlersRef.current.save?.();
        return;
      }

      // Ctrl+P - Switch query
      if (e.ctrlKey && e.key === "p") {
        e.preventDefault();
        handlersRef.current.switchQuery?.();
        return;
      }

      // F12 - Toggle log panel
      if (e.key === "F12") {
        e.preventDefault();
        handlersRef.current.toggleLogPanel?.();
        return;
      }

      // Grid shortcuts
      if (e.key === "/" && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        handlersRef.current.focusColumnSearch?.();
        return;
      }

      if (e.ctrlKey && e.key === "f" && target.tagName !== "TEXTAREA") {
        e.preventDefault();
        handlersRef.current.findInGrid?.();
        return;
      }

      // A - Select all (in grid)
      if (e.key === "a" && e.ctrlKey && target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
        e.preventDefault();
        handlersRef.current.selectAll?.();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

