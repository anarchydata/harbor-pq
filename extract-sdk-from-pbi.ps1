# Script to extract SDK DLLs from Power BI Desktop installation
# This attempts to use newer SDK DLLs that match the Power BI Desktop version

Write-Host "=" -NoNewline; Write-Host ("=" * 60)
Write-Host "EXTRACTING SDK DLLs FROM POWER BI DESKTOP"
Write-Host ("=" * 61)

$pbiBin = "C:\Program Files\Microsoft Power BI Desktop\bin"
$targetLib = "PowerQueryNet\Engine\lib"
$backupLib = "PowerQueryNet\Engine\lib_backup_old"

# Check if Power BI Desktop is installed
if (-not (Test-Path $pbiBin)) {
    Write-Host "ERROR: Power BI Desktop not found at: $pbiBin" -ForegroundColor Red
    Write-Host "Please install Power BI Desktop first." -ForegroundColor Yellow
    exit 1
}

Write-Host "`nPower BI Desktop found at: $pbiBin" -ForegroundColor Green

# List of SDK DLLs we need
$requiredDlls = @(
    "Microsoft.Data.Mashup.dll",
    "Microsoft.Data.Mashup.Preview.dll",
    "Microsoft.Data.Mashup.ProviderCommon.dll",
    "Microsoft.MashupEngine.dll",
    "Microsoft.Mashup.Tools.dll",
    "Microsoft.Mashup.OAuth.dll",
    "Microsoft.Mashup.EventSource.dll",
    "Microsoft.Mashup.ScriptDom.dll",
    "Microsoft.Mashup.Shims.dll"
)

# Check which DLLs exist in Power BI Desktop
Write-Host "`nChecking for SDK DLLs in Power BI Desktop..." -ForegroundColor Cyan
$foundDlls = @()
$missingDlls = @()

foreach ($dll in $requiredDlls) {
    $sourcePath = Join-Path $pbiBin $dll
    if (Test-Path $sourcePath) {
        $info = Get-Item $sourcePath
        Write-Host "  [OK] $dll ($($info.Length) bytes, $($info.LastWriteTime))" -ForegroundColor Green
        $foundDlls += @{Name=$dll; Path=$sourcePath; Info=$info}
    } else {
        Write-Host "  [MISSING] $dll" -ForegroundColor Yellow
        $missingDlls += $dll
    }
}

if ($foundDlls.Count -eq 0) {
    Write-Host "`nERROR: No SDK DLLs found in Power BI Desktop installation!" -ForegroundColor Red
    exit 1
}

# Create backup of old DLLs
Write-Host "`nCreating backup of old SDK DLLs..." -ForegroundColor Cyan
if (Test-Path $targetLib) {
    if (-not (Test-Path $backupLib)) {
        New-Item -ItemType Directory -Path $backupLib | Out-Null
        Write-Host "  Created backup directory: $backupLib" -ForegroundColor Green
    }
    
    foreach ($dll in $requiredDlls) {
        $oldDll = Join-Path $targetLib $dll
        if (Test-Path $oldDll) {
            $backupDll = Join-Path $backupLib $dll
            Copy-Item $oldDll $backupDll -Force
            Write-Host "  Backed up: $dll" -ForegroundColor Gray
        }
    }
}

# Copy newer DLLs from Power BI Desktop
Write-Host "`nCopying SDK DLLs from Power BI Desktop..." -ForegroundColor Cyan
$copiedCount = 0

foreach ($dllInfo in $foundDlls) {
    $sourcePath = $dllInfo.Path
    $targetPath = Join-Path $targetLib $dllInfo.Name
    
    try {
        Copy-Item $sourcePath $targetPath -Force
        $copiedCount++
        Write-Host "  [COPIED] $($dllInfo.Name)" -ForegroundColor Green
    } catch {
        Write-Host "  [ERROR] Failed to copy $($dllInfo.Name): $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Also copy XML documentation files if they exist
Write-Host "`nCopying XML documentation files..." -ForegroundColor Cyan
foreach ($dllInfo in $foundDlls) {
    $xmlName = $dllInfo.Name -replace '\.dll$', '.xml'
    $sourceXml = Join-Path $pbiBin $xmlName
    if (Test-Path $sourceXml) {
        $targetXml = Join-Path $targetLib $xmlName
        try {
            Copy-Item $sourceXml $targetXml -Force
            Write-Host "  [COPIED] $xmlName" -ForegroundColor Green
        } catch {
            Write-Host "  [SKIP] $xmlName (copy failed)" -ForegroundColor Yellow
        }
    }
}

# Check for container executable
$containerExe = "Microsoft.Mashup.Container.NetFX45.exe"
$sourceContainer = Join-Path $pbiBin $containerExe
if (Test-Path $sourceContainer) {
    Write-Host "`nFound container executable: $containerExe" -ForegroundColor Cyan
    $info = Get-Item $sourceContainer
    Write-Host "  Size: $($info.Length) bytes" -ForegroundColor Gray
    Write-Host "  Modified: $($info.LastWriteTime)" -ForegroundColor Gray
}

Write-Host "`n" + ("=" * 61)
Write-Host "EXTRACTION COMPLETE" -ForegroundColor Green
Write-Host ("=" * 61)
Write-Host "`nCopied $copiedCount DLLs from Power BI Desktop" -ForegroundColor Green

if ($missingDlls.Count -gt 0) {
    Write-Host "`nWARNING: Some DLLs were not found in Power BI Desktop:" -ForegroundColor Yellow
    foreach ($dll in $missingDlls) {
        Write-Host "  - $dll" -ForegroundColor Yellow
    }
    Write-Host "`nThese may not be needed, or they may be in a different location." -ForegroundColor Yellow
}

Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "  1. Rebuild the ConsoleWrapper: .\build-console-wrapper.ps1" -ForegroundColor White
Write-Host "  2. Test with: node test-simple-mcode.js" -ForegroundColor White
Write-Host "`nIf you need to restore the old DLLs:" -ForegroundColor Gray
Write-Host "  Copy from: $backupLib" -ForegroundColor Gray
Write-Host "  To: $targetLib" -ForegroundColor Gray



