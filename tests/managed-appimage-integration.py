#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-11-02: optionally retain the tested installation for Windows Start-menu checks.
# Created in the personal fork on 2026-11-01: verify final AppImage activation, native readiness and failure preservation in an isolated real home.
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
sys.path.insert(0,str(ROOT))
import release_install as installer
import updates

parser=argparse.ArgumentParser()
parser.add_argument('--appimage',type=Path,required=True)
parser.add_argument('--report',type=Path,required=True)
parser.add_argument('--keep-installed',action='store_true')
args=parser.parse_args()
installation=installer.Installation()
assert not installation.root.exists(), 'Run only in a fresh disposable user account'
results=[]
with tempfile.TemporaryDirectory(prefix='managed-appimage-') as temporary:
    work=Path(temporary)
    payload=installer.extract_runtime(args.appimage,work/'first',installer.APPIMAGE_TARGET)
    # A bootstrap AppImage leaves APPDIR in its child's environment. Installed
    # launchers must resolve themselves instead of accidentally using that image.
    os.environ['APPDIR']=str(work/'unrelated-bootstrap')
    identity=installer.read_version(payload/'ase_studio')
    data=Path.home()/'.local/share/ase-studio-nunzio'
    data.mkdir(parents=True);(data/'keep-project.txt').write_text('preserved')
    with installation.lock(),installation.sessions(exclusive=True):
        installed=installation.install(payload,installer.APPIMAGE_TARGET,identity['release_tag'])
    assert installation.current.resolve()==installed
    results.append('real compiler, backend and GTK/WebKit checks before activation')
    results.append('installed launcher ignores inherited bootstrap APPDIR')
    candidate=installer.extract_runtime(args.appimage,work/'second',installer.APPIMAGE_TARGET)
    def fail(*_):raise RuntimeError('injected startup failure')
    with installation.lock(),installation.sessions(exclusive=True):
        try:installation.install(candidate,installer.APPIMAGE_TARGET,identity['release_tag'],check=fail)
        except RuntimeError:pass
        else:raise AssertionError('Expected activation rejection')
    assert installation.current.resolve()==installed
    assert len(list(installation.root.glob('version-*')))==1
    results.append('failed replacement preserves current and removes incomplete candidate')
    prepared=installer.extract_runtime(args.appimage,work/'prepared',installer.APPIMAGE_TARGET)
    with installation.lock(),installation.sessions(exclusive=True):
        replacement=installation.install(prepared,installer.APPIMAGE_TARGET,identity['release_tag'],activate=False)
    assert installation.current.resolve()==installed
    script=work/'ready.js'
    # Keep the real window alive long enough for its asynchronous ready handshake.
    script.write_text("window.__testStarted ??= performance.now(); JSON.stringify({ready:performance.now()-window.__testStarted>2000 && document.readyState==='complete' && typeof window.aseHasUnsavedChanges==='function'})")
    report=work/'supervised-window.json'
    assert updates.launch(installation,['--data',str(work/'session-data'),'--port','0',
                          '--native-smoke-report',str(report),'--native-smoke-script',str(script)])==0
    assert json.loads(report.read_text())['status']=='succeeded'
    assert installation.current.resolve()==replacement
    assert installed.exists() and not (installation.root/'activation.json').exists()
    results.append('prepared AppImage activated by existing supervisor after real native readiness; previous version retained')
    if not args.keep_installed:
        with installation.lock(),installation.sessions(exclusive=True):installation.uninstall()
        assert (data/'keep-project.txt').read_text()=='preserved'
        assert not installation.current.exists()
        results.append('offline uninstall preserves data')
args.report.write_text(json.dumps({'status':'succeeded','checks':results},indent=2)+'\n')
print('PASS real managed AppImage integration')
