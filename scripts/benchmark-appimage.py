#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-11-01: compare final images using alternating runs of the same compiler/simulator assertions.
"""Warm-cache comparison in one environment, not a universal performance guarantee."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import statistics
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--appimage', type=Path, nargs='+', required=True)
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.rounds < 2 or args.output.exists():
        parser.error('Use at least two rounds and a new output directory')
    args.output.mkdir(parents=True)
    images = [path.resolve() for path in args.appimage]
    rows = []
    # Keep an explicit unmeasured warm-up for every artifact, including new ones.
    # Clearing system-wide caches would disturb other work in the environment.
    for number in range(-1, args.rounds):
        order = list(enumerate(images))
        if number % 2:
            order.reverse()
        for index, image in order:
            output = args.output.resolve() / f'image-{index}-round-{number}'
            with output.with_suffix('.log').open('w') as log:
                subprocess.run([sys.executable, str(Path(__file__).with_name('smoke-package.py')),
                    '--appimage', str(image), '--output', str(output)],
                    stdout=log, stderr=subprocess.STDOUT, timeout=180, check=True)
            result = json.loads((output / 'runtime-report.json').read_text())
            assert result['status'] == 'succeeded'
            row = {'image': str(image), 'round': number, 'bytes': image.stat().st_size,
                   'startup_seconds': (datetime.fromisoformat(result['checks'][0]['started_at']) -
                                       datetime.fromisoformat(result['started_at'])).total_seconds(),
                   'workload_seconds': sum(check['wall_seconds'] for check in result['checks']),
                   'total_seconds': result['wall_seconds']}
            rows.append(row)
            print(json.dumps(row), flush=True)
            (args.output / 'runs.json').write_text(json.dumps(rows, indent=2) + '\n')
    summary = []
    for image in images:
        runs = [row for row in rows if row['image'] == str(image) and row['round'] >= 0]
        summary.append({'image': str(image), 'bytes': image.stat().st_size,
            **{name: statistics.median(row[name] for row in runs)
               for name in ('startup_seconds', 'workload_seconds', 'total_seconds')}})
    (args.output / 'summary.json').write_text(json.dumps({
        'status': 'succeeded', 'rounds': args.rounds,
        'scope': 'One warm-up (round -1), then alternating extract-and-run tests; includes 8 correct compiler/simulator combinations per run. OS caches are not cleared. No FUSE or hardware desktop benchmark.',
        'medians': summary}, indent=2) + '\n')


if __name__ == '__main__':
    main()
