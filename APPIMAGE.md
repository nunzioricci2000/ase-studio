<!-- Modified in the personal fork on 2026-11-02: document the Abate 4 AppImage and unsigned graphical Windows installer release. -->
<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Created in the personal fork on 2026-10-31: document the experimentally verified Linux AppImage. -->
# Linux AppImage

<!-- Modified in the personal fork on 2026-11-01: document compact packaging without deleting runtime components. -->
The compact build strips unneeded symbol tables from staged x86-64 compiler tools
and uses Zstandard level 19 with 1 MiB SquashFS blocks. RISC-V target objects,
libraries, generated-program debug information, GUI drivers and licenses remain
included. The verified SDK inputs are preserved; transformed tool hashes are
recorded in `licenses/appimage-size-optimization.json`. This reduces internal
host-tool debugging detail. Identical private ELF libraries share hardlinks while
retaining all their paths, contents and permissions; this saves about 744 MiB when
extracted. The runtime supports these links during extraction and FUSE mounting.
Stronger compression costs build time and larger blocks can increase random-read
decompression work; no simulation speedup is claimed. Level 22 and 128 KiB blocks
were evaluated: level 22 provided negligible additional savings at 1 MiB, while
128 KiB increased the image size. Level 19 remains the default.

Use `scripts/benchmark-appimage.py --appimage OLD.AppImage NEW.AppImage --rounds 3
--output /tmp/ase-benchmark` to compare alternating runs of the same eight
compiler/simulator assertions. Reports include startup, workload and total times.
This is an extraction-mode benchmark on one machine, not a certification for every
FUSE implementation or physical desktop; keep those separate validation targets.

The x86-64 AppImage contains Studio, its frontend, Python, GTK/WebKit,
the pinned gem5 engine and RISC-V compiler. No Python, compiler or npm installation
is needed to run it. It requires Linux with glibc 2.35 or later and a desktop session.
Only x86-64 is currently built. The release asset is
`ase-studio-nunzio-linux-appimage-x86_64.AppImage`. A standalone copy uses manual
file replacement; Windows-installer-owned copies use the signed managed updater.

```sh
chmod +x ase-studio-nunzio-linux-appimage-x86_64.AppImage
./ase-studio-nunzio-linux-appimage-x86_64.AppImage
```

On systems without FUSE, use `--appimage-extract-and-run` before other arguments.
Use `--data /absolute/path` to choose the project/preferences directory; data lives
outside the image. The backend remains on loopback. Browser mode uses `--server`.
For standalone copies, update by downloading a verified replacement file, saving
work and closing Studio before switching. Managed installations use the signed
updater and check the new application's readiness before switching. The existing
Linux/macOS installer remains available separately.

## Build

The build host needs Linux x86-64, Python 3, GnuPG, Docker and network access for
initial inputs. Prepare the generated frontend with `npm ci && npm run build`.

```sh
python3 scripts/fetch-engine.py --target ubuntu-22.04-x86_64 --output /tmp/ase-sdk
python3 scripts/build-appimage.py --sdk /tmp/ase-sdk --inputs /tmp/ase-inputs --work /tmp/ase-image
python3 scripts/smoke-package.py --appimage /tmp/ase-image/ASE-Studio-experimental-x86_64.AppImage --output /tmp/ase-image-test
```

Choose new work/test directories. The recipe pins Ubuntu's base digest, checks every
APT binary hash, verifies the upstream AppImage runtime's signature, then stages
offline in Docker. The image's own release signature is not provided by that upstream
signature. A continuous upstream download may move: retain the verified input cache;
a changed checksum fails rather than silently accepting newer bytes. Source exports
include local changes. This is a pinned-input build, not a claim of bit-for-bit
reproducibility. Published release hashes are authenticated by the signed target
index; the standalone AppImage has no embedded application signature.

## Sources and verification

Distribute the exact Studio export, frontend preferred sources (`scripts/frontend-sources.py`),
SDK sources downloaded with the binary, distribution sources and AppImage runtime
sources alongside the binary. The build emits `distribution-packages.json`; enable
matching Ubuntu `deb-src` indexes and run `scripts/appimage-sources.py --packages
distribution-packages.json --output sources` inside the build environment, or use
`--resolve-only` and download its authenticated `apt-source-inputs.txt` with `--resolved`.
All listed source archives must pass their hashes before distribution.
Retain the type2-runtime commit from `tools.lock.json`, its patched libfuse and
squashfuse source inputs, runtime LICENSE, and each distribution copyright file.

The initial image passed eight engine/compiler combinations on Debian 13 and on
an offline minimal Ubuntu 24.04 container, plus a native GTK/WebKit/Monaco window
check on Ubuntu 22.04 under Xvfb, with the WebKit sandbox enabled. Full application
browser checks covered saves, drafts, diagnostics and pipeline highlighting.
FUSE mounting and an interactive hardware desktop, Windows/WSLg, ARM64 and macOS
were not tested for this artifact. See the delivery report for final hashes and logs.

Abate 4 release generation additionally requires the exact final AppImage to pass
eight simulations, managed installation/update readiness and Start-shortcut launch
under actual WSLg on Windows Server 2025. The release's `appimage-evidence.json`
records those checks and the runtime/source hashes. Windows 10/11 first-run setup,
interactive UAC/reboots and physical GPU behavior remain outside that test scope.
