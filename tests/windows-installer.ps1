# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-10-31: exercise real host detection, native calls and the complete Windows installer with isolated external boundaries.
# Created in the personal fork on 2026-10-31: verify actual installer host eligibility without invoking WSL or modifying the machine.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$path = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts/install-release.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($definition in $ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
}, $false)) { . ([scriptblock]::Create($definition.Extent.Text)) }
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Expect-Failure([scriptblock]$Run, [string]$Message) {
    $failed = $false
    try { & $Run } catch {
        $failed = $true
        if ($_.Exception.Message -notlike "*$Message*") { throw }
    }
    Assert $failed "Expected failure containing: $Message"
}
$windowsHost = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
if ($windowsHost) {
    # This was missing from Abate 2: execute the REAL detector on both PS runtimes,
    # including 32-bit Windows PowerShell, before replacing OS boundaries below.
    $detected = Get-WindowsHost
    Assert ($detected.Build -ge 19044 -and $detected.Architecture -eq 'x86-64') 'Real host detection failed'
    $nativeWsl = Get-WslExecutable
    $nativeFolder = if ([Environment]::Is64BitProcess) { 'System32' } else { 'Sysnative' }
    Assert ($nativeWsl -eq (Join-Path $env:SystemRoot "$nativeFolder\wsl.exe")) 'Native WSL path selection failed'
    Write-Host "PASS real Windows detection; PS $($PSVersionTable.PSVersion), 64-bit process: $([Environment]::Is64BitProcess)"
}
foreach ($case in @(
    @(18363, 9, 64, $false), @(19043, 9, 64, $false), @(19044, 9, 64, $true),
    @(19045, 9, 64, $true), @(22000, 9, 64, $true), @(26100, 9, 64, $true),
    @(19045, 12, 64, $false), @(26100, 12, 64, $false), @(19045, 0, 32, $false),
    @(19045, 9, 32, $false), @(19045, 6, 64, $false), @(19045, 99, 64, $false)
)) {
    $allowed = $true
    try { Assert-WindowsHost -Build $case[0] -Architecture $case[1] -AddressWidth $case[2] }
    catch { $allowed = $false }
    Assert ($allowed -eq $case[3]) "Unexpected eligibility: $case"
}
# Real native argument/exit/encoding boundary; starts only another PowerShell,
# never WSL. The temp path deliberately includes spaces and wildcard characters.
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('ase test [paths] ' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    $originalEncoding = [Console]::OutputEncoding
    $originalWslUtf8 = [Environment]::GetEnvironmentVariable('WSL_UTF8', 'Process')
    $wslExecutable = (Get-Process -Id $PID).Path
    $nativeScript = Join-Path $fixture 'native args.ps1'
    [IO.File]::WriteAllText($nativeScript, '$args | ConvertTo-Json -Compress')
    $spaced = Join-Path $fixture ('user ' + [char]0xE8 + ' file.sh')
    $actual = Invoke-WslCommand -Capture -Arguments @('-NoProfile', '-File', $nativeScript, $spaced, 'install', '--version', 'v1.6.2-abate.3')
    $decoded = @($actual | ConvertFrom-Json)
    Assert ($decoded.Count -eq 4 -and $decoded[0] -ceq $spaced -and $decoded[3] -eq 'v1.6.2-abate.3') "Native argument boundaries lost: $actual ; expected path: $spaced"
    $text = Invoke-WslCommand -Capture -Arguments @('-NoProfile', '-Command', '[Console]::WriteLine(42); exit 0')
    Assert ($text -eq '42') 'Native stdout was corrupted'
    Expect-Failure { Invoke-WslCommand -Capture -Arguments @('-NoProfile', '-Command', '[Console]::Error.WriteLine(123); exit 7') } 'WSL command failed (7). 123'
    Expect-Failure { Invoke-WslCommand -Arguments @('-NoProfile', '-Command', 'exit 8') } 'WSL command failed (8)'
    [IO.File]::WriteAllText($nativeScript, '[Console]::WriteLine("Ubuntu" + [char]0 + "-24.04")')
    $text = Invoke-WslCommand -Capture -Arguments @('-NoProfile', '-File', $nativeScript)
    Assert ($text -eq 'Ubuntu-24.04') 'WSL NUL output was not normalized'
    if ($windowsHost) {
        $downloaded = Join-Path $fixture 'LICENSE'
        $tls = [Net.ServicePointManager]::SecurityProtocol
        Download 'https://github.com/nunzioricci2000/ase-studio/releases/download/v1.6.2-abate.2/LICENSE' $downloaded
        # Pin the published bytes: Git may convert checkout LICENSE to CRLF on Windows.
        Assert ((Get-FileHash -LiteralPath $downloaded).Hash.ToLowerInvariant() -eq '8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643') 'Real HTTPS redirect download differs'
        Assert ([Net.ServicePointManager]::SecurityProtocol -eq $tls) 'Download retained modified TLS configuration'
    }
    Assert ([Console]::OutputEncoding.CodePage -eq $originalEncoding.CodePage) 'Native command retained console encoding changes'
    Assert ([Environment]::GetEnvironmentVariable('WSL_UTF8', 'Process') -ceq $originalWslUtf8) 'Native command retained WSL_UTF8 changes'
    Expect-Failure { Download 'http://example.invalid/install.sh' (Join-Path $fixture 'unsafe') } 'Only HTTPS'
} finally { Remove-Item -LiteralPath $fixture -Recurse -Force }

