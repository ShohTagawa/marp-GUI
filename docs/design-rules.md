# Design rules

[日本語は下にあります](#デザインのルール)

This page lists the design rules that the lint (`tools/tsutawaru-lint.mjs`, run as `npm run lint`) checks.

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

| # | Rule | Threshold in the lint → level |
|---|---|---|
| 1 | Keep boxes to a minimum. Group by whitespace, alignment and weight first. If a box is needed, step down from a filled box, to a thin rule, to no box. | 3 or more boxed elements on a slide → `warn`. Counted: elements whose class contains `box-accent`, `box-info`, `box-warn`, `why-callout`, `callout-`, `stepbox`, `pcard`, `goal-box`, `exrow`, `sec-box`, `fill` or `rule-box` |
| 2 | An evenly aligned grid of cards reads as one group. | each `.grid2` counts as one box, and the `.fill` cards inside it are not counted |
| 3 | A slide that does not fit usually carries too much information: cut text, cut figures, or split the slide. | more than 400 visible characters → `warn` (not counted: whitespace, Markdown marks, HTML tags, comments, code blocks, SVG, CSS) |
| 4 | Use at most three font sizes on a slide, and separate levels by weight rather than by size. | 4 or more different font sizes written in the slide (`style="…"` and `<style>` blocks; theme sizes are not counted) → `warn` |
| 5 | No text below 18 px (for legibility when projected in a lecture hall). | below 18 px in an inline `style="…"` (also in `header`/`footer` HTML in the front matter) → `error`; in the front-matter `style:` CSS or a `<style>` block → `warn`; SVG text below 18 px as drawn → `warn` (scaled when the `<svg>` has a `viewBox` and a width or height in px, otherwise compared in SVG units). Reads `font-size` and the `font` shorthand, in px and pt (1 pt = 4/3 px) |
| 6 | Keep corner rounding small and the same throughout. | `border-radius` above 8 px → `warn` (the theme uses 3 px) |
| 7 | Align text left or justified, and avoid centring. | `text-align:center` → `info`, once per slide |
| 8 | At most one centred heading per slide. | part of the message of rule 7 |
| 9 | End headings, bullets and takeaways with a predicate, not with a bare noun phrase (in Japanese, *taigen-dome*). | a heading, bullet or takeaway line of 6 or more characters that ends in one of 39 listed suffixes → `style` (Japanese text only) |
| 10 | No hype words and no stock phrases typical of machine-drafted text. | 26 hype words and 10 stock phrases; the first hit of each list per line → `style` (Japanese text only) |

**Where the values 3 and 400 come from.** The lint source records a count over the author's own 253 slides in four decks that had been revised many times: 84 % of the slides had no box and 5.5 % had three or more; the median length was 218 characters and the 75th percentile 330. These figures were not re-measured for this page. Both values were set on Japanese slides; 400 characters of English text hold fewer words.

**Why CSS and SVG sizes are warnings.** An inline style belongs to one element on the slide, so the lint knows that the text there is affected. For a style sheet, the lint does not work out which elements a selector matches (it may style a caption, or nothing), and the drawn size of SVG text depends on how far the SVG is scaled. These findings are reported but do not fail the run. The sample deck `slides/sample-lecture` keeps one such rule in its front matter (16 px) and one SVG group with `font-size="16"`, so the warnings can be seen.

**Units.** A 16:9 PowerPoint slide is 960 pt wide and a Marp slide is 1280 px wide, so 18 pt on a PowerPoint slide takes the same share of the width as 24 px here. The theme sets body text at 23 px.

---

# デザインのルール

[English above](#design-rules)

このページは、lint（`tools/tsutawaru-lint.mjs`。`npm run lint` で動く）が点検するルールをまとめたものです。

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

| # | ルール | lint のしきい値 → 水準 |
|---|---|---|
| 1 | 囲みは必要な所だけにする。まず余白・揃え・太さでまとめ、それでも囲むなら、塗りだけ → 細い罫だけ → 囲まない、の順に軽くする。 | 1 枚に囲みが 3 個以上 → `warn`。数えるのは class に `box-accent`・`box-info`・`box-warn`・`why-callout`・`callout-`・`stepbox`・`pcard`・`goal-box`・`exrow`・`sec-box`・`fill`・`rule-box` を含む要素 |
| 2 | 等間隔に整列したカードの並びは、ひとつのまとまりとして読める。 | `.grid2` は 1 つで囲み 1 個と数え、その中の `.fill` は数えない |
| 3 | 収まらない 1 枚は、たいてい情報が多すぎる。文字を減らす・図を減らす・分割する。 | 見える文字が 400 字を超える → `warn`（空白・Markdown の記号・HTML のタグ・コメント・コードブロック・SVG・CSS は数えない） |
| 4 | 1 枚の文字サイズは 3 種類までにし、階層はサイズでなく太さで分ける。 | スライドに書いた文字サイズ（`style="…"` と `<style>`。テーマのサイズは数えない）が 4 種類以上 → `warn` |
| 5 | 18 px より小さい文字を使わない（講堂で投影して読める大きさ）。 | インラインの `style="…"`（フロントマターの `header`・`footer` の HTML を含む）で 18 px 未満 → `error`。フロントマターの `style:` の CSS と `<style>` で 18 px 未満 → `warn`。SVG の文字が描画で 18 px 未満 → `warn`（`<svg>` に `viewBox` と px の幅か高さがあれば拡大率を掛けて比べ、無ければ SVG の単位のまま比べる）。`font-size` と `font` の一括指定を読み、単位は px と pt（1 pt = 4/3 px） |
| 6 | 角の丸みは小さく、資料の中で同じにする。 | `border-radius` が 8 px を超える → `warn`（テーマは 3 px） |
| 7 | 文は左揃え（または両端揃え）にし、中央揃えを避ける。 | `text-align:center` → `info`（1 枚につき 1 件） |
| 8 | 中央揃えの見出しは 1 枚に 1 つまで。 | ルール 7 の文言の一部 |
| 9 | 見出し・箇条書き・要点の帯は、名詞で止めず述語で言い切る（体言止めを避ける）。 | 見出し・箇条書き・要点の 1 行が 6 字以上で、39 個の語尾のどれかで終わる → `style`（日本語の文だけ） |
| 10 | 煽り語と、機械が下書きした文に多い常套句を使わない。 | 煽り語 26 個・常套句 10 個。1 行につきそれぞれ最初の 1 つ → `style`（日本語の文だけ） |

**3 と 400 の根拠.** lint のソースに、著者が何度も推敲した 4 デック・253 枚の集計が書いてあります。囲みが 0 個の枚は 84 %、3 個以上は 5.5 %。文字数の中央値は 218 字、75 パーセンタイルは 330 字でした。この数値はこのページのために測り直してはいません。どちらの値も日本語のスライドで決めたもので、英語の 400 字は語数にするとずっと少なくなります。

**CSS と SVG の文字サイズを warn にした理由.** インラインの style は 1 つの要素に付くので、その文字が小さくなることが lint に分かります。スタイルシートの場合、セレクタがどの要素に効くか（キャプションか、どこにも効かないか）を lint は解きません。SVG の文字の大きさは、SVG をどれだけ拡大縮小して描くかで変わります。そのため指摘はしますが、終了コードには響きません。見本デック `slides/sample-lecture` は、フロントマターに 16 px のルールを 1 つ、SVG に `font-size="16"` のまとまりを 1 つ残してあり、この warn が出る様子を確かめられます。

**単位.** 16:9 の PowerPoint のスライドは幅 960 pt、Marp のスライドは幅 1280 px です。PowerPoint で 18 pt の文字は、幅に対する割合でいえばここでの 24 px にあたります。テーマの本文は 23 px です。
