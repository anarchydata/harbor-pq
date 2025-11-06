# Building PowerQueryNet ConsoleWrapper

The ConsoleWrapper project has been added to the solution file and is ready to build.

## Option B: Build in Visual Studio (Recommended)

### Prerequisites
1. **Visual Studio** (2017, 2019, 2022 - Community, Professional, or Enterprise)
2. **.NET Framework 4.5.1** or later
3. **Power Query SDK DLLs** (already extracted in `PowerQueryNet/Engine/lib/`)

### Steps

1. **Open the Solution**
   - Launch Visual Studio
   - File → Open → Project/Solution
   - Navigate to: `PowerQueryNet\PowerQueryNet.sln`
   - Click Open

2. **Set Build Configuration**
   - In the Solution Configuration dropdown (top toolbar), select **Release**
   - In the Solution Platform dropdown, select **Any CPU**

3. **Restore NuGet Packages** (if needed)
   - Right-click on the solution in Solution Explorer
   - Select "Restore NuGet Packages"
   - Wait for packages to restore

4. **Build the ConsoleWrapper Project**
   - Right-click on `ConsoleWrapper` project in Solution Explorer
   - Select **Build**
   - Or press `Ctrl+Shift+B` to build the entire solution

5. **Verify Build Output**
   - The executable should be created at:
     ```
     PowerQueryNet\ConsoleWrapper\bin\Release\PowerQueryNet.ConsoleWrapper.exe
     ```

6. **Run the Test**
   - After building, run: `node test-mcode.js`
   - The test should now find and execute the ConsoleWrapper.exe

### Troubleshooting

**Missing DLLs Error:**
- Ensure the Power Query SDK DLLs are in `PowerQueryNet\Engine\lib\`
- Required DLLs:
  - Microsoft.Data.Mashup.dll
  - Microsoft.Mashup.Tools.dll
  - Microsoft.MashupEngine.dll
  - Microsoft.Mashup.OAuth.dll

**Build Errors:**
- Check that all project references are resolved
- Ensure .NET Framework 4.5.1 is installed
- Verify all NuGet packages are restored

**Still Can't Find MSBuild?**
- Try opening "Developer Command Prompt for VS" or "Developer PowerShell for VS"
- These have MSBuild in the PATH
- Then run: `msbuild PowerQueryNet\ConsoleWrapper\ConsoleWrapper.csproj /p:Configuration=Release`

