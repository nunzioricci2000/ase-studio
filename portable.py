#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-10-30: accept native verification scripts from outside the application.
# Created in the personal fork on 2026-10-28: launch a prebuilt SDK with persistent data outside the application.
# Modified in the personal fork on 2026-10-28: keep a stable preferred port for webview preferences across launches.
# Modified in the personal fork on 2026-10-28: support isolated native-window validation of installed Linux packages.
# Modified in the personal fork on 2026-10-28: prevent bytecode writes inside installed application resources.
"""Runtime entry point for packaged Studio; never fetch or build an engine."""
import argparse
import os
from pathlib import Path
import platform
import subprocess
import sys

STUDIO = Path(__file__).resolve().parent
SETUP = '''# SPDX-License-Identifier: GPL-2.0-only
# Created by the personal fork's portable launcher on first use.
# Runtime locations follow the application; user overrides live in .ase-studio-env.json.
export RISCV_TOOLCHAIN_PATH="${ASE_STUDIO_ENGINE_ROOT:?}/toolchain/bin"
export GEM5_INSTALLATION_PATH="$ASE_STUDIO_ENGINE_ROOT/bin/gem5"
export GEM5_SIMULATION_SCRIPT="$ASE_STUDIO_ENGINE_ROOT/configs/riscv_in_order_hen_patt.py"
export GEM5_O3_SIMULATION_SCRIPT="$ASE_STUDIO_ENGINE_ROOT/configs/riscv_o3_custom.py"
export ASE_STUDIO_DEMO_MK="${ASE_STUDIO_ASSET_ROOT:?}/scripts/portable-demo.mk"
export OPTIMIZATION_FLAGS=""
'''


def default_data():
    if platform.system() == 'Darwin':
        return Path.home() / 'Library/Application Support/ASE Studio di Nunzio'
    directory = Path(os.environ.get('XDG_DATA_HOME', ''))
    if not directory.is_absolute():
        directory = Path.home() / '.local/share'
    return directory / 'ase-studio-nunzio'


def prepare(engine, data):
    engine, data = engine.expanduser().resolve(), data.expanduser().resolve()
    if data.is_relative_to(STUDIO.parent) or data.is_relative_to(engine):
        raise ValueError('Choose a data directory outside the application and engine directories')
    for name in ('bin/gem5', 'toolchain/bin/riscv64-unknown-elf-gcc',
                 'toolchain/bin/riscv64-unknown-elf-objdump'):
        executable = engine / name
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise ValueError(f'The packaged engine is missing an executable: {executable}')
    for name in ('riscv_in_order_hen_patt.py', 'riscv_o3_custom.py'):
        if not (engine / 'configs' / name).is_file():
            raise ValueError(f'The packaged engine is missing configuration {name}')
    data.mkdir(parents=True, exist_ok=True)
    (data / 'programs').mkdir(exist_ok=True)
    try:
        with (data / 'setup_default').open('x') as setup:
            setup.write(SETUP)
    except FileExistsError:
        if not (data / 'setup_default').is_file():
            raise ValueError('The data directory contains an invalid setup_default')
    # Preserve existing settings and projects. The generated setup references
    # these environment variables so moving/updating the app does not stale paths.
    return dict(os.environ, PYTHONDONTWRITEBYTECODE='1', ASE_STUDIO_HOST_ROOT=str(data), ASE_STUDIO_ENGINE_ROOT=str(engine),
                ASE_STUDIO_ASSET_ROOT=str(STUDIO))


def main():
    parser = argparse.ArgumentParser(description='ASE Studio di Nunzio — packaged runtime')
    parser.add_argument('--engine', type=Path, default=STUDIO.parent / 'engine')
    parser.add_argument('--data', type=Path, default=default_data())
    parser.add_argument('--port', type=int, default=os.environ.get('ASE_STUDIO_PORT', '8765'))
    parser.add_argument('--native-smoke-report', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--native-smoke-script', type=Path, help=argparse.SUPPRESS)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--server', action='store_true', help='Serve the native macOS webview')
    mode.add_argument('--browser', action='store_true', help='Open the interface in the system browser')
    mode.add_argument('--check', action='store_true', help='Validate startup without opening a window')
    args = parser.parse_args()
    if bool(args.native_smoke_report) != bool(args.native_smoke_script):
        parser.error('Supply both external native smoke script and report')
    if args.native_smoke_report and (args.server or args.browser or args.check):
        parser.error('Native smoke validation requires the native window')
    if os.name == 'nt':
        parser.error('Use the Linux package inside Windows WSL2')
    if not 0 <= args.port <= 65535:
        parser.error('Port must be 0..65535')
    if platform.system() == 'Darwin' and not (args.server or args.browser or args.check):
        parser.error('Open the macOS application bundle to launch its native window')
    try:
        env = prepare(args.engine, args.data)
    except (OSError, ValueError) as error:
        print(f'ASE Studio could not start: {error}', file=sys.stderr)
        return 1
    if args.check:
        return subprocess.run([sys.executable, str(STUDIO / 'backend.py'), '--check-startup'], env=env).returncode
    script = 'backend.py' if args.server or args.browser else 'native.py'
    command = [sys.executable, str(STUDIO / script), str(args.port)]
    if args.browser:
        command.append('--open')
    if args.native_smoke_report:
        command.extend(['--smoke-report', str(args.native_smoke_report.resolve()),
                        '--smoke-script', str(args.native_smoke_script.resolve())])
    os.execve(sys.executable, command, env)


if __name__ == '__main__':
    sys.exit(main())
