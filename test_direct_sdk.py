"""
Test direct SDK access - no wrapper code, pure Python calling Microsoft DLLs
"""

import sys
import os
from pathlib import Path

# Add current directory to path so we can import powerquerynet
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

def test_direct_sdk():
    """Test direct SDK access"""
    print("=" * 60)
    print("Testing Direct SDK Access (Python.NET)")
    print("=" * 60)
    print("\nNOTE: This calls Microsoft DLLs directly, no C# wrapper code")
    print("=" * 60)
    
    try:
        # Try importing as module first
        try:
            from powerquerynet.command_direct import DirectCommand
        except ImportError:
            # Fallback: import directly with proper path setup
            import importlib.util
            import importlib
            
            # First, add the exceptions module
            exceptions_path = current_dir / "powerquerynet" / "exceptions.py"
            spec_ex = importlib.util.spec_from_file_location("exceptions", str(exceptions_path))
            exceptions = importlib.util.module_from_spec(spec_ex)
            spec_ex.loader.exec_module(exceptions)
            sys.modules['powerquerynet.exceptions'] = exceptions
            
            # Then import command_direct
            command_direct_path = current_dir / "powerquerynet" / "command_direct.py"
            spec = importlib.util.spec_from_file_location("command_direct", str(command_direct_path))
            command_direct = importlib.util.module_from_spec(spec)
            # Temporarily add exceptions to the module's namespace
            command_direct.exceptions = exceptions
            spec.loader.exec_module(command_direct)
            DirectCommand = command_direct.DirectCommand
        
        m_code = """
let
    Source = #table(
        {"Name", "Value"},
        {
            {"Item A", 100},
            {"Item B", 200}
        }
    )
in
    Source
        """
        
        print("\n1. Initializing DirectCommand...")
        with DirectCommand() as cmd:
            print("   DirectCommand initialized")
            
            print("\n2. Executing M code...")
            response = cmd.execute(
                query_name="Source",
                m_code=m_code,
            )
            
            if response.data_table:
                print(f"   SUCCESS! Rows: {len(response.data_table.rows)}")
                print(f"   Columns: {response.data_table.columns}")
                print(f"   First row: {response.data_table.rows[0]}")
                return True
            else:
                print("   ERROR: No data returned")
                return False
                
    except ImportError as e:
        print(f"ERROR: Import error: {e}")
        import traceback
        traceback.print_exc()
        print("\n   Install Python.NET: pip install pythonnet")
        return False
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = test_direct_sdk()
    sys.exit(0 if success else 1)

