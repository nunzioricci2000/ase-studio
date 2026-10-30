# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-30: install release packages on Windows 11 x86-64 through standard Ubuntu WSL2/WSLg.
param(
    [ValidateSet('install', 'update', 'uninstall')][string]$Action = 'install',
    [string]$Version = 'latest',
    [switch]$Yes,
    [string]$LinuxUser = ''
)
# Modified in the personal fork on 2026-10-30: select stable releases by upstream version, feature name and fork revision.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repository = 'nunzioricci2000/ase-studio'
$distro = 'Ubuntu-24.04'
if ([Environment]::OSVersion.Version.Build -lt 22000 -or
    [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [Runtime.InteropServices.Architecture]::X64) {
    throw 'This installer requires Windows 11 x86-64. Windows ARM and native Windows builds are not supported.'
}
if ($Version -ne 'latest' -and $Version -cnotmatch '^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-(?!alpha\.|beta\.|rc\.)[a-z]+\.[1-9][0-9]*\z') { throw 'Use latest or a stable fork tag such as v1.6.0-abate.1.' }
if ($LinuxUser -and $LinuxUser -notmatch '^[a-z_][a-z0-9_-]*$') { throw 'Invalid Linux username.' }
function Wsl {
    & wsl.exe @args
    if ($LASTEXITCODE -ne 0) { throw "WSL command failed ($LASTEXITCODE). Resolve the displayed error and rerun the same installer command." }
}
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw 'Enable WSL from an administrator PowerShell with: wsl --install --no-distribution . Restart if requested, then rerun this command.'
}
$names = (& wsl.exe --list --quiet 2>$null) -replace "`0", ''
if ($LASTEXITCODE -ne 0) {
    throw 'WSL is not ready. In administrator PowerShell run: wsl --install --no-distribution . Restart if requested, then rerun this command.'
}
if ($distro -notin @($names | ForEach-Object { $_.Trim() })) {
    if ($Action -ne 'install') { throw 'Ubuntu-24.04 is absent; there is no Studio installation to manage.' }
    Write-Host 'Required operation: wsl --install --distribution Ubuntu-24.04 --no-launch'
    if (-not $Yes -and (Read-Host 'Install Ubuntu-24.04? [y/N]') -notmatch '^(y|yes)$') { throw 'Ubuntu installation declined.' }
    Wsl --install --distribution $distro --no-launch
    Write-Host 'Open Ubuntu-24.04 from Start to complete first-run setup and create your normal Linux user. Restart Windows if WSL requested it, then rerun this command.'
    exit 0
}
# Read the running kernel instead of parsing localized `wsl --list --verbose` output.
$kernel = Wsl -d $distro --exec uname -r
if ($kernel -notmatch 'microsoft.*WSL2|microsoft-standard') {
    throw 'Ubuntu-24.04 must already use WSL2. No distribution was converted. Review wsl --list --verbose and explicitly migrate it before retrying.'
}
$selection = @('-d', $distro)
if ($LinuxUser) { $selection += @('-u', $LinuxUser) }
$uid = Wsl @selection --exec id -u
if ($uid.Trim() -eq '0') {
    throw 'Complete Ubuntu first-run setup with a normal Linux user, then rerun with -LinuxUser USER. Studio is never launched as root.'
}
if ($Action -ne 'uninstall') {
    try {
        Wsl @selection --exec test -S /mnt/wslg/.X11-unix/X0
    } catch {
        throw 'WSLg is unavailable. Review https://learn.microsoft.com/windows/wsl/tutorials/gui-apps and run wsl --update if needed, then rerun from your Windows desktop session.'
    }
}

# Follow HTTPS redirects explicitly; do not allow a redirect to cleartext HTTP.
Add-Type -AssemblyName System.Net.Http
function Download([string]$url, [string]$path) {
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
    } finally { $client.Dispose(); $handler.Dispose() }
}
$work = Join-Path ([IO.Path]::GetTempPath()) ('ase-release-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $work | Out-Null
try {
    $apiSuffix = if ($Version -eq 'latest') { 'latest' } else { 'tags/' + $Version }
    Download "https://api.github.com/repos/$repository/releases/$apiSuffix" (Join-Path $work 'release.json')
    $release = Get-Content -Raw (Join-Path $work 'release.json') | ConvertFrom-Json
    $tag = $release.tag_name
    if ($release.draft -or $release.prerelease -or $tag -cnotmatch '^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-(?!alpha\.|beta\.|rc\.)[a-z]+\.[1-9][0-9]*\z' -or
        ($Version -ne 'latest' -and $tag -ne $Version)) { throw 'A matching published stable release is required.' }
    $base = "https://github.com/$repository/releases/download/$tag/"
    foreach ($name in @('install-release.sh', 'SHA256SUMS')) {
        $asset = @($release.assets | Where-Object { $_.name -ceq $name })
        if ($asset.Count -ne 1 -or $asset[0].browser_download_url -cne ($base + $name)) { throw "Incomplete release: $name" }
        $path = Join-Path $work $name
        Download ($base + $name) $path
        if ((Get-Item $path).Length -ne $asset[0].size) { throw "Interrupted download: $name" }
    }
    $sums = @(Get-Content (Join-Path $work 'SHA256SUMS') | Where-Object { $_ -cmatch '^[a-f0-9]{64}  install-release\.sh$' })
    $bashPath = Join-Path $work 'install-release.sh'
    if ($sums.Count -ne 1 -or (Get-FileHash -Algorithm SHA256 $bashPath).Hash.ToLower() -cne $sums[0].Substring(0, 64)) {
        throw 'Installer SHA-256 mismatch.'
    }
    $linuxPath = Wsl @selection --exec wslpath -u ($bashPath.Replace('\', '/'))
    $options = @($Action, '--version', $tag)
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
