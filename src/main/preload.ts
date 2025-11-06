/**
 * Electron preload script
 * Provides safe IPC bridge between renderer and main process
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // File operations
  openFile: () => ipcRenderer.invoke("open-file"),
  connectExcel: (path: string) => ipcRenderer.invoke("connect-excel", path),
  listExcelSheets: (filePath: string) => ipcRenderer.invoke("list-excel-sheets", filePath),
  readExcelData: (filePath: string, selection: any) => ipcRenderer.invoke("read-excel-data", filePath, selection),
  writePQToExcel: (options: { filePath: string; mCode: string; queryName?: string }) =>
    ipcRenderer.invoke("write-pq-to-excel", options),
  export: (options: { format: string; path?: string }) =>
    ipcRenderer.invoke("export", options),

  // Execution
  runStep: (stepId: string) => ipcRenderer.invoke("run-step", stepId),
  runAll: (mCode?: string) => ipcRenderer.invoke("run-all", mCode),
  setMCode: (code: string) => ipcRenderer.invoke("set-mcode", code),
  cancelExecution: () => ipcRenderer.invoke("cancel-execution"),
  getEngineInfo: () => ipcRenderer.invoke("get-engine-info"),
    showLogWindow: () => ipcRenderer.invoke("show-log-window"),
    closeLogWindow: () => ipcRenderer.send("close-log-window"),

  // Listeners
  onDataframeUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on("dataframe:update", (event, data) => callback(data));
  },
  onDiagnosticsUpdate: (callback: (count: number) => void) => {
    ipcRenderer.on("diagnostics:update", (event, count) => callback(count));
  },
  onExportDone: (callback: (result: any) => void) => {
    ipcRenderer.on("export:done", (event, result) => callback(result));
  },
  onExportError: (callback: (error: any) => void) => {
    ipcRenderer.on("export:error", (event, error) => callback(error));
  },
  onExcelConnected: (callback: (status: any) => void) => {
    ipcRenderer.on("excel:connected", (event, status) => callback(status));
  },
  onPQWritten: (callback: (result: any) => void) => {
    ipcRenderer.on("pq:written", (event, result) => callback(result));
  },
  onExecutionCancelled: (callback: () => void) => {
    ipcRenderer.on("execution:cancelled", () => callback());
  },
  onDataframeError: (callback: (error: any) => void) => {
    ipcRenderer.on("dataframe:error", (event, error) => callback(error));
  },
  onDiagnosticsDetails: (callback: (diagnostics: any[]) => void) => {
    ipcRenderer.on("diagnostics:details", (event, diagnostics) => callback(diagnostics));
  },
      onLogMessage: (callback: (logData: { level: string; message: string; timestamp?: number }) => void) => {
        ipcRenderer.on("log:message", (event, logData) => callback(logData));
      },
      sendLog: (level: string, message: string) => {
        ipcRenderer.send("renderer:log", { level, message, timestamp: Date.now() });
      },
});

