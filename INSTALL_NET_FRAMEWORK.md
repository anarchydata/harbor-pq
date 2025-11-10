# Installing .NET Framework 4.6.2 Developer Pack

To use the newer SDK DLLs from Power BI Desktop (which are compatible with the container executable), we need to upgrade the project to .NET Framework 4.6.2.

## Steps to Fix

### 1. Download and Install .NET Framework 4.6.2 Developer Pack

Download from: https://dotnet.microsoft.com/download/dotnet-framework/net462

Direct download link: https://go.microsoft.com/fwlink/?linkid=2088517

**Or search for**: ".NET Framework 4.6.2 Developer Pack"

### 2. Install the Developer Pack

- Run the installer (typically `NDP462-DevPack-KB3151934-ENU.exe`)
- Follow the installation wizard
- Restart your computer if prompted

### 3. Verify Installation

After installation, verify it's available:
```powershell
Test-Path "C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.6.2"
```

### 4. Rebuild the Project

After installing the Developer Pack:
```powershell
cd c:\Projects\harbor-pq
.\build-console-wrapper.ps1
```

### 5. Test

```powershell
node test-simple-mcode.js
```

## Why This is Needed

The newer SDK DLLs from Power BI Desktop (October 2025) require .NET Framework 4.6.2 or higher. The old SDK DLLs (from 2018) targeted .NET Framework 4.5.1, but they're incompatible with the newer Power BI Desktop container executable.

By upgrading to 4.6.2 and using the newer SDK DLLs, we ensure:
- ✅ SDK DLLs match the container executable version
- ✅ All dependencies are compatible
- ✅ Better compatibility with current Power BI Desktop

## Alternative: Use 4.7.2 or 4.8

If you prefer a newer version, you can also install:
- .NET Framework 4.7.2 Developer Pack: https://dotnet.microsoft.com/download/dotnet-framework/net472
- .NET Framework 4.8 Developer Pack: https://dotnet.microsoft.com/download/dotnet-framework/net48

Then update the projects to target `v4.7.2` or `v4.8` instead of `v4.6.2`.










