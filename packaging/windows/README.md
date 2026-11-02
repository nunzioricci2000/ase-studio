<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Created in the personal fork on 2026-11-01: document the graphical Windows installer build and its release prerequisites. -->
# Windows installer

Build with the .NET 8 SDK: `dotnet build packaging/windows/ASEStudioSetup.csproj -c Release`.
The application targets .NET Framework 4.8 already present on the supported Windows
versions. Framework reference assemblies are build inputs only, not shipped runtimes.
The executable embeds its PowerShell core, public key and LICENSE; it can be
downloaded and opened directly. The output directory also exposes those files for
review and command-line use. Privileged prerequisite operations execute fixed
commands from the elevated executable, not a writable elevated PowerShell script. Authenticode signing requires a separately
provisioned publisher certificate; a successful build is not a Windows desktop test.

The PowerShell core checks registered WSL distributions by capabilities. A single
compatible distribution is selected automatically; multiple choices are presented
with the WSL default suggested. Container-managed distributions are excluded.
Ubuntu 26 eligibility is checked through glibc/architecture/WSL, not its name.
Final application checks remain necessary to establish actual compatibility.

The Windows bootstrap authenticates the release index using the same pinned public
key as the Linux updater. An AppImage target must be published in the signed index;
older releases without that target fail without installing an unchecked fallback.
Standalone AppImages remain manual; installer-owned copies participate in the
existing Linux supervisor, update preferences, session locks and rollback.

Initial download and framework prerequisites require Internet. Uninstall invokes
the installed local runtime and does not query GitHub. User data and WSL are retained.
The helper files in LocalAppData remain for diagnostics/recovery.
Repair reuses the recorded distro and Linux user, and can restore a missing active
launcher after verifying the newly downloaded release. It refuses unmanaged paths.
After a prerequisite reboot, the installer reopens; choose Prepare WSL again to
finish, then Configure Ubuntu to complete the standard first-user setup. Distro
registration runs as the original Windows user, not alternate UAC credentials.

Windows 10/11 desktop certification, reboot/OOBE recovery, UAC and Start integration
must be performed on actual Windows before release. Linux PowerShell fixtures and
cross-compilation do not establish those results.
