# Modified in the personal fork on 2026-10-30: cover signed Abate update metadata and runtime dependencies.
# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-10-30: verify minimal runtime contents and conservative SDK trimming.
# Modified in the personal fork on 2026-10-30: check assistant exclusions in Git and supplied-source packaging through real archives.
# Created in the personal fork on 2026-10-28: verify source export, logo omission and safe SDK extraction.
import importlib.util
import io
import json
from pathlib import Path
import sys
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('studio_package', ROOT / 'scripts/package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class DistributionTests(unittest.TestCase):
    def test_assistant_context_is_absent_from_runtime_sources_and_manifests(self):
        for supplied in (False, True):
            with self.subTest(supplied=supplied), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / 'source'
                kept = {'frontend/index.html': '<head></head>', 'LICENSE': 'license text',
                        'scripts/build.py': '# build recipe', 'frontend/vendor/editor.js.LEGAL.txt': 'notice',
                        '.github/workflows/ci.yml': '# build workflow'}
                omitted = ['AGENTS.md', 'nested/AGENTS.md', 'CLAUDE.md', '.codex/config.toml',
                           '.agents/skills/example/SKILL.md', '.cursor/rules/example.mdc',
                           '.github/copilot-instructions.md', '.github/prompts/review.prompt.md']
                for name, content in {**kept, **dict.fromkeys(omitted, 'internal instructions')}.items():
                    path = source / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(content)
                names = list(kept) + omitted
                if supplied:
                    (source / '.source-files.json').write_text(json.dumps(dict(
                        git_sha='fixture', files={name: package.checksum(source / name) for name in names})))
                else:
                    subprocess.run(['git', 'init', '-q', str(source)], check=True)
                    subprocess.run(['git', '-C', str(source), 'add', '.'], check=True)
                self.assertEqual(set(package.source_files(source)), set(kept))
                metadata = dict(git_sha='fixture', dirty=False,
                                files={name: package.checksum(source / name) for name in package.source_files(source)})
                for release in (False, True):
                    destination = root / ('runtime' if release else 'preferred')
                    package.export_code(destination, metadata, release=release, root=source)
                    archive = root / (destination.name + '.tar.gz')
                    package.make_archive(archive, [(destination, 'project')])
                    with tarfile.open(archive) as stream:
                        entries = set(stream.getnames())
                        self.assertTrue(all('project/' + name in entries for name in kept))
                        self.assertTrue(all('project/' + name not in entries for name in omitted))
                        exported = json.load(stream.extractfile('project/.source-files.json'))
                        self.assertEqual(set(exported['files']), set(kept))
                    self.assertEqual(set(package.source_files(destination)), set(kept))

    def test_runtime_allowlist_excludes_build_inputs_and_keeps_vendor_notices(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            names = sorted(set(package.source_files()) | package.RUNTIME_FILES)
            metadata = dict(files=dict.fromkeys(names, 'fixture'))
            package.export_runtime(root / 'runtime', metadata)
            package.export_code(root / 'sources', metadata)
            package.make_archive(root / 'runtime.tar.gz', [(root / 'runtime', 'runtime')])
            with tarfile.open(root / 'runtime.tar.gz') as stream:
                files = {m.name.removeprefix('runtime/') for m in stream if m.isfile()}
            self.assertTrue(package.RUNTIME_FILES <= files)
            self.assertIn('frontend/vendor/MONACO-LICENSE.txt', files)
            self.assertIn('frontend/vendor/DOMPURIFY-LICENSE-MPL.txt', files)
            self.assertIn('frontend/vendor/editor.js.LEGAL.txt', files)
            self.assertFalse(any(n.startswith(('tests/', '.github/', 'frontend/editor/')) for n in files))
            self.assertEqual({n for n in files if n.startswith('scripts/')}, {'scripts/portable-demo.mk', 'scripts/release_install.py'})
            self.assertNotIn('package.json', files)
            self.assertIn('FORK.json.license', files)
            self.assertIn('versioning.py', files)
            self.assertNotIn('.source-files.json', files)
            self.assertTrue((root / 'sources/tests/test_distribution.py').is_file())
            self.assertTrue((root / 'sources/frontend/editor/editor.js').is_file())
            self.assertTrue((root / 'sources/scripts/build-editor.mjs').is_file())
            self.assertEqual((root / 'runtime/LICENSE').read_bytes(), (ROOT / 'LICENSE').read_bytes())

    def test_engine_trim_preserves_libraries_configs_and_all_notices(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            kept = ('licenses/python/LICENSE', 'toolchain/lib/libgcc.a', 'python/lib/libpython3.10.so',
                    'configs/riscv_in_order_hen_patt.py', 'gem5/configs/common.py',
                    'runtime-links.txt', 'packages.txt', 'manifest.json')
            removed = ('tests/package.py', 'environment.json', 'runtime-compaction.json')
            for name in (*kept, *removed):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(name)
            package.trim_engine(root)
            for name in kept:
                self.assertEqual((root / name).read_text(), name)
            for name in removed:
                self.assertFalse((root / name).exists())

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
