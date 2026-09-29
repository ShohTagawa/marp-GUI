---
marp: true
theme: tsutawaru-academic
paginate: true
size: 16:9
lang: ja
header: '<div class="hdr-left">配置クラスの見本</div><img class="hdr-logo" src="../assets/logo-placeholder.png" alt="ロゴ">'
footer: ''
style: |
  :root {
    /* ── ヘッダー幅の調整つまみ（値は既定。数字を変えると効く） ── */
    --hdr-left-w: fit-content;  /* 左の題字帯の幅。固定したいときは例: 26% */
    --hdr-left-max: 38%;        /* 題字帯の上限幅（超えたら…で省略） */
    --pt-center: 43%;           /* 中央page-title帯の中心位置（50%=画面中央） */
    --pt-width: 35%;    /* page-title帯の幅。固定したいときは例: 26% */
    --pt-max: 38%;              /* page-title帯の上限幅 */
    --measure: 42em;            /* 行長。16:9で右が余るので28em→42emに伸ばす */
  }
---

<!-- _class: cover-hero -->

<div class="title-hero">
<div class="title-small">tsutawaru-academic</div>
<div class="title-big long">配置クラスの見本</div>
<div class="title-sub">同じ原稿を、_class の1語で並べ替えます</div>
</div>

<div class="title-foot">
<div class="title-photo"><img src="../assets/profile-placeholder.png" alt="写真"></div>
<div class="title-meta">
<div class="title-name">氏名</div>
<div class="title-affil">所属</div>
</div>
</div>

---

<div class="page-title">3項目／標準</div>

## 配置クラスは、3つの場面で役に立ちます

- **原稿を書くとき**
  箇条書きのまま書き進められます。
- **並べ方を選ぶとき**
  _class の1語を替えるだけで済みます。
- **仕上がりを確かめるとき**
  はみ出す案には印が付きます。

<div class="takeaway">配置クラスなしでは、見出し＋説明の箇条書きです</div>

---

<!-- _class: lay-boxed -->

<div class="page-title">3項目／lay-boxed</div>

## 配置クラスは、3つの場面で役に立ちます

- **原稿を書くとき**
  箇条書きのまま書き進められます。
- **並べ方を選ぶとき**
  _class の1語を替えるだけで済みます。
- **仕上がりを確かめるとき**
  はみ出す案には印が付きます。

<div class="takeaway">目標・ねらいの1枚に使います</div>

---

<!-- _class: lay-cards3 -->

<div class="page-title">3項目／lay-cards3</div>

## 配置クラスは、3つの場面で役に立ちます

- **原稿を書くとき**
  箇条書きのまま書き進められます。
- **並べ方を選ぶとき**
  _class の1語を替えるだけで済みます。
- **仕上がりを確かめるとき**
  はみ出す案には印が付きます。

<div class="takeaway">3つを同じ重さで並べます</div>

---

<!-- _class: lay-keyrow -->

<div class="page-title">3項目／lay-keyrow</div>

## 配置クラスは、3つの場面で役に立ちます

- **原稿を書くとき**
  箇条書きのまま書き進められます。
- **並べ方を選ぶとき**
  _class の1語を替えるだけで済みます。
- **仕上がりを確かめるとき**
  はみ出す案には印が付きます。

<div class="takeaway">囲まずに、上の罫1本で並べます</div>

---

<div class="page-title">4項目／標準</div>

## 配置を選ぶ前に、4つの点を確かめます

- **項目の数**
  横に並べるのは3つまでにします。
- **順序の有無**
  順序があれば、流れか手順にします。
- **図の有無**
  図があれば、文と左右に分けます。
- **文の長さ**
  長い説明は、カードに入れません。

---

<!-- _class: lay-cards2 -->

<div class="page-title">4項目／lay-cards2</div>

## 配置を選ぶ前に、4つの点を確かめます

- **項目の数**
  横に並べるのは3つまでにします。
- **順序の有無**
  順序があれば、流れか手順にします。
- **図の有無**
  図があれば、文と左右に分けます。
- **文の長さ**
  長い説明は、カードに入れません。

<div class="takeaway">4つは 2×2 に分けます</div>

---

<div class="page-title">手順／標準</div>

## 配置案は、3つの手順で選べます

1. **スライドを右クリックします**
   配置案が小さな絵で並びます。
2. **案にマウスを乗せます**
   その場で大きく確かめられます。
3. **クリックして決めます**
   原稿の _class だけが変わります。

<div class="takeaway">番号つきの箇条書きが標準です</div>

---

<!-- _class: lay-flow -->

<div class="page-title">手順／lay-flow</div>

## 配置案は、3つの手順で選べます

1. **スライドを右クリックします**
   配置案が小さな絵で並びます。
2. **案にマウスを乗せます**
   その場で大きく確かめられます。
3. **クリックして決めます**
   原稿の _class だけが変わります。

<div class="takeaway">左から右へ、一方向に流します</div>

---

<!-- _class: lay-steps -->

<div class="page-title">手順／lay-steps</div>

## 配置案は、3つの手順で選べます

1. **スライドを右クリックします**
   配置案が小さな絵で並びます。
2. **案にマウスを乗せます**
   その場で大きく確かめられます。
3. **クリックして決めます**
   原稿の _class だけが変わります。

<div class="takeaway">上から下へ、番号で順序を示します</div>

---

<div class="page-title">図つき／標準</div>

## 原稿はそのままで、並べ方だけが変わります

