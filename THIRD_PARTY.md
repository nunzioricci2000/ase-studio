# Third-party components and notices

<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Created in the personal fork on 2026-10-27: document bundled licenses. -->
<!-- Modified in the personal fork on 2026-10-28: identify exact frontend revisions and the separate Codicons font license. -->

| Component | Version | License and included notices |
| --- | --- | --- |
| Monaco Editor | 0.57.0 | MIT; frontend/vendor/MONACO-LICENSE.txt and MONACO-ThirdPartyNotices.txt |
| DOMPurify | 3.4.17 | Upstream offers MPL-2.0 OR Apache-2.0; MPL option used for this GPL combination; both texts retained in frontend/vendor/DOMPURIFY-LICENSE*.txt |
| Codicons font | 0.0.46-40, font 1.15 | CC-BY-4.0; frontend/vendor/CODICONS-LICENSE.txt and CODICONS-NOTICE.txt |
| Other Monaco bundled components | As shipped with Monaco | Preserve MONACO-ThirdPartyNotices.txt and all upstream notices |

The unmodified Codicons font is a separate artwork asset under CC-BY-4.0, not
code relicensed under GPL-2.0-only. The file loader preserves its bytes and stores
it separately from JavaScript. Its SHA256 is
`77f902557231f95c4c71ae517d09a1a842753656f5f665086b3e5ad8095538da`, matching
`dist/codicon.ttf` in the exact
[@vscode/codicons source package](https://registry.npmjs.org/@vscode/codicons/-/codicons-0.0.46-40.tgz).
That package supplies the editable SVG glyphs, font build scripts and the
separate MIT license for its code. Preserve the artwork's attribution/license
and include this source package alongside distributions. Do not interpret the
application's GPL notice as a license for every file in the package.

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

Monaco 0.57.0's package metadata identifies Monaco commit
`d61824269f1377111d34306e4a47172327777083` and VS Code core commit
`6a598d4a13031703d483d103c1d934a36ad27971`; include both source trees for the
preferred TypeScript sources and build recipes. DOMPurify 3.4.17 resolves to
commit `a77a3e78b59f72fa4d1c83f22e121ad9cc7d3575`.

The measured editor build's `frontend-inputs.json` records the actual import
graph. It uses Monaco's editor/core, embedded MIT-licensed Marked, and the
selected DOMPurify package. It does not include Monaco's TypeScript language
service or HTML/Ionic language data; their general upstream notices are still
preserved unchanged. Recheck this graph when changing imports or dependencies.

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
