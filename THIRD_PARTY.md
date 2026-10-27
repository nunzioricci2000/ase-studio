# Third-party components and notices

<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Created in the personal fork on 2026-10-27: document bundled licenses. -->

| Component | Version | License and included notices |
| --- | --- | --- |
| Monaco Editor | 0.57.0 | MIT; frontend/vendor/MONACO-LICENSE.txt and MONACO-ThirdPartyNotices.txt |
| DOMPurify | 3.4.17 | Upstream offers MPL-2.0 OR Apache-2.0; MPL option used for this GPL combination; both texts retained in frontend/vendor/DOMPURIFY-LICENSE*.txt |
| Codicon font and Monaco bundled components | As shipped with Monaco | Preserve MONACO-ThirdPartyNotices.txt and all upstream notices |

DOMPurify is copyright Cure53 and other contributors. For this combined
GPL-2.0-only application, DOMPurify is used under MPL-2.0 and additionally
made available under GPL-2.0 pursuant to MPL §3.3. Recipients may use the
DOMPurify covered source under MPL-2.0 or GPL-2.0. This does not relicense
unrelated upstream releases or remove their original notices. The Apache
text is retained as an upstream notice; Apache-2.0 alone is not the basis
for compatibility with GPL-2.0-only.

DOMPurify preferred source and build files:
https://github.com/cure53/DOMPurify/tree/3.4.17

Monaco source:
https://github.com/microsoft/monaco-editor/tree/v0.57.0

These links identify upstream source; they do not replace the obligation to
provide complete corresponding source for a distributed build. Include exact
sources and local changes alongside release artifacts (see DISTRIBUTION.md).
The build plugin selects DOMPurify from the locked npm dependency instead of
Monaco's embedded copy. Preserve generated *.LEGAL.txt files with the bundle.
The MPL text was copied unchanged from DOMPurify 3.4.17 LICENSE-MPL.

Build/test tools such as esbuild and Playwright are separate dependencies.
If distributing them or their browser/runtime payloads, include the applicable
licenses and fulfill their source obligations where required. The Python
standard library, GTK, WebKitGTK and gem5 also retain their own licenses.

Logos and other images are not covered by a blanket trademark permission.
Their provenance and redistribution rights still need review before a release.
This is a focused inventory of known components, not a full dependency audit.

References: [MPL/GPL guidance](https://www.mozilla.org/en-US/MPL/2.0/combining-mpl-and-gpl/)
and [MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).
