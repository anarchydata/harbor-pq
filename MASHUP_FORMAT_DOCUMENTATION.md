# Mashup Format for M Code Execution

Based on MS-QDEFF specification and PowerQueryNet implementation.

## Current Format (Working)

The mashup string format used by PowerQueryNet is:

```
section Section1;\n\r
shared QueryName = Formula;\n\r
```

### Details:

1. **Section Declaration**: `section Section1;` - Required first line
   - Section name can be any identifier (typically "Section1" or "Default")
   - Must end with semicolon

2. **Query Declaration**: `shared QueryName = Formula;`
   - `shared` keyword is required
   - QueryName can be plain identifier or wrapped in `#"..."` if it contains spaces
   - Formula is the M code expression (can be `let...in` or any M expression)
   - Must end with semicolon

3. **Line Endings**: `\n\r` (LF + CR) or `\r\n` (CRLF) - both should work

### Examples:

**Simple value:**
```
section Section1;\n\r
shared hw = "Hello World";\n\r
```

**Let expression:**
```
section Section1;\n\r
shared hw = let hw = "Hello World" in hw;\n\r
```

**Query with spaces in name:**
```
section Section1;\n\r
shared #"Filtered Rows" = let Source = #table(...) in #"Filtered Rows";\n\r
```

**Multiple queries:**
```
section Section1;\n\r
shared Query1 = let x = 1 in x;\n\r
shared Query2 = let y = 2 in y;\n\r
```

## How It Works

1. The mashup string is passed to `Utilities.CreateMashupConnectionInfo(mashup, out error)`
2. This creates a `MashupConnectionStringBuilder` object
3. The `Location` property is set to the plain query name (without `#"..."` wrapper)
4. The SDK executes the query using `QueryExecutor.CreateExecution()`

## Current Issue

The format is correct, but we're hitting a version mismatch:
- Old SDK Tools.dll (v1.1.0.0) expects Data.Mashup v1.1.0.0
- New Power BI Desktop Data.Mashup.dll is v1.0.0.0
- This causes assembly loading errors before we can even test the format

## MS-QDEFF Specification

The MS-QDEFF spec describes the binary format used in Excel/Power BI files, but for execution via the SDK, we need the text format shown above. The SDK's `Utilities.CreateMashupConnectionInfo` parses this text format and converts it internally.



