# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-11-02: allow reinstall over installer-owned helper files after offline removal.
# Created in the personal fork on 2026-11-01: execute the actual Windows entrypoint with isolated OS boundaries and no network.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$temp=Join-Path ([IO.Path]::GetTempPath()) ('ase-core-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $temp | Out-Null
try {
    Copy-Item (Join-Path $root 'scripts/install-release.ps1') $temp
    Copy-Item (Join-Path $root 'packaging/windows/release-public.xml') $temp
    $text=[IO.File]::ReadAllText((Join-Path $root 'packaging/windows/windows-setup.ps1'))
    $mocks=@'
function Get-WindowsHost { return @{Build=19045} }
function Get-WslExecutable { return 'fixture-wsl' }
function Download([string]$Url,[string]$Destination) {
    $fixture=Join-Path $env:LOCALAPPDATA 'network-fixtures'
    if(-not (Test-Path $fixture)) { throw 'Network must not be used by discovery or uninstall' }
    $name=if($Url.EndsWith('/latest')) {'release.json'} else {($Url -split '/')[-1]}
    Copy-Item (Join-Path $fixture $name) $Destination
}
function Wsl-Output {
    $command=$args -join ' '
    if($command -eq '--list --quiet') { return 'Ubuntu-26.04' }
    if($command -like '*uname -r') { return '6.6-microsoft-standard-WSL2' }
    if($command -like '*uname -m') { return 'x86_64' }
    if($command -like '*id -u') { return '1000' }
    if($command -like '*id -un') { return 'student' }
    if($command -like '*getconf GNU_LIBC_VERSION') { return 'glibc 2.43' }
    if($command -like '*printenv DISPLAY') { return ':0' }
    throw "Unexpected probe: $command"
}
function Wsl {
    $command=$args -join ' '
    if($command -like '*test -S*') { return }
    if($command -like '*AppRun --installer uninstall*') { [IO.File]::WriteAllText((Join-Path $env:LOCALAPPDATA 'uninstalled.txt'),$command); return }
    throw "Unexpected WSL mutation: $command"
}
Get-WindowsHost | Out-Null
'@
    $text=$text.Replace('Get-WindowsHost | Out-Null',$mocks)
    # Isolate the Start folder and registry, even when this test runs on Windows.
    $text=$text.Replace("[Environment]::GetFolderPath('Programs')", '$env:LOCALAPPDATA')
    $text=$text.Replace("$"+"key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASEStudio'", "$"+"key = Join-Path $"+"env:LOCALAPPDATA 'absent-registry-key'")
    [IO.File]::WriteAllText((Join-Path $temp 'windows-setup.ps1'),$text)
    $ps=(Get-Process -Id $PID).Path
    function Run-Core([string]$Action,[string]$ExpectedError='') {
        $info=[Diagnostics.ProcessStartInfo]::new($ps,('-NoProfile -File "'+(Join-Path $temp 'windows-setup.ps1')+'" -Action '+$Action))
        $info.UseShellExecute=$false;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
        $info.EnvironmentVariables['LOCALAPPDATA']=$temp
        $process=[Diagnostics.Process]::Start($info)
        $output=$process.StandardOutput.ReadToEnd();$errorOutput=$process.StandardError.ReadToEnd();$process.WaitForExit()
        if($ExpectedError) {
            if(-not $process.ExitCode -or $errorOutput -notlike ('*'+$ExpectedError+'*')) { throw "Expected failure: $ExpectedError; got $errorOutput" }
        } elseif($process.ExitCode) { throw $errorOutput }
        return $output
    }
    $rows=@((Run-Core 'discover') | ConvertFrom-Json)
    if($rows.Count -ne 1 -or $rows[0].Name -ne 'Ubuntu-26.04' -or -not $rows[0].Compatible) { throw 'The discover action was lost across the helper import' }
    $store=Join-Path $temp 'ASE Studio';New-Item -ItemType Directory $store | Out-Null
    $state=Join-Path $store 'installation.json'
    [IO.File]::WriteAllText($state,'{"Owner":"ASE Studio Windows v1","Distro":"Ubuntu-26.04","LinuxUser":"student"}')
    Run-Core 'uninstall' | Out-Null
    if((Test-Path $state) -or -not (Test-Path (Join-Path $temp 'uninstalled.txt'))) { throw 'Offline uninstall did not use the saved selection' }
    [IO.File]::WriteAllText((Join-Path $store '.owner'),'ASE Studio Windows v1')
    [IO.File]::WriteAllText((Join-Path $store 'LICENSE'),'Retained installer-owned file')
    $fixtures=Join-Path $temp 'network-fixtures';New-Item -ItemType Directory $fixtures | Out-Null
    [IO.File]::WriteAllText((Join-Path $fixtures 'release.json'),'{"draft":false,"prerelease":false,"tag_name":"v1.6.2-abate.3"}')
    [IO.File]::WriteAllText((Join-Path $fixtures 'targets.json'),'{"schema_version":3,"version":"v1.6.2-abate.3","release_sequence":3,"targets":[]}')
    [IO.File]::WriteAllBytes((Join-Path $fixtures 'targets.json.sig'),[byte[]]::new(256))
    Run-Core 'install' 'Release signature verification failed' | Out-Null
    if(Test-Path $state) { throw 'Unauthenticated release was registered' }
    'PASS actual Windows core: discover dispatch, offline uninstall, invalid signature rejection'
} finally { Remove-Item -LiteralPath $temp -Recurse -Force }
