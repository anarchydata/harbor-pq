"""
Read Excel file structure (sheets and tables) using Python
Uses openpyxl for reading Excel files
"""

import sys
import json
from pathlib import Path

try:
    import openpyxl
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False
    print("ERROR: openpyxl is not installed. Install with: pip install openpyxl", file=sys.stderr)
    sys.exit(1)


def read_excel_structure(file_path: str):
    """Read Excel file and return list of sheets and tables using openpyxl"""
    file_path = Path(file_path)
    
    if not file_path.exists():
        return {
            "success": False,
            "error": f"File not found: {file_path}"
        }
    
    sheets = []
    tables = []
    
    try:
        if HAS_OPENPYXL:
            # Use openpyxl for .xlsx files
            if file_path.suffix.lower() == '.xlsx':
                # Open in read-write mode to access tables (list objects)
                # If file is locked (open in Excel), it will fail with an error
                wb = openpyxl.load_workbook(file_path, read_only=False, data_only=False)
                
                # Get all sheets and their tables
                for sheet in wb.worksheets:
                    sheet_name = sheet.title
                    sheets.append({
                        "name": sheet_name,
                        "item": sheet_name,
                        "kind": "Sheet",
                        "hidden": sheet.sheet_state == "hidden"
                    })
                    
                    # Check for tables in this sheet
                    # In openpyxl, tables are accessed via sheet.tables (dict-like)
                    if hasattr(sheet, 'tables') and sheet.tables:
                        for table_name, table_obj in sheet.tables.items():
                            print(f"DEBUG: Found table '{table_name}' in sheet '{sheet_name}'", file=sys.stderr)
                            tables.append({
                                "name": table_name,
                                "item": table_name,
                                "kind": "Table",
                                "hidden": False,
                                "sheet": sheet_name
                            })
                
                # Close the workbook to release the file lock
                # This allows Power Query to open it later
                wb.close()
                # Small delay to ensure file is fully released
                import time
                time.sleep(0.1)
            else:
                return {
                    "success": False,
                    "error": f"openpyxl only supports .xlsx files. For .xls files, install xlrd: pip install xlrd"
                }
        else:
            return {
                "success": False,
                "error": "openpyxl is not available"
            }
        
        result = {
            "success": True,
            "sheets": sheets,
            "tables": tables
        }
        print(f"DEBUG: Returning {len(sheets)} sheets and {len(tables)} tables", file=sys.stderr)
        return result
        
    except Exception as e:
        import traceback
        error_msg = f"Error reading Excel file: {str(e)}\n{traceback.format_exc()}"
        print(f"ERROR: {error_msg}", file=sys.stderr)
        return {
            "success": False,
            "error": error_msg
        }


def read_excel_data(file_path: str, selection: dict):
    """Read Excel table or sheet data and return as M table format"""
    file_path = Path(file_path)
    
    if not file_path.exists():
        return {
            "success": False,
            "error": f"File not found: {file_path}"
        }
    
    try:
        if HAS_OPENPYXL:
            if file_path.suffix.lower() == '.xlsx':
                wb = openpyxl.load_workbook(file_path, read_only=False, data_only=True)
                
                if selection["kind"] == "Table":
                    # Read table data
                    sheet = wb[selection["sheet"]]
                    table_ref = sheet.tables[selection["item"]]
                    
                    # Get table range - table_ref might be a string or an object with .ref
                    if isinstance(table_ref, str):
                        ref = table_ref
                    elif hasattr(table_ref, 'ref'):
                        ref = table_ref.ref
                    else:
                        return {
                            "success": False,
                            "error": f"Could not get table range for {selection['item']}"
                        }
                    table_range = sheet[ref]
                    
                    # Extract data
                    rows = []
                    for row in table_range:
                        rows.append([cell.value for cell in row])
                    
                    wb.close()
                    
                    if not rows:
                        return {
                            "success": False,
                            "error": "Table is empty"
                        }
                    
                    # First row is headers
                    columns = [str(cell) if cell is not None else "" for cell in rows[0]]
                    data_rows = rows[1:] if len(rows) > 1 else []
                    
                else:
                    # Read sheet data
                    sheet = wb[selection["name"]]
                    
                    # Get all data from sheet
                    rows = []
                    for row in sheet.iter_rows(values_only=True):
                        if any(cell is not None for cell in row):
                            rows.append([cell if cell is not None else "" for cell in row])
                    
                    wb.close()
                    
                    if not rows:
                        return {
                            "success": False,
                            "error": "Sheet is empty"
                        }
                    
                    # First row is headers (or use A, B, C if no headers)
                    columns = [str(cell) if cell is not None else f"Column{i+1}" for i, cell in enumerate(rows[0])]
                    data_rows = rows[1:] if len(rows) > 1 else []
                
                # Convert to #table format for Power Query (more reliable than JSON)
                # Format: #table({"Column1", "Column2", ...}, {{value1, value2, ...}, ...})
                from datetime import datetime, date
                columns_m = "{" + ", ".join([f'"{col}"' for col in columns]) + "}"
                
                def format_value(val):
                    """Format a value for M code - dates as raw strings"""
                    if val is None:
                        return "null"
                    elif isinstance(val, (int, float)):
                        return str(val)
                    elif isinstance(val, bool):
                        return "true" if val else "false"
                    else:
                        # Everything else (including dates) as string - escape quotes
                        val_str = str(val)
                        val_str_escaped = val_str.replace('"', '""')
                        return f'"{val_str_escaped}"'
                
                rows_m = "{" + ", ".join([
                    "{" + ", ".join([
                        format_value(val)
                        for val in row[:len(columns)]
                    ]) + "}"
                    for row in data_rows
                ]) + "}"
                
                m_table = f"#table({columns_m}, {rows_m})"
                
                return {
                    "success": True,
                    "m_table": m_table,
                    "columns": columns,
                    "rowCount": len(data_rows),
                    "columnCount": len(columns)
                }
            else:
                return {
                    "success": False,
                    "error": f"openpyxl only supports .xlsx files"
                }
        else:
            return {
                "success": False,
                "error": "openpyxl is not available"
            }
    except Exception as e:
        import traceback
        error_msg = f"Error reading Excel data: {str(e)}\n{traceback.format_exc()}"
        print(f"ERROR: {error_msg}", file=sys.stderr)
        return {
            "success": False,
            "error": error_msg
        }


if __name__ == "__main__":
    # Read from command line arguments
    if len(sys.argv) < 2:
        result = {
            "success": False,
            "error": "Usage: python excelReader.py <excel_file_path> [read_data] [selection_json]"
        }
    else:
        file_path = sys.argv[1]
        
        # Check if we're reading data or just structure
        if len(sys.argv) >= 3 and sys.argv[2] == "read_data":
            # Read data - selection JSON is in sys.argv[3]
            import json as json_module
            selection = json_module.loads(sys.argv[3])
            result = read_excel_data(file_path, selection)
        else:
            # Read structure
            result = read_excel_structure(file_path)
    
    # Output as JSON
    print(json.dumps(result))
