# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-30: authenticate release indexes with an independently pinned RSA public key.
"""OpenSSL handles cryptography; exact index bytes are signed before parsing."""
from pathlib import Path
import shutil
import subprocess

PUBLIC_KEY = Path(__file__).resolve().parent / 'release-public.pem'


def openssl():
    command = shutil.which('openssl')
    if not command:
        raise RuntimeError('OpenSSL is required to verify release signatures. Install it and retry.')
    return command


def verify_signature(index, signature, public_key=PUBLIC_KEY):
    if signature.stat().st_size != 384:
        raise ValueError('Invalid RSA-3072 release signature')
    result = subprocess.run([openssl(), 'dgst', '-sha256', '-verify', str(public_key),
                             '-signature', str(signature), str(index)], capture_output=True)
    if result.returncode:
        raise ValueError('Release signature verification failed; no update was installed')


def sign_index(index, signature, private_key, public_key=PUBLIC_KEY):
    subprocess.run([openssl(), 'dgst', '-sha256', '-sign', str(private_key),
                    '-out', str(signature), str(index)], check=True, capture_output=True)
    verify_signature(index, signature, public_key)
