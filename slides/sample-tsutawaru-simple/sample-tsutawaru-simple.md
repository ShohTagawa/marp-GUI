---
marp: true
theme: tsutawaru-simple
paginate: true
size: 16:9
lang: en
footer: ''
---

<!-- _class: cover-left -->
<!-- _paginate: false -->

<div class="bubble">theme</div>

<div class="pre">Sample deck for tsutawaru-simple</div>

# No header band:<br>a hatched band and white space

<div class="meta">marp-GUI sample deck<br>theme/tsutawaru-simple.css</div>

<!--
Sample deck for marp-GUI. It describes the theme itself; every figure was drawn for this deck.
-->

---

## The header band is gone; a band and the title remain

- No header band is shown, so the body gets more height
- The <span class="hl">left band</span> shows the colour of the section
- The title sits at the top left, <span class="mark">34px in dark grey</span>

### Subheadings use colour and weight only

No vertical rule is drawn. Body text is dark grey rather than black.

<div class="takeaway">Write the slides as for tsutawaru-academic</div>

---

<!-- _class: band-top -->

## The band position is one word in _class

| Word in _class | Band | Suits |
|---|---|---|
| (none) | Thin band on the left | Headings and bullets |
| band-top | Band along the top | Side-by-side comparisons, wide tables |
| band-wide | Wide band on the left, with a label | A figure or an example on its own |

<p class="note">Write band-none for a slide without a band.</p>

<div class="takeaway">This slide is band-top</div>

---

<!-- _class: band-wide -->

## A figure on its own

<svg viewBox="0 0 860 330" width="860" height="330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A Markdown source with one class word, and the slide it produces: the same three items laid out as three cards">
<defs><marker id="simple-en-f4-ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto"><path d="M0 0L10 5L0 10Z" fill="var(--accent, #0076BA)"/></marker></defs>
<text x="0" y="24" font-size="22" font-weight="700" fill="var(--ink, #333333)">Markdown</text>
<rect x="0" y="40" width="380" height="290" rx="3" fill="var(--fill, #F1F1F1)"/>
<text x="20" y="90" font-size="18" fill="var(--ink, #333333)" style="font-family:Menlo,Consolas,monospace;letter-spacing:0">&lt;!-- _class: <tspan font-weight="700" fill="var(--accent-dark, #004D80)" style="font-family:Menlo,Consolas,monospace">lay-cards3</tspan> --&gt;</text>
<text x="20" y="150" font-size="18" fill="var(--ink, #333333)" style="font-family:Menlo,Consolas,monospace;letter-spacing:0">## Three points</text>
<text x="20" y="200" font-size="18" fill="var(--ink, #333333)" style="font-family:Menlo,Consolas,monospace;letter-spacing:0">- **Band**</text>
<text x="20" y="250" font-size="18" fill="var(--ink, #333333)" style="font-family:Menlo,Consolas,monospace;letter-spacing:0">- **Colour**</text>
<text x="20" y="300" font-size="18" fill="var(--ink, #333333)" style="font-family:Menlo,Consolas,monospace;letter-spacing:0">- **Takeaway**</text>
<path d="M398 185H452" fill="none" stroke="var(--accent, #0076BA)" stroke-width="8" marker-end="url(#simple-en-f4-ah)"/>
<text x="480" y="24" font-size="22" font-weight="700" fill="var(--ink, #333333)">Slide</text>
<rect x="480" y="40" width="380" height="214" fill="#ffffff" stroke="var(--ink-weak, #6E6E6E)" stroke-width="2"/>
<rect x="481" y="41" width="12" height="212" fill="var(--band, #0076BA)"/>
<text x="512" y="84" font-size="20" font-weight="700" fill="var(--ink, #333333)">Three points</text>
<rect x="512" y="110" width="100" height="110" rx="3" fill="var(--accent-soft, #E8F2F8)"/>
<rect x="622" y="110" width="100" height="110" rx="3" fill="var(--accent-soft, #E8F2F8)"/>
<rect x="732" y="110" width="100" height="110" rx="3" fill="var(--accent-soft, #E8F2F8)"/>
<text x="562" y="140" font-size="18" font-weight="700" text-anchor="middle" fill="var(--accent-dark, #004D80)" style="letter-spacing:0">Band</text>
<text x="672" y="140" font-size="18" font-weight="700" text-anchor="middle" fill="var(--accent-dark, #004D80)" style="letter-spacing:0">Colour</text>
<text x="782" y="140" font-size="18" font-weight="700" text-anchor="middle" fill="var(--accent-dark, #004D80)" style="letter-spacing:0">Takeaway</text>
<text x="480" y="300" font-size="20" fill="var(--ink, #333333)">One word in _class sets the layout;</text>
<text x="480" y="326" font-size="20" fill="var(--ink, #333333)">the text stays the same.</text>
</svg>

