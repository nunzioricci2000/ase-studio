<!-- Modified in the personal fork on 2026-10-31: identify the Abate 2 installation-compatibility release. -->
<!-- Modified in the personal fork on 2026-10-30: document standalone release installers, explicit updates and WSLg verification. -->
<!-- Modified in the personal fork on 2026-10-27: name the personal app and document automatic source saving. -->
<!-- Modified in the personal fork on 2026-10-27: clarify licensing and redistribution requirements. -->
<!-- Modified in the personal fork on 2026-10-27: document measured Studio CI and the corrected O3 engine check. -->
<!-- Modified in the personal fork on 2026-10-28: link verified portable desktop packages and explain their runtime requirements. -->
<!-- Modified in the personal fork on 2026-10-30: lead with installation and document only fork additions, linking upstream for general usage. -->
<!-- Modified in the personal fork on 2026-10-30: finalize installation guidance for the stable Abate release. -->
```bash
curl --proto '=https' --proto-redir '=https' -fL -o install-release.sh \
  https://github.com/nunzioricci2000/ase-studio/releases/latest/download/install-release.sh &&
bash install-release.sh install
```

Linux/macOS, as your normal user. The command uses the latest stable release;
it requires the standalone installer assets supplied with Abate.
[Windows installation, updates, uninstall and recovery](INSTALLATION.md).

# ASE Studio di Nunzio · Abate

**Upstream 1.6.2 · Abate · fork revision 2.** Abate names this fork's first
feature package: *Monaco → monaco → abate*. The numeric version follows the
original project; the feature name and fork revision evolve independently.
See [version naming](VERSIONING.md).

This repository documents the additions and changes maintained in
[nunzioricci2000/ase-studio](https://github.com/nunzioricci2000/ase-studio).
For the application overview, standard project/simulation workflow, panels and
unmodified settings, use the [original ASE Studio documentation](https://github.com/cad-polito-it/ase-studio#readme).
The [documentation at the integrated upstream revision](https://github.com/cad-polito-it/ase-studio/blob/10f03c8d3b8d331e673dd23d46ca3fcceac502fd/README.md)
provides a reference if upstream subsequently changes.

## What Abate adds

- **Monaco integration:** the source editor, RISC-V completion/help, protected
  scaffolding and integration with Studio's existing draft recovery, compiler
  diagnostics and pipeline selection. Editor assets are served locally.
- **Automatic file saving:** edits are written after 400 ms of inactivity;
  switching projects waits for pending saves and errors retain the edited text.
- **Register playback corrections:** initial register snapshots and completed
  writes stay attached to the correct dynamic instruction. Unknown historical
  values remain unknown instead of being presented as zero.
- **Standalone desktop packages:** an installer for Linux/macOS and Windows
  through WSL2/WSLg, prebuilt SDKs, signed automatic updates and persistent data outside
  the application. See [installation](INSTALLATION.md).
- **Personal-fork integration:** a separate application identity, explicit host
  checkout selection and updates that preserve the current branch and local
  changes. See [development](DEVELOPING.md).

Predictor controls, project folders, memory views and other inherited features
are described upstream; they are not claimed as additions by this fork.

## Working on this fork

[Development and regression checks](DEVELOPING.md) ·
[Version naming](VERSIONING.md) ·
[Automatic updates and recovery](UPDATES.md) ·
[Package pipelines and reports](RELEASES.md) ·
[Fork issue tracker](https://github.com/nunzioricci2000/ase-studio/issues).

## Attribution and license

ASE Studio is derived from the [original CAD/Politecnico di Torino project](https://github.com/cad-polito-it/ase-studio).
The simulation backend builds on the contributors' work in
[ase_riscv_gem5_sim](https://github.com/cad-polito-it/ase_riscv_gem5_sim) and the
[CAD group's gem5 repository](https://github.com/cad-polito-it/gem5).
Original attribution: **© Politecnico di Torino 2026**. Original source-file
copyrights and third-party notices are retained. This personal fork does not
imply endorsement by the original authors or the university.

The project code is [GPL-2.0-only](LICENSE), except for separately licensed
components. Educational use does not restrict commercial use, modification or
redistribution permitted by the applicable licenses. The software is provided
without warranty. See [third-party notices](THIRD_PARTY.md) and
[distribution requirements](DISTRIBUTION.md); preserve notices and provide the
corresponding sources when distributing built artifacts.

[Scheduled upstream integration proposals](UPSTREAM_SYNC.md).
