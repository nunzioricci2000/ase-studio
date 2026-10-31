<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Modified in the personal fork on 2026-10-31: identify Abate 2 as the first release with derivative and Windows 10 eligibility fixes. -->
<!-- Modified in the personal fork on 2026-10-31: align Windows eligibility with Microsoft's Windows 10 build 19044+ WSLg requirement. -->
<!-- Modified in the personal fork on 2026-10-31: document compatibility-checked installation on Arch derivatives. -->
<!-- Modified in the personal fork on 2026-10-30: describe private macOS engine libraries and their source archives. -->
<!-- Modified in the personal fork on 2026-10-30: finalize installation guidance for the stable Abate release. -->
<!-- Created in the personal fork on 2026-10-30: collect installation and recovery instructions specific to the fork's release packages. -->
# Installing the Abate packages

This page covers the fork's standalone distribution. General Studio usage and
the original checkout installation are documented [upstream](https://github.com/cad-polito-it/ase-studio#readme).

The release installer provides the application, Python backend, gem5 and RISC-V
toolchain without a repository checkout. It never compiles those components.
These commands require a stable release containing the standalone installer
assets supplied with Abate. Older preview releases may not contain them.

On Linux or macOS, download the installer from the latest stable release:

```bash
curl --proto '=https' --proto-redir '=https' -fL -o install-release.sh \
  https://github.com/nunzioricci2000/ase-studio/releases/latest/download/install-release.sh
bash install-release.sh install
bash install-release.sh update
bash install-release.sh uninstall
```

Use `--version v1.6.2-abate.2` to select a specific published stable release (replace the
example with a released version). The installer verifies the target index and
runtime archive against the checksums from that same release. Missing runtime
packages are displayed and installed only after confirmation; `--yes` explicitly
approves those package-manager operations. Run as your normal user, without sudo.
The initial installer itself is downloaded over HTTPS; you can inspect it and
compare its checksum with the release's `SHA256SUMS` before executing it. These
checksums detect corruption; they are not an independent publisher signature.

Windows 10 build 19044 or newer, or Windows 11, on x86-64 with WSL2/WSLg,
in a normal PowerShell session:

```powershell
Invoke-WebRequest -Uri https://github.com/nunzioricci2000/ase-studio/releases/latest/download/install-release.ps1 -OutFile install-release.ps1
.\install-release.ps1 install
.\install-release.ps1 update
.\install-release.ps1 uninstall
```

Use `-Version v1.6.2-abate.2`, `-Yes`, or `-LinuxUser your_linux_username` as needed.
If your PowerShell policy blocks downloaded scripts, review the script and follow
your organization's script approval policy. The installer does not change it.
It reuses standard `Ubuntu-24.04` on WSL2 and offers to install it if absent.
If WSL needs enabling, Windows needs a restart, or Ubuntu first-run user creation
is incomplete, follow the displayed steps and rerun the same command. It never
changes your default WSL distribution or automatically converts an existing one.
Studio runs as a normal Linux user. WSLg must be available; the installer launches
Studio from Windows and waits until its window closes. Check its **ASE Studio di
Nunzio (Ubuntu-24.04)** entry in Start. Automated WSL/Xvfb checks do not certify
that interactive Start-menu integration. See Microsoft's
[WSLg instructions](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps)
and [WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands).
Windows ARM and a native Windows application are not supported in this release.
Windows 10 eligibility starts with `v1.6.2-abate.2`; the original
`v1.6.2-abate.1` PowerShell asset rejects Windows 10. Microsoft's WSLg requirements establish the
minimum OS build; they do not certify this application's installation on every
Windows build. A real Windows 10 desktop installation and Start-menu check have
not yet been performed.

Supported release targets are Ubuntu 22.04 x86-64, Ubuntu 24.04 x86-64/ARM64,
Debian 12/13 x86-64, Fedora 43 x86-64, Arch Linux x86-64, and macOS 15 Apple
Silicon/Intel. Each release's `targets.json` lists the subset that passed its
checks. Arch derivatives whose `/etc/os-release` declares `arch` as a complete
word in `ID_LIKE` (including Omarchy) select the Arch x86-64 archive, with an
explicit diagnostic. Both the installer and automatic updater use this rule.
Other distribution derivatives and unsupported OS versions remain rejected.
Arch ancestry identifies a candidate package, not guaranteed binary compatibility:
the installer checks runtime dependencies, executes gem5 and the RISC-V toolchain,
compiles a test program and checks backend startup with disposable data before
activating the package. A failed check preserves the previous installation.
The supervisor also checks native-window readiness when activating an update.
Derivatives may lag behind Arch's libraries; rolling libraries can also outgrow
an SDK. Either case requires compatible system libraries or a newer application
release. CI coverage of Arch does not certify every derivative or desktop session.
See [RELEASES.md](RELEASES.md) for reports. Derivative recognition starts with
`v1.6.2-abate.2`; the original `v1.6.2-abate.1` installer does not include it.

Linux keeps managed versions under `~/.local/opt/ase-studio`, a command at
`~/.local/bin/ase-studio`, and its menu entry under
`${XDG_DATA_HOME:-~/.local/share}/applications`. macOS keeps managed bundles under
`~/Applications/.ase-studio`, with **ASE Studio di Nunzio.app** in
`~/Applications` pointing to the active bundle, and the same terminal command.
Homebrew is required for macOS runtime libraries. If it is absent, follow
[Homebrew's installation instructions](https://brew.sh), then rerun the installer;
Python 3.10+ is required to run the installer. The app remains ad-hoc signed and
not notarized. If Gatekeeper blocks it, review the download and use macOS
**System Settings → Privacy & Security → Open Anyway**, when offered. Do not
disable Gatekeeper or system-wide security checks.

The exact Protobuf/Abseil libraries required by gem5 are private to the macOS
application. The installer does not downgrade or replace shared Homebrew copies.

Installed applications check for stable signed updates in the background at most
once every 24 hours. In **Updates**, choose Automatic (the default), Notify me,
or Manual. Automatic mode downloads and verifies the package, checks its startup
with disposable data and prepares it for the next launch. Use **Restart and update**
when ready: saves must finish and simulations must stop first. All managed sessions
must close before activation. The previous version remains available and is restored
if the new backend/window fails to become ready. A failed version is not retried
automatically. Retry explicitly with the terminal installer after correcting the cause.

Selecting `--version` explicitly pins that installation in Manual mode; choose
Automatic again in the app to remove the pin. New system dependencies require
confirmation through the terminal installer. Network failures do not block Studio.
The updater authenticates the release index with the bundled RSA public key and
checks the archives against the signed hashes; it never falls back to unsigned
updates. The initial installer is still obtained over HTTPS: inspect its provenance
before running it. macOS ad-hoc signing and Gatekeeper are separate from this
release-index signature. See [UPDATES.md](UPDATES.md) for recovery and operation.

An unrecognized installation or modified launcher is not overwritten. Move or
rename conflicting files yourself before retrying. If `~/.local/bin` is missing
from PATH, the installer reports it without editing your shell configuration.

Uninstall removes managed application versions and unchanged managed launchers.
It preserves projects, preferences, shared packages, Ubuntu and WSL. A small
ownership/lock directory remains for safe repeated operations. Linux data remains
in `${XDG_DATA_HOME:-~/.local/share}/ase-studio-nunzio`; macOS data remains in
`~/Library/Application Support/ASE Studio di Nunzio`. Webview preferences and
any custom project paths are also retained.

Runtime archives omit development tools, tests, assistant instructions and
editable editor sources already incorporated into the bundle. The matching
`ase-studio-nunzio-TARGET-sources.tar.gz` contains the complete project/build
sources, frontend dependency sources and, on macOS, exact private-library sources,
original bottles and build recipes; `ase-engine-TARGET-sources.tar.gz`
contains the corresponding SDK sources. Both remain separate assets of the same
release, with equivalent access. Keep them and all license notices when
redistributing. For source-checkout integration, see [DEVELOPING.md](DEVELOPING.md) and the [original installation guide](https://github.com/cad-polito-it/ase-studio#installation).


The current release identity is **1.6.2 · Abate**, fork revision **2**. The tag
`v1.6.2-abate.2` keeps the upstream version, feature package and fork revision
separate. See [VERSIONING.md](VERSIONING.md). This naming does not itself mean a
release is available; install only tags actually published in the fork's Releases.
