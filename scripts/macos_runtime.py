#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-30: isolate exact source-paired SDK libraries from Homebrew ABI changes.
"""Reuse pinned bottles; never compile or replace a shared Homebrew installation."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

LOCK = Path(__file__).with_name('macos-runtime.lock.json')


def checksum(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def records(target=None):
    items = json.loads(LOCK.read_text())['archives']
    if target:
        pairs = {(r['component'], r['version']) for r in items
                 if r.get('target') == target}
        if not pairs:
            raise ValueError('No pinned macOS libraries for ' + target)
        items = [r for r in items if r.get('target') == target or
                 ('target' not in r and (r['kind'] == 'notice' or
                  (r['component'], r['version']) in pairs))]
    return items


def verify(directory, target=None):
    result = []
    for record in records(target):
        path = directory / record['name']
        if path.is_symlink() or checksum(path) != record['sha256']:
            raise ValueError('Incorrect macOS dependency checksum: ' + path.name)
        result.append(dict(record, bytes=path.stat().st_size))
    return result


def fetch(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for record in records():
        path = directory / record['name']
        if path.exists():
            continue  # Cache contents are authenticated below.
        headers = {}
        if record['kind'] == 'bottle':
            url = ('https://ghcr.io/token?service=ghcr.io&scope=repository:homebrew/core/'
                   + record['component'] + ':pull')
            with urllib.request.urlopen(url, timeout=60) as response:
                headers['Authorization'] = 'Bearer ' + json.load(response)['token']
        request = urllib.request.Request(record['url'], headers=headers)
        partial = path.with_name(path.name + '.partial')
        try:
            with urllib.request.urlopen(request, timeout=180) as response, partial.open('wb') as stream:
                if not response.url.startswith('https://'):
                    raise ValueError('Insecure dependency redirect')
                shutil.copyfileobj(response, stream)
            if checksum(partial) != record['sha256']:
                raise ValueError('Incorrect download checksum: ' + path.name)
            partial.replace(path)
        finally:
            partial.unlink(missing_ok=True)
    return verify(directory)


def selected_files(path, predicate):
    # Read selected regular entries; never materialize archive links or directories.
    with tarfile.open(path) as archive:
        seen = set()
        for entry in archive:
            name = PurePosixPath(entry.name)
            if name.is_absolute() or '..' in name.parts or entry.name in seen:
                raise ValueError('Unsafe or duplicate dependency archive path')
            seen.add(entry.name)
            if entry.isfile() and predicate(name):
                yield name, archive.extractfile(entry).read()


def links(path):
    output = subprocess.check_output(['otool', '-L', str(path)], text=True)
    return [line.strip().split(' (', 1)[0] for line in output.splitlines()[1:]]


def closure(initial, libraries, inspect=links):
    wanted, pending = {}, list(initial)
    while pending:
        dependency = pending.pop()
        name = PurePosixPath(dependency).name
        if name in wanted:
            continue
        if name not in libraries:
            if dependency.startswith(('/usr/lib/', '/System/Library/')):
                continue
            raise ValueError('Unpinned private library dependency: ' + dependency)
        wanted[name] = libraries[name]
        pending.extend(dep for dep in inspect(libraries[name]) if PurePosixPath(dep).name != name)
    return wanted


def engine_libraries(executable, libraries, inspect=links):
    initial = [dep for dep in inspect(executable)
               if PurePosixPath(dep).name.startswith(('libprotobuf', 'libutf8_', 'libabsl_'))]
    if not any(PurePosixPath(dep).name.startswith('libprotobuf.') for dep in initial):
        raise ValueError('Pinned SDK no longer references the expected Protobuf ABI')
    return closure(initial, libraries, inspect)


def stage(engine, directory, target):
    inputs = verify(directory, target)
    notices = engine / 'licenses/macos-runtime'
    notices.mkdir(parents=True)
    with tempfile.TemporaryDirectory(prefix='ase-private-libraries-') as temporary:
        libraries = {}
        for record in inputs:
            path = directory / record['name']
            if record['kind'] == 'bottle':
                for name, data in selected_files(path, lambda p: len(p.parts) == 4 and p.parts[2] == 'lib' and p.suffix == '.dylib'):
                    if name.name in libraries:
                        raise ValueError('Duplicate library in pinned bottles')
                    library = Path(temporary) / name.name
                    library.write_bytes(data)
                    libraries[name.name] = library
            elif record['kind'] == 'source':
                found = False
                for name, data in selected_files(path, lambda p: p.name.upper() in ('LICENSE', 'LICENSE.TXT', 'NOTICE', 'COPYING')):
                    (notices / ('__'.join(name.parts))).write_bytes(data)
                    found = True
                if not found:
                    raise ValueError('Missing dependency notices')
            elif record['kind'] == 'notice':
                shutil.copy2(path, notices / path.name)
        chosen = engine_libraries(engine / 'gem5/bin/gem5.opt', libraries)
        installed = {}
        for name, source in sorted(chosen.items()):
            destination = engine / 'python/lib' / name
            if destination.exists():
                raise ValueError('Refusing to replace an SDK library: ' + name)
            shutil.copy2(source, destination)
            arguments = ['install_name_tool', '-id', '@rpath/' + name]
            for dep in links(source):
                dep_name = PurePosixPath(dep).name
                if dep_name in chosen and dep_name != name:
                    arguments.extend(['-change', dep, '@loader_path/' + dep_name])
            subprocess.run([*arguments, str(destination)], check=True)
            subprocess.run(['codesign', '--force', '--sign', '-', str(destination)], check=True)
            installed[name] = dict(original_sha256=checksum(source), sha256=checksum(destination))
        (notices / 'MODIFICATIONS.txt').write_text(
            'Modified in the personal fork on 2026-10-30: dylib load commands relocated '
            'to adjacent private libraries and ad-hoc signatures renewed. No library code rebuilt.\n'
            'Protobuf (BSD-3-Clause), utf8_range (MIT) and Abseil (Apache-2.0) retain their '
            'own licenses. They are linked by the separate BSD gem5 executable, not by GPL Studio.\n'
            'Exact sources, original bottles and Homebrew build recipes are supplied in the '
            'matching Studio source archive, under sources/dependencies.\n')
        manifest = dict(target=target, inputs=inputs, libraries=installed)
        (notices / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        (notices / 'manifest.json.license').write_text('SPDX-License-Identifier: GPL-2.0-only\n')
        return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(fetch(args.output), indent=2))
