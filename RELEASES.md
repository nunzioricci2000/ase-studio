<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Created in the personal fork on 2026-10-27: separate measured Studio checks from engine builds. -->
<!-- Modified in the personal fork on 2026-10-28: retain frontend provenance without adding runtime assets. -->
<!-- Modified in the personal fork on 2026-10-28: document portable startup and installed-runtime checks. -->
<!-- Modified in the personal fork on 2026-10-28: exercise the native macOS window and preserve webview preferences. -->
<!-- Modified in the personal fork on 2026-10-28: document collection of checksum-verified preferred dependency sources. -->
<!-- Modified in the personal fork on 2026-10-28: build source-paired desktop packages from pinned public SDKs. -->
<!-- Modified in the personal fork on 2026-10-28: extend package validation to seven verified Linux engine targets. -->
<!-- Modified in the personal fork on 2026-10-28: validate a native macOS bundle against the verified Apple Silicon SDK. -->
<!-- Modified in the personal fork on 2026-10-28: verify source-archive rebuilds and the desktop runtime under Windows WSL2. -->
<!-- Modified in the personal fork on 2026-10-28: record the complete eight-target preview and verified Windows/source rebuild checks. -->
<!-- Modified in the personal fork on 2026-10-28: automate aggregate timing reports and verified drafts for stable version tags. -->
<!-- Modified in the personal fork on 2026-10-28: add the tested Intel engine to the native macOS package matrix. -->
<!-- Modified in the personal fork on 2026-10-30: describe Abate naming, final-archive checks and fork-only documentation. -->
# Studio distribution workflow

