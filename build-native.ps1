$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$native = Join-Path $root "native"
$project = Join-Path $native "NeonScope.csproj"
$dist = Join-Path $root "dist"
$cache = Join-Path $root ".build-cache"

$env:TEMP = Join-Path $cache "temp"
$env:TMP = $env:TEMP
$env:DOTNET_CLI_HOME = Join-Path $cache "dotnet-home"
$env:NUGET_PACKAGES = Join-Path $cache "nuget-packages"
$env:NUGET_HTTP_CACHE_PATH = Join-Path $cache "nuget-http"
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = "1"
$env:DOTNET_NOLOGO = "1"

New-Item -ItemType Directory -Force $env:TEMP, $env:DOTNET_CLI_HOME, $env:NUGET_PACKAGES, $env:NUGET_HTTP_CACHE_PATH | Out-Null

if (Test-Path $dist) {
    Get-ChildItem $dist -Force | Remove-Item -Recurse -Force
} else {
    New-Item -ItemType Directory -Force $dist | Out-Null
}

Write-Host "Publishing NEON//SCOPE (single-file, win-x64)..." -ForegroundColor Magenta

dotnet publish $project `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -o $dist

Get-ChildItem $dist -Filter "*.xml" -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem $dist -Directory -Filter "NEONScopeData" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

Copy-Item (Join-Path $root "EXE使用说明.txt") (Join-Path $dist "使用说明.txt") -Force
Copy-Item (Join-Path $root "LICENSE") $dist -Force
Copy-Item (Join-Path $root "NOTICE") $dist -Force
# Ship editable demo assets beside the EXE; the native server overlays these on
# the embedded fallback so the ZIP remains a complete portable package.
$assetDist = Join-Path $dist "assets"
New-Item -ItemType Directory -Force $assetDist | Out-Null
Copy-Item (Join-Path $root "assets\*") $assetDist -Force

$zip = Join-Path $root "NEON-SCOPE-win64.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $dist "*") -DestinationPath $zip -CompressionLevel Optimal
Write-Host ""
Write-Host "Done:" -ForegroundColor Green
Write-Host "  EXE: $dist\NEON-SCOPE.exe"
Write-Host "  ZIP: $zip"
