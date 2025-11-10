# Permission and Security Analysis for PowerQueryNet ConsoleWrapper

## Summary

The diagnostics script revealed several important findings about why the Power Query SDK is failing to create the container process.

## Key Findings

### 1. Container Executable Location ✓
- **Status**: Found and accessible
- **Location**: `C:\Program Files\Microsoft Power BI Desktop\bin\Microsoft.Mashup.Container.NetFX45.exe`
- **Size**: 25,632 bytes
- **Permissions**: Read and Execute for Users group

### 2. Process Creation Permissions ✓
- **Status**: OK
- Basic process creation works (tested with PowerShell)
- The container executable can be launched (though it crashes without proper arguments)

### 3. Container Directory Write Permissions ✗
- **Status**: NOT WRITABLE
- **Issue**: The Power BI installation directory is protected and cannot be written to by standard users
- **Impact**: The SDK might need to create temporary files or logs in this directory, which could cause failures

### 4. Container Executable Crashes
- **Status**: Crashes when run manually
- **Error**: `System.NullReferenceException` in `Microsoft.Mashup.Container.EvaluationContainerMain`
- **Exit Code**: -1073741819 (0xC0000005 - Access Violation)
- **Event Log**: Windows Event Log shows crash entries for the container executable
- **Analysis**: The container needs specific arguments and environment setup that the SDK normally provides

### 5. Administrator Privileges
- **Status**: Running as standard user
- **Recommendation**: Try running as Administrator to test if elevated privileges help

### 6. Windows Defender
- **Status**: Project path not in exclusions
- **Recommendation**: Consider adding project directory to Windows Defender exclusions

### 7. SDK DLL Version
- **Status**: SDK DLLs from January 2018
- **Files**: `Microsoft.Data.Mashup.dll`, `Microsoft.MashupEngine.dll`, etc. (dated 1/22/2018)
- **Potential Issue**: Version mismatch between SDK DLLs (2018) and Power BI Desktop container (2025)

## Error Details

The current error is:
```
Inner Exception: Cannot create process.
Exception Type: Microsoft.Data.Mashup.InternalMashupException
```

This error occurs when the SDK tries to spawn the container process, but the container process fails to start or crashes immediately.

## Possible Root Causes

1. **Version Mismatch**: The SDK DLLs (2018) might be incompatible with the Power BI Desktop container executable (2025)
2. **Missing Dependencies**: The container executable might need additional DLLs or configuration files that aren't present
3. **Security Restrictions**: Windows Defender or other security software might be blocking the process creation
4. **Write Permissions**: The SDK might need to write to the container directory, which is protected
5. **Environment Variables**: The container might need specific environment variables that aren't set

## Recommendations

### Immediate Actions

1. **Test as Administrator**
   ```powershell
   # Run PowerShell as Administrator and test again
   cd c:\Projects\harbor-pq
   node test-simple-mcode.js
   ```

2. **Add Windows Defender Exclusion**
   ```powershell
   # Run as Administrator
   Add-MpPreference -ExclusionPath "C:\Projects\harbor-pq"
   ```

3. **Check Event Log for Details**
   ```powershell
   Get-WinEvent -FilterHashtable @{LogName='Application'; Level=2,3} | 
     Where-Object { $_.Message -like "*Mashup*" -or $_.Message -like "*Container*" } |
     Select-Object -First 10 TimeCreated, Message | Format-List
   ```

### Long-term Solutions

1. **SDK Version Compatibility**: Verify if the SDK DLLs need to match the Power BI Desktop version
2. **Container Dependencies**: Ensure all required DLLs and dependencies are accessible
3. **Alternative Container Location**: Copy container executable and dependencies to a writable location
4. **Process Isolation**: Investigate if the SDK needs specific process isolation settings

## Testing Script

Run the diagnostics script to check current status:
```powershell
powershell -ExecutionPolicy Bypass -File test-permissions.ps1
```

## Next Steps

1. Test with Administrator privileges
2. Check if copying all container dependencies to a writable location helps
3. Investigate SDK version compatibility with Power BI Desktop
4. Review Windows Event Log for additional error details
5. Consider using a different approach if SDK version mismatch is confirmed










