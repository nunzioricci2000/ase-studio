# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-11-01: verify managed AppImage ownership, compatibility and release evidence gating.
import importlib.util
import json
import os
from pathlib import Path
import sys
import subprocess
import base64
import xml.etree.ElementTree as ET
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/'scripts'))
import updates
import release_install as installer

class ManagedAppImageTests(unittest.TestCase):
    def test_windows_and_linux_share_the_release_trust_root(self):
        xml=ET.parse(ROOT/'packaging/windows/release-public.xml').getroot()
        modulus=subprocess.check_output(['openssl','rsa','-pubin','-in',str(ROOT/'release-public.pem'),'-modulus','-noout'],text=True).strip().split('=',1)[1]
        self.assertEqual(int.from_bytes(base64.b64decode(xml.findtext('Modulus')),'big'),int(modulus,16))
        self.assertEqual(int.from_bytes(base64.b64decode(xml.findtext('Exponent')),'big'),65537)

    def test_capabilities_not_distribution_name(self):
        with patch.object(installer.platform,'machine',return_value='x86_64'):
            with patch.object(installer.platform,'libc_ver',return_value=('glibc','2.43')):
                installer.dependencies(installer.APPIMAGE_TARGET)
            for libc in [('glibc','2.34'),('musl','1.2')]:
                with patch.object(installer.platform,'libc_ver',return_value=libc):
                    with self.assertRaises(ValueError):installer.dependencies(installer.APPIMAGE_TARGET)

    def test_owned_appimage_gets_managed_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory);installation=installer.Installation(home,macos=False)
            installation.initialize()
            studio=installation.root/'version-fixture/ase_studio';studio.mkdir(parents=True)
            (studio.parent/'.installer.json').write_text(json.dumps({'owner':installer.OWNER}))
            with patch.dict(os.environ,{'ASE_STUDIO_APPDIR':str(studio.parent)},clear=False), patch.object(updates,'Installation',return_value=installation):
                with patch.dict(os.environ,{'ASE_STUDIO_DISABLE_UPDATES':'0'}):
                    self.assertIs(updates.managed_installation(studio),installation)
                    (studio.parent/'.installer.json').write_text(json.dumps({'owner':'unrelated'}))
                    self.assertIsNone(updates.managed_installation(studio))

    def test_published_target_requires_desktop_evidence(self):
        spec=importlib.util.spec_from_file_location('release_assets',ROOT/'scripts/release-assets.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);evidence=root/'evidence.json'
            evidence.write_text(json.dumps({'version':'v1.6.2-abate.3','git_sha':'test','runtime':{'sha256':'0'*64},'checks':[]}))
            with self.assertRaisesRegex(ValueError,'Missing final'):
                module.appimage_assets(evidence,root,'v1.6.2-abate.3','test')
