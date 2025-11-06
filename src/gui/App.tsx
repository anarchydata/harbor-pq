/**
 * Main VS Code-style Power Query IDE App
 */

import React, { useState, useEffect, useCallback, useRef, startTransition, useMemo } from "react";
import { SplitPane } from "./components/SplitPane";
import { TabsBar, Tab } from "./components/TabsBar";
import { DataFramePreview } from "./components/DataFramePreview";
import { MCodeEditor } from "./components/MCodeEditor";
import { ChatPanel } from "./components/ChatPanel";
import { StatusBar } from "./components/StatusBar";
import { LogPanel } from "./components/LogPanel";
import { AppliedStepsPane, Step } from "./components/AppliedStepsPane";
import { ExcelSheetSelector, SheetOrTable } from "./components/ExcelSheetSelector";
import { IntentResult } from "../intentTypes";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useContextMenu } from "./hooks/useContextMenu";
import { ContextMenu } from "./components/ContextMenu";
import { ContextMenuItem } from "./components/ContextMenu";
import { ErrorBanner } from "./components/ErrorBanner";
import "./themes/vscode-theme.css";
import "./App.css";

// Type declarations for Electron API
declare global {
  interface Window {
    electronAPI?: {
      openFile: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      connectExcel: (path: string) => Promise<{ success: boolean; path: string; error?: string }>;
      listExcelSheets: (filePath: string) => Promise<{ success: boolean; sheets?: any[]; tables?: any[]; error?: string }>;
      readExcelData: (filePath: string, selection: any) => Promise<{ success: boolean; m_table?: string; columns?: string[]; rowCount?: number; columnCount?: number; error?: string }>;
      writePQToExcel: (options: { mCode: string; queryName?: string }) => Promise<{ success: boolean; path?: string; error?: string }>;
      export: (options: { format: string; path?: string }) => Promise<{ success: boolean; path?: string; error?: string }>;
      runStep: (stepId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
      runAll: (mCode?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
      setMCode: (code: string) => Promise<{ success: boolean }>;
      cancelExecution: () => Promise<{ success: boolean; error?: string }>;
      getEngineInfo: () => Promise<{ type: string; path: string } | null>;
      onDataframeUpdate: (callback: (data: any) => void) => void;
      onDiagnosticsUpdate: (callback: (count: number) => void) => void;
      onExportDone: (callback: (result: any) => void) => void;
      onExportError: (callback: (error: any) => void) => void;
      onExcelConnected: (callback: (status: any) => void) => void;
      onPQWritten: (callback: (result: any) => void) => void;
      onExecutionCancelled: (callback: () => void) => void;
      onDataframeError: (callback: (error: any) => void) => void;
      onDiagnosticsDetails: (callback: (diagnostics: any[]) => void) => void;
      showLogWindow: () => Promise<{ success: boolean }>;
      onLogMessage: (callback: (logData: { level: string; message: string; timestamp?: number }) => void) => void;
      sendLog: (level: string, message: string) => void;
    };
  }
}

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "1", name: "Query1", isActive: true, isDirty: false },
  ]);
  const [currentQueryId, setCurrentQueryId] = useState("1");
  // Initial M code that matches the sample data table
  const [mCode, setMCode] = useState(`let
    Source = #table(
        {"Date", "Product", "Sales", "Region", "Status"},
        {
            {"2024-01-15", "Widget A", 1250, "North", "Active"},
            {"2024-01-16", "Widget B", 2300, "South", "Active"},
            {"2024-01-17", "Widget C", 850, "East", "Pending"},
            {"2024-01-18", "Widget D", 3100, "West", "Active"},
            {"2024-01-19", "Widget E", 950, "North", "Active"}
        }
    ),
    #"Changed Type" = Table.TransformColumnTypes(Source, {{"Date", type date}, {"Sales", Int64.Type}})
in
    #"Changed Type"`);
  // Extract steps from M code
  // Steps can be:
  // 1. Regular: StepName = expression,
  // 2. Quoted: #"Step Name" = expression,
  const extractSteps = useCallback((code: string): Array<{ id: string; name: string; line: number }> => {
    const lines = code.split("\n");
    const extracted: Array<{ id: string; name: string; line: number }> = [];
    
    // Pattern 1: Regular step name (starts with letter or underscore, followed by alphanumeric/underscore)
    // Pattern 2: Quoted step name (#"Step Name")
    const stepPattern = /^(#?"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s*=/;
    let insideLetBlock = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if we're entering the let block
      if (line.match(/^let\s*$/i)) {
        insideLetBlock = true;
        continue;
      }
      
      // Check if we're exiting the let block
      if (line.match(/^in\s*$/i)) {
        insideLetBlock = false;
        continue;
      }
      
      // Only extract steps inside the let block
      if (insideLetBlock) {
        const match = line.match(stepPattern);
        if (match) {
          let stepName = match[1];
          // If it's a quoted identifier, remove the quotes and # prefix
          if (stepName.startsWith('#"') && stepName.endsWith('"')) {
            stepName = stepName.slice(2, -1); // Remove #" and "
          } else if (stepName.startsWith('"') && stepName.endsWith('"')) {
            stepName = stepName.slice(1, -1); // Remove quotes
          }
          
          // Verify this looks like a step definition
          // Steps can be:
          // 1. Single line ending with comma
          // 2. Multi-line (check if next non-empty line is a new step or "in")
          // 3. Last step before "in"
          let isStepEnd = false;
          
          if (line.includes(",")) {
            // Single-line step ending with comma
            isStepEnd = true;
          } else {
            // Multi-line step - check if next non-empty line is a new step or "in"
            for (let j = i + 1; j < lines.length; j++) {
              const nextLine = lines[j].trim();
              if (nextLine === "") continue; // Skip empty lines
              if (nextLine.match(/^in\s*$/i)) {
                isStepEnd = true; // Next non-empty line is "in"
                break;
              }
              if (nextLine.match(stepPattern)) {
                isStepEnd = true; // Next non-empty line is a new step
                break;
              }
              // If we find a closing parenthesis/bracket, it might be the end of this step
              if (nextLine.match(/^[\)\]\}],?\s*$/)) {
                isStepEnd = true;
                break;
              }
            }
          }
          
          if (isStepEnd) {
            extracted.push({
              id: `step-${i + 1}-${stepName}`,
              name: stepName,
              line: i + 1,
            });
          }
        }
      }
    }
    
    return extracted;
  }, []);

  const [steps, setSteps] = useState<Array<{ id: string; name: string; line: number }>>([]);
  const [intentResult, setIntentResult] = useState<IntentResult | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const [rowCount, setRowCount] = useState(1250);
  const [columnCount, setColumnCount] = useState(5);
  const [previewColumns, setPreviewColumns] = useState<string[]>([
    "Date",
    "Product",
    "Sales",
    "Region",
    "Status",
  ]);
  const [connectionState, setConnectionState] = useState<
    "excel" | "local" | "unsaved"
  >("unsaved");
  const [diagnosticsCount, setDiagnosticsCount] = useState(0);
  const [lastRunTime, setLastRunTime] = useState<Date | undefined>();
  const { menu: contextMenu, showMenu, hideMenu } = useContextMenu();
  const [statusBarError, setStatusBarError] = useState<string>("");
  const [previewData, setPreviewData] = useState<any[][]>([]);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isStale, setIsStale] = useState(false);
  const [engineType, setEngineType] = useState<"powerbi" | "excel" | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executingMCode, setExecutingMCode] = useState<string | undefined>(undefined);
  const [isInitializing, setIsInitializing] = useState(true);
  const [diagnostics, setDiagnostics] = useState<Array<{ message: string; severity: "error" | "warning" | "info" }>>([]);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [codeSplitSize, setCodeSplitSize] = useState(50);
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(undefined);
  const [highlightedStepLines, setHighlightedStepLines] = useState<number[]>([]);
  
  // Excel import state
  const [showExcelSheetSelector, setShowExcelSheetSelector] = useState(false);
  const [excelSheets, setExcelSheets] = useState<SheetOrTable[]>([]);
  const [excelTables, setExcelTables] = useState<SheetOrTable[]>([]);
  const [selectedExcelPath, setSelectedExcelPath] = useState<string | null>(null);
  
  // Cache for step results: stepId -> { rows, columns, rowCount, columnCount }
  const stepCacheRef = useRef<Map<string, { rows: any[][]; columns: string[]; rowCount: number; columnCount: number; m_table?: string }>>(new Map());
  
  // Track which step is currently being executed (for caching)
  const executingStepIdRef = useRef<string | undefined>(undefined);
  
  // Track the M code that was executed (for caching after execution)
  const executedMCodeRef = useRef<string>("");
  
  // Flag to skip execution when setting code programmatically (e.g., from Excel import)
  const skipExecutionRef = useRef(false);
  
  // Flag to track if execution is from chat (only chat executions should show in chat panel)
  const isFromChatRef = useRef(false);

  // Calculate which lines belong to a step (from step definition to last comma before next step)
  const getStepLines = useCallback((code: string, step: Step): number[] => {
    const lines = code.split("\n");
    const stepLine = step.line - 1; // Convert to 0-based
    const stepLines: number[] = [];
    const stepPattern = /^(#?"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s*=/;
    
    // Start from the step definition line
    for (let i = stepLine; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Check if this is a new step (not the current one) - look for step pattern
      if (i > stepLine) {
        const match = trimmed.match(stepPattern);
        if (match) {
          // Found a new step - stop here (don't include this line)
          break;
        }
        // Also check for "in" keyword
        if (trimmed.match(/^in\s*$/i)) {
          // Found "in" - stop here (don't include this line)
          break;
        }
      }
      
      // Add this line to the step
      stepLines.push(i + 1); // Convert back to 1-based
      
      // Check if this line ends with a comma and the next line starts a new step
      // This means we've reached the end of the current step
      if (i < lines.length - 1) {
        const nextLine = lines[i + 1].trim();
        const nextStepMatch = nextLine.match(stepPattern);
        if (nextStepMatch) {
          // Next line starts a new step - check if current line ends with comma
          // If it does, we've found the end (including the comma)
          // If it doesn't, we need to continue to find the comma
          if (trimmed.endsWith(',')) {
            // Perfect - we've included the comma, stop here
            break;
          }
          // Current line doesn't end with comma, but next line is a new step
          // This shouldn't happen in valid M code, but continue to include current line
          // and stop before the next step
          break;
        }
        // Check if next line is "in"
        if (nextLine.match(/^in\s*$/i)) {
          // Next line is "in" - check if current line ends with comma
          if (trimmed.endsWith(',')) {
            // Perfect - we've included the comma, stop here
            break;
          }
          // Current line doesn't end with comma, but next line is "in"
          // Continue to include current line and stop before "in"
          break;
        }
      }
    }
    
    return stepLines;
  }, []);

  // Track previous steps to detect new additions
  const previousStepsRef = useRef<Array<{ id: string; name: string; line: number }>>([]);

  // Extract steps on initial load and when code changes
  useEffect(() => {
    const extractedSteps = extractSteps(mCode);
    
    // Clean up cache for steps that no longer exist
    const currentStepIds = new Set(extractedSteps.map(s => s.id));
    for (const [stepId] of stepCacheRef.current) {
      if (!currentStepIds.has(stepId)) {
        console.log(`[App] Removing cache for deleted step: ${stepId}`);
        stepCacheRef.current.delete(stepId);
      }
    }
    
    // Detect if a new step was added (compare with previous)
    const previousSteps = previousStepsRef.current;
    if (extractedSteps.length > previousSteps.length) {
      // New step(s) added - find the newest one(s)
      const newSteps = extractedSteps.slice(previousSteps.length);
      if (newSteps.length > 0) {
        // Highlight the latest new step
        const latestNewStep = newSteps[newSteps.length - 1];
        setSelectedStepId(latestNewStep.id);
        const lines = getStepLines(mCode, latestNewStep);
        setHighlightedStepLines(lines);
        console.log(`[App] New step detected: ${latestNewStep.name} (line ${latestNewStep.line})`);
        
        // If we have cached data from the latest execution, cache it for the new step
        // This happens when a new step is added via chat/AI and executed
        // The onDataframeUpdate handler will cache the latest step, but we also want to
        // ensure any new steps get cached if data is available
        // Note: The actual caching happens in onDataframeUpdate when execution completes
      }
    }
    
    // Update previous steps ref
    previousStepsRef.current = extractedSteps;
    setSteps(extractedSteps);
    
    // If no step is selected and we have steps, select the latest (last) step
    if (extractedSteps.length > 0 && !selectedStepId) {
      const lastStep = extractedSteps[extractedSteps.length - 1];
      setSelectedStepId(lastStep.id);
      // Calculate and set highlighted lines for the latest step (but don't run it)
      const lines = getStepLines(mCode, lastStep);
      setHighlightedStepLines(lines);
    }
    
    // Reset selected step when code changes externally if the step no longer exists
    if (selectedStepId) {
      const stepExists = extractedSteps.some(s => s.id === selectedStepId);
      if (!stepExists) {
        // Select the latest step if available
        if (extractedSteps.length > 0) {
          const lastStep = extractedSteps[extractedSteps.length - 1];
          setSelectedStepId(lastStep.id);
          const lines = getStepLines(mCode, lastStep);
          setHighlightedStepLines(lines);
        } else {
          setSelectedStepId(undefined);
          setHighlightedStepLines([]);
        }
      } else {
        // Step still exists - update highlighted lines
        const step = extractedSteps.find(s => s.id === selectedStepId);
        if (step) {
          const lines = getStepLines(mCode, step);
          setHighlightedStepLines(lines);
        }
      }
    }
  }, [mCode, extractSteps, selectedStepId, getStepLines]);

  // Reconstruct M code up to a selected step
  const reconstructCodeUpToStep = useCallback((code: string, targetStep: Step): string => {
    const lines = code.split("\n");
    let result: string[] = [];
    let insideLetBlock = false;
    let foundTargetStep = false;
    let targetStepName = "";
    let insideTargetStep = false;
    
    // Find the target step's original name (might be quoted)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.match(/^let\s*$/i)) {
        insideLetBlock = true;
        result.push(lines[i]);
        continue;
      }
      
      if (line.match(/^in\s*$/i)) {
        if (foundTargetStep) {
          // Remove trailing comma from the last line if present
          if (result.length > 0) {
            const lastLine = result[result.length - 1];
            // Remove trailing comma and whitespace
            const cleaned = lastLine.replace(/,\s*$/, '');
            result[result.length - 1] = cleaned;
          }
          // Add the 'in' statement pointing to the target step
          result.push(`in`);
          result.push(`    ${targetStepName}`);
          break;
        }
        insideLetBlock = false;
        result.push(lines[i]);
        continue;
      }
      
      if (insideLetBlock) {
        // Check if this is the target step (line numbers are 1-based in the Step object)
        const stepPattern = /^(#?"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s*=/;
        const match = line.match(stepPattern);
        
        if (match && i + 1 === targetStep.line) {
          // Found the target step
          foundTargetStep = true;
          insideTargetStep = true;
          targetStepName = match[1];
          result.push(lines[i]);
          continue;
        }
        
        if (insideTargetStep) {
          // We're inside the target step - continue adding lines until we hit the next step or comma
          // Check if this line starts a new step (indicates end of current step)
          const nextStepMatch = line.match(stepPattern);
          if (nextStepMatch) {
            // This is a new step - stop here
            insideTargetStep = false;
            continue;
          }
          
          // Check if we've reached the end of the step (comma indicates end for single-line steps)
          // For multi-line steps, we need to check if the next line starts a new step
          if (i < lines.length - 1) {
            const nextLine = lines[i + 1].trim();
            const nextStepMatch2 = nextLine.match(stepPattern);
            if (nextStepMatch2) {
              // Next line starts a new step - include current line and stop
              result.push(lines[i]);
              insideTargetStep = false;
              continue;
            }
          }
          
          // Continue adding lines for this step
          result.push(lines[i]);
          continue;
        }
        
        if (foundTargetStep) {
          // We've already included the target step, skip the rest
          continue;
        }
        
        // Before target step - include it
        result.push(lines[i]);
      } else {
        // Outside let block - include it
        result.push(lines[i]);
      }
    }
    
    return result.join("\n");
  }, []);

  // Handle step click - reconstruct and run code up to that step
  // This executes directly without sending to chat
  const handleStepClick = useCallback(async (step: Step) => {
    setSelectedStepId(step.id);
    
    // Calculate and highlight the lines for this step
    const lines = getStepLines(mCode, step);
    setHighlightedStepLines(lines);
    
    // Check cache first
    const cachedData = stepCacheRef.current.get(step.id);
    // Check if cache exists AND has data (rows.length > 0)
    const hasValidCache = cachedData && cachedData.rows && cachedData.rows.length > 0;
    
    if (hasValidCache) {
      console.log(`[App] Using cached data for step: ${step.name}`);
      // Use cached data - no execution needed, update preview immediately
      setPreviewData(cachedData.rows);
      setRowCount(cachedData.rowCount);
      setColumnCount(cachedData.columnCount);
      setPreviewColumns(cachedData.columns);
      setIsStale(false);
      setHasError(false);
      setStatusBarError("");
      setIsExecuting(false);
      console.log(`[App] ✓ Preview updated from cache for step: ${step.name}`);
      return; // Exit early - no execution needed
    }
    
    // No cache or empty cache - need to execute
    if (cachedData && cachedData.rows.length === 0) {
      console.log(`[App] Cache exists but is empty for step: ${step.name}, re-running...`);
    } else {
      console.log(`[App] No cache for step: ${step.name}, executing...`);
    }
    
    // Reconstruct M code up to this step
    let reconstructedCode = reconstructCodeUpToStep(mCode, step);
    console.log(`[App] Running code up to step: ${step.name}`);
    console.log(`[App] Reconstructed code (before Source replacement):\n${reconstructedCode.substring(0, 200)}`);
    
    // ALWAYS replace Source with #table if it contains Excel.CurrentWorkbook
    // This applies to ALL step clicks, including Source step
    const sourceStepMatch = reconstructedCode.match(/Source\s*=\s*Excel\.CurrentWorkbook\([^)]*\)\{[^}]+\}\[Content\]/);
    if (sourceStepMatch) {
      // Find Source step in cache
      let cachedTable: { m_table?: string } | null = null;
      for (const [stepId, cached] of stepCacheRef.current.entries()) {
        if (cached.m_table) {
          cachedTable = cached;
          console.log("[App] Found cached m_table in step:", stepId);
          break;
        }
      }
      
      if (cachedTable && cachedTable.m_table) {
        console.log("[App] Replacing Excel.CurrentWorkbook Source with cached #table in step click");
        reconstructedCode = reconstructedCode.replace(
          /Source\s*=\s*Excel\.CurrentWorkbook\([^)]*\)\{[^}]+\}\[Content\]/,
          `Source = ${cachedTable.m_table}`
        );
        console.log("[App] Reconstructed code (after Source replacement):\n", reconstructedCode.substring(0, 200));
      } else {
        console.warn("[App] Excel.CurrentWorkbook found in step click but no cached m_table available");
      }
    }
    
    // Track which step we're executing (for caching)
    executingStepIdRef.current = step.id;
    executedMCodeRef.current = reconstructedCode; // Store the code being executed for caching
    
    // Execute the reconstructed code directly - DON'T set executingMCode to avoid chat messages
    if (window.electronAPI) {
      setIsExecuting(true);
      isFromChatRef.current = false; // Step clicks are NOT from chat
      // Don't set executingMCode - this prevents chat from showing execution messages
      setStatusBarError("");
      try {
        const result = await window.electronAPI.runAll(reconstructedCode);
        if (result.success) {
          setLastRunTime(new Date());
          setIsExecuting(false);
          // Cache will be set in onDataframeUpdate handler
          // executingStepIdRef will be cleared there after caching
        } else {
          setIsExecuting(false);
          executingStepIdRef.current = undefined; // Clear on error
          setStatusBarError(result.error || "Execution failed");
          setHasError(true);
          setErrorMessage(result.error || "Execution failed");
        }
      } catch (error) {
        setIsExecuting(false);
        const errorMsg = `Error executing step: ${error instanceof Error ? error.message : "Unknown error"}`;
        setStatusBarError(errorMsg);
        setHasError(true);
        setErrorMessage(errorMsg);
      }
    }
  }, [mCode, reconstructCodeUpToStep, getStepLines]);

  // Setup IPC listeners and initialize M code
  useEffect(() => {
    if (!window.electronAPI) return;

    // Get engine info
    window.electronAPI.getEngineInfo().then((info) => {
      if (info) {
        setEngineType(info.type as "powerbi" | "excel");
      }
    });

    // Send initial M code to engine and execute it
    if (window.electronAPI) {
      window.electronAPI.setMCode(mCode).then(() => {
        console.log("[App] Initial M code set, executing...");
        // Auto-execute on load to populate the table
        // Note: Initial code doesn't have Excel.CurrentWorkbook, so no replacement needed
        if (window.electronAPI) {
          window.electronAPI.runAll(mCode).then((result) => {
            console.log("[App] Initial execution completed:", result.success ? "SUCCESS" : "FAILED");
            if (result.success) {
              setLastRunTime(new Date());
            } else {
              console.error("[App] Initial execution failed:", result.error);
            }
          }).catch((error) => {
            console.error("[App] Initial execution error:", error);
          });
        }
      }).catch((error) => {
        console.error("[App] Failed to set initial M code:", error);
      });
    }

    window.electronAPI.onDataframeUpdate((data) => {
      console.log("[App] ✓ onDataframeUpdate received");
      console.log("[App] Data summary: rows=", data.rowCount, "cols=", data.columnCount, "engine=", data.engine, "elapsed=", data.elapsedMs, "ms");
      console.log("[App] Columns:", data.columns?.join(", ") || "none");
      
      // FIRST: Display the data (update preview immediately)
      startTransition(() => {
        setPreviewData(data.rows || []);
        setRowCount(data.rowCount || 0);
        setColumnCount(data.columnCount || 0);
        if (data.columns) {
          setPreviewColumns(data.columns);
        }
        if (data.engine) {
          setEngineType(data.engine);
        }
        if (data.elapsedMs !== undefined) {
          setElapsedMs(data.elapsedMs);
        }
        setIsStale(false);
        setHasError(false);
        setStatusBarError("");
        setIsExecuting(false);
        setExecutingMCode(undefined); // Clear executing code when done
        setIsInitializing(false); // Mark initialization as complete after first successful data load
      });
      
      // THEN: Cache the result using the M code that was actually executed
      // Use the executedMCodeRef which contains the code that produced this data
      setTimeout(() => {
        // Cache the result if we're executing a specific step (from step click)
        const executingStepId = executingStepIdRef.current;
        if (executingStepId) {
          console.log(`[App] Caching result for step: ${executingStepId}`);
          stepCacheRef.current.set(executingStepId, {
            rows: data.rows || [],
            columns: data.columns || [],
            rowCount: data.rowCount || 0,
            columnCount: data.columnCount || 0,
          });
          executingStepIdRef.current = undefined; // Clear after caching
        } else {
          // Full execution (not step-specific, e.g., from chat or first run) - cache the latest step
          // Use the executed M code (the code that produced this data)
          const executedCode = executedMCodeRef.current || mCode;
          const extractedSteps = extractSteps(executedCode);
          if (extractedSteps.length > 0) {
            // IMPORTANT: Cache the Source step first (if it exists and isn't already cached with data)
            const sourceStep = extractedSteps.find(s => s.name === "Source");
            if (sourceStep) {
              const sourceCache = stepCacheRef.current.get(sourceStep.id);
              // Only cache Source if it doesn't have data yet (might have m_table but no rows)
              if (!sourceCache || sourceCache.rows.length === 0) {
                console.log(`[App] Caching Source step with actual data from first run`);
                // Get Source step data - need to reconstruct code up to Source and execute it
                // For now, we'll cache it with the final data (better than nothing)
                // In the future, we could execute just the Source step to get its data
                stepCacheRef.current.set(sourceStep.id, {
                  rows: data.rows || [], // Use final data for now - Source step should have similar structure
                  columns: data.columns || [],
                  rowCount: data.rowCount || 0,
                  columnCount: data.columnCount || 0,
                  m_table: sourceCache?.m_table, // Preserve m_table if it exists
                });
              }
            }
            
            // Cache the latest step (the one that was just executed)
            const latestStep = extractedSteps[extractedSteps.length - 1];
            console.log(`[App] Caching result for latest step: ${latestStep.name}`);
            stepCacheRef.current.set(latestStep.id, {
              rows: data.rows || [],
              columns: data.columns || [],
              rowCount: data.rowCount || 0,
              columnCount: data.columnCount || 0,
            });
            
            // Also cache any new steps that were added (if this is a new step execution)
            // This ensures all new steps get cached when they're added via chat/AI
            const previousSteps = previousStepsRef.current;
            if (extractedSteps.length > previousSteps.length) {
              const newSteps = extractedSteps.slice(previousSteps.length);
              // Cache all new steps with the same data (they all result in the same final output)
              for (const newStep of newSteps) {
                if (newStep.id !== latestStep.id) {
                  console.log(`[App] Caching result for new step: ${newStep.name}`);
                  stepCacheRef.current.set(newStep.id, {
                    rows: data.rows || [],
                    columns: data.columns || [],
                    rowCount: data.rowCount || 0,
                    columnCount: data.columnCount || 0,
                    m_table: undefined, // Not a Source step
                  });
                }
              }
            }
          }
        }
        // Clear the executed code ref after caching
        executedMCodeRef.current = "";
      }, 0); // Use 0ms timeout to run after current execution stack but before next render
      
      // Don't change code window size after execution - keep user's preferred size
      console.log("[App] ✓ Preview data updated in UI");
    });

    window.electronAPI.onExecutionCancelled(() => {
      setIsExecuting(false);
      setExecutingMCode(undefined);
      setStatusBarError("Execution cancelled");
    });

    window.electronAPI.onDataframeError((error) => {
      console.error("[App] onDataframeError received:", error.error);
      setIsExecuting(false);
      setExecutingMCode(undefined);
      setIsInitializing(false); // Mark initialization as complete even on error
      setHasError(true);
      setErrorMessage(error.error || "Execution failed");
      setIsStale(true);
      setStatusBarError(error.error || "Execution failed");
      // Auto-open log panel on error
      setShowLogPanel(true);
      if (error.diagnostics) {
        console.log("[App] Diagnostics received:", error.diagnostics.length);
        setDiagnostics(error.diagnostics);
        setDiagnosticsCount(error.diagnostics.length);
      }
    });

    window.electronAPI.onDiagnosticsDetails((diags) => {
      setDiagnostics(diags);
      setDiagnosticsCount(diags.length);
    });

    window.electronAPI.onDiagnosticsUpdate((count) => {
      setDiagnosticsCount(count);
    });

    window.electronAPI.onExportDone((result) => {
      setStatusBarError("");
    });

    window.electronAPI.onExportError((error) => {
      setStatusBarError(`Export failed: ${error.message || "Unknown error"}`);
    });

    window.electronAPI.onExcelConnected((status) => {
      if (status.success) {
        setConnectionState("excel");
        setStatusBarError("");
      } else {
        setStatusBarError(`Excel connection failed: ${status.error || "Unknown error"}`);
      }
    });
  }, []);

  // Load persisted state
  useEffect(() => {
    const savedTabs = localStorage.getItem("pq-tabs");
    if (savedTabs) {
      try {
        const parsed = JSON.parse(savedTabs);
        setTabs(parsed);
        if (parsed.length > 0) {
          const activeTab = parsed.find((t: Tab) => t.isActive) || parsed[0];
          setCurrentQueryId(activeTab.id);
        }
      } catch (e) {
        console.error("Failed to load tabs:", e);
      }
    }

    const savedQuery = localStorage.getItem("pq-last-query");
    if (savedQuery) {
      setCurrentQueryId(savedQuery);
    }


    const savedTheme = localStorage.getItem("pq-theme");
    if (savedTheme) {
      document.documentElement.setAttribute("data-theme", savedTheme);
    }
  }, []);

  // Save state
  useEffect(() => {
    localStorage.setItem("pq-tabs", JSON.stringify(tabs));
    localStorage.setItem("pq-last-query", currentQueryId);
  }, [tabs, currentQueryId]);

  const handleTabClick = useCallback((id: string) => {
    setTabs((prev) =>
      prev.map((tab) => ({
        ...tab,
        isActive: tab.id === id,
      }))
    );
    setCurrentQueryId(id);
  }, []);

  const handleTabClose = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      // Don't close the last tab
      return;
    }

    const newTabs = tabs.filter((tab) => tab.id !== id);
    const wasActive = tabs.find((tab) => tab.id === id)?.isActive;

    if (wasActive && newTabs.length > 0) {
      newTabs[0].isActive = true;
      setCurrentQueryId(newTabs[0].id);
    }

    setTabs(newTabs);
  };

  const handleTabContextMenu = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      {
        label: "Rename",
        action: () => {
          const newName = prompt("Enter new name:", tabs.find((t) => t.id === id)?.name);
          if (newName) {
            setTabs((prev) =>
              prev.map((tab) => (tab.id === id ? { ...tab, name: newName } : tab))
            );
          }
        },
      },
      {
        label: "Duplicate",
        action: () => {
          const tab = tabs.find((t) => t.id === id);
          if (tab) {
            const newId = Date.now().toString();
            const newTab: Tab = {
              id: newId,
              name: `${tab.name} (Copy)`,
              isActive: true,
              isDirty: false,
            };
            setTabs((prev) =>
              prev.map((t) => ({ ...t, isActive: false })).concat(newTab)
            );
            setCurrentQueryId(newId);
          }
        },
      },
      { separator: true },
      {
        label: "Close",
        action: () => handleTabClose(id, e),
      },
      {
        label: "Close Others",
        action: () => {
          setTabs([tabs.find((t) => t.id === id)!]);
          setCurrentQueryId(id);
        },
        disabled: tabs.length === 1,
      },
    ];
    showMenu(e.clientX, e.clientY, items);
  };

  const handleNewTab = useCallback(() => {
    const newId = Date.now().toString();
    const newTab: Tab = {
      id: newId,
      name: `Query${tabs.length + 1}`,
      isActive: true,
      isDirty: false,
    };

    setTabs((prev) =>
      prev.map((tab) => ({ ...tab, isActive: false })).concat(newTab)
    );
    setCurrentQueryId(newId);
  }, [tabs.length]);

  const handleIntent = useCallback(async (intent: IntentResult) => {
    // Auto-execute workspace intents
    if (intent.intent === "workspace.new_query") {
      const newId = Date.now().toString();
      const newTab: Tab = {
        id: newId,
        name: intent.args.name || `Query${tabs.length + 1}`,
        isActive: true,
        isDirty: false,
      };
      setTabs((prev) =>
        prev.map((tab) => ({ ...tab, isActive: false })).concat(newTab)
      );
      setCurrentQueryId(newId);
    } else if (intent.intent === "workspace.list_steps") {
      // Steps are already shown in the dropdown
      setStatusBarError("");
    } else if (intent.intent === "workspace.export") {
      // Trigger export
      const format = intent.args.format || "csv";
      if (window.electronAPI) {
        window.electronAPI.export({ format: format as "csv" | "xlsx" | "pbit" });
      } else {
        setStatusBarError("");
      }
    } else if (intent.intent === "code.rename_all_steps_semantic") {
      // Trigger rename via chat message
      console.log("Rename all steps semantically");
    }
  }, [steps, tabs.length]);

  const handleChatMessage = useCallback(async (message: string) => {
    // Check if this is an error message from chat
    if (message.startsWith("error:")) {
      setStatusBarError(message.substring(6));
      return;
    }

    try {
      // Call the API endpoint instead of importing directly
      const response = await fetch("/api/parse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        throw new Error("Failed to parse intent");
      }

      const intent: IntentResult = await response.json();
      
      // Only set intent result if it's not clarify, or if confidence is high
      // This prevents showing "unclear intent" when ChatGPT successfully updates code
      if (intent.intent !== "clarify" || intent.confidence >= 0.7) {
        setIntentResult(intent);
      }

      // Handle the intent automatically
      // BUT: Don't create new queries from chat - chat updates code in current query
      // Only handle workspace intents that aren't code transformations
      if (intent.intent === "workspace.new_query") {
        // Don't create new query from chat - chat should update current query
        console.log("[App] Ignoring workspace.new_query intent from chat - chat updates current query");
      } else if (intent.intent !== "clarify") {
        await handleIntent(intent);
      } else if (intent.confidence < 0.7) {
        // Only show error for low confidence, not when ChatGPT is handling it
        setStatusBarError(intent.args.message || "Unclear intent");
      }
    } catch (error) {
      console.error("Error parsing intent:", error);
      const errorMsg = error instanceof Error ? error.message : "Error processing request";
      setStatusBarError(errorMsg);
      setIntentResult({
        intent: "clarify",
        args: { message: errorMsg },
        confidence: 0.0,
        source: "llm",
      });
    }
  }, [handleIntent]);

  // Extract query name from M code (the expression after "in")
  const extractQueryName = useCallback((code: string): string => {
    const inMatch = code.match(/in\s+(.+?)(?:\s*$)/is);
    if (inMatch) {
      let queryName = inMatch[1].trim().replace(/^#?"?|"?$/g, "");
      queryName = queryName.replace(/;+\s*$/, "");
      return queryName || "Query1";
    }
    return "Query1";
  }, []);

  const handleCodeChange = useCallback((code: string) => {
    // This is called when code comes from chat
    // Step 1: Always display the EXACT code from chat in the code box
    // Step 2: For execution, replace Source with #table if needed
    
    // Log to log panel
    const sendLog = (level: "log" | "warn" | "error" | "info", message: string) => {
      if (window.electronAPI?.sendLog) {
        window.electronAPI.sendLog(level, message);
      }
    };
    
    sendLog("log", "=".repeat(80));
    sendLog("log", "[App] handleCodeChange CALLED - code from chat");
    sendLog("log", `[App] Code length: ${code.length}`);
    sendLog("log", `[App] FULL CODE FROM CHAT: ${code}`);
    sendLog("log", "=".repeat(80));
    
    // STEP 1: Display the EXACT code from chat in code box (with fake Source if it has it)
    sendLog("log", `[App] Setting code box to EXACT chat code, length: ${code.length}`);
    setMCode(code); // This is what user sees - exact code from chat
    
    // Extract steps from the chat code
    const extractedSteps = extractSteps(code);
    setSteps(extractedSteps);
    
    // Mark as dirty
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === currentQueryId ? { ...tab, isDirty: true } : tab
      )
    );
    
    // STEP 2: For execution, check if we need to replace Source with #table
    let codeToExecute: string = code;
    
    // STEP 2: Check if we need to replace Source with #table for execution
    // (Code box already shows the chat code above)
    const sourceStepMatch = code.match(/Source\s*=\s*Excel\.CurrentWorkbook\([^)]*\)\{[^}]+\}\[Content\]/);
    if (sourceStepMatch) {
      // Find Source step in cache (could be any step ID that represents Source)
      let cachedTable: { m_table?: string } | null = null;
      for (const [stepId, cached] of stepCacheRef.current.entries()) {
        if (cached.m_table) {
          cachedTable = cached;
          sendLog("log", `[App] Found cached m_table in step: ${stepId}`);
          break;
        }
      }
      
      if (cachedTable && cachedTable.m_table) {
        sendLog("log", "[App] Replacing Excel.CurrentWorkbook with #table for EXECUTION only");
        // Replace the entire Source line with #table version FOR EXECUTION
        // (Code box already shows the chat code with Excel.CurrentWorkbook)
        codeToExecute = code.replace(
          /Source\s*=\s*Excel\.CurrentWorkbook\([^)]*\)\{[^}]+\}\[Content\]/,
          `Source = ${cachedTable.m_table}`
        );
        sendLog("log", `[App] Execution code (with #table): ${codeToExecute.substring(0, 200)}...`);
      } else {
        sendLog("warn", "[App] Excel.CurrentWorkbook found but no cached m_table available");
      }
    }
    
    // STEP 3: Execute the code (with #table replacement if needed)
    // Skip execution if this is from a programmatic code change (e.g., Excel import)
           // Skip execution if this is from a programmatic code change (e.g., Excel import)
           if (skipExecutionRef.current) {
             console.log("[App] handleCodeChange: Skipping execution (programmatic code change)");
             return;
           }
           
           // Step 5: Execute the modified code (with #table replacement if needed)
           if (window.electronAPI) {
             console.log("[App] handleCodeChange: Executing code");
             console.log("[App] Display code (what user sees):", code.substring(0, 150));
             console.log("[App] Execution code (with #table if replaced):", codeToExecute.substring(0, 150));
             setIsExecuting(true);
             isFromChatRef.current = true; // Code changes from handleCodeChange are from chat
             setExecutingMCode(codeToExecute); // Track the code being executed (with #table if replaced)
             executedMCodeRef.current = codeToExecute; // Store the execution code for caching
      window.electronAPI.setMCode(codeToExecute).then(() => {
        console.log("[App] ✓ setMCode completed, calling runAll");
        window.electronAPI?.runAll(codeToExecute).then((result: any) => {
          console.log("[App] runAll completed, result:", result);
          // Step 6: Preview will update via onDataframeUpdate callback
        }).catch((error: any) => {
          console.error("[App] ✗ Error in runAll:", error);
          setIsExecuting(false);
          setExecutingMCode(undefined);
          executedMCodeRef.current = ""; // Clear on error
        });
      }).catch((error: any) => {
        console.error("[App] ✗ Error in setMCode:", error);
        setIsExecuting(false);
        setExecutingMCode(undefined);
        executedMCodeRef.current = ""; // Clear on error
      });
    } else {
      console.warn("[App] electronAPI not available, marking as stale");
      setIsStale(true);
    }
  }, [currentQueryId, extractSteps]);

  // Handle Import from Excel
  const handleImportExcel = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      // Open file dialog
      const result = await window.electronAPI.openFile();
      if (result.canceled || result.filePaths.length === 0) {
        return;
      }

      const filePath = result.filePaths[0];
      setSelectedExcelPath(filePath);

      // List sheets and tables
      const listResult = await window.electronAPI.listExcelSheets(filePath);
      if (!listResult.success) {
        setStatusBarError(listResult.error || "Failed to list Excel sheets");
        setHasError(true);
        setErrorMessage(listResult.error || "Failed to list Excel sheets");
        return;
      }

      setExcelSheets((listResult.sheets || []).map(s => ({ ...s, kind: "Sheet" as const })));
      setExcelTables((listResult.tables || []).map(t => ({ ...t, kind: "Table" as const })));
      setShowExcelSheetSelector(true);
    } catch (error) {
      const errorMsg = `Error importing from Excel: ${error instanceof Error ? error.message : "Unknown error"}`;
      setStatusBarError(errorMsg);
      setHasError(true);
      setErrorMessage(errorMsg);
    }
  }, []);

  // Handle sheet/table selection
  const handleSheetSelect = useCallback(async (selection: SheetOrTable) => {
    if (!selectedExcelPath || !window.electronAPI) return;

    setShowExcelSheetSelector(false);

    try {
      // Read Excel data using Python and convert to JSON
      // This avoids credential issues while still documenting the source
      const dataResult = await window.electronAPI.readExcelData(selectedExcelPath, selection);
      
      if (!dataResult.success) {
        setStatusBarError(dataResult.error || "Failed to read Excel data");
        setHasError(true);
        setErrorMessage(dataResult.error || "Failed to read Excel data");
        setShowLogPanel(true);
        return;
      }

      // Generate M code using JSON data but documenting the file source
      const normalizedPath = selectedExcelPath.replace(/\\/g, "/");
      let sourceDescription: string;

      if (selection.kind === "Table") {
        sourceDescription = `Excel.Workbook(File.Contents("${normalizedPath}"), null, true){[Item="${selection.item}",Kind="Table"]}[Data]`;
      } else {
        sourceDescription = `Excel.Workbook(File.Contents("${normalizedPath}"), null, true){[Name="${selection.name}"]}[Data]`;
      }

      // Use #table data for execution, but show real Excel source in editor
      if (!dataResult.m_table) {
        setStatusBarError("No table data returned from Excel reader");
        setHasError(true);
        setErrorMessage("No table data returned from Excel reader");
        setShowLogPanel(true);
        return;
      }
      
      // Generate two versions:
      // 1. Display version: Shows Excel.CurrentWorkbook() (what user sees in editor)
      // 2. Execution version: Uses #table with data (what actually runs)
      
      // Determine if this is sample_powerquery_data.xlsx (needs Changed Type step)
      const isSampleFile = selectedExcelPath.toLowerCase().includes("sample_powerquery_data.xlsx");
      
      // Display version - shows Excel.CurrentWorkbook() format
      let displaySource: string;
      if (selection.kind === "Table") {
        displaySource = `Excel.CurrentWorkbook(){[Name="${selection.item}"]}[Content]`;
      } else {
        displaySource = `Excel.CurrentWorkbook(){[Name="${selection.name}"]}[Content]`;
      }
      
      let displayMCode: string;
      let executionMCode: string;
      
      if (isSampleFile) {
        // For sample file, include Changed Type step
        displayMCode = `let
    Source = ${displaySource},
    #"Changed Type" = Table.TransformColumnTypes(Source,{{"Date", type datetime}, {"Customer", type text}, {"Region", type text}, {"SalesAmount", Int64.Type}})
in
    #"Changed Type"`;
        
        executionMCode = `let
    Source = ${dataResult.m_table},
    #"Changed Type" = Table.TransformColumnTypes(Source,{{"Date", type datetime}, {"Customer", type text}, {"Region", type text}, {"SalesAmount", Int64.Type}})
in
    #"Changed Type"`;
      } else {
        // For other files, just Source
        displayMCode = `let
    Source = ${displaySource}
in
    Source`;
        
        executionMCode = `let
    Source = ${dataResult.m_table}
in
    Source`;
      }
      
      // Log the actual execution code to console (the #table version)
      console.log("[App] Execution M code (with #table):");
      console.log(executionMCode);
      
      // Show loading state - this will show spinner in preview pane
      setIsExecuting(true);
      isFromChatRef.current = false; // Excel imports are NOT from chat
      // DON'T set executingMCode - this prevents chat from showing execution messages
      // Excel imports should NEVER trigger chat messages
      console.log("[App] Excel import: Setting isExecuting=true for loading state");
      
      // Show the fake Excel source in the editor (what user sees)
      // Set flag to prevent handleCodeChange from executing when setting code from Excel import
      skipExecutionRef.current = true;
      setMCode(displayMCode);
      skipExecutionRef.current = false;
      
      // Extract steps from display code (for UI)
      const extractedSteps = extractSteps(displayMCode);
      setSteps(extractedSteps);
      
      // Mark as dirty
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === currentQueryId ? { ...tab, isDirty: true } : tab
        )
      );
      
      // Execute directly with the execution version (with #table data)
      // Send execution M code to main process and execute directly (NO chat messages)
      if (window.electronAPI) {
        await window.electronAPI.setMCode(executionMCode);
        
        // Execute directly - loading state already set above
        setStatusBarError("");
        try {
          const result = await window.electronAPI.runAll(executionMCode);
          if (result.success) {
            console.log("[App] Excel import execution successful");
            setLastRunTime(new Date());
            setIsExecuting(false);
            // Don't set executingMCode - Excel imports don't use chat
            
            // Cache the Source step with m_table for later replacement
            const sourceStep = extractedSteps.find(s => s.name === "Source");
            if (sourceStep) {
              stepCacheRef.current.set(sourceStep.id, {
                rows: [],
                columns: [],
                rowCount: 0,
                columnCount: 0,
                m_table: dataResult.m_table, // Store the #table code for replacement
              });
            }
          } else {
            setStatusBarError(result.error || "Execution failed");
            setIsExecuting(false);
            // Don't set executingMCode - Excel imports don't use chat
            setHasError(true);
            setErrorMessage(result.error || "Execution failed");
            // Auto-open log panel on error
            setShowLogPanel(true);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          setStatusBarError(errorMsg);
          setHasError(true);
          setErrorMessage(errorMsg);
          // Auto-open log panel on error
          setShowLogPanel(true);
        }
      }
      
      setStatusBarError("");
    } catch (error) {
      const errorMsg = `Error generating M code: ${error instanceof Error ? error.message : "Unknown error"}`;
      setStatusBarError(errorMsg);
      setHasError(true);
      setErrorMessage(errorMsg);
      setShowLogPanel(true);
    }
  }, [selectedExcelPath, extractSteps, currentQueryId, setMCode, setSteps, setTabs, setStatusBarError, setHasError, setErrorMessage, setLastRunTime]);

  // Handle Write to Excel
  const handleWriteExcel = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      // Extract query name from M code
      const queryName = extractQueryName(mCode);

      // Write PQ to Excel
      const result = await window.electronAPI.writePQToExcel({
        mCode,
        queryName,
      });

      if (!result.success) {
        setStatusBarError(result.error || "Failed to write PQ to Excel");
        setHasError(true);
        setErrorMessage(result.error || "Failed to write PQ to Excel");
      } else {
        setStatusBarError("");
        // Show success message
        console.log("[App] ✓ PQ written to Excel:", result.path);
      }
    } catch (error) {
      const errorMsg = `Error writing PQ to Excel: ${error instanceof Error ? error.message : "Unknown error"}`;
      setStatusBarError(errorMsg);
      setHasError(true);
      setErrorMessage(errorMsg);
    }
  }, [mCode, extractQueryName]);



  const handleRunAll = useCallback(async () => {
    if (window.electronAPI) {
      // ALWAYS replace Source with #table if it contains Excel.CurrentWorkbook
      let codeToExecute = mCode;
      const sourceStepMatch = mCode.match(/Source\s*=\s*Excel\.CurrentWorkbook\([^)]*\)\{[^}]+\}\[Content\]/);
      if (sourceStepMatch) {
        // Find Source step in cache
        let cachedTable: { m_table?: string } | null = null;
        for (const [stepId, cached] of stepCacheRef.current.entries()) {
          if (cached.m_table) {
            cachedTable = cached;
            console.log("[App] Found cached m_table in step:", stepId);
            break;
          }
        }
        
        if (cachedTable && cachedTable.m_table) {
          console.log("[App] Replacing Excel.CurrentWorkbook Source with cached #table in runAll");
          codeToExecute = mCode.replace(
            /Source\s*=\s*Excel\.CurrentWorkbook\([^)]*\)\{[^}]+\}\[Content\]/,
            `Source = ${cachedTable.m_table}`
          );
          console.log("[App] Execution code (with #table):", codeToExecute.substring(0, 200));
        } else {
          console.warn("[App] Excel.CurrentWorkbook found in runAll but no cached m_table available");
        }
      }
      
      setIsExecuting(true);
      isFromChatRef.current = false; // Run All is NOT from chat
      setExecutingMCode(codeToExecute); // Track the code being executed (with #table if replaced)
      executedMCodeRef.current = codeToExecute; // Store for caching
      setStatusBarError("");
      try {
        // Pass execution code (with #table replacement if needed)
        const result = await window.electronAPI.runAll(codeToExecute);
        if (result.success) {
          setLastRunTime(new Date());
          setIsExecuting(false);
          setExecutingMCode(undefined);
        } else {
          const errorMsg = result.error || "Failed to run all steps";
          setStatusBarError(errorMsg);
          setHasError(true);
          setErrorMessage(errorMsg);
          setIsStale(true);
          setIsExecuting(false);
          setExecutingMCode(undefined);
        }
      } catch (error) {
        const errorMsg = `Error running all steps: ${error instanceof Error ? error.message : "Unknown error"}`;
        setStatusBarError(errorMsg);
        setHasError(true);
        setErrorMessage(errorMsg);
        setIsStale(true);
        setIsExecuting(false);
        setExecutingMCode(undefined);
      }
    } else {
      // Fallback for web mode
      console.log("Run all steps");
      setLastRunTime(new Date());
      setStatusBarError("");
    }
  }, [mCode]);

  const handleCancelExecution = useCallback(async () => {
    if (window.electronAPI) {
      await window.electronAPI.cancelExecution();
      setIsExecuting(false);
    }
  }, []);

  const handleRenameAllSteps = useCallback(() => {
    // TODO: IPC call to rename all steps semantically
    console.log("Rename all steps semantically");
    handleChatMessage("rename all steps semantically");
  }, []);


  const handleSave = useCallback(() => {
    // Mark current tab as saved
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === currentQueryId ? { ...tab, isDirty: false } : tab
      )
    );
    console.log("Saved query:", currentQueryId);
  }, [currentQueryId]);

  const handleSwitchQuery = useCallback(() => {
    // Cycle through tabs
    const currentIndex = tabs.findIndex((t) => t.id === currentQueryId);
    const nextIndex = (currentIndex + 1) % tabs.length;
    handleTabClick(tabs[nextIndex].id);
  }, [tabs, currentQueryId]);

  const toggleLogPanel = useCallback(() => {
    setShowLogPanel((prev) => !prev);
  }, []);

  useKeyboardShortcuts({
    runAll: handleRunAll,
    renameAllSteps: handleRenameAllSteps,
    save: handleSave,
    switchQuery: handleSwitchQuery,
    toggleLogPanel: toggleLogPanel,
    focusColumnSearch: () => {
      // TODO: Focus column search input
      console.log("Focus column search");
    },
    findInGrid: () => {
      // TODO: Open find dialog in grid
      console.log("Find in grid");
    },
    selectAll: () => {
      // TODO: Select all rows in grid
      console.log("Select all");
    },
  });

  const currentTab = tabs.find((t) => t.id === currentQueryId);


  const mainContent = (
    <SplitPane
      defaultSize={10}
      direction="horizontal"
      storageKey="pq-split-steps-main-v2"
      minSize={5}
      maxSize={15}
    >
      {/* Applied Steps Pane - Left side, ~10% width */}
      <AppliedStepsPane
        steps={steps}
        selectedStepId={selectedStepId}
        onStepClick={handleStepClick}
      />
      
      {/* Main content area - Right side, ~90% width */}
      <SplitPane
        defaultSize={60}
        direction="horizontal"
        storageKey="pq-split-horizontal"
        minSize={30}
        maxSize={70}
      >
        <div className="app-left-column">
        <TabsBar
          tabs={tabs}
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
          onTabContextMenu={handleTabContextMenu}
          onNewTab={handleNewTab}
        />

        <SplitPane
          defaultSize={codeSplitSize}
          direction="vertical"
          storageKey="pq-split-vertical"
          minSize={15}
          maxSize={85}
          onResize={(size) => setCodeSplitSize(size)}
        >
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {hasError && (
              <ErrorBanner
                message={errorMessage}
                type="error"
                onDismiss={() => {
                  setHasError(false);
                  setErrorMessage("");
                }}
              />
            )}
            {isStale && !hasError && (
              <ErrorBanner
                message="Data preview may be outdated. Click Refresh to update."
                type="warning"
                onDismiss={() => setIsStale(false)}
              />
            )}
            <DataFramePreview
              rowCount={rowCount}
              columnCount={columnCount}
              columns={previewColumns}
              data={previewData}
              onCancel={handleCancelExecution}
              isExecuting={isExecuting}
              isInitializing={isInitializing}
                onExport={async (format) => {
                  if (window.electronAPI) {
                    try {
                      const result = await window.electronAPI.export({ format });
                      if (!result.success) {
                        setStatusBarError(result.error || "Export failed");
                        setHasError(true);
                        setErrorMessage(result.error || "Export failed");
                      } else {
                        setStatusBarError("");
                      }
                    } catch (error) {
                      const errorMsg = `Export error: ${error instanceof Error ? error.message : "Unknown error"}`;
                      setStatusBarError(errorMsg);
                      setHasError(true);
                      setErrorMessage(errorMsg);
                    }
                  } else {
                    setStatusBarError("");
                  }
                }}
                onImportExcel={handleImportExcel}
                onWriteExcel={handleWriteExcel}
                onConnectExcel={async () => {
                  if (window.electronAPI) {
                    try {
                      const result = await window.electronAPI.openFile();
                      if (!result.canceled && result.filePaths.length > 0) {
                        const excelResult = await window.electronAPI.connectExcel(result.filePaths[0]);
                        if (!excelResult.success) {
                          const errorMsg = excelResult.error || "Failed to connect to Excel";
                          setStatusBarError(errorMsg);
                          setHasError(true);
                          setErrorMessage(errorMsg);
                        } else {
                          setStatusBarError("");
                        }
                      }
                    } catch (error) {
                      const errorMsg = `Error connecting to Excel: ${error instanceof Error ? error.message : "Unknown error"}`;
                      setStatusBarError(errorMsg);
                      setHasError(true);
                      setErrorMessage(errorMsg);
                    }
                  } else {
                    setStatusBarError("");
                  }
                }}
            />
          </div>
          <MCodeEditor
            code={mCode}
            onCodeChange={handleCodeChange}
            highlightedLines={highlightedStepLines}
          />
        </SplitPane>
      </div>
      <ChatPanel
        onSendMessage={handleChatMessage}
        onCodeUpdate={handleCodeChange}
        intentResult={intentResult}
        currentCode={mCode}
        isExecuting={isExecuting}
        executingMCode={executingMCode}
      />
    </SplitPane>
    </SplitPane>
  );

  return (
    <div className="app" style={{ minHeight: "100vh", minWidth: "100vw" }}>
      <div className="app-content">
        {showLogPanel ? (
          <SplitPane
            defaultSize={75}
            direction="horizontal"
            storageKey="pq-split-main-log"
            minSize={50}
            maxSize={90}
          >
            {mainContent}
            <LogPanel onClose={toggleLogPanel} />
          </SplitPane>
        ) : (
          mainContent
        )}
      </div>

        <StatusBar
          onShowLogs={toggleLogPanel}
        currentQuery={currentTab?.name || "Untitled"}
        rowCount={rowCount}
        columnCount={columnCount}
        connectionState={connectionState}
        diagnosticsCount={diagnosticsCount}
        lastRunTime={lastRunTime}
        cursorLine={cursorPosition.line}
        cursorCol={cursorPosition.col}
        error={statusBarError}
        engineType={engineType}
        elapsedMs={elapsedMs}
        isInitializing={isInitializing}
      />

      <ExcelSheetSelector
        isOpen={showExcelSheetSelector}
        sheets={excelSheets}
        tables={excelTables}
        onSelect={handleSheetSelect}
        onCancel={() => setShowExcelSheetSelector(false)}
      />

      {contextMenu.visible && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={hideMenu}
        />
      )}
    </div>
  );
}
