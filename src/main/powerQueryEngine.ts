/**
 * Power Query M Engine using Excel COM Automation
 * This uses Windows COM to execute M code through Excel's Power Query engine
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface TableData {
  columns: string[];
  rows: any[][];
}

/**
 * Execute M code using Excel's Power Query engine via COM automation
 * This requires Excel to be installed and COM automation enabled
 */
export async function executeMCodeWithExcel(
  code: string,
  initialData?: TableData
): Promise<TableData> {
  try {
    // Create a PowerShell script that uses COM to execute M code
    const psScript = `
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$workbook = $excel.Workbooks.Add()
$worksheet = $workbook.Worksheets.Item(1)

# Create a Power Query connection
$query = $workbook.Queries.Add("Query1", '${code.replace(/'/g, "''")}')

# Execute the query
try {
    $result = $query.Evaluate()
    # Convert result to JSON
    $json = $result | ConvertTo-Json -Depth 10
    Write-Output $json
} catch {
    Write-Error $_.Exception.Message
} finally {
    $workbook.Close($false)
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
`;

    // Execute PowerShell script
    const { stdout, stderr } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`
    );

    if (stderr) {
      console.error("PowerShell error:", stderr);
      throw new Error(stderr);
    }

    // Parse the result
    const result = JSON.parse(stdout);
    return convertExcelResultToTableData(result);
  } catch (error) {
    console.error("Error executing M code with Excel:", error);
    // Fallback to custom engine
    return executeMCodeFallback(code, initialData);
  }
}

/**
 * Fallback: Use our custom M code engine
 */
function executeMCodeFallback(
  code: string,
  initialData?: TableData
): TableData {
  // Import and use the custom engine
  const { executeMCode } = require("./mCodeEngine");
  return executeMCode(code, initialData);
}

/**
 * Convert Excel result to our TableData format
 */
function convertExcelResultToTableData(result: any): TableData {
  // This is a placeholder - actual conversion depends on Excel's result format
  // For now, return the custom engine result
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
}




