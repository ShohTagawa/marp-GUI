---
marp: true
theme: tsutawaru-academic
paginate: true
size: 16:9
lang: en
header: '<div class="hdr-left">Getting started with marp-GUI</div><img class="hdr-logo" src="../assets/logo-placeholder.png" alt="Logo">'
footer: ''
style: |
  :root {
    --measure: 42em;   /* line length: 16:9 leaves room on the right, so widen 28em to 42em */
    --hdr-left-w: fit-content;   /* title band follows the English title (the theme default 23% clips it) */
    --hdr-left-max: 46%;         /* the band may grow to 46% so that the long English title is not clipped (default 38%) */
  }
---

<!-- _class: cover-hero -->
<!-- _paginate: false -->

<div class="title-hero">
<div class="title-small">Sample deck</div>
<div class="title-big long">Getting started with marp-GUI</div>
<div class="title-sub">Write the slides as Markdown,<br>shape them in the VS Code preview</div>
</div>

<div class="title-foot">
<div class="title-photo"><img src="../assets/profile-placeholder.png" alt="Photo"></div>
<div class="title-meta">
<div class="title-name">Your name</div>
<div class="title-affil">Your affiliation</div>
</div>
</div>

<!--
Sample deck for marp-GUI, in English. It walks through the workflow in twelve slides and uses
most of the layout classes of the theme tsutawaru-academic. Every figure was drawn for this deck.
-->

---

## Your slides stay plain text

- **One file per deck**
  A deck is one Markdown file; its images sit next to it in `src/`.
- **Every gesture becomes a text edit**
  Whatever you do in the preview is written into that file as one small edit.
- **One undo step**
  ⌘Z (Ctrl+Z) in the editor takes any preview gesture back.

<div class="takeaway">The Markdown file is the only state; the preview is a view of it</div>

---

<!-- _class: lay-fig-right -->

## The preview follows your cursor

<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Editor on the left and synchronized preview on the right; the cursor line in the editor and the framed slide in the preview point at each other">
<rect x="2" y="2" width="256" height="396" rx="3" fill="var(--fill, #F1F1F1)"/><text x="130" y="36" font-size="22" font-weight="700" text-anchor="middle" fill="var(--ink, #262626)">Editor (.md)</text><rect x="22" y="58" width="160" height="12" fill="var(--rule, #D6D6D6)"/><rect x="22" y="82" width="200" height="12" fill="var(--rule, #D6D6D6)"/><rect x="22" y="106" width="120" height="12" fill="var(--rule, #D6D6D6)"/><rect x="14" y="146" width="232" height="60" fill="var(--accent-soft, #F6E9EC)"/><rect x="22" y="160" width="190" height="12" fill="var(--accent, #A6192E)"/><rect x="22" y="184" width="150" height="12" fill="var(--accent, #A6192E)"/><rect x="22" y="232" width="180" height="12" fill="var(--rule, #D6D6D6)"/><rect x="22" y="256" width="200" height="12" fill="var(--rule, #D6D6D6)"/><rect x="22" y="280" width="140" height="12" fill="var(--rule, #D6D6D6)"/><rect x="22" y="304" width="190" height="12" fill="var(--rule, #D6D6D6)"/><text x="130" y="372" font-size="20" text-anchor="middle" fill="var(--ink, #262626)">cursor on slide 2</text>
<rect x="342" y="2" width="256" height="396" rx="3" fill="var(--fill, #F1F1F1)"/><text x="470" y="36" font-size="22" font-weight="700" text-anchor="middle" fill="var(--ink, #262626)">Preview</text><rect x="362" y="56" width="216" height="78" fill="#fff" stroke="var(--rule, #D6D6D6)" stroke-width="2"/><rect x="358" y="146" width="224" height="86" fill="#fff" stroke="#2F7DD1" stroke-width="4"/><rect x="372" y="162" width="120" height="10" fill="var(--accent, #A6192E)"/><rect x="372" y="184" width="180" height="8" fill="var(--rule, #D6D6D6)"/><rect x="372" y="200" width="150" height="8" fill="var(--rule, #D6D6D6)"/><rect x="362" y="244" width="216" height="78" fill="#fff" stroke="var(--rule, #D6D6D6)" stroke-width="2"/><text x="470" y="372" font-size="20" text-anchor="middle" fill="var(--ink, #262626)">slide 2 is framed</text>
<path d="M262 176H336" fill="none" stroke="var(--ink, #262626)" stroke-width="3"/><path d="M328 168L340 176L328 184Z" fill="var(--ink, #262626)"/><path d="M336 204H262" fill="none" stroke="var(--ink, #262626)" stroke-width="3"/><path d="M270 196L258 204L270 212Z" fill="var(--ink, #262626)"/>
</svg>

- Open a deck and press ⌘K M (Ctrl+K M)
- Move the cursor: the preview scrolls to that slide and frames it
- Click a slide: the editor jumps to its first line

<div class="takeaway">Two views of one file, kept in step both ways</div>

---

<!-- _class: lay-steps -->

## Fix a sentence without leaving the preview

1. **Double-click the text**
   The paragraph, bullet or heading opens for typing in place.
