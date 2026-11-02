#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-31: fetch immutable AppImage inputs and authenticate the embedded runtime.
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def fetch(row, directory):
    name = row['name']
    if Path(name).name != name or not row['url'].startswith('https://'):
        raise ValueError('Invalid input path or URL')
    destination = directory / name
    def valid(path):
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        return digest.hexdigest() == row['sha256']
    if destination.exists():
        if not valid(destination):
            raise ValueError('Cached checksum mismatch: ' + name)
        return
    with tempfile.NamedTemporaryFile(dir=directory, delete=False) as temporary:
        path = Path(temporary.name)
        try:
            with urllib.request.urlopen(row['url'], timeout=120) as response:
                while block := response.read(1024 * 1024):
                    temporary.write(block)
            temporary.close()
            if not valid(path):
                raise ValueError('Checksum mismatch: ' + name)
            path.replace(destination)
        finally:
            path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    config = ROOT / 'packaging/appimage'
    tools = json.loads((config / 'tools.lock.json').read_text())
    packages = json.loads((config / 'ubuntu-runtime.lock.json').read_text())
    for name, rows in (('tools', tools['artifacts']), ('debs', packages['packages'])):
        directory = args.output.resolve() / name
        directory.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(lambda row: fetch(row, directory), rows))
    directory = args.output.resolve() / 'tools'
    with tempfile.TemporaryDirectory(prefix='ase-runtime-key-') as temporary:
        subprocess.run(['gpg', '--homedir', temporary, '--batch', '--import',
                        str(directory / 'signing-pubkey.asc')], check=True)
        status = subprocess.check_output(['gpg', '--homedir', temporary, '--batch', '--status-fd=1',
            '--verify', str(directory / 'runtime-x86_64.sig'), str(directory / 'runtime-x86_64')], text=True)
        if '[GNUPG:] VALIDSIG ' + tools['runtime_signer'] + ' ' not in status:
            raise ValueError('Unexpected runtime signature identity')
    print('All AppImage inputs and the upstream runtime signature verified')


if __name__ == '__main__':
    main()
