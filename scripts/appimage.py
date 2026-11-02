#!/usr/bin/env python3
# Modified in the personal fork on 2026-11-01: avoid host env/systemd ABI conflicts when launching gem5 on newer distributions.
# Modified in the personal fork on 2026-11-01: include managed-installation identity and the stable supervisor launcher.
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-31: stage an AppImage with a verified engine and private Ubuntu runtime libraries.
# Modified in the personal fork on 2026-11-01: strip only staged host compiler symbols and retain an audit of the transformation.
"""Build inside the pinned Ubuntu container; no runtime package installation."""
import argparse
import fnmatch
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from package import ROOT, provenance, export_runtime, sdk_inputs, unpack_sdk, trim_engine, checksum

APP_ID = 'io.github.nunzioricci2000.ASEStudio'
EXCLUDED = ('libc.so*', 'libm.so*', 'libmvec.so*', 'libpthread.so*', 'libdl.so*',
            'librt.so*', 'libresolv.so*', 'libnss_*.so*', 'libanl.so*', 'libutil.so*',
            'ld-linux*', '*.a', '*.o', '*.h', '*.pc', '__pycache__')
LAUNCHER = '''#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-31: start the self-contained AppImage runtime.
set -eu
# Resolve this launcher, including when invoked by an outer AppImage installer.
app_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export ASE_STUDIO_APPDIR="$app_dir"
export PATH="$app_dir/usr/bin:$PATH"
export LD_LIBRARY_PATH="$app_dir/usr/lib/x86_64-linux-gnu:$app_dir/usr/lib"
export PYTHONHOME="$app_dir/usr"
export PYTHONPATH="$app_dir/usr/lib/python3/dist-packages"
export PYTHONDONTWRITEBYTECODE=1
export GI_TYPELIB_PATH="$app_dir/usr/lib/x86_64-linux-gnu/girepository-1.0"
export GSETTINGS_SCHEMA_DIR="$app_dir/usr/share/glib-2.0/schemas"
export XDG_DATA_DIRS="$app_dir/usr/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
export WEBKIT_EXEC_PATH="$app_dir/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"
export WEBKIT_INJECTED_BUNDLE_PATH="$WEBKIT_EXEC_PATH/injected-bundle"
export GST_PLUGIN_SYSTEM_PATH_1_0="$app_dir/usr/lib/x86_64-linux-gnu/gstreamer-1.0"
export GST_PLUGIN_SCANNER_1_0="$app_dir/usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"
export GIO_MODULE_DIR="$app_dir/usr/lib/x86_64-linux-gnu/gio/modules"
export GDK_PIXBUF_MODULEDIR="$app_dir/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders"
export LIBGL_DRIVERS_PATH="$app_dir/usr/lib/x86_64-linux-gnu/dri"
exec "$app_dir/usr/bin/python3.10" "$app_dir/ase_studio/appimage_runtime.py" "$@"
'''


