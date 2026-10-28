#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-28: download pinned public SDK assets with timestamps and verified provenance.
"""Consume existing engines; this script never compiles a component."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import time
import urllib.request

from check import utc

ROOT = Path(__file__).resolve().parents[1]


def targets(selection):
    available = json.loads((ROOT / 'scripts/engine-sdks.lock.json').read_text())['targets']
    names = {item['id'] for item in available} if selection == 'all' else set(selection.split(','))
    if not names or names - {item['id'] for item in available}:
        raise ValueError('Select only verified targets listed in scripts/engine-sdks.lock.json')
    return [item for item in available if item['id'] in names]


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def download(url, path, sha256):
    if path.exists():
        if digest(path) != sha256:
            raise ValueError(f'Cached SDK checksum mismatch: {path.name}')
        return 'cached'
    partial = path.with_name(path.name + '.partial')
    try:
        with urllib.request.urlopen(url, timeout=180) as response, partial.open('wb') as stream:
            shutil.copyfileobj(response, stream, 1024 * 1024)
        if digest(partial) != sha256:
            raise ValueError(f'SDK checksum mismatch: {path.name}')
        partial.replace(path)
        return 'downloaded'
    finally:
        partial.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--matrix')
    parser.add_argument('--target')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.matrix is not None:
        print(json.dumps(dict(include=targets(args.matrix))))
        return
    if not args.target or not args.output:
        parser.error('Supply --target and --output, or --matrix')
    records = targets(args.target)
    if len(records) != 1:
        parser.error('Download one target at a time')
    record = records[0]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = dict(started_at=utc(), status='running', target=args.target, transfers=[])
    started = time.monotonic()
    def transfer(name, destination, sha256):
        if Path(name).name != name or not re.fullmatch(r'[0-9a-f]{64}', sha256):
            raise ValueError('Invalid SDK asset metadata')
        begin = time.monotonic()
        item = dict(name=name, started_at=utc())
        state = download(record['base_url'] + name, output / destination, sha256)
        item.update(finished_at=utc(), wall_seconds=time.monotonic() - begin,
                    bytes=(output / destination).stat().st_size, sha256=sha256, status=state)
        report['transfers'].append(item)
    try:
        transfer(record['report_name'], 'report.json', record['report_sha256'])
        engine = json.loads((output / 'report.json').read_text())
        if engine.get('status') != 'succeeded' or engine['target']['id'] != args.target or engine['git_sha'] != record['engine_git_sha']:
            raise ValueError('The SDK report does not match the pinned successful engine build')
        artifacts = {item['name']: item for item in engine['artifacts']}
        for suffix in ('', '-sources'):
            name = f'ase-engine-{args.target}{suffix}.tar.gz'
            transfer(name, name, artifacts[name]['sha256'])
            if (output / name).stat().st_size != artifacts[name]['bytes']:
                raise ValueError('SDK size mismatch')
        report['status'] = 'succeeded'
    except Exception as error:
        report.update(status='failed', error=str(error))
        raise
    finally:
        report.update(finished_at=utc(), wall_seconds=time.monotonic() - started)
        (output / 'fetch-report.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
