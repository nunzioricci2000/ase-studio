#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-28: install prebuilt native runtime libraries for package validation.
# Modified in the personal fork on 2026-10-28: use Fedora's hdf5 package, which supplies its C++ runtime too.
# Modified in the personal fork on 2026-10-28: explicitly install the Xlib/Cairo typelibs needed by PyGObject.
# Modified in the personal fork on 2026-10-28: validate desktop packages against Debian/Ubuntu and Arch prebuilt runtimes.
# Modified in the personal fork on 2026-10-28: install the prebuilt Homebrew libraries required by the verified macOS SDK.
# Modified in the personal fork on 2026-10-30: share runtime-only dependencies with the release installer and keep test tools separate.
set -euo pipefail
scripts=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Bootstrap Python only in disposable CI hosts. User installation confirms its own operations.
case "${1:?package family required}" in
    debian) apt-get update; apt-get install -y --no-install-recommends python3 ca-certificates ;;
    fedora) dnf install -y python3 ca-certificates ;;
    arch) pacman -Syu --needed --noconfirm python ca-certificates ;;
    macos) ;;
    *) echo 'Unsupported CI dependency family' >&2; exit 2 ;;
esac
python3 "$scripts/release_install.py" dependencies --yes
case "$1" in
    debian) apt-get install -y --no-install-recommends xvfb xauth git tar gzip passwd util-linux ;;
    fedora) dnf install -y xorg-x11-server-Xvfb xorg-x11-xauth git tar gzip shadow-utils util-linux ;;
    arch) pacman -S --needed --noconfirm xorg-server-xvfb xorg-xauth git tar gzip shadow util-linux ;;
esac
