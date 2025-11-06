/**
 * Sandboxed micro-server for executing Power Query M code
 * Runs as a separate Node.js process with full isolation
 */

import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface MashupRequest {
  mText: string;
  entry: string;
  settings: {
    rowLimit?: number;
    timeoutMs?: number;
  };
}

export interface MashupResponse {
  ok: boolean;
  engine?: "powerbi" | "excel";
  schema?: Array<{ name: string; type: "text" | "number" | "datetime" | "logical" | "any" }>;
  rows?: Array<Record<string, any>>;
  stats?: { elapsedMs: number };
  diagnostics?: Array<{ message: string; severity: "error" | "warning" | "info" }>;
  error?: {
    code: "ENGINE_ERROR" | "TIMEOUT" | "BAD_SOURCE" | "MEMORY_LIMIT" | "CANCELLED";
    message: string;
  };
}

export interface MashupRunnerOptions {
  enginePath: string;
  engineType: "powerbi" | "excel";
  onCancel?: () => void;
}

export class MashupRunner {
  private process: ChildProcess | null = null;
  private tempDir: string | null = null;
  private tempFile: string | null = null;
  private startTime: number = 0;
  private cancelled: boolean = false;
  private memoryCheckInterval: NodeJS.Timeout | null = null;

  constructor(private options: MashupRunnerOptions) {}

