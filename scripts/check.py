#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-27: timed Studio checks using disposable browser fixtures.
"""Check the frontend without requiring or rebuilding the simulator SDK."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import re
import selectors
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def utc():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


class Report:
    def __init__(self, output, browser):
        if output.exists() and any(output.iterdir()):
            raise ValueError('Choose a new output directory; existing reports are not overwritten')
        output.mkdir(parents=True, exist_ok=True)
        self.output = output
        self.data = dict(started_at=utc(), status='running', browser=browser,
                         platform=platform.platform(), python=sys.version,
                         git_sha=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                         stages=[])
        self.started = time.monotonic()
        self.save()

    def save(self):
        (self.output / 'report.json').write_text(json.dumps(self.data, indent=2) + '\n')
        lines = ['# Studio checks', '', f"Status: **{self.data['status']}**", '',
                 '| Phase | Start (UTC) | End (UTC) | Seconds | Status |',
                 '| --- | --- | --- | ---: | --- |']
        for stage in self.data['stages']:
            lines.append(f"| {stage['name']} | {stage['started_at']} | {stage.get('finished_at', '')} | "
                         f"{stage.get('wall_seconds', 0):.3f} | {stage['status']} |")
        (self.output / 'report.md').write_text('\n'.join(lines) + '\n')

    def run(self, name, command, timeout=600, env=None):
        stage = dict(name=name, command=command, started_at=utc(), status='running', log=f'{name}.log')
        self.data['stages'].append(stage)
        self.save()
        started = time.monotonic()
        print(f"{stage['started_at']} {name}", flush=True)
        try:
            with (self.output / stage['log']).open('w') as log:
                result = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
                                        timeout=timeout, check=True)
            stage.update(status='succeeded', exit_code=result.returncode)
        except BaseException as error:
            stage.update(status='failed', error=str(error), exit_code=getattr(error, 'returncode', None))
            if isinstance(error, subprocess.TimeoutExpired):
                stage['status'] = 'timed_out'
            log = self.output / stage['log']
            if log.exists():
                print(log.read_text(errors='replace')[-4000:], file=sys.stderr)
            raise
        finally:
            stage.update(finished_at=utc(), wall_seconds=time.monotonic() - started)
            self.save()

    def finish(self, status, error=None):
        self.data.update(status=status, error=str(error) if error else None,
                         finished_at=utc(), wall_seconds=time.monotonic() - self.started)
        self.save()


def webkit(report):
    env = dict(os.environ, ASE_TEST_SERVE_ONLY='1')
    log = (report.output / 'browser-harness.log').open('w')
    server = subprocess.Popen(['node', 'tests/browser.mjs'], cwd=ROOT, env=env,
                              stdout=subprocess.PIPE, stderr=log, text=True)
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(server.stdout, selectors.EVENT_READ)
            if not selector.select(timeout=60):
                raise RuntimeError('Editor harness did not become ready within 60 seconds')
            url = server.stdout.readline().strip()
        if not re.fullmatch(r'http://127\.0\.0\.1:\d+/harness', url):
            raise RuntimeError(f'Editor harness failed to start: {url!r}')
        report.run('webkitgtk', ['xvfb-run', '-a', sys.executable, 'tests/webkit.py', url], timeout=90)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
        server.stdout.close()
        log.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', choices=('chromium', 'webkitgtk'), default='chromium')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = Report(args.output.resolve(), args.browser)
    try:
        report.run('npm-install', ['npm', 'ci'])
        report.run('frontend-build', ['npm', 'run', 'build'])
        report.run('backend', [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v'])
        report.run('editor-unit', ['npm', 'test'])
        if args.browser == 'chromium':
            if not os.getenv('CHROMIUM_PATH'):
                report.run('browser-install', ['npx', '--no-install', 'playwright', 'install', 'chromium'])
            report.run('chromium', ['npm', 'run', 'test:browser'], timeout=120)
        else:
            webkit(report)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        report.finish('failed', error)
        print(error, file=sys.stderr)
        return 1
    report.finish('succeeded')
    return 0


if __name__ == '__main__':
    sys.exit(main())
