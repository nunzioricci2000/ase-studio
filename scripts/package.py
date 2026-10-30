#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-10-30: package independent upstream and Abate release metadata.
# Modified in the personal fork on 2026-10-30: separate minimal runtime from sources and validate installed final archives with external tests.
# Modified in the personal fork on 2026-10-30: exclude assistant instructions and configuration from application and source exports.
# Created in the personal fork on 2026-10-28: build and verify native Studio packages from existing source-paired SDKs.
# Modified in the personal fork on 2026-10-28: exercise the native editor with a disposable project outside application resources.
"""Package Studio without compiling gem5, Python or the RISC-V toolchain."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

from check import Report, utc

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('frontend_sources', ROOT / 'scripts/frontend-sources.py')
frontend_sources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frontend_sources)
OMITTED = {'frontend/' + name for name in ('ase_dark.png', 'ase_light.png', 'cad-dark.webp',
           'cad-light.webp', 'polito_dark.png', 'polito_light.png', 'icon.png')}
# Development-only assistant context is not an input to the application build.
ASSISTANT_FILES = {'agents.md', 'agents.override.md', 'claude.md', 'gemini.md',
                   'copilot-instructions.md', '.cursorrules', '.clinerules'}
ASSISTANT_DIRECTORIES = {'.agents', '.codex', '.claude', '.cursor', '.cline', '.gemini'}
PACKAGE_STYLE = '''/* SPDX-License-Identifier: GPL-2.0-only */
/* Created in the personal fork on 2026-10-28: text branding in distributed packages. */
.brand .brand-name { font-size: 18px; line-height: 1.25; }
.about-partners a { padding: 8px; text-align: center; }
'''
LAUNCHER = '''#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-28: start the installed Studio with the host GTK runtime.
# Modified in the personal fork on 2026-10-30: use the system Python with distribution GTK bindings.
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PYTHONDONTWRITEBYTECODE=1
exec /usr/bin/python3 "$app_dir/ase_studio/portable.py" "$@"
'''


def checksum(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def measure(report, name, operation):
    stage = dict(name=name, started_at=utc(), status='running')
    report.data['stages'].append(stage)
    report.save()
    started = time.monotonic()
    print(stage['started_at'], name, flush=True)
    try:
        value = operation()
        stage['status'] = 'succeeded'
        return value
    except Exception as error:
        stage.update(status='failed', error=str(error))
        raise
    finally:
        stage.update(finished_at=utc(), wall_seconds=time.monotonic() - started)
        report.save()


def source_files(root=ROOT):
    supplied = root / '.source-files.json'
    if supplied.exists():
        names = json.loads(supplied.read_text())['files'].keys()
    else:
        names = os.fsdecode(subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z'])).split('\0')
    result = []
    for name in sorted(set(names) - OMITTED - {''}):
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts or not relative.parts:
            raise ValueError('Invalid source path')
        if (relative.name.lower() in ASSISTANT_FILES
                or any(part.lower() in ASSISTANT_DIRECTORIES for part in relative.parts)
                or relative.parts[:2] in (('.github', 'prompts'), ('.github', 'instructions'),
                                           ('.github', 'agents'))):
            continue
        path = root / name
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError(f'Missing or linked source file: {name}')
        result.append(name)
    return result


def provenance(root=ROOT):
    supplied = root / '.source-files.json'
    if supplied.exists():
        previous = json.loads(supplied.read_text())
        revision = previous['git_sha']
        dirty = previous.get('dirty', False)
    else:
        revision = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
        dirty = subprocess.run(['git', '-C', str(root), 'diff', '--quiet', 'HEAD']).returncode != 0
    files = {name: checksum(root / name) for name in source_files(root)}
    if supplied.exists():
        dirty = dirty or any(previous['files'].get(name) != value for name, value in files.items())
    return dict(git_sha=revision, dirty=dirty, files=files, omitted_assets=sorted(OMITTED))


def release_index(text):
    names = '|'.join(re.escape(Path(name).name) for name in OMITTED)
    text = re.sub(r'<img\b[^>]*\bsrc="(?:' + names + r')"[^>]*>', '', text)
    for url, label in [('https://www.polito.it/', 'Politecnico di Torino'),
                       ('https://cad.polito.it/', 'Electronic CAD and Reliability Group')]:
        pattern = r'(<a\b[^>]*href="' + re.escape(url) + r'"[^>]*>)\s*(</a>)'
        text = re.sub(pattern, lambda match: match[1] + label + match[2], text)
    notice = '<!-- Modified in the personal fork on 2026-10-28: omit unverified logos from distributed packages; preserve textual attribution. -->\n'
    return notice + text.replace('</head>', '<link rel="stylesheet" href="package.css"></head>', 1)


def export_code(destination, metadata, release=False, root=ROOT):
    destination.mkdir(parents=True)
    for name in metadata['files']:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, target)
    (destination / '.source-files.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (destination / '.source-files.json.license').write_text('SPDX-License-Identifier: GPL-2.0-only\n')
    if release:
        index = destination / 'frontend/index.html'
        index.write_text(release_index(index.read_text()))
        (destination / 'frontend/package.css').write_text(PACKAGE_STYLE)


# Every runtime entry is deliberate; editable editor sources stay in the source archive.
RUNTIME_FILES = {
    'portable.py', 'backend.py', 'native.py', 'VERSION', 'VERSION.license',
    'FORK.json', 'FORK.json.license', 'versioning.py', 'LICENSE', 'THIRD_PARTY.md',
    'scripts/portable-demo.mk', 'frontend/index.html', 'frontend/studio.css',
    'frontend/studio.js', 'frontend/riscv-opcodes.js', 'frontend/memory-window.js',
    'frontend/memory-window.html', 'frontend/memory-window.css',
}


def export_runtime(destination, metadata, root=ROOT):
    names = RUNTIME_FILES | {name for name in metadata['files']
                             if PurePosixPath(name).parent == PurePosixPath('frontend/vendor')}
    if not RUNTIME_FILES <= metadata['files'].keys():
        raise ValueError('Runtime source manifest is incomplete')
    destination.mkdir(parents=True)
    for name in sorted(names):
        source = root / name
        if source.is_symlink() or not source.is_file():
            raise ValueError('Missing or linked runtime input: ' + name)
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    index = destination / 'frontend/index.html'
    index.write_text(release_index(index.read_text()))
    (destination / 'frontend/package.css').write_text(PACKAGE_STYLE)


def trim_engine(engine):
    # Only project-owned SDK test fixtures/build measurements are removed.
    # Toolchain components, Python, gem5 configs and all vendor notices remain intact.
    shutil.rmtree(engine / 'tests', ignore_errors=True)
    for name in ('environment.json', 'environment.json.license',
                 'runtime-compaction.json', 'runtime-compaction.json.license'):
        (engine / name).unlink(missing_ok=True)


def sdk_inputs(directory):
    report = json.loads((directory / 'report.json').read_text())
    target = report['target']
    if report.get('status') != 'succeeded' or not re.fullmatch(r'[a-z0-9_.-]+', target['id']):
        raise ValueError('The engine artifact must contain a successful target report')
    arch = {'arm64': 'aarch64', 'AMD64': 'x86_64'}.get(platform.machine(), platform.machine())
    if arch != target['arch'] or ((platform.system() == 'Darwin') != (target['family'] == 'macos')):
        raise ValueError('Run packaging and runtime tests on the SDK host architecture and OS family')
    expected = {f'ase-engine-{target["id"]}{suffix}.tar.gz' for suffix in ('', '-sources')}
    entries = {item['name']: item for item in report['artifacts']}
    if not expected <= entries.keys():
        raise ValueError('The SDK is missing its matching binary/source archive pair')
    for name in expected:
        path = directory / name
        if not path.is_file() or path.stat().st_size != entries[name]['bytes'] or checksum(path) != entries[name]['sha256']:
            raise ValueError(f'SDK checksum mismatch: {name}')
    return report


def unpack_sdk(archive, destination, target):
    root = f'ase-engine-{target}'
    with tarfile.open(archive) as stream:
        members = stream.getmembers()
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != root:
                raise ValueError('Unsafe SDK archive path')
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise ValueError('Unsupported SDK archive entry')
            if member.issym() or member.islnk():
                link = PurePosixPath(member.linkname)
                resolved = ((destination / member.name).parent if member.issym() else destination) / member.linkname
                if link.is_absolute() or not resolved.resolve().is_relative_to((destination / root).resolve()):
                    raise ValueError('SDK link escapes its archive root')
        options = {'filter': 'data'} if hasattr(tarfile, 'data_filter') else {}
        stream.extractall(destination, members=members, **options)
    return destination / root


def make_archive(path, paths):
    temporary = path.with_name(path.name + '.partial')
    with tarfile.open(temporary, 'w:gz', compresslevel=1) as stream:
        for source, name in paths:
            stream.add(source, arcname=name)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk-artifact', type=Path, required=True)
    parser.add_argument('--dependency-sources', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sdk_directory, dependencies, output = [path.resolve() for path in
                                          (args.sdk_artifact, args.dependency_sources, args.output)]
    metadata = provenance()
    installer_sources = {'scripts/package.py', 'scripts/release_install.py', 'scripts/release-assets.py',
                         'scripts/install-release.sh.in', 'scripts/install-release.ps1',
                         'versioning.py', 'FORK.json', 'FORK.json.license'}
    if not installer_sources <= metadata['files'].keys():
        parser.error('Stage or commit the packaging sources before creating a source-paired package')
    report = Report(output, 'native-package', revision=metadata['git_sha'])
    try:
        engine_report = measure(report, 'verify-engine-inputs', lambda: sdk_inputs(sdk_directory))
        target = engine_report['target']['id']
        report.data['target'] = engine_report['target']
        from release_install import read_version
        identity = read_version(ROOT)
        report.data['version'] = identity['upstream_version']
        report.data['release'] = identity
        report.data['engine_run_id'] = engine_report.get('run_id')
        report.run('npm-install', ['npm', 'ci'])
        report.run('frontend-build', ['npm', 'run', 'build'], env=dict(os.environ,
                   ASE_FRONTEND_REPORT=str(output / 'frontend-inputs.json')))
        sources = measure(report, 'verify-frontend-sources', lambda: frontend_sources.verify(dependencies))
        metadata = provenance()
        report.data['studio_source_dirty'] = metadata['dirty']
        with tempfile.TemporaryDirectory(prefix='ase-studio-package-') as directory:
            work = Path(directory)
            folder = work / ('ase-studio-nunzio-' + target)
            folder.mkdir()
            macos = platform.system() == 'Darwin'
            app = folder / 'ASE Studio di Nunzio.app'
            resources = app / 'Contents/Resources' if macos else folder
            resources.mkdir(parents=True, exist_ok=True)
            engine = measure(report, 'unpack-engine', lambda: unpack_sdk(
                sdk_directory / f'ase-engine-{target}.tar.gz', work / 'sdk', target))
            engine.rename(resources / 'engine')
            engine = resources / 'engine'
            trim_engine(engine)
            studio = resources / 'ase_studio'
            measure(report, 'stage-studio', lambda: export_runtime(studio, metadata))
            if macos:
                executable = app / 'Contents/MacOS/ase-studio'
                executable.parent.mkdir()
                version = (ROOT / 'VERSION').read_text().strip()
                with (app / 'Contents/Info.plist').open('wb') as stream:
                    plistlib.dump(dict(CFBundleIdentifier='org.asestudio.Personal',
                        CFBundleName='ASE Studio di Nunzio', CFBundleDisplayName='ASE Studio di Nunzio',
                        CFBundleExecutable=executable.name, CFBundlePackageType='APPL',
                        CFBundleShortVersionString=version, CFBundleVersion=str(identity['fork_revision']),
                        ASEStudioReleaseTag=identity['release_tag'], ASEStudioFeaturePackage=identity['fork_name'],
                        LSMinimumSystemVersion='15.0', LSMultipleInstancesProhibited=True,
                        NSHighResolutionCapable=True, NSAppTransportSecurity={'NSAllowsLocalNetworking': True}), stream)
                report.run('native-build', ['xcrun', 'swiftc', '-swift-version', '5', '-O',
                    '-target', platform.machine() + '-apple-macosx15.0', '-framework', 'AppKit',
                    '-framework', 'WebKit', '-framework', 'UniformTypeIdentifiers',
                    'scripts/native-macos.swift', '-o', str(executable)])
                report.run('ad-hoc-sign', ['codesign', '--force', '--sign', '-', str(app)])
                report.run('verify-signature', ['codesign', '--verify', '--deep', '--strict', str(app)])
            else:
                executable = folder / 'ase-studio'
                executable.write_text(LAUNCHER)
                executable.chmod(0o755)
            readme = ('ASE Studio di Nunzio — modified personal fork\n\n'
                'Extract on the matching host platform. Projects and settings are stored outside the app.\n'
                'Linux: run ./ase-studio; install the host Python 3, make, GTK 3, PyGObject and WebKitGTK 4.1.\n'
                'macOS: open ASE Studio di Nunzio.app; this personal build is ad-hoc signed, not notarized.\n'
                'The SDK also requires the system/Homebrew shared libraries listed in engine/runtime-links.txt\n'
                'and engine/packages.txt (inside Contents/Resources on macOS). Nothing is compiled at startup.\n'
                'Windows: use the Ubuntu 24.04 x86-64 package inside WSL2 with WSLg; this is not a Windows .exe.\n'
                'Keep both matching source archives and all notices with any redistribution.\n'
                'Original authors, source provenance and licenses are in ase_studio/THIRD_PARTY.md and LICENSE.\n')
            (folder / 'README.txt').write_text(readme)
            shutil.copy2(ROOT / 'LICENSE', folder / 'LICENSE')
            source_tree = work / 'sources/project'
            export_code(source_tree, metadata)
            dependency_tree = work / 'sources/dependencies'
            dependency_tree.mkdir()
            for record in sources:
                shutil.copy2(dependencies / record['name'], dependency_tree / record['name'])
            (dependency_tree / 'sources-manifest.json').write_text(json.dumps(sources, indent=2) + '\n')
            (dependency_tree / 'sources-manifest.json.license').write_text('SPDX-License-Identifier: GPL-2.0-only\n')
            (work / 'sources/BUILD.txt').write_text(
                'The project directory contains the exact preferred Studio sources and build scripts.\n'
                'The dependencies directory supplies preferred editable upstream sources and npm inputs.\n'
                'Keep the matching ase-engine-TARGET-sources.tar.gz beside this archive.\n'
                'Install Node/npm and the native platform build/runtime tools described in project/RELEASES.md.\n'
                'From project/: python3 scripts/package.py --sdk-artifact /path/to/verified/engine/artifact '
                '--dependency-sources ../dependencies --output /new/output/directory\n'
                'To rebuild the engine, use the matching engine source archive and its project/ci recipes.\n')
            source_name = f'ase-studio-nunzio-{target}-sources.tar.gz'
            measure(report, 'studio-sources', lambda: make_archive(output / source_name, [(work / 'sources', 'sources')]))
            engine_source = f'ase-engine-{target}-sources.tar.gz'
            measure(report, 'engine-sources', lambda: shutil.copy2(sdk_directory / engine_source, output / engine_source))
            manifest = dict(target=target, version=report.data['version'], release_tag=identity['release_tag'], release=identity, studio_git_sha=metadata['git_sha'], engine_git_sha=engine_report.get('git_sha'),
                            studio_source_dirty=metadata['dirty'],
                            engine_run_id=engine_report.get('run_id'), omitted_assets=sorted(OMITTED),
                            sources=[source_name, engine_source], native_runtime_verified=True)
            (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            (folder / 'manifest.json.license').write_text('SPDX-License-Identifier: GPL-2.0-only\n')
            archive = output / (folder.name + ('.zip' if macos else '.tar.gz'))
            if macos:
                report.run('archive', ['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(folder), str(archive)])
            else:
                measure(report, 'archive', lambda: make_archive(archive, [(folder, folder.name)]))
            from release_install import Installation, extract_runtime
            installed = Installation(work / 'Installed Home With Spaces', macos=macos)
            # Never register CI launchers in the invoking user's XDG directory.
            installed.desktop = installed.home / '.local/share/applications' / installed.desktop.name
            installed.initialize()
            payload = extract_runtime(archive, work / 'final-archive', target)
            measure(report, 'install-final-archive', lambda: installed.install(payload, target, version=identity['release_tag']))
            folder = installed.current.resolve()
            app = folder / 'ASE Studio di Nunzio.app'
            resources = app / 'Contents/Resources' if macos else folder
            studio, engine = resources / 'ase_studio', resources / 'engine'
            executable = app / 'Contents/MacOS/ase-studio' if macos else folder / 'ase-studio'
            report.run('installed-backend', [sys.executable, 'scripts/smoke-package.py', '--studio', str(studio),
                '--engine', str(engine), '--python', str(engine / 'python/bin/python3.10'),
                '--output', str(output / 'runtime')], timeout=600)
            native_data = work / 'native-data'
            native_project = native_data / 'programs/native-smoke'
            native_project.mkdir(parents=True)
            (native_project / 'main.s').write_text('.text\n.globl _start\n_start:\n    li a0, 0\n    li a7, 93\n    ecall\n')
            (native_project / 'Makefile').write_text('include $(ASE_STUDIO_DEMO_MK)\n')
            if macos:
                native_command = [str(executable), '--smoke-application', '--test-data', str(native_data),
                    '--smoke-script', str(ROOT / 'scripts/native-smoke.js')]
            else:
                native_command = ['xvfb-run', '-a', str(executable), '--data', str(native_data),
                    '--port', '0', '--native-smoke-report', str(output / 'native-runtime.json'),
                    '--native-smoke-script', str(ROOT / 'scripts/native-smoke.js')]
            report.run('installed-native-window', native_command, timeout=120)
            if macos:
                report.run('verify-unchanged-app', ['codesign', '--verify', '--deep', '--strict', str(app)])
            artifacts = [output / source_name, output / engine_source, archive]
            report.data['artifacts'] = [dict(name=path.name, bytes=path.stat().st_size, sha256=checksum(path)) for path in artifacts]
            (output / 'SHA256SUMS').write_text(''.join(f'{item["sha256"]}  {item["name"]}\n' for item in report.data['artifacts']))
        report.finish('succeeded')
    except (OSError, ValueError, KeyError, RuntimeError, tarfile.TarError, subprocess.SubprocessError) as error:
        report.finish('failed', error)
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
