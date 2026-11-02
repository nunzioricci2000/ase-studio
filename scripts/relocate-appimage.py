#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-11-02: relocate pinned WebKit helper paths without disabling its sandbox.
"""Record exact build transformations; upstream library sources remain supplied."""
import argparse
import hashlib
import json
from pathlib import Path


def relocate(app):
    records = []
    paths = (
        '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1',
        '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/injected-bundle/',
        '/usr/bin/bwrap',
        '/usr/bin/xdg-dbus-proxy',
    )
    libraries = sorted((app / 'usr/lib/x86_64-linux-gnu').glob('libwebkit2gtk-4.1.so.*'))
    if not libraries:
        raise ValueError('Missing pinned WebKit library')
    for library in libraries:
        original = library.read_bytes()
        changed = original
        for path in paths:
            old = path.encode() + b'\0'
            if changed.count(old) != 1:
                raise ValueError('Unexpected WebKit path layout: ' + path)
            # Preserve every ELF offset. Native startup sets cwd to the AppDir;
            # native.py explicitly binds that directory read-only in the sandbox.
            # Change only the first byte: pooled suffix strings keep their
            # original offsets too. .usr is a bundle-local alias for usr.
            new = b'.' + old[1:]
            changed = changed.replace(old, new)
        temporary = library.with_name(library.name + '.relocated')
        temporary.write_bytes(changed)
        temporary.chmod(library.stat().st_mode & 0o777)
        temporary.replace(library)
        records.append({'path': str(library.relative_to(app)),
                        'original_sha256': hashlib.sha256(original).hexdigest(),
                        'sha256': hashlib.sha256(changed).hexdigest(),
                        'absolute_paths_made_relative': paths})
    (app / '.usr').symlink_to('usr', target_is_directory=True)
    report = app / 'licenses/appimage-webkit-relocation.json'
    report.write_text(json.dumps(records, indent=2) + '\n')
    report.with_name(report.name + '.license').write_text(
        'SPDX-License-Identifier: GPL-2.0-only\n'
        'Created in the personal fork on 2026-11-02: record staged WebKit path relocation.\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('appdir', type=Path)
    relocate(parser.parse_args().appdir)
