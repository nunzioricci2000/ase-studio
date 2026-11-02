#Requires -Version 7
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-11-02: exercise the final AppImage under real WSLg, Start registration and offline removal on a disposable Windows runner.
param([string]$Image, [string]$Installer, [string]$Output)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$env:WSL_UTF8='1'
$root=Split-Path $PSScriptRoot -Parent
$Image=(Resolve-Path $Image).Path
$Installer=(Resolve-Path $Installer).Path
New-Item -ItemType Directory -Force $Output | Out-Null
$Output=(Resolve-Path $Output).Path
$report=@{git_sha=$env:GITHUB_SHA;sha256=(Get-FileHash $Image -Algorithm SHA256).Hash.ToLowerInvariant();status='running';checks=@();notes=@('Windows Server 2025 hosted runner; Windows 10/11 OOBE and interactive UAC/reboot are not certified.')}
function Save-Report { $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $Output 'windows-appimage.json') }
function Wsl {
    $value=& wsl.exe @args
    if($LASTEXITCODE -ne 0) { throw "WSL failed ($LASTEXITCODE): $args" }
    return $value
}
function LinuxPath([string]$Path) { return (Wsl -d Ubuntu-24.04 -u root --exec wslpath -u $Path.Replace('\','/')).Trim() }
function Passed([string]$Name) { $report.checks+=@{name=$Name;status='succeeded';sha256=$report.sha256};Save-Report }
Save-Report
try {
    Wsl --set-default-version 2
    Wsl --install --distribution Ubuntu-24.04 --no-launch --web-download
    $kernel=Wsl -d Ubuntu-24.04 -u root --exec uname -r
    if($kernel -notmatch 'microsoft.*WSL2|microsoft-standard') { throw 'A real WSL2 kernel is required' }
    Wsl -d Ubuntu-24.04 -u root --exec test -S /mnt/wslg/.X11-unix/X0
    Wsl -d Ubuntu-24.04 -u root --exec /usr/sbin/useradd --create-home studio-check
    $linuxRoot=LinuxPath $root
    $linuxOutput=LinuxPath $Output
    $linuxImage=LinuxPath $Image
    Wsl -d Ubuntu-24.04 -u root --exec chmod a+x $linuxImage
    Wsl -d Ubuntu-24.04 -u studio-check --exec python3 "$linuxRoot/scripts/smoke-package.py" --appimage $linuxImage --output "$linuxOutput/backend"
    $backend=Get-Content -Raw (Join-Path $Output 'backend/runtime-report.json') | ConvertFrom-Json
    if($backend.status -ne 'succeeded' -or $backend.checks.Count -ne 8) { throw 'Final AppImage simulation checks failed' }
    Passed 'windows-appimage-simulations'
    # No Xvfb: native startup and update readiness must use the real WSLg display.
    Wsl -d Ubuntu-24.04 -u studio-check --exec python3 "$linuxRoot/tests/managed-appimage-integration.py" --appimage $linuxImage --report "$linuxOutput/managed.json" --keep-installed
    $managed=Get-Content -Raw (Join-Path $Output 'managed.json') | ConvertFrom-Json
    if($managed.status -ne 'succeeded') { throw 'Managed activation failed' }
    Passed 'install-final-appimage'
    Passed 'managed-update-window'
    Passed 'windows-wslg'

    # Load the actual production registration functions, without running its
    # release-download entrypoint before this candidate has been published.
    $errors=$null;$tokens=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $Installer 'windows-setup.ps1'),[ref]$tokens,[ref]$errors)
    if($errors.Count) { throw 'Cannot parse production installer' }
    $definitions=$ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)
    $helper=Join-Path $Installer 'registration-test-functions.ps1'
    [IO.File]::WriteAllText($helper,($definitions | ForEach-Object {$_.Extent.Text}) -join "`n")
    . $helper
    $store=Join-Path $env:LOCALAPPDATA 'ASE Studio'
    $stateFile=Join-Path $store 'installation.json'
    if(Test-Path $store) { throw 'Refusing a runner with an existing Studio installation' }
    Save-State @{Owner='ASE Studio Windows v1';Distro='Ubuntu-24.04';LinuxUser='studio-check';Phase='installed'}
    Register-Studio
    $shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'ASE Studio.lnk'
    $link=(New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
    if($link.TargetPath -ne (Join-Path $store 'ASEStudioSetup.exe') -or $link.Arguments -ne '--launch') { throw 'Start shortcut mismatch' }
    $registration=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASEStudio'
    if($registration.DisplayName -ne 'ASE Studio') { throw 'Application registration missing' }
    Start-Process $shortcut
    $deadline=(Get-Date).AddSeconds(90)
    do {
        $windows=@(Get-Process | Where-Object {$_.MainWindowTitle -like '*ASE Studio*' -and $_.MainWindowTitle -ne 'Installazione ASE Studio'})
        if($windows.Count) { break }
        Start-Sleep -Milliseconds 500
    } while((Get-Date) -lt $deadline)
    if(-not $windows.Count) { throw 'No application window appeared after opening the real Start shortcut' }
    $windows | Select-Object ProcessName,MainWindowTitle | ConvertTo-Json | Set-Content (Join-Path $Output 'start-windows.json')
    Passed 'windows-start-menu'
    # Close only this disposable account's application, then exercise the actual
    # offline uninstall entrypoint and verify both Windows and Linux cleanup.
    foreach($window in $windows) { $window.CloseMainWindow() | Out-Null }
    $deadline=(Get-Date).AddSeconds(30)
    do {
        $running=Get-Process ASEStudioSetup -ErrorAction SilentlyContinue
        if(-not $running) { break }
        Start-Sleep -Milliseconds 500
    } while((Get-Date) -lt $deadline)
    if($running) { throw 'The Start launcher did not exit after closing Studio' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Installer 'windows-setup.ps1') -Action uninstall
    if($LASTEXITCODE -ne 0) { throw 'Offline uninstall failed' }
    if((Test-Path $shortcut) -or (Test-Path $stateFile)) { throw 'Windows registration survived uninstall' }
    Wsl -d Ubuntu-24.04 -u studio-check --exec test -f /home/studio-check/.local/share/ase-studio-nunzio/keep-project.txt
    Wsl -d Ubuntu-24.04 -u studio-check --exec test ! -e /home/studio-check/.local/opt/ase-studio/current
    Passed 'windows-offline-uninstall'
    $report.status='succeeded'
} catch {
    $report.status='failed';$report.error=$_.ToString();throw
} finally { Save-Report }