def stage(args):
    if sys.platform != 'linux' or os.uname().machine != 'x86_64':
        raise ValueError('This first verified build target is Linux x86_64')
    if 'VERSION_ID="22.04"' not in Path('/etc/os-release').read_text():
        raise ValueError('Build using the pinned Ubuntu 22.04 container')
    output = args.output.resolve()
    if output.exists():
        raise ValueError('Choose a new output directory; existing artifacts are preserved')
    output.mkdir(parents=True)
    engine_report = sdk_inputs(args.sdk.resolve())
    if engine_report['target']['id'] != 'ubuntu-22.04-x86_64':
        raise ValueError('Use the pinned Ubuntu 22.04 x86_64 SDK')
    app = output / 'ASE-Studio.AppDir'
    export_runtime(app / 'ase_studio', provenance())
    engine = unpack_sdk(args.sdk.resolve() / 'ase-engine-ubuntu-22.04-x86_64.tar.gz',
                        output / 'unpack', 'ubuntu-22.04-x86_64')
    trim_engine(engine)
    engine.rename(app / 'engine')
    engine_launcher = app / 'engine/bin/gem5'
    original_launcher_sha = checksum(engine_launcher)
    launcher_text = engine_launcher.read_text()
    if not launcher_text.startswith('#!/usr/bin/env bash\n'):
        raise ValueError('Unexpected SDK launcher; review its interpreter before packaging')
    launcher_text = launcher_text.replace('#!/usr/bin/env bash\n', '#!/bin/sh\n# Modified in the personal fork on 2026-11-01: use POSIX shell to avoid host env ABI conflicts.\n', 1)
    launcher_text = launcher_text.replace('set -euo pipefail', 'set -eu').replace('${BASH_SOURCE[0]}', '$0')
    engine_launcher.write_text(launcher_text)
    files = []

    def copy(source, destination):
        source, destination = Path(source), Path(destination)
        if source.is_dir():
            for child in sorted(source.iterdir()):
                if any(fnmatch.fnmatch(child.name, pattern) for pattern in EXCLUDED):
                    continue
                if child.name in ('gconv', 'cmake', 'pkgconfig', 'include', 'test', 'tests', 'idlelib', 'tkinter'):
                    continue
                copy(child, destination / child.name)
        else:
            if not source.exists():
                return
            destination.parent.mkdir(parents=True, exist_ok=True)
            # Dereference system symlinks, preventing links back into the build host.
            shutil.copy2(source, destination, follow_symlinks=True)
            files.append(str(source))

    for name in ('usr/lib/x86_64-linux-gnu', 'usr/lib/python3.10', 'usr/lib/python3/dist-packages',
                 'usr/share/glib-2.0/schemas', 'usr/share/fonts', 'usr/share/fontconfig',
                 'usr/share/icons/Adwaita', 'usr/share/icons/hicolor', 'usr/share/mime',
                 'usr/share/common-licenses'):
        copy('/' + name, app / name)
    for name in ('python3.10', 'openssl', 'make', 'bash', 'rm', 'dirname', 'readlink', 'env', 'bwrap',
                 'xdg-dbus-proxy', 'gdk-pixbuf-query-loaders'):
        source = shutil.which(name)
        if source:
            copy(source, app / 'usr/bin' / name)
    (app / 'usr/bin/sh').symlink_to('bash')
    (app / 'usr/bin/python3').symlink_to('python3.10')
    # Every copied distribution package keeps its original copyright/license file.
    packages = set()
    for start in range(0, len(files), 100):
        result = subprocess.run(['dpkg-query', '-S', *files[start:start + 100]],
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        for line in result.stdout.splitlines():
            if ': /' in line:
                packages.update(line.split(': /', 1)[0].split(', '))
    inventory = []
    for package in sorted(packages):
        fields = subprocess.check_output(['dpkg-query', '-W',
            '-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}', package], text=True).split('\t')
        inventory.append(dict(zip(('package', 'version', 'source', 'source_version'), fields)))
        legal = Path('/usr/share/doc') / package.split(':')[0] / 'copyright'
        if not legal.is_file():
            raise ValueError('Missing distribution copyright file for ' + package)
        target = app / 'licenses/distribution' / package / 'copyright'
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(legal, target)
    (app / 'licenses/distribution-packages.json').write_text(json.dumps(inventory, indent=2) + '\n')
    (app / 'licenses/distribution-packages.json.license').write_text('SPDX-License-Identifier: GPL-2.0-only\n')
    (output / 'distribution-packages.json').write_text(json.dumps(inventory, indent=2) + '\n')
    launcher = app / 'AppRun'
    launcher.write_text(LAUNCHER)
    launcher.chmod(0o755)
    wrapper = app / 'ase-studio'
    wrapper.write_text('#!/bin/sh\n# SPDX-License-Identifier: GPL-2.0-only\n# Created in the personal fork on 2026-11-01: enter the private AppImage runtime.\nexec "$(dirname "$0")/AppRun" "$@"\n')
    wrapper.chmod(0o755)
    sys.path.insert(0, str(ROOT))
    from versioning import read_version
    identity = read_version(ROOT)
    (app / 'manifest.json').write_text(json.dumps({'target': 'linux-appimage-x86_64', 'release_tag': identity['release_tag'], 'release': identity}, indent=2) + '\n')
    (app / 'manifest.json.license').write_text('SPDX-License-Identifier: GPL-2.0-only\nCreated in the personal fork on 2026-11-01: managed AppImage identity.\n')
    shutil.copy2(ROOT / 'packaging/appimage' / (APP_ID + '.desktop'), app)
    shutil.copy2(ROOT / 'packaging/appimage' / (APP_ID + '.svg'), app)
    import gi
    gi.require_version('GdkPixbuf', '2.0')
    from gi.repository import GdkPixbuf
    icon = GdkPixbuf.Pixbuf.new_from_file_at_scale(str(app / (APP_ID + '.svg')), 256, 256, True)
    icon.savev(str(app / (APP_ID + '.png')), 'png', [], [])
    (app / (APP_ID + '.png.license')).write_text('SPDX-License-Identifier: GPL-2.0-only\nGenerated from the adjacent original SVG.\n')
    (app / '.DirIcon').symlink_to(APP_ID + '.png')
    meta = app / 'usr/share/metainfo'
    meta.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / 'packaging/appimage' / (APP_ID + '.appdata.xml'), meta)
    shutil.copy2(args.runtime_license, app / 'licenses/appimage-runtime-LICENSE')
    shutil.copytree(ROOT / 'packaging/appimage/runtime-notices', app / 'licenses/appimage-runtime')
    subprocess.run([sys.executable, str(ROOT / 'scripts/compact-appimage.py'), str(app)],
                   stdout=subprocess.DEVNULL, check=True)
    for path in app.rglob('*'):
        if path.is_symlink():
            continue
        path.chmod(0o755 if path.is_dir() or path.stat().st_mode & 0o111 else 0o644)
    app.chmod(0o755)
    report = {'status': 'staged', 'studio': provenance(), 'sdk': engine_report['git_sha'],
              'target': 'linux-x86_64-appimage', 'glibc_minimum': '2.35',
              'distribution_packages': inventory,
              'engine_launcher': {'original_sha256': original_launcher_sha, 'sha256': checksum(engine_launcher)}}
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(app)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--runtime-license', type=Path, required=True)
    stage(parser.parse_args())


if __name__ == '__main__':
    main()
