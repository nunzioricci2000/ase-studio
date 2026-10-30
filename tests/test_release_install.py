# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-10-30: distinguish a user-selected pin from the Windows bootstrap's resolved latest tag.
# Modified in the personal fork on 2026-10-30: verify independent upstream, codename and revision identities end to end.
# Created in the personal fork on 2026-10-30: test transactional release installation, security checks and recovery without touching user data.
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import release_install as installer


class InstallerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='ase installer tests ')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name)
        self.home = self.work / 'User Home $ ` with spaces'
        self.home.mkdir()
        self.environment = patch.dict(os.environ, XDG_DATA_HOME=str(self.home / 'Custom Data'))
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.install = installer.Installation(self.home, macos=False)
        self.install.initialize()
        self.target = 'ubuntu-24.04-x86_64'
        self.counter = 0

    def payload(self, version='v1.6.0-abate.1'):
        self.counter += 1
        payload = self.work / ('payload-' + str(self.counter))
        (payload / 'ase_studio').mkdir(parents=True)
        identity = installer.parse_release_tag(version)
        (payload / 'manifest.json').write_text(json.dumps(dict(target=self.target, release_tag=version)))
        (payload / 'ase_studio/VERSION').write_text(identity['upstream_version'])
        (payload / 'ase_studio/FORK.json').write_text(json.dumps(dict(name=identity['codename'].capitalize(), revision=identity['fork_revision'], sequence=identity['fork_revision'])))
        executable = payload / 'ase-studio'
        executable.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
        executable.chmod(0o755)
        return payload

    def activate(self, version='v1.6.0-abate.1', check=lambda *_: None):
        return self.install.install(self.payload(version), self.target, version, check=check)

    def test_install_reinstall_update_uninstall_preserve_data_and_run_quoted_launcher(self):
        data = self.home / 'Custom Data/ase-studio-nunzio/programs'
        data.mkdir(parents=True)
        (data / 'main.s').write_text('user code')
        for version in ('v1.6.0-abate.1', 'v1.6.0-abate.1', 'v1.6.0-abate.2'):
            self.activate(version)
            result = subprocess.check_output([str(self.install.launcher), 'argument with spaces', '$literal'], text=True)
            self.assertEqual(result, 'argument with spaces\n$literal\n')
            self.assertEqual(self.install.active()[1]['version'], version)
            self.assertTrue(self.install.desktop.is_file())
        self.install.uninstall()
        self.install.uninstall()
        self.assertFalse(self.install.launcher.exists())
        self.assertFalse(self.install.desktop.exists())
        self.assertFalse(self.install.current.exists())
        self.assertEqual((data / 'main.s').read_text(), 'user code')
        self.assertEqual(list(self.install.root.glob('version-*')), [])

    def test_failed_update_and_interrupted_check_keep_previous_version(self):
        original = self.activate()
        for error in (RuntimeError('startup failed'), KeyboardInterrupt()):
            with self.assertRaises(type(error)):
                self.activate('v1.6.0-abate.2', check=lambda *_: (_ for _ in ()).throw(error))
            self.assertEqual(self.install.current.resolve(), original)
            self.assertEqual(len(list(self.install.root.glob('version-*'))), 1)

    def test_failed_activation_rolls_back_new_external_files(self):
        with patch.object(Path, 'replace', side_effect=OSError('activation failed')):
            with self.assertRaises(OSError):
                self.activate()
        self.assertFalse(self.install.current.exists())
        self.assertFalse(self.install.launcher.exists())
        self.assertFalse(self.install.desktop.exists())

    def test_unmanaged_and_modified_launchers_are_preserved(self):
        self.install.launcher.parent.mkdir(parents=True)
        self.install.launcher.write_text('user launcher')
        with self.assertRaisesRegex(ValueError, 'unmanaged'):
            self.activate()
        self.install.uninstall()
        self.assertEqual(self.install.launcher.read_text(), 'user launcher')
        self.install.launcher.unlink()
        self.activate()
        self.install.desktop.write_text('user edits')
        with self.assertRaisesRegex(ValueError, 'modified'):
            self.activate('v1.6.0-abate.2')
        self.install.uninstall()
        self.assertEqual(self.install.desktop.read_text(), 'user edits')

    def test_unmanaged_installation_directory_is_refused(self):
        (self.install.root / '.owner').write_text('someone else')
        with self.assertRaisesRegex(ValueError, 'not managed'):
            self.install.initialize()

    def test_lock_excludes_concurrent_process_and_releases_after_failure(self):
        with self.install.lock():
            code = ('import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); '
                    'from release_install import Installation; i=Installation(Path(sys.argv[2]), macos=False); '
                    '\nwith i.lock(): pass')
            result = subprocess.run([sys.executable, '-c', code, str(ROOT / 'scripts'), str(self.home)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Another ASE Studio installer', result.stderr)
        with self.install.lock():
            pass

    def test_wrong_version_and_target_do_not_activate(self):
        with self.assertRaisesRegex(ValueError, 'version'):
            self.install.install(self.payload(), self.target, 'v1.6.0-abate.2', check=lambda *_: None)
        with self.assertRaisesRegex(ValueError, 'target'):
            self.install.install(self.payload(), 'arch-x86_64', 'v1.6.0-abate.1', check=lambda *_: None)
        self.assertFalse(self.install.current.exists())

    def test_wrong_codename_or_revision_is_rejected_even_with_same_upstream(self):
        for tag in ('v1.6.0-borgo.1', 'v1.6.0-abate.2'):
            with self.subTest(tag=tag), self.assertRaisesRegex(ValueError, 'version'):
                self.install.install(self.payload(), self.target, tag, check=lambda *_: None)
        payload = self.payload()
        (payload / 'ase_studio/FORK.json').write_text('{"name":"Abate","revision":2,"sequence":2}')
        with self.assertRaisesRegex(ValueError, 'version'):
            self.install.install(payload, self.target, 'v1.6.0-abate.1', check=lambda *_: None)
        self.assertFalse(self.install.current.exists())

    def test_macos_entries_and_uninstall_preserve_unmanaged_app(self):
        mac = installer.Installation(self.home, macos=True)
        mac.initialize()
        app = self.home / 'Applications' / installer.APP
        app.mkdir()
        (app / 'user-file').write_text('mine')
        mac.uninstall()
        self.assertEqual((app / 'user-file').read_text(), 'mine')

    def test_archive_rejects_paths_special_files_and_link_chains_before_writes(self):
        root = 'ase-studio-nunzio-' + self.target
        attacks = [('../outside', tarfile.REGTYPE, ''),
                   ('/tmp/absolute', tarfile.REGTYPE, ''),
                   (root + '/device', tarfile.CHRTYPE, ''),
                   (root + '/link', tarfile.SYMTYPE, '../../outside'),
                   (root + '/link', tarfile.LNKTYPE, root + '/missing')]
        for index, (name, kind, link) in enumerate(attacks):
            archive = self.work / f'attack-{index}.tar.gz'
            with tarfile.open(archive, 'w:gz') as stream:
                member = tarfile.TarInfo(name)
                member.type, member.linkname = kind, link
                stream.addfile(member)
            output = self.work / f'extract-{index}'
            with self.assertRaises(ValueError):
                installer.extract_runtime(archive, output, self.target)
            self.assertFalse(output.exists())
        with self.assertRaisesRegex(ValueError, 'linked directory'):
            installer.validate_members([(root + '/dir', 'symlink', '.'),
                                        (root + '/dir/file', 'file', '')], root)

    def test_archive_rejects_link_dotdot_escape_and_macos_case_collisions(self):
        root = 'ase-studio-nunzio-' + self.target
        with self.assertRaisesRegex(ValueError, 'linked directory'):
            installer.validate_members([(root + '/dir/alias', 'symlink', '..'),
                                        (root + '/escape', 'symlink', 'dir/alias/../outside')], root)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            installer.validate_members([(root + '/File', 'file', ''),
                                        (root + '/file', 'file', '')], root, casefold=True)

    def test_valid_archive_preserves_links_and_executable_mode(self):
        archive = self.work / 'runtime.tar.gz'
        root = 'ase-studio-nunzio-' + self.target
        with tarfile.open(archive, 'w:gz') as stream:
            member = tarfile.TarInfo(root + '/bin/run')
            member.mode, member.size = 0o755, 2
            stream.addfile(member, io.BytesIO(b'ok'))
            link = tarfile.TarInfo(root + '/bin/alias')
            link.type, link.linkname = tarfile.SYMTYPE, 'run'
            stream.addfile(link)
        result = installer.extract_runtime(archive, self.work / 'extracted', self.target)
        self.assertEqual((result / 'bin/alias').read_bytes(), b'ok')
        self.assertTrue((result / 'bin/run').stat().st_mode & 0o111)

    def test_checksum_mismatch_and_duplicate_entries(self):
        path = self.work / 'asset'
        path.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            installer.verify(path, '0' * 64)
        path.write_text(('0' * 64 + '  asset\n') * 2)
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            installer.checksums(path)

    def test_partial_download_is_removed_and_existing_file_preserved(self):
        path = self.work / 'asset'
        path.write_text('previous')
        response = io.BytesIO(b'short')
        response.headers = {'Content-Length': '100'}
        with patch.object(installer, 'build_opener') as opener:
            opener.return_value.open.return_value = response
            with self.assertRaisesRegex(ValueError, 'Interrupted'):
                installer.fetch('https://example.org/asset', path)
        self.assertEqual(path.read_text(), 'previous')
        self.assertFalse(path.with_name('asset.partial').exists())
        with self.assertRaisesRegex(ValueError, 'HTTPS'):
            installer.fetch('http://example.org/asset', path)

    def test_declined_dependencies_never_execute_package_manager(self):
        with patch('builtins.open', side_effect=OSError('no tty')), patch.object(installer, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'declined'):
                installer.confirm([['sudo', 'apt-get', 'install', 'make']])
            run.assert_not_called()

    def test_release_pair_and_same_release_checks(self):
        tag = 'v1.6.0-abate.1'
        base = f'https://github.com/{installer.REPOSITORY}/releases/download/{tag}/'
        runtime = f'ase-studio-nunzio-{self.target}.tar.gz'
        sources = [f'ase-studio-nunzio-{self.target}-sources.tar.gz', f'ase-engine-{self.target}-sources.tar.gz']
        data = {name: b'archive' for name in [runtime, *sources]}
        record = lambda name: dict(name=name, bytes=len(data[name]), sha256=hashlib.sha256(data[name]).hexdigest())
        index = dict(schema_version=3, version=tag, release_sequence=1, **installer.parse_release_tag(tag), targets=[dict(id=self.target, runtime=record(runtime), sources=[record(n) for n in sources])])
        data['targets.json'] = json.dumps(index).encode()
        data['targets.json.sig'] = b'signature'
        data['SHA256SUMS'] = ''.join(f'{hashlib.sha256(value).hexdigest()}  {name}\n' for name, value in data.items()).encode()
        release = dict(tag_name=tag, draft=False, prerelease=False, assets=[dict(name=name, size=len(value), browser_download_url=base + name) for name, value in data.items()])
        def fetch(url, path):
            path.write_bytes(json.dumps(release).encode() if '/api.github.com/' in url else data[url.rsplit('/', 1)[1]])
        with patch.object(installer, 'fetch', side_effect=fetch), patch.object(installer, 'verify_signature'):
            archive, version = installer.release_download('latest', self.target, self.work)
            self.assertEqual(archive.read_bytes(), b'archive')
            self.assertEqual(version, tag)
            release['assets'] = [item for item in release['assets'] if item['name'] != sources[0]]
            with self.assertRaisesRegex(ValueError, 'Incomplete'):
                installer.release_download('latest', self.target, self.work)
            release['assets'][0]['browser_download_url'] = base.replace(tag, 'v1.6.0') + runtime
            with self.assertRaisesRegex(ValueError, 'selected release'):
                installer.release_download('latest', self.target, self.work)

    def test_bootstrap_embeds_valid_standalone_installer(self):
        script = self.work / 'install-release.sh'
        spec = importlib.util.spec_from_file_location('release_assets', ROOT / 'scripts/release-assets.py')
        assets = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(assets)
        script.write_text(assets.render_installer())
        subprocess.run(['bash', '-n', str(script)], check=True)
        if os.geteuid() != 0:
            result = subprocess.run(['bash', str(script), '--help'], check=True, capture_output=True, text=True)
            self.assertIn('uninstall', result.stdout)

    def test_cli_resolved_latest_keeps_automatic_but_explicit_version_pins(self):
        tag = 'v1.6.0-abate.1'
        def download(version, target, work):
            (work/'targets.json').write_text('{"release_sequence":1}')
            return work/'archive', tag
        for resolved in (True, False):
            with self.subTest(resolved=resolved):
                payload = self.payload(tag)
                arguments = ['installer', 'install', '--version', tag] + (['--resolved-latest'] if resolved else [])
                with patch.object(sys, 'argv', arguments), patch.object(installer.os, 'geteuid', return_value=1000), \
                     patch.object(installer, 'Installation', return_value=self.install), \
                     patch.object(installer, 'host_target', return_value=self.target), \
                     patch.object(installer, 'dependencies'), patch.object(installer, 'startup'), \
                     patch.object(installer, 'release_download', side_effect=download), \
                     patch.object(installer, 'extract_runtime', return_value=payload):
                    self.assertEqual(installer.main(), 0)
                state = json.loads((self.install.root/'updates.json').read_text())
                self.assertEqual(state.get('mode', 'automatic'), 'automatic' if resolved else 'manual')
                self.assertEqual(state.get('pinned'), None if resolved else tag)


if __name__ == '__main__':
    unittest.main()
