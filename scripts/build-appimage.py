#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-31: build the x86_64 AppImage from verified inputs without changing tracked frontend assets.
# Modified in the personal fork on 2026-11-01: use Zstandard level 19 and 1 MiB blocks to reduce download size.
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from package import ROOT, provenance, export_code, checksum


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--sdk', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    args = parser.parse_args()
    work, inputs, sdk = args.work.resolve(), args.inputs.resolve(), args.sdk.resolve()
    if work.exists():
        parser.error('Choose a new work directory')
    # Recheck all input hashes and the detached signature even when cached.
    subprocess.run(['python3', str(ROOT / 'scripts/fetch-appimage-inputs.py'), '--output', str(inputs)], check=True)
    work.mkdir(parents=True)
    export_code(work / 'studio', provenance())
    shutil.copy2(ROOT / 'packaging/appimage/Dockerfile', work / 'Dockerfile')
    # Only verified .deb inputs enter the Docker context; never copy credentials or source checkouts.
    (work / 'debs').mkdir()
    lock = json.loads((ROOT / 'packaging/appimage/ubuntu-runtime.lock.json').read_text())
    for row in lock['packages']:
        shutil.copy2(inputs / 'debs' / row['name'], work / 'debs' / row['name'])
    docker = ['docker', '--host=unix:///var/run/docker.sock']
    context = work / 'context'
    context.mkdir()
    (work / 'debs').rename(context / 'debs')
    shutil.copy2(work / 'Dockerfile', context / 'Dockerfile')
    tag = 'ase-appimage-builder:' + checksum(ROOT / 'packaging/appimage/ubuntu-runtime.lock.json')[:16]
    subprocess.run(docker + ['build', '--network=none', '-t', tag, str(context)], check=True)
    command = docker + ['run', '--rm', '--network=none', '--user', f'{os.getuid()}:{os.getgid()}',
        '--mount', f'type=bind,src={work},dst=/work',
        '--mount', f'type=bind,src={sdk},dst=/sdk,readonly',
        '--mount', f'type=bind,src={inputs / "tools"},dst=/tools,readonly', tag,
        'python3', '/work/studio/scripts/appimage.py', '--sdk', '/sdk', '--output', '/work/build',
        '--runtime-license', '/tools/runtime-LICENSE']
    subprocess.run(command, check=True)
    appdir = work / 'build/ASE-Studio.AppDir'
    image = work / 'ASE-Studio-experimental-x86_64.AppImage'
    tool = inputs / 'tools/appimagetool-x86_64.AppImage'
    tool.chmod(0o755)
    with tempfile.TemporaryDirectory(prefix='appimage-tool-', dir=work) as temporary:
        subprocess.run([str(tool), '--appimage-extract'], cwd=temporary, stdout=subprocess.DEVNULL, check=True)
        epoch = subprocess.check_output(['git', '-C', str(ROOT), 'show', '-s', '--format=%ct', 'HEAD'], text=True).strip() if (ROOT / '.git').exists() else '1793448000'
        subprocess.run([str(Path(temporary) / 'squashfs-root/AppRun'), '--runtime-file', str(inputs / 'tools/runtime-x86_64'),
            '--mksquashfs-opt', '-processors', '--mksquashfs-opt', '4',
            '--mksquashfs-opt', '-b', '--mksquashfs-opt', '1048576',
            '--mksquashfs-opt', '-Xcompression-level', '--mksquashfs-opt', '19', str(appdir), str(image)],
            env=dict(os.environ, ARCH='x86_64', SOURCE_DATE_EPOCH=epoch), check=True)
    (work / 'SHA256SUMS').write_text(checksum(image) + '  ' + image.name + '\n')
    print(image)


if __name__ == '__main__':
    main()
