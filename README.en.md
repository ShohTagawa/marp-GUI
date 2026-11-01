# marp-GUI

[日本語](README.md) | **English**

An environment for building Marp slides **by working directly in the VS Code preview**.
Your source stays plain Markdown. In the preview you can double-click text to fix it, right-click to pick a layout, and reorder slides.

- Synced preview: shows the slide at your cursor side by side (click it to jump to that line in the source)
- Direct editing in the preview: double-click text → Enter writes it back to the source
- Layout variants: right-click a slide → compare options such as three cards or figure-and-text columns, and switch with one click
- Slide operations: add, duplicate, reorder, delete, and search for and insert existing slides
- 📄 PDF (vector, so text stays sharp) and ▶ Present (full screen in Chrome)
- Theme `tsutawaru-academic`: academic slides with few boxes, following the rules of the Japanese book 『伝わるデザインの基本』 ("Basics of Design That Communicates")

Works on macOS and Windows (the test suite also runs on Ubuntu). Node.js 20 or later.

> **Note:** The extension's buttons, menus, and messages are currently in Japanese only. Screenshots may show Japanese labels in the interface.

> **Notice:** This software is provided free of charge, "AS IS", without warranty of any kind. To the maximum extent permitted by applicable law, the author and contributors are not liable for any damages arising from its use. See the [Disclaimer](#disclaimer) below for details.

## What you can do

![A grid of finished slides from the sample deck "Hydrogen in the Earth's Core"](docs/img/en/07-slides.png)

You can make academic slides like these from ordinary Markdown. Above are some slides from the sample deck "Hydrogen in the Earth's Core".

![The synced preview, with the current slide marked by a blue frame](docs/img/en/01-overview.png)

This is the synced preview that opens on the right side of VS Code. When you move the cursor in the source (on the left), the preview moves to that slide and marks it with a blue frame. Slide buttons appear above it, and a bar for text size and color appears at the bottom.

---

## 1. What you need (install these first)

| Item | Where to get it |
|---|---|
| **VS Code** | https://code.visualstudio.com/ |
| **Node.js** (LTS version) | https://nodejs.org/en/download |
| **Google Chrome** (or Edge) | Used for PDF output and presenting |

## 2. Download

Click the green **"Code" button → "Download ZIP"** at the top of this page, then unzip it.
Move the unzipped folder (`marp-GUI-main`) to **a place where it can stay permanently**, such as your Documents folder. (If you leave it in Downloads and later delete it, the tools will stop working.)

If you use git:

```bash
git clone https://github.com/ShohTagawa/marp-GUI.git
```

## 3. Install (one double-click)

| macOS | Windows |
|---|---|
| **Right-click → "Open"** on `install-mac.command` (first time only; choose "Open" if asked to confirm) | **Double-click** `install-windows.bat` (if you see "Windows protected your PC", click "More info" → "Run anyway") |

A black terminal window installs the required parts (a few minutes the first time), and at the end VS Code opens the sample slides.
If VS Code was already open, run **"Developer: Reload Window"** from the Command Palette (⌘⇧P / Ctrl+Shift+P).

If you are comfortable with the terminal, this one line in the folder does the same thing:

```bash
npm run setup
```

> If you move the folder somewhere else, run the installer again (it re-creates the links that register the extensions with VS Code).

## 4. Try it out

1. In VS Code, **open the `marp-GUI` folder** (File → Open Folder)
2. Open `slides/sample-layouts/sample-layouts.md`
3. Press **⌘K M** (Windows: **Ctrl+K M**) to open the synced preview on the right

| To do this | Do this |
|---|---|
| Open the home (recent / shelves / most-edited / search) | **⌘K H** (Windows: **Ctrl+K H**), or **🏠 Marp** in the status bar |
| Fix text | **Double-click** text in the preview → type → **Enter** (Esc cancels) |
| Change the layout | **Right-click** a slide in the preview → choose an option |
| Add, duplicate, move, or delete slides | Buttons at the top right of the slide (＋ ⧉ ↑ ↓ 🗑) |
| Insert existing slides between slides | The **＋** that appears when you hover between slides |
| Move or resize a box | **Alt (Option on macOS) + click** → drag |
| Make a PDF | **📄 PDF** in the status bar at the bottom (output goes to the `out/` folder) |
| Present | **▶ Present** in the status bar (F = full screen / P = presenter view / ←→ = next/previous page) |
| Undo | ⌘Z / Ctrl+Z |

### Fix text

![Double-clicking text in the preview and editing it in place](docs/img/en/02-direct-edit.png)

Double-click text in the preview to retype it in place. Press Enter to confirm, and only that part of the source is rewritten.

### Change the layout

![Right-clicking a slide shows layout options as thumbnails](docs/img/en/03-layouts.png)

Right-click a slide to see thumbnails of the same content arranged in different ways. Choosing one changes only one line in the source (`_class`).

> The layout suggestions are tuned for Japanese text. With long English bullets, fewer layouts (or none) may be offered.

### Add, duplicate, move, or delete slides

![Add, duplicate, move, and delete buttons at the top right of the selected slide](docs/img/en/04-slide-buttons.png)

Buttons appear at the top right of the slide you select in the preview. You can add a new slide, duplicate, move it earlier or later, or delete it.

### Insert existing slides

![Clicking the ＋ between slides opens a popup for choosing existing slides](docs/img/en/05-insert-popup.png)

Hover between two slides and a ＋ appears. Click it to search slides in your other decks and insert one at that position.

### Move or resize a box

![A box selected with Alt (Option) + click, showing a frame and resize handles](docs/img/en/06-box-edit.png)

Hold Alt (Option on macOS) and click to put a frame around a box. Drag to move it, and use the corner handles to resize it.

For the full list of operations and detailed settings, see [tools/marp-scroll-sync/README.md](tools/marp-scroll-sync/README.md) (in Japanese).

## 5. Make your own slides

The easiest way is to copy a whole sample folder and rename it.

```
slides/
  my-talk/            ← make the folder name
    my-talk.md        ← and the .md name match
    src/              ← put images here; refer to them from the .md as ./src/fig01-xxx.png
    out/              ← PDFs and other output go here
  assets/             ← images shared by several decks, such as logos
```

- Use **only ASCII letters, digits, and hyphens** in file names (full-width characters and spaces cause broken links)
- For the logo, replace `slides/assets/logo-placeholder.png`, or change the image in `header:` at the top of the .md
- For the photo on the title slide, replace `slides/assets/profile-placeholder.png`

### How to write the source (minimal)

```markdown
---
marp: true
theme: tsutawaru-academic
paginate: true
header: '<div class="hdr-left">Talk title</div><img class="hdr-logo" src="../assets/logo-placeholder.png" alt="Logo">'
---

<!-- _class: lay-cards3 -->

## Heading

- **First**
  Explanation
- **Second**
  Explanation
- **Third**
  Explanation

<div class="takeaway">The one thing this slide should say</div>
```

- Slides are separated by `---` (with a blank line before and after)
- Adding one word of **layout class**, such as `<!-- _class: lay-cards3 -->`, changes the arrangement (the right-click layout options rewrite this).
  See `sample-layouts.md` for the available layouts and `sample-parts.md` for the parts
- The key-point band at the bottom is `<div class="takeaway">…</div>`

## 6. Troubleshooting

| Problem | What to do |
|---|---|
| ⌘K M does not open the preview / the buttons are missing | Run the installer again → "Developer: Reload Window" in VS Code |
| 📄 / ▶ do not appear | Check that the .md starts with `marp: true`, and that VS Code has the **marp-GUI folder** open |
| PDF stops with "Printing failed" | In a terminal, run `npm run pdf:safe -- slides/<deck>/<deck>.md` (splits the job into smaller pieces) |
| "Node.js not found" | After installing Node.js, reopen VS Code and run the installer again |
| You want to check the setup | `npm run setup:check` |

## 7. Using it from the terminal (optional)

```bash
npm run pdf      -- slides/<deck>/<deck>.md   # vector PDF (no argument = the deck you edited last)
npm run present  -- slides/<deck>/<deck>.md   # full-screen presentation in Chrome
npm run png      -- slides/<deck>/<deck>.md   # every page as PNG
npm run lint     -- slides/<deck>             # checks for too many boxes, too much text, etc.
```

## 8. Tests (for developers)

The synced-preview extension ships its test suite in `tools/marp-scroll-sync/test/`, run by Node's built-in test runner.

```bash
npm test
```

- The pure-logic tests (slide splitting, source mapping, slide operations, folding, library, index, layout variants, home screen) use only the three sample decks in `slides/` (`sample-layouts`, `sample-parts`, `sample-lecture`).
- The tests that drive the real preview (direct editing, box editing and cropping, gallery, end-to-end flows) need a local Google Chrome and `puppeteer-core` (installed by `npm install`). If Chrome is not found, only those tests are skipped.
- 346 tests in total (one, which writes a mock-up of the folded editor, is skipped unless `FOLDED_VIEW_OUT` is set); about 5 minutes with a local Chrome (files run one at a time, because some tests measure timing budgets).
- GitHub Actions (`.github/workflows/test.yml`) runs the same suite on macOS, Windows and Ubuntu with Node 20 and 22 (the timing-budget tests are skipped on shared runners).
- The sample deck `sample-lecture` is a fictional lecture deck that gathers the structures the tests rely on (an HTML table, inline SVG, a QR column, slides with and without `_class`).
- `npm run bench` measures the time from a gesture to the repainted preview on the same harness (results: [docs/benchmark.md](docs/benchmark.md)); `npm run screenshots` re-takes the screenshots in `docs/img/`; `npm run demo:ranking` builds a small temporary git repository and shows how the library ranks slides by their revision history.

## Contents

```
theme/            five themes: academic.css (base), tsutawaru-academic.css (recommended),
                  tsutawaru-simple.css, tsutawaru-simple-cud.css (colour-universal palette), ponchie.css (one-page overview)
slides/           13 sample decks: sample-hydrogen, -academic, -ponchie, -tsutawaru-simple and
                  -tsutawaru-simple-cud in English and Japanese (-ja); sample-layouts (layout classes),
                  sample-parts (parts), sample-lecture (test fixture); shared images in assets/
docs/             DESIGN.en.md, design-rules.md (lint rules), benchmark.md, security-review.md, examples/
tools/
  marp-scroll-sync/   VS Code extension: synced preview, direct editing, layout options, slide operations
  marp-pdf/           vector PDF (print in chunks, then merge) and the VS Code extension for the 📄/▶ buttons
  marp-present/       full-screen presentation in Chrome
  marp-library.mjs    search and insert existing slides (used by the ＋ in the preview)
  marp-png.mjs        every page as PNG
  tsutawaru-lint.mjs  design-rule lint (English or Japanese messages: --lang en|ja)
  demo/               revision-ranking demo (npm run demo:ranking)
  run-tests.mjs       runs the test files one at a time (npm test; works on Node.js 20 and later)
  setup.mjs           the setup itself (called by the installers)
install-mac.command / install-windows.bat
```

The VS Code extensions are not installed through the Marketplace. Instead, this folder is registered (linked) into `~/.vscode/extensions/`. To remove them, delete `~/.vscode/extensions/marp-gui.scroll-sync` and `marp-gui.pdf` (they are links, so the files in this folder are not deleted).

## Supporting Chiba University

These tools are developed on a limited budget. If you find them useful, please consider making a donation to the Chiba University Fund (千葉大学基金). Donations support education and research at Chiba University in general; they are not earmarked for the development of this software.

- Chiba University Fund (in Japanese): https://kikin.chiba-u.ac.jp/
- How to donate (in Japanese): https://kikin.chiba-u.ac.jp/howto

## License

Every source file carries an `SPDX-License-Identifier: Apache-2.0` header with the copyright notice.

Apache License 2.0 ([LICENSE](LICENSE)). You are free to use and modify the themes, extensions, and tools.

## Disclaimer

The following restates, for clarity, the points of Section 7 (Disclaimer of Warranty) and Section 8 (Limitation of Liability) of the Apache License 2.0. It is supplementary only and does not change or add to the license terms. If anything here conflicts with the [LICENSE](LICENSE), the LICENSE prevails.

- This software is provided free of charge, "AS IS", without warranties or conditions of any kind, express or implied, including any warranties of merchantability, fitness for a particular purpose, or non-infringement.
- To the maximum extent permitted by applicable law, the author and contributors shall not be liable for any damages arising out of the use of or inability to use this software, including loss of data, corruption of slides or source files, work stoppage, or any other direct, indirect, incidental, or consequential damages.
- Where liability cannot be excluded by law, any such liability is limited to the amount you paid for this software (which is zero, as it is free).
- This software rewrites your source files directly. Please keep your own backups of important files.
- Marp renders the HTML in a deck as is. Before opening a deck (.md file) from an unknown or untrusted source, check its contents. Deciding which files to open is your own responsibility.
- Most of the code was written with an AI coding agent from the author's specifications. It is checked by 346 automated tests (`npm test`); the repository's GitHub Actions workflow runs them on Ubuntu, macOS and Windows with Node.js 20 and 22. A security review is recorded in [docs/security-review.md](docs/security-review.md), including the findings that are still open. Tests and reviews reduce defects and vulnerabilities but cannot rule them out.
