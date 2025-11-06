"""Check what types are available in the DLLs"""
import clr
import System
from System.Reflection import Assembly
from pathlib import Path

lib_path = Path("PowerQueryNet/Engine/lib")
engine_dll = lib_path / "Microsoft.MashupEngine.dll"
tools_dll = lib_path / "Microsoft.Mashup.Tools.dll"

print("Loading DLLs...")
clr.AddReference(str(engine_dll))
clr.AddReference(str(tools_dll))

print("\n=== Microsoft.MashupEngine.dll ===")
engine_assembly = Assembly.LoadFrom(str(engine_dll))
types = engine_assembly.GetTypes()
print(f"Total types: {len(types)}")
print("\nTypes containing 'QueryExecutor' or 'QueryExecution':")
for t in types:
    if 'QueryExecutor' in t.FullName or 'QueryExecution' in t.FullName:
        print(f"  {t.FullName}")

print("\n=== Microsoft.Mashup.Tools.dll ===")
tools_assembly = Assembly.LoadFrom(str(tools_dll))
types = tools_assembly.GetTypes()
print(f"Total types: {len(types)}")
print("\nTypes containing 'QueryExecutor' or 'QueryExecution':")
for t in types:
    if 'QueryExecutor' in t.FullName or 'QueryExecution' in t.FullName:
        print(f"  {t.FullName}")

print("\n=== All namespaces in MashupEngine ===")
namespaces = set()
engine_assembly = Assembly.LoadFrom(str(engine_dll))
for t in engine_assembly.GetTypes():
    if t.Namespace:
        namespaces.add(t.Namespace)
for ns in sorted(namespaces):
    print(f"  {ns}")