![w:760 原稿と配置クラスからスライドができる図](./src/fig11-markdown-class-slide.png)

- 原稿は素の Markdown で書きます
- 配置クラスは _class に1語だけ足します
- 図と文の位置はテーマが決めます

---

<!-- _class: lay-fig-right -->

<div class="page-title">図つき／lay-fig-right</div>

## 原稿はそのままで、並べ方だけが変わります

![w:760 原稿と配置クラスからスライドができる図](./src/fig11-markdown-class-slide.png)

- 原稿は素の Markdown で書きます
- 配置クラスは _class に1語だけ足します
- 図と文の位置はテーマが決めます

<div class="takeaway">文を左、図を右に置きます</div>

---

<!-- _class: lay-fig-left -->

<div class="page-title">図つき／lay-fig-left</div>

## 原稿はそのままで、並べ方だけが変わります

![w:760 原稿と配置クラスからスライドができる図](./src/fig11-markdown-class-slide.png)

- 原稿は素の Markdown で書きます
- 配置クラスは _class に1語だけ足します
- 図と文の位置はテーマが決めます

<div class="takeaway">図を左、文を右に置きます</div>

---

<!-- _class: lay-fig-top -->

<div class="page-title">図つき／lay-fig-top</div>

## 原稿はそのままで、並べ方だけが変わります

![w:760 原稿と配置クラスからスライドができる図](./src/fig11-markdown-class-slide.png)

- 原稿は素の Markdown で書きます
- 配置クラスは _class に1語だけ足します
- 図と文の位置はテーマが決めます

<div class="takeaway">図を上に大きく置きます</div>

---

<!-- _class: lay-fig-right -->

<div class="page-title">svg／lay-fig-right</div>

## 見出しと要点の帯は、どの配置でも動きません

<svg viewBox="0 0 520 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="見出しと本文と要点の位置"><rect x="2" y="2" width="516" height="296" fill="#fff" stroke="var(--rule, #D6D6D6)" stroke-width="2"/><rect x="2" y="2" width="516" height="34" fill="var(--accent, #A6192E)"/><rect x="40" y="62" width="300" height="22" fill="var(--ink, #262626)"/><rect x="40" y="110" width="200" height="100" fill="var(--fill, #F1F1F1)"/><rect x="262" y="110" width="216" height="100" fill="var(--fill, #F1F1F1)"/><rect x="40" y="238" width="438" height="36" fill="var(--accent-soft, #F6E9EC)"/><text x="140" y="168" font-size="22" text-anchor="middle" fill="var(--ink, #262626)">文</text><text x="370" y="168" font-size="22" text-anchor="middle" fill="var(--ink, #262626)">図</text><text x="259" y="263" font-size="20" text-anchor="middle" fill="var(--accent-dark, #7D1322)">要点の帯は動きません</text></svg>

- 見出しはヘッダーのすぐ下に置きます
- 本文だけが配置クラスで並び替わります

<div class="takeaway">インライン svg も図として扱います</div>

---

<!-- _class: lay-fig-left -->

<div class="page-title">svg／lay-fig-left</div>

## 見出しと要点の帯は、どの配置でも動きません

<svg viewBox="0 0 520 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="見出しと本文と要点の位置"><rect x="2" y="2" width="516" height="296" fill="#fff" stroke="var(--rule, #D6D6D6)" stroke-width="2"/><rect x="2" y="2" width="516" height="34" fill="var(--accent, #A6192E)"/><rect x="40" y="62" width="300" height="22" fill="var(--ink, #262626)"/><rect x="40" y="110" width="200" height="100" fill="var(--fill, #F1F1F1)"/><rect x="262" y="110" width="216" height="100" fill="var(--fill, #F1F1F1)"/><rect x="40" y="238" width="438" height="36" fill="var(--accent-soft, #F6E9EC)"/><text x="140" y="168" font-size="22" text-anchor="middle" fill="var(--ink, #262626)">文</text><text x="370" y="168" font-size="22" text-anchor="middle" fill="var(--ink, #262626)">図</text><text x="259" y="263" font-size="20" text-anchor="middle" fill="var(--accent-dark, #7D1322)">要点の帯は動きません</text></svg>

- 見出しはヘッダーのすぐ下に置きます
- 本文だけが配置クラスで並び替わります

---

<!-- _class: lay-lead -->

<div class="page-title">1文／lay-lead</div>

## この見本で伝えたいこと

原稿を書き換えずに、並べ方だけを試せます。

---

<!-- _class: lay-points -->

<div class="page-title">要点だけ／lay-points</div>

## この見本で伝えたいこと

- 原稿は素の Markdown で書きます
- 配置は _class の1語で決めます
- 横に並べるのは **3つまで** にします
- 図があれば文と左右に分けます
- はみ出す案には印が付きます

<div class="takeaway">1行1要点・5行まで。文字をとても少なくした1枚です</div>

---

<!-- _class: lay-points -->

<div class="page-title">要点だけ／見出しなし</div>

- 原稿は素の Markdown で書きます
- 配置は _class の1語で決めます
- 横に並べるのは **3つまで** にします
- 図があれば文と左右に分けます
- はみ出す案には印が付きます

---

<!-- _class: lay-fig-only -->

<div class="page-title">図だけ／lay-fig-only</div>

![原稿と配置クラスからスライドができる図](./src/fig11-markdown-class-slide.png)

<div class="takeaway">図だけを大きく見せて、要点の帯で締めます</div>
