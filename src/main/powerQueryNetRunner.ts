/**
 * PowerQueryNet wrapper - uses pqnet.exe CLI tool
 * This requires PowerQueryNet to be installed
 */

import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface PowerQueryNetRequest {
  mText: string;
  entry: string;
  settings: {
    rowLimit?: number;
    timeoutMs?: number;
  };
}

export interface PowerQueryNetResponse {
  ok: boolean;
  schema?: Array<{ name: string; type: "text" | "number" | "datetime" | "logical" | "any" }>;
  rows?: Array<Record<string, any>>;
  stats?: { elapsedMs: number };
  diagnostics?: Array<{ message: string; severity: "error" | "warning" | "info" }>;
  error?: {
    code: "ENGINE_ERROR" | "TIMEOUT" | "BAD_SOURCE" | "MEMORY_LIMIT" | "CANCELLED";
    message: string;
  };
}

export class PowerQueryNetRunner {
  private process: ChildProcess | null = null;
  private tempDir: string | null = null;
  private tempFile: string | null = null;
  private startTime: number = 0;
  private cancelled: boolean = false;

  /**
   * Find PowerQueryNet console wrapper or pqnet.exe installation
   */
  private static findPQNet(): string | null {
    // First, try our built console wrapper
    const wrapperPath = path.join(__dirname, "..", "..", "PowerQueryNet", "ConsoleWrapper", "bin", "Release", "PowerQueryNet.ConsoleWrapper.exe");
    if (fs.existsSync(wrapperPath)) {
      console.log(`[PowerQueryNetRunner] Found console wrapper at: ${wrapperPath}`);
      return wrapperPath;
    }

    const wrapperDebugPath = path.join(__dirname, "..", "..", "PowerQueryNet", "ConsoleWrapper", "bin", "Debug", "PowerQueryNet.ConsoleWrapper.exe");
    if (fs.existsSync(wrapperDebugPath)) {
      console.log(`[PowerQueryNetRunner] Found console wrapper (Debug) at: ${wrapperDebugPath}`);
      return wrapperDebugPath;
    }

    // Fallback to installed pqnet.exe
    const searchPaths = [
      path.join(process.env.ProgramFiles || "", "PowerQueryNet", "pqnet.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "", "PowerQueryNet", "pqnet.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "PowerQueryNet", "pqnet.exe"),
      "C:\\Program Files\\PowerQueryNet\\pqnet.exe",
      "C:\\Program Files (x86)\\PowerQueryNet\\pqnet.exe",
    ];

    for (const searchPath of searchPaths) {
      if (fs.existsSync(searchPath)) {
        console.log(`[PowerQueryNetRunner] Found pqnet.exe at: ${searchPath}`);
        return searchPath;
      }
    }

    console.warn("[PowerQueryNetRunner] PowerQueryNet console wrapper or pqnet.exe not found.");
    console.warn("[PowerQueryNetRunner] Build the ConsoleWrapper project first, or install PowerQueryNet.");
    return null;
  }

