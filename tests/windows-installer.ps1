# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-31: verify actual installer host eligibility without invoking WSL or modifying the machine.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$path = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts/install-release.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
# Load only the real guard, so fixtures never execute installation side effects.
$guards = @($ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-WindowsHost'
}, $true))
if ($guards.Count -ne 1) { throw 'Expected one Windows host guard' }
. ([scriptblock]::Create($guards[0].Extent.Text))
$cases = @(
    @{ Build = 18363; Architecture = 'X64'; Allowed = $false },
    @{ Build = 19043; Architecture = 'X64'; Allowed = $false },
    @{ Build = 19044; Architecture = 'X64'; Allowed = $true },
    @{ Build = 19045; Architecture = 'X64'; Allowed = $true },
    @{ Build = 22000; Architecture = 'X64'; Allowed = $true },
    @{ Build = 26100; Architecture = 'X64'; Allowed = $true },
    @{ Build = 19044; Architecture = 'Arm64'; Allowed = $false },
    @{ Build = 26100; Architecture = 'Arm64'; Allowed = $false },
    @{ Build = 19045; Architecture = 'X86'; Allowed = $false }
)
foreach ($case in $cases) {
    $allowed = $true
    try { Assert-WindowsHost -Build $case.Build -Architecture $case.Architecture }
    catch {
        if ($_.Exception.Message -notlike 'This installer requires Windows 10*') { throw }
        $allowed = $false
    }
    if ($allowed -ne $case.Allowed) { throw "Unexpected eligibility: build $($case.Build), $($case.Architecture)" }
}
Write-Host "PASS $($cases.Count) Windows installer eligibility cases; no WSL or desktop certification implied."
