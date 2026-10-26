#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Behnam Farnaghinejad <behnam.farnaghinejad@polito.it>
# SPDX-License-Identifier: GPL-2.0-only
set -euo pipefail

studio_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
host_root="${ASE_STUDIO_HOST_ROOT:-$(cd "$studio_dir/.." && pwd)}"
port="${ASE_STUDIO_PORT:-8765}"

cd "$host_root"
exec python3 "$studio_dir/native.py" "$port" "$@"