2. **Type the new wording**
   Alt+Enter inserts a line break; Esc gives up.
3. **Press Enter**
   Only that part of the source is rewritten, as one undo step.

<div class="takeaway">Text inside code, links or ambiguous positions is refused, never guessed</div>

---

<!-- _class: lay-cards3 -->

## Pick a layout with one word

- **Three cards**
  `lay-cards3` puts three items of equal weight side by side.
- **Figure and text**
  `lay-fig-right` and `lay-fig-left` split a figure and its bullets.
- **Numbered steps**
  `lay-steps` and `lay-flow` show an order, downward or left to right.

<div class="takeaway">Right-click a slide to compare the layouts as thumbnails, then click one</div>

---

<!-- _class: lay-keyrow -->

## Slides are handled in the preview too

- **Add and duplicate**
  The buttons at the top right of the selected slide.
- **Move up or down**
  The whole slide, with its notes, moves in the source.
- **Insert from another deck**
  Hover between two slides and press ＋ to search your other decks.

<div class="takeaway">Every operation re-counts the slides before it writes</div>

---

<!-- _class: lay-fig-left -->

## Move a box by dragging

<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A slide with a selected box: a frame with corner handles, an arrow showing the drag, and the style attribute that is written to the source">
<rect x="2" y="2" width="596" height="300" rx="3" fill="#fff" stroke="var(--rule, #D6D6D6)" stroke-width="2"/><rect x="2" y="2" width="596" height="30" fill="var(--accent, #A6192E)"/><rect x="40" y="58" width="260" height="18" fill="var(--ink, #262626)"/><rect x="40" y="100" width="200" height="12" fill="var(--rule, #D6D6D6)"/><rect x="40" y="124" width="170" height="12" fill="var(--rule, #D6D6D6)"/><rect x="40" y="148" width="190" height="12" fill="var(--rule, #D6D6D6)"/>
<rect x="330" y="92" width="200" height="120" fill="var(--fill, #F1F1F1)" stroke="var(--rule, #D6D6D6)" stroke-width="2" stroke-dasharray="6 5"/>
<rect x="372" y="138" width="200" height="120" fill="var(--accent-soft, #F6E9EC)" stroke="#2F7DD1" stroke-width="3"/><rect x="365" y="131" width="14" height="14" fill="#fff" stroke="#2F7DD1" stroke-width="3"/><rect x="565" y="131" width="14" height="14" fill="#fff" stroke="#2F7DD1" stroke-width="3"/><rect x="365" y="251" width="14" height="14" fill="#fff" stroke="#2F7DD1" stroke-width="3"/><rect x="565" y="251" width="14" height="14" fill="#fff" stroke="#2F7DD1" stroke-width="3"/><text x="520" y="240" font-size="22" font-weight="700" text-anchor="middle" fill="var(--ink, #262626)">box</text>
<path d="M430 152L466 192" fill="none" stroke="var(--ink, #262626)" stroke-width="3"/><path d="M470 184L472 200L456 196Z" fill="var(--ink, #262626)"/>
<text x="300" y="350" font-size="22" text-anchor="middle" fill="var(--ink, #262626)">Written to the source:</text><text x="300" y="384" font-size="22" font-weight="700" text-anchor="middle" fill="var(--accent-dark, #7D1322)">style="width:…; translate:…"</text>
</svg>

- Alt-click (Option-click on macOS) selects a box
- Drag to move it; the corner handles resize it
- Press C to crop an image inside it

<div class="takeaway">The source gets a style attribute on that element, nothing else</div>

---

<!-- _class: lay-flow -->

## Export when you are ready

1. **📄 PDF**
   Vector output; long decks are printed in chunks and merged.
2. **▶ Present**
   Full screen in Chrome: F for full screen, P for presenter view.
3. **PNG**
   `npm run png` renders every page for a quick visual check.

<div class="takeaway">Both buttons sit in the status bar at the bottom of VS Code</div>

---

<!-- _class: lay-lead -->

## Design rules are checked, not memorised

`npm run lint` warns about three or more boxes on a slide, more than 400 visible characters, text under 18 px, and large corner rounding.

---

<!-- _class: lay-points -->

## Five habits that keep slides readable

- One message per slide, stated in the heading
- At most three items side by side
- Group with space and alignment before drawing a box
- Body text at 18 px or larger
- End the slide with a takeaway band

<div class="takeaway">The theme and the lint carry these habits for you</div>

---

<!-- _class: lay-cards2 -->

## Where to go next

- **sample-layouts**
  Every layout class, shown on the same text.
- **sample-parts**
  The parts: callouts, tables, QR columns, source lines.
- **sample-hydrogen**
  A complete twelve-slide research talk in English.
- **README**
  Installation, the key table and troubleshooting.

---

<!-- _class: refs -->

## Credits

- A sample deck shipped with marp-GUI (Apache License 2.0); the text was written for it and cites no studies. All figures were drawn for this deck.
- Theme: `theme/tsutawaru-academic.css`; see `docs/design-rules.md`.
- Typeface: BIZ UDPGothic (SIL Open Font License 1.1), from Google Fonts at render time.
