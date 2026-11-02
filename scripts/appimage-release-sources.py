#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-11-02: collect exact source pairs and report their hashes for the managed AppImage release.
import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
from package import ROOT, provenance, export_code, checksum, sdk_inputs
sys.path.insert(0,str(ROOT))
from versioning import read_version

spec=importlib.util.spec_from_file_location('appimage_sources',ROOT/'scripts/appimage-sources.py')
sources=importlib.util.module_from_spec(spec);spec.loader.exec_module(sources)
parser=argparse.ArgumentParser()
parser.add_argument('--sdk',type=Path,required=True)
parser.add_argument('--build',type=Path,required=True)
parser.add_argument('--cache',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
metadata=provenance()
build=json.loads((args.build/'build/report.json').read_text())
if metadata['dirty'] or build['studio']!=metadata:
    raise ValueError('Source archive must match a clean AppImage build checkout exactly')
sdk_inputs(args.sdk)
args.output.mkdir(parents=True,exist_ok=True)
for label,lock in [('distribution','ubuntu-sources.lock.json'),('appimage-runtime','runtime-sources.lock.json')]:
    destination=args.cache/label;destination.mkdir(parents=True,exist_ok=True)
    rows=json.loads((ROOT/'packaging/appimage'/lock).read_text())
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(lambda row:sources.transfer(row,destination),rows))
frontend=args.cache/'frontend'
subprocess.run(['python3',str(ROOT/'scripts/frontend-sources.py'),'--output',str(frontend)],check=True)
image=args.output/'ase-studio-nunzio-linux-appimage-x86_64.AppImage'
shutil.copy2(args.build/'ASE-Studio-experimental-x86_64.AppImage',image)
studio=args.output/'ase-studio-nunzio-linux-appimage-x86_64-sources.tar.gz'
with tempfile.TemporaryDirectory(prefix='ase-source-') as directory:
    exported=Path(directory)/'ase-studio';export_code(exported,metadata)
    with tarfile.open(studio,'w:gz',compresslevel=1) as archive:
        archive.add(exported,arcname='ase-studio')
        for label in ('distribution','appimage-runtime','frontend'):
            archive.add(args.cache/label,arcname='sources/'+label)
engine=args.output/'ase-engine-linux-appimage-x86_64-sources.tar.gz'
shutil.copy2(args.sdk/'ase-engine-ubuntu-22.04-x86_64-sources.tar.gz',engine)
def record(path):
    return {'name':path.name,'bytes':path.stat().st_size,'sha256':checksum(path),'path':str(path.resolve())}
report={'version':read_version(ROOT)['release_tag'],'git_sha':metadata['git_sha'],'runtime':record(image),'sources':[record(studio),record(engine)]}
(args.output/'appimage-assets.json').write_text(json.dumps(report,indent=2)+'\n')
print('Verified AppImage runtime and exact corresponding sources are ready for Windows evidence and signing')
