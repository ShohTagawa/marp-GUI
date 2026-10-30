# Changelog

All notable changes to marp-GUI. The version is the one in the root `package.json`; the two VS Code extensions carry their own versions (listed per release). Dates are in JST.

## [1.1.0] — unreleased (prepared 2026-10-31)

Extensions: synchronized preview `marp-scroll-sync` 0.4.0 (was 0.3.0); PDF/present `marp-gui-pdf` 1.4.0 (was 1.3.0).

### Added

- **Direct editing:** Alt+Enter (Option+Enter on macOS) inserts a line break inside the element being edited; the source gets `<br>` (refused inside code).
- **Direct editing:** typed text is no longer lost when the source changes while you type (for example, written by another editor or an AI agent at the same time). The preview holds the edit, re-applies it to the same text after the next redraw, and after 2 minutes or five attempts puts the text on the clipboard and says so.
- **Size and colour:** a selection in the preview may cross a bold or italic word inside the same paragraph or list item; a selection that starts inside and ends outside an emphasis is refused with a message. When the selection is exactly an emphasised word, the span wraps the markers as well; when it is part of one, the markers become `<b>`/`<i>`/`<s>` so that the emphasis still renders.
- **Box editing:** image cropping (press C or ✂, drag the edges, Enter): writes `clip-path: inset(…)` and per-side margins; a Markdown image is rewritten as `<p><img …></p>` in the same undo step.
- **Preview:** click the "Slide n/N" badge or press G to jump to a slide by number.
- **Layout variants** also work for slides whose body is wrapped in `<div class="body">`, and ignore source lines (`.attr`, `.cite`, `.src-row`) when counting items.
- **Themes:** `tsutawaru-simple` (no header band, a hatched band instead), `tsutawaru-simple-cud` (the same with a colour-universal palette) and `ponchie` (one-page overview figures), five themes in all.
- **Sample decks:** `sample-hydrogen` (English, 12 slides, with two library marks and a shelf) and `sample-hydrogen-ja`; `sample-academic`, `sample-ponchie`, `sample-tsutawaru-simple`, `sample-tsutawaru-simple-cud`, each in English and Japanese; `sample-lecture`, a fictional deck used by the tests. 13 sample decks in all.
- **Tests:** the test suite of the synchronized-preview extension (`npm test`, Node.js test runner; Chrome-driven tests are skipped when Chrome is not found) and a GitHub Actions workflow that runs it on Ubuntu, macOS and Windows with Node.js 20 and 22.
- **Benchmark:** `npm run bench` measures the time from a gesture to the repainted preview (direct edit, layout thumbnails, layout switch, insert popup, slide operations, box drag, typing in the source); results in `docs/benchmark.md`.
- **Tools:** `npm run screenshots` re-takes the screenshots in `docs/img/`; `npm run demo:ranking` shows the revision ranking of the library on a temporary git repository.
- **Lint:** messages in English or Japanese (`--lang en|ja`; default from the locale); every rule and its source listed in `docs/design-rules.md`; example deck `docs/examples/lint-sample.md`.
- **Localisation:** command titles, settings and descriptions of both extensions in English, or Japanese when VS Code's display language is Japanese (`package.nls*.json`). Buttons and messages inside the preview are still Japanese only.
- **Documents:** `docs/DESIGN.en.md` (English design summary), `docs/security-review.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CITATION.cff`, `.zenodo.json`, this changelog; an `SPDX-License-Identifier: Apache-2.0` header in every source file.

### Changed

- `@marp-team/marp-cli` and `pdf-lib` are runtime `dependencies` (were `devDependencies`); `puppeteer-core` is a development dependency for the tests.
- `tsutawaru-academic`: new defaults for the header (title band 23 %, page-title band 50 % meshed after it, overlap −4 px); a deck that sets `--pt-center` keeps the old placement. `sample-hydrogen` sets `--hdr-left-w: fit-content` so that its English title is not clipped.
- `sample-hydrogen` / `sample-hydrogen-ja`: each figure's opening `<svg …>` tag is on its own line, so the figure is an HTML block that can be selected with Alt and moved or resized (a figure written inline in a paragraph is refused as a Markdown element).
- Present (`tools/marp-present`): the on-screen page controls sit at the right edge instead of over the takeaway band.
- `tools/lib/marp-env.mjs` no longer runs `npm install` on its own when dependencies are missing; it prints what to run. `latestDeck` ignores files whose names start with a dot.
- The PDF/present extension no longer adds a second ▶ button to the editor title bar.

### Fixed

- Thumbnails in the gallery, the insert popup and the home screen were clipped on the right: `@import` stripping stopped at the `;` inside the Google Fonts URL of `academic.css`.
- Cropping a centred image whose automatic margin was a half pixel left `margin-left` in the source after "remove cropping".
- `lay-fig-right` / `lay-fig-left`: the page-title band could cover the end of the title band.

### Security

- The PDF/present extension does not run in untrusted or virtual workspaces, and its `nodePath` / `chromePath` settings can only be set per machine, not by a workspace.
- Presenting no longer starts Chrome with `--allow-file-access-from-files`.
- Windows: the `cmd /c start` fallback of `openInBrowser` percent-encodes cmd metacharacters; `shellSync` refuses arguments that are not plain words.
- Open findings (the background index build runs `tools/marp-library.mjs` from the folder treated as the repository root; "Present" in the synchronized preview sends a command line to a terminal; the Webview CSP allows `https:` and inline styles) are listed in `docs/security-review.md`.

## [1.0.0] — 2026-10-03

Extensions: `marp-scroll-sync` 0.3.0; PDF/present 1.3.0.

- First release (2026-09-29): synchronized preview with direct editing, slide operations, box editing, layout variants, the insert popup and the library; vector PDF in chunks; presenting in Chrome; themes `academic` and `tsutawaru-academic`; sample decks `sample-layouts` and `sample-parts`; one-click installers for macOS and Windows.
- 2026-10-03: home screen (recent decks, shelves, most revised slides, deck list, search); bilingual README with screenshots; disclaimer; security fixes in the preview (nonce-only scripts).
