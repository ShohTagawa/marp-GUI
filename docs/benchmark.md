# Latency benchmark

`npm run bench` (`tools/marp-scroll-sync/bench/latency.bench.cjs`) measures the time from a gesture to the first frame that shows its result in the preview. The design goal is 0.4 s for every gesture (`tools/marp-scroll-sync/DESIGN.md`, 8.0).

## How it measures

- **Harness.** The same one as `test/e2e.test.cjs`: the real `extension.js` runs on the VS Code stub (`test/helpers/vscode-stub.cjs`), and the real Webview HTML runs in a local headless Chrome driven by puppeteer-core. Messages, document edits and undo go through the extension's own code. **It is not a real VS Code Webview**, so the time VS Code itself needs to deliver a message is not included.
- **Decks.** Copies, in a temporary folder, of `slides/sample-hydrogen` (12 slides, 16.5 KB of Markdown) and of a deck made by repeating its slides seven times (84 slides, 112.2 KB). The temporary repository also holds `sample-layouts`, `sample-parts`, `sample-lecture` and the shelf, so the insert popup has slides to show.
- **Samples.** Each gesture is repeated N = 20 times after 2 warm-up samples, and undone between samples. The tables give the median, the 90th percentile, the maximum, the number of samples over 400 ms, and the first (cold) sample.
- **Clock.** Start and end are taken inside the page with `performance.now()`; the end is the first animation frame after the preview applied the re-render (`ssPreview.onRender`). For typing in the source, the start is `Date.now()` in Node when the document changes and the end is `Date.now()` in that frame (same machine clock); this includes the 150 ms debounce of editor input.

| Gesture | Start | End |
|---|---|---|
| Direct edit | Enter after a double-click and one typed character in a bullet | frame after the edited slide is re-rendered |
| Layout thumbnails | right-click (`contextmenu`) on a slide | frame in which every thumbnail of the popup is drawn |
| Layout switch | click on another layout in that popup | frame after the slide is re-rendered with the new class |
| Insert popup | click on the ＋ between two slides | frame in which the first cards (up to six) have their thumbnails |
| Slide operation: duplicate | click on the duplicate button (slide count changes: full render) | frame after the render |
| Slide operation: move down | click on the move-down button (same count: two slides patched) | frame after the patch |
| Box drag | release after Alt+click on a figure (then Alt+↑ to the `<svg>`) and a 40 px drag | frame after the slide is re-rendered from the edited `style` |
| Typing in the source | one character added to a line in the editor | frame after the re-render |

## Result (31 October 2026)

- Machine: Apple M5, 10 cores, 16 GB; macOS 27.2 (Darwin 27.2.0, arm64)
- Node.js v26.0.0; Chrome 156.0.8078.48 (headless); `@marp-team/marp-core` 4.4.0
- Run started 08:12:58 JST; `npm run bench` took 413 s in all. No console errors in the page or the extension.
- Times in milliseconds.

| Deck (slides) | Gesture | N | Median | p90 | Max | > 400 ms | First |
|---|---|---|---|---|---|---|---|
| sample-hydrogen (12) | Direct edit | 20 | 37.9 | 39.4 | 56.4 | 0 | 32.6 |
| sample-hydrogen (12) | Layout thumbnails | 20 | 16.9 | 18.0 | 18.8 | 0 | 18.1 |
| sample-hydrogen (12) | Layout switch | 20 | 49.0 | 51.1 | 51.9 | 0 | 54.3 |
| sample-hydrogen (12) | Insert popup | 20 | 20.8 | 23.6 | 26.5 | 0 | 36.9 |
| sample-hydrogen (12) | Slide operation: duplicate | 20 | 76.1 | 80.7 | 85.2 | 0 | 88.7 |
| sample-hydrogen (12) | Slide operation: move down | 20 | 42.1 | 45.3 | 49.4 | 0 | 38.4 |
| sample-hydrogen (12) | Box drag | 20 | 43.9 | 45.2 | 46.5 | 0 | 41.8 |
| sample-hydrogen (12) | Typing in the source | 20 | 192 | 194 | 196 | 0 | 194 |
| repeated deck (84) | Direct edit | 20 | 59.4 | 61.0 | 61.8 | 0 | 58.6 |
| repeated deck (84) | Layout thumbnails | 20 | 17.2 | 18.4 | 18.7 | 0 | 15.4 |
| repeated deck (84) | Layout switch | 20 | 72.6 | 80.2 | 85.3 | 0 | 50.9 |
| repeated deck (84) | Insert popup | 20 | 22.3 | 24.6 | 27.5 | 0 | 36.6 |
| repeated deck (84) | Slide operation: duplicate | 20 | 118.3 | 126.0 | 130.4 | 0 | 131.9 |
| repeated deck (84) | Slide operation: move down | 20 | 56.0 | 58.9 | 59.6 | 0 | 62.2 |
| repeated deck (84) | Box drag | 20 | 65.9 | 66.7 | 67.3 | 0 | 66.2 |
| repeated deck (84) | Typing in the source | 20 | 203 | 206 | 209 | 0 | 204 |

The layout popups offered a median of three layouts. "Typing in the source" is dominated by the 150 ms debounce (`RENDER_DEBOUNCE_MS` in `extension.js`).

## Reproducing

```bash
npm ci && npm ci --prefix tools/marp-scroll-sync
npm run bench                             # N=20, both decks; about 7 minutes
npm run bench -- --n 5 --warmup 1         # quicker
npm run bench -- --deck sample-hydrogen   # one deck
npm run bench -- --json                   # print the JSON result
npm run bench -- --check                  # exit 1 if any maximum exceeds 400 ms
```

Each run also writes `tools/marp-scroll-sync/bench/out/latency-<timestamp>.json` (git-ignored) with every sample. The benchmark needs a local Google Chrome or Microsoft Edge (or `CHROME_PATH`). Numbers depend on the machine and on other load; the shipped tests assert only coarse budgets and skip the timing assertions when `CI` is set.
