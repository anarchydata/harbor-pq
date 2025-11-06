/**
 * Simple M Code execution engine
 * Parses and executes basic Power Query M operations
 */

interface TableData {
  columns: string[];
  rows: any[][];
}

export function executeMCode(code: string, initialData?: TableData): TableData {
  console.log("[mCodeEngine] Executing M code, length:", code.length);
  console.log("[mCodeEngine] Code preview:", code.substring(0, 200));
  
  // Try to parse #table() construct first
  let data: TableData | null = null;
  
  // Look for #table(columns, rows) pattern - handle nested braces
  const tableMatch = code.match(/#table\s*\(\s*(\{[^}]+\})\s*,\s*(\{[\s\S]*?\})\s*\)/);
  if (tableMatch) {
    console.log("[mCodeEngine] Found #table() construct");
    const columnsStr = tableMatch[1].slice(1, -1); // Remove outer braces
    const rowsStr = tableMatch[2].slice(1, -1); // Remove outer braces
    
    // Parse columns
    const columns = columnsStr
      .split(",")
      .map(c => c.trim().replace(/^#?"?|"?$/g, ""));
    console.log("[mCodeEngine] Parsed columns:", columns);
    
    // Parse rows - handle nested braces properly
    const rows: any[][] = [];
    
    // Find all row objects: {value1, value2, ...}
    let braceDepth = 0;
    let currentRow = "";
    let inRow = false;
    
    for (let i = 0; i < rowsStr.length; i++) {
      const char = rowsStr[i];
      
      if (char === '{') {
        if (braceDepth === 0) {
          inRow = true;
          currentRow = "";
        }
        braceDepth++;
      } else if (char === '}') {
        braceDepth--;
        if (braceDepth === 0 && inRow) {
          // Complete row found
          const rowContent = currentRow.trim();
          if (rowContent) {
            // Parse values - split by comma but respect quotes
            const values: any[] = [];
            let currentValue = "";
            let inQuotes = false;
            let quoteChar = '';
            
            for (let j = 0; j < rowContent.length; j++) {
              const c = rowContent[j];
              if ((c === '"' || c === "'") && (j === 0 || rowContent[j-1] !== '\\')) {
                if (!inQuotes) {
                  inQuotes = true;
                  quoteChar = c;
                } else if (c === quoteChar) {
                  inQuotes = false;
                  quoteChar = '';
                } else {
                  currentValue += c;
                }
              } else if (c === ',' && !inQuotes) {
                // Value complete
                const trimmed = currentValue.trim();
                if (trimmed) {
                  // Try to parse as number
                  const num = Number(trimmed);
                  values.push(isNaN(num) ? trimmed : num);
                }
                currentValue = "";
              } else {
                currentValue += c;
              }
            }
            // Add last value
            if (currentValue.trim()) {
              const trimmed = currentValue.trim();
              const num = Number(trimmed);
              values.push(isNaN(num) ? trimmed : num);
            }
            
            if (values.length === columns.length) {
              rows.push(values);
            }
          }
          inRow = false;
        }
      } else if (inRow) {
        currentRow += char;
      }
    }
    
    if (rows.length > 0) {
      data = { columns, rows };
      console.log("[mCodeEngine] ✓ Parsed #table():", columns.length, "columns,", rows.length, "rows");
      console.log("[mCodeEngine] Sample row:", rows[0]);
    } else {
      console.log("[mCodeEngine] Failed to parse rows from #table()");
    }
  }
  
  // Fallback to default data if no table found
  if (!data) {
    console.log("[mCodeEngine] No #table() found, using default data");
    data = initialData || {
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

  // Parse each step in the let block - handle multi-line expressions
  const letBlock = code.match(/let\s+(.+?)\s+in\s+(.+?)(?:\s*$)/is);
  if (!letBlock) {
    console.log("[mCodeEngine] No 'let...in' block found");
    return data;
  }

  const stepsContent = letBlock[1];
  const finalStep = letBlock[2].trim().replace(/^#?"?|"?$/g, ""); // Remove quotes and # prefix
  console.log("[mCodeEngine] Final step:", finalStep);
  // Split by step definitions - look for patterns like: StepName = or #"Step Name" =
  const stepPattern = /(?:#?"?([^"=\n]+)"?\s*=\s*)([^=]+?)(?=(?:\s*#?"?[^"=\n]+"?\s*=|\s*in\s+))/gis;
  const steps: Map<string, string> = new Map();
  let match;

  // Alternative: split by lines and find step definitions
  const lines = stepsContent.split(/\n/);
  let currentStep: { name: string; expr: string } | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Check if this line starts a new step: "StepName = " or '#"Step Name" = '
    const stepStartMatch = trimmed.match(/^#?"?([^"=\n]+)"?\s*=\s*(.+)/);
    if (stepStartMatch) {
      // Save previous step if exists
      if (currentStep) {
        steps.set(currentStep.name, currentStep.expr.trim());
        console.log(`[mCodeEngine] Saved step: ${currentStep.name} = ${currentStep.expr.substring(0, 50)}...`);
      }
      // Start new step
      currentStep = {
        name: stepStartMatch[1].trim().replace(/^#?"?|"?$/g, ""),
        expr: stepStartMatch[2].trim(),
      };
      console.log(`[mCodeEngine] Started step: ${currentStep.name}`);
    } else if (currentStep) {
      // Continue current step - check if next line starts a new step or is "in"
      const nextLine = i < lines.length - 1 ? lines[i + 1].trim() : "";
      const isNextLineNewStep = nextLine.match(/^#?"?[^"=\n]+"?\s*=/);
      const isNextLineIn = nextLine.match(/^in\s+/);
      
      if (trimmed.endsWith(",") && !isNextLineNewStep && !isNextLineIn) {
        // Continue current step expression (remove trailing comma)
        currentStep.expr += " " + trimmed.slice(0, -1);
      } else if (!isNextLineNewStep && !isNextLineIn) {
        // Continue current step (no comma, but next line is not a new step or "in")
        currentStep.expr += " " + trimmed;
      } else {
        // Next line is a new step or "in", so this line ends current step
        if (trimmed.endsWith(",")) {
          currentStep.expr += " " + trimmed.slice(0, -1);
        } else {
          currentStep.expr += " " + trimmed;
        }
        // Save and reset
        steps.set(currentStep.name, currentStep.expr.trim());
        console.log(`[mCodeEngine] Saved step (end of block): ${currentStep.name}`);
        currentStep = null;
      }
    }
  }
  
  // Save last step
  if (currentStep) {
    steps.set(currentStep.name, currentStep.expr.trim());
    console.log(`[mCodeEngine] Saved final step: ${currentStep.name}`);
  }
  
  console.log("Parsed steps:", Array.from(steps.keys()));

  // Check if final step is in the steps map or needs to be executed
  const cleanFinalStep = finalStep.replace(/^#?"?|"?$/g, "");
  const finalStepExists = Array.from(steps.keys()).some(k => {
    const cleanKey = k.replace(/^#?"?|"?$/g, "");
    return cleanKey === cleanFinalStep;
  });

  // Execute steps in order
  const stepNames = Array.from(steps.keys());
  console.log("[mCodeEngine] Executing steps in order:", stepNames);
  console.log("[mCodeEngine] Final step:", cleanFinalStep, "exists in steps:", finalStepExists);
  
  for (const [stepName, stepExpression] of steps) {
    // Skip Source step if it's just a #table() (we already parsed it)
    if (stepName === "Source" && stepExpression.includes("#table")) {
      console.log(`[mCodeEngine] Skipping Source step (already parsed #table): ${stepName}`);
      continue;
    }
    if (stepName === "Source" && stepExpression.includes("Excel.CurrentWorkbook")) {
      console.log(`[mCodeEngine] Skipping Source step (Excel connection): ${stepName}`);
      continue;
    }

    console.log(`[mCodeEngine] Executing step: ${stepName}`);
    // Execute the step
    const previousData = JSON.parse(JSON.stringify(data));
    data = executeStep(stepExpression, data, steps);
    console.log(`[mCodeEngine] Step ${stepName}: ${previousData.rows.length} -> ${data.rows.length} rows, ${previousData.columns.length} -> ${data.columns.length} columns`);

    // If this is the final step, return the result
    const cleanStepName = stepName.replace(/^#?"?|"?$/g, "");
    if (cleanStepName === cleanFinalStep || stepName === finalStep) {
      console.log(`[mCodeEngine] Reached final step: ${stepName}`);
      break;
    }
  }
  
  // If final step wasn't in the steps map, try to execute it directly
  if (!finalStepExists) {
    console.log(`[mCodeEngine] Final step '${cleanFinalStep}' not in steps map, checking if it references a step...`);
    // Check if final step references one of the steps we executed
    for (const [stepName] of steps) {
      const cleanStepName = stepName.replace(/^#?"?|"?$/g, "");
      if (cleanFinalStep.includes(cleanStepName) || cleanStepName === cleanFinalStep) {
        // Already executed, data is correct
        console.log(`[mCodeEngine] Final step references executed step: ${stepName}`);
        break;
      }
    }
  }

  console.log("Final result:", data.columns.length, "columns,", data.rows.length, "rows");
  return data;
}

function executeStep(expression: string, data: TableData, steps: Map<string, string>): TableData {
  console.log("  Executing expression:", expression.substring(0, 100));
  
  // Resolve step references first (e.g., if expression is just a step name)
  for (const [stepName, stepExpr] of steps) {
    // Check if this expression references another step
    const cleanStepName = stepName.replace(/^#?"?|"?$/g, "");
    if (expression.trim() === stepName || expression.trim() === `#"${cleanStepName}"` || expression.trim() === cleanStepName) {
      // This is a step reference, execute the referenced step
      return executeStep(stepExpr, data, steps);
    }
  }
  
  // Table.RemoveColumns - handle both single and multiple columns
  if (expression.includes("Table.RemoveColumns")) {
    // Match: Table.RemoveColumns(PreviousStep, {"Column1", "Column2"})
    const match = expression.match(/Table\.RemoveColumns\([^,]+,\s*\{([^}]+)\}/);
    if (match) {
      const columnsToRemove = match[1]
        .split(",")
        .map((c) => c.trim().replace(/^#?"?|"?$/g, ""));
      console.log("  Removing columns:", columnsToRemove);
      // Get the input table from the first parameter
      const inputMatch = expression.match(/Table\.RemoveColumns\(([^,]+),/);
      if (inputMatch) {
        const inputStep = inputMatch[1].trim();
        // Resolve the input step first
        for (const [stepName, stepExpr] of steps) {
          if (inputStep === stepName || inputStep === `#"${stepName.replace(/^#?"?|"?$/g, "")}"`) {
            data = executeStep(stepExpr, data, steps);
            break;
          }
        }
      }
      return removeColumns(data, columnsToRemove);
    }
  }

  // Table.AddIndexColumn
  if (expression.includes("Table.AddIndexColumn")) {
    // Match: Table.AddIndexColumn(PreviousStep, "Index", 1, 1)
    const match = expression.match(/Table\.AddIndexColumn\([^,]+(?:,\s*"([^"]+)")?/);
    const columnName = match?.[1] || "Index";
    console.log("  Adding index column:", columnName);
    // Get the input table from the first parameter
    const inputMatch = expression.match(/Table\.AddIndexColumn\(([^,]+),/);
    if (inputMatch) {
      const inputStep = inputMatch[1].trim();
      // Resolve the input step first
      for (const [stepName, stepExpr] of steps) {
        if (inputStep === stepName || inputStep === `#"${stepName.replace(/^#?"?|"?$/g, "")}"`) {
          data = executeStep(stepExpr, data, steps);
          break;
        }
      }
    }
    return addIndexColumn(data, columnName);
  }

  // Table.SelectRows - filter rows based on condition
  if (expression.includes("Table.SelectRows")) {
    console.log("  Executing Table.SelectRows");
    const match = expression.match(/Table\.SelectRows\(([^,]+),\s*each\s+(.+?)\)/);
    if (match) {
      const inputStep = match[1].trim();
      const condition = match[2].trim();
      console.log("  Filter condition:", condition);
      
      // Resolve the input step first
      let inputData = data;
      for (const [stepName, stepExpr] of steps) {
        const cleanStepName = stepName.replace(/^#?"?|"?$/g, "");
        if (inputStep === stepName || inputStep === `#"${cleanStepName}"` || inputStep === cleanStepName) {
          inputData = executeStep(stepExpr, data, steps);
          break;
        }
      }
      
      // Parse condition like: [Value] > 150
      const conditionMatch = condition.match(/\[([^\]]+)\]\s*([><=!]+)\s*(.+)/);
      if (conditionMatch) {
        const columnName = conditionMatch[1];
        const operator = conditionMatch[2];
        const valueStr = conditionMatch[3].trim();
        const value = Number(valueStr);
        
        console.log(`  Filtering: ${columnName} ${operator} ${value}`);
        
        const columnIndex = inputData.columns.indexOf(columnName);
        if (columnIndex >= 0) {
          const filteredRows = inputData.rows.filter(row => {
            const cellValue = row[columnIndex];
            const numValue = Number(cellValue);
            if (!isNaN(numValue) && !isNaN(value)) {
              switch (operator) {
                case ">": return numValue > value;
                case "<": return numValue < value;
                case ">=": return numValue >= value;
                case "<=": return numValue <= value;
                case "=": return numValue === value;
                case "!=": return numValue !== value;
                default: return true;
              }
            }
            return true;
          });
          console.log(`  Filtered from ${inputData.rows.length} to ${filteredRows.length} rows`);
          return { columns: inputData.columns, rows: filteredRows };
        }
      }
    }
    return data;
  }

  // Table.TransformColumnTypes
  if (expression.includes("Table.TransformColumnTypes")) {
    // Type transformation doesn't change the structure, just return data
    return data;
  }

  // If step references another step, use that step's data
  for (const [stepName, stepExpr] of steps) {
    if (expression.includes(stepName)) {
      return executeStep(stepExpr, data, steps);
    }
  }

  return data;
}

function removeColumns(data: TableData, columnsToRemove: string[]): TableData {
  const columnIndices = columnsToRemove
    .map((col) => data.columns.indexOf(col))
    .filter((idx) => idx !== -1);

  const newColumns = data.columns.filter((_, idx) => !columnIndices.includes(idx));
  const newRows = data.rows.map((row) =>
    row.filter((_, idx) => !columnIndices.includes(idx))
  );

  return {
    columns: newColumns,
    rows: newRows,
  };
}

function addIndexColumn(data: TableData, columnName: string = "Index"): TableData {
  // Check if column already exists
  if (data.columns.includes(columnName)) {
    return data;
  }

  const newColumns = [...data.columns, columnName];
  const newRows = data.rows.map((row, idx) => [...row, idx + 1]);

  return {
    columns: newColumns,
    rows: newRows,
  };
}

