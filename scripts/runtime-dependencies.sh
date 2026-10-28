#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-28: install prebuilt native runtime libraries for package validation.
set -euo pipefail
case "${1:?package family required}" in
fedora)
    dnf install -y python3 python3-gobject gtk3 webkit2gtk4.1 make git tar gzip \
        xorg-x11-server-Xvfb xorg-x11-xauth shadow-utils util-linux \
        gperftools-libs protobuf hdf5 hdf5-c++ libpng libstdc++ libmpc mpfr gmp \
        openssl-libs libffi bzip2-libs xz-libs sqlite-libs readline ncurses-libs \
        expat zlib-ng-compat libxcrypt-compat
    ;;
*) echo "No verified Studio runtime dependency recipe for this platform yet" >&2; exit 2 ;;
esac
