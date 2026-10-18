---
marp: true
theme: tsutawaru-simple
paginate: true
size: 16:9
lang: ja
footer: ''
---

<!-- _class: cover-left -->
<!-- _paginate: false -->

<div class="bubble">theme</div>

<div class="pre">tsutawaru-simple の見本</div>

# ヘッダーの代わりに<br>斜線の帯で組むテーマ

<div class="meta">marp-GUI の見本デック<br>theme/tsutawaru-simple.css</div>

<!--
marp-GUI の見本デック。テーマそのものを説明する。図はすべてこのデックのために描いた。
-->

---

## ヘッダーをなくし、題だけを残しました

- ヘッダー帯を出さないので、本文に使える高さが増えます
- <span class="hl">左の帯</span>が、セクションの色を示します
- 題は左上に、<span class="mark">34px の濃い灰色</span>で出ます

### 小見出しは色と太さだけで示します

小見出しの左に縦の罫は付けません。本文の文字は真っ黒ではなく、濃い灰色です。

<div class="takeaway">原稿の書き方は tsutawaru-academic と同じです</div>

---

<!-- _class: band-top -->

## 帯の位置は、_class の1語で選びます

| _class | 帯の位置 | 向いている内容 |
|---|---|---|
| （書かない） | 左の細い帯 | 見出しと箇条書き |
| band-top | 上の帯 | 左右の見比べ、横に広い表 |
| band-wide | 左の広い帯とラベル | 図や作例だけを見せる1枚 |

<p class="note">帯を出さないスライドには band-none と書きます。</p>

<div class="takeaway">この1枚は band-top です</div>

---

<!-- _class: band-wide -->

## 図だけを見せます

<svg viewBox="0 0 860 370" width="860" height="370" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="色の語を1つ書いた原稿と、そこからできるスライド。同じ3項目が3枚のカードに並ぶ">
<defs><marker id="simple-ja-f4-ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto"><path d="M0 0L10 5L0 10Z" fill="var(--accent, #0076BA)"/></marker></defs>
<text x="0" y="24" font-size="22" font-weight="700" fill="var(--ink, #333333)">原稿（Markdown）</text>
<rect x="0" y="40" width="380" height="270" rx="3" fill="var(--fill, #F1F1F1)"/>
<text x="20" y="88" font-size="18" fill="var(--ink, #333333)" style="font-family:Menlo,Consolas,monospace;letter-spacing:0">&lt;!-- _class: <tspan font-weight="700" fill="var(--accent-dark, #004D80)" style="font-family:Menlo,Consolas,monospace">lay-cards3</tspan> --&gt;</text>
<text x="20" y="144" font-size="18" fill="var(--ink, #333333)" style="font-family:Menlo,Consolas,monospace;letter-spacing:0">## 3つの要点</text>
<text x="20" y="192" font-size="18" fill="var(--ink, #333333)" style="font-family:Menlo,Consolas,monospace;letter-spacing:0">- **帯**</text>
<text x="20" y="236" font-size="18" fill="var(--ink, #333333)" style="font-family:Menlo,Consolas,monospace;letter-spacing:0">- **色**</text>
<text x="20" y="280" font-size="18" fill="var(--ink, #333333)" style="font-family:Menlo,Consolas,monospace;letter-spacing:0">- **余白**</text>
<path d="M398 147H452" fill="none" stroke="var(--accent, #0076BA)" stroke-width="8" marker-end="url(#simple-ja-f4-ah)"/>
<text x="480" y="24" font-size="22" font-weight="700" fill="var(--ink, #333333)">スライド</text>
<rect x="480" y="40" width="380" height="214" fill="#ffffff" stroke="var(--ink-weak, #6E6E6E)" stroke-width="2"/>
<rect x="481" y="41" width="12" height="212" fill="var(--band, #0076BA)"/>
<text x="512" y="84" font-size="20" font-weight="700" fill="var(--ink, #333333)">3つの要点</text>
<rect x="512" y="110" width="100" height="110" rx="3" fill="var(--accent-soft, #E8F2F8)"/>
<rect x="622" y="110" width="100" height="110" rx="3" fill="var(--accent-soft, #E8F2F8)"/>
<rect x="732" y="110" width="100" height="110" rx="3" fill="var(--accent-soft, #E8F2F8)"/>
<text x="562" y="140" font-size="18" font-weight="700" text-anchor="middle" fill="var(--accent-dark, #004D80)" style="letter-spacing:0">帯</text>
<text x="672" y="140" font-size="18" font-weight="700" text-anchor="middle" fill="var(--accent-dark, #004D80)" style="letter-spacing:0">色</text>
<text x="782" y="140" font-size="18" font-weight="700" text-anchor="middle" fill="var(--accent-dark, #004D80)" style="letter-spacing:0">余白</text>
<text x="0" y="360" font-size="20" fill="var(--ink, #333333)">_class の1語で配置が変わり、文はそのままです。</text>
</svg>

