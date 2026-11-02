#!/usr/bin/env python3
# Modified in the personal fork on 2026-11-01: admit a source-paired AppImage only with matching final-artifact and Windows evidence.
# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-10-30: emit Abate identities and embed the shared version parser in standalone installers.
# Created in the personal fork on 2026-10-30: generate standalone installers and a source-paired index only from verified packages.
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('package_report', ROOT / 'scripts/package-report.py')
reports = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reports)
from release_install import digest, TARGETS, read_version
from release_security import sign_index


def render_installer():
    return ((ROOT / 'scripts/install-release.sh.in').read_text()
            + (ROOT / 'versioning.py').read_text() + "\nASE_VERSION_PYTHON\n"
            + "cat > \"$installer_work/release_security.py\" <<'ASE_SECURITY_PYTHON'\n"
            + (ROOT / 'release_security.py').read_text() + "\nASE_SECURITY_PYTHON\n"
            + "cat > \"$installer_work/release-public.pem\" <<'ASE_PUBLIC_KEY'\n"
            + (ROOT / 'release-public.pem').read_text() + "\nASE_PUBLIC_KEY\n"
            + "cat > \"$installer_work/release_install.py\" <<'ASE_RELEASE_PYTHON'\n"
            + (ROOT / 'scripts/release_install.py').read_text() + "\nASE_RELEASE_PYTHON\n"
            + '"$python_command" "$installer_work/release_install.py" "$@"\n')


def appimage_assets(evidence, output, version, revision):
    report = json.loads(evidence.read_text())
    if report.get('version') != version or report.get('git_sha') != revision:
        raise ValueError('AppImage evidence identity mismatch')
    runtime = report['runtime']
    required = {'install-final-appimage', 'managed-update-window', 'windows-wslg', 'windows-start-menu'}
    checks = report.get('checks', [])
    if not required.issubset({c['name'] for c in checks if c.get('status') == 'succeeded' and c.get('sha256') == runtime['sha256']}):
        raise ValueError('Missing final AppImage/Windows verification evidence')
    expected = {'ase-studio-nunzio-linux-appimage-x86_64.AppImage',
                'ase-studio-nunzio-linux-appimage-x86_64-sources.tar.gz',
                'ase-engine-linux-appimage-x86_64-sources.tar.gz'}
    records = [runtime, *report['sources']]
    if len(records) != 3 or {r['name'] for r in records} != expected or runtime['name'] != 'ase-studio-nunzio-linux-appimage-x86_64.AppImage':
        raise ValueError('Incomplete AppImage/source pair')
    files, cleaned = [], []
    for record in records:
        source = Path(record['path'])
        if source.stat().st_size != record['bytes'] or digest(source) != record['sha256']:
            raise ValueError('AppImage evidence artifact mismatch')
        target = output / record['name']
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        files.append((target, record['sha256']))
        cleaned.append({k: record[k] for k in ('name', 'bytes', 'sha256')})
    return {'id': 'linux-appimage-x86_64', 'runtime': cleaned[0], 'sources': cleaned[1:]}, files


def generate(artifacts, output, version, revision, appimage_evidence=None):
    identity = read_version(ROOT)
    if version != identity['release_tag']:
        raise ValueError('Release tag must match VERSION and FORK.json')
    report = reports.read(output / 'build-report.json')
    if report['git_sha'] != revision:
        raise ValueError('Release report revision mismatch')
    files = reports.verify_archives(report, artifacts)
    rows = []
    for row in report['targets']:
        target = row['target']
        if target == 'windows-wsl2-x86_64':
            continue
        if target not in TARGETS or row['status'] != 'succeeded':
            raise ValueError('Unsupported or failed target')
        package = row['package']
        if (package.get('version') != identity['upstream_version'] or package.get('release') != identity
                or not reports.stages_ok(package, {'install-final-archive', 'prepare-managed-update', 'managed-update-window'})):
            raise ValueError('Missing installed final-archive evidence or version mismatch')
        assets = package['artifacts']
        runtime = next(item for item in assets if '-sources.' not in item['name'])
        rows.append(dict(id=target, runtime=runtime, sources=[item for item in assets if item != runtime]))
    if appimage_evidence:
        appimage_row, extra_files = appimage_assets(appimage_evidence, output, version, revision)
        if any(row['id'] == appimage_row['id'] for row in rows):
            raise ValueError('Duplicate AppImage target')
        rows.append(appimage_row)
        files += extra_files
    index = output / 'targets.json'
    index.write_text(json.dumps(dict(schema_version=3, version=version, git_sha=revision, targets=rows, **identity), indent=2) + '\n')
    signature = output / 'targets.json.sig'
    key = os.environ.get('ASE_RELEASE_SIGNING_KEY_FILE')
    if not key:
        raise ValueError('A dedicated release signing key is required')
    sign_index(index, signature, Path(key))
    bash = output / 'install-release.sh'
    bash.write_text(render_installer())
    bash.chmod(0o755)
    powershell = output / 'install-release.ps1'
    shutil.copy2(ROOT / 'scripts/install-release.ps1', powershell)
    # The standalone scripts carry SPDX notices; distribute the GPL text alongside them.
    license_file = output / 'LICENSE'
    shutil.copy2(ROOT / 'LICENSE', license_file)
    notice = output / 'targets.json.license'
    notice.write_text('SPDX-License-Identifier: GPL-2.0-only\nGenerated by scripts/release-assets.py, created in the personal fork on 2026-10-30: verified release target index.\n')
    files += [(p, digest(p)) for p in (index, signature, notice, bash, powershell, license_file)]
    (output / 'SHA256SUMS').write_text(''.join(f'{value}  {path.name}\n' for path, value in files))
    (output / 'release-files.txt').write_text(''.join(str(path) + '\n' for path, _ in files))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--appimage-evidence', type=Path)
    args = parser.parse_args()
    generate(args.artifacts, args.output, args.version, args.revision, args.appimage_evidence)


if __name__ == '__main__':
    main()
