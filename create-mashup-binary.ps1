# Create a proper MS-QDEFF formatted data mashup binary stream
# Based on Ben Gribaudo's blog: https://bengribaudo.com/blog/2020/04/22/5198/data-mashup-binary-stream

Write-Host "Creating MS-QDEFF Data Mashup Binary Stream" -ForegroundColor Cyan
Write-Host "=" -NoNewline; Write-Host ("=" * 60)

# Test M code
$mCode = 'let hw = "Hello World" in hw'
$queryName = "hw"

# According to MS-QDEFF and Ben's blog:
# The data mashup binary stream contains 5 components:
# 1. Package Parts (OPC zip file) - Contains /Formulas/Section1.m with the actual M code
# 2. Metadata (XML)
# 3. Metadata Content (OPC zip file - legacy)
# 4. Permissions (XML)
# 5. Permission Bindings (binary)

# The simplest approach: Create a minimal valid MS-QDEFF structure
# Package Parts contains:
#   /Config/Package.xml - Client version info
#   /Formulas/Section1.m - The actual M code

$tempDir = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }
$packageDir = Join-Path $tempDir "PackageParts"
$configDir = Join-Path $packageDir "Config"
$formulasDir = Join-Path $packageDir "Formulas"
$contentDir = Join-Path $packageDir "Content"

New-Item -ItemType Directory -Path $configDir -Force | Out-Null
New-Item -ItemType Directory -Path $formulasDir -Force | Out-Null

Write-Host "`nCreating Package Parts structure..." -ForegroundColor Yellow

# Create Package.xml
$packageXml = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/DataMashup">
  <ClientVersion>2.0</ClientVersion>
  <MinServerVersion>1.0</MinServerVersion>
  <Culture>en-US</Culture>
</Package>
"@

$packageXml | Out-File -FilePath (Join-Path $configDir "Package.xml") -Encoding UTF8

# Create Section1.m with the M code
# Format: section Section1; shared QueryName = Formula;
$sectionM = @"
section Section1;
shared $queryName = $mCode;
"@

$sectionM | Out-File -FilePath (Join-Path $formulasDir "Section1.m") -Encoding UTF8

Write-Host "  Created Package.xml" -ForegroundColor Green
Write-Host "  Created Section1.m" -ForegroundColor Green
Write-Host "  Section1.m content:" -ForegroundColor Cyan
Get-Content (Join-Path $formulasDir "Section1.m") | Write-Host

# Create OPC zip file (Package Parts)
$packageZip = Join-Path $tempDir "PackageParts.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($packageDir, $packageZip)

Write-Host "`nCreated Package Parts zip: $packageZip" -ForegroundColor Green
Write-Host "Size: $((Get-Item $packageZip).Length) bytes" -ForegroundColor Gray

# Now we need to create the full MS-QDEFF binary stream
# This would require implementing the full format with:
# - Package Parts (zip we just created)
# - Metadata (XML)
# - Permissions (XML)  
# - Permission Bindings (binary)

Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "  1. Package Parts created ✓" -ForegroundColor Green
Write-Host "  2. Need to create Metadata XML" -ForegroundColor Yellow
Write-Host "  3. Need to create Permissions XML" -ForegroundColor Yellow
Write-Host "  4. Need to create Permission Bindings (binary)" -ForegroundColor Yellow
Write-Host "  5. Need to combine all 5 components into MS-QDEFF binary stream" -ForegroundColor Yellow
Write-Host "  6. Can then use this in a .pbix or .xlsx file, or execute directly" -ForegroundColor Yellow

Write-Host "`nPackage Parts structure:" -ForegroundColor Cyan
Get-ChildItem $packageDir -Recurse | ForEach-Object {
    $relativePath = $_.FullName.Substring($packageDir.Length + 1)
    Write-Host "  $relativePath" -ForegroundColor Gray
}

Write-Host "`nTemp directory: $tempDir" -ForegroundColor Gray
Write-Host "=" -NoNewline; Write-Host ("=" * 60)

