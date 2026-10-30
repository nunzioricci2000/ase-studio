<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Created in the personal fork on 2026-10-30: document signed release updates and recoverable activation. -->
# Application updates

Updates apply only to installations managed by the release installer. Source
checkouts retain their explicit Git updater. An extracted standalone archive can
be launched for diagnostics, but must be installed to use managed updates.

**Automatic** checks once per day while Studio is open, prepares a compatible
stable release, and activates it at the next launch. **Notify me** requires a click
to download. **Manual** checks only on request. Selecting an exact installer version
pins Manual mode until the user changes it. The Updates window links the release
notes, shows download progress and offers **Restart and update** after preparation.
Changing to Notify me or Manual cancels any previously queued activation.

The downloader accepts only the configured fork's published stable releases,
with a complete target/source pair. It verifies the RSA-3072/SHA-256 signature of
the index using the bundled public key, then the runtime archive's SHA-256.
The distribution sequence must be newer than the installed release and no lower
than the highest authenticated sequence already seen. Names are not compared as
SemVer prereleases. The first installer download relies on HTTPS and its provenance;
a signature fetched alongside an untrusted replacement installer cannot establish
an independent initial trust root.

Preparation does not replace the active version. System dependency changes are
shown and require confirmation in the terminal installer. Activation is serialized
with install/uninstall and all managed running sessions. The supervisor keeps the
previous version, records interrupted activation, and waits up to 60 seconds for
the new application's backend and rendered interface. A failed launch restores
the old version and records the failure; that sequence is not retried automatically.
Projects and preferences remain outside application directories. This rollback does
not promise to undo arbitrary future user-data migrations; releases introducing
such migrations must add explicit backwards-compatible migration/backup support.

For download, dependency, signature or startup failures, read the message in
Updates, correct the reported problem and rerun the terminal installer. Use a
specific verified release tag for an explicit recovery pin. Do not delete data
folders, disable signature verification or turn off Gatekeeper. Close all Studio
sessions before an explicit terminal update or uninstall. Diagnostic `--server`
launches are intended for maintainers and do not participate in desktop supervision.

The initial signing key has no automatic rotation channel. To replace it, first
publish a deliberately reviewed updater migration authenticated by the old trust
root, or distribute a new installer through a separately reviewed recovery process.
Never replace a failed key check with acceptance of the key found in a download.

Linux and macOS share the update engine; Windows uses it inside Ubuntu/WSL2.
Automated virtual-display testing does not certify real WSLg/Start-menu integration.
