<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Created in the personal fork on 2026-10-30: define independent upstream versions and alphabetic feature-package names. -->
# Upstream version and feature-package name

The current identity is **ASE Studio 1.6.0 · Abate**, fork revision **1**.
Abate is the first alphabetic feature-package name, chosen for the wordplay
*Monaco → monaco → abate*. The next feature package will use a name starting
with B; no B name has been chosen yet.

| Field | Source | Meaning |
| --- | --- | --- |
| `1.6.0` | `VERSION` | Version of the integrated original Studio code |
| `Abate` | `FORK.json`: `name` | This fork's feature package |
| `1` | `FORK.json`: `revision` | Release revision for that upstream/name pair |
| `v1.6.0-abate.1` | Derived by `versioning.py` | Unique fork release tag |

Do not increase the upstream version for a fork-only change. When integrating
an original release, update `VERSION` to that release's version. Keep the feature
name while the same feature package is maintained; choose the next alphabetic
name for a new package of additions. Increase the fork revision for a new release
of the same upstream/name pair; start at 1 for a new pair. Never reuse or rewrite
an already published tag. The names `alpha`, `beta` and `rc` are reserved to
avoid confusing old prerelease tags with named feature packages.

The visible label is `1.6.0 · Abate`; API responses, manifests and release indexes
also retain the fork revision and full tag. Numeric macOS bundle fields keep
the upstream version and fork revision separately; the full identity is recorded
in additional bundle metadata. `VERSION` is not replaced with a nonnumeric name.

The suffix in `v1.6.0-abate.1` is this project's fork naming convention. It is
**not used as a SemVer prerelease ordering rule**. Stable/prerelease status comes
from GitHub's release flag; the installer selects published stable releases and
never compares these tags as SemVer. The draft workflow explicitly sets
`prerelease=false`; publication remains a separate review step.

`--version v1.6.0-abate.1` (Bash) or `-Version v1.6.0-abate.1` (PowerShell)
selects a specific published release. The tag, target index, package report,
archive manifest and bundled version files must agree before activation.

The integrated original revision is
[`042dcca77c721d1557abce8a90d36f997dfd2391`](https://github.com/cad-polito-it/ase-studio/commit/042dcca77c721d1557abce8a90d36f997dfd2391),
whose `VERSION` is `1.6.0`. Earlier fork work called its portable package release
`1.6.1`; that historical tag and its reports are retained. The working tree now
restores the upstream number and records Abate separately. This does not
retroactively rename an old release or claim that Abate is already published.
When publishing the first named release, explicitly select **Set as the latest
release** in GitHub: its upstream number is lower than the historical fork-only
`1.6.1`. The installer follows GitHub's latest stable selection, not numeric sorting.

The simulator SDK is a separate build product with its own revision and tags.
Its precise binary/source pair remains pinned in `scripts/engine-sdks.lock.json`;
changing the Studio name does not rebuild or rename an existing SDK.
