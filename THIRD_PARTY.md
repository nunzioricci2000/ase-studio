# Third-party components and notices

<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Created in the personal fork on 2026-10-27: document bundled licenses. -->
<!-- Modified in the personal fork on 2026-10-28: identify exact frontend revisions and the separate Codicons font license. -->
<!-- Modified in the personal fork on 2026-10-28: retain preferred Marked sources and verify dependency archives against pinned checksums. -->
<!-- Modified in the personal fork on 2026-10-28: omit unverified logos and pair desktop packages with exact engine sources. -->

| Component | Version | License and included notices |
| --- | --- | --- |
| Monaco Editor | 0.57.0 | MIT; frontend/vendor/MONACO-LICENSE.txt and MONACO-ThirdPartyNotices.txt |
| DOMPurify | 3.4.17 | Upstream offers MPL-2.0 OR Apache-2.0; MPL option used for this GPL combination; both texts retained in frontend/vendor/DOMPURIFY-LICENSE*.txt |
| Codicons font | 0.0.46-40, font 1.15 | CC-BY-4.0; frontend/vendor/CODICONS-LICENSE.txt and CODICONS-NOTICE.txt |
| Embedded Marked | 14.0.0 | MIT; retained in MONACO-ThirdPartyNotices.txt and generated legal comments |
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
The embedded Marked 14.0.0 parser is generated JavaScript; its preferred
TypeScript sources are at commit `7972d7f9b578a31b32f469c14fc97c39ceb2b6c6`
in [markedjs/marked](https://github.com/markedjs/marked/tree/7972d7f9b578a31b32f469c14fc97c39ceb2b6c6).
`scripts/frontend-sources.py` collects these exact source trees, the Codicons
editable SVG source package, and the two npm inputs used by the editor build.
It verifies pinned SHA256/npm SHA512 checksums, expected source/license files,
Monaco's source-revision metadata, and the font's exact bytes. Its lock must be
reviewed whenever a bundled dependency is updated.

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
`scripts/package.py` omits ase_dark.png, ase_light.png, cad-dark.webp,
cad-light.webp, polito_dark.png, polito_light.png and icon.png from distributions.
It preserves textual author/group/university credits and links. The originals
remain in the development repository and are not asserted to be GPL artwork.
Desktop packages include the engine's own license inventory and notices, and
are distributed alongside that exact engine's complete source archive. Their
GTK/WebKit/system libraries are installed from the host distribution rather
than copied into the package. The native macOS launcher uses system frameworks.
This is a focused inventory of known components, not a full dependency audit.

References: [MPL/GPL guidance](https://www.mozilla.org/en-US/MPL/2.0/combining-mpl-and-gpl/)
and [MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

<!-- Modified in the personal fork on 2026-10-30: identify external signature-verification tooling without bundling or relicensing it. -->
Release-index signing and verification invoke the host's OpenSSL command as a
separate program. No OpenSSL implementation is copied into the updater, and this
fork does not relicense the system executable. Runtime dependency recipes install
the distribution-provided command; SDK source/license obligations remain unchanged.

<!-- Modified in the personal fork on 2026-10-30: identify private source-paired macOS engine libraries. -->
The macOS packages supply Protobuf 36.1 (ARM64) or 36.0 (Intel), under
BSD-3-Clause, with its MIT-licensed utf8_range component, and Abseil 20260817.0
under Apache-2.0. These libraries are used by the separate BSD-licensed gem5
executable. They are not linked into the GPL-2.0-only Studio application and are
not relicensed as GPL. Apache-2.0 is not asserted to be GPL-2.0 compatible.

`scripts/macos-runtime.lock.json` pins the exact Homebrew bottles, source archives
and build recipes. Packaging copies only gem5's required library dependency
closure, relocates the dylib references and renews ad-hoc signatures; it does not
compile gem5 or alter the user's Homebrew installation. The application carries
all source-archive LICENSE/NOTICE/COPYING files, recipes, relocation notice and
hash manifest in `engine/licenses/macos-runtime`. The matching Studio source
archive includes exact library sources, original bottles and recipes in
`sources/dependencies`. Homebrew's BSD-2-Clause license accompanies its recipes.
