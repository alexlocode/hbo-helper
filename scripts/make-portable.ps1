$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw 'Invalid version' }
$outputDir = Join-Path $projectRoot "dist\$version"
$sourcePath = Join-Path $outputDir 'win-unpacked'
$zipPath = Join-Path $outputDir "HBO Helper $version portable.zip"
$tempZip = Join-Path $outputDir ("portable-" + [guid]::NewGuid().ToString('N') + '.zip')
if (-not (Test-Path -LiteralPath (Join-Path $sourcePath 'resources\native\HboReader.exe'))) { throw 'Build the application first' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($tempZip,[IO.Compression.ZipArchiveMode]::Create)
try {
  $parent = Split-Path -Parent $sourcePath
  foreach ($file in Get-ChildItem -LiteralPath $sourcePath -Recurse -File -Force) {
    $entryName = $file.FullName.Substring($parent.Length + 1).Replace('\','/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file.FullName,$entryName,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($tempZip)
try {
  foreach ($name in @('win-unpacked/HBO Helper.exe','win-unpacked/resources/app.asar','win-unpacked/resources/native/HboReader.exe','win-unpacked/resources/native/profile.json')) {
    if ($null -eq $archive.GetEntry($name)) { throw "Missing archive entry: $name" }
  }
} finally { $archive.Dispose() }
Move-Item -LiteralPath $tempZip -Destination $zipPath -Force
Write-Output $zipPath
