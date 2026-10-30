# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-28: verify the packaged Studio backend and native GTK editor under Windows WSL2.
# Modified in the personal fork on 2026-10-30: install the final archive and run verification tools from the external checkout.
$ErrorActionPreference = 'Stop'
$outDir = Join-Path $env:RUNNER_TEMP 'studio-wsl-report'
$artifact = Join-Path $env:GITHUB_WORKSPACE 'artifact'
New-Item -ItemType Directory -Force $outDir | Out-Null
$timer = [Diagnostics.Stopwatch]::StartNew()
$report = @{
    target = 'windows-wsl2-x86_64'
    started_at = [DateTime]::UtcNow.ToString('o')
    status = 'running'
    stages = @()
    notes = @('Ubuntu 24.04 package in WSL2. GTK/WebKit editor exercised under Xvfb; host WSLg desktop integration is not tested. No native Windows executable.')
}
function Save-Report {
    $report | ConvertTo-Json -Depth 16 | Set-Content -Encoding utf8 (Join-Path $outDir 'report.json')
}
function Stage([string]$name, [scriptblock]$action) {
    $step = @{ name = $name; started_at = [DateTime]::UtcNow.ToString('o'); status = 'running' }
    $report.stages += $step
    $clock = [Diagnostics.Stopwatch]::StartNew()
    Save-Report
    try {
        & $action *> (Join-Path $outDir "$name.log")
        $step.status = 'succeeded'
    } catch {
        $step.status = 'failed'
        $step.error = $_.ToString()
        throw
    } finally {
        $step.finished_at = [DateTime]::UtcNow.ToString('o')
        $step.wall_seconds = $clock.Elapsed.TotalSeconds
        Save-Report
    }
}
function Wsl {
    & wsl.exe @args
    if ($LASTEXITCODE -ne 0) { throw "wsl.exe failed: $LASTEXITCODE" }
}
function LinuxPath([string]$path) {
    $value = & wsl.exe -d Ubuntu-24.04 -u root --exec wslpath -u ($path.Replace('\', '/'))
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) { throw "Cannot translate WSL path: $path" }
    return $value.Trim()
}
Save-Report
try {
    Stage 'verify-package' {
        $source = Get-Content (Join-Path $artifact 'report.json') | ConvertFrom-Json
        if ($source.status -ne 'succeeded' -or $source.target.id -ne 'ubuntu-24.04-x86_64' -or $source.studio_source_dirty) {
            throw 'A clean, successful Ubuntu 24.04 Studio package is required'
        }
        foreach ($file in $source.artifacts) {
            if ([IO.Path]::GetFileName($file.name) -ne $file.name) { throw 'Invalid artifact name' }
            $path = Join-Path $artifact $file.name
            if ((Get-Item $path).Length -ne $file.bytes -or (Get-FileHash -Algorithm SHA256 $path).Hash.ToLower() -ne $file.sha256) {
                throw "Artifact checksum mismatch: $($file.name)"
            }
        }
        $report.source_artifact = $source
    }
    Stage 'install-wsl-distribution' {
        Wsl --set-default-version 2
        Wsl --install --distribution Ubuntu-24.04 --no-launch --web-download
        Wsl -d Ubuntu-24.04 -u root -- uname -r
    }
    Stage 'installed-backend-and-native-editor' {
        $script = @'
# SPDX-License-Identifier: GPL-2.0-only
# Generated from scripts/wsl-test.ps1, created on 2026-10-28.
set -euo pipefail
uname -r | grep -Ei 'microsoft.*WSL2|microsoft-standard'
work=$(mktemp -d /tmp/ase-studio-wsl-XXXXXX)
mkdir -p "$work/results" "$2/runtime"
trap 'cp -a "$work/results/." "$2/runtime/"' EXIT
bash "$3/scripts/runtime-dependencies.sh" debian
app="$work/Installed Home With Spaces/.local/opt/ase-studio/current"
id studio-check >/dev/null 2>&1 || useradd --create-home studio-check
mkdir -p "$work/data/programs/native-smoke"
printf '.text\n.globl _start\n_start:\n li a0, 0\n li a7, 93\n ecall\n' > "$work/data/programs/native-smoke/main.s"
printf 'include $(ASE_STUDIO_DEMO_MK)\n' > "$work/data/programs/native-smoke/Makefile"
chown -R studio-check:studio-check "$work"
runuser -u studio-check -- python3 - "$3/scripts" "$1" "$work" <<'PYINSTALL'
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from release_install import Installation, extract_runtime, read_version
work = Path(sys.argv[3])
target = 'ubuntu-24.04-x86_64'
payload = extract_runtime(Path(sys.argv[2]) / f'ase-studio-nunzio-{target}.tar.gz', work / 'unpacked', target)
installation = Installation(work / 'Installed Home With Spaces')
with installation.lock():
    installation.install(payload, target, read_version(payload / 'ase_studio')['release_tag'])
PYINSTALL
runuser -u studio-check -- python3 "$3/scripts/smoke-package.py" \
  --studio "$app/ase_studio" --engine "$app/engine" --python "$app/engine/python/bin/python3.10" --output "$work/results/backend"
runuser -u studio-check -- env GDK_BACKEND=x11 xvfb-run -a "$app/ase-studio" --data "$work/data" --port 0 \
  --native-smoke-report "$work/results/native-runtime.json" --native-smoke-script "$3/scripts/native-smoke.js"
'@
        $scriptPath = Join-Path $outDir 'wsl-smoke.sh'
        [IO.File]::WriteAllText($scriptPath, ($script -replace "`r", ''), [Text.UTF8Encoding]::new($false))
        Wsl -d Ubuntu-24.04 -u root --exec bash (LinuxPath $scriptPath) (LinuxPath $artifact) (LinuxPath $outDir) (LinuxPath $env:GITHUB_WORKSPACE)
    }
    $report.status = 'succeeded'
} catch {
    $report.status = 'failed'
    $report.error = $_.ToString()
} finally {
    $report.finished_at = [DateTime]::UtcNow.ToString('o')
    $report.wall_seconds = $timer.Elapsed.TotalSeconds
    Save-Report
}
if ($report.status -ne 'succeeded') { exit 1 }
