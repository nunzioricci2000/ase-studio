# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-28: verify persistent data and portable paths with real make invocations.
# Modified in the personal fork on 2026-10-28: cover macOS native chooser and Finder reveal without launching user apps.
# Modified in the personal fork on 2026-10-28: canonicalize temporary paths consistently with the portable launcher on macOS.
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

STUDIO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('portable_studio', STUDIO / 'portable.py')
portable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portable)


class PackagedRuntimeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='ase-portable-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.engine = self.root / 'Application With Spaces/engine'
        self.data = self.root / 'Persistent User Data'
        for name in ('bin/gem5', 'toolchain/bin/riscv64-unknown-elf-gcc',
                     'toolchain/bin/riscv64-unknown-elf-objdump'):
            path = self.engine / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('#!/bin/sh\nexit 0\n')
            path.chmod(0o755)
        for name in ('riscv_in_order_hen_patt.py', 'riscv_o3_custom.py'):
            path = self.engine / 'configs' / name
            path.parent.mkdir(exist_ok=True)
            path.touch()

    def backend(self, env):
        spec = importlib.util.spec_from_file_location('packaged_backend', STUDIO / 'backend.py')
        backend = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, env):
            spec.loader.exec_module(backend)
        return backend

    def test_relocation_preserves_data_and_updates_runtime_paths(self):
        env = portable.prepare(self.engine, self.data)
        settings = self.data / '.ase-studio-env.json'
        settings.write_text('{"OPTIMIZATION_FLAGS": "-O1"}')
        source = self.data / 'programs/untouched.s'
        source.write_text('user program')
        initial_setup = (self.data / 'setup_default').read_bytes()
        moved = self.root / 'Moved Application/engine'
        moved.parent.mkdir()
        shutil.move(self.engine, moved)
        env = portable.prepare(moved, self.data)
        backend = self.backend(env)
        with patch.dict(os.environ, env):
            values = backend.settings_env()
        self.assertEqual(values['GEM5_INSTALLATION_PATH'], str(moved / 'bin/gem5'))
        self.assertEqual(values['GEM5_O3_SIMULATION_SCRIPT'], str(moved / 'configs/riscv_o3_custom.py'))
        self.assertEqual(values['OPTIMIZATION_FLAGS'], '-O1')
        self.assertEqual(source.read_text(), 'user program')
        self.assertEqual((self.data / 'setup_default').read_bytes(), initial_setup)
        self.assertEqual(settings.read_text(), '{"OPTIMIZATION_FLAGS": "-O1"}')

    def test_bad_engine_does_not_initialize_user_data(self):
        (self.engine / 'bin/gem5').unlink()
        with self.assertRaises(ValueError):
            portable.prepare(self.engine, self.data)
        self.assertFalse(self.data.exists())

    def test_existing_user_setup_is_not_overwritten(self):
        self.data.mkdir()
        setup = self.data / 'setup_default'
        setup.write_text('# user-owned setup\n')
        portable.prepare(self.engine, self.data)
        self.assertEqual(setup.read_text(), '# user-owned setup\n')

    def test_make_accepts_spaces_in_resource_and_tool_paths(self):
        env = portable.prepare(self.engine, self.data)
        resources = self.root / 'Read Only Application Resources'
        resources.mkdir()
        demo = resources / 'demo.mk'
        shutil.copy2(STUDIO / 'scripts/portable-demo.mk', demo)
        backend = self.backend(env)
        with patch.dict(os.environ, env), patch.object(backend, 'setup_environment', return_value={
                **env, 'RISCV_TOOLCHAIN_PATH': str(self.engine / 'toolchain/bin'),
                'GEM5_INSTALLATION_PATH': str(self.engine / 'bin/gem5'),
                'GEM5_SIMULATION_SCRIPT': str(self.engine / 'configs/riscv_in_order_hen_patt.py'),
                'ASE_STUDIO_DEMO_MK': str(demo)}):
            build_env = backend.settings_env()
        project = self.data / 'programs/arithmetic'
        project.mkdir()
        (project / 'main.s').touch()
        (project / 'Makefile').write_text(backend.MAKEFILE)
        build_env['program'] = 'main'
        result = subprocess.run(['make'], cwd=project, env=build_env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((project / 'main.dump').exists())
        self.assertFalse((self.data / 'programs/demo.mk').exists())

    def test_macos_uses_the_native_chooser_without_linux_display_variables(self):
        env = portable.prepare(self.engine, self.data)
        backend = self.backend(env)
        folder = self.data / 'programs/project'
        folder.mkdir()
        source = folder / 'main.s'
        source.write_text('user source')
        helper = self.engine / 'bin/gem5'  # Executable fixture, never executed.
        with patch.object(backend.sys, 'platform', 'darwin'), \
                patch.dict(os.environ, ASE_STUDIO_NATIVE_HELPER=str(helper), DISPLAY='', WAYLAND_DISPLAY=''), \
                patch.object(backend.subprocess, 'Popen') as launch:
            self.assertTrue(backend.open_with_editor('project')['ok'])
            self.assertEqual(launch.call_args.args[0], [str(helper), '--open-with', str(source)])

    def test_macos_reveals_only_a_valid_submission_archive(self):
        env = portable.prepare(self.engine, self.data)
        backend = self.backend(env)
        folder = self.data / 'submissions'
        folder.mkdir()
        archive = folder / 'test.zip'
        archive.write_bytes(b'fixture')
        with patch.object(backend.sys, 'platform', 'darwin'), \
                patch.object(backend, 'active_submission_directory', return_value=folder), \
                patch.object(backend.shutil, 'which', return_value='/usr/bin/open'), \
                patch.dict(os.environ, DISPLAY='', WAYLAND_DISPLAY=''), \
                patch.object(backend.subprocess, 'Popen') as launch:
            self.assertTrue(backend.reveal_submission_folder(str(archive))['ok'])
            self.assertEqual(launch.call_args.args[0], ['/usr/bin/open', '-R', str(archive)])
            with self.assertRaises(ValueError):
                backend.reveal_submission_folder(str(self.engine / 'outside.zip'))
            self.assertEqual(launch.call_count, 1)


if __name__ == '__main__':
    unittest.main()
