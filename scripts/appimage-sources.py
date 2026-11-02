#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-31: retain exact distro sources authenticated by APT's signed source indexes.
"""Resolve inside the build container; download with normal TLS verification."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import tempfile
import urllib.request


def inputs(text):
    rows = {}
    for line in text.splitlines():
        if not line.startswith("'"):
            continue
        url, name, size, digest = shlex.split(line)
        algorithm, value = digest.split(':', 1)
        if algorithm not in ('SHA256', 'SHA512') or Path(name).name != name:
            raise ValueError('Invalid source metadata or weak source hash')
        if url.startswith('http://'):
            url = 'https://' + url[7:]
        if not url.startswith('https://'):
            raise ValueError('Source download must use HTTPS')
        row = dict(url=url, name=name, bytes=int(size), algorithm=algorithm.lower(), digest=value)
        if name in rows and rows[name] != row:
            raise ValueError('Conflicting source inputs for ' + name)
        rows[name] = row
    if not rows:
        raise ValueError('APT did not resolve any source archives')
    return list(rows.values())


def transfer(row, output):
    destination = output / row['name']
    def valid(path):
        value = hashlib.new(row['algorithm'])
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                value.update(block)
        return path.stat().st_size == row['bytes'] and value.hexdigest() == row['digest']
    if destination.exists():
        if not valid(destination):
            raise ValueError('Cached source checksum mismatch: ' + row['name'])
        return
    with tempfile.NamedTemporaryFile(dir=output, prefix='.download-', delete=False) as temporary:
        path = Path(temporary.name)
        try:
            with urllib.request.urlopen(row['url'], timeout=120) as response:
                while block := response.read(1024 * 1024):
                    temporary.write(block)
            temporary.close()
            if not valid(path):
                raise ValueError('Source checksum mismatch: ' + row['name'])
            path.replace(destination)
        finally:
            path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--packages', type=Path)
    parser.add_argument('--resolved', type=Path, help='Previously saved APT --print-uris output')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--resolve-only', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.resolved:
        text = args.resolved.read_text()
    elif args.packages:
        packages = json.loads(args.packages.read_text())
        specs = sorted({row['source'] + '=' + row['source_version'] for row in packages})
        text = subprocess.check_output(['apt-get', '--print-uris', '--download-only', 'source', *specs], text=True)
    else:
        parser.error('Supply --packages inside the build container or --resolved')
    (args.output / 'apt-source-inputs.txt').write_text(text)
    rows = inputs(text)
    (args.output / 'source-inputs.json').write_text(json.dumps(rows, indent=2) + '\n')
    if args.resolve_only:
        return 0
    errors = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(transfer, row, args.output): row['name'] for row in rows}
        for number, future in enumerate(as_completed(futures), 1):
            try:
                future.result()
            except Exception as error:
                errors.append({'name': futures[future], 'error': str(error)})
            if number % 25 == 0 or number == len(rows):
                print(f'{number}/{len(rows)} source archives checked', flush=True)
    (args.output / 'source-report.json').write_text(json.dumps(
        {'status': 'failed' if errors else 'succeeded', 'count': len(rows), 'errors': errors}, indent=2) + '\n')
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
