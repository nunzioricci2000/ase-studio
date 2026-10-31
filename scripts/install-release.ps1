#Requires -Version 5.1
# Modified in the personal fork on 2026-10-31: preserve UTF-8 WSL output and restore the caller console/environment after native commands.
# Modified in the personal fork on 2026-10-31: use CIM host detection, native WSL paths and testable installation preflight for Windows PowerShell 5.1.
# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-10-31: accept Windows 10 build 19044+ with the same required WSL2/WSLg checks as Windows 11.
# Modified in the personal fork on 2026-10-30: resolve one exact release without accidentally pinning default Windows installs to manual updates.
# Created in the personal fork on 2026-10-30: install release packages on Windows 11 x86-64 through standard Ubuntu WSL2/WSLg.
param(
    [ValidateSet('install', 'update', 'uninstall')][string]$Action = 'install',
    [string]$Version = 'latest',
    [switch]$Yes,
    [string]$LinuxUser = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-WindowsHost([int]$Build, [int]$Architecture, [int]$AddressWidth) {
    # Win32_Processor uses 9 for x64 and 12 for ARM64; bitness alone is insufficient.
    if ($Build -lt 19044 -or $Architecture -ne 9 -or $AddressWidth -ne 64) {
        throw 'This installer requires Windows 10 build 19044 or newer, or Windows 11, on x86-64 with WSL2/WSLg. Windows ARM and native Windows builds are not supported.'
    }
}
function Get-WindowsHost {
    # Avoid RuntimeInformation type/assembly resolution and manifest-dependent OSVersion.
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
        $processors = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)
        if (-not $processors.Count -or [string]$os.BuildNumber -notmatch '^\d+$') { throw 'Missing host information.' }
        foreach ($cpu in $processors) {
            Assert-WindowsHost -Build $os.BuildNumber -Architecture $cpu.Architecture -AddressWidth $cpu.AddressWidth
        }
        return [pscustomobject]@{ Build = [int]$os.BuildNumber; Architecture = 'x86-64' }
    } catch {
        throw "Cannot validate the Windows host: $($_.Exception.Message) Use Windows PowerShell 5.1 or PowerShell 7 on Windows; verify Get-CimInstance Win32_OperatingSystem and Get-CimInstance Win32_Processor."
    }
}
function Get-WslExecutable {
    # A 32-bit PowerShell process sees SysWOW64 through System32; WSL is native-only.
    $folder = if ([Environment]::Is64BitProcess) { 'System32' } else { 'Sysnative' }
    $candidate = Join-Path $env:SystemRoot "$folder\wsl.exe"
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw 'WSL is unavailable. Open native 64-bit PowerShell as administrator and run: wsl --install --no-distribution . Restart if requested, then rerun this installer as your normal Windows user. See https://learn.microsoft.com/windows/wsl/install'
    }
    return $candidate
}
function Invoke-WslCommand([string[]]$Arguments, [switch]$Capture) {
    # Windows PowerShell can turn native stderr into terminating errors under Stop.
    # Preserve diagnostics and decide success from the native exit code instead.
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    $previousEncoding = [Console]::OutputEncoding
    $previousWslUtf8 = [Environment]::GetEnvironmentVariable('WSL_UTF8', 'Process')
    try {
        # Linux paths are UTF-8; Windows PowerShell otherwise decodes with the OEM code page.
        [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
        [Environment]::SetEnvironmentVariable('WSL_UTF8', '1', 'Process')
        if ($Capture) { $output = @(& $wslExecutable @Arguments 2>&1) }
        else { & $wslExecutable @Arguments }
        $code = $LASTEXITCODE
    } finally {
        [Console]::OutputEncoding = $previousEncoding
        [Environment]::SetEnvironmentVariable('WSL_UTF8', $previousWslUtf8, 'Process')
    }
    if ($code -ne 0) {
        $detail = if ($Capture) { ($output | ForEach-Object { "$_" }) -join "`n" } else { 'See the error above.' }
        throw "WSL command failed ($code). $detail`nReview wsl --status and wsl --list --verbose. If WSL is not enabled, run wsl --install --no-distribution in administrator PowerShell and restart if requested. For virtualization errors, check Virtual Machine Platform and firmware virtualization: https://learn.microsoft.com/windows/wsl/troubleshooting . Rerun the same installer command after resolving the error."
    }
    if ($Capture) { return (($output | ForEach-Object { "$_" }) -join "`n").Replace("`0", '').Trim() }
}
function Wsl { Invoke-WslCommand -Arguments $args }
function Wsl-Output { Invoke-WslCommand -Arguments $args -Capture }

# Follow HTTPS redirects explicitly; do not allow a redirect to cleartext HTTP.
function Download([string]$url, [string]$path) {
    Add-Type -AssemblyName System.Net.Http
    $previousTls = [Net.ServicePointManager]::SecurityProtocol
    [Net.ServicePointManager]::SecurityProtocol = $previousTls -bor [Net.SecurityProtocolType]::Tls12
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('ASE-Studio-installer')
    $client.Timeout = [TimeSpan]::FromMinutes(5)
    try {
        for ($i = 0; $i -lt 10; $i++) {
            if (([Uri]$url).Scheme -ne 'https') { throw 'Only HTTPS release downloads are permitted.' }
            $response = $client.GetAsync($url).GetAwaiter().GetResult()
            try {
                $status = [int]$response.StatusCode
                if ($status -in @(301, 302, 303, 307, 308)) {
                    $url = [Uri]::new([Uri]$url, $response.Headers.Location).AbsoluteUri
                    continue
                }
                $response.EnsureSuccessStatusCode() | Out-Null
                [IO.File]::WriteAllBytes($path, $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult())
                return
            } finally { $response.Dispose() }
        }
        throw 'Too many download redirects.'
    } finally { $client.Dispose(); $handler.Dispose(); [Net.ServicePointManager]::SecurityProtocol = $previousTls }
}

function Invoke-StudioInstaller {
    param([string]$Action, [string]$Version, [switch]$Yes, [string]$LinuxUser)
    $repository = 'nunzioricci2000/ase-studio'
    $distro = 'Ubuntu-24.04'
    $hostInfo = Get-WindowsHost
    Write-Host "Detected Windows build $($hostInfo.Build), $($hostInfo.Architecture); PowerShell $($PSVersionTable.PSVersion)."
    if ($Version -ne 'latest' -and $Version -cnotmatch '^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-(?!alpha\.|beta\.|rc\.)[a-z]+\.[1-9][0-9]*\z') { throw 'Use latest or a stable fork tag such as v1.6.2-abate.3.' }
    if ($LinuxUser -and $LinuxUser -notmatch '^[a-z_][a-z0-9_-]*$') { throw 'Invalid Linux username.' }
    $wslExecutable = Get-WslExecutable
    $names = (Wsl-Output --list --quiet) -split "`r?`n"
    if ($distro -notin @($names | ForEach-Object { $_.Trim() })) {
        if ($Action -ne 'install') { throw 'Ubuntu-24.04 is absent; there is no Studio installation to manage.' }
        Write-Host 'Required operation: wsl --install --distribution Ubuntu-24.04 --no-launch'
        if (-not $Yes -and (Read-Host 'Install Ubuntu-24.04? [y/N]') -notmatch '^(y|yes)$') { throw 'Ubuntu installation declined.' }
        Wsl --install --distribution $distro --no-launch
        Write-Host 'Open Ubuntu-24.04 from Start to complete first-run setup and create your normal Linux user. Restart Windows if WSL requested it, then rerun this command. If --install is unsupported or the download stalls, update WSL (wsl --update; wsl --update --web-download if Store access is unavailable) and see https://learn.microsoft.com/windows/wsl/install .'
        return
    }
    # Apply the explicit user to every distro command, including the first probe.
    $selection = @('-d', $distro)
    if ($LinuxUser) { $selection += @('-u', $LinuxUser) }
    $kernel = Wsl-Output @selection --exec uname -r
    if ($kernel -notmatch 'microsoft.*WSL2|microsoft-standard') {
        throw 'Ubuntu-24.04 must already use WSL2. No distribution was converted. Review wsl --list --verbose and explicitly migrate it with wsl --set-version Ubuntu-24.04 2 before retrying.'
    }
    $uid = Wsl-Output @selection --exec id -u
    if ($uid -notmatch '^[1-9][0-9]*$') {
        throw 'Complete Ubuntu first-run setup with a normal Linux user, then rerun with -LinuxUser USER. Studio is never launched as root.'
    }
    if ($Action -ne 'uninstall') {
        try {
            Wsl @selection --exec test -S /mnt/wslg/.X11-unix/X0
            $display = Wsl-Output @selection --exec printenv DISPLAY
            if (-not $display) { throw 'DISPLAY is empty.' }
        } catch {
            throw 'WSLg is unavailable in this user session. Update WSL from administrator PowerShell with wsl --update (or wsl --update --web-download if Store access is unavailable). Save work in all WSL sessions before wsl --shutdown, then retry from your Windows desktop. Check guiApplications in .wslconfig and DISPLAY overrides in Linux profiles. See https://learn.microsoft.com/windows/wsl/tutorials/gui-apps'
        }
    }

    $work = Join-Path ([IO.Path]::GetTempPath()) ('ase-release-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory $work | Out-Null
    try {
        $apiSuffix = if ($Version -eq 'latest') { 'latest' } else { 'tags/' + $Version }
        Download "https://api.github.com/repos/$repository/releases/$apiSuffix" (Join-Path $work 'release.json')
        $release = Get-Content -Raw -LiteralPath (Join-Path $work 'release.json') | ConvertFrom-Json
        $tag = $release.tag_name
        if ($release.draft -or $release.prerelease -or $tag -cnotmatch '^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-(?!alpha\.|beta\.|rc\.)[a-z]+\.[1-9][0-9]*\z' -or
            ($Version -ne 'latest' -and $tag -ne $Version)) { throw 'A matching published stable release is required.' }
        $base = "https://github.com/$repository/releases/download/$tag/"
        foreach ($name in @('install-release.sh', 'SHA256SUMS')) {
            $asset = @($release.assets | Where-Object { $_.name -ceq $name })
            if ($asset.Count -ne 1 -or $asset[0].browser_download_url -cne ($base + $name)) { throw "Incomplete release: $name" }
            $path = Join-Path $work $name
            Download ($base + $name) $path
            if ((Get-Item -LiteralPath $path).Length -ne $asset[0].size) { throw "Interrupted download: $name" }
        }
        $sums = @(Get-Content -LiteralPath (Join-Path $work 'SHA256SUMS') | Where-Object { $_ -cmatch '^[a-f0-9]{64}  install-release\.sh$' })
        $bashPath = Join-Path $work 'install-release.sh'
        if ($sums.Count -ne 1 -or (Get-FileHash -Algorithm SHA256 -LiteralPath $bashPath).Hash.ToLower() -cne $sums[0].Substring(0, 64)) {
            throw 'Installer SHA-256 mismatch.'
        }
        $linuxPath = Wsl-Output @selection --exec wslpath -u ($bashPath.Replace('\', '/'))
        try { Wsl @selection --exec test -r $linuxPath }
        catch { throw 'The downloaded installer is not readable inside Ubuntu. Check Windows-drive automount in /etc/wsl.conf and access to your Windows temporary directory, then retry.' }
        $options = @($Action, '--version', $tag)
        if ($Version -eq 'latest') { $options += '--resolved-latest' }
        if ($Yes) { $options += '--yes' }
        Wsl @selection --exec bash $linuxPath.Trim() @options
        if ($Action -ne 'uninstall') {
            Write-Host 'Starting ASE Studio in this Windows WSLg session. Close its window to finish verification.'
            Wsl @selection --exec sh -c 'exec ~/.local/bin/ase-studio'
            Write-Host 'The WSLg launch command completed. Check that ASE Studio di Nunzio (Ubuntu-24.04) appears in Start. Start-menu visibility requires this interactive check; automated Xvfb tests do not verify it.'
        } else {
            Write-Host 'Ubuntu, WSL, shared dependencies and your data were retained.'
        }
    } finally { Remove-Item -LiteralPath $work -Recurse -Force }
}

Invoke-StudioInstaller -Action $Action -Version $Version -Yes:$Yes -LinuxUser $LinuxUser
