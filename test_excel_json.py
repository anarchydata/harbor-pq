"""Test script to read Excel file, extract Table1, convert to JSON, and test M code"""
import sys
import json
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("ERROR: openpyxl not installed")
    sys.exit(1)

file_path = r"C:\Users\jpo64\Downloads\sample_powerquery_data.xlsx"

# Read the file
wb = openpyxl.load_workbook(file_path, read_only=False, data_only=True)

# Find Table1
table_found = False
for sheet in wb.worksheets:
    if hasattr(sheet, 'tables') and sheet.tables:
        for table_name, table_obj in sheet.tables.items():
            if table_name == "Table1":
                print(f"Found Table1 in sheet: {sheet.title}")
                
                # Get table range - in openpyxl, table_obj should have a ref attribute
                # But let's check what type it is
                print(f"Table object type: {type(table_obj)}")
                print(f"Table object: {table_obj}")
                
                if hasattr(table_obj, 'ref'):
                    ref = table_obj.ref
                    table_range = sheet[ref]
                elif isinstance(table_obj, str):
                    # It's already a string reference
                    ref = table_obj
                    table_range = sheet[ref]
                else:
                    print(f"Unexpected table type: {type(table_obj)}, value: {table_obj}")
                    # Try to access it as a dict
                    if isinstance(sheet.tables, dict):
                        table_info = sheet.tables.get(table_name)
                        if hasattr(table_info, 'ref'):
                            ref = table_info.ref
                            table_range = sheet[ref]
                        else:
                            print("Cannot get table range")
                            break
                    else:
                        break
                
                # Extract data
                rows = []
                for row in table_range:
                    rows.append([cell.value for cell in row])
                
                if not rows:
                    print("Table is empty")
                    break
                
                # First row is headers
                columns = [str(cell) if cell is not None else "" for cell in rows[0]]
                data_rows = rows[1:] if len(rows) > 1 else []
                
                print(f"Columns: {columns}")
                print(f"Rows: {len(data_rows)}")
                
                # Convert to JSON
                json_data = []
                for row in data_rows:
                    record = {}
                    for i, col in enumerate(columns):
                        if i < len(row):
                            val = row[i]
                            if val is None:
                                record[col] = None
                            elif isinstance(val, (int, float)):
                                record[col] = val
                            elif isinstance(val, bool):
                                record[col] = val
                            else:
                                record[col] = str(val)
                    json_data.append(record)
                
                json_str = json.dumps(json_data, ensure_ascii=False)
                print(f"\nJSON (first 200 chars): {json_str[:200]}...")
                
                # Test M code syntax
                # In M code, to include quotes in a string, double them
                json_escaped = json_str.replace('"', '""')
                
                # Generate M code
                source_description = f'Excel.Workbook(File.Contents("C:/Users/jpo64/Downloads/sample_powerquery_data.xlsx"), null, true){{[Item="Table1",Kind="Table"]}}[Data]'
                
                # Try different M code formats
                print("\n=== M Code Option 1: Json.Document with escaped quotes ===")
                m_code_1 = f'Source = Table.FromRecords(Json.Document("{json_escaped}")) // From: {source_description}'
                print(m_code_1[:300] + "...")
                
                print("\n=== M Code Option 2: #table with proper date formatting ===")
                from datetime import datetime, date
                columns_m = "{" + ", ".join([f'"{col}"' for col in columns]) + "}"
                
                def format_value(val):
                    """Format a value for M code"""
                    if val is None:
                        return "null"
                    elif isinstance(val, (datetime, date)):
                        if isinstance(val, datetime):
                            return f"#datetime({val.year}, {val.month}, {val.day}, {val.hour}, {val.minute}, {val.second})"
                        else:
                            return f"#date({val.year}, {val.month}, {val.day})"
                    elif isinstance(val, (int, float)):
                        return str(val)
                    elif isinstance(val, bool):
                        return "true" if val else "false"
                    else:
                        val_str = str(val)
                        try:
                            if " " in val_str and "-" in val_str:
                                parts = val_str.split(" ")
                                date_part = parts[0]
                                time_part = parts[1] if len(parts) > 1 else "00:00:00"
                                year, month, day = map(int, date_part.split("-"))
                                hour, minute, second = map(int, time_part.split(":"))
                                return f"#datetime({year}, {month}, {day}, {hour}, {minute}, {second})"
                            elif "-" in val_str and len(val_str.split("-")) == 3:
                                year, month, day = map(int, val_str.split("-"))
                                return f"#date({year}, {month}, {day})"
                        except (ValueError, AttributeError):
                            pass
                        val_str_escaped = val_str.replace('"', '""')
                        return f'"{val_str_escaped}"'
                
                rows_m = "{" + ", ".join([
                    "{" + ", ".join([
                        format_value(val)
                        for val in row[:len(columns)]
                    ]) + "}"
                    for row in data_rows[:5]  # Just first 5 rows for testing
                ]) + "}"
                m_code_2 = f'Source = #table({columns_m}, {rows_m}) // From: {source_description}'
                print(m_code_2)
                print(f"\nFull M code length: {len(m_code_2)} characters")
                
                table_found = True
                break
    
    if table_found:
        break

wb.close()

if not table_found:
    print("Table1 not found")

