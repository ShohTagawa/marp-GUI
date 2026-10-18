# Design summary of the preview extension (marp-scroll-sync)

This is an English summary of [`tools/marp-scroll-sync/DESIGN.md`](../tools/marp-scroll-sync/DESIGN.md) (Japanese, the authoritative interface contract between modules), checked against the code of extension version 0.4.0. It describes only what the shipped code does. Where the Japanese document and the code differ, the code was followed. File and function names are given so that each statement can be checked in the source.

## 1. Purpose

[Marp](https://marp.app/) turns a Markdown file into slides. Editing a deck normally means switching between the Markdown source and a read-only preview. The extension `marp-scroll-sync` adds a synced preview to VS Code in which most routine edits can be made on the slide itself:

- the preview follows the cursor, and clicking a slide moves the cursor to the matching source line;
- text can be edited in place on the preview and is written back to the Markdown;
- slides can be added, duplicated, moved and deleted, boxes can be moved and resized, and a slide's layout can be switched among variants shown as thumbnails;
- finished slides can be marked, found again across all decks of the repository (ranked by how often they were revised in git), and inserted into another deck, adapting assets, CSS and colours;
- the source is made shorter to read by folding every slide except the current one.

The Markdown file stays the single source of truth. The extension only writes standard Marp Markdown and HTML into it.

## 2. Four invariants

**(i) The output of an unmodified `marp-cli` does not change.** The extension registers no Marp engine or plugin for export; PDF, HTML and PNG are produced by the standard `marp-cli` (see `tools/marp-pdf/`, `tools/marp-present/`, `tools/marp-png.mjs`). The preview uses its own `@marp-team/marp-core` instance (`extension.js` `marpFor`) with `html: true` and a markdown-it core rule (`lib/source-map.cjs` `attachLineInfo`) that adds `data-line`, `data-line-end` and, inside HTML blocks, `data-hline` attributes. These attributes exist only in the preview. Everything the extension writes is ordinary Marp syntax that `marp-cli` renders the same way: inline `style` attributes, `<span class="ss-tune" style="…">`, `_class` values, the keys `_lib` and `_from` placed in the same directive comment as `_class` (Marpit treats a comment that contains a known directive as a directive comment, so it is neither rendered nor added to the presenter notes), comments placed only at the end of the line of an opening block tag, and the Marp image keywords `w:`/`h:` in an image's alt text. Tests render the edited source with marp-core and check that presenter notes and page counts are unchanged.

**(ii) Write only when the source position is unique; otherwise move the cursor.** Every planning function returns either edits or `{ ok: false, reason, line }`. On failure nothing is written; the preview shows a short message and the extension selects and highlights the source line (`extension.js` `guideToLine`) so that the user can make the change there. Writing to a wrong place is treated as the worst outcome; not writing is acceptable. In addition, every message from the Webview carries the `doc.version` it was rendered from, and an edit is refused when the document has changed since (`staleVersion`). The only exception is a slide operation that arrives right after the preview's own text commit with the same version, which cannot change slide indices (`staleForSlideOp`).

**(iii) One gesture = one `WorkspaceEdit` = one undo.** `replaceMinimal` compares the old and new full text, strips the common prefix and suffix (never splitting a surrogate pair or a CRLF), and applies a single replacement. Gestures that are computed in several steps — committing text and creating a new bullet, renumbering an ordered list, inserting several slides — therefore undo with one Cmd+Z (Ctrl+Z). When the preview has focus, Cmd/Ctrl+Z and Cmd/Ctrl+Y/Shift+Z are forwarded to the extension as `undo`/`redo` messages and executed in the editor. File copies of assets are the one thing undo does not revert. By default the file is saved right after each write (`saveAfterWrite`, setting `marpScrollSync.saveAfterEdit`), so that other tools that rewrite the file on disk do not conflict with an unsaved buffer.

**(iv) Re-render only the slides that changed, within a 0.4 s budget.** The design target is that no gesture takes more than 0.4 s from input to visible result. The cost is not the Marp render itself but replacing the whole Webview DOM, so the extension sends only the changed slides (section 4). Popups first show a synchronous skeleton and fill thumbnails afterwards. Section 15 lists which budgets the shipped tests assert.

Supporting rules: the extension adds no npm dependency beyond `@marp-team/marp-core`; optional modules are loaded with `safeRequire`, so a failure disables one feature and the synced preview keeps working (tested by fault injection); VS Code-independent logic lives in pure `lib/*.cjs` modules; `engines.vscode` is `^1.80.0`, and newer APIs (the document paste-edit provider) are used only when they exist.

## 3. Module map

| File | Responsibility | Depends on |
|---|---|---|
| `extension.js` | Activation, commands, status bar, Webview creation and CSP, message dispatch, version checks, `replaceMinimal`, save after write, render/patch, size/colour tuning, presenting | VS Code |
| `lib/slide-split.cjs` | Slide boundaries matching marp-core (front matter, code fences, HTML comments, setext headings); `splitDeck`, `slideMeta` (title, classes, mark) | pure |
| `lib/source-map.cjs` | Line attributes for the preview; locating DOM text nodes in the source; planning text edits | pure |
| `lib/slide-ops.cjs` | Duplicate, delete, move, insert, new-slide templates, add/remove bullet | pure |
| `lib/style-edit.cjs` | Writing box moves and sizes into `style` attributes or image alt text | pure |
| `lib/layout-variants.cjs` | Table of `lay-*` layout classes, slide analysis, variant choice, `_class` rewriting | pure |
| `lib/folding.cjs` | Folding ranges, slide labels, panel labels, comments that would leak into notes | pure |
| `lib/folding-vscode.cjs` | Folding provider, decorations, automatic folding, diagnostics, four commands | VS Code |
| `lib/library-core.cjs` | Marks, library index, a small CSS parser, theme classes and palettes, adapting a slide to another deck | pure + fs |
| `lib/library-vscode.cjs` | Mark input, library insert, adaptive paste, mark diagnostics | VS Code |
| `lib/corpus-core.cjs` | Index of all slides, git revision counts, score, de-duplication, search, shelves | pure + fs + git |
| `lib/corpus-vscode.cjs` | In-memory index, background rebuild, thumbnails, search responses, multi-slide insert, shelf edits | VS Code |
| `lib/home-core.cjs` | Lists for the home screen (most edited, decks, recent) | pure |
| `lib/home-vscode.cjs` | Home Webview panel | VS Code |
| `media/textnodes.js` | Enumerates a slide's text nodes in DOM order (shared by Webview and tests) | browser |
| `media/preview.js`, `preview.css` | All preview UI: sync, editing, buttons, popups, gallery, patching; exposes `window.ssPreview` | browser |
| `media/overflow.js` | `window.ssDetectOverflow(section)` | browser |
| `media/layouts.js`, `layouts.css` | Layout-variant popup (`window.ssLayouts`) | browser |
| `media/boxedit.js`, `boxedit.css` | Box moving and resizing (`window.ssBoxEdit`) | browser |
| `media/home.js`, `home.css` | Home screen UI | browser |

The command-line tool `tools/marp-library.mjs` (index, thumbnails, mark, insert, corpus, search, shelf) is a thin wrapper over `library-core.cjs` and `corpus-core.cjs`, so the CLI and the extension share one implementation. All edit planners return `{ start, end, text }` ranges in UTF-16 offsets of `doc.getText()`; only `extension.js` and the `*-vscode.cjs` modules turn them into a `WorkspaceEdit`.

## 4. Rendering and patching

`buildHtml` renders the deck with the cached Marp instance (rebuilt when any `theme/*.css` changes its modification time), inlines the browser scripts, and sets a Content Security Policy whose `script-src` is a random nonce only. Only the extension's own scripts and Marp's helper script carry the nonce, so `<script>` tags, event attributes and `javascript:` URLs inside a deck (decks are rendered with HTML enabled) do not run in the preview. Thumbnails of other decks are additionally stripped of scripts and event attributes twice, in the extension and in the Webview.

On each update `renderUpdate` cuts the HTML into per-slide `<svg data-marpit-svg>` strings and compares them with what was sent last. If the document, CSS, the HTML outside the slides and the slide count are all unchanged, it sends `patch { version, slides: [{ index, html }] }` with only the changed slides; otherwise a full `render`. Marp's random scope ids for `<style scoped>` are renumbered in order (`stableScopes`) so that scoped CSS does not defeat patching. After an in-preview text commit the edited slide is always included (`forceSlides`), because the DOM still shows the typed text. Edits typed in the editor are debounced by 150 ms; edits from the preview re-render immediately.

In the Webview, `applyPatch` replaces only the listed `<svg>` elements, keeping scroll position, selection and the state of images and videos in other slides. A patch older than the displayed version is ignored; a patch that cannot be applied makes the Webview ask for a full render (`needRender`). While a text edit is open, an incoming render is held (only the latest) and patches are merged, then applied after commit or cancel.

## 5. Direct-edit pipeline

1. **Start.** Double-clicking text makes the nearest block element (`li`, `p`, `h1`–`h6`, `td`, `th`, `div`, …) `contenteditable="plaintext-only"`; never the whole section. SVG `<text>` gets an overlaid input box instead.
2. **Commit.** Enter (not during IME composition) or blur commits; Escape restores a snapshot. Shift+Enter (or Cmd/Ctrl+Enter) in a list item commits and starts a new bullet below; Backspace in an empty bullet deletes it. The Webview diffs the edited element against its snapshot and sends `editCommit { index, version, nodes: [{ t, near, svg }], changes: [{ k, old, now }], then, line, lineEnd }`, where `nodes` is the slide's text-node list from `textnodes.js` and `near` is the nearest ancestor's line attribute.
3. **Locate.** `source-map.cjs` builds a *masked* copy of the slide's source in which tags, comments, `<style>`, link destinations and similar non-text parts are replaced by `\0` of the same length, so that attribute values or presenter notes never match. It then walks the nodes in DOM order with a forward-only cursor, searching each trimmed node text within the line window of its `near` element. Entities (`&amp;`), backslash escapes and CRLF are matched character by character. Nodes that do not occur in the source (KaTeX output, emoji images) are skipped without moving the cursor; math output is excluded from the node list.
4. **Plan.** `planTextEdit` writes only if node *k* was found and the source there equals `old`. Leading and trailing whitespace is kept byte for byte. Characters that would become Markdown syntax (`\ * _ \` [ ] ~ $`, `<`, line-start markers such as `#`, `-`, `1.`, `---`) are escaped; entities are kept as entities. Edges next to links or emphasis are handled by `planEdgeEdit`. About twenty refusal reasons exist (for example `ambiguous`, `autolink`, `code-highlight`, `emphasis-boundary`, `newline`, `setext`); each leads to "do not write, move the cursor".
5. **Write and verify.** The extension applies all planned edits together (all or nothing), adds the new bullet if requested, writes one minimal replacement, saves, and attaches `expect { index, k, text }` to the next render. If the re-rendered node *k* differs from what was typed, the preview warns that display and source diverged and that Cmd+Z restores the source.

Selecting text in the preview sends `tuneSelect`; `planRangeSelect` maps the selection to a source range and selects it in the editor, so the size/colour tools (section 6) apply to it.

## 6. Slide operations and size/colour

Buttons above the current slide (new, duplicate, move up, move down, delete, mark, library) send `slideOp`; the same operations exist as commands that act on the slide under the cursor without the preview. `slide-ops.cjs` computes the edits while keeping the blank lines around `---` separators, keeps the document's line endings, drops `_lib` marks from copies, and recounts the slides of the result with `slideStartLines`; if the count is not the expected one, nothing is written. Sources that use separator forms where the splitter could disagree with Marp (`***`, `___`, indented `---`, `headingDivider`, or `---` directly after a paragraph, list or table) are refused with a pointer to the line. Deleting asks for confirmation. New slides come from six templates (blank, heading with bullets, split, figure, message, divider) using only classes of `theme/academic.css`.

The size/colour tools wrap a single-line selection in `<span class="ss-tune" style="font-size:Npx !important; color:… !important">` or update an existing such span (never nesting). Size steps are ±1 px from the size measured on the clicked element. The theme swatches write `var(--accent)` and `var(--accent-dark)` so that the colour follows the deck it is later pasted into.

## 7. Box editing

`media/boxedit.js`: while Alt is held, the HTML element under the pointer gets an outline and a label (tag, class, size); Alt+click selects it with eight handles. Dragging moves, handles resize (aspect ratio kept for `img`, `svg`, `video`, `canvas`; Shift toggles), arrow keys move by 1 px (Shift: 10 px), Alt+↑/↓ go to the parent or back to the child, `0` resets, Escape ends. Moves snap within 6 screen pixels to the slide centre lines, sibling edges and the original position (Cmd/Ctrl disables snapping). During a drag only the Webview DOM changes, once per animation frame; on release one `boxCommit { index, version, target, style }` is sent, with integer pixels in the 1280×720 slide coordinate system.

`lib/style-edit.cjs` writes position as the CSS `translate` property (visual only; surrounding layout does not move; removed at 0,0) and size as `width`/`height`, inside the element's `style` attribute. Other declarations and their order are kept; an empty `style=""` is removed. When the deck's CSS wins with `!important`, the Webview detects that the computed value did not change and requests `!important`. An HTML element is identified by its `data-hline` (the line of its opening tag), its position among elements with the same line, and its tag name; the opening tags are counted with the same tokenizer as `source-map.cjs`, once from the start of the slide and once from the preceding blank line, and the edit is written only if both counts agree. Markdown images can only be resized (alt keywords `w:`/`h:`); Markdown paragraphs, list items and headings cannot be box-edited (Alt+↑ selects a writable parent).

## 8. Layout variants

The theme `theme/tsutawaru-academic.css` defines twelve layout classes (`lay-boxed`, `lay-cards3`, `lay-keyrow`, `lay-cards2`, `lay-flow`, `lay-steps`, `lay-fig-right`, `lay-fig-left`, `lay-fig-top`, `lay-fig-only`, `lay-lead`, `lay-points`). Each re-arranges the same plain Markdown (heading, list, paragraphs, one figure, optional takeaway) with CSS only, so changing a layout means changing one word in `_class`. The rules behind them are listed in [docs/design-rules.md](design-rules.md).

`layout-variants.cjs` analyses a slide (is it plain, i.e. not wrapped in layout `div`s; number of list items; ordered or not; figures; text length) and offers only matching variants, preceded by "standard" (no `lay-*`); variants that would put more than three items side by side are not offered. The table is injected into the Webview as `window.__SS_LAYOUTS__`; the matching function exists in both Node and browser code, and a test checks that both give the same result on all sample slides. Right-click (or `L`) opens a popup in which each thumbnail is a clone of the current slide's DOM with only the section class replaced, so no render or round trip is needed; each candidate is checked with `ssDetectOverflow` and marked ⚠ when it overflows. Hovering previews the variant on the real slide; clicking sends `layoutApply`, and `planSetLayout` replaces the `lay-*` token in `_class` (adding `_class`, and copying a global `class` into it, if needed), keeping other classes and marks. The command "Change Layout of This Slide…" offers the same list in a QuickPick.

## 9. Folding and labels

`folding.cjs` provides folding ranges for each slide (separator line to the line before the next separator, trailing blank lines included), the front-matter `style:` block (a leading `:root { … }` block of frequently tuned variables stays visible), and multi-line `<style>`, `<svg>` and comments. With `marpScrollSync.autoFold` on, opening a Marp file folds every slide except the current one; moving the cursor into another slide's body folds the previous one and unfolds the new one, while `style` and `svg` blocks (setting `autoFoldKinds`) stay folded. Moves made by commands, find/replace, multiple cursors and non-empty selections are ignored. Folding is done with `editor.fold`/`editor.unfold` and verified via `visibleRanges`, with retries.

Decorations show `number | class | title ★` on each separator line and faint region names at the end of lines such as `<div class="left">`. Nothing is written unless the user runs "Write Panel Names…", which puts a comment at the end of the opening tag's line only (a comment on a line of its own would become a presenter note). An Information diagnostic flags short label-like comments that would leak into presenter notes.

## 10. Library: marks and adaptation

A finished slide is marked with `_lib: <id> | tag, tag | YYYY-MM-DD` in the same directive comment as `_class` (a `_class` line is added if missing, copying a global `class` so that the look does not change). A lone `<!-- _lib: … -->` would become a presenter note; a Warning diagnostic reports it. `library-core.cjs` builds `slides/_library/index.json` (generated) from all decks, including unsaved editor contents; the slide body is not copied into the index but re-read from its deck on insert.

`adaptSlide`/`adaptFragment` plan an insertion into another deck without touching files:

1. header, footer, theme colours and logo come from the destination's front matter and are left alone;
2. `./src/…` assets are copied to the destination's `src/` (same name and content: reused; same name, other content: renamed with `-2` and references rewritten); `../assets/…` paths are corrected for directory depth;
3. deck-specific CSS rules (classes used by the slide that are defined in the source deck's style but not in the theme) are carried along: skipped when an identical rule exists, put in the slide's `<style scoped>` when the destination defines the same class differently, otherwise appended to the destination's front-matter `style:`;
4. colours that exactly equal one of the source deck's four palette values (`--accent`, `--accent-dark`, `--accent-soft`, `--section-bg`) are replaced by `var(--accent, #original)` in attributes, `<style>` and carried CSS, unless the user keeps the original colours;
5. a theme mismatch produces a warning listing classes missing from the destination theme; optionally ("keep original typography", `keepTypo`) the source theme's body sizes and spacing are carried into the slide's `<style scoped>` between `ss-keep-typo` marker comments;
6. the copy loses `_lib` and gets `_from: <id>` instead.

Entry points: the ★ button and command (mark/unmark), the 📚 button (search gallery, section 11), the command "Insert Finished Slide from Library…", the CLI, and, where VS Code offers the paste-edit API, an adaptive paste option when a slide copied from one deck is pasted into another (setting `adaptivePaste`).

## 11. Corpus: index, revision history and search

`corpus-core.cjs` `buildCorpus` indexes every slide of every `marp: true` deck under `slides/` (skipping `out/`, `_library/`, folders such as `work/` or `old/`, names starting with `_` or `.`, and backups). Each entry holds title (the `page-title` if present, else the first heading), class, theme, date (from the folder name), up to 600 characters of plain text (notes, tags, styles and SVG removed; SVG labels used for figure-only slides), asset and class counts, the mark, and a revision record. A cache keyed on file size and modification time makes rebuilds incremental.

**Aligning slides across git history** (`churnOf`). The history of all Markdown files is read with one `git log -M -C --find-copies-harder --name-status`, following renames and copies, and all versions of a deck are read with one `git cat-file --batch`. Each version is split into slides, and each slide is reduced to the set of its trimmed, non-empty lines without `_class` and `_lib` lines. Going from the oldest version to the newest, with the uncommitted working tree as the last version, every current slide is matched greedily to the unused slide of that version with the highest score = Jaccard similarity of the line sets + 1 if the (non-empty) titles are equal; matches below 0.3 are discarded. Whenever the matched slide differs from the previously matched one (multiset line difference > 0), `touched` is increased and the difference is added to `lines`. Commits authored by an AI coding agent (recognised by its no-reply author address) are excluded from a separate `human` count.

**Score** (`scoreOf`, fixed by tests): +6 for a mark; + 3·(1 − 0.6^touched); + min(1, log10(1 + lines)/3); + 0.1 per tuned span (max 0.5); + 0.4/0.2 for decks listed as group A/B in an optional author-maintained list (absent in the package, so 0); + up to 0.3 for recency relative to the newest deck in the index; −2 for decks that look machine-converted from slides software (unless marked).

**Duplicates** (`dedupe`): slides with the same normalised title (or the same first 40 characters of text) and a character-4-gram Jaccard similarity ≥ 0.7 form a bundle; the highest-scoring slide represents it.

**Search** (`searchCorpus`): whitespace-separated terms combined with AND; text is normalised with NFKC, lower case, and removal of whitespace and the Japanese long-vowel mark, then matched as substrings (no word segmentation). Per term: title 10 (exact title 14), mark id/tags 8, body 3 (4 within the first 80 characters), deck name 2, class name 2 (class names also match Japanese synonyms), shelf label 10, shelf name 8; a term that matches nowhere excludes the slide. Relevance is the sum plus the score; ties break by score, date and key. Results are de-duplicated within the hits; slides on a shelf come first.

**Shelves** (`slides/_library/shelf.json`, tracked in git) are named, user-ordered lists of slides. An item resolves by mark id, then title within its deck, then slide number; unresolved items stay as "missing". Edits are pure functions; the file is written atomically and never over a broken file.

**In the extension** (`corpus-vscode.cjs`) the index is kept in memory: first built quickly without reading git history (revision counts of unchanged decks are reused from `corpus.json`), then rebuilt incrementally after Markdown changes (1.5 s debounce) or when older than 60 s. When `corpus.json` is missing, lacks history or was built at another `HEAD`, one child process runs `node tools/marp-library.mjs corpus` with the extension host's Node (`ELECTRON_RUN_AS_NODE=1`), and the result is reloaded. Thumbnails are rendered once per deck with the same Marp instance, cut into slides, and cached (40 decks, LRU); per response at most 90 ms is spent on rendering and the rest follows in a second response with the same request id. In the Webview, each thumbnail is a Shadow DOM host with the deck's CSS parsed once into a shared `CSSStyleSheet` (`adoptedStyleSheets`).

**UI**: hovering between slides shows a + button (also `+` or `i` on the current slide). It opens a small popup with a search field, the shelves (up to nine thumbnails) and the top-scored slides, prefetched while idle. Click inserts, Shift+click selects several; "more" opens the full gallery with filters (marked only), sort (relevance, most edited, newest), options "keep original colours" and "keep original typography", naming a slide onto a shelf, drag or Alt+←/→ to reorder, and "open source". `corpusInsert` applies `adaptSlide` to each selected slide on the intermediate text and writes one minimal replacement; assets are copied first and removed again if writing fails, decks outside the repository are refused, and the slide count must grow by exactly the number inserted. If the inserted slide then overflows, the user is told once by how many pixels.

## 12. Home screen

`home-vscode.cjs` opens a read-only Webview (command "Home", ⌘K H / Ctrl+K H, the status-bar item, editor title button, and on start-up when the workspace contains `theme/academic.css`, no Marp file is visible and the home was not shown in the last 60 s). Tabs: recent decks (up to 12, kept in `workspaceState`), shelves, most edited (by revision count, by human revision count when available, by score, or by last revision date; only slides revised at least once — or marked, in the score order — and no duplicates), and all decks; a search box uses `searchCorpus`. Clicking a card opens the deck at that slide's line and, by default, the synced preview. The list comes from the in-memory index; thumbnails are requested for visible cards only, 60 ms per batch.

## 13. Overflow detection

`media/overflow.js` measures one slide in 1280×720 coordinates. Only the visible boxes of in-flow content count (text ranges, replaced elements, elements with a background or border; absolutely positioned elements, header, footer, `.takeaway` and `.page-title` are excluded). It reports `bottomPx` (how far content passes the floor: 24 px above the slide's bottom edge, or the padding if smaller, or the top of a bottom-fixed `.takeaway`, whichever is higher), `hitsTakeaway`, `hitsHeader`, `hitsSibling` (a block running into the next block) and `pending` (images still loading). The preview runs it on every render or patch for the affected slides in idle time and shows a ⚠ badge on overflowing slides; layout thumbnails use the same function.

## 14. Configuration

| Setting | Default | Effect |
|---|---|---|
| `marpScrollSync.autoFold` | `true` | Fold every slide except the current one |
| `marpScrollSync.autoFoldKinds` | `["style","svg"]` | Blocks kept folded inside the open slide (`style`, `svg`, `notes`) |
| `marpScrollSync.slideLabels` | `true` | Show `number \| class \| title ★` on separator lines |
| `marpScrollSync.panelLabels` | `true` | Show region names at the end of block tags |
| `marpScrollSync.adaptivePaste` | `true` | Offer the adaptive paste option |
| `marpScrollSync.saveAfterEdit` | `true` | Save right after the extension writes |
| `marpScrollSync.home.onStartup` | `true` | Open the home screen on start-up |
| `marpScrollSync.home.openPreview` | `true` | Open the preview when a home card is opened |

The companion extension `marp-gui-pdf` (`tools/marp-pdf/vscode-extension/`) has `marpGui.chunkSize`, `marpGui.chromePath` and `marpGui.nodePath`. Key bindings: ⌘K M / Ctrl+K M opens the preview in Markdown editors, ⌘K H / Ctrl+K H opens the home screen, Cmd+Alt+= / Cmd+Alt+− (Ctrl+Alt on Windows/Linux) change the font size of the selection. Command titles, settings descriptions and extension descriptions are localised through `package.nls.json` (English) and `package.nls.ja.json` (Japanese).

## 15. Testing strategy

The suite runs with `npm test` (`node --test --test-concurrency=1` over `tools/marp-scroll-sync/test/*.test.cjs`). It has three layers.

1. **Pure modules** (Node only): `slide-split` (page counts equal marp-core's for every shipped deck), `source-map` (round trip: editing node *k* and re-rendering changes node *k* and nothing else, over all sample slides and many edit kinds), `slide-ops` (recount after every operation), `style-edit` (notes and page count unchanged, only the target tag changes), `layout-variants`, `folding`, `library-core` (a written mark renders identically and adds no notes; adaptation in a temporary repository with the real themes), `corpus-core` (a synthetic git repository in the OS temp folder), `home-core`, `churn-authors`.
2. **Stubbed VS Code**: `helpers/vscode-stub.cjs` replaces `require('vscode')` with a small fake. `wiring.test.cjs` and `home-wiring.test.cjs` activate the real `extension.js` and feed Webview messages directly: routing, version checks, re-render timing, save after write, fault injection.
3. **Headless Chrome** (puppeteer-core with a locally installed Chrome; skipped when none is found): `preview.test.cjs`, `layouts.test.cjs` and `overflow.test.cjs` load the real browser scripts into HTML built like `buildHtml` with a mocked `acquireVsCodeApi`; `e2e.test.cjs` uses `helpers/e2e-harness.cjs`, which runs the real `extension.js` on the stub and connects it to the real Webview HTML in Chrome, with an undo history of one unit per `applyEdit`. Its flows cover opening, editing and undoing, Shift+Enter bullets, refused edits, stale versions, slide operations, marking and inserting across themes, selection tuning, regressions of click-to-source and keyboard navigation, and preview start-up when each optional module fails to load.

Timing assertions in the shipped tests:

| What | Budget | Test |
|---|---|---|
| Right-click to all layout thumbnails, 80-slide deck | ≤ 400 ms | `layouts.test.cjs` |
| Insert popup: skeleton / shelf thumbnails | ≤ 100 / ≤ 400 ms | `preview.test.cjs` |
| Applying a patch in the Webview, 80+ slides | ≤ 50 ms | `preview.test.cjs` |
| Overflow detection per slide, 80 slides | ≤ 2 ms | `overflow.test.cjs` |
| Home list | < 400 ms | `home-wiring.test.cjs` |
| Cached search response; search over ~4,000 entries | < 30 ms | `wiring.test.cjs`, `corpus-core.test.cjs` |

Some timing tests are skipped when the environment variable `CI` is set. The end-to-end latency of a direct edit (Enter to repainted slide), of typing in the editor, and of box dragging is not asserted by the shipped tests. Nothing is tested inside a real VS Code Webview: IME composition, Alt/Option keys on each OS, drag and drop in the gallery, and the paste-edit MIME transfer were checked by hand only.

## 16. Known limitations

- **Language.** Only the command palette, the settings and the extension descriptions are localised (English, or Japanese when VS Code's display language is Japanese). Buttons, tooltips, messages, QuickPick items, status-bar labels, new-slide template placeholders, panel labels and CLI output are in Japanese.
- **Japanese-tuned heuristics.** Layout-variant thresholds count characters with Japanese text in mind, so long English bullets get fewer or no variants. Search uses substring matching without word segmentation or stemming; normalisation and class synonyms are tuned for Japanese.
- **Key binding.** ⌘K M / Ctrl+K M shadows VS Code's own chord for "Change Language Mode" (`workbench.action.editor.changeLanguageMode`) in Markdown editors; it can be rebound in Keyboard Shortcuts.
- **Repository layout.** The extension looks for `theme/academic.css` up to eight folders above the deck and indexes decks under `slides/`. The Present command falls back to `npx @marp-team/marp-cli@latest` (network) when `tools/marp-present/present.mjs` is missing.
- **History.** Revision counts need git history; a ZIP download has none, so ranking by revision is empty there. The first in-memory index build runs synchronously in the extension host.
- **Writing limits.** Edits are refused rather than guessed in links, code, emphasis boundaries and other ambiguous spots; Markdown elements cannot be box-edited and Markdown images can only be resized; editing text directly inside a `div` that also contains a list makes the whole `div` editable.
- **Adaptation.** Colours follow only when they exactly equal a palette value; a slide inserted from another theme may still overflow (warned, not fixed); copied asset files are not removed by undo.
