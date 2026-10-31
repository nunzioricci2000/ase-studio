# Modified in the personal fork on 2026-10-30: cover signed Abate update metadata and runtime dependencies.
# SPDX-License-Identifier: GPL-2.0-only
# Modified in the personal fork on 2026-10-31: verify Abate revision 2 without changing the upstream version.
# Created in the personal fork on 2026-10-30: protect upstream numbers from fork release changes and reject ambiguous release identities.
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from versioning import parse_release_tag, read_version


class VersioningTests(unittest.TestCase):
    def test_abate_tracks_the_integrated_upstream_version(self):
        identity = read_version(ROOT)
        self.assertEqual(identity['upstream_version'], '1.6.2')
        self.assertEqual(identity['display_version'], '1.6.2 · Abate')
        self.assertEqual(identity['release_tag'], 'v1.6.2-abate.2')
        self.assertEqual(identity['release_sequence'], 2)
        self.assertEqual(parse_release_tag(identity['release_tag']), {
            'upstream_version': '1.6.2', 'codename': 'abate', 'fork_revision': 2})

    def test_fork_fixes_upstream_updates_and_feature_packages_are_independent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for upstream, name, revision, expected in [
                    ('1.6.2', 'Abate', 2, 'v1.6.2-abate.2'),
                    ('1.6.1', 'Abate', 1, 'v1.6.1-abate.1'),
                    ('1.6.2', 'Borgo', 1, 'v1.6.2-borgo.1')]:
                (root / 'VERSION').write_text(upstream)
                (root / 'FORK.json').write_text(json.dumps(dict(name=name, revision=revision, sequence=7)))
                identity = read_version(root)
                self.assertEqual(identity['release_tag'], expected)
                self.assertEqual(identity['upstream_version'], upstream)
                self.assertEqual((root / 'VERSION').read_text(), upstream)

    def test_plain_upstream_prerelease_or_unsafe_tags_are_not_fork_releases(self):
        for tag in ('v1.6.1', 'v1.6.0-rc.1', 'v1.6.0-Abate.1', 'v1.6.0-abate.0',
                    'v01.6.0-abate.1', 'v1.6.0-abate.01', '../v1.6.2-abate.1',
                    'v1.6.2-abate.1-rc.1', 'v1.6.2-abate.1\n'):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                parse_release_tag(tag)

    def test_invalid_metadata_fails_instead_of_inventing_a_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'VERSION').write_text('1.6.2')
            for record in [dict(name='abate', revision=1), dict(name='Abate', revision=True),
                           dict(name='Abate', revision=0), dict(name='../Abate', revision=1)]:
                (root / 'FORK.json').write_text(json.dumps(record))
                with self.subTest(record=record), self.assertRaises(ValueError):
                    read_version(root)


if __name__ == '__main__':
    unittest.main()
