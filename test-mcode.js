/**
 * Direct test of M code execution
 * Run with: node test-mcode.js
 */

require('dotenv').config();

// Load the compiled modules
const { PowerQueryNetRunner } = require('./dist/main/powerQueryNetRunner');

const testMCode = `let
    Source = #table(
        {"Name", "Value", "Category"},
        {
            {"Item A", 100, "Type1"},
            {"Item B", 200, "Type2"},
            {"Item C", 150, "Type1"},
            {"Item D", 300, "Type2"}
        }
    ),
    #"Changed Type" = Table.TransformColumnTypes(Source, {{"Value", Int64.Type}}),
    #"Filtered Rows" = Table.SelectRows(#"Changed Type", each [Value] > 150)
in
    #"Filtered Rows"`;

async function testMCodeExecution() {
  console.log("=".repeat(60));
  console.log("TESTING M CODE EXECUTION WITH PowerQueryNet");
  console.log("=".repeat(60));
  
  const request = {
    mText: testMCode,
    entry: "#\"Filtered Rows\"",
    settings: {
      rowLimit: 10,
      timeoutMs: 10000,
    },
  };
  
  console.log("\nTest Configuration:");
  console.log("  M code length:", testMCode.length, "characters");
  console.log("  Entry point:", request.entry);
  console.log("  Row limit:", request.settings.rowLimit);
  console.log("  Timeout:", request.settings.timeoutMs, "ms");
  
  // Use PowerQueryNet ConsoleWrapper
  console.log("\n" + "=".repeat(60));
  console.log("TESTING WITH PowerQueryNet ConsoleWrapper");
  console.log("=".repeat(60));
  
  const pqnetRunner = new PowerQueryNetRunner();
  
  console.log("\n3. Executing M code...");
  console.log("-".repeat(60));
  
  try {
    const startTime = Date.now();
    const response = await pqnetRunner.execute(request);
    const elapsed = Date.now() - startTime;
    
    console.log("-".repeat(60));
    console.log("\n4. Execution Results:");
    console.log("  Elapsed time:", elapsed, "ms");
    console.log("  Success:", response.ok);
    
    if (response.ok) {
      console.log("  ✓ Execution successful!");
      console.log("  Rows:", response.rows?.length || 0);
      console.log("  Columns:", response.schema?.length || 0);
      
      if (response.schema) {
        console.log("\n  Schema:");
        response.schema.forEach(col => {
          console.log(`    - ${col.name}: ${col.type}`);
        });
      }
      
      if (response.rows && response.rows.length > 0) {
        console.log("\n  First 3 rows:");
        response.rows.slice(0, 3).forEach((row, i) => {
          console.log(`    Row ${i + 1}:`, JSON.stringify(row));
        });
      }
      
      if (response.stats) {
        console.log("\n  Stats:", response.stats);
      }
    } else {
      console.error("  ❌ Execution failed!");
      console.error("  Error code:", response.error?.code);
      console.error("  Error message:", response.error?.message);
      
      if (response.error?.code === "ENGINE_ERROR" && 
          response.error?.message?.includes("not found")) {
        console.error("\n  ⚠️  PowerQueryNet ConsoleWrapper.exe not found!");
        console.error("  To build it:");
        console.error("    1. Install Visual Studio (with MSBuild)");
        console.error("    2. Run: .\\build-console-wrapper.ps1");
        console.error("    3. Or build manually in Visual Studio:");
        console.error("       - Open PowerQueryNet\\PowerQueryNet.sln");
        console.error("       - Build ConsoleWrapper project");
      }
      
      if (response.diagnostics && response.diagnostics.length > 0) {
        console.error("\n  Diagnostics:");
        response.diagnostics.forEach((diag, i) => {
          console.error(`    ${i + 1}. ${diag.message}`);
        });
      }
    }
  } catch (error) {
    console.error("\n❌ Exception during execution:");
    console.error("  Error:", error.message);
    console.error("  Stack:", error.stack);
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("TEST COMPLETE");
  console.log("=".repeat(60));
}

// Run the test
testMCodeExecution().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
