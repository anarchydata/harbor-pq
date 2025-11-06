# Test script to check permissions and security restrictions
Write-Host "============================================================="
Write-Host "PERMISSION AND SECURITY DIAGNOSTICS"
Write-Host "============================================================="

# 1. Check if container executable exists and permissions
Write-Host "`n1. Checking container executable..."
$containerExe = "C:\Program Files\Microsoft Power BI Desktop\bin\Microsoft.Mashup.Container.NetFX45.exe"
if (Test-Path $containerExe) {
    Write-Host "   [OK] Found: $containerExe"
    $fileInfo = Get-Item $containerExe
    Write-Host "   File size: $($fileInfo.Length) bytes"
    Write-Host "   Last modified: $($fileInfo.LastWriteTime)"
    
    # Check ACL
    $acl = Get-Acl $containerExe
    Write-Host "`n   Permissions:"
    $acl.Access | Where-Object { $_.IdentityReference -like "*$env:USERNAME*" -or $_.IdentityReference -like "*Users*" } | ForEach-Object {
        Write-Host "     $($_.IdentityReference): $($_.FileSystemRights)"
    }
} else {
    Write-Host "   [FAIL] Not found: $containerExe"
}

# 2. Try to manually run the container executable (it should fail with usage error, not permission error)
Write-Host "`n2. Testing manual execution of container executable..."
if (Test-Path $containerExe) {
    try {
        $process = Start-Process -FilePath $containerExe -ArgumentList "--help" -NoNewWindow -PassThru -Wait -ErrorAction Stop
        Write-Host "   [OK] Process creation succeeded (exit code: $($process.ExitCode))"
        Write-Host "   This indicates permissions are OK"
    } catch {
        Write-Host "   [FAIL] Process creation failed: $($_.Exception.Message)"
        Write-Host "   This suggests permission/security issues"
    }
}

# 3. Check ConsoleWrapper executable permissions
Write-Host "`n3. Checking ConsoleWrapper executable..."
$consoleWrapper = "PowerQueryNet\ConsoleWrapper\bin\Release\PowerQueryNet.ConsoleWrapper.exe"
if (Test-Path $consoleWrapper) {
    Write-Host "   [OK] Found: $consoleWrapper"
    $fileInfo = Get-Item $consoleWrapper
    $acl = Get-Acl $consoleWrapper
    Write-Host "   File size: $($fileInfo.Length) bytes"
    Write-Host "   Permissions:"
    $acl.Access | Where-Object { $_.IdentityReference -like "*$env:USERNAME*" -or $_.IdentityReference -like "*Users*" } | ForEach-Object {
        Write-Host "     $($_.IdentityReference): $($_.FileSystemRights)"
    }
} else {
    Write-Host "   [FAIL] Not found: $consoleWrapper"
}

# 4. Check if running as administrator
Write-Host "`n4. Checking execution context..."
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    Write-Host "   [OK] Running as Administrator"
} else {
    Write-Host "   [WARN] Running as standard user (not Administrator)"
    Write-Host "   Suggestion: Try running PowerShell as Administrator and test again"
}

# 5. Check Windows Defender / Antivirus exclusions
Write-Host "`n5. Checking Windows Defender exclusions..."
try {
    $exclusions = Get-MpPreference | Select-Object -ExpandProperty ExclusionPath -ErrorAction SilentlyContinue
    $projectPath = (Resolve-Path ".").Path
    $isExcluded = $exclusions -contains $projectPath
    if ($isExcluded) {
        Write-Host "   [OK] Project path is in Windows Defender exclusions"
    } else {
        Write-Host "   [WARN] Project path NOT in exclusions"
        Write-Host "   Suggestion: Add exclusion for: $projectPath"
    }
} catch {
    Write-Host "   [WARN] Could not check Windows Defender (may not be running or requires admin)"
}

# 6. Check process creation permissions
Write-Host "`n6. Testing process creation capability..."
try {
    $testProcess = Start-Process -FilePath "powershell.exe" -ArgumentList "-Command Write-Host 'Test'" -NoNewWindow -PassThru -Wait -ErrorAction Stop
    Write-Host "   [OK] Process creation test succeeded"
} catch {
    Write-Host "   [FAIL] Process creation test failed: $($_.Exception.Message)"
}

# 7. Check if container directory is writable (for SDK temp files)
Write-Host "`n7. Checking container directory write permissions..."
$containerDir = "C:\Program Files\Microsoft Power BI Desktop\bin"
if (Test-Path $containerDir) {
    try {
        $testFile = Join-Path $containerDir "test-write-permission.tmp"
        "test" | Out-File -FilePath $testFile -ErrorAction Stop
        Remove-Item $testFile -ErrorAction SilentlyContinue
        Write-Host "   [OK] Directory is writable"
    } catch {
        Write-Host "   [WARN] Directory is NOT writable: $($_.Exception.Message)"
        Write-Host "   Note: This might cause issues if SDK needs to create temp files"
    }
}

# 8. Check for event log errors related to process creation
Write-Host "`n8. Checking recent Windows Event Log for process creation errors..."
try {
    $startTime = (Get-Date).AddMinutes(-5)
    $events = Get-WinEvent -FilterHashtable @{LogName='Application','System'; Level=2,3; StartTime=$startTime} -ErrorAction SilentlyContinue | 
        Where-Object { $_.Message -like "*process*" -or $_.Message -like "*container*" -or $_.Message -like "*Mashup*" } |
        Select-Object -First 5
    if ($events) {
        Write-Host "   [WARN] Found recent events:"
        $events | ForEach-Object {
            $msgPreview = if ($_.Message.Length -gt 100) { $_.Message.Substring(0, 100) + "..." } else { $_.Message }
            Write-Host "     [$($_.TimeCreated)] $($_.LevelDisplayName): $msgPreview"
        }
    } else {
        Write-Host "   [OK] No recent process-related errors found"
    }
} catch {
    Write-Host "   [WARN] Could not check event log: $($_.Exception.Message)"
}

# 9. Test actual SDK call with enhanced error capture
Write-Host "`n9. Testing SDK process creation with detailed error capture..."
$testFile = Join-Path $env:TEMP "test-pq-simple.pq"
"let hw = `"Hello World`" in hw" | Out-File -FilePath $testFile -Encoding utf8
try {
    $result = & "PowerQueryNet\ConsoleWrapper\bin\Release\PowerQueryNet.ConsoleWrapper.exe" $testFile "hw" "json" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   [OK] SDK execution succeeded!"
        Write-Host "   Output: $result"
    } else {
        Write-Host "   [FAIL] SDK execution failed (exit code: $LASTEXITCODE)"
        Write-Host "   Error output:"
        $result | ForEach-Object { Write-Host "     $_" }
    }
} catch {
    Write-Host "   [FAIL] Exception during SDK execution: $($_.Exception.Message)"
} finally {
    if (Test-Path $testFile) { Remove-Item $testFile -ErrorAction SilentlyContinue }
}

Write-Host "`n============================================================="
Write-Host "DIAGNOSTICS COMPLETE"
Write-Host "============================================================="
