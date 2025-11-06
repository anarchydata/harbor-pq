/**
 * DirectCommand Runner - Wraps Python DirectCommand for executing M code
 * Uses the direct SDK implementation via Python.NET
 * 
 * OPTIMIZED: Uses a persistent Python process to avoid startup overhead
 */

import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";

export interface DirectCommandResponse {
  success: boolean;
  data?: {
    rows: any[][];
    rowCount: number;
    columnCount: number;
    columns: string[];
    engine: string;
    elapsedMs: number;
  };
  error?: string;
}

/**
 * Format M code into mashup format for DirectCommand
 * Format: section Section1;\n\rshared QueryName = Formula;\n\r
 */
function formatMashup(mCode: string, queryName: string = "Query1"): string {
  // Clean up the M code
  const cleanedCode = mCode.trim();
  
  // Format as mashup
  // If query name contains spaces, wrap it in #"..." format
  const formattedQueryName = queryName.includes(" ") ? `#\"${queryName}\"` : queryName;
  
  return `section Section1;\n\rshared ${formattedQueryName} = ${cleanedCode};\n\r`;
}

/**
 * Extract query name from M code (the expression after "in")
 */
function extractQueryName(mCode: string): string {
  const inMatch = mCode.match(/in\s+(.+?)(?:\s*$)/is);
  if (inMatch) {
    let queryName = inMatch[1].trim().replace(/^#?"?|"?$/g, "");
    // Remove any trailing semicolons
    queryName = queryName.replace(/;+\s*$/, "");
    return queryName || "Query1";
  }
  return "Query1";
}

// Persistent Python process for DirectCommand
let persistentPythonProcess: ChildProcess | null = null;
let processReady: boolean = false;
let pendingRequests: Map<number, { resolve: (value: DirectCommandResponse) => void; reject: (error: Error) => void }> = new Map();
let requestIdCounter: number = 0;
let processBuffer: string = "";

/**
 * Start the persistent Python process if not already running
 */
function startPersistentProcess(): void {
  if (persistentPythonProcess && !persistentPythonProcess.killed) {
    return; // Already running
  }

  console.log("[DirectCommand] Starting persistent Python process...");
  
  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  const projectRoot = path.resolve(__dirname, "..", "..");
  const powerQueryNetDir = path.join(projectRoot, "PowerQueryNet");
  const scriptPath = path.join(projectRoot, "execute_direct_command_persistent.py");
  
  const projectRootEscaped = projectRoot.replace(/\\/g, "\\\\");
  const powerQueryNetEscaped = powerQueryNetDir.replace(/\\/g, "\\\\");
  
  // Create persistent script that reads commands from stdin
  const scriptContent = `#!/usr/bin/env python
"""Persistent script to execute DirectCommand via stdin/stdout"""
import sys
import json
import os
import importlib.util
from pathlib import Path

# Add paths
sys.path.insert(0, r'${projectRootEscaped}')
sys.path.insert(0, r'${powerQueryNetEscaped}')

try:
    from PowerQueryNet.command_direct import DirectCommand
except ImportError as e:
    try:
        command_direct_path = Path(r'${powerQueryNetEscaped}') / "command_direct.py"
        spec = importlib.util.spec_from_file_location("command_direct", str(command_direct_path))
        if spec and spec.loader:
            command_direct = importlib.util.module_from_spec(spec)
            sys.path.insert(0, str(Path(r'${powerQueryNetEscaped}').parent))
            spec.loader.exec_module(command_direct)
            DirectCommand = command_direct.DirectCommand
        else:
            raise ImportError(f"Could not load module - spec is None. Original error: {e}")
    except Exception as e2:
        raise ImportError(f"Package import failed: {e}, File import failed: {e2}")

# Initialize SDK once (happens when first DirectCommand is created)
print("READY", flush=True)

# Read commands from stdin line by line
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    
    try:
        request = json.loads(line)
        request_id = request.get("id")
        m_code = request.get("m_code")
        query_name = request.get("query_name")
        
        if not m_code or not query_name:
            response = {
                "id": request_id,
                "success": False,
                "error": "Missing m_code or query_name"
            }
            print(json.dumps(response), flush=True)
            continue
        
        # Create new DirectCommand instance and execute
        cmd = DirectCommand()
        try:
            response = cmd.execute(query_name=query_name, m_code=m_code)
            
            result = {
                "id": request_id,
                "success": True,
                "data": {
                    "columns": response.data_table.columns if response.data_table else [],
                    "rows": response.data_table.rows if response.data_table else [],
                    "rowCount": len(response.data_table.rows) if response.data_table else 0,
                    "columnCount": len(response.data_table.columns) if response.data_table else 0,
                    "engine": "DirectCommand",
                    "elapsedMs": 0
                }
            }
            print(json.dumps(result), flush=True)
        except Exception as e:
            import traceback
            error_result = {
                "id": request_id,
                "success": False,
                "error": str(e) + "\\n" + traceback.format_exc()
            }
            print(json.dumps(error_result), flush=True)
    except json.JSONDecodeError as e:
        error_result = {
            "id": None,
            "success": False,
            "error": f"Invalid JSON: {e}"
        }
        print(json.dumps(error_result), flush=True)
    except Exception as e:
        import traceback
        error_result = {
            "id": None,
            "success": False,
            "error": str(e) + "\\n" + traceback.format_exc()
        }
        print(json.dumps(error_result), flush=True)
`;

  // Write persistent script
  fs.writeFileSync(scriptPath, scriptContent, "utf8");

  // Spawn persistent process
  persistentPythonProcess = spawn(pythonCmd, [scriptPath], {
    cwd: projectRoot,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  processReady = false;
  processBuffer = "";

  persistentPythonProcess.stdout?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    processBuffer += chunk;
    
    // Check for "READY" signal
    if (!processReady && processBuffer.includes("READY")) {
      processReady = true;
      console.log("[DirectCommand] ✓ Persistent process ready");
      processBuffer = processBuffer.replace("READY", "").trim();
    }
    
    // Process complete JSON responses (one per line)
    const lines = processBuffer.split("\n");
    processBuffer = lines.pop() || ""; // Keep incomplete line in buffer
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const response = JSON.parse(line);
        const requestId = response.id;
        const handler = pendingRequests.get(requestId);
        
        if (handler) {
          pendingRequests.delete(requestId);
          if (response.success) {
            handler.resolve(response);
          } else {
            handler.reject(new Error(response.error || "Unknown error"));
          }
        }
      } catch (e) {
        console.error("[DirectCommand] Failed to parse response:", line);
      }
    }
  });

  persistentPythonProcess.stderr?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    console.error("[DirectCommand] stderr:", chunk);
  });

  persistentPythonProcess.on("close", (code) => {
    console.log(`[DirectCommand] Persistent process exited with code ${code}`);
    persistentPythonProcess = null;
    processReady = false;
    
    // Reject all pending requests
    for (const handler of pendingRequests.values()) {
      handler.reject(new Error("Python process terminated"));
    }
    pendingRequests.clear();
  });

  persistentPythonProcess.on("error", (error) => {
    console.error("[DirectCommand] Failed to start persistent process:", error);
    persistentPythonProcess = null;
    processReady = false;
    
    // Reject all pending requests
    for (const handler of pendingRequests.values()) {
      handler.reject(new Error(`Failed to start Python process: ${error.message}`));
    }
    pendingRequests.clear();
  });
}