This document covers this fork's packaging and verification. For unchanged
application behavior, use the [original Studio documentation](https://github.com/cad-polito-it/ase-studio#readme).
Current identity: **1.6.0 · Abate**, revision **1**, tag `v1.6.0-abate.1`.
See [VERSIONING.md](VERSIONING.md) and [installation](INSTALLATION.md).
Historical preview names and measurements below describe those original runs;
they do not certify the unrun Abate matrix.


Studio and its simulation engine are separate repositories and build products.
Studio's pipeline must consume a verified, source-paired engine SDK for each host
platform; changing JavaScript, Python or packaging must not compile gem5 again.
`Build Studio packages` runs automatically on main pushes and can be dispatched
manually. Its matrix includes only source-paired SDKs in
`scripts/engine-sdks.lock.json`: Ubuntu 22.04/24.04 x86-64, Ubuntu 24.04 ARM64,
Debian 12/13 x86-64, Fedora 43 x86-64 and Arch x86-64. All seven Linux desktop
packages and the macOS Apple Silicon application passed installed backend and
native editor checks in run 40616273940. Other engines are added after their runtime
checks pass. Windows uses the Ubuntu package through WSL2/WSLg and requires its
own Studio runtime verification; engine-only WSL tests do not certify the UI.
The package workflow now tests the Ubuntu desktop archive on Windows 2025 under
WSL2, with eight backend simulations and the actual GTK/WebKit editor under Xvfb.
That virtual display does not certify integration with the host WSLg desktop.
The matrix also includes macOS 15 Apple Silicon, whose engine passed the FP
register regression and all runtime checks. Its Studio job builds an ad-hoc
signed `.app`, checks the backend and native WebKit editor, and rechecks the
signature after use. A macOS package is retained only after these checks pass.
The separate `Studio CI` checks alone do not certify a platform's simulator.

The package workflow downloads the pinned public engine release, verifies its
report checksum, revision and both archive checksums, builds the frontend and
tests the installed application with isolated disposable projects. It executes
eight simulations through the real HTTP API, opens the native window with Monaco,
and checks backend shutdown against the installed final archive. Smoke scripts
are supplied externally and are not distributed inside the application. No gem5, Python or RISC-V
toolchain compilation occurs in this workflow. Linux tests run inside the target
distribution with prebuilt system GTK/WebKit and SDK runtime libraries.

Successful runs provide `studio-TARGET` artifacts with the application, complete
Studio/dependency sources and matching engine sources. Reports have UTC timestamps,
monotonic durations, checksums and sizes; diagnostics remain available on failure.
The source collection runs once per workflow and reuses verified cached downloads.
The engine download also has a separate `fetch-report.json` with transfer timings.
Actions artifacts require GitHub login and are retained for 14 days; diagnostic
reports are retained for 30 days. A permanent Studio release is a separate step.

Each package workflow also retains `studio-build-report` for 90 days, with a
JSON/Markdown report of every selected target and the GitHub job/step timestamps.
The aggregate includes SDK transfers, installed backend/native checks and source
rebuild measurements. Missing reports, failed jobs, mismatched revisions, incomplete
runtime checks or failed source rebuilds prevent the aggregate from approving a
release. Parallel job durations must not be added to estimate elapsed workflow time.

Pushing the matching named fork tag, currently `v1.6.0-abate.1`, builds the same matrix, requires the tag to
identify the current `main` tip and creates a draft release only after all selected
targets pass. The draft job verifies every application/source archive's size and
SHA-256 again. It checks VERSION and FORK.json against the package evidence and
generates standalone Bash/PowerShell installers, the schema-2 target index and
checksums alongside the aggregate report. Drafts are explicitly marked stable;
the codename suffix is not a prerelease flag. Review the draft
against `DISTRIBUTION.md` before publishing it; a main push alone uploads Actions
artifacts and reports, without creating a public release.

The [277459e preview](https://github.com/nunzioricci2000/ase-studio/releases/tag/studio-preview-277459e)
publishes all eight tested packages, both source archives for each package,
checksums and a combined report with GitHub job/step timestamps. Run 40617667293
passed all eight package jobs, both source-archive rebuilds and the Windows WSL2
backend/native editor check. Package job durations were 91–183 seconds including
preparation and transfers; frontend/build/runtime/archive phases took 28–68
seconds. Source rebuild checks added 34 seconds on Ubuntu and 54 on macOS.
These are measurements of that run, not guarantees for future runner queues or
network speed. The lock now also includes macOS 15 Intel: its engine passed all
seven runtime checks in run 40622939610, recovering 3,974 cached gem5 outputs and
performing only 23 compilations and one link. Its Studio application must pass
the native/backend and source-rebuild checks before its package is released.

To reproduce a package on its matching host, install Node 22/npm and the prebuilt
runtime dependencies in `scripts/runtime-dependencies.sh`, then run:

```sh
python3 scripts/fetch-engine.py --target fedora-43-x86_64 --output /tmp/studio-sdk
python3 scripts/frontend-sources.py --output /tmp/studio-sources
python3 scripts/package.py --sdk-artifact /tmp/studio-sdk --dependency-sources /tmp/studio-sources --output /tmp/studio-package-new
```

The supplied source archive also supports packaging without a Git checkout:
run the same command from its `sources/project` directory, pointing the dependency
argument at `../dependencies`. Its source manifest retains original revision and
file hashes; local edits are explicitly reported. `npm ci` still fetches pinned
build tools, while the preferred sources of runtime frontend dependencies are
included in the archive. macOS packaging additionally needs Xcode command-line
tools and the SDK's Homebrew libraries; its native package is ad-hoc signed,
not notarized. Ubuntu 24.04 x86-64 and macOS jobs also extract the produced source
archive into a fresh directory without `.git`, verify every source manifest hash,
and rebuild and test the application again using those sources. Rebuild reports
are retained under `source-rebuild` in the diagnostic artifact; a failed rebuild
prevents publication of that job's package. This checks functional rebuildability,
not byte-for-byte reproducibility of timestamped archives or signatures.

Packages omit the seven original logo/image assets whose redistribution rights
remain unresolved, preserving textual author and university/group attribution.
The editable HTML template and packaging transformation are supplied as sources.

## Continuous checks

`Studio CI` runs on main, develop and feature/release/hotfix branches and on pull
requests. It rebuilds the locked Monaco bundle, rejects uncommitted generated
changes, and runs backend, editor and browser regressions on Ubuntu 24.04 and
macOS 15 Intel/Apple Silicon. A separate Ubuntu job tests the editor in the actual
WebKitGTK 4.1 engine used by the Linux native window, under a disposable display.
These frontend fixtures do not require a simulator installation or user projects.
Both macOS jobs also compile `scripts/native-macos.swift` against the system
AppKit/WebKit frameworks, then test Monaco, popup creation/closure, a real Blob
download, and native file selection inside that application. The temporary
test launcher is not uploaded as a standalone distribution.

Every job retains JSON and Markdown reports, UTC start/end timestamps, monotonic
phase durations, commands and diagnostics for 30 days. Dependency installation,
frontend compilation and runtime checks are measured separately. The npm download
cache is reused; dependencies remain pinned by package-lock.json. Neither Node,
Playwright nor its test browser needs to be installed by an end user.
`frontend-inputs.json` records esbuild's exact input/output graph for each build,
including the selected DOMPurify implementation. It is a provenance aid for
source/notice audits, not a substitute for shipping the corresponding sources.

Run locally from this repository using a new report directory:

```sh
python3 scripts/check.py --browser chromium --output /tmp/studio-checks-new
python3 scripts/check.py --browser webkitgtk --output /tmp/studio-webkit-new
```

For an existing Chromium installation, set `CHROMIUM_PATH`. The WebKitGTK check
requires PyGObject, GTK 3, WebKitGTK 4.1, Xvfb and xauth.

## Packaged runtime

`portable.py` connects Studio to an existing engine SDK without fetching or
compiling anything. It keeps projects, results and settings outside the installed
application: under `$XDG_DATA_HOME/ase-studio-nunzio` (normally
`~/.local/share/ase-studio-nunzio`) on Linux, and
`~/Library/Application Support/ASE Studio di Nunzio` on macOS. Existing settings,
setup files and project sources are preserved. The generated initial setup follows
the current application/SDK paths, so moving an app does not leave stale paths.
The preferred localhost port stays at 8765 (or `ASE_STUDIO_PORT`) to preserve
webview preferences between launches; the server falls back to a free port if
needed. Runtime tests explicitly request an isolated ephemeral port.

Linux's native entry point still uses the system Python and GTK/WebKitGTK packages.
The backend also supports the SDK's Python 3.10. `--server` is the entry point for
the native macOS webview; `--browser` explicitly opens the system browser for
diagnostics. For example, using disposable data:

```sh
python3 portable.py --engine /absolute/path/to/sdk --data /tmp/studio-new-data --check
python3 portable.py --engine /absolute/path/to/sdk --data /tmp/studio-new-data --browser
```

`scripts/smoke-package.py --studio APP/ase_studio --engine APP/engine --output REPORT`
launches the installed runtime and uses its real HTTP API to create, compile and
simulate disposable arithmetic/loop programs. It checks the final registers in
both CPU modes with direct and cached memory, checks Minor's entry snapshots,
loads the editor assets and verifies shutdown. `--python SDK/python/bin/python3.10`
also tests the embedded interpreter. JSON timing reports and simulator diagnostics
are retained. This check requires working engine binaries; it never builds gem5.

Portable-path tests cover spaces in application, compiler and data paths.
The installed-runtime check has also passed locally with a read-only application
copy and an existing Linux engine. Remote desktop packages still require their
own platform/runtime and native-window verification before release.

## Gitflow

Use `main` for stable versions, `develop` for integration, `feature/NAME` or
`fix/NAME` for development, `release/VERSION` for stabilization and
`hotfix/VERSION` for urgent stable fixes. Features merge into develop; releases
and hotfixes merge into main and back into develop. Copies of upstream branches
use `original/`; the original repository remains the `upstream` remote.

`python3 scripts/gitflow.py init` creates develop if absent and configures local
Gitflow prefixes. It does not switch branches, push, or rewrite history. CI checks
pull-request routes; configure GitHub branch protection to require the Studio
checks before merging. No automatic upstream branch switching is performed.

Before distributing desktop packages, follow [DISTRIBUTION.md](DISTRIBUTION.md),
verify the exact engine's runtime tests and include its matching sources, the
frontend's preferred editable dependency sources, and all required notices.
Assets with unresolved redistribution rights must be omitted from packages.

Prepare the frontend's preferred dependency sources without rebuilding the engine:

```sh
python3 scripts/frontend-sources.py --output /tmp/studio-dependency-sources
python3 scripts/frontend-sources.py --output /tmp/studio-dependency-sources --verify-only
```

Existing downloads are verified before reuse. A package-version mismatch,
incorrect checksum, missing source/license, differing Monaco revision or changed
font fails the collection. Keep all seven archives and `sources-manifest.json`
with the exact Studio sources and engine source archive. A lockfile or generated
JavaScript alone is insufficient. This collection is not an installable app.
The Ubuntu Chromium job measures this collection, reuses checksum-verified
downloads through Actions cache and uploads `studio-dependency-sources` for
14 days. It is collected once per workflow, since the sources are common to
all supported hosts. Each platform still builds and tests its own runtime.