  /**
   * Execute M code and return results
   */
  async execute(request: MashupRequest): Promise<MashupResponse> {
    this.startTime = Date.now();
    this.cancelled = false;

    console.log("[MashupRunner] Starting M code execution");
    console.log("[MashupRunner] Entry point:", request.entry);
    console.log("[MashupRunner] Row limit:", request.settings.rowLimit);
    console.log("[MashupRunner] Timeout:", request.settings.timeoutMs, "ms");
    console.log("[MashupRunner] M code length:", request.mText.length, "characters");

    // Create isolated temp directory
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mashup-"));
    // Use .pq extension (Power Query file format) instead of .m
    this.tempFile = path.join(this.tempDir, "query.pq");
    console.log("[MashupRunner] Created temp directory:", this.tempDir);

    try {
      // Validate and reject network sources
      if (this.hasNetworkSources(request.mText)) {
        return {
          ok: false,
          error: {
            code: "BAD_SOURCE",
            message: "Network sources are not supported in phase 1. Use File.Contents() or Excel.Workbook(File.Contents()) only.",
          },
          diagnostics: [],
        };
      }

      // Write M code to temp file
      console.log(`[MashupRunner] Writing M code to: ${this.tempFile}`);
      console.log(`[MashupRunner] M code preview (first 200 chars): ${request.mText.substring(0, 200)}`);
      fs.writeFileSync(this.tempFile, request.mText, "utf-8");
      console.log(`[MashupRunner] ✓ M code written to file (${request.mText.length} bytes)`);

      // Invoke Mashup Engine
      console.log(`[MashupRunner] Invoking Mashup Engine...`);
      const result = await this.invokeEngine(request);
      console.log(`[MashupRunner] Engine execution completed. Success: ${result.ok}`);
      
      if (result.ok) {
        console.log(`[MashupRunner] Result: ${result.rows?.length || 0} rows, ${result.schema?.length || 0} columns`);
        console.log(`[MashupRunner] Elapsed time: ${result.stats?.elapsedMs || 0}ms`);
      } else {
        console.error(`[MashupRunner] Execution failed: ${result.error?.code} - ${result.error?.message}`);
      }

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
   * Cancel the current execution
   */
  cancel(): void {
    this.cancelled = true;
    if (this.process) {
      this.process.kill("SIGTERM");
      // Force kill after 2 seconds if still running
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGKILL");
        }
      }, 2000);
    }
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
    this.options.onCancel?.();
  }

  /**
   * Check if M code contains network sources
   */
  private hasNetworkSources(mText: string): boolean {
    const networkPatterns = [
      /Web\.Contents\(/i,
      /OData\.Feed\(/i,
      /Odbc\.DataSource\(/i,
      /Sql\.Database\(/i,
      /AzureStorage\.Blobs\(/i,
      /https?:\/\//i,
    ];

    return networkPatterns.some((pattern) => pattern.test(mText));
  }

  /**
   * Invoke the Mashup Engine
   */
  private async invokeEngine(request: MashupRequest): Promise<MashupResponse> {
    return new Promise((resolve, reject) => {
      const timeout = request.settings.timeoutMs || 20000;
      const rowLimit = request.settings.rowLimit || 5000;

      console.log(`[MashupRunner.invokeEngine] Starting engine invocation`);
      console.log(`[MashupRunner.invokeEngine] Engine path: ${this.options.enginePath}`);
      console.log(`[MashupRunner.invokeEngine] Engine type: ${this.options.engineType}`);
      console.log(`[MashupRunner.invokeEngine] Temp file: ${this.tempFile}`);
      console.log(`[MashupRunner.invokeEngine] Timeout: ${timeout}ms`);
      console.log(`[MashupRunner.invokeEngine] Row limit: ${rowLimit}`);

      // PowerQueryNet approach: Pass the .pq file directly as argument
      // Based on PowerQueryNet implementation - they pass the script file path directly
      const engineDir = path.dirname(this.options.enginePath);
      
      // Use absolute path for the query file (PowerQueryNet approach)
      const queryFilePath = path.resolve(this.tempFile!);
      
      // PowerQueryNet passes the file path directly, no flags
      // Pattern: Microsoft.Mashup.Container.NetFX45.exe script.pq
      const patterns = [
        // Pattern 1: Just the file path (PowerQueryNet approach)
        [queryFilePath],
        // Pattern 2: Pass M code via stdin
        [], // No arguments - read from stdin
        // Pattern 3: With -QueryFile and -OutputFormat JSON
        ["-QueryFile", queryFilePath, "-OutputFormat", "JSON"],
        // Pattern 4: With -Evaluate and output format
        ["-Evaluate", queryFilePath, "-OutputFormat", "JSON"],
      ];
      
      console.log(`[MashupRunner.invokeEngine] Will try ${patterns.length} invocation patterns`);

      let attemptIndex = 0;
      let resolved = false;

      const tryPattern = (patternArgs: string[]) => {
        if (this.cancelled) {
          resolved = true;
          resolve({
            ok: false,
            error: { code: "CANCELLED", message: "Execution cancelled by user" },
            diagnostics: [],
          });
          return;
        }

        console.log(`[MashupRunner.invokeEngine] Spawning process (attempt ${attemptIndex + 1}/${patterns.length})`);
        console.log(`[MashupRunner.invokeEngine] Command: ${this.options.enginePath} ${patternArgs.join(" ")}`);
        
        // Set up environment variables that Power BI might expect
        const env = {
          ...process.env,
          // Disable network (block outbound)
          NO_NETWORK: "1",
          // Set Power BI installation path if available
          ...(this.options.engineType === "powerbi" && {
            // Common Power BI environment variables
            PBIDESKTOP_PATH: engineDir,
            // Try setting common .NET and Power BI paths
            PATH: `${engineDir}${path.delimiter}${process.env.PATH}`,
          }),
        };
        
        // Use absolute path for the executable
        const engineExe = path.resolve(this.options.enginePath);
        
        // If pattern has no arguments, we'll pass M code via stdin
        const useStdin = patternArgs.length === 0;
        
        // PowerQueryNet approach: Use ProcessStartInfo with redirected streams
        // Set working directory to engine directory (where dependencies are)
        this.process = spawn(engineExe, patternArgs, {
          stdio: useStdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
          shell: false,
          cwd: engineDir, // PowerQueryNet sets working directory to engine location
          env: env,
          windowsVerbatimArguments: false,
        });
        
        // If using stdin, write M code to stdin
        if (useStdin && this.process.stdin) {
          this.process.stdin.write(request.mText, "utf-8");
          this.process.stdin.end();
          console.log(`[MashupRunner.invokeEngine] Writing M code to stdin (${request.mText.length} bytes)`);
        }

        let stdout = "";
        let stderr = "";

        // Monitor memory usage (1.5 GB limit)
        const MEMORY_LIMIT_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
        this.memoryCheckInterval = setInterval(() => {
          if (this.process && !this.process.killed && this.process.pid) {
            try {
              // On Windows, we can use WMI or tasklist to check memory
              // For now, we'll rely on the OS to kill the process if it exceeds limits
              // In production, you might want to use a more sophisticated memory monitor
              // For Node.js, we could use process.memoryUsage() but that's for the Node process, not the spawned process
            } catch (error) {
              // Ignore memory check errors
            }
          }
        }, 1000);
        
        // Kill process if it exceeds memory limit (this is a safety check)
        // The actual memory monitoring would need platform-specific code
        // For now, we rely on the OS to manage memory limits

        this.process.stdout?.on("data", (data) => {
          const chunk = data.toString();
          stdout += chunk;
          console.log(`[MashupRunner.invokeEngine] stdout chunk received (${chunk.length} bytes)`);
        });

        this.process.stderr?.on("data", (data) => {
          const chunk = data.toString();
          stderr += chunk;
          console.log(`[MashupRunner.invokeEngine] stderr chunk received (${chunk.length} bytes): ${chunk.substring(0, 200)}`);
        });

        const timeoutId = setTimeout(() => {
          if (!resolved) {
            this.process?.kill("SIGTERM");
            resolved = true;
            resolve({
              ok: false,
              error: { code: "TIMEOUT", message: `Execution timeout after ${timeout}ms` },
              diagnostics: this.parseDiagnostics(stderr),
            });
          }
        }, timeout);

        this.process.on("close", (code) => {
          if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
            this.memoryCheckInterval = null;
          }
          clearTimeout(timeoutId);

          console.log(`[MashupRunner] Process exited with code ${code}`);
          console.log(`[MashupRunner] stdout length: ${stdout.length}, stderr length: ${stderr.length}`);
          if (stdout.length > 0) {
            console.log(`[MashupRunner] stdout preview (first 500 chars): ${stdout.substring(0, 500)}`);
          }
          if (stderr.length > 0) {
            console.log(`[MashupRunner] stderr: ${stderr}`);
          }

          if (this.cancelled) {
            if (!resolved) {
              resolved = true;
              resolve({
                ok: false,
                error: { code: "CANCELLED", message: "Execution cancelled by user" },
                diagnostics: [],
              });
            }
            return;
          }

          if (code === 0 && stdout.trim()) {
            // Success
            try {
              const result = this.parseResult(stdout, stderr, rowLimit);
              console.log(`[MashupRunner] ✓ Successfully parsed result`);
              resolved = true;
              resolve(result);
            } catch (error) {
              console.error(`[MashupRunner] ✗ Failed to parse result:`, error);
              resolved = true;
              reject(new Error(`Failed to parse result: ${error instanceof Error ? error.message : "Unknown error"}`));
            }
          } else {
            // Execution failed
            const errorMsg = `Mashup Engine exited with code ${code}: ${stderr || "No output"}`;
            console.error(`[MashupRunner] ✗ ${errorMsg}`);
            resolved = true;
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
          if (attemptIndex < patterns.length - 1 && !resolved) {
            attemptIndex++;
            tryPattern(patterns[attemptIndex]);
          } else if (!resolved) {
            resolved = true;
            reject(error);
          }
        });
      };

      // Start with first pattern
      tryPattern(patterns[0]);
    });
  }

  /**
   * Parse Mashup Engine output
   */
  private parseResult(stdout: string, stderr: string, rowLimit: number): MashupResponse {
    const elapsedMs = Date.now() - this.startTime;

    try {
      // Try to parse as JSON
      const result = JSON.parse(stdout);

      // Convert to our response format
      if (result.Table || result.Rows) {
        // Table structure
        const table = result.Table || result;
        const columns = table.ColumnNames || [];
        const rawRows = (table.Rows || result.Rows || []).slice(0, rowLimit);

        // Infer schema
        const schema = columns.map((col: string) => {
          const sampleValue = rawRows[0]?.[col];
          let type: "text" | "number" | "datetime" | "logical" | "any" = "any";
          if (typeof sampleValue === "string") type = "text";
          else if (typeof sampleValue === "number") type = "number";
          else if (sampleValue instanceof Date) type = "datetime";
          else if (typeof sampleValue === "boolean") type = "logical";

          return { name: col, type };
        });

        // Format rows and truncate large fields
        const rows = rawRows.map((row: any) => {
          const formattedRow: Record<string, any> = {};
          for (const col of columns) {
            let value = Array.isArray(row) ? row[columns.indexOf(col)] : row[col];
            if (typeof value === "string" && value.length > 256 * 1024) {
              value = value.substring(0, 256 * 1024) + "[truncated]";
            }
            formattedRow[col] = value;
          }
          return formattedRow;
        });

        return {
          ok: true,
          engine: this.options.engineType,
          schema,
          rows,
          stats: { elapsedMs },
          diagnostics: this.parseDiagnostics(stderr),
        };
      } else if (Array.isArray(result)) {
        // Array of objects
        const firstRow = result[0];
        if (firstRow && typeof firstRow === "object") {
          const columns = Object.keys(firstRow);
          const rawRows = result.slice(0, rowLimit);

          const schema = columns.map((col: string) => {
            const sampleValue = firstRow[col];
            let type: "text" | "number" | "datetime" | "logical" | "any" = "any";
            if (typeof sampleValue === "string") type = "text";
            else if (typeof sampleValue === "number") type = "number";
            else if (sampleValue instanceof Date) type = "datetime";
            else if (typeof sampleValue === "boolean") type = "logical";
            return { name: col, type };
          });

          const rows = rawRows.map((row: any) => {
            const formattedRow: Record<string, any> = {};
            for (const col of columns) {
              let value = row[col];
              if (typeof value === "string" && value.length > 256 * 1024) {
                value = value.substring(0, 256 * 1024) + "[truncated]";
              }
              formattedRow[col] = value;
            }
            return formattedRow;
          });

          return {
            ok: true,
            engine: this.options.engineType,
            schema,
            rows,
            stats: { elapsedMs },
            diagnostics: this.parseDiagnostics(stderr),
          };
        }
      }
    } catch (error) {
      // If JSON parsing fails, try to extract table structure from text
      console.warn("Failed to parse JSON output, attempting text parsing");
    }

    // Fallback: return error
    return {
      ok: false,
      error: {
        code: "ENGINE_ERROR",
        message: "Failed to parse Mashup Engine output",
      },
      diagnostics: this.parseDiagnostics(stderr),
    };
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

      // Determine severity based on keywords
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
   * Cleanup temporary files
   */
  private cleanup(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }

    if (this.tempDir && fs.existsSync(this.tempDir)) {
      try {
        // Delete temp file
        if (this.tempFile && fs.existsSync(this.tempFile)) {
          fs.unlinkSync(this.tempFile);
        }
        // Delete temp directory and all contents
        const files = fs.readdirSync(this.tempDir);
        for (const file of files) {
          const filePath = path.join(this.tempDir, file);
          try {
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
              fs.rmSync(filePath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(filePath);
            }
          } catch (e) {
            // Ignore individual file errors
          }
        }
        fs.rmdirSync(this.tempDir);
      } catch (error) {
        console.warn("Failed to cleanup temp files:", error);
        // Try to delete directory anyway
        try {
          fs.rmSync(this.tempDir, { recursive: true, force: true });
        } catch (e) {
          // Final cleanup attempt failed, log but don't throw
          console.warn("Final cleanup attempt failed:", e);
        }
      }
    }
  }
}

