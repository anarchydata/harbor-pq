// Test to verify mashup format works correctly
// This bypasses file reading and tests the format directly

using System;
using System.Text;

class TestMashupFormat
{
    static void Main()
    {
        // Test 1: Simple value
        string test1 = "section Section1;\n\rshared hw = \"Hello World\";\n\r";
        Console.WriteLine("Test 1 - Simple value:");
        Console.WriteLine(test1);
        Console.WriteLine();
        
        // Test 2: Let expression
        string test2 = "section Section1;\n\rshared hw = let hw = \"Hello World\" in hw;\n\r";
        Console.WriteLine("Test 2 - Let expression:");
        Console.WriteLine(test2);
        Console.WriteLine();
        
        // Test 3: Query with spaces
        string test3 = "section Section1;\n\rshared #\"Hello World\" = \"Hello World\";\n\r";
        Console.WriteLine("Test 3 - Query with spaces:");
        Console.WriteLine(test3);
        Console.WriteLine();
        
        // Test 4: Multiple queries
        string test4 = "section Section1;\n\rshared Query1 = 1;\n\rshared Query2 = 2;\n\r";
        Console.WriteLine("Test 4 - Multiple queries:");
        Console.WriteLine(test4);
        Console.WriteLine();
        
        // Test 5: CRLF line endings
        string test5 = "section Section1;\r\nshared hw = \"Hello World\";\r\n";
        Console.WriteLine("Test 5 - CRLF line endings:");
        Console.WriteLine(test5);
        Console.WriteLine();
        
        // Show byte representation
        Console.WriteLine("Byte representation of Test 1:");
        byte[] bytes = Encoding.UTF8.GetBytes(test1);
        foreach (byte b in bytes)
        {
            Console.Write($"{b:X2} ");
        }
        Console.WriteLine();
    }
}

