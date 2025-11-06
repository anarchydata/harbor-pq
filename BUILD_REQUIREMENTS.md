# Build Requirements for ConsoleWrapper

## Current Status
✅ MSBuild found: `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe`
✅ Required DLLs copied to `PowerQueryNet\Engine\lib\`
❌ .NET Framework 4.5.1 Developer Pack not installed

## Missing Requirement

The ConsoleWrapper project requires **.NET Framework 4.5.1 Developer Pack** (Targeting Pack).

### Option 1: Install via Visual Studio Installer (Recommended)
1. Open Visual Studio Installer
2. Click "Modify" on your Visual Studio installation
3. Go to "Individual Components" tab
4. Search for ".NET Framework 4.5.1"
5. Check "**.NET Framework 4.5.1 SDK**" or "**.NET Framework 4.5.1 Targeting Pack**"
6. Click "Modify" to install

### Option 2: Download and Install Standalone
Download from: https://dotnet.microsoft.com/download/dotnet-framework/net451
- Look for "Developer Pack" or "Targeting Pack"
- Download and install

### Option 3: Use Visual Studio GUI
1. Open Visual Studio
2. Open `PowerQueryNet\PowerQueryNet.sln`
3. Visual Studio will prompt to install the missing targeting pack
4. Click "Install" when prompted

## After Installation

Once the .NET Framework 4.5.1 Developer Pack is installed, run:
```powershell
.\build-console-wrapper.ps1
```

The build should complete successfully and create:
`PowerQueryNet\ConsoleWrapper\bin\Release\PowerQueryNet.ConsoleWrapper.exe`

## Test After Build

Run the test:
```powershell
node test-mcode.js
```






