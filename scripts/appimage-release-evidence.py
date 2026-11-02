#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-11-02: bind Windows desktop evidence to the exact source-paired AppImage before release signing.
import argparse
import json
from pathlib import Path
from package import checksum

parser=argparse.ArgumentParser()
parser.add_argument('--artifacts',type=Path,required=True)
parser.add_argument('--revision',required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
source=args.artifacts/'managed-appimage-sources'
report=json.loads((source/'appimage-assets.json').read_text())
windows=json.loads((args.artifacts/'windows-appimage-evidence/windows-appimage.json').read_text(encoding='utf-8-sig'))
if report['git_sha']!=args.revision or windows['git_sha']!=args.revision or windows['status']!='succeeded' or windows['sha256']!=report['runtime']['sha256']:
    raise ValueError('Windows evidence does not match this release revision and runtime')
for record in [report['runtime'],*report['sources']]:
    if Path(record['name']).name!=record['name']:
        raise ValueError('Invalid artifact name')
    path=source/record['name']
    if path.stat().st_size!=record['bytes'] or checksum(path)!=record['sha256']:
        raise ValueError('Source-paired artifact changed after its checks')
    record['path']=str(path.resolve())
report['checks']=windows['checks']
report['notes']=windows['notes']
args.output.write_text(json.dumps(report,indent=2)+'\n')
