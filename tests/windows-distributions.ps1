# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-11-01: exercise distribution discovery and deterministic selection with isolated WSL boundaries.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/install-release.ps1')
function Assert($ok,$message) { if(-not $ok) { throw $message } }
function Wsl-Output {
    $command=$args -join ' '
    if($command -eq '--list --quiet') { return "Ubuntu-26.04`nDebian`ndocker-desktop`nAlpine" }
    if($command -like '*uname -r') { return '6.6-microsoft-standard-WSL2' }
    if($command -like '*uname -m') { return 'x86_64' }
    if($command -like '*id -u') { return '1000' }
    if($command -like '*getconf GNU_LIBC_VERSION') {
        if($args -contains 'Alpine') { throw 'musl' }
        return 'glibc 2.43'
    }
    if($command -like '*printenv DISPLAY') { return ':0' }
    throw "Unexpected probe: $command"
}
function Wsl { if(($args -join ' ') -notlike '*test -S*') { throw 'Unexpected WSL mutation' } }
$rows=@(Get-StudioDistributions)
Assert ($rows.Count -eq 4) 'Discovery lost a distribution'
Assert (@($rows | Where-Object Compatible).Count -eq 2) 'Version-independent compatibility failed'
Assert ((Select-StudioDistribution @($rows[0]) '' -NonInteractive) -eq 'Ubuntu-26.04') 'Single candidate was not selected'
Assert ((Select-StudioDistribution @($rows[0],$rows[2]) '' -NonInteractive) -eq 'Ubuntu-26.04') 'Single compatible candidate was not selected'
Assert ((Select-StudioDistribution $rows 'Debian' -NonInteractive) -eq 'Debian') 'Explicit choice was lost'
Assert ((Select-StudioDistribution @($rows[2]) '' -NonInteractive) -eq '') 'Infrastructure distribution was selected'
try { Select-StudioDistribution $rows '' -NonInteractive; throw 'Expected ambiguity' } catch { Assert ($_.Exception.Message -like '*Multiple compatible*') 'Noninteractive ambiguity was ignored' }
try { Select-StudioDistribution $rows 'Alpine' -NonInteractive; throw 'Expected incompatibility' } catch { Assert ($_.Exception.Message -like '*musl*') 'Incompatible explicit choice was accepted' }
'PASS discovery, Ubuntu 26 eligibility, technical distro exclusion, automatic and explicit selection, ambiguity'
