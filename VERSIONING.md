<!-- Modified in the personal fork on 2026-11-03: define Beacon revision 1 and distribution sequence 5. -->
<!-- Modified in the personal fork on 2026-11-02: prepare Abate revision 4 with the managed AppImage and Windows bootstrapper. -->
<!-- Modified in the personal fork on 2026-10-31: document Abate 3 Windows PowerShell compatibility and recovery. -->
<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Modified in the personal fork on 2026-10-31: advance the Abate fork revision for installation compatibility fixes. -->
<!-- Created in the personal fork on 2026-10-30: define independent upstream versions and alphabetic feature-package names. -->
# Upstream version and feature-package name

This release integrates **ASE Studio 1.6.4** and identifies the second feature
package as **Beacon, revision 1, sequence 5**. Beacon introduces the Lumino
workspace: *Lumino → light → lighthouse → beacon*. It follows Abate, the first
feature package named for *Monaco → monaco → abate*.

| Field | Source | Meaning |
| --- | --- | --- |
| `1.6.4` | `VERSION` | Version of the integrated original Studio code |
| `Beacon` | `FORK.json`: `name` | This fork's feature package |
| `1` | `FORK.json`: `revision` | Release revision for that upstream/name pair |
| `v1.6.4-beacon.1` | Derived by `versioning.py` | Release tag; availability depends on publication |

Do not increase the upstream version for a fork-only change. When integrating
an original release, update `VERSION` to that release's version. Keep the feature
name while the same feature package is maintained; choose the next alphabetic
name for a new package of additions. Increase the fork revision for a new release
of the same upstream/name pair; start at 1 for a new pair. Never reuse or rewrite
an already published tag. The names `alpha`, `beta` and `rc` are reserved to
avoid confusing old prerelease tags with named feature packages.

The application label is `1.6.4 · Beacon`; API responses, manifests and release indexes
also retain the fork revision and full tag. Numeric macOS bundle fields keep
the upstream version and fork revision separately; the full identity is recorded
in additional bundle metadata. `VERSION` is not replaced with a nonnumeric name.

The `sequence` in `FORK.json` is a strictly increasing distribution number, currently 5.
Increase it for every new release, even when the upstream number or feature name
changes. It is included in signed release indexes and installed metadata; automatic
updates never install an older sequence. Do not reuse a published sequence.

The suffix in `v1.6.2-abate.4` is this project's fork naming convention. It is
**not used as a SemVer prerelease ordering rule**. Stable/prerelease status comes
from GitHub's release flag; the installer selects published stable releases and
never compares these tags as SemVer. The draft workflow explicitly sets
`prerelease=false`; publication remains a separate review step.

`--version v1.6.2-abate.4` (Bash) or `-Version v1.6.2-abate.4` (PowerShell)
selects a specific published release. The tag, target index, package report,
archive manifest and bundled version files must agree before activation.

The integrated original revision is
[`950ee860e8688a68430ca1e5fe07f7ba4dbc510d`](https://github.com/cad-polito-it/ase-studio/commit/950ee860e8688a68430ca1e5fe07f7ba4dbc510d),
whose `VERSION` is `1.6.4`. Earlier fork work called its portable package release
`1.6.1`; that historical tag and its reports are retained. The working tree now
restores the upstream number and records Abate separately. This does not
retroactively rename an old release.
When publishing Beacon, explicitly select **Set as the latest release** in GitHub: the selected release must be the intended stable update channel. The installer follows GitHub's latest stable selection, not numeric sorting.

The simulator SDK is a separate build product with its own revision and tags.
Its precise binary/source pair remains pinned in `scripts/engine-sdks.lock.json`;
changing the Studio name does not rebuild or rename an existing SDK.

<!-- Modified in the personal fork on 2026-11-02: distinguish integrated upstream sources from unchanged release metadata. -->
