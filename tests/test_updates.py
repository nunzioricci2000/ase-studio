# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-30: test authenticated releases, background policy, concurrent sessions and real supervisor rollback.
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import updates
import release_security
import test_release_install as fixtures
installer = fixtures.installer


class SignatureTests(unittest.TestCase):
    def test_real_signature_tamper_wrong_key_and_missing_signature(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('signer', 'other'):
                subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072', '-out', str(root/name)], check=True, capture_output=True)
                subprocess.run(['openssl', 'pkey', '-in', str(root/name), '-pubout', '-out', str(root/(name+'.pub'))], check=True, capture_output=True)
            index, signature = root/'index', root/'signature'
            index.write_text('{"sequence":2}')
            release_security.sign_index(index, signature, root/'signer', root/'signer.pub')
            with self.assertRaises(ValueError):
                release_security.verify_signature(index, signature, root/'other.pub')
            index.write_text('{"sequence":3}')
            with self.assertRaises(ValueError):
                release_security.verify_signature(index, signature, root/'signer.pub')
            signature.write_bytes(b'short')
            with self.assertRaises(ValueError):
                release_security.verify_signature(index, signature, root/'signer.pub')


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.InstallerTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.install = self.fixture.install
        self.old = self.fixture.activate()
        self.controller = updates.Controller(self.install)
        self.index = {'version': 'v1.6.0-abate.2', 'release_sequence': 2}

    def check(self, download=False):
        with patch.object(updates, 'host_target', return_value=self.fixture.target), patch.object(updates, 'release_metadata', return_value=(self.index, {}, 'https://example.invalid/')):
            self.controller._check(download)
        return self.controller.status()

    def test_home_alias_resolves_to_the_same_managed_installation(self):
        alias = self.fixture.work / 'aliased-home'
        alias.symlink_to(self.fixture.home, target_is_directory=True)
        alternate = installer.Installation(alias, macos=False)
        self.assertEqual(alternate.root, self.install.root)
        self.assertEqual(alternate.active()[0], self.old)

    def test_manual_and_daily_policy_do_not_start_network(self):
        self.controller.configure('manual')
        with patch.object(updates.threading, 'Thread') as thread:
            self.controller.check()
            thread.assert_not_called()
        self.controller.configure('automatic')
        updates.write_json(self.install.root/'updates.json', {'mode':'automatic', 'checked_at':updates.time.time()})
        with patch.object(updates.threading, 'Thread') as thread:
            self.controller.check()
            thread.assert_not_called()

    def test_notify_and_regression_rejection(self):
        self.controller.configure('notify')
        with patch.object(updates, 'release_download') as download:
            self.assertEqual(self.check()['phase'], 'available')
            download.assert_not_called()
        self.index['release_sequence'] = 1
        self.assertEqual(self.check()['phase'], 'failed')
        self.assertEqual(self.install.current.resolve(), self.old)

    def test_prepare_verifies_without_switching_then_mode_change_cancels_queue(self):
        payload = self.fixture.payload('v1.6.0-abate.2')
        def download(tag, target, work, progress=None):
            updates.write_json(work/'targets.json', self.index)
            return work/'archive', tag
        with patch.object(updates, 'dependencies'), patch.object(updates, 'release_download', side_effect=download), patch.object(updates, 'extract_runtime', return_value=payload), patch.object(installer, 'startup'):
            self.assertEqual(self.check()['phase'], 'ready')
        self.assertEqual(self.install.current.resolve(), self.old)
        self.assertTrue((self.install.root/'prepared').is_symlink())
        self.controller.configure('manual')
        self.assertFalse((self.install.root/'prepared').exists())

    def test_missing_dependencies_never_download_or_replace_current(self):
        with patch.object(updates, 'dependencies', side_effect=RuntimeError('Dependencies require confirmation')), patch.object(updates, 'release_download') as download:
            result = self.check()
            self.assertEqual(result['phase'], 'failed')
            self.assertIn('confirmation', result['message'])
            download.assert_not_called()
        self.assertEqual(self.install.current.resolve(), self.old)

    def test_offline_check_keeps_installation_and_reports_failure(self):
        with patch.object(updates, 'host_target', side_effect=OSError('offline')):
            self.controller._check(False)
        self.assertEqual(self.controller.status()['phase'], 'failed')
        self.assertEqual(self.install.current.resolve(), self.old)

    def test_only_same_origin_authenticated_session_can_change_updates(self):
        token = self.controller.token
        good = {'Host':'127.0.0.1:8765','Origin':'http://127.0.0.1:8765','X-ASE-Update-Token':token}
        self.assertTrue(updates.authorized(good,8765,token))
        for key, value in [('Origin','https://evil.invalid'),('Host','evil.invalid:8765'),('X-ASE-Update-Token','wrong')]:
            self.assertFalse(updates.authorized({**good,key:value},8765,token))

    def test_sessions_block_installation_and_release_after_exit(self):
        with self.install.sessions():
            with self.assertRaisesRegex(RuntimeError, 'Close all'):
                with self.install.sessions(exclusive=True):
                    pass
        with self.install.sessions(exclusive=True):
            pass

    def executable(self, directory, body):
        path = directory/'ase-studio'
        path.write_text('#!/bin/sh\n'+body+'\n')
        path.chmod(0o755)

    def test_supervisor_rolls_back_failed_window_and_does_not_retry_it(self):
        payload = self.fixture.payload('v1.6.0-abate.2')
        new = self.install.install(payload, self.fixture.target, 'v1.6.0-abate.2', check=lambda *_:None, activate=False)
        self.executable(new, 'exit 1')
        self.executable(self.old, 'echo ready > "$ASE_STUDIO_READY_FILE"\nexit 0')
        self.assertEqual(updates.launch(self.install, []), 0)
        self.assertEqual(self.install.current.resolve(), self.old)
        self.assertEqual(self.controller.preferences()['rejected_sequence'],2)
        self.assertFalse((self.install.root/'activation.json').exists())

    def test_supervisor_activates_ready_window_and_preserves_previous(self):
        payload = self.fixture.payload('v1.6.0-abate.2')
        new = self.install.install(payload, self.fixture.target, 'v1.6.0-abate.2', check=lambda *_:None, activate=False)
        self.executable(new, 'echo ready > "$ASE_STUDIO_READY_FILE"\nsleep 0.3\nexit 0')
        self.assertEqual(updates.launch(self.install, []),0)
        self.assertEqual(self.install.current.resolve(),new)
        self.assertTrue(self.old.exists())
        self.assertFalse((self.install.root/'activation.json').exists())

    def test_interrupted_activation_recovers_previous_version(self):
        new = self.fixture.activate('v1.6.0-abate.2')
        updates.write_json(self.install.root/'activation.json', {'previous':self.old.name,'candidate':new.name,'sequence':2})
        self.executable(self.old, 'exit 0')
        self.assertEqual(updates.launch(self.install, []),0)
        self.assertEqual(self.install.current.resolve(),self.old)


if __name__ == '__main__':
    unittest.main()
