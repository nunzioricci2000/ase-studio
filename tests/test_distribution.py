# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-28: verify source export, logo omission and safe SDK extraction.
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('studio_package', ROOT / 'scripts/package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class DistributionTests(unittest.TestCase):
    def test_release_omits_logo_files_but_preserves_attribution_and_preferred_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            (source / 'frontend').mkdir(parents=True)
            index = (ROOT / 'frontend/index.html').read_text()
            (source / 'frontend/index.html').write_text(index)
            (source / 'frontend/icon.png').write_bytes(b'unverified logo')
            names = {'frontend/index.html': 'unused', 'frontend/icon.png': 'unused'}
            (source / '.source-files.json').write_text(json.dumps(dict(git_sha='source-archive', files=names)))
            metadata = package.provenance(source)
            self.assertNotIn('frontend/icon.png', metadata['files'])
            package.export_code(root / 'runtime', metadata, release=True, root=source)
            package.export_code(root / 'preferred', metadata, root=source)
            self.assertFalse((root / 'runtime/frontend/icon.png').exists())
            released = (root / 'runtime/frontend/index.html').read_text()
            self.assertNotIn('src="ase_light.png"', released)
            self.assertIn('Behnam Farnaghinejad', released)
            self.assertIn('Antonio Porsia', released)
            self.assertIn('https://www.polito.it/', released)
            self.assertIn('>Politecnico di Torino</a>', released)
            self.assertIn('SPDX-FileCopyrightText:', released)
            self.assertEqual((root / 'preferred/frontend/index.html').read_text(), index)
            self.assertEqual(package.source_files(root / 'preferred'), ['frontend/index.html'])

    def test_sdk_rejects_escaping_links_before_extracting_any_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'sdk.tar.gz'
            with tarfile.open(archive, 'w:gz') as stream:
                valid = tarfile.TarInfo('ase-engine-test/bin/tool')
                valid.size = 2
                stream.addfile(valid, io.BytesIO(b'ok'))
                unsafe = tarfile.TarInfo('ase-engine-test/bad')
                unsafe.type, unsafe.linkname = tarfile.SYMTYPE, '../../outside'
                stream.addfile(unsafe)
            with self.assertRaisesRegex(ValueError, 'escapes'):
                package.unpack_sdk(archive, root / 'output', 'test')
            self.assertFalse((root / 'output').exists())

    def test_sdk_preserves_relative_links_and_executable_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'sdk.tar.gz'
            with tarfile.open(archive, 'w:gz') as stream:
                item = tarfile.TarInfo('ase-engine-test/bin/tool')
                item.size, item.mode = 2, 0o755
                stream.addfile(item, io.BytesIO(b'ok'))
                link = tarfile.TarInfo('ase-engine-test/bin/alias')
                link.type, link.linkname = tarfile.SYMTYPE, 'tool'
                stream.addfile(link)
            engine = package.unpack_sdk(archive, root / 'output', 'test')
            self.assertEqual((engine / 'bin/alias').read_bytes(), b'ok')
            self.assertTrue((engine / 'bin/alias').is_symlink())
            self.assertTrue((engine / 'bin/tool').stat().st_mode & 0o111)


if __name__ == '__main__':
    unittest.main()
