#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-10-30: verify named fork identities independently of upstream versions.
# Created in the personal fork on 2026-10-30: verified release downloads, runtime dependencies and transactional per-user installation.
"""Shared release installer; embedded in the standalone Bash release asset."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import posixpath
import re
import selectors
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import quote, urlparse
from urllib.request import HTTPSHandler, HTTPRedirectHandler, Request, build_opener
import uuid
import zipfile

# The standalone asset places versioning.py beside this script; checkout use finds it at the repository root.
sys.path.insert(1, str(Path(__file__).resolve().parents[1]))
from versioning import parse_release_tag, read_version

REPOSITORY = 'nunzioricci2000/ase-studio'
APP = 'ASE Studio di Nunzio.app'
DESKTOP = 'org.asestudio.Personal.Release.desktop'
OWNER = 'ASE Studio release installer v1\n'
TARGETS = {'ubuntu-22.04-x86_64', 'ubuntu-24.04-x86_64', 'ubuntu-24.04-aarch64',
           'debian-12-x86_64', 'debian-13-x86_64', 'fedora-43-x86_64', 'arch-x86_64',
           'macos-15-arm64', 'macos-15-x86_64'}


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def run(command, **kwargs):
    return subprocess.run([str(x) for x in command], check=True, **kwargs)


def confirm(commands, yes=False):
    print('Required package-manager operations:\n' + '\n'.join('  ' + shlex.join(c) for c in commands), flush=True)
    if not yes:
        try:
            with open('/dev/tty', 'r+') as tty:
                tty.write('Proceed? [y/N] ')
                tty.flush()
                accepted = tty.readline().strip().lower() in ('y', 'yes')
        except OSError:
            accepted = False
        if not accepted:
            raise RuntimeError('Dependencies declined; no installation was activated. Rerun to resume.')
    for command in commands:
        run(command)


def host_target():
    arch = {'AMD64': 'x86_64', 'aarch64': 'aarch64', 'arm64': 'aarch64'}.get(platform.machine(), platform.machine())
    if platform.system() == 'Darwin':
        version = platform.mac_ver()[0].split('.')[0]
        target = f'macos-{version}-' + ('arm64' if arch == 'aarch64' else arch)
    elif platform.system() == 'Linux':
        values = {}
        for line in Path('/etc/os-release').read_text().splitlines():
            if '=' in line:
                key, value = line.split('=', 1)
                values[key] = value.strip('"\'')
        distro = values.get('ID')
        target = f'arch-{arch}' if distro == 'arch' else f'{distro}-{values.get("VERSION_ID")}-{arch}'
    else:
        raise ValueError('Use Linux, macOS or the Windows WSL installer')
    if target not in TARGETS:
        raise ValueError('No verified package for this exact platform: ' + target)
    return target


def dependencies(target, yes=False):
    """Runtime packages only. CI installs its separate test tools afterwards."""
    privileged = [] if os.geteuid() == 0 else ['sudo']
    if target.startswith('macos-'):
        brew = shutil.which('brew')
        if not brew:
            for path in ('/opt/homebrew/bin/brew', '/usr/local/bin/brew'):
                if Path(path).is_file():
                    brew = path
                    break
        if not brew:
            raise RuntimeError('Homebrew is required. Install it following https://brew.sh then rerun this installer.')
        packages = 'gmp mpfr libmpc openssl@3 libffi xz sqlite readline gettext protobuf'.split()
        installed = set(subprocess.check_output([brew, 'list', '--formula'], text=True).split())
        missing = [p for p in packages if p not in installed]
        commands = [[brew, 'install', *missing]] if missing else []
    elif target.startswith(('ubuntu-', 'debian-')):
        # Resolve runtime SONAME package names from this distribution's repositories,
        # including Debian/Ubuntu's t64 transitions. Never select development packages.
        names = subprocess.check_output(['apt-cache', 'pkgnames'], text=True).splitlines()
        patterns = [r'libgoogle-perftools\d+(?:t64)?', r'libprotobuf\d+(?:t64)?',
                    r'libhdf5-\d+(?:-\d+)?(?:t64)?', r'libhdf5-cpp-\d+(?:-\d+)?(?:t64)?',
                    r'libpng\d+-\d+(?:t64)?', r'libssl\d+(?:t64)?', r'libffi\d+',
                    r'libreadline\d+(?:t64)?']
        def libraries():
            selected = []
            for pattern in patterns:
                matches = sorted({p for p in names if re.fullmatch(pattern, p)})
                if not matches:
                    return None
                selected.extend(matches)
            return selected
        libs = libraries()
        if libs is None:
            confirm([privileged + ['apt-get', 'update']], yes)
            names = subprocess.check_output(['apt-cache', 'pkgnames'], text=True).splitlines()
            libs = libraries()
        if libs is None:
            raise RuntimeError('Runtime library packages unavailable in the configured repositories; no alternate distribution is used.')
        packages = ('python3 python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 make '
                    'libgmp10 libmpfr6 libmpc3 libbz2-1.0 liblzma5 libsqlite3-0 '
                    'libncurses6 libtinfo6 zlib1g libexpat1 libstdc++6').split() + libs
        missing = []
        for name in packages:
            status = subprocess.run(['dpkg-query', '-W', '-f=${Status}', name], capture_output=True, text=True)
            if status.returncode or status.stdout != 'install ok installed':
                missing.append(name)
        commands = ([privileged + ['apt-get', 'update'],
                     privileged + ['apt-get', 'install', '-y', '--no-install-recommends', *missing]] if missing else [])
    elif target.startswith('fedora-'):
        packages = ('python3 python3-gobject gobject-introspection gtk3 webkit2gtk4.1 make '
                    'gperftools-libs protobuf hdf5 libpng libstdc++ libmpc mpfr gmp openssl-libs '
                    'libffi bzip2-libs xz-libs sqlite-libs readline ncurses-libs expat zlib-ng-compat libxcrypt-compat').split()
        missing = [p for p in packages if subprocess.run(['rpm', '-q', p], stdout=subprocess.DEVNULL).returncode]
        commands = [privileged + ['dnf', 'install', '-y', *missing]] if missing else []
    elif target.startswith('arch-'):
        packages = ('python python-gobject gobject-introspection-runtime gtk3 webkit2gtk-4.1 make '
                    'gperftools protobuf hdf5 libpng gcc-libs libmpc mpfr gmp openssl libffi '
                    'bzip2 xz sqlite readline ncurses expat zlib libxcrypt libxcrypt-compat').split()
        missing = [p for p in packages if subprocess.run(['pacman', '-Q', p], stdout=subprocess.DEVNULL,
                                                       stderr=subprocess.DEVNULL).returncode]
        commands = [privileged + ['pacman', '-Syu', '--needed', '--noconfirm', *missing]] if missing else []
    else:
        raise ValueError('Unsupported dependency target')
    if commands:
        confirm(commands, yes)


class SecureRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlparse(newurl).scheme != 'https':
            raise ValueError('Refusing a non-HTTPS redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, destination):
    if urlparse(url).scheme != 'https':
        raise ValueError('Only HTTPS downloads are permitted')
    opener = build_opener(HTTPSHandler(), SecureRedirect())
    temporary = destination.with_name(destination.name + '.partial')
    try:
        with opener.open(Request(url, headers={'User-Agent': 'ASE-Studio-installer'}), timeout=60) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output, 1024 * 1024)
            size = response.headers.get('Content-Length')
        if size is not None and temporary.stat().st_size != int(size):
            raise ValueError('Interrupted download: ' + destination.name)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def checksums(path):
    result = {}
    for line in path.read_text().splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  ([A-Za-z0-9_.-]+)', line)
        if not match or match[2] in result:
            raise ValueError('Invalid or duplicate checksum entry')
        result[match[2]] = match[1]
    return result


def verify(path, expected):
    if not re.fullmatch(r'[a-f0-9]{64}', expected) or digest(path) != expected:
        raise ValueError('SHA-256 mismatch: ' + path.name)


def release_download(version, target, work):
    api = f'https://api.github.com/repos/{REPOSITORY}/releases/'
    if version != 'latest':
        parse_release_tag(version)
    fetch(api + ('latest' if version == 'latest' else 'tags/' + quote(version, safe='')), work / 'release.json')
    release = json.loads((work / 'release.json').read_text())
    tag = release['tag_name']
    identity = parse_release_tag(tag)
    if release.get('draft') or release.get('prerelease'):
        raise ValueError('A published stable release is required')
    if version != 'latest' and tag != version:
        raise ValueError('Release version mismatch')
    base = f'https://github.com/{REPOSITORY}/releases/download/{tag}/'
    assets = {}
    for item in release['assets']:
        name = item['name']
        if name in assets:
            raise ValueError('Duplicate release asset')
        if item['browser_download_url'] != base + name:
            raise ValueError('Asset is not from the selected release')
        assets[name] = item
    def download(name):
        if name not in assets or not re.fullmatch(r'[A-Za-z0-9_.-]+', name):
            raise ValueError('Incomplete release; missing asset: ' + name)
        path = work / name
        fetch(base + name, path)
        if path.stat().st_size != assets[name]['size']:
            raise ValueError('Release asset size mismatch: ' + name)
        return path
    sums = checksums(download('SHA256SUMS'))
    index_file = download('targets.json')
    verify(index_file, sums['targets.json'])
    index = json.loads(index_file.read_text())
    if (index['schema_version'] != 2 or index['version'] != tag
            or any(index.get(key) != value for key, value in identity.items())):
        raise ValueError('Release index version mismatch')
    rows = [row for row in index['targets'] if row['id'] == target]
    if len(rows) != 1:
        raise ValueError('This release has no verified package for ' + target)
    row = rows[0]
    expected_runtime = f'ase-studio-nunzio-{target}' + ('.zip' if target.startswith('macos-') else '.tar.gz')
    expected_sources = {f'ase-studio-nunzio-{target}-sources.tar.gz', f'ase-engine-{target}-sources.tar.gz'}
    if row['runtime']['name'] != expected_runtime or {r['name'] for r in row['sources']} != expected_sources or len(row['sources']) != 2:
        raise ValueError('Incomplete runtime/source pair')
    for record in [row['runtime'], *row['sources']]:
        name = record['name']
        if name not in assets or sums.get(name) != record['sha256'] or assets[name]['size'] != record['bytes']:
            raise ValueError('Incomplete or inconsistent release: ' + name)
    archive = download(expected_runtime)
    verify(archive, row['runtime']['sha256'])
    return archive, tag


def validate_members(entries, root, casefold=False):
    """Validate the whole link graph before allowing any extraction writes."""
    links, seen = set(), set()
    def key(path):
        value = posixpath.normpath(str(path))
        return value.casefold() if casefold else value
    for name, kind, link in entries:
        path = PurePosixPath(name)
        if ('\\' in name or path.is_absolute() or '..' in path.parts or not path.parts
                or path.parts[0] not in (root, '__MACOSX')):
            raise ValueError('Unsafe archive path: ' + name)
        if key(path) in seen or kind not in ('file', 'dir', 'symlink', 'hardlink'):
            raise ValueError('Duplicate or unsupported archive member: ' + name)
        seen.add(key(path))
        if kind in ('symlink', 'hardlink'):
            if path.parts[0] == '__MACOSX':
                raise ValueError('Unexpected metadata link')
            base = path.parent if kind == 'symlink' else PurePosixPath('.')
            target = PurePosixPath(link)
            resolved = PurePosixPath(posixpath.normpath(str(base / target)))
            if '\\' in link or target.is_absolute() or not resolved.parts or resolved.parts[0] != root:
                raise ValueError('Archive link escapes its root')
            links.add(key(path))
    for name, kind, link in entries:
        path = PurePosixPath(name)
        if any(key(parent) in links for parent in path.parents):
            raise ValueError('Archive writes through a linked directory')
        if kind in ('symlink', 'hardlink'):
            base = path.parent if kind == 'symlink' else PurePosixPath('.')
            raw_target = base / link
            # Resolve every prefix lexically before testing links: link/../ can
            # otherwise escape even when the fully normalized target is inside.
            if any(key(parent) in links for parent in raw_target.parents):
                raise ValueError('Archive link traverses another linked directory')
        if kind == 'hardlink':
            target = PurePosixPath(link)
            if key(target) not in seen or key(target) in links:
                raise ValueError('Invalid hardlink target')


def extract_runtime(archive, destination, target):
    root = 'ase-studio-nunzio-' + target
    if target not in TARGETS:
        raise ValueError('Unsupported archive target')
    if destination.exists():
        raise ValueError('Extraction destination must be new')
    if archive.name.endswith('.zip'):
        with zipfile.ZipFile(archive) as stream:
            entries = []
            for item in stream.infolist():
                mode = item.external_attr >> 16
                kind = 'symlink' if stat.S_ISLNK(mode) else ('dir' if item.is_dir() else 'file')
                if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK):
                    raise ValueError('Special ZIP member')
                entries.append((item.filename, kind, stream.read(item).decode() if kind == 'symlink' else ''))
            validate_members(entries, root, casefold=True)
        destination.mkdir(parents=True)
        # ditto preserves Apple metadata and signatures; validation above precedes extraction.
        run(['/usr/bin/ditto', '-x', '-k', archive, destination])
    else:
        with tarfile.open(archive) as stream:
            members = stream.getmembers()
            entries = [(m.name, 'file' if m.isfile() else 'dir' if m.isdir() else 'symlink' if m.issym()
                        else 'hardlink' if m.islnk() else 'special', m.linkname) for m in members]
            validate_members(entries, root)
            if any(PurePosixPath(name).parts[0] == '__MACOSX' for name, _, _ in entries):
                raise ValueError('Unexpected metadata in Linux archive')
            destination.mkdir(parents=True)
            options = {'filter': 'data'} if hasattr(tarfile, 'data_filter') else {}
            for member in members:
                member.mode &= 0o777  # Never carry setuid/setgid/sticky bits from an archive.
            stream.extractall(destination, members=members, **options)
    return destination / root


def startup(payload, macos):
    resources = payload / APP / 'Contents/Resources' if macos else payload
    engine, studio = resources / 'engine', resources / 'ase_studio'
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONNOUSERSITE='1')
    for key in ('PYTHONPATH', 'PYTHONHOME', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH'):
        env.pop(key, None)
    if macos:
        run(['codesign', '--verify', '--deep', '--strict', payload / APP])
        python = engine / 'python/bin/python3.10'
        env.update(PYTHONHOME=str(engine / 'python'), DYLD_LIBRARY_PATH=str(engine / 'python/lib'))
    else:
        python = Path('/usr/bin/python3')
        run([python, '-c', 'import gi; gi.require_version("Gtk", "3.0"); gi.require_version("WebKit2", "4.1"); from gi.repository import Gtk, WebKit2'], env=env)
    # Executing SDK tools resolves their actual shared libraries on the target.
    run([engine / 'bin/gem5', '--help'], env=env, stdout=subprocess.DEVNULL, timeout=60)
    run([engine / 'toolchain/bin/riscv64-unknown-elf-gcc', '--version'], env=env, stdout=subprocess.DEVNULL, timeout=30)
    with tempfile.TemporaryDirectory(prefix='ase-install-check-') as directory:
        scratch = Path(directory)
        source = scratch / 'check.s'
        source.write_text('.text\n.globl _start\n_start:\n li a0, 0\n li a7, 93\n ecall\n')
        run([engine / 'toolchain/bin/riscv64-unknown-elf-gcc', '-march=rv32imafd_zicsr_zifencei',
             '-mabi=ilp32', '-nostdlib', source, '-o', scratch / 'check.elf'], env=env, timeout=60)
        run([engine / 'toolchain/bin/riscv64-unknown-elf-objdump', '-d', scratch / 'check.elf'],
            env=env, stdout=subprocess.DEVNULL, timeout=30)
        with (scratch / 'server.log').open('w+') as log:
            process = subprocess.Popen([str(python), str(studio / 'portable.py'), '--server', '--port', '0',
                                        '--data', str(scratch / 'data')], env=env, stdout=subprocess.PIPE,
                                       stderr=log, text=True)
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ)
                    if not selector.select(45):
                        raise RuntimeError('Installed server startup timed out')
                    line = process.stdout.readline().strip()
                match = re.fullmatch(r'ASE Studio: (http://127\.0\.0\.1:\d+)', line)
                if not match:
                    log.seek(0)
                    raise RuntimeError('Installed server did not start: ' + log.read())
                # Only this loopback health check uses HTTP; release downloads require HTTPS.
                from urllib.request import urlopen
                with urlopen(match[1] + '/api/health', timeout=10) as response:
                    if not json.load(response)['ok']:
                        raise RuntimeError('Installed server health check failed')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                process.stdout.close()
    if macos:
        run(['codesign', '--verify', '--deep', '--strict', payload / APP])


class Installation:
    def __init__(self, home=None, macos=None):
        self.home = (home or Path.home()).absolute()
        self.macos = platform.system() == 'Darwin' if macos is None else macos
        self.root = self.home / ('Applications/.ase-studio' if self.macos else '.local/opt/ase-studio')
        if any(c in str(self.home) for c in '\n\r'):
            raise ValueError('Home directory contains a line break')
        self.current = self.root / 'current'
        self.launcher = self.home / '.local/bin/ase-studio'
        data = Path(os.environ.get('XDG_DATA_HOME', ''))
        self.desktop = (data if data.is_absolute() else self.home / '.local/share') / 'applications' / DESKTOP

    def initialize(self):
        if self.root.is_symlink():
            raise ValueError('Refusing a linked installation directory')
        if self.root.exists():
            if (self.root / '.owner').is_symlink() or (self.root / '.owner').read_text() != OWNER:
                raise ValueError('Installation directory is not managed by this installer')
        else:
            self.root.mkdir(parents=True)
            (self.root / '.owner').write_text(OWNER)

    @contextmanager
    def lock(self):
        self.initialize()
        lockfile = self.root / '.lock'
        fd = os.open(lockfile, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('Another ASE Studio installer is running') from None
            yield
        # Keep the lock inode: removing it allows concurrent processes to lock different files.

    def active(self):
        if not self.current.is_symlink():
            if self.current.exists():
                raise ValueError('Unmanaged active installation')
            return None
        link = os.readlink(self.current)
        if not re.fullmatch(r'version-[a-f0-9]{32}', link):
            raise ValueError('Invalid active installation link')
        path = self.root / link
        if path.is_symlink() or (path / '.installer.json').is_symlink():
            raise ValueError('Invalid installation metadata')
        state = json.loads((path / '.installer.json').read_text())
        if state['owner'] != OWNER:
            raise ValueError('Unmanaged installation')
        return path, state

    def entries(self, desktop=None):
        executable = self.current / APP / 'Contents/MacOS/ase-studio' if self.macos else self.current / 'ase-studio'
        wrapper = '#!/bin/sh\n# SPDX-License-Identifier: GPL-2.0-only\n# Managed by ASE Studio release installer.\nexec ' + shlex.quote(str(executable)) + ' "$@"\n'
        entries = {self.launcher: ('file', wrapper)}
        if self.macos:
            entries[self.home / 'Applications' / APP] = ('link', str(self.current / APP))
        else:
            # Desktop Entry string escaping precedes the Exec shell-independent quoting.
            command = str(self.launcher).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%')
            command = command.replace('\\', '\\\\')
            text = ('# SPDX-License-Identifier: GPL-2.0-only\n# Managed by ASE Studio release installer.\n'
                    '[Desktop Entry]\nType=Application\nName=ASE Studio di Nunzio\n'
                    f'Exec="{command}"\nTerminal=false\nCategories=Education;\n'
                    'StartupWMClass=ASEStudioFork\n')
            entries[desktop or self.desktop] = ('file', text)
        return entries

    def owned_entry(self, path, kind, value):
        return ((path.is_symlink() and os.readlink(path) == value) if kind == 'link' else
                (path.is_file() and not path.is_symlink() and path.read_bytes() == value.encode()))

    def install(self, payload, target, version, check=startup):
        parse_release_tag(version)
        active = self.active()
        if (payload / '.installer.json').exists() or (payload / '.installer.json').is_symlink():
            raise ValueError('Archive contains reserved installer state')
        manifest = json.loads((payload / 'manifest.json').read_text())
        if manifest['target'] != target:
            raise ValueError('Archive target differs from selected platform')
        resources = payload / APP / 'Contents/Resources' if self.macos else payload
        identity = read_version(resources / 'ase_studio')
        if identity['release_tag'] != version or manifest.get('release_tag') != version:
            raise ValueError('Archive version differs from selected release')
        desktop = Path(active[1]['desktop']) if active and not self.macos else self.desktop
        if desktop.name != DESKTOP or not desktop.is_absolute() or any(c in str(desktop) for c in '\n\r'):
            raise ValueError('Invalid managed desktop path')
        entries = self.entries(desktop)
        for path, (kind, value) in entries.items():
            if (path.exists() or path.is_symlink()) and not self.owned_entry(path, kind, value):
                raise ValueError('Refusing to replace an unmanaged or modified launcher: ' + str(path))
        version_dir = self.root / ('version-' + uuid.uuid4().hex)
        created = []
        pending = self.root / ('pending-' + uuid.uuid4().hex)
        try:
            shutil.move(str(payload), version_dir)
            state = dict(owner=OWNER, version=version, target=target, desktop=str(desktop), **identity)
            (version_dir / '.installer.json').write_text(json.dumps(state) + '\n')
            check(version_dir, self.macos)
            for path, (kind, value) in entries.items():
                if path.exists() or path.is_symlink():
                    continue
                path.parent.mkdir(parents=True, exist_ok=True)
                if kind == 'link':
                    path.symlink_to(value)
                else:
                    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
                        staging = Path(stream.name)
                        try:
                            stream.write(value)
                            stream.flush()
                            staging.chmod(0o755 if path == self.launcher else 0o644)
                            os.link(staging, path)  # Atomic publication without overwriting another file.
                        finally:
                            staging.unlink(missing_ok=True)
                created.append(path)
            pending.symlink_to(version_dir.name)
            pending.replace(self.current)  # The only activation step; old version survives every earlier failure.
        except BaseException:
            # A signal after the atomic switch must not delete the newly active version.
            if self.current.is_symlink() and os.readlink(self.current) == version_dir.name:
                raise
            for path in created:
                path.unlink(missing_ok=True)
            shutil.rmtree(version_dir, ignore_errors=True)
            raise
        finally:
            pending.unlink(missing_ok=True)
        # Retain old versions while the app may still be running; uninstall removes managed versions.
        print('Installed ' + version + ' for ' + target + ': ' + str(self.current))
        if str(self.launcher.parent) not in os.environ.get('PATH', '').split(os.pathsep):
            print('Add ~/.local/bin to PATH to use ase-studio from your terminal. Shell configuration was not changed.')
        return version_dir

    def uninstall(self):
        active = self.active()
        desktop = Path(active[1]['desktop']) if active and not self.macos else self.desktop
        if desktop.name != DESKTOP or not desktop.is_absolute() or any(c in str(desktop) for c in '\n\r'):
            raise ValueError('Invalid managed desktop path')
        for path, (kind, value) in self.entries(desktop).items():
            if self.owned_entry(path, kind, value):
                path.unlink()
            elif path.exists() or path.is_symlink():
                print('Preserving modified/unmanaged entry: ' + str(path))
        if active:
            self.current.unlink()
        for directory in self.root.glob('version-*'):
            marker = directory / '.installer.json'
            if directory.is_symlink() or not marker.is_file() or marker.is_symlink():
                continue
            if json.loads(marker.read_text()).get('owner') == OWNER:
                shutil.rmtree(directory)
        print('ASE Studio removed. Projects, preferences, shared dependencies and the installer lock directory were preserved.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'update', 'uninstall', 'dependencies'], nargs='?', default='install')
    parser.add_argument('--version', default='latest')
    parser.add_argument('--yes', action='store_true', help='Approve the displayed dependency operations without prompting')
    args = parser.parse_args()
    try:
        if args.action == 'dependencies':
            dependencies(host_target(), args.yes)
            return 0
        if os.geteuid() == 0:
            raise ValueError('Run the installer as your normal desktop user, without sudo')
        installation = Installation()
        with installation.lock():
            if args.action == 'uninstall':
                installation.uninstall()
                return 0
            if args.action == 'update' and not installation.active():
                raise ValueError('No managed installation to update; use install first')
            target = host_target()
            with tempfile.TemporaryDirectory(prefix='ase-release-') as directory:
                work = Path(directory)
                archive, version = release_download(args.version, target, work)
                payload = extract_runtime(archive, work / 'unpacked', target)
                dependencies(target, args.yes)
                installation.install(payload, target, version)
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError, tarfile.TarError, zipfile.BadZipFile) as error:
        print('ASE Studio installation failed: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
