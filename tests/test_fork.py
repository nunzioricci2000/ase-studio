"""Regression checks using disposable Git repositories, never user checkouts."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('studio_backend', Path(__file__).resolve().parents[1] / 'backend.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)

class ForkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.remote = self.root / 'remote.git'
        self.git('init', '--bare', str(self.remote), cwd=self.root)
        self.repo = self.root / 'repo'
        self.git('clone', str(self.remote), str(self.repo), cwd=self.root)
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'user.name', 'Test')
        self.git('checkout', '-b', 'main')
        self.commit('base')
        self.git('push', '-u', 'origin', 'main')

    def git(self, *args, cwd=None):
        return subprocess.check_output(['git', *args], cwd=cwd or self.repo, stderr=subprocess.DEVNULL, text=True).strip()

    def commit(self, text):
        (self.repo / 'source').write_text(text)
        self.git('add', 'source')
        self.git('commit', '-m', text)

    def incoming(self):
        self.commit('incoming')
        self.git('push', 'origin', 'main')
        self.git('reset', '--hard', 'HEAD~1')

    def status(self):
        return backend.repository_update_status(self.repo, 'Test')

    def test_fast_forward(self):
        self.incoming()
        result = self.status()
        self.assertTrue(result['canUpdate'])
        self.assertEqual(result['behind'], 1)

    def test_local_changes_block(self):
        self.incoming()
        (self.repo / 'source').write_text('unsaved')
        self.assertFalse(self.status()['canUpdate'])
        self.assertEqual((self.repo / 'source').read_text(), 'unsaved')

    def test_untracked_changes_block(self):
        self.incoming()
        (self.repo / 'new-file').write_text('local')
        self.assertTrue(self.status()['dirty'])
        self.assertFalse(self.status()['canUpdate'])

    def test_divergence_blocks(self):
        self.incoming()
        self.commit('local')
        self.assertTrue(self.status()['diverged'])
        self.assertFalse(self.status()['canUpdate'])

    def test_detached_is_not_switched(self):
        self.git('checkout', '--detach')
        original = self.git('rev-parse', 'HEAD')
        self.assertTrue(self.status()['detached'])
        self.assertEqual(self.git('branch', '--show-current'), '')
        self.assertEqual(self.git('rev-parse', 'HEAD'), original)

    def test_upstream_remote_not_updated(self):
        self.git('remote', 'add', 'upstream', str(self.remote))
        self.git('fetch', 'upstream')
        self.git('branch', '--set-upstream-to=upstream/main')
        self.assertFalse(self.status()['canUpdate'])
        self.assertIn('only origin', self.status()['message'])

    def test_runtime_validation_never_calls_git(self):
        (self.root / 'setup_default').touch()
        programs = self.root / 'programs'
        programs.mkdir()
        executable = self.root / 'gem5.opt'
        executable.touch()
        executable.chmod(0o755)
        with patch.object(backend, 'ROOT', self.root), patch.object(backend, 'PROGRAMS', programs), patch.object(backend, 'configured_gem5_location', return_value={'executable':str(executable)}), patch.object(backend, 'git_run', side_effect=AssertionError('startup ran Git')):
            backend.validate_runtime_environment()

    def test_first_run_invalid_tool_path_allows_settings_without_git(self):
        (self.root / 'setup_default').touch()
        with patch.object(backend, 'ROOT', self.root), patch.object(backend, 'configured_gem5_location', return_value={'error':'missing tool'}), patch.object(backend, 'git_run', side_effect=AssertionError('startup ran Git')), patch('sys.stderr') as stderr:
            backend.validate_runtime_environment()
            self.assertTrue(stderr.write.called)

    def test_blocked_update_does_not_mutate_git(self):
        with patch.object(backend, 'update_status', return_value={'available':True,'canUpdate':False,'message':'dirty'}), patch.object(backend, 'git_run', side_effect=AssertionError('blocked update ran Git')):
            self.assertFalse(backend.pull_update()['ok'])

if __name__ == '__main__':
    unittest.main()
