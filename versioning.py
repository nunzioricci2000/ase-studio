# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-30: keep the upstream version independent of alphabetic feature packages and fork revisions.
"""One release identity shared by the app, packaging and standalone installer."""
import json
from pathlib import Path
import re

UPSTREAM_PATTERN = r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)'
RELEASE_PATTERN = rf'v(?P<upstream>{UPSTREAM_PATTERN})-(?P<codename>[a-z]+)\.(?P<revision>[1-9][0-9]*)'


def parse_release_tag(tag):
    match = re.fullmatch(RELEASE_PATTERN, tag)
    if not match or match['codename'] in {'alpha', 'beta', 'rc'}:
        raise ValueError('Expected a fork release tag such as v1.6.0-abate.1')
    return dict(upstream_version=match['upstream'], codename=match['codename'],
                fork_revision=int(match['revision']))


def read_version(root):
    root = Path(root)
    upstream = (root / 'VERSION').read_text().strip()
    fork = json.loads((root / 'FORK.json').read_text())
    name, revision = fork['name'], fork['revision']
    sequence = fork.get('sequence')
    if (not re.fullmatch(UPSTREAM_PATTERN, upstream) or not isinstance(name, str)
            or not re.fullmatch(r'[A-Z][a-z]+', name) or type(revision) is not int or revision < 1
            or type(sequence) is not int or sequence < 1):
        raise ValueError('Invalid upstream version or fork identity')
    tag = f'v{upstream}-{name.lower()}.{revision}'
    parse_release_tag(tag)
    return dict(upstream_version=upstream, codename=name.lower(), fork_name=name,
                fork_revision=revision, release_sequence=sequence, release_tag=tag, display_version=f'{upstream} · {name}')