/**
 * Wait for the persistent process to be ready
 */
function waitForReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (processReady) {
      resolve();
      return;
    }
    
    const checkInterval = setInterval(() => {
      if (processReady) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        resolve();
      } else if (!persistentPythonProcess || persistentPythonProcess.killed) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        reject(new Error("Python process failed to start"));
      }
    }, 10); // Check every 10ms
    
    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
      reject(new Error("Python process ready timeout"));
    }, 5000); // 5 second timeout for initialization
  });
}

/**
 * Execute M code using DirectCommand via persistent Python process
 */
export async function executeWithDirectCommand(
  mCode: string,
  timeoutMs: number = 10000
): Promise<DirectCommandResponse> {
  return new Promise(async (resolve, reject) => {
    try {
      // Start persistent process if needed
      if (!persistentPythonProcess || persistentPythonProcess.killed) {
        startPersistentProcess();
      }
      
      // Wait for process to be ready
      await waitForReady();
      
      // Extract query name from M code
      const queryName = extractQueryName(mCode);
      
      // Generate request ID
      const requestId = ++requestIdCounter;
      
      // Store handlers
      pendingRequests.set(requestId, { resolve, reject });
      
      // Set timeout
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`DirectCommand execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      
      // Override resolve/reject to clear timeout
      const originalResolve = resolve;
      const originalReject = reject;
      pendingRequests.set(requestId, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          originalResolve(value);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          originalReject(error);
        },
      });
      
      // Send request to Python process
      const request = {
        id: requestId,
        m_code: mCode,
        query_name: queryName,
      };
      
      if (!persistentPythonProcess?.stdin?.writable) {
        pendingRequests.delete(requestId);
        clearTimeout(timeoutId);
        reject(new Error("Python process stdin is not writable"));
        return;
      }
      
      persistentPythonProcess.stdin.write(JSON.stringify(request) + "\n");
      
      console.log("[DirectCommand] Sent request", requestId, "Query:", queryName);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Check if DirectCommand is available
 * This actually tries to import it to verify it works
 */
export async function isDirectCommandAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      
      // Quick test to see if we can import DirectCommand
      // Need to add project root to Python path
      const projectRoot = path.resolve(__dirname, "..", "..");
      // Also add PowerQueryNet directory explicitly (case-sensitive import)
      const powerQueryNetDir = path.join(projectRoot, "PowerQueryNet");
      // Escape backslashes for Windows paths in Python string
      const projectRootEscaped = projectRoot.replace(/\\/g, "\\\\");
      const powerQueryNetEscaped = powerQueryNetDir.replace(/\\/g, "\\\\");
      
      console.log(`[DirectCommand] Checking availability...`);
      console.log(`[DirectCommand] Project root: ${projectRoot}`);
      console.log(`[DirectCommand] PowerQueryNet dir: ${powerQueryNetDir}`);
      
      // Import from PowerQueryNet (matching actual directory name - Python imports are case-sensitive)
      // Use the correct case: PowerQueryNet (not powerquerynet)
      // Add error output flushing to ensure errors are captured
      const testScript = `
import sys
import os
sys.path.insert(0, r'${projectRootEscaped}')

# Python imports are case-sensitive - use PowerQueryNet (capital letters)
try:
    from PowerQueryNet.command_direct import DirectCommand
    print("OK", flush=True)
    sys.stdout.flush()
except ImportError as e:
    # If package import fails, try direct file import
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "command_direct",
            r'${powerQueryNetEscaped}\\command_direct.py'
        )
        if spec and spec.loader:
            command_direct = importlib.util.module_from_spec(spec)
            sys.path.insert(0, r'${powerQueryNetEscaped}')
            spec.loader.exec_module(command_direct)
            DirectCommand = command_direct.DirectCommand
            print("OK", flush=True)
            sys.stdout.flush()
        else:
            print(f"ERROR: Could not load module - spec is None", flush=True, file=sys.stderr)
            sys.stderr.flush()
    except Exception as e2:
        print(f"ERROR: Package import failed: {e}, File import failed: {e2}", flush=True, file=sys.stderr)
        sys.stderr.flush()
except Exception as e:
    print(f"ERROR: Unexpected error: {e}", flush=True, file=sys.stderr)
    sys.stderr.flush()
    import traceback
    traceback.print_exc(file=sys.stderr)
    sys.stderr.flush()
`;
      
      console.log(`[DirectCommand] Running Python test script...`);
      const pythonProcess = spawn(pythonCmd, ["-u", "-c", testScript], {
        cwd: projectRoot,
        env: { ...process.env, PYTHONPATH: `${projectRoot};${powerQueryNetDir}`, PYTHONUNBUFFERED: "1" },
      });
      
      let stdout = "";
      let stderr = "";
      
      pythonProcess.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      
      pythonProcess.on("close", (code) => {
        clearTimeout(timeoutId);
        const output = stdout.trim();
        if (code === 0 && output === "OK") {
          console.log("[DirectCommand] ✓ DirectCommand is available");
          resolve(true);
        } else {
          console.error("[DirectCommand] ✗ DirectCommand not available");
          console.error("[DirectCommand] Exit code:", code);
          console.error("[DirectCommand] stdout:", stdout || "(empty)");
          console.error("[DirectCommand] stderr:", stderr || "(empty)");
          if (stderr.includes("ModuleNotFoundError") || stderr.includes("No module named")) {
            console.error("[DirectCommand] Python module import failed - check that PowerQueryNet directory exists and command_direct.py is present");
          }
          if (stderr.includes("ImportError") || stdout.includes("ERROR")) {
            console.error("[DirectCommand] Import error detected - check Python path and module structure");
          }
          resolve(false);
        }
      });
      
      pythonProcess.on("error", (error: Error) => {
        console.log("[DirectCommand] ✗ Python not available:", error.message);
        resolve(false);
      });
      
      // Timeout after 15 seconds (Python.NET initialization can be slow)
      const timeoutId = setTimeout(() => {
        if (!pythonProcess.killed) {
          pythonProcess.kill("SIGTERM");
          console.error("[DirectCommand] ✗ Availability check timed out after 15 seconds");
          console.error("[DirectCommand] This might indicate Python.NET is slow to initialize or the module path is incorrect");
          console.error("[DirectCommand] Try running manually: python -c \"from PowerQueryNet.command_direct import DirectCommand\"");
          resolve(false);
        }
      }, 15000);
      
      // Clear timeout when process closes
      pythonProcess.on("close", () => {
        clearTimeout(timeoutId);
      });
    } catch (error) {
      console.log("[DirectCommand] ✗ Error checking availability:", error);
      resolve(false);
    }
  });
}