# Test the whole orchestration, retaining real host validation, hash checking,
# temporary-directory lifecycle, release validation and option forwarding.
$script:state = @{}
function Get-CimInstance {
    param([string]$ClassName, [string]$ErrorAction)
    if ($script:state.Mode -eq 'cim-failure') { throw 'CIM unavailable' }
    if ($ClassName -eq 'Win32_OperatingSystem') { return [pscustomobject]@{ BuildNumber = '19045' } }
    if ($script:state.Mode -eq 'arm64') { return [pscustomobject]@{ Architecture = 12; AddressWidth = 64 } }
    if ($script:state.Mode -eq 'missing-cpu') { return }
    return [pscustomobject]@{ Architecture = 9; AddressWidth = 64 }
}
function Get-WslExecutable {
    if ($script:state.Mode -eq 'no-wsl') { throw 'WSL is unavailable.' }
    return 'mock-wsl.exe'
}
function Read-Host { return 'n' }
function Invoke-WslCommand {
    param([string[]]$Arguments, [switch]$Capture)
    $script:state.Calls.Add(@($Arguments))
    $command = $Arguments -join ' '
    if ($command -eq '--list --quiet') {
        if ($script:state.Mode -eq 'wsl-error') { throw 'WSL command failed (1)' }
        if ($script:state.Mode -in @('absent', 'declined')) { return 'Debian' }
        return " Debian `r`n Ubuntu-24.04 "
    }
    if ($command -like '*--exec uname -r') {
        if ($script:state.Mode -eq 'wsl1') { return '4.4.0-Microsoft' }
        return '6.6.87.2-microsoft-standard-WSL2'
    }
    if ($command -like '*--exec id -u') {
        if ($script:state.Mode -eq 'root') { return '0' }
        return '1000'
    }
    if ($command -like '*--exec test -S*' -and $script:state.Mode -eq 'no-gui') { throw 'no socket' }
    if ($command -like '*--exec printenv DISPLAY') {
        if ($script:state.Mode -eq 'no-display') { return '' }
        return ':0'
    }
    if ($command -like '*--exec wslpath*') { return '/mnt/c/Users/Some Name/AppData/Local/Temp/ase [test]/install-release.sh' }
    if ($command -like '*--exec test -r*' -and $script:state.Mode -eq 'no-mount') { throw 'not mounted' }
    if ($command -like '*--exec bash*' -and $script:state.Mode -eq 'linux-failure') { throw 'Linux installer failed' }
    if ($command -like '*--exec sh -c*' -and $script:state.Mode -eq 'launch-failure') { throw 'Studio launch failed' }
}
function Download([string]$url, [string]$path) {
    $script:state.Downloads++
    $script:state.Work = Split-Path $path -Parent
    if ($script:state.Mode -eq 'network') { throw 'Network interrupted' }
    $tag = 'v1.6.2-abate.3'
    $bytes = [Text.Encoding]::UTF8.GetBytes("#!/bin/bash`necho fixture`n")
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($url -like '*/releases/latest' -or $url -like '*/releases/tags/*') {
        if ($script:state.Mode -eq 'wrong-tag') { $tag = 'v1.6.2-abate.2' }
        $base = "https://github.com/nunzioricci2000/ase-studio/releases/download/$tag/"
        $assets = @(
            @{ name = 'install-release.sh'; size = $bytes.Length; browser_download_url = $base + 'install-release.sh' },
            @{ name = 'SHA256SUMS'; size = 85; browser_download_url = $base + 'SHA256SUMS' }
        )
        if ($script:state.Mode -eq 'incomplete') { $assets = @() }
        if ($script:state.Mode -eq 'wrong-url') { $assets[0].browser_download_url = 'http://example.invalid/install-release.sh' }
        if ($script:state.Mode -eq 'truncated') { $assets[0].size++ }
        $record = @{ tag_name = $tag; draft = $false; prerelease = ($script:state.Mode -eq 'prerelease'); assets = $assets }
        [IO.File]::WriteAllText($path, ($record | ConvertTo-Json -Depth 5))
    } elseif ($url.EndsWith('/install-release.sh')) {
        [IO.File]::WriteAllBytes($path, $bytes)
    } elseif ($url.EndsWith('/SHA256SUMS')) {
        if ($script:state.Mode -eq 'checksum') { $digest = '0' * 64 }
        [IO.File]::WriteAllText($path, "$digest  install-release.sh`n")
    } else { throw "Unexpected download: $url" }
}
function Run-Scenario([string]$Mode, [string]$Action = 'install', [string]$Version = 'latest', [string]$Failure = '') {
    $script:state = @{ Mode = $Mode; Calls = (New-Object 'System.Collections.Generic.List[object]'); Downloads = 0; Work = '' }
    $run = { Invoke-StudioInstaller -Action $Action -Version $Version -Yes:($Mode -ne 'declined') -LinuxUser 'student' }
    if ($Failure) { Expect-Failure $run $Failure } else { & $run }
    if ($script:state.Work) { Assert (-not (Test-Path -LiteralPath $script:state.Work)) 'Temporary download files were not removed' }
    foreach ($call in $script:state.Calls) {
        Assert (-not ($call -contains '--set-default' -or $call -contains '--set-version' -or $call -contains '--unregister' -or $call -contains '--shutdown')) 'Unexpected destructive WSL action'
        if ($call -contains '--exec') { Assert (($call -join ' ') -like '-d Ubuntu-24.04 -u student --exec *') 'Linux user selection was lost' }
    }
}
foreach ($case in @(
    @('cim-failure', 'CIM unavailable'), @('missing-cpu', 'Missing host information'), @('arm64', 'This installer requires'),
    @('no-wsl', 'WSL is unavailable'), @('wsl-error', 'WSL command failed'), @('declined', 'Ubuntu installation declined'),
    @('wsl1', 'must already use WSL2'), @('root', 'normal Linux user'), @('no-gui', 'WSLg is unavailable'),
    @('no-display', 'WSLg is unavailable'), @('network', 'Network interrupted'), @('incomplete', 'Incomplete release'),
    @('wrong-url', 'Incomplete release'), @('truncated', 'Interrupted download'), @('checksum', 'SHA-256 mismatch'),
    @('prerelease', 'published stable release'), @('no-mount', 'not readable inside Ubuntu'),
    @('linux-failure', 'Linux installer failed'), @('launch-failure', 'Studio launch failed')
)) {
    Run-Scenario -Mode $case[0] -Failure $case[1]
    if ($case[0] -notin @('linux-failure', 'launch-failure')) {
        Assert (-not @($script:state.Calls | Where-Object { $_ -contains 'bash' }).Count) 'Ran Bash before successful validation'
    }
}
Run-Scenario -Mode 'absent'
Assert ($script:state.Downloads -eq 0 -and @($script:state.Calls | Where-Object { $_ -contains '--install' }).Count -eq 1) 'Distro setup did not stop for first-run user creation'
Run-Scenario -Mode 'absent' -Action 'update' -Failure 'Ubuntu-24.04 is absent'
Run-Scenario -Mode 'wrong-tag' -Version 'v1.6.2-abate.3' -Failure 'published stable release'
foreach ($action in @('install', 'install', 'update', 'uninstall')) {
    Run-Scenario -Mode 'success' -Action $action
    $bash = @($script:state.Calls | Where-Object { $_ -contains 'bash' })
    Assert ($bash.Count -eq 1 -and $bash[0][6] -eq '/mnt/c/Users/Some Name/AppData/Local/Temp/ase [test]/install-release.sh') 'Spaced Linux path was split'
    Assert ($bash[0] -contains $action -and $bash[0] -contains '--resolved-latest' -and $bash[0] -contains '--yes') 'Action or update policy lost'
    if ($action -eq 'uninstall') { Assert (-not @($script:state.Calls | Where-Object { $_ -contains 'sh' -or $_ -contains '-S' }).Count) 'Uninstall required a desktop or launched Studio' }
}
Run-Scenario -Mode 'no-gui' -Action 'uninstall'
Run-Scenario -Mode 'success' -Version 'v1.6.2-abate.3'
$bash = @($script:state.Calls | Where-Object { $_ -contains 'bash' })
Assert (-not ($bash[0] -contains '--resolved-latest')) 'Explicit version lost its manual-update pin'
Write-Host 'PASS host detection, eligibility, native invocation, failure recovery and installer orchestration. WSLg/Start-menu desktop certification is separate.'
