#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-10-30: require consistent upstream and named fork identities throughout build evidence.
# Modified in the personal fork on 2026-10-30: require final-archive installation evidence before preparing a release.
# Created in the personal fork on 2026-10-28: aggregate package/runtime/source-rebuild evidence and verify release archive integrity.
"""Report the complete selected matrix; never infer success from missing evidence."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(1, str(ROOT))
from versioning import read_version

RUNTIME_CHECKS = {f'{program}-{cpu}-{memory}' for program in ('arithmetic', 'loop')
                  for cpu in ('in-order', 'out-of-order') for memory in ('direct', 'cache')}


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def backend_ok(record):
    checks = record.get('checks', [])
    return (record.get('status') == 'succeeded' and len(checks) == len(RUNTIME_CHECKS)
            and {item['name'] for item in checks} == RUNTIME_CHECKS
            and all(item['status'] == 'succeeded' for item in checks))


def stages_ok(record, required):
    passed = {item['name'] for item in record.get('stages', []) if item['status'] == 'succeeded'}
    return required <= passed


def job_time(job, name):
    return job.get(name + '_at', job.get(name + 'At'))


def job_seconds(job):
    start, end = job_time(job, 'started'), job_time(job, 'completed')
    if not start or not end or end.startswith('0001-'):
        return None
    return (datetime.fromisoformat(end.replace('Z', '+00:00'))
            - datetime.fromisoformat(start.replace('Z', '+00:00'))).total_seconds()


def aggregate(artifacts, matrix, jobs, revision):
    identity = read_version(ROOT)
    rows = []
    selected = [item['id'] for item in matrix['include']]
    if not selected or len(set(selected)) != len(selected) or any(not re.fullmatch(r'[a-z0-9_.-]+', x) for x in selected):
        raise ValueError('Invalid target matrix')
    for target in selected:
        row = dict(target=target, status='failed', errors=[])
        rows.append(row)
        root = artifacts / ('studio-report-' + target)
        try:
            package = read(root / 'studio-output/report.json')
            row['package'] = package
            row['backend'] = read(root / 'studio-output/runtime/runtime-report.json')
            row['fetch'] = read(root / 'engine-input/fetch-report.json')
            if (package['status'] != 'succeeded' or package['git_sha'] != revision
                    or package['studio_source_dirty'] or package['target']['id'] != target
                    or package.get('version') != identity['upstream_version']
                    or package.get('release') != identity):
                row['errors'].append('Package status, revision, target or release identity mismatch')
            if not backend_ok(row['backend']):
                row['errors'].append('Incomplete or failed installed backend checks')
            required = {'install-final-archive', 'installed-backend', 'installed-native-window', 'verify-frontend-sources',
                        'studio-sources', 'engine-sources', 'archive'}
            macos = target.startswith('macos-')
            if macos:
                required |= {'native-build', 'ad-hoc-sign', 'verify-signature', 'verify-unchanged-app'}
            else:
                row['native'] = read(root / 'studio-output/native-runtime.json')
                if row['native']['status'] != 'succeeded' or not row['native']['backend_stopped']:
                    row['errors'].append('Native editor or backend shutdown failed')
            if not stages_ok(package, required) or row['fetch']['status'] != 'succeeded':
                row['errors'].append('Required package or SDK verification phase missing/failed')
            expected = {f'ase-studio-nunzio-{target}' + ('.zip' if macos else '.tar.gz'),
                        f'ase-studio-nunzio-{target}-sources.tar.gz', f'ase-engine-{target}-sources.tar.gz'}
            assets = package.get('artifacts', [])
            if ({item['name'] for item in assets} != expected or len(assets) != 3
                    or any(item['bytes'] <= 0 or not re.fullmatch(r'[0-9a-f]{64}', item['sha256']) for item in assets)):
                row['errors'].append('Missing or invalid application/source archive metadata')
            if macos or target == 'ubuntu-24.04-x86_64':
                rebuild = read(root / 'studio-output/source-rebuild/report.json')
                row['source_rebuild'] = rebuild
                verification = read(root / 'studio-output/source-rebuild/verification/report.json')
                if (rebuild['status'] != 'succeeded' or rebuild['git_sha'] != revision
                        or rebuild.get('source_files_verified', 0) <= 0
                        or not stages_ok(rebuild, {'rebuild-and-test'})
                        or rebuild['source_archive'] not in assets
                        or verification['status'] != 'succeeded' or verification['git_sha'] != revision
                        or verification['studio_source_dirty'] or verification['target']['id'] != target
                        or verification.get('release') != identity
                        or not stages_ok(verification, required)):
                    row['errors'].append('Source-archive rebuild failed or changed the sources')
            job = next(j for j in jobs if j['name'].startswith('package (' + target + ','))
            row['job'] = job
            row['job_wall_seconds'] = job_seconds(job)
            if job['status'] != 'completed' or job['conclusion'] != 'success':
                row['errors'].append('GitHub package job did not succeed')
        except (OSError, ValueError, KeyError, TypeError, StopIteration) as error:
            row['errors'].append('Missing/invalid evidence: ' + str(error))
        if not row['errors']:
            row['status'] = 'succeeded'
    if 'ubuntu-24.04-x86_64' in selected:
        row = dict(target='windows-wsl2-x86_64', status='failed', errors=[])
        rows.append(row)
        root = artifacts / 'studio-report-windows-wsl2-x86_64'
        try:
            row['package'] = read(root / 'report.json')
            row['backend'] = read(root / 'runtime/backend/runtime-report.json')
            row['native'] = read(root / 'runtime/native-runtime.json')
            if (row['package']['status'] != 'succeeded'
                    or row['package']['source_artifact']['git_sha'] != revision
                    or not backend_ok(row['backend']) or row['native']['status'] != 'succeeded'
                    or not row['native']['backend_stopped']):
                row['errors'].append('Windows WSL2 backend/native checks did not pass')
            job = next(j for j in jobs if j['name'] == 'windows-wsl')
            row['job'], row['job_wall_seconds'] = job, job_seconds(job)
            if job['status'] != 'completed' or job['conclusion'] != 'success':
                row['errors'].append('GitHub Windows job did not succeed')
        except (OSError, ValueError, KeyError, TypeError, StopIteration) as error:
            row['errors'].append('Missing/invalid Windows evidence: ' + str(error))
        if not row['errors']:
            row['status'] = 'succeeded'
    sources_passed = any(j['name'] == 'sources' and j['status'] == 'completed'
                         and j['conclusion'] == 'success' for j in jobs)
    return dict(git_sha=revision, release=identity, generated_at=datetime.now(timezone.utc).isoformat(),
                all_succeeded=sources_passed and all(row['status'] == 'succeeded' for row in rows),
                targets=rows, jobs=jobs,
                notes=['Jobs execute in parallel; durations must not be added to infer workflow elapsed time.',
                       'Job timestamps include preparation/transfers. Package phases exclude those costs.',
                       'This snapshot precedes the report upload and any subsequent draft-release job.',
                       'Windows uses WSL2 with GTK/WebKit under Xvfb; host WSLg integration is not certified.'])


def markdown(report):
    lines = ['# Studio package build report', '', f'Commit: `{report["git_sha"]}`', '',
             f'Release: **{report["release"]["display_version"]}** · `{report["release"]["release_tag"]}`', '',
             f'All selected targets verified: **{report["all_succeeded"]}**', '',
             '| Target | Status | Measured package/test seconds | GitHub job seconds |',
             '| --- | --- | ---: | ---: |']
    for row in report['targets']:
        measured = row.get('package', {}).get('wall_seconds', 0)
        job = row.get('job_wall_seconds')
        lines.append(f'| {row["target"]} | {row["status"]} | {measured:.3f} | {job if job is not None else "unavailable"} |')
    lines += ['', *['- ' + note for note in report['notes']]]
    for row in report['targets']:
        lines += ['', '## ' + row['target'], '']
        lines += [f'- {error}' for error in row['errors']]
        lines += ['', '| Phase | Start UTC | End UTC | Seconds | Status |', '| --- | --- | --- | ---: | --- |']
        phases = list(row.get('package', {}).get('stages', []))
        if row.get('fetch'):
            phases.insert(0, dict(row['fetch'], name='download-verified-sdk'))
        if row.get('source_rebuild'):
            phases.append(dict(row['source_rebuild'], name='source-archive-rebuild'))
        for phase in phases:
            lines.append(f'| {phase["name"]} | {phase.get("started_at", "")} | {phase.get("finished_at", "")} | '
                         f'{phase.get("wall_seconds", 0):.3f} | {phase["status"]} |')
    return '\n'.join(lines) + '\n'


def verify_archives(report, artifacts):
    if report['all_succeeded'] is not True:
        raise ValueError('Every selected target must pass before a release')
    files = []
    for row in report['targets']:
        if row['target'] == 'windows-wsl2-x86_64':
            continue
        for item in row['package']['artifacts']:
            name = item['name']
            if Path(name).name != name:
                raise ValueError('Invalid release asset name')
            path = artifacts / ('studio-' + row['target']) / name
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
            if path.stat().st_size != item['bytes'] or digest.hexdigest() != item['sha256']:
                raise ValueError('Release archive checksum mismatch: ' + name)
            files.append((path, item['sha256']))
    if not files:
        raise ValueError('No application/source archives to release')
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--matrix', type=Path)
    parser.add_argument('--jobs', type=Path)
    parser.add_argument('--revision', default=os.getenv('GITHUB_SHA'))
    parser.add_argument('--verify-release', action='store_true')
    args = parser.parse_args()
    if args.verify_release:
        report = read(args.output / 'build-report.json')
        if not args.revision or report['git_sha'] != args.revision:
            raise ValueError('Release report does not match the current revision')
        files = verify_archives(report, args.artifacts)
        (args.output / 'SHA256SUMS').write_text(''.join(f'{digest}  {path.name}\n' for path, digest in files))
        (args.output / 'release-files.txt').write_text(''.join(str(path) + '\n' for path, _ in files))
        print(f'Verified {len(files)} application/source archives for release')
        return
    if not args.matrix or not args.jobs or not args.revision:
        parser.error('Supply --matrix, --jobs and the expected --revision')
    data = read(args.jobs)
    jobs = data.get('jobs', []) if isinstance(data, dict) else [job for page in data for job in page['jobs']]
    report = aggregate(args.artifacts, read(args.matrix), jobs, args.revision)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'build-report.json').write_text(json.dumps(report, indent=2) + '\n')
    (args.output / 'build-report.md').write_text(markdown(report))
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write('release_ready=' + str(report['all_succeeded']).lower() + '\n')


if __name__ == '__main__':
    main()
