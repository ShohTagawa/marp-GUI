# Design summary of the preview extension (marp-scroll-sync)

An English summary of [`tools/marp-scroll-sync/DESIGN.md`](../tools/marp-scroll-sync/DESIGN.md) (Japanese; the contract between modules), checked against the code of extension version 0.4.0. Only shipped features are described; where the two differ, the code was followed. Function names are given so that each statement can be checked in the source.

## 1. Purpose

`marp-scroll-sync` adds to VS Code a synced [Marp](https://marp.app/) preview on which routine edits are made directly: text is edited in place and written back; slides are added, duplicated, moved and deleted; boxes are moved and resized; layouts are switched among thumbnail variants; slides of all decks in the repository are searched (ranked by how often they were revised in git) and inserted into another deck with assets, CSS and colours adapted. Folding keeps the source readable. The Markdown file remains the single source of truth.

## 2. Four invariants

**(i) Unmodified `marp-cli` output.** No Marp engine or plugin is registered for export; PDF, HTML and PNG come from the standard `marp-cli`. The preview uses its own `@marp-team/marp-core` instance (`extension.js` `marpFor`) with a markdown-it rule (`lib/source-map.cjs` `attachLineInfo`) that adds `data-line`/`data-line-end` and, inside HTML blocks, `data-hline` attributes; these exist only in the preview. What the extension writes is ordinary Marp syntax: inline `style` attributes, `<span class="ss-tune" style="…">`, `_class` values, the keys `_lib`/`_from` inside the same directive comment as `_class` (Marpit then treats the whole comment as a directive, so it is neither rendered nor added to presenter notes), comments only at the end of an opening block tag's line, and the image keywords `w:`/`h:`. Tests re-render edited sources with marp-core and check that notes and page counts are unchanged.

**(ii) Write only when the source position is unique; otherwise move the cursor.** Every planner returns edits or `{ ok: false, reason, line }`. On failure nothing is written: the preview shows a short message and `guideToLine` selects and highlights the source line. Every Webview message carries the `doc.version` it was rendered from, and edits against a changed document are refused (`staleVersion`); the one exception is a slide operation arriving right after the preview's own text commit (`staleForSlideOp`).

**(iii) One gesture = one `WorkspaceEdit` = one undo.** `replaceMinimal` strips the common prefix and suffix of the old and new full text (never inside a surrogate pair or CRLF) and applies a single replacement, so multi-step gestures (commit text and add a bullet, renumber a list, insert several slides) undo with one Cmd/Ctrl+Z. With focus in the preview, Cmd/Ctrl+Z and redo keys are forwarded and executed in the editor. Only copied asset files are not undone. By default the file is saved right after each write (`saveAfterWrite`), so that tools rewriting the file on disk do not meet an unsaved buffer.

**(iv) Re-render only changed slides, within 0.4 s.** No gesture should take more than 0.4 s from input to visible result. The cost is replacing the Webview DOM, not rendering, so only changed slides are sent (section 4); popups show a synchronous skeleton and fill thumbnails later. Section 14 lists the budgets the shipped tests assert.

Supporting rules: no npm dependency besides `@marp-team/marp-core`; optional modules load through `safeRequire`, so a broken module disables one feature, not the preview (tested by fault injection); logic independent of VS Code lives in pure modules; `engines.vscode` is `^1.80.0` and newer APIs are feature-detected.

## 3. Module map

| File | Responsibility | Kind |
|---|---|---|
| `extension.js` | Activation, commands, Webview and CSP, message dispatch, version checks, `replaceMinimal`, render/patch, size/colour, present | VS Code |
| `lib/slide-split.cjs` | Slide boundaries identical to marp-core's; `splitDeck`, `slideMeta` | pure |
| `lib/source-map.cjs` | Preview line attributes; DOM text node → source offset; text-edit planning | pure |
| `lib/slide-ops.cjs` | Duplicate, delete, move, insert, templates, bullets | pure |
| `lib/style-edit.cjs` | Box position/size → `style` attribute or image alt | pure |
| `lib/layout-variants.cjs` | `lay-*` table, slide analysis, `_class` rewrite | pure |
| `lib/folding.cjs` | Folding ranges, slide and panel labels, leaky comments | pure |
| `lib/folding-vscode.cjs` | Folding provider, decorations, auto-fold, diagnostics | VS Code |
| `lib/library-core.cjs` | Marks, library index, CSS parser, palettes, slide adaptation | pure + fs |
| `lib/library-vscode.cjs` | Mark input, library insert, adaptive paste | VS Code |
| `lib/corpus-core.cjs` | Slide index, git revision counts, score, de-duplication, search, shelves | pure + fs + git |
| `lib/corpus-vscode.cjs` | In-memory index, background rebuild, thumbnails, insert, shelf edits | VS Code |
| `lib/home-core.cjs` / `home-vscode.cjs` | Home-screen lists / Webview panel | pure / VS Code |
| `media/textnodes.js` | Text nodes of a slide in DOM order (shared with tests) | browser |
| `media/preview.js` (+ `.css`) | Preview UI; exposes `window.ssPreview` | browser |
| `media/overflow.js` | `window.ssDetectOverflow(section)` | browser |
| `media/layouts.js` (+ `.css`) | Layout-variant popup | browser |
| `media/boxedit.js` (+ `.css`) | Box moving and resizing | browser |
| `media/home.js` (+ `.css`) | Home-screen UI | browser |

`tools/marp-library.mjs` is a thin CLI over `library-core.cjs` and `corpus-core.cjs`, so the CLI and the extension share one implementation. Planners return `{ start, end, text }` ranges in UTF-16 offsets of `doc.getText()`; only `extension.js` and the `*-vscode.cjs` modules turn them into a `WorkspaceEdit`.

## 4. Rendering and patching

`buildHtml` renders the deck with a cached Marp instance (rebuilt when a `theme/*.css` file changes) and sets a Content Security Policy whose `script-src` is a random nonce given only to the extension's scripts and Marp's helper script, so scripts and event attributes inside a deck do not run; thumbnails of other decks are additionally sanitised.

`renderUpdate` cuts the HTML into per-slide `<svg data-marpit-svg>` strings and compares them with the last ones sent. If document, CSS, the HTML around the slides and the slide count are unchanged, it sends a `patch` with only the changed slides, otherwise a full `render`. Random scope ids of `<style scoped>` are renumbered (`stableScopes`) so that scoped CSS does not defeat patching. Typing in the editor is debounced by 150 ms; edits from the preview re-render at once. `applyPatch` in the Webview replaces only the listed `<svg>` elements, keeping scroll position and media state; stale patches are dropped, an unusable one triggers a full render, and while a text edit is open renders are held.

## 5. Direct-edit pipeline

1. **Start.** Double-click makes the nearest block element (`li`, `p`, heading, cell, `div`…) `contenteditable="plaintext-only"`, never the whole section; SVG `<text>` gets an overlaid input.
2. **Commit.** Enter (outside IME composition) or blur commits, Escape cancels; Shift+Enter in a list item also starts a new bullet; Backspace in an empty bullet deletes it. The Webview sends `editCommit { index, version, nodes, changes: [{ k, old, now }], … }`, where `nodes` lists the slide's text nodes with their nearest line attribute.
3. **Locate.** `source-map.cjs` masks tags, comments, `<style>`, link destinations and similar parts of the slide's source with `\0` of equal length, then walks the nodes in DOM order with a forward-only cursor, searching each node's trimmed text inside the line window of its element. Entities, backslash escapes and CRLF are matched character by character; nodes absent from the source (math, emoji images) are skipped.
4. **Plan.** `planTextEdit` writes only if node *k* was found and the source there equals `old`; surrounding whitespace is kept byte for byte, and characters that would become Markdown syntax are escaped (`\ * _ \` [ ] ~ $`, `<`, line-start markers such as `#`, `-`, `1.`, `---`). Text typed just outside a node's edge whitespace is placed by `planEdgeEdit` after checking the source. More than twenty refusal reasons (e.g. `ambiguous`, `autolink`, `code-highlight`, `emphasis-boundary`, `setext`) all mean "do not write; move the cursor".
5. **Write and verify.** All edits are applied together or not at all, written as one minimal replacement, and saved. The next render carries `expect { index, k, text }`; if the re-rendered node differs, the preview warns that Cmd+Z restores the source.

Selecting text in the preview (`tuneSelect`, `planRangeSelect`) selects the same range in the editor for the size/colour tools.

## 6. Slide operations and size/colour

Buttons above the current slide (new, duplicate, up, down, delete, mark, library) send `slideOp`; the same commands act on the slide under the cursor without the preview. `slide-ops.cjs` keeps the blank lines around `---` and the line endings, drops `_lib` from copies, and recounts the slides of the result; if the count is unexpected, nothing is written. Separator forms on which the splitter could disagree with Marp (`***`, `___`, indented `---`, `headingDivider`) are refused. New slides come from six templates.

Size/colour wraps a one-line selection in `<span class="ss-tune" style="font-size:Npx !important; color:… !important">` or updates an existing span (never nesting), ±1 px from the measured size. Theme swatches write `var(--accent)`/`var(--accent-dark)` so the colour follows the deck the slide is later pasted into.

## 7. Box editing

With Alt held, `media/boxedit.js` outlines the HTML element under the pointer; Alt+click selects it with eight handles. Drag moves, handles resize (aspect ratio kept for `img`, `svg`, `video`, `canvas`), arrows move 1 px (Shift: 10 px), Alt+↑/↓ select the parent/child, `0` resets; moves snap within 6 px to centre lines and sibling edges unless Cmd/Ctrl is held. During a drag only the Webview DOM changes; on release one `boxCommit` is sent in 1280×720 slide pixels.

`lib/style-edit.cjs` writes position as the CSS `translate` property (visual only; removed at 0,0) and size as `width`/`height` in the element's `style` attribute, keeping other declarations and their order, with `!important` when the Webview finds the deck's CSS winning. An element is identified by its `data-hline`, its rank among elements on that line and its tag name; opening tags are counted twice (from the slide start and from the preceding blank line) and the edit is written only if both agree. Markdown images can only be resized (`w:`/`h:` in the alt text); Markdown paragraphs, items and headings cannot be box-edited.

## 8. Layout variants

`theme/tsutawaru-academic.css` defines twelve layout classes (`lay-boxed`, `lay-cards2`, `lay-cards3`, `lay-keyrow`, `lay-flow`, `lay-steps`, `lay-fig-right`, `lay-fig-left`, `lay-fig-top`, `lay-fig-only`, `lay-lead`, `lay-points`) that re-arrange the same plain Markdown (heading, list or paragraphs, one figure, takeaway) by CSS alone; the rules behind them are in [design-rules.md](design-rules.md). `layout-variants.cjs` analyses a slide (plain or wrapped in layout `div`s, number and kind of items, figures, text length) and offers only matching variants after "standard"; variants putting more than three items side by side are not offered. The table is injected as `window.__SS_LAYOUTS__`; its matching function exists in Node and in the browser, and a test checks that both agree on all sample slides.

Right-click (or `L`) opens a popup whose thumbnails are clones of the current slide's DOM with only the section class replaced — no render, no round trip — each checked with `ssDetectOverflow` and marked ⚠ if it overflows. Hover previews on the real slide; click sends `layoutApply`, and `planSetLayout` swaps the `lay-*` token in `_class` (adding `_class`, with any global `class` copied in, if needed). A QuickPick command offers the same list.

## 9. Folding and labels

`folding.cjs` provides ranges for each slide, the front-matter `style:` block (a leading `:root { … }` block stays visible), and multi-line `<style>`, `<svg>` and comments. With `autoFold`, opening a deck folds all slides but the current one; entering another slide's body folds the previous one, while `style`/`svg` blocks stay folded (`autoFoldKinds`). Moves by commands or find/replace, multiple cursors and selections are ignored; success is checked through `visibleRanges`, with retries. Decorations show `number | class | title ★` on separator lines and region names after tags such as `<div class="left">`. Nothing is written unless "Write Panel Names…" is run, which puts a comment at the end of the opening tag's line only. A diagnostic flags label-like comments that would leak into presenter notes.

## 10. Library: marks and adaptation

A finished slide is marked with `_lib: <id> | tags | date` beside `_class` (a `_class` line is added if missing, copying a global `class` so the look does not change); a lone `_lib` comment, which would become a note, gets a Warning. `library-core.cjs` builds `slides/_library/index.json` (generated), including unsaved editor contents; slide bodies are re-read from their decks on insert. `adaptSlide` plans an insertion without touching files:

1. header, footer, theme colours and logo come from the destination's front matter and are not touched;
2. `./src/…` assets are copied (same content reused; a name clash gets `-2` and references are rewritten); `../assets/…` paths are fixed for folder depth;
3. deck-specific CSS rules of classes the slide uses are carried: skipped if identical, put in `<style scoped>` if the destination defines the class differently, else appended to the destination's `style:`;
4. hex colours equal to one of the source's four palette variables become `var(--accent, #original)` in attributes and CSS, unless original colours are kept;
5. a theme mismatch is warned about, listing classes missing in the destination; optionally (`keepTypo`) the source theme's body sizes and spacing are carried in a marked `<style scoped>` block;
6. `_lib` becomes `_from: <id>` in the copy.

Entry points: ★ and 📚 buttons, the commands "Mark/Unmark…" and "Insert Finished Slide from Library…", the CLI, and an adaptive paste option where VS Code offers the paste-edit API.

## 11. Corpus: revision history and search

`buildCorpus` (`corpus-core.cjs`) indexes every slide of every `marp: true` deck under `slides/` (skipping `out/`, `_library/`, working and backup folders): title (`page-title`, else first heading), class, theme, date from the folder name, up to 600 characters of plain text (SVG labels for figure-only slides), mark, and revision record. A cache keyed on file size and modification time makes rebuilds incremental.

**Aligning slides across git history** (`churnOf`). One `git log -M -C --find-copies-harder --name-status` reads the history of all Markdown files, following renames and copies; one `git cat-file --batch` reads all versions. Each slide is reduced to the set of its trimmed, non-empty lines without `_class` and `_lib` lines. From the oldest version to the newest, with the working tree as the last version, every current slide is matched greedily to the unused slide of that version with the highest score = Jaccard similarity of the line sets + 1 if the non-empty titles are equal; scores below 0.3 mean no match. Whenever the matched slide differs from the previously matched one (multiset line difference > 0), `touched` is incremented and the difference added to `lines`. Commits by an AI coding agent (recognised by its no-reply author address) are left out of a separate `human` count.

**Score** (`scoreOf`, pinned by tests): +6 if marked; + 3·(1 − 0.6^touched); + min(1, log10(1 + lines)/3); + 0.1 per tuned span (≤ 0.5); + 0.4/0.2 for decks in an optional author-maintained group list (absent from the package, so 0); + up to 0.3 for recency relative to the newest deck; −2 for decks that look machine-converted from presentation software, unless marked.

**Duplicates** (`dedupe`): slides with the same normalised title (or the same first 40 characters) and character-4-gram Jaccard ≥ 0.7 form a bundle represented by the highest-scoring slide.

**Search** (`searchCorpus`): space-separated terms combined with AND, normalised (NFKC, lower case, no whitespace, no Japanese long-vowel mark) and matched as substrings, without word segmentation. Per term: title 10 (exact title 14), mark id/tags 8, body 3 (4 within the first 80 characters), deck name 2, class name 2 (with Japanese synonyms), shelf label 10, shelf name 8; a term matching nowhere excludes the slide. Relevance is the sum plus the score. Hits are de-duplicated; slides on a shelf come first. **Shelves** (`slides/_library/shelf.json`, tracked in git) are user-named, user-ordered slide lists, resolved by mark id, then title, then slide number; unresolved items stay as "missing".

**In the extension**, `corpus-vscode.cjs` keeps the index in memory, builds it first without reading git (reusing revision counts of unchanged decks from `corpus.json`), and rebuilds it 1.5 s after Markdown changes or when older than 60 s. If `corpus.json` is missing, lacks history or belongs to another `HEAD`, one child process runs `tools/marp-library.mjs corpus` with the extension host's Node. Thumbnails are rendered once per deck and cached (40 decks, LRU); at most 90 ms per response goes into rendering, the rest follows in a second response. In the Webview each thumbnail is a Shadow DOM host sharing one parsed `CSSStyleSheet` per deck.

A + button between slides (`+`/`i` on the keyboard) opens a popup with a search field, shelves and the top-scored slides, prefetched while idle; "more" opens a full gallery with filters, sorting and the options "keep original colours" and "keep original typography". `corpusInsert` adapts each selected slide on the intermediate text and writes one minimal replacement; assets are copied first and removed if writing fails, and the slide count must grow by exactly the number inserted.

## 12. Home screen and overflow

The home screen (`home-vscode.cjs`; command, ⌘K H / Ctrl+K H, status bar, or on start-up when the workspace has `theme/academic.css` and no deck is visible) is read-only. Tabs show recent decks (12, in `workspaceState`), shelves, most-edited slides (by revision count, human revision count, score or last revision date) and all decks; a search box uses `searchCorpus`. Opening a card puts the cursor on that slide and opens the preview. Lists come from the in-memory index; thumbnails are fetched for visible cards in 60 ms batches.

`media/overflow.js` measures a slide in 1280×720 coordinates, counting only visible in-flow boxes (text, replaced elements, boxes with background or border; not header, footer, absolutely positioned elements, `.takeaway`, `.page-title`). It reports how far content passes the floor (24 px above the bottom edge or the top of a bottom-fixed `.takeaway`), and collisions with the takeaway, the header and the next block. The preview runs it in idle time for re-rendered slides and badges overflowing ones with ⚠.

## 13. Configuration

| Setting | Default | Effect |
|---|---|---|
| `marpScrollSync.autoFold` | `true` | Fold all slides but the current one |
| `marpScrollSync.autoFoldKinds` | `["style","svg"]` | Blocks kept folded in the open slide (`style`, `svg`, `notes`) |
| `marpScrollSync.slideLabels` | `true` | Labels on separator lines |
| `marpScrollSync.panelLabels` | `true` | Region names after block tags |
| `marpScrollSync.adaptivePaste` | `true` | Offer adaptive paste |
| `marpScrollSync.saveAfterEdit` | `true` | Save after each write by the extension |
| `marpScrollSync.home.onStartup` | `true` | Open the home screen on start-up |
| `marpScrollSync.home.openPreview` | `true` | Open the preview from a home card |

The companion extension `marp-gui-pdf` adds `marpGui.chunkSize`, `marpGui.chromePath` and `marpGui.nodePath`. Keys: ⌘K M / Ctrl+K M preview (Markdown editors), ⌘K H / Ctrl+K H home, Cmd+Alt+= / − (Ctrl+Alt on Windows and Linux) font size. Command titles and setting descriptions are localised through `package.nls.json` (English) and `package.nls.ja.json` (Japanese).

## 14. Testing strategy

`npm test` runs `node --test --test-concurrency=1` over `tools/marp-scroll-sync/test/*.test.cjs` in three layers.

1. **Pure modules**: `slide-split` (page counts equal marp-core's for every shipped deck), `source-map` (round trip: editing node *k* and re-rendering changes node *k* and nothing else), `slide-ops` (recount after every operation), `style-edit` (notes and page count unchanged, only the target tag changes), `layout-variants`, `folding`, `library-core` (marks render identically; adaptation in a temporary repository), `corpus-core` (a synthetic git repository), `home-core`, `churn-authors`.
2. **Stubbed VS Code**: `helpers/vscode-stub.cjs` replaces `require('vscode')`; `wiring.test.cjs` and `home-wiring.test.cjs` activate the real `extension.js` and feed Webview messages: routing, version checks, re-render timing, save after write, fault injection.
3. **Headless Chrome** (puppeteer-core with a local Chrome; skipped without one): `preview`, `layouts` and `overflow` tests load the real browser scripts into HTML built like `buildHtml`; `e2e.test.cjs` connects the real `extension.js` on the stub to the real Webview in Chrome (`helpers/e2e-harness.cjs`, one undo unit per `applyEdit`) and runs editing, undo, refused and stale edits, slide operations, cross-theme insertion and start-up with each optional module missing.

| Timing asserted | Budget | Test |
|---|---|---|
| Right-click → all layout thumbnails, 80 slides | ≤ 400 ms | `layouts` |
| Insert popup skeleton / shelf thumbnails | ≤ 100 / ≤ 400 ms | `preview` |
| Applying a patch, 80+ slides | ≤ 50 ms | `preview` |
| Overflow detection per slide, 80 slides | ≤ 2 ms | `overflow` |
| Home list | < 400 ms | `home-wiring` |
| Cached search; search over ~4,000 entries | < 30 ms | `wiring`, `corpus-core` |

Some timing tests are skipped when `CI` is set. The shipped tests do not assert the end-to-end latency of a direct edit, of typing in the editor or of box dragging, and nothing runs inside a real VS Code Webview: IME input, Alt/Option keys per OS, gallery drag and drop and the paste-edit transfer were checked by hand.

## 15. Known limitations

- **Language.** Only command titles, settings and extension descriptions are localised (English, or Japanese when VS Code's display language is Japanese). Buttons, messages, QuickPicks, status-bar labels, template placeholders, panel labels and CLI output are Japanese.
- **Japanese-tuned heuristics.** Layout thresholds count characters with Japanese text in mind, so long English bullets get fewer variants; search is substring matching without segmentation or stemming.
- **Key binding.** ⌘K M / Ctrl+K M shadows VS Code's "Change Language Mode" chord (`workbench.action.editor.changeLanguageMode`) in Markdown editors; it can be rebound.
- **Layout and history.** The extension looks for `theme/academic.css` up to eight folders above the deck and indexes `slides/`. Revision ranking needs git history, which a ZIP download lacks. The first index build blocks the extension host briefly. "Present" falls back to `npx @marp-team/marp-cli@latest` (network) if `tools/marp-present/present.mjs` is missing.
- **Writing limits.** Edits in links, code, emphasis boundaries and other ambiguous spots are refused rather than guessed; Markdown images can only be resized; editing text placed directly in a `div` that also holds a list makes the whole `div` editable.
- **Adaptation.** Colours follow only on exact palette matches; a slide from another theme may still overflow (warned, not fixed); undo does not remove copied assets.