  /**
   * Execute M code using PowerQueryNet
   */
  async execute(request: PowerQueryNetRequest): Promise<PowerQueryNetResponse> {
    this.startTime = Date.now();
    this.cancelled = false;

    console.log("[PowerQueryNetRunner] Starting M code execution");
    console.log("[PowerQueryNetRunner] Entry point:", request.entry);
    console.log("[PowerQueryNetRunner] M code length:", request.mText.length, "characters");

    // Find pqnet.exe
    const pqnetPath = PowerQueryNetRunner.findPQNet();
    if (!pqnetPath) {
      return {
        ok: false,
        error: {
          code: "ENGINE_ERROR",
          message: "pqnet.exe not found. Please install PowerQueryNet.",
        },
        diagnostics: [],
      };
    }

    // Create temp directory and write M code to .pq file
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pqnet-"));
    this.tempFile = path.join(this.tempDir, "query.pq");
    
    console.log("[PowerQueryNetRunner] Created temp directory:", this.tempDir);
    console.log("[PowerQueryNetRunner] Writing M code to:", this.tempFile);

    try {
      // Write M code to temp file
      // Note: The ConsoleWrapper will format it as mashup:
      // section Section1;\n\rshared {queryName} = {mCode};\n\r
      fs.writeFileSync(this.tempFile, request.mText, "utf-8");
      console.log(`[PowerQueryNetRunner] ✓ M code written to file (${request.mText.length} bytes)`);

      // Call console wrapper with the .pq file and output as JSON
      // Format: PowerQueryNet.ConsoleWrapper.exe query.pq queryName json
      // The ConsoleWrapper will:
      // 1. Read M code from file
      // 2. Format as mashup: "section Section1;\n\rshared {queryName} = {mCode};\n\r"
      // 3. Execute via Command.Execute(queryName, mashup)
      // 4. Return DataTable as JSON
      let queryName = request.entry.trim();
      
      // Remove outer quotes if present
      if (queryName.startsWith('"') && queryName.endsWith('"')) {
        queryName = queryName.slice(1, -1);
      }
      // Remove #"..." wrapper if present
      // The ConsoleWrapper will add it back in the mashup if needed (for spaces)
      // But the Location parameter uses plain name (without #"...")
      if (queryName.startsWith('#"') && queryName.endsWith('"')) {
        queryName = queryName.slice(2, -1);
      }
      
      // If no entry point provided, try to extract from "in" clause
      if (!queryName || queryName === "Query1") {
        const inMatch = request.mText.match(/in\s+(.+?)(?:\s*$)/is);
        if (inMatch) {
          queryName = inMatch[1].trim().replace(/^#?"?|"?$/g, "");
          console.log(`[PowerQueryNetRunner] Extracted entry point from M code: ${queryName}`);
        }
      }
      
      const args = [
        this.tempFile!,
        queryName, // Query name
        "json",   // Output format
      ];

      console.log(`[PowerQueryNetRunner] Executing: ${pqnetPath} ${args.join(" ")}`);

      const result = await this.invokePQNet(pqnetPath, args, request.settings.timeoutMs || 20000);

      return result;
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "ENGINE_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        diagnostics: [],
      };
    } finally {
      this.cleanup();
    }
  }

