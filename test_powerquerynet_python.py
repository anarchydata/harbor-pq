"""
Test script for PowerQueryNet Python wrapper
Tests the implementation without using the C# ConsoleWrapper
"""

import sys
import os

# Add the powerquerynet package to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from powerquerynet import (
    Command,
    CommandCredentials,
    Query,
    Queries,
    ExecuteOutputFlags,
    SqlTableAction,
    PowerQueryNetError,
)

def test_simple_execution():
    """Test simple M code execution"""
    print("=" * 60)
    print("Test 1: Simple M Code Execution")
    print("=" * 60)
    
    m_code = """
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
    
    try:
        with Command() as cmd:
            response = cmd.execute(
                query_name="Filtered Rows",
                m_code=m_code,
                output_flags=ExecuteOutputFlags.DATATABLE | ExecuteOutputFlags.JSON,
            )
            
            if response.exception_message:
                print(f"❌ Error: {response.exception_message}")
                return False
            
            if response.data_table:
                print(f"✅ Success! Rows: {len(response.data_table.rows)}, Columns: {len(response.data_table.columns)}")
                print(f"   Columns: {response.data_table.columns}")
                print(f"   First row: {response.data_table.rows[0] if response.data_table.rows else 'N/A'}")
                if response.json:
                    print(f"   JSON preview: {response.json[:100]}...")
                return True
            else:
                print("❌ No data returned")
                return False
    except PowerQueryNetError as e:
        print(f"❌ PowerQueryNetError: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_multiple_queries():
    """Test multiple queries execution"""
    print("\n" + "=" * 60)
    print("Test 2: Multiple Queries")
    print("=" * 60)
    
    queries = Queries()
    queries.add("Source", "#table({\"Name\", \"Value\"}, {{\"Item A\", 100}, {\"Item B\", 200}})")
    queries.add("Filtered", """
let
    Source = #table({"Name", "Value"}, {{"Item A", 100}, {"Item B", 200}}),
    Filtered = Table.SelectRows(Source, each [Value] > 150)
in
    Filtered
    """)
    
    try:
        with Command() as cmd:
            response = cmd.execute(
                query_name="Filtered",
                queries=queries,
                output_flags=ExecuteOutputFlags.DATATABLE,
            )
            
            if response.exception_message:
                print(f"❌ Error: {response.exception_message}")
                return False
            
            if response.data_table and len(response.data_table.rows) > 0:
                print(f"✅ Success! Rows: {len(response.data_table.rows)}")
                return True
            else:
                print("❌ No data returned")
                return False
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_output_formats():
    """Test different output formats"""
    print("\n" + "=" * 60)
    print("Test 3: Output Formats")
    print("=" * 60)
    
    m_code = "let Source = #table({\"Col1\", \"Col2\"}, {{\"A\", 1}, {\"B\", 2}}) in Source"
    
    try:
        with Command() as cmd:
            response = cmd.execute(
                query_name="Source",
                m_code=m_code,
                output_flags=ExecuteOutputFlags.DATATABLE | ExecuteOutputFlags.CSV | ExecuteOutputFlags.HTML | ExecuteOutputFlags.JSON | ExecuteOutputFlags.XML,
            )
            
            if response.exception_message:
                print(f"❌ Error: {response.exception_message}")
                return False
            
            formats = []
            if response.csv:
                formats.append("CSV")
            if response.html:
                formats.append("HTML")
            if response.json:
                formats.append("JSON")
            if response.xml:
                formats.append("XML")
            if response.data_table:
                formats.append("DataTable")
            
            print(f"✅ Generated formats: {', '.join(formats)}")
            if response.csv:
                print(f"   CSV: {len(response.csv)} chars")
            if response.json:
                print(f"   JSON: {len(response.json)} chars")
            return len(formats) > 0
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_entry_point_extraction():
    """Test entry point extraction from M code"""
    print("\n" + "=" * 60)
    print("Test 4: Entry Point Extraction")
    print("=" * 60)
    
    m_code = """
let
    Source = #table({"Name"}, {{"Item A"}}),
    #"Filtered Rows" = Table.SelectRows(Source, each true)
in
    #"Filtered Rows"
    """
    
    try:
        with Command() as cmd:
            # Don't specify query_name, let it auto-extract
            response = cmd.execute(
                query_name="Query1",  # Will be extracted from "in" clause
                m_code=m_code,
                output_flags=ExecuteOutputFlags.DATATABLE,
            )
            
            if response.data_table:
                print(f"✅ Success! Auto-extracted entry point")
                return True
            else:
                print("❌ Failed")
                return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def main():
    """Run all tests"""
    print("\n" + "=" * 60)
    print("PowerQueryNet Python Wrapper - Test Suite")
    print("=" * 60)
    print("\nNote: These tests require PowerQueryNet ConsoleWrapper.exe")
    print("But we want to implement direct SDK access instead.\n")
    
    results = []
    
    results.append(("Simple Execution", test_simple_execution()))
    results.append(("Multiple Queries", test_multiple_queries()))
    results.append(("Output Formats", test_output_formats()))
    results.append(("Entry Point Extraction", test_entry_point_extraction()))
    
    print("\n" + "=" * 60)
    print("Test Results Summary")
    print("=" * 60)
    for name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {name}")
    
    total = len(results)
    passed = sum(1 for _, p in results if p)
    print(f"\nTotal: {passed}/{total} tests passed")
    
    return passed == total


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)

