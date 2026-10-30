# Modified in the personal fork on 2026-10-30: cover signed Abate update metadata and runtime dependencies.
# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-10-30: require matching named fork identities in release evidence.
# Modified in the personal fork on 2026-10-30: cover final-archive installation evidence.
# Created in the personal fork on 2026-10-28: reject incomplete build evidence and corrupted release archives.
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from versioning import read_version
spec = importlib.util.spec_from_file_location('package_report', ROOT / 'scripts/package-report.py')
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class PackageReportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.revision = 'a' * 40
        self.jobs = [self.job('sources')]
        self.matrix = {'include': []}

    def job(self, name):
        return dict(name=name, status='completed', conclusion='success',
                    started_at='2026-10-28T01:00:00Z', completed_at='2026-10-28T01:02:00Z')

    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def change(self, path, modify):
        data = report.read(path)
        modify(data)
        self.write(path, data)

    def backend(self):
        return dict(status='succeeded', checks=[dict(name=name, status='succeeded')
                                               for name in sorted(report.RUNTIME_CHECKS)])

    def target(self, target='arch-x86_64'):
        self.matrix['include'].append({'id': target})
        self.jobs.append(self.job('package (' + target + ', runner)'))
        root = self.root / ('studio-report-' + target)
        macos = target.startswith('macos-')
        stages = ['install-final-archive', 'installed-backend', 'installed-native-window', 'verify-frontend-sources',
                  'studio-sources', 'engine-sources', 'archive']
        if macos:
            stages += ['native-build', 'ad-hoc-sign', 'verify-signature', 'verify-unchanged-app']
        assets = []
        for name in (f'ase-studio-nunzio-{target}' + ('.zip' if macos else '.tar.gz'),
                     f'ase-studio-nunzio-{target}-sources.tar.gz', f'ase-engine-{target}-sources.tar.gz'):
            path = self.root / ('studio-' + target) / name
            path.parent.mkdir(parents=True, exist_ok=True)
            data = name.encode()
            path.write_bytes(data)
            assets.append(dict(name=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
        package = dict(status='succeeded', git_sha=self.revision, studio_source_dirty=False,
                       version=(ROOT / 'VERSION').read_text().strip(), release=read_version(ROOT), target={'id': target}, artifacts=assets, wall_seconds=10,
                       stages=[dict(name=name, status='succeeded') for name in stages])
        self.write(root / 'studio-output/report.json', package)
        self.write(root / 'studio-output/runtime/runtime-report.json', self.backend())
        self.write(root / 'engine-input/fetch-report.json', {'status': 'succeeded'})
        self.write(root / 'studio-output/native-runtime.json', {'status': 'succeeded', 'backend_stopped': True})
        if macos or target == 'ubuntu-24.04-x86_64':
            self.write(root / 'studio-output/source-rebuild/report.json', dict(
                status='succeeded', git_sha=self.revision, source_files_verified=10,
                source_archive=assets[1], stages=[dict(name='rebuild-and-test', status='succeeded')]))
            self.write(root / 'studio-output/source-rebuild/verification/report.json', package)
        return root

    def aggregate(self):
        return report.aggregate(self.root, self.matrix, self.jobs, self.revision)

    def test_complete_matrix_has_timings_and_verified_archive_pairs(self):
        self.target()
        self.target('macos-15-arm64')
        result = self.aggregate()
        self.assertTrue(result['all_succeeded'])
        self.assertEqual(result['targets'][0]['job_wall_seconds'], 120)
        self.assertEqual(len(report.verify_archives(result, self.root)), 6)
        self.assertIn('source-archive-rebuild', report.markdown(result))

    def test_release_assets_require_installed_version_and_verified_archives(self):
        import sys
        sys.path.insert(0, str(ROOT / 'scripts'))
        spec = importlib.util.spec_from_file_location('release_assets', ROOT / 'scripts/release-assets.py')
        assets = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(assets)
        root = self.target()
        output = self.root / 'release'
        self.write(output / 'build-report.json', self.aggregate())
        version = read_version(ROOT)['release_tag']
        from unittest.mock import patch
        with patch.dict('os.environ', ASE_RELEASE_SIGNING_KEY_FILE='/unused/test-key'), patch.object(assets, 'sign_index', side_effect=lambda index, signature, key: signature.write_bytes(b'test signature')):
            assets.generate(self.root, output, version, self.revision)
        index = report.read(output / 'targets.json')
        self.assertEqual(index['version'], version)
        self.assertEqual(len(index['targets'][0]['sources']), 2)
        self.assertEqual(index['schema_version'], 3)
        self.assertEqual(index['fork_name'], 'Abate')
        self.assertEqual(index['upstream_version'], (ROOT / 'VERSION').read_text().strip())
        stale = self.aggregate()
        stale['targets'][0]['package']['release']['fork_revision'] += 1
        self.write(output / 'build-report.json', stale)
        with self.assertRaisesRegex(ValueError, 'version mismatch'):
            assets.generate(self.root, output, version, self.revision)
        self.write(output / 'build-report.json', self.aggregate())
        from release_install import checksums, verify
        sums = checksums(output / 'SHA256SUMS')
        for name in ('targets.json', 'install-release.sh', 'install-release.ps1', 'LICENSE'):
            verify(output / name, sums[name])
        import subprocess
        subprocess.run(['bash', '-n', str(output / 'install-release.sh')], check=True)
        self.change(root / 'studio-output/report.json', lambda d: d['stages'].pop(0))
        self.write(output / 'build-report.json', self.aggregate())
        with self.assertRaises(ValueError):
            assets.generate(self.root, output, version, self.revision)

    def test_missing_target_report_blocks_release(self):
        self.target()
        self.matrix['include'].append({'id': 'debian-12-x86_64'})
        self.assertFalse(self.aggregate()['all_succeeded'])

    def test_failed_job_blocks_release_even_when_package_passed(self):
        self.target()
        self.jobs[-1]['conclusion'] = 'failure'
        self.assertFalse(self.aggregate()['all_succeeded'])

    def test_missing_runtime_check_blocks_release(self):
        root = self.target()
        self.change(root / 'studio-output/runtime/runtime-report.json', lambda data: data['checks'].pop())
        self.assertFalse(self.aggregate()['all_succeeded'])

    def test_dirty_or_different_revision_blocks_release(self):
        root = self.target()
        path = root / 'studio-output/report.json'
        self.change(path, lambda data: data.update(studio_source_dirty=True))
        self.assertFalse(self.aggregate()['all_succeeded'])
        self.change(path, lambda data: data.update(studio_source_dirty=False, git_sha='b' * 40))
        self.assertFalse(self.aggregate()['all_succeeded'])

    def test_missing_macos_signature_recheck_blocks_release(self):
        root = self.target('macos-15-arm64')
        self.change(root / 'studio-output/report.json', lambda data: data['stages'].pop())
        self.assertFalse(self.aggregate()['all_succeeded'])

    def test_source_rebuild_must_verify_the_supplied_archive(self):
        root = self.target('macos-15-arm64')
        self.change(root / 'studio-output/source-rebuild/report.json',
                    lambda data: data['source_archive'].update(sha256='0' * 64))
        self.assertFalse(self.aggregate()['all_succeeded'])

    def test_ubuntu_requires_actual_windows_backend_and_native_evidence(self):
        self.target('ubuntu-24.04-x86_64')
        self.assertFalse(self.aggregate()['all_succeeded'])
        root = self.root / 'studio-report-windows-wsl2-x86_64'
        self.write(root / 'report.json', dict(status='succeeded', source_artifact={'git_sha': self.revision}))
        self.write(root / 'runtime/backend/runtime-report.json', self.backend())
        self.write(root / 'runtime/native-runtime.json', {'status': 'succeeded', 'backend_stopped': True})
        self.jobs.append(self.job('windows-wsl'))
        self.assertTrue(self.aggregate()['all_succeeded'])
        self.change(root / 'runtime/native-runtime.json', lambda data: data.update(backend_stopped=False))
        self.assertFalse(self.aggregate()['all_succeeded'])

    def test_corrupt_archive_is_rejected_after_successful_report(self):
        self.target()
        result = self.aggregate()
        asset = result['targets'][0]['package']['artifacts'][0]['name']
        (self.root / 'studio-arch-x86_64' / asset).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            report.verify_archives(result, self.root)

    def test_failed_report_cannot_be_released(self):
        self.target()
        self.jobs[0]['conclusion'] = 'failure'
        with self.assertRaisesRegex(ValueError, 'Every selected target'):
            report.verify_archives(self.aggregate(), self.root)


if __name__ == '__main__':
    unittest.main()
