# Test script to verify mashup format according to MS-QDEFF spec
# Based on MS-QDEFF: Query Definition File Format specification

Write-Host "Testing Mashup Format for M Code Execution" -ForegroundColor Cyan
Write-Host "=" -NoNewline; Write-Host ("=" * 60)

# According to MS-QDEFF and PowerQueryNet implementation:
# Format: section Section1;\n\rshared QueryName = Formula;\n\r

$testMCode = 'let hw = "Hello World" in hw'
$queryName = "hw"

# Format 1: Current PowerQueryNet format
$mashup1 = "section Section1;`n`r"
$formattedQueryName = if ($queryName.Contains(" ")) { "#`"$queryName`"" } else { $queryName }
$mashup1 += "shared $formattedQueryName = $testMCode;`n`r"

Write-Host "`nFormat 1 (Current PowerQueryNet format):" -ForegroundColor Yellow
Write-Host $mashup1 -ForegroundColor Gray

# Format 2: Alternative section name
$mashup2 = "section Default;`n`r"
$mashup2 += "shared $formattedQueryName = $testMCode;`n`r"

Write-Host "`nFormat 2 (Default section):" -ForegroundColor Yellow
Write-Host $mashup2 -ForegroundColor Gray

# Format 3: Multiple line endings (CRLF vs LF)
$mashup3 = "section Section1;`r`n"
$mashup3 += "shared $formattedQueryName = $testMCode;`r`n"

Write-Host "`nFormat 3 (CRLF line endings):" -ForegroundColor Yellow
Write-Host $mashup3 -ForegroundColor Gray

# Format 4: Minimal format (no section)
$mashup4 = "shared $formattedQueryName = $testMCode;`n`r"

Write-Host "`nFormat 4 (No section):" -ForegroundColor Yellow
Write-Host $mashup4 -ForegroundColor Gray

# Create test file with Format 1
$testFile = "test-mashup-format.pq"
$mashup1 | Out-File -FilePath $testFile -Encoding UTF8 -NoNewline

Write-Host "`nCreated test file: $testFile" -ForegroundColor Green
Write-Host "File contents:" -ForegroundColor Cyan
Get-Content $testFile -Raw | Write-Host -ForegroundColor White

# Test with ConsoleWrapper
Write-Host "`nTesting with ConsoleWrapper..." -ForegroundColor Cyan
$exePath = "PowerQueryNet\ConsoleWrapper\bin\Release\PowerQueryNet.ConsoleWrapper.exe"
if (Test-Path $exePath) {
    Write-Host "Executing: $exePath $testFile $queryName json" -ForegroundColor Yellow
    $result = & $exePath $testFile $queryName json 2>&1
    Write-Host "Result:" -ForegroundColor Cyan
    $result | Write-Host
} else {
    Write-Host "ConsoleWrapper.exe not found at: $exePath" -ForegroundColor Red
}

Write-Host "`n" + ("=" * 61)
Write-Host "Test Complete" -ForegroundColor Green








