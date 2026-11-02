# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-31: rebuild the staging environment from verified, locally supplied package inputs.
FROM ubuntu@sha256:076e7bf82319619f28dd0aa9c02ab34b055ad37100395b4f49a2ffba04fb5e11
COPY debs/ /inputs/
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends /inputs/*.deb && rm -rf /inputs
