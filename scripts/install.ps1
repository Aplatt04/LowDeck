# Installs (or updates) Lowdeck for this Windows user.
# Copies this folder to %LOCALAPPDATA%\Programs\Lowdeck and adds a Start menu
# shortcut. Run it again any time to update the installed copy. Your settings
# and logins live in %APPDATA%\lowdeck and are not touched.

$ErrorActionPreference = 'Stop'
$src  = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dest = Join-Path $env:LOCALAPPDATA 'Programs\Lowdeck'
$exe  = Join-Path $dest 'node_modules\electron\dist\electron.exe'

Write-Host ''
Write-Host "  Lowdeck installer" -ForegroundColor Cyan
Write-Host "  From: $src"
Write-Host "  To:   $dest"
Write-Host ''

if ($src.TrimEnd('\') -ieq $dest.TrimEnd('\')) { Write-Host 'This is already the installed copy.' -ForegroundColor Yellow; exit 1 }

# Make sure dependencies are present in the source folder
if (-not (Test-Path (Join-Path $src 'node_modules\electron\dist\electron.exe'))) {
    Write-Host 'Installing dependencies (npm install)...'
    Push-Location $src
    try { npm install } finally { Pop-Location }
    if (-not (Test-Path (Join-Path $src 'node_modules\electron\dist\electron.exe'))) { throw 'npm install did not install Electron. Is Node.js installed?' }
}

# Close the installed copy if it's running, so its files can be replaced
$running = @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dest, [StringComparison]::OrdinalIgnoreCase) })
if ($running.Count) {
    Write-Host 'Closing the installed Lowdeck...'
    $running | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# Copy everything except personal / working files
Write-Host 'Copying files...'
robocopy $src $dest /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP `
    /XD (Join-Path $src 'logs') (Join-Path $src 'versions') (Join-Path $src '.git') `
    /XF '.dev' 'discord-token.json' '*.bak-*' | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy exit code $LASTEXITCODE)" }

# Start menu shortcut
$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Lowdeck.lnk'
$sh = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sh.TargetPath       = $exe
$sh.Arguments        = "`"$dest`""
$sh.WorkingDirectory = $dest
$sh.Description      = 'Lowdeck touchscreen dashboard'
$sh.IconLocation     = "$exe,0"
$sh.Save()

$version = (Get-Content (Join-Path $dest 'package.json') -Raw | ConvertFrom-Json).version
Write-Host ''
Write-Host "  Lowdeck $version is installed." -ForegroundColor Green
Write-Host '  Start menu: Lowdeck'
Write-Host '  To start it when you sign in, turn on Settings > General > Start with Windows in this copy.'
Write-Host ''

Start-Process -FilePath $exe -ArgumentList "`"$dest`"" -WorkingDirectory $dest