  /**
   * Invoke pqnet.exe
   */
  private async invokePQNet(
    pqnetPath: string,
    args: string[],
    timeout: number
  ): Promise<PowerQueryNetResponse> {
    return new Promise((resolve, reject) => {
      console.log(`[PowerQueryNetRunner.invokePQNet] Starting pqnet invocation`);
      console.log(`[PowerQueryNetRunner.invokePQNet] Command: ${pqnetPath} ${args.join(" ")}`);

      this.process = spawn(pqnetPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        cwd: path.dirname(pqnetPath),
      });

      let stdout = "";
      let stderr = "";

      this.process.stdout?.on("data", (data) => {
        const chunk = data.toString();
        stdout += chunk;
        console.log(`[PowerQueryNetRunner] stdout chunk received (${chunk.length} bytes)`);
      });

      this.process.stderr?.on("data", (data) => {
        const chunk = data.toString();
        stderr += chunk;
        console.log(`[PowerQueryNetRunner] stderr chunk received (${chunk.length} bytes): ${chunk.substring(0, 200)}`);
      });

      const timeoutId = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGTERM");
          resolve({
            ok: false,
            error: { code: "TIMEOUT", message: `Execution timeout after ${timeout}ms` },
            diagnostics: this.parseDiagnostics(stderr),
          });
        }
      }, timeout);

      this.process.on("close", (code) => {
        clearTimeout(timeoutId);

        console.log(`[PowerQueryNetRunner] Process exited with code ${code}`);
        console.log(`[PowerQueryNetRunner] stdout length: ${stdout.length}, stderr length: ${stderr.length}`);

        if (this.cancelled) {
          resolve({
            ok: false,
            error: { code: "CANCELLED", message: "Execution cancelled by user" },
            diagnostics: [],
          });
          return;
        }

        if (code === 0 && stdout.trim()) {
          // Success - parse JSON output
          try {
            const result = this.parseResult(stdout, stderr);
            console.log(`[PowerQueryNetRunner] ✓ Successfully parsed result`);
            resolve(result);
          } catch (error) {
            console.error(`[PowerQueryNetRunner] ✗ Failed to parse result:`, error);
            resolve({
              ok: false,
              error: {
                code: "ENGINE_ERROR",
                message: `Failed to parse result: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
              diagnostics: this.parseDiagnostics(stderr),
            });
          }
        } else {
          // Execution failed
          const errorMsg = `pqnet.exe exited with code ${code}: ${stderr || "No output"}`;
          console.error(`[PowerQueryNetRunner] ✗ ${errorMsg}`);
          resolve({
            ok: false,
            error: {
              code: "ENGINE_ERROR",
              message: errorMsg,
            },
            diagnostics: this.parseDiagnostics(stderr),
          });
        }
      });

      this.process.on("error", (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Parse pqnet JSON output
   */
  private parseResult(stdout: string, stderr: string): PowerQueryNetResponse {
    const elapsedMs = Date.now() - this.startTime;

    try {
      // Parse JSON output from pqnet
      const result = JSON.parse(stdout);

      // pqnet outputs JSON in a specific format
      // Assuming it's an array of objects or a table structure
      if (Array.isArray(result)) {
        const firstRow = result[0];
        if (firstRow && typeof firstRow === "object") {
          const columns = Object.keys(firstRow);
          const rows = result.map((row: any) => {
            const formattedRow: Record<string, any> = {};
            for (const col of columns) {
              formattedRow[col] = row[col];
            }
            return formattedRow;
          });

          const schema = columns.map((col: string) => {
            const sampleValue = firstRow[col];
            let type: "text" | "number" | "datetime" | "logical" | "any" = "any";
            if (typeof sampleValue === "string") type = "text";
            else if (typeof sampleValue === "number") type = "number";
            else if (sampleValue instanceof Date) type = "datetime";
            else if (typeof sampleValue === "boolean") type = "logical";
            return { name: col, type };
          });

          return {
            ok: true,
            schema,
            rows,
            stats: { elapsedMs },
            diagnostics: this.parseDiagnostics(stderr),
          };
        }
      }

      // If it's a different format, try to extract table structure
      return {
        ok: false,
        error: {
          code: "ENGINE_ERROR",
          message: "Unexpected output format from pqnet",
        },
        diagnostics: this.parseDiagnostics(stderr),
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "ENGINE_ERROR",
          message: `Failed to parse JSON output: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
        diagnostics: this.parseDiagnostics(stderr),
      };
    }
  }

  /**
   * Parse diagnostics from stderr
   */
  private parseDiagnostics(stderr: string): Array<{ message: string; severity: "error" | "warning" | "info" }> {
    if (!stderr) return [];

    const diagnostics: Array<{ message: string; severity: "error" | "warning" | "info" }> = [];
    const lines = stderr.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let severity: "error" | "warning" | "info" = "info";
      if (/error|failed|exception/i.test(trimmed)) {
        severity = "error";
      } else if (/warning|warn/i.test(trimmed)) {
        severity = "warning";
      }

      diagnostics.push({ message: trimmed, severity });
    }

    return diagnostics;
  }

  /**
   * Cancel the current execution
   */
  cancel(): void {
    this.cancelled = true;
    if (this.process) {
      this.process.kill("SIGTERM");
    }
  }

  /**
   * Cleanup temporary files
   */
  private cleanup(): void {
    if (this.tempDir && fs.existsSync(this.tempDir)) {
      try {
        if (this.tempFile && fs.existsSync(this.tempFile)) {
          fs.unlinkSync(this.tempFile);
        }
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn("Failed to cleanup temp files:", error);
      }
    }
  }
}

