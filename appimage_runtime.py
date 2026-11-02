#!/usr/bin/env python3
# Modified in the personal fork on 2026-11-02: configure bundled fonts independently of the host fontconfig installation.
# Modified in the personal fork on 2026-11-01: enable supervision only for installer-owned AppImages.
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-31: prepare relocatable GTK caches before launching the AppImage.
import os
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET


def main():
    root = Path(__file__).resolve().parent.parent
    import sys
    if sys.argv[1:2] == ['--installer']:
        sys.path.insert(0, str(root / 'ase_studio/scripts'))
        import release_install
        sys.argv = [sys.argv[0], *sys.argv[2:]]
        return release_install.main()
    query = root / 'usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/gdk-pixbuf-query-loaders'
    # The distro cache contains absolute build-host paths. Generate a private,
    # per-process cache and remove it after the UI/backend and child processes exit.
    with tempfile.TemporaryDirectory(prefix='ase-appimage-') as temporary:
        os.environ['ASE_STUDIO_APPIMAGE_CACHE'] = temporary
        fonts = ET.Element('fontconfig')
        ET.SubElement(fonts, 'dir').text = str(root / 'usr/share/fonts')
        ET.SubElement(fonts, 'cachedir').text = str(Path(temporary) / 'font-cache')
        font_config = Path(temporary) / 'fonts.conf'
        ET.ElementTree(fonts).write(font_config, encoding='utf-8', xml_declaration=True)
        os.environ['FONTCONFIG_FILE'] = str(font_config)
        if query.exists():
            cache = Path(temporary) / 'loaders.cache'
            with cache.open('w') as stream:
                subprocess.run([str(query)], stdout=stream, check=True)
            os.environ['GDK_PIXBUF_MODULE_FILE'] = str(cache)
        from updates import managed_installation
        if managed_installation() is None:
            os.environ['ASE_STUDIO_DISABLE_UPDATES'] = '1'
        import sys
        return subprocess.call([sys.executable, str(root / 'ase_studio/portable.py'),
                                '--engine', str(root / 'engine'), *sys.argv[1:]])


if __name__ == '__main__':
    raise SystemExit(main())
