#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-30: signed background updates, coordinated activation, native readiness and rollback.
"""Release update controller and independent session supervisor; no Git operations."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import tempfile
import threading
import time

STUDIO = Path(__file__).resolve().parent
sys.path.insert(1, str(STUDIO / 'scripts'))
from release_install import (Installation, APP, OWNER, dependencies, extract_runtime,
                             host_target, release_download, release_metadata, read_version)

MODES = {'automatic', 'notify', 'manual'}


def write_json(path, value):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(value, stream)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def read_json(path, default=None):
    return json.loads(path.read_text()) if path.exists() else (default or {})


def managed_installation(studio=STUDIO):
    if os.environ.get('ASE_STUDIO_DISABLE_UPDATES') == '1':
        return None
    installation = Installation()
    for parent in studio.parents:
        if parent.parent != installation.root:
            continue
        marker = parent / '.installer.json'
        if marker.is_file() and read_json(marker).get('owner') == OWNER:
            installation.initialize()
            return installation
    return None


def studio_at(version, macos):
    return (version / APP / 'Contents/Resources' if macos else version) / 'ase_studio'


def switch(installation, version):
    # Only direct, installer-owned version directories can become active.
    if version.parent != installation.root or version.is_symlink():
        raise ValueError('Invalid activation directory')
    marker = read_json(version / '.installer.json')
    if marker.get('owner') != OWNER or not version.name.startswith('version-'):
        raise ValueError('Unmanaged activation directory')
    temporary = installation.root / ('activate-' + secrets.token_hex(12))
    try:
        temporary.symlink_to(version.name)
        temporary.replace(installation.current)
    finally:
        temporary.unlink(missing_ok=True)


class Controller:
    def __init__(self, installation=None, identity=None):
        self.installation = installation or managed_installation()
        self.identity = identity or read_version(STUDIO)
        self.token = secrets.token_urlsafe(32)
        self.mutex = threading.Lock()
        self.worker = None
        self.progress = {}

    def preferences(self):
        if not self.installation:
            return {'mode': 'manual'}
        return {'mode': 'automatic', **read_json(self.installation.root / 'updates.json')}

    def status(self):
        if not self.installation:
            return {'managed': False, 'message': 'Release updates require the standalone installer.'}
        prefs = self.preferences()
        state = read_json(self.installation.root / 'update-status.json')
        return {**state, **self.progress, 'managed': True, 'mode': prefs['mode'],
                'pinned': prefs.get('pinned'), 'current': self.identity,
                'token': self.token, 'busy': bool(self.worker and self.worker.is_alive())}

    def configure(self, mode):
        if mode not in MODES:
            raise ValueError('Unknown update mode')
        with self.installation.lock():
            prefs = self.preferences()
            prefs['mode'] = mode
            prefs.pop('pinned', None)
            write_json(self.installation.root / 'updates.json', prefs)
            # Switching to manual/notify must not silently activate an old queue.
            if mode != 'automatic':
                (self.installation.root / 'prepared').unlink(missing_ok=True)
                write_json(self.installation.root / 'update-status.json', {'phase': 'idle', 'message': 'Update preference saved.'})
        return self.status()

    def check(self, force=False, download=False):
        if not self.installation:
            return self.status()
        with self.mutex:
            prefs = self.preferences()
            if self.worker and self.worker.is_alive():
                return self.status()
            if not force and (prefs['mode'] == 'manual' or time.time() - prefs.get('checked_at', 0) < 86400):
                return self.status()
            self.worker = threading.Thread(target=self._check, args=(download,), daemon=True)
            self.worker.start()
        return self.status()

    def _check(self, download):
        installation = self.installation
        status_path = installation.root / 'update-status.json'
        try:
            with installation.lock():
                prefs = self.preferences()
                prefs['checked_at'] = time.time()
                write_json(installation.root / 'updates.json', prefs)
                write_json(status_path, {'phase': 'checking'})
                with tempfile.TemporaryDirectory(prefix='download-', dir=installation.root) as directory:
                    work = Path(directory)
                    target = host_target()
                    index, row, base = release_metadata('latest', target, work)
                    sequence = index['release_sequence']
                    installed = installation.active()[1]
                    highest = max(installed['release_sequence'], prefs.get('highest_sequence', 0))
                    if sequence < highest:
                        raise ValueError('An older release index was rejected')
                    prefs['highest_sequence'] = sequence
                    write_json(installation.root / 'updates.json', prefs)
                    if sequence == installed['release_sequence']:
                        if index['version'] != installed['version']:
                            raise ValueError('A release sequence was reused for a different version')
                        write_json(status_path, {'phase': 'current', 'message': 'Studio is up to date.'})
                        return
                    details = {'version': index['version'], 'release_sequence': sequence,
                               'url': 'https://github.com/nunzioricci2000/ase-studio/releases/tag/' + index['version']}
                    if sequence == prefs.get('rejected_sequence'):
                        write_json(status_path, {**details, 'phase': 'failed', 'message': 'This update failed to start. Use the terminal installer to retry explicitly.'})
                        return
                    prepared = installation.root / 'prepared'
                    if prepared.is_symlink() and read_json(prepared.resolve() / '.installer.json').get('release_sequence') == sequence:
                        write_json(status_path, {**details, 'phase': 'ready', 'message': 'Update prepared for the next launch.'})
                        return
                    if prefs['mode'] != 'automatic' and not download:
                        write_json(status_path, {**details, 'phase': 'available'})
                        return
                    dependencies(target, check_only=True)
                    write_json(status_path, {**details, 'phase': 'downloading'})
                    def progress(received, total):
                        self.progress = {'received': received, 'total': total}
                    # Pin the exact authenticated tag; never race another latest release.
                    archive, tag = release_download(index['version'], target, work, progress=progress)
                    verified_index = read_json(work / 'targets.json')
                    if verified_index != index:
                        raise ValueError('Release index changed during download')
                    write_json(status_path, {**details, 'phase': 'verifying'})
                    payload = extract_runtime(archive, work / 'unpacked', target)
                    identity = read_version(studio_at(payload, installation.macos))
                    if identity['release_sequence'] != sequence:
                        raise ValueError('Archive sequence does not match the signed release')
                    installation.install(payload, target, tag, activate=False)
                    write_json(status_path, {**details, 'phase': 'ready', 'message': 'Update prepared for the next launch.'})
        except Exception as error:
            write_json(status_path, {'phase': 'failed', 'message': str(error)})
        finally:
            self.progress = {}

    def ready(self):
        path = os.environ.get('ASE_STUDIO_READY_FILE')
        if path:
            Path(path).write_text('ready\n')

    def restart(self):
        path = os.environ.get('ASE_STUDIO_RESTART_FILE')
        if not path or self.status().get('phase') != 'ready':
            raise ValueError('No prepared update or managed session to restart')
        Path(path).write_text('restart\n')


def authorized(headers, port, token):
    origin = f'http://127.0.0.1:{port}'
    return (headers.get('Host') == f'127.0.0.1:{port}'
            and headers.get('Origin') in (None, origin)
            and secrets.compare_digest(headers.get('X-ASE-Update-Token', ''), token))


@contextmanager
def selection_lock(installation):
    """A background download must not prevent another session opening the active app."""
    lock = installation.lock()
    try:
        lock.__enter__()
    except RuntimeError as error:
        if 'Another ASE Studio installer' not in str(error):
            raise
        yield False
    else:
        try:
            yield True
        finally:
            lock.__exit__(None, None, None)


def launch(installation, arguments):
    """Supervise a native session, keeping its version alive until all processes exit."""
    installation.initialize()
    while True:
        previous = None
        trial = False
        session = None
        process = None
        try:
            # Serialize selection with the CLI and acquire a session lock before releasing .lock.
            with selection_lock(installation) as can_activate:
                session = (installation.root / '.sessions.lock').open('a+')
                try:
                    fcntl.flock(session, (fcntl.LOCK_EX if can_activate else fcntl.LOCK_SH) | fcntl.LOCK_NB)
                    exclusive = can_activate
                except BlockingIOError:
                    fcntl.flock(session, fcntl.LOCK_SH | fcntl.LOCK_NB)
                    exclusive = False
                current = installation.active()[0]
                journal = installation.root / 'activation.json'
                if exclusive and journal.exists():
                    interrupted = read_json(journal)
                    switch(installation, installation.root / interrupted['previous'])
                    current = installation.active()[0]
                    prefs = read_json(installation.root / 'updates.json')
                    prefs['rejected_sequence'] = interrupted['sequence']
                    write_json(installation.root / 'updates.json', prefs)
                    write_json(installation.root / 'update-status.json', {'phase': 'failed', 'message': 'An interrupted activation was rolled back.'})
                    journal.unlink()
                pending = installation.root / 'prepared'
                if exclusive and pending.is_symlink():
                    candidate = pending.resolve()
                    if candidate.parent != installation.root:
                        raise ValueError('Invalid prepared version')
                    previous, current, trial = current, candidate, True
                    write_json(journal, {'previous': previous.name, 'candidate': candidate.name,
                                         'sequence': read_json(candidate / '.installer.json')['release_sequence']})
                    switch(installation, candidate)
                    pending.unlink()
                if not trial:
                    fcntl.flock(session, fcntl.LOCK_SH)
            with tempfile.TemporaryDirectory(prefix='session-', dir=installation.root) as directory:
                ready, restart = Path(directory) / 'ready', Path(directory) / 'restart'
                executable = current / APP / 'Contents/MacOS/ase-studio' if installation.macos else current / 'ase-studio'
                env = dict(os.environ, ASE_STUDIO_MANAGED_CHILD='1',
                           ASE_STUDIO_READY_FILE=str(ready), ASE_STUDIO_RESTART_FILE=str(restart))
                for key in ('PYTHONPATH', 'PYTHONHOME', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH'):
                    env.pop(key, None)
                try:
                    process = subprocess.Popen([str(executable), *arguments], env=env, start_new_session=True, pass_fds=(session.fileno(),))
                except OSError:
                    if not trial:
                        raise
                    with installation.lock():
                        switch(installation, previous)
                        journal.unlink(missing_ok=True)
                        prefs = read_json(installation.root / 'updates.json')
                        prefs['rejected_sequence'] = read_json(current / '.installer.json')['release_sequence']
                        write_json(installation.root / 'updates.json', prefs)
                        write_json(installation.root / 'update-status.json', {'phase': 'failed', 'message': 'The new executable could not start. The previous version was restored.'})
                    continue
                deadline = time.monotonic() + 60
                while trial and not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(.1)
                if trial and (not ready.exists() or process.poll() is not None):
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGTERM)
                        try:
                            process.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            os.killpg(process.pid, signal.SIGKILL)
                            process.wait()
                    with installation.lock():
                        switch(installation, previous)
                        journal.unlink(missing_ok=True)
                        prefs = read_json(installation.root / 'updates.json')
                        prefs['rejected_sequence'] = read_json(current / '.installer.json')['release_sequence']
                        write_json(installation.root / 'updates.json', prefs)
                        write_json(installation.root / 'update-status.json', {'phase': 'failed', 'message': 'The new window did not become ready. The previous version was restored.'})
                    continue
                if trial:
                    journal.unlink(missing_ok=True)
                    fcntl.flock(session, fcntl.LOCK_SH)
                    write_json(installation.root / 'update-status.json', {'phase': 'current', 'message': 'Update installed successfully.'})
                code = process.wait()
                if code == 0 and restart.exists():
                    continue
                return code
        finally:
            if session:
                session.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('action', choices=['launch'])
    parser.add_argument('arguments', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    arguments = args.arguments[1:] if args.arguments[:1] == ['--'] else args.arguments
    return launch(Installation(home=args.home), arguments)


if __name__ == '__main__':
    sys.exit(main())
