# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-30: verify pinned-library selection, archive safety and ABI failures.
import io
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import macos_runtime as runtime


class MacRuntimeTests(unittest.TestCase):
    def test_each_target_has_exact_bottles_sources_and_recipes(self):
        for target, version in [('macos-15-arm64', '36.1'), ('macos-15-x86_64', '36.0')]:
            records = runtime.records(target)
            bottles = [r for r in records if r['kind'] == 'bottle']
            self.assertEqual(len(bottles), 2)
            self.assertEqual(next(r['version'] for r in bottles if r['component'] == 'protobuf'), version)
            for bottle in bottles:
                for kind in ('source', 'recipe'):
                    self.assertTrue(any(r['kind'] == kind and r.get('component') == bottle['component']
                                        and r.get('version') == bottle['version'] for r in records))
        with self.assertRaises(ValueError):
            runtime.records('macos-16-arm64')

    def test_dependency_closure_omits_unused_tools_and_rejects_new_abi(self):
        libraries = {n: Path(n) for n in ('libprotobuf.36.1.dylib', 'libabsl.dylib', 'libprotoc.dylib')}
        dependencies = {'libprotobuf.36.1.dylib': ['@rpath/libabsl.dylib'],
                        'libabsl.dylib': ['@rpath/libabsl.dylib', '/usr/lib/libSystem.B.dylib']}
        selected = runtime.closure(['/opt/homebrew/lib/libprotobuf.36.1.dylib'], libraries,
                                   lambda p: dependencies[p.name])
        self.assertEqual(set(selected), {'libprotobuf.36.1.dylib', 'libabsl.dylib'})
        with self.assertRaisesRegex(ValueError, 'Unpinned'):
            runtime.closure(['/opt/homebrew/lib/libprotobuf.36.2.dylib'], libraries)

    def test_archive_paths_and_links_are_not_materialized(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'bottle.tar.gz'
            with tarfile.open(archive, 'w:gz') as stream:
                item = tarfile.TarInfo('library/1/lib/a.dylib'); item.size = 3
                stream.addfile(item, io.BytesIO(b'abc'))
                link = tarfile.TarInfo('library/1/lib/link.dylib')
                link.type = tarfile.SYMTYPE; link.linkname = '/etc/passwd'; stream.addfile(link)
            self.assertEqual(list(runtime.selected_files(archive, lambda p: True)),
                             [(Path('library/1/lib/a.dylib'), b'abc')])
            with tarfile.open(archive, 'w:gz') as stream:
                item = tarfile.TarInfo('../outside'); stream.addfile(item, io.BytesIO())
            with self.assertRaises(ValueError):
                list(runtime.selected_files(archive, lambda p: True))

    def test_cached_bytes_are_verified_before_use(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'bottle').write_bytes(b'corrupt')
            with patch.object(runtime, 'records', return_value=[dict(name='bottle', sha256='0' * 64)]):
                with self.assertRaisesRegex(ValueError, 'checksum'):
                    runtime.verify(root)
