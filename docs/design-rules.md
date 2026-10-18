# Design rules

[日本語は下にあります](#デザインのルール)

This page lists every rule that the lint (`tools/tsutawaru-lint.mjs`, run as `npm run lint`) checks, and every page of the design handbook that is cited in the shipped code (`tools/` and `theme/`): the theme `theme/tsutawaru-academic.css`, the layout suggestions in `tools/marp-scroll-sync/lib/layout-variants.cjs`, and the lint.

**Handbook.** Takahashi Y, Katayama N. Tsutawaru dezain no kihon: yoi shiryō o tsukuru tame no reiauto no rūru [The basics of design that communicates: layout rules for good documents]. Expanded and revised 3rd ed. Tokyo: Gijutsu-Hyōron-sha; 2021. ISBN 978-4-297-11985-0 (in Japanese).

- `p.NNN` is a printed page number of that edition.
- Every summary on this page is a paraphrase in our own words. Nothing is quoted from the book, and no figure is reproduced. For the authors' wording and examples, read the page itself.
- The handbook pages in section 2 were re-read in the book on 18 October 2026 and say what the row says. The summaries in section 3 follow the author's chapter-by-chapter reading notes and the comments in the theme.
- **Project rule** means a rule of this repository. It is not in the handbook.

## 1. Running the lint

```bash
npm run lint -- slides                                        # every deck under slides/
node tools/tsutawaru-lint.mjs <file.md|dir>... [--summary] [--lang ja|en]
```

- `--lang`: output language. Without it, the first of `LC_ALL`, `LC_MESSAGES` and `LANG` that is set decides: `ja` when it starts with "ja", otherwise `en`. When none is set (as on Windows), the operating system's locale decides.
- Colour codes are written only to a terminal. `NO_COLOR` (any non-empty value) turns them off, and `FORCE_COLOR` turns them on.
- Levels: `error`, `warn`, `style`, `info`. The exit status is 1 when there is at least one `error`, 2 for a usage error (unknown option, missing path), and 0 otherwise. The CI workflow runs `npm run lint -- slides`, so only errors fail it.
- The lint reads the Markdown and does not render it. Use it before looking at the rendered PNGs, not instead of looking.

## 2. Rules the lint checks

| # | Rule (our wording) | Threshold in the lint → level | Handbook page(s) | Source |
|---|---|---|---|---|
| 1 | Keep boxes to a minimum. Group by whitespace, alignment and weight first. If a box is needed, step down from a filled box, to a thin rule, to no box. | 3 or more boxed elements on a slide → `warn`. Counted: elements whose class contains `box-accent`, `box-info`, `box-warn`, `why-callout`, `callout-`, `stepbox`, `pcard`, `goal-box`, `exrow`, `sec-box`, `fill` or `rule-box` | p.174, p.212 | handbook |
| 2 | An evenly aligned grid of cards reads as one group. | each `.grid2` counts as one box, and the `.fill` cards inside it are not counted | p.175, p.205 | handbook (the pattern); the counting is a project rule |
| 3 | A slide that cannot keep the rules usually carries too much: cut text, cut figures, or split the slide. | more than 400 visible characters → `warn` (not counted: whitespace, Markdown marks, HTML tags, comments, code blocks, SVG, CSS) | p.202 | handbook; the value 400 is a project rule |
| 4 | Use at most three font sizes on a slide, and separate levels by weight rather than by size. | 4 or more different font sizes written in the slide (`style="…"` and `<style>` blocks; theme sizes are not counted) → `warn` | p.77 | handbook |
| 5 | No text below 18 px. | below 18 px in an inline `style="…"` (also in `header`/`footer` HTML in the front matter) → `error`; in the front-matter `style:` CSS or a `<style>` block → `warn`; SVG text below 18 px as drawn → `warn` (scaled when the `<svg>` has a `viewBox` and a width or height in px, otherwise compared in SVG units). Reads `font-size` and the `font` shorthand, in px and pt (1 pt = 4/3 px) | none: p.61 gives only a rough range for slide body text and lets low-priority text be smaller | project rule (legibility when projected in a lecture hall) |
| 6 | Keep corner rounding small and the same throughout. | `border-radius` above 8 px → `warn` (the theme uses 3 px) | p.98 | handbook; the value 8 px is a project rule |
| 7 | Align text left or justified, and avoid centring. | `text-align:center` → `info`, once per slide | p.70 | handbook |
| 8 | At most one centred heading per slide. | part of the message of rule 7 | none | project rule |
| 9 | End headings, bullets and takeaways with a predicate, not with a bare noun phrase (in Japanese, *taigen-dome*). | a heading, bullet or takeaway line of 6 or more characters that ends in one of 39 listed suffixes → `style` | none | project rule (Japanese text only) |
| 10 | No hype words and no stock phrases typical of machine-drafted text. | 26 hype words and 10 stock phrases; the first hit of each list per line → `style` | none | project rule (Japanese text only) |

**Where the values 3 and 400 come from.** The lint source records a count over the author's own 253 slides in four decks that had been revised many times: 84 % of the slides had no box and 5.5 % had three or more; the median length was 218 characters and the 75th percentile 330. These figures were not re-measured for this page. Both values were set on Japanese slides; 400 characters of English text hold fewer words.

**Why CSS and SVG sizes are warnings.** An inline style belongs to one element on the slide, so the lint knows that the text there is affected. For a style sheet, the lint does not work out which elements a selector matches (it may style a caption, or nothing), and the drawn size of SVG text depends on how far the SVG is scaled. These findings are reported but do not fail the run. The sample deck `slides/sample-lecture` keeps one such rule in its front matter (16 px) and one SVG group with `font-size="16"`, so the warnings can be seen.

**Units.** A 16:9 PowerPoint slide is 960 pt wide and a Marp slide is 1280 px wide, so 18 pt on a PowerPoint slide takes the same share of the width as 24 px here. The theme sets body text at 23 px.

## 3. Handbook pages cited in the theme and the layout suggestions

"Lint" names the rule in section 2 that uses the page; "—" means the lint does not check it. In "Used in", `lay-*` is a layout suggestion and "standard" is the slide without a layout class.

### Chapter 1: Type and characters

| Rule (our wording) | Lint | Handbook page(s) | Source | Used in |
|---|---|---|---|---|
| Set running text in a slender weight; do not make body text bold. | — | p.18, p.19, p.212 | handbook | theme §2 (body weight 400) |
| Use a plain, legible sans-serif face for slides and headings, and keep the same face inside figures. | — | p.20 | handbook | theme (one face for text and figures) |
| Set numbers large and their units about half as large. | — | p.46 | handbook | theme `.num`, `.unit` |
| Do not stretch type or decorate it with shadows, outlines or 3-D effects; emphasise with weight, size or colour. | — | p.52 | handbook | theme §6 |
| For emphasis that works for every reader, use a calm colour, bold or an underline. | — | p.55 | handbook | theme §6 `.mark` |

### Chapter 2: Text and lists

| Rule (our wording) | Lint | Handbook page(s) | Source | Used in |
|---|---|---|---|---|
| Vary size and weight by importance, relative to the rest of the page. | — | p.60 | handbook | theme; `lay-lead`, `lay-points` |
| For slides the authors give a rough range for body text and allow smaller low-priority text; they set no fixed minimum. | rule 5 (the floor itself is a project rule) | p.61 | handbook | lint (comment) |
| Line spacing of half to one character height; software defaults are too tight. | — | p.62 | handbook | theme (line height 1.7 for lists, 1.9 for long text) |
| Letter spacing of about 5–10 % of the font size. | — | p.67 | handbook | theme (letter spacing 0.05 em) |
| Align text left (or justified), headings included. | rule 7 | p.70 | handbook | theme; lint |
| Hang the second and later lines of a list item by one character. | — | p.74 | handbook | theme (list indent 1 em) |
| Show the heading–body hierarchy by contrast; combine at most two means of emphasis; a mark or underline alone hardly stands out. | — | p.76 | handbook | theme §3 |
| No more than three font sizes on a slide; show nesting by weight or size and keep the left edge straight. | rule 4 | p.77 | handbook | theme; lint |
| Separate items by paragraph spacing, not by blank lines; keep the space inside an item smaller than the space between items; add no space right after a subheading. | — | p.78, p.79 | handbook | theme (spacing tokens) |
| Break lines where the meaning allows; a typical slide line holds about 20 Japanese characters. | — | p.80 | handbook | theme (line-length limit) |

### Chapter 3: Diagrams, graphs and tables

| Rule (our wording) | Lint | Handbook page(s) | Source | Used in |
|---|---|---|---|---|
| Use one box shape throughout a document; avoid ellipses. | — | p.97 | handbook | theme §5 |
| Keep rounding small and identical everywhere, and do not let scaling distort it; square corners avoid the problem. | rule 6 | p.98, p.99 | handbook | theme (radius 3 px); lint |
| Colour a shape with a fill or with an outline, not both. | — | p.100 | handbook | theme (takeaway, tags, quotes) |
| Arrows play a supporting role: keep them plain and small, with one head size and one shaft width; a line with a head, or a triangle, works. | — | p.102, p.103 | handbook | theme §8 (arrows) |
| Remove shadows, gradients, outlines and 3-D effects. | — | p.104 | handbook | theme (cover, boxes, decoration) |
| Leave padding inside a box: about one character, or half a character for a short phrase. | — | p.106, p.107 | handbook | theme `.fill`, `.tight` |
| Simplify a diagram by cutting elements. | — | p.110 | handbook | theme; `lay-fig-only` |
| Give diagram boxes one width and height, independent of their text, and align them. | — | p.111 | handbook | theme §8 `.flow` |
| Tables: three horizontal rules (top, under the header, bottom) and no vertical rules; numbers right-aligned, words left-aligned. | — | p.136 | handbook | theme §7 (tables) |
| Long tables may use light shading on alternate rows instead of rules. | — | p.137 | handbook | theme §7 (tables) |
| Cell padding about the size of the text in the cell. | — | p.139 | handbook | theme §7 (tables) |

### Chapter 4: Layout and colour

| Rule (our wording) | Lint | Handbook page(s) | Source | Used in |
|---|---|---|---|---|
| Align every element; top and left edges always line up. | — | p.148 | handbook | theme |
| A figure without a clear edge can sit on a pale grey background. | — | p.152 | handbook | theme §9 (figure backdrop) |
| Put related items close together so that they read as a group. | — | p.154 | handbook | `lay-fig-top` |
| Leave about one line between a figure and its caption. | — | p.157 | handbook | theme §9 (captions) |
| The jump ratio (heading size over body size) sets the hierarchy; make low-priority text clearly smaller. | — | p.160 | handbook | theme |
| Emphasise fewer places to make the contrast clear; mark a heading with weight and a short rule rather than a frame. | — | p.161 | handbook | theme §3, §6 (headings, bold) |
| Horizontal text is read from top left to bottom right; show order with boxes, arrows or numbers. | — | p.166, p.167 | handbook | `lay-fig-left`, `lay-steps` |
| Keep boxes to a minimum; when boxes are used, align them, space them evenly and keep their corners modest. | rules 1, 2 | p.174, p.175 | handbook | lint; theme §5; `lay-boxed`, `lay-keyrow`, `lay-cards3` |
| Wide slides make lines too long: put a figure beside the text, so that the text takes about one half to two thirds of the width. | — | p.179 | handbook | theme (line length, `.tcols`); `lay-fig-right`, `lay-fig-left` |
| One message per slide. | — | p.181 | handbook | theme `.lead`, `slido` |
| Avoid over-saturated standard colours; reduce the colours with related hues and grey (grey does not count as a colour). | — | p.184, p.185 | handbook | theme §1 (palette) |
| One meaning per colour; at most four colours (background, text, main, accent), or three when main and accent are the same. | — | p.190, p.192 | handbook | theme §1 (palette) |
| Dark grey text reads better than pure black. | — | p.193, p.198 | handbook | theme (text colour) |
| For colour-vision diversity, avoid red against green; orange and blue are safer. | — | p.195 | handbook | theme (fourth colour, caution colour) |
| Use a single accent colour. | — | p.196 | handbook | theme `.hl` |
| Do not rely on colour alone: add weight, an underline or the word itself. | — | p.198 | handbook | theme `.ng` |

### Chapter 5: Applying the rules

| Rule (our wording) | Lint | Handbook page(s) | Source | Used in |
|---|---|---|---|---|
| When a page will not keep the rules, it usually holds too much or unrefined content: change the figures, cut text, split the page, or make low-priority items smaller. | rule 3 | p.202 | handbook | lint; theme (notes, references, §11) |
| Common faults are too little whitespace, poor alignment, poor fonts, tight line spacing and no contrast; line spacing of about 1.5 times the font size. | — | p.203 | handbook | theme §2 |
| Cover: a small lead-in, a large bold title and the details at the bottom, left-aligned; do not mix centred and left-aligned text or break lines at odd places. | — | p.204 | handbook | theme `cover-left` |
| Bullet slides: make subheadings stand out by weight at the body size, group per item, and drop marks from simple lists; four items can become a 2 × 2 grid of filled cards. | rule 2 | p.205 | handbook | lint; theme `.blist`, `.grid2`; `lay-cards2`, standard |
| Flowcharts: little colour in fills and outlines, boxes of one size, arrows that do not dominate. | — | p.206 | handbook | theme §8 `.flow`; `lay-flow` |
| Dense data: rows separated by horizontal rules only, numbers large and right-aligned, units small. | — | p.207 | handbook | theme `.datarow` |
| Charts and figures in two columns, which halves the line length; one highlighted series; an underline marker for emphasis. | — | p.208 | handbook | theme `.tcols`, `.mark` |
| Keep a figure, its caption and its explanation together as one group. | — | p.209 | handbook | theme §9 (figures) |
| Too many boxes is a clear mistake; the alternatives are a fill only, a thin rule only, or a group without any box. | rule 1 | p.212 | handbook | lint; theme §5 |
| Two columns keep lines short on wide pages. | — | p.214 | handbook | theme `.tcols` |
| Group by whitespace instead of frames. | — | p.220 | handbook | theme `.group`, `.keyrow` |
| Avoid photographs or busy backgrounds behind text. | — | p.221 | handbook | theme (cover) |

---

# デザインのルール

[English above](#design-rules)

このページは、lint（`tools/tsutawaru-lint.mjs`。`npm run lint` で動く）が点検するルールのすべてと、配布するコード（`tools/` と `theme/`）が根拠に挙げている本のページのすべてをまとめたものです。コードは、テーマ `theme/tsutawaru-academic.css`、配置案 `tools/marp-scroll-sync/lib/layout-variants.cjs`、lint の 3 つです。

**本.** 高橋佑磨・片山なつ『伝わるデザインの基本 増補改訂3版 よい資料を作るためのレイアウトのルール』技術評論社, 2021. ISBN 978-4-297-11985-0.

- `p.NNN` はこの版に印刷されたページ番号です。
- このページの要約は、すべて私たちの言葉で言い換えたものです。本の文は引用せず、図も載せていません。著者の言い回しと作例は本のそのページで確かめてください。
- 2 章の表に挙げたページは、2026 年 10 月 18 日に本で読み直し、表に書いた内容がそのページに在ることを確かめました。3 章の要約は、著者が章ごとに取った読書メモとテーマのコメントによります。
- **このリポジトリの規則** は、このリポジトリで決めた規則で、本には書かれていません。

## 1. lint の動かし方

```bash
npm run lint -- slides                                        # slides/ の下のデックを全部
node tools/tsutawaru-lint.mjs <file.md|dir>... [--summary] [--lang ja|en]
```

- `--lang`：出力の言語。付けないときは、`LC_ALL`・`LC_MESSAGES`・`LANG` のうち最初に値のあるものが「ja」で始まれば日本語、それ以外は英語です。3 つとも無いとき（Windows など）は OS の言語で決めます。
- 色は端末に出すときだけ付きます。`NO_COLOR`（空でない値）で消え、`FORCE_COLOR` で付きます。
- 水準は `error`・`warn`・`style`・`info` の 4 つです。終了コードは、`error` が 1 件でもあれば 1、使い方の誤り（知らないオプション・無いパス）は 2、それ以外は 0 です。CI は `npm run lint -- slides` を動かすので、落ちるのは `error` があるときだけです。
- lint は Markdown を読むだけで、描画はしません。PNG で目視する前のふるいとして使い、目視の代わりにはしません。

## 2. lint が点検するルール

| # | ルール（私たちの言葉） | lint のしきい値 → 水準 | 本のページ | 出どころ |
|---|---|---|---|---|
| 1 | 囲みは必要な所だけにする。まず余白・揃え・太さでまとめ、それでも囲むなら、塗りだけ → 細い罫だけ → 囲まない、の順に軽くする。 | 1 枚に囲みが 3 個以上 → `warn`。数えるのは class に `box-accent`・`box-info`・`box-warn`・`why-callout`・`callout-`・`stepbox`・`pcard`・`goal-box`・`exrow`・`sec-box`・`fill`・`rule-box` を含む要素 | p.174, p.212 | 本 |
| 2 | 等間隔に整列したカードの並びは、ひとつのまとまりとして読める。 | `.grid2` は 1 つで囲み 1 個と数え、その中の `.fill` は数えない | p.175, p.205 | 本（型）。数え方はこのリポジトリの規則 |
| 3 | ルールどおりに収まらない 1 枚は、たいてい情報が多すぎる。文字を減らす・図を減らす・分割する。 | 見える文字が 400 字を超える → `warn`（空白・Markdown の記号・HTML のタグ・コメント・コードブロック・SVG・CSS は数えない） | p.202 | 本。400 という値はこのリポジトリの規則 |
| 4 | 1 枚の文字サイズは 3 種類までにし、階層はサイズでなく太さで分ける。 | スライドに書いた文字サイズ（`style="…"` と `<style>`。テーマのサイズは数えない）が 4 種類以上 → `warn` | p.77 | 本 |
| 5 | 18 px より小さい文字を使わない。 | インラインの `style="…"`（フロントマターの `header`・`footer` の HTML を含む）で 18 px 未満 → `error`。フロントマターの `style:` の CSS と `<style>` で 18 px 未満 → `warn`。SVG の文字が描画で 18 px 未満 → `warn`（`<svg>` に `viewBox` と px の幅か高さがあれば拡大率を掛けて比べ、無ければ SVG の単位のまま比べる）。`font-size` と `font` の一括指定を読み、単位は px と pt（1 pt = 4/3 px） | 無し。p.61 はスライド本文の大まかな目安を示し、重要度の低い文は小さくてよいとするだけ | このリポジトリの規則（講堂で投影して読める大きさ） |
| 6 | 角の丸みは小さく、資料の中で同じにする。 | `border-radius` が 8 px を超える → `warn`（テーマは 3 px） | p.98 | 本。8 px という値はこのリポジトリの規則 |
| 7 | 文は左揃え（または両端揃え）にし、中央揃えを避ける。 | `text-align:center` → `info`（1 枚につき 1 件） | p.70 | 本 |
| 8 | 中央揃えの見出しは 1 枚に 1 つまで。 | ルール 7 の文言の一部 | 無し | このリポジトリの規則 |
| 9 | 見出し・箇条書き・要点の帯は、名詞で止めず述語で言い切る（体言止めを避ける）。 | 見出し・箇条書き・要点の 1 行が 6 字以上で、39 個の語尾のどれかで終わる → `style` | 無し | このリポジトリの規則（日本語の文だけ） |
| 10 | 煽り語と、機械が下書きした文に多い常套句を使わない。 | 煽り語 26 個・常套句 10 個。1 行につきそれぞれ最初の 1 つ → `style` | 無し | このリポジトリの規則（日本語の文だけ） |

**3 と 400 の根拠.** lint のソースに、著者が何度も推敲した 4 デック・253 枚の集計が書いてあります。囲みが 0 個の枚は 84 %、3 個以上は 5.5 %。文字数の中央値は 218 字、75 パーセンタイルは 330 字でした。この数値はこのページのために測り直してはいません。どちらの値も日本語のスライドで決めたもので、英語の 400 字は語数にするとずっと少なくなります。

**CSS と SVG の文字サイズを warn にした理由.** インラインの style は 1 つの要素に付くので、その文字が小さくなることが lint に分かります。スタイルシートの場合、セレクタがどの要素に効くか（キャプションか、どこにも効かないか）を lint は解きません。SVG の文字の大きさは、SVG をどれだけ拡大縮小して描くかで変わります。そのため指摘はしますが、終了コードには響きません。見本デック `slides/sample-lecture` は、フロントマターに 16 px のルールを 1 つ、SVG に `font-size="16"` のまとまりを 1 つ残してあり、この warn が出る様子を確かめられます。

**単位.** 16:9 の PowerPoint のスライドは幅 960 pt、Marp のスライドは幅 1280 px です。PowerPoint で 18 pt の文字は、幅に対する割合でいえばここでの 24 px にあたります。テーマの本文は 23 px です。

## 3. テーマと配置案が根拠に挙げるページ

「lint」の列は、そのページを使う 2 章のルールの番号です。「—」は lint が点検しないことを示します。「使う所」の `lay-*` は配置案、「標準」は配置クラスの無いスライドです。

### 第 1 章 書体と文字

| ルール（私たちの言葉） | lint | 本のページ | 出どころ | 使う所 |
|---|---|---|---|---|
| 読ませる本文は細めの書体で組み、太字にしない。 | — | p.18, p.19, p.212 | 本 | テーマ §2（本文の太さ 400） |
| スライドと見出しは飾りのない読みやすいゴシック体にし、図の中でも同じ書体を使う。 | — | p.20 | 本 | テーマ（文字と図で同じ書体） |
| 数字は大きく、単位はその半分ほどにする。 | — | p.46 | 本 | テーマ `.num`・`.unit` |
| 文字を伸び縮みさせず、影・縁取り・立体の飾りを付けない。強調は太さ・大きさ・色で行う。 | — | p.52 | 本 | テーマ §6 |
| だれにでも伝わる強調には、落ち着いた色・太字・下線を使う。 | — | p.55 | 本 | テーマ `.mark` |

### 第 2 章 文章と箇条書き

| ルール（私たちの言葉） | lint | 本のページ | 出どころ | 使う所 |
|---|---|---|---|---|
| 大きさと太さは、ページの中での重要度に応じて相対的に変える。 | — | p.60 | 本 | テーマ。`lay-lead`・`lay-points` |
| スライド本文の大まかな目安を示し、重要度の低い文は小さくてよいとする。決まった下限は置いていない。 | ルール 5（下限そのものはこのリポジトリの規則） | p.61 | 本 | lint（コメント） |
| 行間は文字の高さの半分から 1 字分。ソフトの初期設定は狭すぎる。 | — | p.62 | 本 | テーマ（行の高さ：箇条書き 1.7・長文 1.9） |
| 字間は文字サイズの 5〜10 % ほど。 | — | p.67 | 本 | テーマ（字間 0.05 em） |
| 文は左揃え（または両端揃え）にする。見出しも同じ。 | ルール 7 | p.70 | 本 | テーマ。lint |
| 箇条書きの 2 行目以降は 1 字分ぶら下げる。 | — | p.74 | 本 | テーマ（箇条書きのインデント 1 em） |
| 見出しと本文の階層は強弱で示す。強調の手段の併用は 2 つまで。記号や下線だけではあまり目立たない。 | — | p.76 | 本 | テーマ §3 |
| 1 枚の文字サイズは 3 種類まで。入れ子は太さや大きさで示し、左端はまっすぐ揃える。 | ルール 4 | p.77 | 本 | テーマ。lint |
| 項目は空白行でなく段落間隔で分ける。項目の中の間隔は項目同士の間隔より狭くし、小見出しの直後は空けない。 | — | p.78, p.79 | 本 | テーマ（間隔の値） |
| 意味の切れ目で改行する。スライドの 1 行は日本語で 20 字前後。 | — | p.80 | 本 | テーマ（行長の上限） |

### 第 3 章 図とグラフ・表

| ルール（私たちの言葉） | lint | 本のページ | 出どころ | 使う所 |
|---|---|---|---|---|
| 囲みの形は 1 つの資料の中で 1 種類にする。楕円は避ける。 | — | p.97 | 本 | テーマ §5 |
| 角の丸みは小さく、どこでも同じにし、拡大縮小で歪ませない。角の尖った四角なら悩まずに済む。 | ルール 6 | p.98, p.99 | 本 | テーマ（半径 3 px）。lint |
| 図形に色を付けるのは、塗りか枠線のどちらか一方だけ。 | — | p.100 | 本 | テーマ（要点の帯・タグ・引用） |
| 矢印は脇役。簡素で小さくし、矢じりの大きさと柄の太さを揃える。線＋矢じりか三角形で足りる。 | — | p.102, p.103 | 本 | テーマ §8（矢印） |
| 影・グラデーション・縁取り・立体の効果を消す。 | — | p.104 | 本 | テーマ（表紙・囲み・装飾） |
| 囲みの内側に余白をとる。目安は 1 字分、短い語句なら半字分。 | — | p.106, p.107 | 本 | テーマ `.fill`・`.tight` |
| 図解は要素を減らして簡素にする。 | — | p.110 | 本 | テーマ。`lay-fig-only` |
| 図解の箱は文字数によらず幅と高さを揃え、整列させる。 | — | p.111 | 本 | テーマ §8 `.flow` |
| 表の罫線は横の 3 本（上端・見出し行の下・下端）だけで、縦罫線は引かない。数値は右揃え、語や文は左揃え。 | — | p.136 | 本 | テーマ §7（表） |
| 行の多い表は、罫線の代わりに 1 行おきに薄い背景を敷いてもよい。 | — | p.137 | 本 | テーマ §7（表） |
| セルの余白は、セルの文字サイズと同じくらい。 | — | p.139 | 本 | テーマ §7（表） |

### 第 4 章 レイアウトと配色

| ルール（私たちの言葉） | lint | 本のページ | 出どころ | 使う所 |
|---|---|---|---|---|
| すべての要素を揃える。上端と左端は必ず揃える。 | — | p.148 | 本 | テーマ |
| 輪郭のはっきりしない図は、薄い灰色の下敷きに載せてよい。 | — | p.152 | 本 | テーマ §9（図の下敷き） |
| 関係の深いものを近づけ、まとまりとして読ませる。 | — | p.154 | 本 | `lay-fig-top` |
| 図とキャプションの間は 1 行分ほど空ける。 | — | p.157 | 本 | テーマ（キャプション） |
| ジャンプ率（本文に対する見出しの大きさ）で階層を作る。重要度の低い文字ははっきり小さくする。 | — | p.160 | 本 | テーマ |
| 強弱をはっきりさせるには、強調する所を減らす。見出しは枠で囲まず、太さと短い罫で示す。 | — | p.161 | 本 | テーマ（見出し・太字） |
| 横書きは左上から右下へ読まれる。順序は囲み・矢印・番号で示す。 | — | p.166, p.167 | 本 | `lay-fig-left`・`lay-steps` |
| 囲みは必要な所だけにする。囲むなら位置を揃え、間隔を均等にし、角を丸めすぎない。 | ルール 1・2 | p.174, p.175 | 本 | lint。テーマ §5。`lay-boxed`・`lay-keyrow`・`lay-cards3` |
| ワイド画面は行が長くなりすぎる。図を文の横に置き、文の幅をスライドの 1/2〜2/3 ほどにする。 | — | p.179 | 本 | テーマ（行長・`.tcols`）。`lay-fig-right`・`lay-fig-left` |
| 1 枚のスライドで伝えることは 1 つ。 | — | p.181 | 本 | テーマ `.lead`・`slido` |
| 彩度の高すぎる標準色を避け、同系色と灰色で色数を減らす（灰色は色数に数えない）。 | — | p.184, p.185 | 本 | テーマ §1（配色） |
| 1 つの色には 1 つの意味。色は 4 色（背景・文字・メイン・強調）まで、メインと強調を同じにすれば 3 色。 | — | p.190, p.192 | 本 | テーマ §1（配色） |
| 文字は真っ黒より、濃い灰色のほうが読みやすい。 | — | p.193, p.198 | 本 | テーマ（文字の色） |
| 色覚の多様性を考え、赤と緑の対比を避けて、オレンジと青を使う。 | — | p.195 | 本 | テーマ（4 色目・注意の色） |
| 強調の色は 1 色にする。 | — | p.196 | 本 | テーマ `.hl` |
| 色だけに頼らず、太さ・下線・語そのものを添える。 | — | p.198 | 本 | テーマ `.ng` |

### 第 5 章 実践

| ルール（私たちの言葉） | lint | 本のページ | 出どころ | 使う所 |
|---|---|---|---|---|
| ルールどおりに収まらないページは、たいてい中身が多すぎるか練れていない。図を変える・文字を減らす・ページを分ける・重要度の低いものを小さくする。 | ルール 3 | p.202 | 本 | lint。テーマ §11（注記・参考文献） |
| よくある失敗は、余白不足・揃っていない・書体がよくない・行間が狭い・強弱がない。行間は文字サイズの 1.5 倍ほど。 | — | p.203 | 本 | テーマ §2 |
| 表紙は、小さな前置き・大きく太い題・下端の情報を左揃えで。中央揃えと左揃えを混ぜず、変な所で改行しない。 | — | p.204 | 本 | テーマ `cover-left` |
| 箇条書きの 1 枚は、小見出しを本文と同じ大きさのまま太さで目立たせ、項目ごとにまとめ、単純な箇条書きには記号を付けない。4 項目なら 2 × 2 の塗りのカードにもできる。 | ルール 2 | p.205 | 本 | lint。テーマ `.blist`・`.grid2`。`lay-cards2`・標準 |
| フローチャートは、塗りと枠線の色を控え、箱の大きさを揃え、矢印を目立たせない。 | — | p.206 | 本 | テーマ §8 `.flow`。`lay-flow` |
| 数値の多い 1 枚は、横罫だけで行を分け、数字を大きく右揃えに、単位を小さくする。 | — | p.207 | 本 | テーマ `.datarow` |
| グラフや図は 2 段に組んで行長を半分にし、強調する系列は 1 つにする。強調に下線のマーカーを使う。 | — | p.208 | 本 | テーマ `.tcols`・`.mark` |
| 図・キャプション・説明文を近づけ、1 つのまとまりにする。 | — | p.209 | 本 | テーマ（図） |
| 囲みが多すぎるのははっきりした誤り。代わりに、塗りだけ・細い罫だけ・囲まずにまとめる、のどれかにする。 | ルール 1 | p.212 | 本 | lint。テーマ §5 |
| 横に広いページでは 2 段にして行を短く保つ。 | — | p.214 | 本 | テーマ `.tcols` |
| 枠で囲む代わりに、余白でまとまりを作る。 | — | p.220 | 本 | テーマ `.group`・`.keyrow` |
| 文字の背景に写真や込み入った模様を敷かない。 | — | p.221 | 本 | テーマ（表紙） |
