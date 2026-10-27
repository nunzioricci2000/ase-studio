#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-28: collect and verify exact frontend inputs and preferred editable sources.
"""Prepare dependency sources for redistribution; no binaries are compiled."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def digest(path, algorithm='sha256'):
    value = hashlib.new(algorithm)
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.digest()


def entries(root=ROOT):
    lock = json.loads((root / 'scripts/frontend-sources.lock.json').read_text())
    npm = json.loads((root / 'package-lock.json').read_text())['packages']
    records = [dict(record) for record in lock['archives']]
    for name, expected in [('monaco-editor', lock['monaco_version']), ('dompurify', lock['dompurify_version'])]:
        package = npm['node_modules/' + name]
        if package['version'] != expected:
            raise ValueError(f'Update and review preferred sources for {name} {package["version"]}')
        algorithm, integrity = package['integrity'].split('-', 1)
        if algorithm != 'sha512':
            raise ValueError(f'Unsupported npm integrity for {name}')
        records.append(dict(name=f'{name}-npm-input.tgz', url=package['resolved'],
                            sha512=base64.b64decode(integrity, validate=True).hex(),
                            required=['package.json', 'LICENSE']))
    for record in records:
        if Path(record['name']).name != record['name'] or not record['url'].startswith('https://'):
            raise ValueError('Invalid dependency source entry')
    return lock, records


def archive_file(path, suffix):
    with tarfile.open(path) as archive:
        matches = [item for item in archive.getmembers()
                   if item.isfile() and '/'.join(Path(item.name).parts[1:]) == suffix]
        if len(matches) != 1:
            raise ValueError(f'{path.name}: missing or ambiguous {suffix}')
        return archive.extractfile(matches[0]).read()


def verify(directory, root=ROOT):
    lock, records = entries(root)
    result = []
    for record in records:
        path = directory / record['name']
        algorithm = 'sha512' if 'sha512' in record else 'sha256'
        if digest(path, algorithm).hex() != record[algorithm]:
            raise ValueError(f'Incorrect dependency checksum: {path.name}')
        # Read without extracting any upstream archive or following its links.
        with tarfile.open(path) as archive:
            files = {'/'.join(Path(item.name).parts[1:]) for item in archive.getmembers() if item.isfile()}
        if not set(record['required']) <= files:
            raise ValueError(f'{path.name}: missing source/license files: {set(record["required"]) - files}')
        result.append(dict(name=path.name, url=record['url'], bytes=path.stat().st_size,
                           sha256=digest(path).hex()))
    metadata = json.loads(archive_file(directory / 'monaco-editor-npm-input.tgz', 'package.json'))
    if metadata.get('monacoCommitId') != lock['monaco_commit'] or metadata.get('vscodeCommitId') != lock['vscode_commit']:
        raise ValueError('Monaco package and preferred source revisions differ')
    font = archive_file(directory / 'codicons-source.tgz', 'dist/codicon.ttf')
    bundled = list((root / 'frontend/vendor').glob('codicon-*.ttf'))
    if len(bundled) != 1 or font != bundled[0].read_bytes():
        raise ValueError('Codicons preferred source package does not match the bundled font')
    marked = archive_file(directory / 'monaco-editor-npm-input.tgz', 'esm/vs/base/common/marked/marked.js')
    if b'marked v14.0.0' not in marked[:200]:
        raise ValueError('Review the preferred source version of embedded Marked')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    started = time.monotonic()
    timestamp = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
    _, records = entries()
    if not args.verify_only:
        args.output.mkdir(parents=True, exist_ok=True)
        for record in records:
            destination = args.output / record['name']
            if destination.exists():
                continue  # Verified below, including files restored from a cache.
            partial = destination.with_name(destination.name + '.partial')
            try:
                print('Downloading ' + record['name'], flush=True)
                with urllib.request.urlopen(record['url'], timeout=180) as response, partial.open('wb') as stream:
                    shutil.copyfileobj(response, stream, 1024 * 1024)
                algorithm = 'sha512' if 'sha512' in record else 'sha256'
                if digest(partial, algorithm).hex() != record[algorithm]:
                    raise ValueError(f'Incorrect download checksum: {destination.name}')
                partial.replace(destination)
            finally:
                partial.unlink(missing_ok=True)
    verified = verify(args.output)
    report = dict(started_at=timestamp, finished_at=datetime.now(timezone.utc).isoformat(timespec='milliseconds'),
                  wall_seconds=time.monotonic() - started, archives=verified)
    if not args.verify_only:
        (args.output / 'sources-manifest.json').write_text(json.dumps(report, indent=2) + '\n')
        (args.output / 'sources-manifest.json.license').write_text('SPDX-License-Identifier: GPL-2.0-only\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
