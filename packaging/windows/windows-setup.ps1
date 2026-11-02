#Requires -Version 5.1
# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-11-02: pass only the RSA element to the .NET Framework XML key parser.
# Created in the personal fork on 2026-11-01: per-user Windows orchestration with authenticated AppImage bootstrap.
param([ValidateSet('discover','install','update','uninstall','launch','prerequisites','account')][string]$Action = 'discover',
      [string]$Distro = '', [string]$LinuxUser = '', [string]$Version = 'latest', [string]$CancelFile = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$requested = @{ Action=$Action; Distro=$Distro; LinuxUser=$LinuxUser; Version=$Version; CancelFile=$CancelFile }
. (Join-Path $PSScriptRoot 'install-release.ps1')
$Action=$requested.Action; $Distro=$requested.Distro; $LinuxUser=$requested.LinuxUser; $Version=$requested.Version; $CancelFile=$requested.CancelFile
$store = Join-Path $env:LOCALAPPDATA 'ASE Studio'
$stateFile = Join-Path $store 'installation.json'
if ($LinuxUser -and $LinuxUser -notmatch '^[a-z_][a-z0-9_-]*$') { throw 'Invalid Linux username.' }
function Save-State($Value) {
    New-Item -ItemType Directory -Force -Path $store | Out-Null
    $temporary = Join-Path $store ([Guid]::NewGuid().ToString('N') + '.json')
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $stateFile -Force
}
function Read-State {
    if (-not (Test-Path -LiteralPath $stateFile)) { throw 'No Windows-managed installation. Install or repair first.' }
    $value = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
    if ($value.Owner -ne 'ASE Studio Windows v1') { throw 'Unrecognized installation state.' }
    return $value
}
function Install-WindowsFiles {
    New-Item -ItemType Directory -Force -Path $store | Out-Null
    $exe = Join-Path $store 'ASEStudioSetup.exe'
    foreach ($file in @('ASEStudioSetup.exe','windows-setup.ps1','install-release.ps1','release-public.xml','LICENSE')) {
        $source = Join-Path $PSScriptRoot $file
        $destination = Join-Path $store $file
        if ([IO.Path]::GetFullPath($source) -ne [IO.Path]::GetFullPath($destination)) {
            if (Test-Path -LiteralPath $destination) {
                if (-not (Test-Path -LiteralPath $stateFile) -and -not (Test-Path -LiteralPath (Join-Path $store 'pending.json'))) { throw 'Unmanaged Windows installation directory.' }
            }
            if ((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $source).Hash -eq (Get-FileHash -LiteralPath $destination).Hash) { continue }
            Copy-Item -LiteralPath $source -Destination $destination -Force
        }
    }
}
function Register-Studio {
    Install-WindowsFiles
    $exe = Join-Path $store 'ASEStudioSetup.exe'
    $shell = New-Object -ComObject WScript.Shell
    $shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'ASE Studio.lnk'
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ((Test-Path -LiteralPath $shortcutPath) -and $shortcut.TargetPath -ne $exe) { throw 'An unmanaged Start shortcut already exists.' }
    $shortcut.TargetPath = $exe; $shortcut.IconLocation = $exe + ',0'; $shortcut.Arguments = '--launch'; $shortcut.WorkingDirectory = $store; $shortcut.Save()
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASEStudio'
    if (Test-Path $key) {
        $existing = Get-ItemProperty $key
        if ($existing.UninstallString -ne ('"' + $exe + '" --uninstall')) { throw 'An unmanaged Windows application registration already exists.' }
    }
    New-Item $key -Force | Out-Null
    New-ItemProperty $key DisplayName -Value 'ASE Studio' -Force | Out-Null
    New-ItemProperty $key UninstallString -Value ('"' + $exe + '" --uninstall') -Force | Out-Null
    New-ItemProperty $key ModifyPath -Value ('"' + $exe + '" --repair') -Force | Out-Null
}
if (Test-Path -LiteralPath $stateFile) { Read-State | Out-Null }
if ($Action -in @('install','prerequisites') -and (Test-Path -LiteralPath $store) -and
    -not (Test-Path -LiteralPath $stateFile) -and -not (Test-Path -LiteralPath (Join-Path $store 'pending.json')) -and
    @(Get-ChildItem -LiteralPath $store -Force).Count) { throw 'The installation folder contains unmanaged files. Choose recovery before proceeding.' }
trap [OperationCanceledException] { Write-Output 'Operation cancelled before installation.'; exit 2 }
Get-WindowsHost | Out-Null
if ($Action -eq 'prerequisites') {
    Install-WindowsFiles
    [IO.File]::WriteAllText((Join-Path $store 'pending.json'), '{"phase":"prerequisites","distro":"Ubuntu-24.04"}')
    $runOnce = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
    New-Item $runOnce -Force | Out-Null
    New-ItemProperty $runOnce ASEStudioResume -Value ('"' + (Join-Path $store 'ASEStudioSetup.exe') + '" --resume') -Force | Out-Null
    $process = Start-Process -FilePath (Join-Path $store 'ASEStudioSetup.exe') -ArgumentList '--enable-prerequisites' -Verb RunAs -Wait -PassThru
    if ($process.ExitCode -notin @(0,3010)) { throw 'Prerequisites require attention. Restart if requested and reopen this installer to resume.' }
    if ($process.ExitCode -eq 3010) {
        Write-Output 'Windows requires a restart. Restart when ready, then choose Prepare WSL again to finish. This installer will reopen at sign-in.'
        exit
    }
    # Register the distro under the invoking user, never under alternate UAC credentials.
    $names = @((Wsl-Output --list --quiet) -split "`r?`n" | ForEach-Object { $_.Trim() })
    if ('Ubuntu-24.04' -cnotin $names) { Wsl --install --distribution Ubuntu-24.04 --no-launch }
    Write-Output 'WSL prerequisites prepared. Complete the Ubuntu account and check distributions again.'
    exit
}
try { $wslExecutable = Get-WslExecutable } catch { if ($Action -ne 'uninstall') { throw }; $wslExecutable = $null }
if ($Action -eq 'account') {
    $packages = @(Get-AppxPackage '*Ubuntu24.04*')
    if ($packages.Count -ne 1) { throw 'Open Ubuntu-24.04 from Start and complete account creation.' }
    $manifest = $packages[0] | Get-AppxPackageManifest
    $appId = @($manifest.Package.Applications.Application)[0].Id
    Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\' + $packages[0].PackageFamilyName + '!' + $appId)
    exit
}
if ($Action -eq 'discover') {
    @(Get-StudioDistributions -LinuxUser $LinuxUser) | ConvertTo-Json -Depth 4 -Compress
    exit
}
if ($Action -in @('launch','update','uninstall')) {
    $saved = Read-State
    $Distro = $saved.Distro; $LinuxUser = $saved.LinuxUser
}
if (-not $Distro) { $Distro = Select-StudioDistribution @(Get-StudioDistributions -LinuxUser $LinuxUser) '' -NonInteractive }
if (-not $Distro) { throw 'No compatible distribution. Use Prepare WSL or configure an existing distribution.' }
if ($Action -eq 'install' -and (Test-Path -LiteralPath $stateFile)) {
    $previous = Read-State
    if ($previous.Distro -cne $Distro) {
        $registered = @((Wsl-Output --list --quiet) -split "`r?`n" | ForEach-Object { $_.Trim() })
        if ($previous.Distro -cin $registered) { throw "Studio is already associated with $($previous.Distro). Select that distribution; moving user data between distributions is not automatic." }
        Write-Output 'Recovering the Windows association. The previous distribution is absent; its data cannot be copied automatically.'
    }
}
$selection = @('-d', $Distro)
if ($LinuxUser) { $selection += @('-u', $LinuxUser) }
if ($Action -eq 'launch') { Wsl @selection --exec sh -c 'exec ~/.local/bin/ase-studio'; exit }
if ($Action -eq 'uninstall') {
    # Local installed code only: works without GitHub and does not require WSLg.
    $names = if ($wslExecutable) { (Wsl-Output --list --quiet) -split "`r?`n" } else { @() }
    if ($Distro -cin @($names | ForEach-Object { $_.Trim() })) {
        Wsl @selection --exec sh -c 'exec ~/.local/opt/ase-studio/current/AppRun --installer uninstall'
    } else { Write-Output 'The recorded distribution is absent; removing Windows registration only.' }
    $shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'ASE Studio.lnk'
    if (Test-Path -LiteralPath $shortcutPath) {
        $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
        if ($shortcut.TargetPath -eq (Join-Path $store 'ASEStudioSetup.exe')) { Remove-Item -LiteralPath $shortcutPath }
    }
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASEStudio'
    if (Test-Path $key) {
        if ((Get-ItemProperty $key).UninstallString -eq ('"' + (Join-Path $store 'ASEStudioSetup.exe') + '" --uninstall')) { Remove-Item $key -Recurse }
    }
    Remove-Item -LiteralPath $stateFile
    Write-Output 'Studio removed. Projects, preferences, WSL and the distribution were preserved.'
    exit
}
Select-StudioDistribution @(Get-StudioDistributions -LinuxUser $LinuxUser) $Distro -NonInteractive | Out-Null
$LinuxUser = Wsl-Output @selection --exec id -un
$selection = @('-d', $Distro, '-u', $LinuxUser)
$work = Join-Path ([IO.Path]::GetTempPath()) ('ase-windows-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $work | Out-Null
try {
    if ($Version -ne 'latest' -and $Version -cnotmatch '^v\d+\.\d+\.\d+-[a-z]+\.[1-9][0-9]*$') { throw 'Invalid release version.' }
    $suffix = if ($Version -eq 'latest') { 'latest' } else { 'tags/' + $Version }
    Download "https://api.github.com/repos/nunzioricci2000/ase-studio/releases/$suffix" (Join-Path $work 'release.json')
    $release = Get-Content -Raw (Join-Path $work 'release.json') | ConvertFrom-Json
    if ($release.draft -or $release.prerelease -or ($Version -ne 'latest' -and $Version -ne $release.tag_name)) { throw 'A matching stable release is required.' }
    $tag = $release.tag_name
    if ($tag -cnotmatch '^v\d+\.\d+\.\d+-[a-z]+\.[1-9][0-9]*$') { throw 'Invalid published release tag.' }
    $base = "https://github.com/nunzioricci2000/ase-studio/releases/download/$tag/"
    foreach ($name in @('targets.json','targets.json.sig')) { Download ($base + $name) (Join-Path $work $name) }
    $rsa = [Security.Cryptography.RSACryptoServiceProvider]::new()
    try {
        $rsa.PersistKeyInCsp = $false
        $keyDocument = [xml][IO.File]::ReadAllText((Join-Path $PSScriptRoot 'release-public.xml'))
        $rsa.FromXmlString($keyDocument.DocumentElement.OuterXml)
        if (-not $rsa.VerifyData([IO.File]::ReadAllBytes((Join-Path $work 'targets.json')), 'SHA256', [IO.File]::ReadAllBytes((Join-Path $work 'targets.json.sig')))) { throw 'Release signature verification failed.' }
    } finally { $rsa.Dispose() }
    $index = Get-Content -Raw (Join-Path $work 'targets.json') | ConvertFrom-Json
    if (Test-Path -LiteralPath $stateFile) {
        $previous = Read-State
        if ($previous.PSObject.Properties.Name -contains 'Sequence' -and $index.release_sequence -lt $previous.Sequence) { throw 'An older release index was rejected.' }
    }
    if ($index.schema_version -ne 3 -or $index.version -ne $tag) { throw 'Release index mismatch.' }
    $targets = @($index.targets | Where-Object { $_.id -ceq 'linux-appimage-x86_64' })
    if ($targets.Count -ne 1) { throw 'This release does not yet publish a verified managed AppImage. Existing installations were preserved.' }
    $record = $targets[0].runtime
    if ($record.name -cne 'ase-studio-nunzio-linux-appimage-x86_64.AppImage') { throw 'Unexpected AppImage filename.' }
    $image = Join-Path $work $record.name
    Download ($base + $record.name) $image
    if ((Get-Item -LiteralPath $image).Length -ne $record.bytes -or (Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash.ToLowerInvariant() -cne $record.sha256) { throw 'AppImage integrity verification failed.' }
    $linuxImage = Wsl-Output @selection --exec wslpath -u ($image.Replace('\','/'))
    Wsl @selection --exec chmod u+x $linuxImage
    # Repair also restores a missing current link; ownership checks remain in the
    # shared install command and prevent taking over unrelated files.
    $linuxAction = if ($Action -eq 'update') { 'install' } else { $Action }
    $options = @('--appimage-extract-and-run','--installer',$linuxAction,'--appimage','--local-appimage',$linuxImage,'--version',$tag)
    if ($Version -eq 'latest') { $options += '--resolved-latest' }
    if ($CancelFile -and (Test-Path -LiteralPath $CancelFile)) { throw [OperationCanceledException]::new('Installation cancelled.') }
    Write-Output 'ASE_PHASE:commit'
    Wsl @selection --exec $linuxImage @options
    Save-State @{ Owner='ASE Studio Windows v1'; Distro=$Distro; LinuxUser=$LinuxUser; Version=$tag; Sequence=$index.release_sequence; Phase='installed' }
    Register-Studio
    Remove-Item -LiteralPath (Join-Path $store 'pending.json') -ErrorAction SilentlyContinue
    Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' ASEStudioResume -ErrorAction SilentlyContinue
    Write-Output 'Installation complete. Open ASE Studio from Start.'
} finally { Remove-Item -LiteralPath $work -Recurse -Force }
