#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-11-01: remove unneeded host-tool symbols while preserving RISC-V objects and runtime components.
# Modified in the personal fork on 2026-11-01: share identical staged runtime libraries through hardlinks without removing their paths.
"""Run only on a staged copy; never modify verified SDK inputs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def deduplicate_libraries(appdir):
    seen, links = {}, []
    # These are private, read-only runtime libraries. Preserve every pathname,
    # byte and permission; hardlinks also avoid duplicate extraction/page cache.
    for path in sorted((appdir / 'usr/lib').rglob('*')):
        if path.is_symlink() or not path.is_file() or '.so' not in path.name:
            continue
        with path.open('rb') as stream:
            if stream.read(4) != b'\x7fELF':
                continue
        stat = path.stat()
        key = (stat.st_size, stat.st_mode & 0o7777, digest(path))
        first = seen.get(key)
        if first is None:
            seen[key] = path
            continue
        if first.stat().st_ino == stat.st_ino:
            continue
        temporary = path.with_name(path.name + '.dedup-tmp')
        try:
            os.link(first, temporary)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
        links.append({'path': str(path.relative_to(appdir)),
                      'shared_with': str(first.relative_to(appdir)),
                      'bytes': stat.st_size, 'sha256': key[2]})
    return links


def compact(appdir):
    changes = []
    # Only x86-64 executables/shared objects in the compiler toolchain qualify.
    # Target archives, objects, headers, debug support and licenses remain intact.
    for path in sorted((appdir / 'engine/toolchain').rglob('*')):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open('rb') as stream:
            header = stream.read(20)
        if len(header) != 20 or header[:6] != b'\x7fELF\x02\x01':
            continue
        kind, machine = struct.unpack_from('<HH', header, 16)
        if machine != 62 or kind not in (2, 3):
            continue
        sections = subprocess.check_output(['readelf', '-SW', str(path)], text=True)
        if '.symtab' not in sections:
            continue
        before, original = path.stat().st_size, digest(path)
        subprocess.run(['strip', '--strip-unneeded', str(path)], check=True)
        changes.append({'path': str(path.relative_to(appdir)), 'before': before,
                        'after': path.stat().st_size, 'original_sha256': original,
                        'sha256': digest(path)})
    links = deduplicate_libraries(appdir)
    report = {'operation': 'strip --strip-unneeded on x86-64 compiler tools only',
              'saved_uncompressed_bytes': sum(row['before'] - row['after'] for row in changes),
              'files': changes, 'identical_library_hardlinks': links,
              'saved_extracted_library_bytes': sum(row['bytes'] for row in links)}
    target = appdir / 'licenses/appimage-size-optimization.json'
    target.write_text(json.dumps(report, indent=2) + '\n')
    target.with_suffix('.json.license').write_text(
        'SPDX-License-Identifier: GPL-2.0-only\nCreated in the personal fork on 2026-11-01: document staged tool transformations.\n')
    target.chmod(0o644)
    target.with_suffix('.json.license').chmod(0o644)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('appdir', type=Path)
    args = parser.parse_args()
    print(json.dumps(compact(args.appdir.resolve()), indent=2))
