/**
 * Electron main process
 */

import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { Request, Response } from "express";
import { parseUserIntent } from "../intentParser";
import OpenAI from "openai";
import { executeMCode } from "./mCodeEngine";
import { discoverMashupEngine, getCachedEngine, MashupEngineInfo } from "./mashupDiscovery";
import { MashupRunner, MashupRequest, MashupResponse } from "./mashupRunner";
import { executeWithDirectCommand, isDirectCommandAvailable } from "./directCommandRunner";

// Load environment variables
try {
  require("dotenv").config();
  console.log("Environment variables loaded from .env file");
} catch (e) {
  console.warn("Could not load .env file, using system environment variables");
}

let mainWindow: BrowserWindow | null = null;
let logWindow: BrowserWindow | null = null;
let currentRunner: MashupRunner | null = null;
let engineInfo: MashupEngineInfo | null = null;

// Helper to send logs to renderer (main window or log window)
let isLogging = false;
function sendLogToRenderer(level: "log" | "warn" | "error" | "info", message: string) {
  if (isLogging) return; // Prevent recursion
  
  const logData = {
    level,
    message,
    timestamp: Date.now(),
  };
  
  // Send to main window if it exists (for inline log panel)
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const webContents = mainWindow.webContents;
      if (webContents && !webContents.isDestroyed()) {
        webContents.send("log:message", logData);
      }
    } catch (e: any) {
      // Silently ignore errors
    }
  }
  
  // Also send to separate log window if it exists (fallback)
  if (logWindow && !logWindow.isDestroyed()) {
    try {
      const webContents = logWindow.webContents;
      if (webContents && !webContents.isDestroyed()) {
        webContents.send("log:message", logData);
      }
    } catch (e: any) {
      // If sending fails, the window might be closing - clear the reference
      if (e && (e.message?.includes("destroyed") || e.message?.includes("closed") || e.code === "ERR_IPC_CHANNEL_CLOSED")) {
        logWindow = null;
      }
    }
  }
}

// Override console methods to also send to renderer
const originalConsoleLog = console.log.bind(console);
const originalConsoleWarn = console.warn.bind(console);
const originalConsoleError = console.error.bind(console);

console.log = (...args: any[]) => {
  isLogging = true;
  originalConsoleLog(...args);
  isLogging = false;
  sendLogToRenderer("log", args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" "));
};

console.warn = (...args: any[]) => {
  isLogging = true;
  originalConsoleWarn(...args);
  isLogging = false;
  sendLogToRenderer("warn", args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" "));
};

console.error = (...args: any[]) => {
  isLogging = true;
  originalConsoleError(...args);
  isLogging = false;
  sendLogToRenderer("error", args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" "));
};

// Discover Mashup Engine on startup
function initializeMashupEngine() {
  console.log("[Electron] Initializing Mashup Engine discovery...");
  engineInfo = discoverMashupEngine();
  if (engineInfo) {
    console.log(`[Electron] ✓ Mashup Engine initialized: ${engineInfo.type} at ${engineInfo.path}`);
  } else {
    console.warn("[Electron] ✗ Mashup Engine not found - will fall back to custom engine");
  }
}

function createLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.focus();
    return;
  }

  logWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    backgroundColor: "#1e1e1e",
    title: "Main Process Logs",
    frame: true, // Keep frame for title bar
    autoHideMenuBar: true, // Hide menu bar
    webPreferences: {
      nodeIntegration: true, // Need this for require('electron') in the HTML
      contextIsolation: false, // Need this for direct ipcRenderer access
    },
    show: false,
  });

  // Load log viewer HTML
  logWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Main Process Logs</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      background: #1e1e1e;
      color: #cccccc;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      padding: 8px 12px;
      padding-right: 40px;
      background: #252526;
      border-bottom: 1px solid #3e3e3e;
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 36px;
      -webkit-app-region: drag;
      position: relative;
    }
    .title { font-weight: 600; }
    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
      -webkit-app-region: no-drag;
    }
    .close-button {
      position: absolute;
      top: 0;
      right: 0;
      width: 46px;
      height: 36px;
      background: transparent;
      border: none;
      color: #cccccc;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      -webkit-app-region: no-drag;
      transition: background-color 0.2s;
    }
    .close-button:hover {
      background: #e81123;
      color: white;
    }
    .toggle {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      cursor: pointer;
    }
    button {
      background: transparent;
      border: 1px solid #3e3e3e;
      color: #cccccc;
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
      border-radius: 2px;
    }
    button:hover { background: #2a2d2e; }
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 4px;
    }
    .empty {
      padding: 20px;
      text-align: center;
      color: #858585;
      font-style: italic;
    }
    .log-entry {
      display: flex;
      gap: 8px;
      padding: 2px 4px;
      line-height: 1.4;
      word-break: break-all;
      font-size: 11px;
    }
    .log-entry:hover { background: rgba(255, 255, 255, 0.1); }
    .log-time {
      color: #858585;
      min-width: 80px;
      flex-shrink: 0;
    }
    .log-level {
      min-width: 60px;
      flex-shrink: 0;
      font-weight: 600;
    }
    .log-message { flex: 1; white-space: pre-wrap; }
    .log-entry-log .log-level { color: #cccccc; }
    .log-entry-info .log-level { color: #4ec9b0; }
    .log-entry-warn .log-level { color: #dcdcaa; }
    .log-entry-error .log-level { color: #f48771; }
    .log-entry-error .log-message { color: #f48771; }
  </style>
</head>
<body>
  <div class="header">
    <span class="title">Main Process Logs</span>
    <div class="actions">
      <label class="toggle">
        <input type="checkbox" id="autoScroll" checked>
        Auto-scroll
      </label>
      <button onclick="clearLogs()">Clear</button>
    </div>
    <button class="close-button" onclick="window.closeWindow()" title="Close">×</button>
  </div>
  <div class="content" id="logContent">
    <div class="empty">No logs yet. Main process logs will appear here.</div>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const logContent = document.getElementById('logContent');
    const autoScrollCheckbox = document.getElementById('autoScroll');
    let logs = [];
    let autoScroll = true;

    function formatTime(timestamp) {
      const date = new Date(timestamp);
      const ms = date.getMilliseconds().toString().padStart(3, '0');
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }) + '.' + ms;
    }

    function getLogClass(level) {
      switch(level) {
        case 'error': return 'log-entry-error';
        case 'warn': return 'log-entry-warn';
        case 'info': return 'log-entry-info';
        default: return 'log-entry-log';
      }
    }

    function renderLogs() {
      if (logs.length === 0) {
        logContent.innerHTML = '<div class="empty">No logs yet. Main process logs will appear here.</div>';
        return;
      }
      logContent.innerHTML = logs.map(log => \`
        <div class="log-entry \${getLogClass(log.level)}">
          <span class="log-time">\${formatTime(log.timestamp)}</span>
          <span class="log-level">[\${log.level.toUpperCase()}]</span>
          <span class="log-message">\${log.message}</span>
        </div>
      \`).join('');
      if (autoScroll) {
        logContent.scrollTop = logContent.scrollHeight;
      }
    }

      function clearLogs() {
        logs = [];
        renderLogs();
      }

      function closeWindow() {
        try {
          // Use IPC to close the window from main process
          ipcRenderer.send('close-log-window');
        } catch (e) {
          console.error('Failed to close window:', e);
        }
      }

      // Make closeWindow available globally
      window.closeWindow = closeWindow;

      autoScrollCheckbox.addEventListener('change', (e) => {
        autoScroll = e.target.checked;
      });

      ipcRenderer.on('log:message', (event, logData) => {
      logs.push({
        id: Date.now() + '-' + Math.random(),
        timestamp: logData.timestamp || Date.now(),
        level: logData.level || 'log',
        message: logData.message || ''
      });
      if (logs.length > 1000) {
        logs = logs.slice(-1000);
      }
      renderLogs();
    });
  </script>
</body>
</html>
  `)}`);

  logWindow.once("ready-to-show", () => {
    try {
      if (logWindow && !logWindow.isDestroyed()) {
        console.log("[Electron] Log window ready to show");
        // Only show when explicitly requested via IPC handler
        // The IPC handler will call show() explicitly
      }
    } catch (e) {
      console.error("[Electron] Error in log window ready-to-show:", e);
    }
  });

  logWindow.on("close", (event) => {
    // Allow the window to close normally
    // Clear the reference immediately to prevent further messages
    console.log("[Electron] Log window closing...");
  });

  logWindow.on("closed", () => {
    console.log("[Electron] Log window closed");
    // Clear reference after window is fully closed
    logWindow = null;
  });

  // Handle window destruction errors gracefully
  logWindow.webContents.on("render-process-gone", (event, details) => {
    console.warn("[Electron] Log window render process gone:", details.reason);
    // Clear reference if renderer crashed
    if (details.reason === "crashed" || details.reason === "killed") {
      logWindow = null;
    }
  });

  // Prevent JavaScript errors in the log window from showing dialogs
  logWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    // Suppress error dialogs - just log it
    console.error("[Electron] Log window load error:", errorCode, errorDescription);
  });

  // Suppress console errors in the log window (optional - can be removed if not needed)
  // Note: console-message is deprecated, but we'll handle errors via window error handlers in HTML
}

function createWindow() {
  // Initialize Mashup Engine discovery
  initializeMashupEngine();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    titleBarStyle: "default",
    show: false, // Don't show until ready
  });

  // Start local Express server for the app
  const express = require("express");
  const expressApp = express();
  
  // Serve static files from dist/gui
  expressApp.use(express.static(path.join(__dirname, "../gui")));
  expressApp.use(express.static(path.join(__dirname, "../..")));
  expressApp.use(express.json());

  // Initialize OpenAI client for Azure OpenAI
  const apiKey = process.env.OPENAI_API_KEY || "";
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT || "";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-35-turbo";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview";
  
  console.log(`OpenAI API key configured: ${apiKey ? "Yes (length: " + apiKey.length + ")" : "No"}`);
  console.log(`Azure OpenAI endpoint: ${azureEndpoint || "Not set"}`);
  console.log(`Deployment: ${deployment}`);
  
  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: azureEndpoint ? `${azureEndpoint}openai/deployments/${deployment}` : undefined,
    defaultQuery: azureEndpoint ? { "api-version": apiVersion } : undefined,
    defaultHeaders: azureEndpoint ? { "api-key": apiKey } : undefined,
  });

  // API endpoint for intent parsing
  expressApp.post("/api/parse", async (req: Request, res: Response) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }
      const result = await parseUserIntent(message);
      res.json(result);
    } catch (error) {
      console.error("Error parsing intent:", error);
      res.status(500).json({
        intent: "clarify",
        args: { message: "Error processing request" },
        confidence: 0.0,
        source: "llm",
      });
    }
  });

  // Test endpoint for M code execution
  expressApp.post("/api/test-mcode", async (req: Request, res: Response) => {
    try {
      console.log("[TEST API] Received test M code request");
      const { mCode } = req.body;
      
      if (!mCode || typeof mCode !== "string") {
        return res.status(400).json({ error: "M code is required" });
      }

      // Discover engine if not already done
      if (!engineInfo) {
        engineInfo = discoverMashupEngine();
      }

      if (!engineInfo) {
        console.log("[TEST API] Mashup Engine not found, using custom engine");
        const result = executeMCode(mCode);
        return res.json({
          success: true,
          engine: "custom",
          rows: result.rows.length,
          columns: result.columns.length,
          data: result.rows.slice(0, 5), // First 5 rows
        });
      }

      console.log(`[TEST API] Using Mashup Engine: ${engineInfo.type} at ${engineInfo.path}`);
      
      const runner = new MashupRunner({
        enginePath: engineInfo.path,
        engineType: engineInfo.type,
      });

      // Extract entry point
      const inMatch = mCode.match(/in\s+(.+?)(?:\s*$)/is);
      const entryPoint = inMatch?.[1]?.trim().replace(/^#?"?|"?$/g, "") || "Query1";

      const request: MashupRequest = {
        mText: mCode,
        entry: entryPoint,
        settings: {
          rowLimit: 10, // Just 10 rows for testing
          timeoutMs: 10000,
        },
      };

      console.log("[TEST API] Executing M code...");
      const response = await runner.execute(request);
      console.log("[TEST API] Execution result:", response.ok ? "SUCCESS" : "FAILED");

      if (response.ok && response.rows && response.schema) {
        return res.json({
          success: true,
          engine: response.engine,
          rows: response.rows.length,
          columns: response.schema.length,
          schema: response.schema,
          data: response.rows.slice(0, 5), // First 5 rows
          elapsedMs: response.stats?.elapsedMs || 0,
        });
      } else {
        return res.status(500).json({
          success: false,
          error: response.error?.message || "Unknown error",
          code: response.error?.code,
        });
      }
    } catch (error) {
      console.error("[TEST API] Error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({ 
        success: false,
        error: errorMessage
      });
    }
  });

  // API endpoint for ChatGPT completion
  expressApp.post("/api/chat", async (req: Request, res: Response) => {
    try {
      console.log("[CHAT API] Received chat request");
      const { message, code } = req.body;
      console.log("[CHAT API] Message:", message);
      console.log("[CHAT API] Code length:", code?.length || 0);
      
      if (!message || typeof message !== "string") {
        console.error("[CHAT API] Invalid message:", message);
        return res.status(400).json({ error: "Message is required" });
      }

      if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "") {
        console.error("[CHAT API] OPENAI_API_KEY is not set");
        return res.status(500).json({ 
          error: "OpenAI API key not configured. Please set OPENAI_API_KEY in your .env file." 
        });
      }

      const systemPrompt = `You are a Power Query M language expert assistant. 
You help users write and modify Power Query M code. 
When given a user request and current M code, you should:
1. Understand what the user wants to do
2. Modify or generate the M code accordingly
3. Return ONLY the complete, valid M code
4. Do not include explanations or markdown formatting - just the raw M code

The user's current M code will be provided. Respond with the complete updated M code.`;

      const userPrompt = code 
        ? `Current M code:\n\`\`\`\n${code}\n\`\`\`\n\nUser request: ${message}\n\nProvide the complete updated M code:`
        : `User request: ${message}\n\nProvide the complete M code:`;

      // For Azure OpenAI, the model/deployment is in the baseURL path
      const response = await openai.chat.completions.create({
        model: azureEndpoint ? deployment : "gpt-4o", // Use deployment name for Azure
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content || "";
      console.log("[CHAT API] OpenAI response length:", content.length);
      
      // Extract code from markdown code blocks if present
      let codeResult = content.trim();
      const codeBlockMatch = content.match(/```(?:m|powerquery)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        codeResult = codeBlockMatch[1].trim();
        console.log("[CHAT API] Extracted code from markdown block, length:", codeResult.length);
      } else {
        console.log("[CHAT API] Using raw content as code, length:", codeResult.length);
      }

      console.log("[CHAT API] Returning code result, length:", codeResult.length);
      res.json({ code: codeResult });
    } catch (error) {
      console.error("[CHAT API] Error in chat completion:", error);
      const errorMessage = error instanceof Error ? error.message : "Error processing chat request";
      console.error("[CHAT API] Error stack:", error instanceof Error ? error.stack : "No stack trace");
      console.error("[CHAT API] Full error details:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      res.status(500).json({ 
        error: errorMessage
      });
    }
  });

  // Serve index.html for all routes
  expressApp.get("*", (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "../../index.html"));
  });

  const server = expressApp.listen(0, () => {
    const port = (server.address() as any).port;
    const url = `http://localhost:${port}`;
    console.log(`Server running at ${url}`);
    mainWindow?.loadURL(url);
    
    // Enable DevTools to see renderer process logs (console.log from React components)
    mainWindow?.webContents.openDevTools();
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// IPC handlers
ipcMain.handle("open-file", async () => {
  const { dialog } = require("electron");
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile"],
    filters: [
      { name: "Excel Files", extensions: ["xlsx", "xls"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  return result;
});

ipcMain.handle("connect-excel", async (event, filePath: string) => {
  try {
    // Validate file exists
    const fs = require("fs");
    if (!fs.existsSync(filePath)) {
      return { success: false, error: "File not found" };
    }

    // Validate it's an Excel file
    if (!filePath.toLowerCase().endsWith(".xlsx") && !filePath.toLowerCase().endsWith(".xls")) {
      return { success: false, error: "File must be an Excel file (.xlsx or .xls)" };
    }

    // Emit connection event
    mainWindow?.webContents.send("excel:connected", {
      success: true,
      path: filePath,
    });

    return { success: true, path: filePath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    mainWindow?.webContents.send("excel:connected", {
      success: false,
      error: errorMessage,
    });
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle("export", async (event, options: { format: string; path?: string }) => {
  try {
    const { dialog } = require("electron");
    const path = require("path");

    if (!options.path) {
      // Show save dialog
      const result = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: `query-export.${options.format}`,
        filters: [
          { name: "CSV Files", extensions: ["csv"] },
          { name: "Excel Files", extensions: ["xlsx"] },
          { name: "Power BI Files", extensions: ["pbit"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled) {
        return { success: false, error: "Export canceled" };
      }

      options.path = result.filePath;
    }

    // Simulate export (in real implementation, would use Power Query engine)
    // For now, just emit success
    setTimeout(() => {
      mainWindow?.webContents.send("export:done", {
        path: options.path,
        format: options.format,
      });
    }, 500);

    return { success: true, path: options.path };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    mainWindow?.webContents.send("export:error", { message: errorMessage });
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle("run-step", async (event, stepId: string) => {
  try {
    // Simulate step execution
    // In real implementation, would use Power Query engine
    const mockData = {
      rows: [
        ["2024-01-15", "Widget A", "1250", "North", "Active"],
        ["2024-01-16", "Widget B", "2300", "South", "Active"],
      ],
      rowCount: 2,
      columnCount: 5,
    };

    // Emit dataframe update
    mainWindow?.webContents.send("dataframe:update", mockData);

    return { success: true, data: mockData };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: errorMessage };
  }
});

// Store current M code for execution
let currentMCode = "";

ipcMain.handle("set-mcode", async (event, code: string) => {
  console.log("[IPC] set-mcode called, code length:", code?.length || 0);
  try {
    currentMCode = code;
    console.log("[IPC] set-mcode success, stored code length:", currentMCode.length);
    return { success: true };
  } catch (error) {
    console.error("[IPC] set-mcode error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
});

ipcMain.handle("get-engine-info", async () => {
  if (!engineInfo) {
    engineInfo = discoverMashupEngine();
  }
  return engineInfo ? { type: engineInfo.type, path: engineInfo.path } : null;
});

ipcMain.handle("show-log-window", async () => {
  console.log("[IPC] show-log-window called");
  createLogWindow();
  // Explicitly show the window when requested
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.show();
    logWindow.focus();
  }
  return { success: true };
});

ipcMain.on("close-log-window", () => {
  console.log("[IPC] close-log-window called");
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.close();
  }
});

ipcMain.handle("cancel-execution", async () => {
  if (currentRunner) {
    currentRunner.cancel();
    currentRunner = null;
    mainWindow?.webContents.send("execution:cancelled");
    return { success: true };
  }
  return { success: false, error: "No execution in progress" };
});

ipcMain.handle("run-all", async (event, providedMCode?: string) => {
  try {
    // Use provided M code if available, otherwise fall back to stored currentMCode
    const mCodeToExecute = providedMCode || currentMCode;
    
    // Update stored code if provided
    if (providedMCode) {
      currentMCode = providedMCode;
      console.log("[IPC] run-all called with provided M code, length:", providedMCode.length);
    } else {
      console.log("[IPC] run-all called, using stored currentMCode");
    }
    
    console.log("[IPC] M code to execute length:", mCodeToExecute?.length || 0);
    console.log("[IPC] M code preview:", mCodeToExecute?.substring(0, 200) || "(empty)");
    
    // Cancel any existing execution
    if (currentRunner) {
      console.log("[IPC] Cancelling existing execution");
      currentRunner.cancel();
    }

    if (!mCodeToExecute) {
      console.error("[IPC] No M code to execute");
      return {
        success: false,
        error: "No M code to execute",
      };
    }

    // Use DirectCommand only - NO FALLBACKS
    console.log("[IPC] Checking if DirectCommand is available...");
    const directCommandAvailable = await isDirectCommandAvailable();
    console.log("[IPC] DirectCommand available:", directCommandAvailable);
    
    if (!directCommandAvailable) {
      const errorMsg = "DirectCommand is not available. Please ensure Python.NET is installed and the PowerQueryNet module is accessible.";
      console.error("[IPC] ✗", errorMsg);
      mainWindow?.webContents.send("dataframe:error", {
        error: errorMsg,
        diagnostics: [],
      });
      return { success: false, error: errorMsg };
    }

    console.log("[IPC] Using DirectCommand (Python.NET) for execution");
    const directResponse = await executeWithDirectCommand(mCodeToExecute, 30000);
    
    if (directResponse.success && directResponse.data) {
      console.log("[IPC] ✓ DirectCommand execution successful");
      console.log("[IPC] Rows:", directResponse.data.rowCount, "Columns:", directResponse.data.columnCount);
      
      // Emit dataframe update
      mainWindow?.webContents.send("dataframe:update", directResponse.data);
      console.log("[IPC] ✓ dataframe:update event sent successfully");
      
      return { success: true, data: directResponse.data };
    } else {
      const errorMsg = directResponse.error || "DirectCommand execution failed";
      console.error("[IPC] ✗ DirectCommand execution failed:", errorMsg);
      mainWindow?.webContents.send("dataframe:error", {
        error: errorMsg,
        diagnostics: [],
      });
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error("[IPC] Error executing M code:", error);
    console.error("[IPC] Error stack:", error instanceof Error ? error.stack : "No stack trace");
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    mainWindow?.webContents.send("dataframe:error", {
      error: errorMessage,
      diagnostics: [],
    });
    return { success: false, error: errorMessage };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Cancel any running execution
  if (currentRunner) {
    currentRunner.cancel();
    currentRunner = null;
  }
  
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  // Cancel any running execution
  if (currentRunner) {
    currentRunner.cancel();
    currentRunner = null;
  }
});

