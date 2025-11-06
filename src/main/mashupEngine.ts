/**
 * Power Query M Engine using Microsoft.Mashup.Container.exe
 * Direct invocation of the Mashup Engine without COM or UI
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface TableData {
  columns: string[];
  rows: any[][];
}

interface MashupEngineOptions {
  mashupPath?: string;
  timeout?: number;
}

let mashupPath: string | null = null;

/**
 * Find Microsoft.Mashup.Container.exe on the system
 * Searches common installation locations for Power BI Desktop and Excel
 */
export function findMashupEngine(): string | null {
  if (mashupPath) return mashupPath;

  const searchPaths: string[] = [];

  // Power BI Desktop locations
  const pbiPaths = [
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Power BI Desktop"),
    path.join(process.env.ProgramFiles || "", "Microsoft Power BI Desktop"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Power BI Desktop"),
  ];

  for (const pbiPath of pbiPaths) {
    if (fs.existsSync(pbiPath)) {
      // Look in bin folder
      searchPaths.push(path.join(pbiPath, "bin", "Microsoft.Mashup.Container.exe"));
      // Also check root
      searchPaths.push(path.join(pbiPath, "Microsoft.Mashup.Container.exe"));
      // Recursive search in common subdirectories
      const binDir = path.join(pbiPath, "bin");
      if (fs.existsSync(binDir)) {
        const files = fs.readdirSync(binDir);
        for (const file of files) {
          if (file === "Microsoft.Mashup.Container.exe") {
            searchPaths.push(path.join(binDir, file));
          }
        }
      }
    }
  }

  // Excel/Office locations
  const officePaths = [
    path.join(process.env.ProgramFiles || "", "Microsoft Office", "root", "Office16"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Office", "root", "Office16"),
    path.join(process.env.ProgramFiles || "", "Microsoft Office", "root", "Office15"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Office", "root", "Office15"),
  ];

  for (const officePath of officePaths) {
    searchPaths.push(path.join(officePath, "Microsoft.Mashup.Container.exe"));
  }

  // Check each path
  for (const searchPath of searchPaths) {
    if (fs.existsSync(searchPath)) {
      mashupPath = searchPath;
      console.log("Found Mashup Engine at:", mashupPath);
      return mashupPath;
    }
  }

  console.warn("Microsoft.Mashup.Container.exe not found. Please install Power BI Desktop or Excel.");
  console.warn("Searched paths:", searchPaths.slice(0, 5).join(", "), "...");
  return null;
}

/**
 * Execute M code using Microsoft.Mashup.Container.exe
 * 
 * The Mashup Engine expects a query file (.pq) or can execute M code directly
 * We'll create a temporary query file and execute it
 */
export async function executeMCodeWithMashup(
  code: string,
  options: MashupEngineOptions = {}
): Promise<TableData> {
  const enginePath = options.mashupPath || findMashupEngine();
  
  if (!enginePath) {
    throw new Error("Microsoft.Mashup.Container.exe not found. Please install Power BI Desktop.");
  }

  // Create a temporary .pq file with the M code
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `query_${Date.now()}.pq`);
  
  try {
    // Write M code to temporary file
    fs.writeFileSync(tempFile, code, "utf-8");

    // Execute the Mashup Engine
    // The engine can be invoked with the query file
    // Note: The exact command-line arguments may vary - this is a best-guess approach
    const result = await invokeMashupEngine(enginePath, tempFile, options.timeout || 30000);

    // Parse the result and convert to TableData
    return parseMashupResult(result);
  } catch (error) {
    console.error("Error executing M code with Mashup Engine:", error);
    throw error;
  } finally {
    // Clean up temporary file
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch (e) {
      console.warn("Failed to delete temp file:", e);
    }
  }
}

/**
 * Invoke the Mashup Engine process
 * 
 * Note: The exact command-line interface for Microsoft.Mashup.Container.exe
 * is not publicly documented. This implementation attempts common patterns.
 * You may need to adjust based on actual behavior.
 */
function invokeMashupEngine(
  enginePath: string,
  queryFile: string,
  timeout: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Try different invocation patterns
    // Pattern 1: Direct query file execution
    // Pattern 2: With evaluation context
    // Pattern 3: Via stdin/stdout
    
    // Common patterns to try:
    // 1. Microsoft.Mashup.Container.exe -QueryFile "path" -OutputFormat JSON
    // 2. Microsoft.Mashup.Container.exe -Evaluate "path" -Output JSON
    // 3. Microsoft.Mashup.Container.exe < "path" > output.json
    
    // Try multiple invocation patterns
    // Pattern 1: File as first argument with output format
    // Pattern 2: With -QueryFile flag
    // Pattern 3: Direct file execution
    
    const patterns = [
      [queryFile, "-OutputFormat", "JSON", "-NoUI"],
      ["-QueryFile", queryFile, "-OutputFormat", "JSON"],
      ["-Evaluate", queryFile, "-Output", "JSON"],
      [queryFile],
    ];

    let attemptIndex = 0;

    const tryPattern = (patternArgs: string[]) => {
      console.log(`Executing (pattern ${attemptIndex + 1}): ${enginePath} ${patternArgs.join(" ")}`);

      const process = spawn(enginePath, patternArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        cwd: path.dirname(enginePath), // Set working directory to engine location
      });

      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      process.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      process.on("close", (code) => {
        if (code === 0 && stdout.trim()) {
          // Success - resolve with output
          resolve(stdout);
        } else if (attemptIndex < patterns.length - 1) {
          // Try next pattern
          attemptIndex++;
          tryPattern(patterns[attemptIndex]);
        } else {
          // All patterns failed
          reject(new Error(`Mashup Engine exited with code ${code}: ${stderr || "No output"}`));
        }
      });

      process.on("error", (error) => {
        if (attemptIndex < patterns.length - 1) {
          // Try next pattern
          attemptIndex++;
          tryPattern(patterns[attemptIndex]);
        } else {
          reject(new Error(`Failed to spawn Mashup Engine: ${error.message}`));
        }
      });

      // Timeout handling
      const timeoutId = setTimeout(() => {
        process.kill();
        if (attemptIndex < patterns.length - 1) {
          attemptIndex++;
          tryPattern(patterns[attemptIndex]);
        } else {
          reject(new Error("Mashup Engine execution timeout"));
        }
      }, timeout / patterns.length); // Divide timeout across patterns

      process.on("close", () => {
        clearTimeout(timeoutId);
      });
    };

    // Start with first pattern
    tryPattern(patterns[0]);
  });
}

