#!/usr/bin/env python
"""Persistent script to execute DirectCommand via stdin/stdout"""
import sys
import json
import os
import importlib.util
from pathlib import Path

# Add paths
sys.path.insert(0, r'C:\\Projects\\harbor-pq')
sys.path.insert(0, r'C:\\Projects\\harbor-pq\\PowerQueryNet')

try:
    from PowerQueryNet.command_direct import DirectCommand
except ImportError as e:
    try:
        command_direct_path = Path(r'C:\\Projects\\harbor-pq\\PowerQueryNet') / "command_direct.py"
        spec = importlib.util.spec_from_file_location("command_direct", str(command_direct_path))
        if spec and spec.loader:
            command_direct = importlib.util.module_from_spec(spec)
            sys.path.insert(0, str(Path(r'C:\\Projects\\harbor-pq\\PowerQueryNet').parent))
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
            import sys
            error_msg = str(e) + "\n" + traceback.format_exc()
            # Log error to stderr so it appears in log panel
            print(f"ERROR: {error_msg}", file=sys.stderr, flush=True)
            error_result = {
                "id": request_id,
                "success": False,
                "error": error_msg
            }
            print(json.dumps(error_result), flush=True)
    except json.JSONDecodeError as e:
        import sys
        error_msg = f"Invalid JSON: {e}"
        print(f"ERROR: {error_msg}", file=sys.stderr, flush=True)
        error_result = {
            "id": None,
            "success": False,
            "error": error_msg
        }
        print(json.dumps(error_result), flush=True)
    except Exception as e:
        import traceback
        import sys
        error_msg = str(e) + "\n" + traceback.format_exc()
        print(f"ERROR: {error_msg}", file=sys.stderr, flush=True)
        error_result = {
            "id": None,
            "success": False,
            "error": error_msg
        }
        print(json.dumps(error_result), flush=True)
