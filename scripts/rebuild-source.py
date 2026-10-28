#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-28: rebuild and test the distributed Studio source archive without a Git checkout.
"""Exercise the published source instructions on the matching host platform."""
import argparse
import json
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import tempfile

from check import Report
from package import checksum


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package-output', type=Path, required=True)
    parser.add_argument('--sdk-artifact', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    original = json.loads((args.package_output / 'report.json').read_text())
    report = Report(args.output.resolve(), 'source-archive-rebuild', revision=original['git_sha'])
    try:
        if original['status'] != 'succeeded' or original['studio_source_dirty']:
            raise ValueError('Rebuild a successful package from clean sources')
        name = f'ase-studio-nunzio-{original["target"]["id"]}-sources.tar.gz'
        entry = next(item for item in original['artifacts'] if item['name'] == name)
        archive = args.package_output / name
        if archive.stat().st_size != entry['bytes'] or checksum(archive) != entry['sha256']:
            raise ValueError('Studio source archive checksum mismatch')
        report.data['source_archive'] = entry
        with tempfile.TemporaryDirectory(prefix='ase-source-rebuild-') as directory:
            work = Path(directory)
            with tarfile.open(archive) as stream:
                members = stream.getmembers()
                for member in members:
                    path = PurePosixPath(member.name)
                    if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != 'sources':
                        raise ValueError('Unsafe source archive path')
                    if not (member.isfile() or member.isdir()):
                        raise ValueError('Unexpected linked or special source entry')
                stream.extractall(work, members=members)
            project = work / 'sources/project'
            metadata = json.loads((project / '.source-files.json').read_text())
            if (project / '.git').exists() or metadata['git_sha'] != original['git_sha'] or metadata['dirty']:
                raise ValueError('Source revision differs from the original package')
            for name, expected in metadata['files'].items():
                path = project / name
                if not path.resolve().is_relative_to(project.resolve()) or checksum(path) != expected:
                    raise ValueError(f'Source manifest mismatch: {name}')
            rebuilt = work / 'rebuilt'
            try:
                report.run('rebuild-and-test', [sys.executable, str(project / 'scripts/package.py'),
                    '--sdk-artifact', str(args.sdk_artifact.resolve()),
                    '--dependency-sources', str(work / 'sources/dependencies'), '--output', str(rebuilt)])
                result = json.loads((rebuilt / 'report.json').read_text())
                if result['status'] != 'succeeded' or result['studio_source_dirty'] or result['git_sha'] != original['git_sha']:
                    raise ValueError('Source rebuild did not reproduce a clean, tested application')
                report.data.update(target=result['target'], source_files_verified=len(metadata['files']))
            finally:
                # Keep diagnostics, not a second copy of all binary/source archives.
                for path in rebuilt.rglob('*'):
                    if path.is_file() and path.suffix in ('.json', '.log', '.md', '.license'):
                        destination = args.output / 'verification' / path.relative_to(rebuilt)
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(path, destination)
        report.finish('succeeded')
    except Exception as error:
        report.finish('failed', error)
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
