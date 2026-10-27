#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-28: test an installed Studio/SDK through its real HTTP API and disposable projects.
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def utc():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--studio', type=Path, required=True)
    parser.add_argument('--engine', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--python', type=Path)
    args = parser.parse_args()
    studio, engine, output = (p.resolve() for p in (args.studio, args.engine, args.output))
    if output.exists() and any(output.iterdir()):
        parser.error('Choose a new output directory')
    output.mkdir(parents=True, exist_ok=True)
    report = dict(status='running', started_at=utc(), checks=[])
    started = time.monotonic()
    def save():
        (output / 'runtime-report.json').write_text(json.dumps(report, indent=2) + '\n')
    save()
    url = None
    server = None
    def request(path, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = Request(url + path, data=data, headers={'Content-Type': 'application/json'})
        try:
            with urlopen(req, timeout=120) as response:
                return json.load(response)
        except HTTPError as error:
            raise RuntimeError(error.read().decode()) from error
    try:
        with tempfile.TemporaryDirectory(prefix='ase-packaged-projects-') as directory, \
                (output / 'server.log').open('w') as log:
            data = Path(directory) / 'User Projects With Spaces'
            env = os.environ.copy()
            for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH'):
                env.pop(key, None)
            if args.python:
                env.update(PYTHONHOME=str(engine / 'python'),
                           LD_LIBRARY_PATH=str(engine / 'python/lib'),
                           DYLD_LIBRARY_PATH=str(engine / 'python/lib'))
            command = [str(args.python or sys.executable), str(studio / 'portable.py'), '--server',
                       '--engine', str(engine), '--data', str(data)]
            server = subprocess.Popen(command, env=env, cwd=directory, text=True,
                                      stdout=subprocess.PIPE, stderr=log, start_new_session=True)
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(server.stdout, selectors.EVENT_READ)
                    if not selector.select(timeout=45):
                        raise RuntimeError('Packaged server did not become ready within 45 seconds')
                    line = server.stdout.readline().strip()
                match = re.fullmatch(r'ASE Studio: (http://127\.0\.0\.1:\d+)', line)
                if not match:
                    raise RuntimeError(f'Packaged server failed to start: {line!r}')
                url = match[1]
                if not request('/api/health')['ok']:
                    raise RuntimeError('Health endpoint rejected the packaged runtime')
                with urlopen(url + '/vendor/editor.js', timeout=10) as response:
                    if len(response.read()) < 1000:
                        raise RuntimeError('Packaged editor assets are missing')
                for name, body, register, expected in (
                        ('arithmetic', '    li t0, 7\n    addi t1, t0, 3\n    mul t2, t0, t1', 'x7', 70),
                        ('loop', '    li t0, 3\nLoop:\n    addi t0, t0, -1\n    bnez t0, Loop', 'x5', 0)):
                    request('/api/projects', {'name': name})
                    source = request('/api/project?name=' + name)['text'].replace(
                        '    # Write your RISC-V assembly here.', body)
                    for cpu in ('in-order', 'out-of-order'):
                        for memory in ('direct', 'cache'):
                            check = dict(name=f'{name}-{cpu}-{memory}', started_at=utc(), status='running')
                            report['checks'].append(check)
                            save()
                            check_start = time.monotonic()
                            config = request('/api/config?name=' + name)
                            config.update(cpu=cpu, memoryMode=memory, intMul=8)
                            request('/api/config', {'name': name, 'config': config})
                            result = request('/api/run', {'name': name, 'text': source})
                            (output / (check['name'] + '.log')).write_text(result.get('advancedOutput', ''))
                            if not result['ok']:
                                raise RuntimeError(f"{check['name']}: {result}")
                            trace = request('/api/pipeline?name=' + name)
                            if trace['cycles'] <= 0:
                                raise RuntimeError(f"{check['name']}: empty pipeline")
                            if cpu == 'in-order' and len(trace.get('initialRegisters', {})) != 64:
                                raise RuntimeError(f"{check['name']}: missing initial register snapshot")
                            state = dict(trace.get('initialRegisters', {}))
                            for cycle in sorted(trace['registerDeltas'], key=int):
                                state.update(trace['registerDeltas'][cycle])
                            if int(state.get(register, '-1'), 16) != expected:
                                raise RuntimeError(f"{check['name']}: incorrect final {register}: {state.get(register)}")
                            check.update(status='succeeded', finished_at=utc(),
                                         wall_seconds=time.monotonic() - check_start,
                                         final_register=register, final_value=state[register])
                            save()
                            print('PASS', check['name'], state[register], flush=True)
                request('/api/shutdown', {})
                server.wait(timeout=15)
                if server.returncode:
                    raise RuntimeError(f'Packaged server exited with {server.returncode}')
            finally:
                if server.poll() is None:
                    if url:
                        try:
                            request('/api/shutdown', {})
                        except Exception:
                            pass
                    try:
                        server.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        server.terminate()
                        try:
                            server.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            server.kill()
                            server.wait()
                server.stdout.close()
        report['status'] = 'succeeded'
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        report.update(status='failed', error=str(error))
        print(error, file=sys.stderr)
    finally:
        report.update(finished_at=utc(), wall_seconds=time.monotonic() - started)
        save()
    return 0 if report['status'] == 'succeeded' else 1


if __name__ == '__main__':
    sys.exit(main())
