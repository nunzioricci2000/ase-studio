#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-28: install prebuilt native runtime libraries for package validation.
# Modified in the personal fork on 2026-10-28: use Fedora's hdf5 package, which supplies its C++ runtime too.
# Modified in the personal fork on 2026-10-28: explicitly install the Xlib/Cairo typelibs needed by PyGObject.
# Modified in the personal fork on 2026-10-28: validate desktop packages against Debian/Ubuntu and Arch prebuilt runtimes.
set -euo pipefail
case "${1:?package family required}" in
debian)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y --no-install-recommends python3 python3-gi gir1.2-gtk-3.0 \
        gir1.2-webkit2-4.1 xvfb xauth make git tar gzip passwd util-linux \
        libgoogle-perftools-dev libprotobuf-dev libhdf5-dev libpng-dev \
        libgmp-dev libmpfr-dev libmpc-dev libssl-dev libffi-dev libbz2-dev \
        liblzma-dev libsqlite3-dev libreadline-dev libncurses-dev zlib1g-dev libexpat1-dev
    ;;
fedora)
    dnf install -y python3 python3-gobject gobject-introspection gtk3 webkit2gtk4.1 make git tar gzip \
        xorg-x11-server-Xvfb xorg-x11-xauth shadow-utils util-linux \
        gperftools-libs protobuf hdf5 libpng libstdc++ libmpc mpfr gmp \
        openssl-libs libffi bzip2-libs xz-libs sqlite-libs readline ncurses-libs \
        expat zlib-ng-compat libxcrypt-compat
    ;;
arch)
    pacman -Syu --needed --noconfirm python python-gobject gobject-introspection-runtime \
        gtk3 webkit2gtk-4.1 xorg-server-xvfb xorg-xauth make git tar gzip shadow util-linux \
        gperftools protobuf hdf5 libpng gcc-libs libmpc mpfr gmp openssl libffi \
        bzip2 xz sqlite readline ncurses expat zlib libxcrypt libxcrypt-compat
    ;;
*) echo "No verified Studio runtime dependency recipe for this platform yet" >&2; exit 2 ;;
esac
