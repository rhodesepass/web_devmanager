# ePass Windows libusb driver one-click installer
# Usage: powershell -ExecutionPolicy ByPass -c "irm https://epm.iccmc.cc/install_driver.ps1 | iex"
# Note: messages are in English on purpose — `irm | iex` may decode
# non-ASCII text with the wrong codepage on Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'

$zipUrl = 'https://epm.iccmc.cc/epass_driver.zip'
$dir = Join-Path $env:TEMP 'epass_driver_install'
$zip = Join-Path $dir 'epass_driver.zip'

if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
New-Item -ItemType Directory -Path $dir | Out-Null

Write-Host "[1/3] Downloading driver package..."
Invoke-WebRequest -Uri $zipUrl -OutFile $zip

Write-Host "[2/3] Extracting..."
Expand-Archive -Path $zip -DestinationPath $dir -Force

$bat = Get-ChildItem -Path $dir -Recurse -Filter 'drv_install.bat' | Select-Object -First 1
if (-not $bat) { throw 'drv_install.bat not found in the driver package' }

Write-Host "[3/3] Running installer as administrator, please click 'Yes' in the UAC prompt..."
Start-Process -FilePath $bat.FullName -WorkingDirectory $bat.DirectoryName -Verb RunAs -Wait

Write-Host 'Done. Re-plug the device and refresh the web page.'