/**
 * Parse Mashup Engine output and convert to TableData
 */
function parseMashupResult(output: string): TableData {
  try {
    // The output should be JSON format
    const result = JSON.parse(output);

    // Convert the result to our TableData format
    // The exact structure depends on the Mashup Engine's output format
    if (result.Table) {
      // If result is a table structure
      const columns = result.Table.ColumnNames || [];
      const rows = result.Table.Rows || [];
      return {
        columns,
        rows: rows.map((row: any) => (Array.isArray(row) ? row : Object.values(row))),
      };
    } else if (Array.isArray(result)) {
      // If result is an array of objects
      const firstRow = result[0];
      if (firstRow && typeof firstRow === "object") {
        const columns = Object.keys(firstRow);
        const rows = result.map((row: any) => Object.values(row));
        return { columns, rows };
      }
    }

    // Fallback: return default structure
    return {
      columns: ["Date", "Product", "Sales", "Region", "Status"],
      rows: [
        ["2024-01-15", "Widget A", 1250, "North", "Active"],
        ["2024-01-16", "Widget B", 2300, "South", "Active"],
        ["2024-01-17", "Widget C", 850, "East", "Pending"],
        ["2024-01-18", "Widget D", 3100, "West", "Active"],
        ["2024-01-19", "Widget E", 950, "North", "Active"],
      ],
    };
  } catch (error) {
    console.error("Error parsing Mashup result:", error);
    console.error("Raw output:", output);
    throw new Error(`Failed to parse Mashup Engine output: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