---

<!-- _class: lay-points -->

<style scoped>
section { --font-jp: var(--font-seed); }
</style>

- This slide is set in LINE Seed JP.
- One line in style: switches the whole deck.
- The default typeface is BIZ UDPGothic.

---

<!-- _class: message -->

# Fewer bands<br>*More white space*<br>Fewer colours

---

<!-- _class: divider -->

<div class="chapter-num">SECTION 2</div>

# Changing colour

## Each section can have its own band and divider colour

---

<!-- _class: red lay-cards3 -->

## Colour is one word in _class

- **Band**
  The hatching changes colour.
- **Subheadings and emphasis**
  They take a calmer shade of the same hue.
- **Dividers**
  The ground of the divider changes colour.

<div class="takeaway">This slide is red lay-cards3</div>

---

<!-- _class: divider yellow -->

<div class="chapter-num">SECTION 3</div>

# Layouts with colour

## On a yellow ground, the text turns dark grey

---

<!-- _class: green lay-flow -->

## Start a new deck in three steps

1. **Name the theme**
   Write tsutawaru-simple in the front matter.
2. **Write the text**
   Headings and bullets in plain Markdown.
3. **Check the PNGs**
   Render with npm run png and look at each slide.

<div class="takeaway fill">A filled takeaway: write takeaway fill</div>

---

<!-- _class: garnet lay-fig-right -->

## Seven colour words are available

<svg viewBox="0 0 470 420" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The band colour of each colour word: blue (default), red, yellow (also orange), green, gray, teal (also sky) and garnet">
<rect x="0" y="4" width="96" height="40" fill="#0076BA"/>
<rect x="0" y="64" width="96" height="40" fill="#EE220C"/>
<rect x="0" y="124" width="96" height="40" fill="#E0A100"/>
<rect x="0" y="184" width="96" height="40" fill="#187E18"/>
<rect x="0" y="244" width="96" height="40" fill="#4D4D4D"/>
<rect x="0" y="304" width="96" height="40" fill="#017B76"/>
<rect x="0" y="364" width="96" height="40" fill="#A6192E"/>
<text x="120" y="32" font-size="22" font-weight="700" fill="var(--ink, #333333)">blue <tspan font-weight="400" fill="var(--ink-weak, #6E6E6E)">(default)</tspan></text>
<text x="120" y="92" font-size="22" font-weight="700" fill="var(--ink, #333333)">red</text>
<text x="120" y="152" font-size="22" font-weight="700" fill="var(--ink, #333333)">yellow <tspan font-weight="400" fill="var(--ink-weak, #6E6E6E)">(also: orange)</tspan></text>
<text x="120" y="212" font-size="22" font-weight="700" fill="var(--ink, #333333)">green</text>
<text x="120" y="272" font-size="22" font-weight="700" fill="var(--ink, #333333)">gray</text>
<text x="120" y="332" font-size="22" font-weight="700" fill="var(--ink, #333333)">teal <tspan font-weight="400" fill="var(--ink-weak, #6E6E6E)">(also: sky)</tspan></text>
<text x="120" y="392" font-size="22" font-weight="700" fill="var(--ink, #333333)">garnet</text>
</svg>

- blue is the default
- orange and sky are other names for yellow and teal
- For diverse colour vision, switch the theme to tsutawaru-simple-cud

<div class="takeaway">This slide is garnet lay-fig-right</div>

---

<!-- _class: refs -->

## References and credits

- The parent theme, tsutawaru-academic, follows: Takahashi Y, Katayama N. Tsutawaru dezain no kihon [The basics of design that communicates]. Expanded and revised 3rd ed. Gijutsu-Hyōron-sha; 2021. ISBN 978-4-297-11985-0 [in Japanese].
- Typefaces: BIZ UDPGothic (default) and LINE Seed JP (optional), both under the SIL Open Font License 1.1. They are loaded from Google Fonts when the slides are rendered; no font file is bundled.
- This theme: theme/tsutawaru-simple.css (Apache-2.0), a header-less variant of tsutawaru-academic.
