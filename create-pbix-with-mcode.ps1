# Create a minimal .pbix file with M code using MS-QDEFF format
# Based on Ben Gribaudo's blog: https://bengribaudo.com/blog/2020/04/22/5198/data-mashup-binary-stream

Write-Host "Creating Minimal .pbix File with M Code" -ForegroundColor Cyan
Write-Host "============================================================="

# Test M code
$mCode = 'let hw = "Hello World" in hw'
$queryName = "hw"

# Step 1: Create Package Parts (OPC zip)
$tempDir = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }
$packageDir = Join-Path $tempDir "PackageParts"
$configDir = Join-Path $packageDir "Config"
$formulasDir = Join-Path $packageDir "Formulas"

New-Item -ItemType Directory -Path $configDir -Force | Out-Null
New-Item -ItemType Directory -Path $formulasDir -Force | Out-Null

Write-Host "`n1. Creating Package Parts..." -ForegroundColor Yellow

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
$sectionM = @"
section Section1;
shared $queryName = $mCode;
"@
$sectionM | Out-File -FilePath (Join-Path $formulasDir "Section1.m") -Encoding UTF8

Write-Host "  Created Package.xml and Section1.m" -ForegroundColor Green

# Create Package Parts zip
Add-Type -AssemblyName System.IO.Compression.FileSystem
$packageZip = Join-Path $tempDir "PackageParts.zip"
[System.IO.Compression.ZipFile]::CreateFromDirectory($packageDir, $packageZip)

Write-Host "  Created Package Parts zip ($((Get-Item $packageZip).Length) bytes)" -ForegroundColor Green

# Step 2: Create minimal Metadata XML
Write-Host "`n2. Creating Metadata..." -ForegroundColor Yellow
$metadataXml = @"
<?xml version="1.0" encoding="utf-8"?>
<AllFormulas xmlns="http://schemas.microsoft.com/DataMashup">
  <Formulas>
    <Formula Name="Section1/$queryName">
      <FormulaExpression>Section1/$queryName</FormulaExpression>
    </Formula>
  </Formulas>
</AllFormulas>
"@
$metadataFile = Join-Path $tempDir "Metadata.xml"
$metadataXml | Out-File -FilePath $metadataFile -Encoding UTF8
Write-Host "  Created Metadata.xml" -ForegroundColor Green

# Step 3: Create Permissions XML
Write-Host "`n3. Creating Permissions..." -ForegroundColor Yellow
$permissionsXml = @"
<?xml version="1.0" encoding="utf-8"?>
<Permissions xmlns="http://schemas.microsoft.com/DataMashup">
  <CanEvaluateFuturePackages>false</CanEvaluateFuturePackages>
  <FirewallEnabled>false</FirewallEnabled>
  <WorkbookGroupType xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" />
</Permissions>
"@
$permissionsFile = Join-Path $tempDir "Permissions.xml"
$permissionsXml | Out-File -FilePath $permissionsFile -Encoding UTF8
Write-Host "  Created Permissions.xml" -ForegroundColor Green

# Step 4: Create minimal Permission Bindings (can be empty for testing)
Write-Host "`n4. Creating Permission Bindings..." -ForegroundColor Yellow
$permissionBindingsFile = Join-Path $tempDir "PermissionBindings"
[System.IO.File]::WriteAllBytes($permissionBindingsFile, @())
Write-Host "  Created empty Permission Bindings" -ForegroundColor Green

# Step 5: Create Metadata Content (empty legacy component)
Write-Host "`n5. Creating Metadata Content..." -ForegroundColor Yellow
$metadataContentDir = Join-Path $tempDir "MetadataContent"
New-Item -ItemType Directory -Path $metadataContentDir -Force | Out-Null
$metadataContentZip = Join-Path $tempDir "MetadataContent.zip"
# Create empty zip
$emptyZipBytes = [System.IO.Compression.ZipFile]::CreateFromDirectory($metadataContentDir, $metadataContentZip)
Write-Host "  Created empty Metadata Content zip" -ForegroundColor Green

# Step 6: Create the DataMashup binary stream
# According to MS-QDEFF, we need to combine all 5 components in a specific binary format
Write-Host "`n6. Creating DataMashup binary stream..." -ForegroundColor Yellow
Write-Host "  Note: This requires implementing the full MS-QDEFF binary format" -ForegroundColor Gray
Write-Host "  For now, we'll create a minimal structure" -ForegroundColor Gray

# Step 7: Create a minimal .pbix file (OPC zip)
Write-Host "`n7. Creating minimal .pbix file structure..." -ForegroundColor Yellow

$pbixDir = Join-Path $tempDir "pbix"
New-Item -ItemType Directory -Path $pbixDir -Force | Out-Null

# Create [Content_Types].xml
$contentTypesXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml" />
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Override PartName="/DataMashup" ContentType="application/vnd.ms-powerquery.package" />
</Types>
"@
$contentTypesXml | Out-File -FilePath (Join-Path $pbixDir "[Content_Types].xml") -Encoding UTF8

# Copy DataMashup binary (for now, use Package Parts as placeholder)
# In a real implementation, we'd need to properly format the MS-QDEFF binary stream
Copy-Item $packageZip (Join-Path $pbixDir "DataMashup") -Force

$outputPbix = "test-query.pbix"
$pbixZip = Join-Path (Get-Location) $outputPbix
if (Test-Path $pbixZip) { Remove-Item $pbixZip -Force }

[System.IO.Compression.ZipFile]::CreateFromDirectory($pbixDir, $pbixZip)

Write-Host "  Created $outputPbix ($((Get-Item $pbixZip).Length) bytes)" -ForegroundColor Green

Write-Host "`n============================================================="
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  Created minimal .pbix file: $outputPbix" -ForegroundColor Green
Write-Host "  M code: $mCode" -ForegroundColor Gray
Write-Host "  Query name: $queryName" -ForegroundColor Gray
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "  1. Implement full MS-QDEFF binary format for DataMashup" -ForegroundColor Yellow
Write-Host "  2. Try to execute with container executable" -ForegroundColor Yellow
Write-Host "  3. Or use Power BI Desktop to open and test" -ForegroundColor Yellow
Write-Host "`nTemp directory: $tempDir" -ForegroundColor Gray



