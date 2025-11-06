# Build script for PowerQueryNet ConsoleWrapper
# This requires the Power Query SDK DLLs to be extracted first

Write-Host "Building PowerQueryNet ConsoleWrapper..." -ForegroundColor Cyan

$solutionPath = "PowerQueryNet\PowerQueryNet.sln"
$projectPath = "PowerQueryNet\ConsoleWrapper\ConsoleWrapper.csproj"

# Find MSBuild
$msbuildPaths = @(
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe",
    "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\MSBuild.exe",
    "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe",
    "${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\MSBuild.exe",
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2019\Professional\MSBuild\Current\Bin\MSBuild.exe",
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\MSBuild.exe",
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2019\Enterprise\MSBuild\Current\Bin\MSBuild.exe",
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2017\Professional\MSBuild\15.0\Bin\MSBuild.exe",
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2017\Community\MSBuild\15.0\Bin\MSBuild.exe",
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2017\Enterprise\MSBuild\15.0\Bin\MSBuild.exe",
    "${env:ProgramFiles(x86)}\MSBuild\14.0\Bin\MSBuild.exe"
)

$msbuild = $null
foreach ($path in $msbuildPaths) {
    if (Test-Path $path) {
        $msbuild = $path
        break
    }
}

if (-not $msbuild) {
    Write-Host "ERROR: MSBuild not found. Please install Visual Studio or .NET Framework SDK." -ForegroundColor Red
    Write-Host "Alternatively, open PowerQueryNet.sln in Visual Studio and build the ConsoleWrapper project." -ForegroundColor Yellow
    exit 1
}

Write-Host "Found MSBuild at: $msbuild" -ForegroundColor Green

# Check if DLLs exist
$libPath = "PowerQueryNet\Engine\lib"
$requiredDlls = @(
    "Microsoft.Data.Mashup.dll",
    "Microsoft.Mashup.Tools.dll",
    "Microsoft.MashupEngine.dll",
    "Microsoft.Mashup.OAuth.dll"
)

$missingDlls = @()
foreach ($dll in $requiredDlls) {
    $dllPath = Join-Path $libPath $dll
    if (-not (Test-Path $dllPath)) {
        $missingDlls += $dll
    }
}

if ($missingDlls.Count -gt 0) {
    Write-Host "ERROR: Missing required DLLs:" -ForegroundColor Red
    foreach ($dll in $missingDlls) {
        Write-Host "  - $dll" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Please download PowerQuerySdk.vsix 1.0.0.16 from:" -ForegroundColor Yellow
    Write-Host "  http://dakahn.gallery.vsassets.io/_apis/public/gallery/publisher/dakahn/extension/powerquerysdk/1.0.0.16/assetbyname/PowerQuerySdk.vsix" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Then:" -ForegroundColor Yellow
    Write-Host "  1. Rename .vsix to .zip" -ForegroundColor Yellow
    Write-Host "  2. Extract the Dependencies folder" -ForegroundColor Yellow
    Write-Host "  3. Copy the DLLs to $libPath" -ForegroundColor Yellow
    exit 1
}

Write-Host "All required DLLs found." -ForegroundColor Green

# Build the project (build the solution with specific project target)
Write-Host ""
Write-Host "Building ConsoleWrapper project..." -ForegroundColor Cyan
& $msbuild $solutionPath /p:Configuration=Release /p:Platform="Any CPU" /t:ConsoleWrapper /v:minimal

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Build successful!" -ForegroundColor Green
    $exePath = "PowerQueryNet\ConsoleWrapper\bin\Release\PowerQueryNet.ConsoleWrapper.exe"
    if (Test-Path $exePath) {
        Write-Host "Executable created at: $exePath" -ForegroundColor Green
    }
} else {
    Write-Host ""
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

