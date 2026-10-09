$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework C# compiler is required.' }
$outputDir = Join-Path $projectRoot 'native\bin'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
& $compiler /nologo /codepage:65001 /optimize+ /target:exe /platform:x64 /reference:System.Web.Extensions.dll "/out:$outputDir\HboReader.exe" (Join-Path $projectRoot 'native\HboReader.cs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item -LiteralPath (Join-Path $projectRoot 'native\profile.json') -Destination (Join-Path $outputDir 'profile.json') -Force
