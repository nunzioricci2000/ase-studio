# Distribution checklist

<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Modified in the personal fork on 2026-10-30: document assistant-context exclusions in custom packages. -->
<!-- Created in the personal fork on 2026-10-27: redistribution guidance. -->

This is a practical release checklist, not a certification of every asset.
The project code is GPL-2.0-only; separately licensed components retain their
notices. Educational use is a purpose, not a restriction on GPL permissions.

Before distributing a source archive, executable, installer or bundled app:

1. Include LICENSE, THIRD_PARTY.md, required third-party license texts and
   warranty notices. Identify this as a modified personal fork and preserve
   original authorship. Check dated modification notices in modified GPL files.
   Review older fork changes too; do not invent historical dates or authors.
2. Supply the complete corresponding source for the exact distributed build,
   including local changes, interface files and build/install scripts. Include
   the preferred editable sources of bundled dependencies, not only minified
   JavaScript, generated files, lockfiles or a link to an upstream home page.
   For online binaries, offer the corresponding source alongside them with
   equivalent access (GPL v2 §3). Other distribution methods require one of
   the alternatives in §3; a written offer has specific three-year obligations.
3. Preserve dependency versions and provenance. Archive the source and notices
   needed for that release, even if an upstream URL later disappears. A clean
   dependency installation and a successful build help validate completeness;
   they do not by themselves satisfy source-distribution obligations.
4. Check third-party assets, including logos, images and fonts, for permission
   to redistribute. Code licensing does not automatically grant trademark
   rights. Resolve uncertain provenance or omit the affected asset from release.
5. Review anything actually bundled (including gem5, toolchains and runtimes)
   under its own license. Merely naming or downloading an external tool does
   not mean its entire licensing has been audited here.
6. Verify that the archive contains every required file and that documented
   build/install steps work from the supplied sources. Preserve recipients'
   rights to modify and redistribute; do not impose additional restrictions.

For the simulator, include the exact ASE Studio submodule revision and its
sources/notices; a GitHub source archive of the parent alone does not include
submodule contents. Publish a Studio commit before a parent commit pins it.
For Studio alone, include its own LICENSE, documentation and frontend notices.

The custom application and corresponding-source packages omit development-only
assistant instructions (including nested AGENTS.md files), assistant configuration
directories and GitHub assistant prompts/instructions. The same exclusions apply
when rebuilding from a supplied source manifest. Keep build scripts, workflows,
editable sources and legal notices; do not remove files merely because their text
contains words such as "prompt". These rules belong to scripts/package.py and do
not change GitHub's automatically generated repository source downloads.

References: [GPL v2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html),
[GNU FAQ](https://www.gnu.org/licenses/gpl-faq.html), and
[MPL/GPL integration](https://www.mozilla.org/en-US/MPL/2.0/combining-mpl-and-gpl/).

<!-- Modified in the personal fork on 2026-10-30: require installed final-archive evidence and source-paired installer assets. -->

The runtime allowlist in `scripts/package.py` includes only Python entrypoints,
frontend runtime assets and their notices, the portable Make recipe, VERSION,
LICENSE and THIRD_PARTY.md. SDK trimming removes only its project test fixtures
and build measurements; it keeps vendor libraries, configurations and notices.
Source archives retain editable sources, tests and build/install recipes, with
frontend dependency sources separately inside the Studio source archive.

Before preparing a draft release, verify all final archives through the shared
installer, backend simulations and external native-window scripts, then verify
the macOS signature again. `scripts/release-assets.py` requires the successful
matrix report, installed-archive evidence, matching version/revision and correct
archive hashes before emitting `targets.json`, both standalone installers,
LICENSE and SHA256SUMS. It does not publish anything. Keep the existing draft
release review. Windows WSL/Xvfb evidence is not an interactive WSLg/Start-menu
certification; record that separate desktop check explicitly when performed.

<!-- Modified in the personal fork on 2026-10-30: distribute the update runtime and public verification key while keeping signing secrets private. -->
The runtime allowlist also includes the shared installer/update modules and the
public verification key. Do not include private signing keys or automation tokens
in any archive. Verify the release-index signature as well as all archive hashes.
A native-readiness rollback check and the managed-session update tests are required
before release; WSLg and Start-menu checks still require a real Windows desktop.