---

<!-- _class: lay-points -->

<style scoped>
section { --font-jp: var(--font-seed); }
</style>

- この1枚は LINE Seed JP で組んでいます。
- style: に1行書くと、デック全体が替わります。
- 既定の書体は BIZ UDPGothic です。

---

<!-- _class: message -->

# 帯を減らす<br>*余白を増やす*<br>色を絞る

---

<!-- _class: divider -->

<div class="chapter-num">SECTION 2</div>

# 色を変える

## セクションごとに、帯と区切りの色を変えられます

---

<!-- _class: red lay-cards3 -->

## 色は、_class に色の語を足して変えます

- **帯**
  斜線の色が変わります。
- **小見出しと強調**
  落ち着いた同系色になります。
- **区切り**
  地の色が変わります。

<div class="takeaway">この1枚は red lay-cards3 です</div>

---

<!-- _class: divider yellow -->

<div class="chapter-num">SECTION 3</div>

# 配置と色を組み合わせる

## 黄色の地では、文字を濃い灰色にします

---

<!-- _class: green lay-flow -->

## 新しいデックは、3つの手順で始めます

1. **theme を書きます**
   frontmatter に書きます。
2. **原稿を書きます**
   見出しと箇条書きを素の Markdown で書きます。
3. **PNG で確かめます**
   npm run png で描画して目で見ます。

<div class="takeaway fill">塗りの帯にするときは takeaway fill と書きます</div>

---

<!-- _class: garnet lay-fig-right -->

## 色の語は7つあります

<svg viewBox="0 0 470 420" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="色の語ごとの帯の色：blue（既定）、red、yellow（orange も同じ）、green、gray、teal（sky も同じ）、garnet">
<rect x="0" y="4" width="96" height="40" fill="#0076BA"/>
<rect x="0" y="64" width="96" height="40" fill="#EE220C"/>
<rect x="0" y="124" width="96" height="40" fill="#E0A100"/>
<rect x="0" y="184" width="96" height="40" fill="#187E18"/>
<rect x="0" y="244" width="96" height="40" fill="#4D4D4D"/>
<rect x="0" y="304" width="96" height="40" fill="#017B76"/>
<rect x="0" y="364" width="96" height="40" fill="#A6192E"/>
<text x="120" y="32" font-size="22" font-weight="700" fill="var(--ink, #333333)">blue <tspan font-weight="400" fill="var(--ink-weak, #6E6E6E)">（既定）</tspan></text>
<text x="120" y="92" font-size="22" font-weight="700" fill="var(--ink, #333333)">red</text>
<text x="120" y="152" font-size="22" font-weight="700" fill="var(--ink, #333333)">yellow <tspan font-weight="400" fill="var(--ink-weak, #6E6E6E)">（orange も同じ）</tspan></text>
<text x="120" y="212" font-size="22" font-weight="700" fill="var(--ink, #333333)">green</text>
<text x="120" y="272" font-size="22" font-weight="700" fill="var(--ink, #333333)">gray</text>
<text x="120" y="332" font-size="22" font-weight="700" fill="var(--ink, #333333)">teal <tspan font-weight="400" fill="var(--ink-weak, #6E6E6E)">（sky も同じ）</tspan></text>
<text x="120" y="392" font-size="22" font-weight="700" fill="var(--ink, #333333)">garnet</text>
</svg>

- 既定は blue です
- orange と sky は、yellow と teal の別名です
- tsutawaru-simple-cud は、色覚の多様性に配慮した色です

<div class="takeaway">この1枚は garnet lay-fig-right です</div>

---

<!-- _class: refs -->

## 参考文献とクレジット

- 親テーマ tsutawaru-academic の準拠先：高橋佑磨・片山なつ『伝わるデザインの基本 増補改訂3版 よい資料を作るためのレイアウトのルール』技術評論社, 2021（ISBN 978-4-297-11985-0）
- 書体：BIZ UDPGothic と LINE Seed JP（SIL Open Font License 1.1）。描画のときに Google Fonts から読み込みます。
- このテーマ：theme/tsutawaru-simple.css（Apache-2.0）
