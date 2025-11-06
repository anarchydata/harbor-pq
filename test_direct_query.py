"""
Test direct SDK implementation with sample M code queries
"""

import sys
import os
from pathlib import Path

# Add current directory to path
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

def test_sample_queries():
    """Test with various sample M code queries"""
    print("=" * 70)
    print("Testing Direct SDK Implementation with Sample Queries")
    print("=" * 70)
    print("\nNOTE: Calling Microsoft Power Query DLLs directly via Python.NET")
    print("      No C# wrapper code used\n")
    
    try:
        # Import DirectCommand
        try:
            from powerquerynet.command_direct import DirectCommand
        except ImportError:
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                "command_direct",
                str(current_dir / "powerquerynet" / "command_direct.py")
            )
            command_direct = importlib.util.module_from_spec(spec)
            sys.path.insert(0, str(current_dir / "powerquerynet"))
            spec.loader.exec_module(command_direct)
            DirectCommand = command_direct.DirectCommand
        
        # Test 1: Simple table
        print("\n" + "=" * 70)
        print("Test 1: Simple Table Query")
        print("=" * 70)
        m_code1 = """
let
    Source = #table(
        {"Name", "Value", "Category"},
        {
            {"Item A", 100, "Type1"},
            {"Item B", 200, "Type2"},
            {"Item C", 150, "Type1"},
            {"Item D", 300, "Type2"}
        }
    )
in
    Source
        """
        
        print("\nExecuting simple table query...")
        with DirectCommand() as cmd:
            response = cmd.execute(query_name="Source", m_code=m_code1)
            
            if response.data_table:
                print(f"SUCCESS! Got {len(response.data_table.rows)} rows, {len(response.data_table.columns)} columns")
                print(f"Columns: {response.data_table.columns}")
                print(f"\nFirst 3 rows:")
                for i, row in enumerate(response.data_table.rows[:3]):
                    print(f"  Row {i+1}: {row}")
                if response.json:
                    print(f"\nJSON preview (first 200 chars):\n{response.json[:200]}...")
            else:
                print("ERROR: No data returned")
                if response.exception_message:
                    print(f"Exception: {response.exception_message}")
                return False
        
        # Small delay to allow SDK resources to fully release
        import time
        time.sleep(0.5)
        
        # Test 2: Filtered query
        print("\n" + "=" * 70)
        print("Test 2: Filtered Query")
        print("=" * 70)
        m_code2 = """
let
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
    #"Filtered Rows"
        """
        
        print("\nExecuting filtered query...")
        with DirectCommand() as cmd:
            response = cmd.execute(query_name="Filtered Rows", m_code=m_code2)
            
            if response.data_table:
                print(f"SUCCESS! Got {len(response.data_table.rows)} rows after filtering")
                print(f"Expected: 2 rows (Item B=200, Item D=300)")
                print(f"Actual rows:")
                for i, row in enumerate(response.data_table.rows):
                    print(f"  Row {i+1}: {row}")
                
                if len(response.data_table.rows) == 2:
                    print("PASS: Correct number of filtered rows")
                else:
                    print(f"WARNING: Expected 2 rows, got {len(response.data_table.rows)}")
            else:
                print("ERROR: No data returned")
                return False
        
        # Small delay to allow SDK resources to fully release
        time.sleep(0.5)
        
        # Test 3: Simple calculation
        print("\n" + "=" * 70)
        print("Test 3: Simple Calculation")
        print("=" * 70)
        m_code3 = """
let
    x = 10,
    y = 20,
    Result = x + y
in
    Result
        """
        
        print("\nExecuting simple calculation...")
        with DirectCommand() as cmd:
            response = cmd.execute(query_name="Result", m_code=m_code3)
            
            if response.data_table:
                print(f"SUCCESS! Got result")
                print(f"Data: {response.data_table.rows}")
                # Simple expressions return a single value
                if response.data_table.rows:
                    print(f"Result value: {response.data_table.rows[0][0]}")
                    print(f"Expected: 30")
            else:
                print("ERROR: No data returned")
                return False
        
        print("\n" + "=" * 70)
        print("ALL TESTS COMPLETED")
        print("=" * 70)
        return True
        
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = test_sample_queries()
    sys.exit(0 if success else 1)

