---
marp: true
theme: tsutawaru-simple-cud
paginate: true
size: 16:9
lang: ja
footer: ''
---

<!-- _class: cover-left -->
<!-- _paginate: false -->

<div class="bubble">theme</div>

<div class="pre">tsutawaru-simple-cud の見本</div>

# 色覚の多様性に<br>配慮した配色

<div class="meta">marp-GUI の見本デック<br>theme/tsutawaru-simple-cud.css</div>

<!--
marp-GUI の見本デック。テーマそのものを説明する。色の比較の図は、このデックのために計算して描いた。
-->

---

## tsutawaru-simple の配色だけを替えました

- **帯の色**
  推奨配色セットのアクセントカラーをそのまま使います。
- **文字に使う色**
  同じ色を暗くして、白地とのコントラスト比を 4.5 以上にしました。
- **色以外の手がかり**
  強調は太字でも、区切りは題の文字でも伝えます。

<div class="takeaway">帯・余白・配置クラスは tsutawaru-simple と同じです</div>

---

<!-- _class: band-top -->

## 帯の色を、3つの見え方で並べました

<svg viewBox="0 0 1120 356" width="1120" height="356" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="帯の色を、一般色覚・P型・D型の見え方で並べた図。下線は、いちばん近い2色">
<text x="150" y="22" font-size="22" font-weight="700" fill="var(--ink, #333333)">tsutawaru-simple</text>
<text x="660" y="22" font-size="22" font-weight="700" fill="var(--ink, #333333)">tsutawaru-simple-cud</text>
<text x="0" y="74" font-size="22" font-weight="700" fill="var(--ink, #333333)">一般色覚</text>
<rect x="150" y="40" width="60" height="50" fill="#0076BA"/>
<rect x="216" y="40" width="60" height="50" fill="#EE220C"/>
<rect x="282" y="40" width="60" height="50" fill="#E0A100"/>
<rect x="348" y="40" width="60" height="50" fill="#187E18"/>
<rect x="414" y="40" width="60" height="50" fill="#4D4D4D"/>
<rect x="480" y="40" width="60" height="50" fill="#017B76"/>
<rect x="546" y="40" width="60" height="50" fill="#A6192E"/>
<rect x="216" y="94" width="60" height="4" fill="var(--ink, #333333)"/>
<rect x="546" y="94" width="60" height="4" fill="var(--ink, #333333)"/>
<text x="150" y="122" font-size="18" fill="var(--ink-weak, #6E6E6E)">いちばん近い2色の差 18.9（red と garnet）</text>
<rect x="660" y="40" width="60" height="50" fill="#005AFF"/>
<rect x="726" y="40" width="60" height="50" fill="#FF4B00"/>
<rect x="792" y="40" width="60" height="50" fill="#F6AA00"/>
<rect x="858" y="40" width="60" height="50" fill="#03AF7A"/>
<rect x="924" y="40" width="60" height="50" fill="#4DC4FF"/>
<rect x="990" y="40" width="60" height="50" fill="#4D4D4D"/>
<rect x="726" y="94" width="60" height="4" fill="var(--ink, #333333)"/>
<rect x="792" y="94" width="60" height="4" fill="var(--ink, #333333)"/>
<text x="660" y="122" font-size="18" fill="var(--ink-weak, #6E6E6E)">いちばん近い2色の差 29.4（red と orange）</text>
<text x="0" y="182" font-size="22" font-weight="700" fill="var(--ink, #333333)">P型</text>
<rect x="150" y="148" width="60" height="50" fill="#5579BD"/>
<rect x="216" y="148" width="60" height="50" fill="#6B5E00"/>
<rect x="282" y="148" width="60" height="50" fill="#BAA300"/>
<rect x="348" y="148" width="60" height="50" fill="#817100"/>
<rect x="414" y="148" width="60" height="50" fill="#4D4D4D"/>
<rect x="480" y="148" width="60" height="50" fill="#737476"/>
<rect x="546" y="148" width="60" height="50" fill="#47422E"/>
<rect x="216" y="202" width="60" height="4" fill="var(--ink, #333333)"/>
<rect x="348" y="202" width="60" height="4" fill="var(--ink, #333333)"/>
<text x="150" y="230" font-size="18" fill="var(--ink-weak, #6E6E6E)">いちばん近い2色の差 7.7（red と green）</text>
<rect x="660" y="148" width="60" height="50" fill="#0076FF"/>
<rect x="726" y="148" width="60" height="50" fill="#837200"/>
<rect x="792" y="148" width="60" height="50" fill="#C6AE00"/>
<rect x="858" y="148" width="60" height="50" fill="#ACA177"/>
<rect x="924" y="148" width="60" height="50" fill="#A7C2FF"/>
<rect x="990" y="148" width="60" height="50" fill="#4D4D4D"/>
<rect x="792" y="202" width="60" height="4" fill="var(--ink, #333333)"/>
<rect x="858" y="202" width="60" height="4" fill="var(--ink, #333333)"/>
<text x="660" y="230" font-size="18" fill="var(--ink-weak, #6E6E6E)">いちばん近い2色の差 16.2（orange と green）</text>
<text x="0" y="290" font-size="22" font-weight="700" fill="var(--ink, #333333)">D型</text>
<rect x="150" y="256" width="60" height="50" fill="#3B6AB9"/>
<rect x="216" y="256" width="60" height="50" fill="#9B8900"/>
<rect x="282" y="256" width="60" height="50" fill="#C8B313"/>
<rect x="348" y="256" width="60" height="50" fill="#766A24"/>
<rect x="414" y="256" width="60" height="50" fill="#4D4D4D"/>
<rect x="480" y="256" width="60" height="50" fill="#656977"/>
<rect x="546" y="256" width="60" height="50" fill="#695F29"/>
<rect x="348" y="310" width="60" height="4" fill="var(--ink, #333333)"/>
<rect x="546" y="310" width="60" height="4" fill="var(--ink, #333333)"/>
<text x="150" y="338" font-size="18" fill="var(--ink-weak, #6E6E6E)">いちばん近い2色の差 4.9（green と garnet）</text>
<rect x="660" y="256" width="60" height="50" fill="#0060FC"/>
<rect x="726" y="256" width="60" height="50" fill="#AF9B00"/>
<rect x="792" y="256" width="60" height="50" fill="#D8C013"/>
<rect x="858" y="256" width="60" height="50" fill="#9A947E"/>
<rect x="924" y="256" width="60" height="50" fill="#8FB1FE"/>
<rect x="990" y="256" width="60" height="50" fill="#4D4D4D"/>
<rect x="726" y="310" width="60" height="4" fill="var(--ink, #333333)"/>
<rect x="792" y="310" width="60" height="4" fill="var(--ink, #333333)"/>
<text x="660" y="338" font-size="18" fill="var(--ink-weak, #6E6E6E)">いちばん近い2色の差 10.8（red と orange）</text>
</svg>

<p class="note wide">見え方は Machado ほか（2009）の行列による近似、色の差は CIEDE2000 です。T型では 4.4 から 12.0 になります。</p>

<div class="takeaway">P型・D型でも、どの2色の差も 10 を超えます</div>

---

<!-- _class: band-top -->

## 帯の色は、推奨配色セットの値をそのまま使います

| _class | 配色セットの色名 | 画面用の RGB |
|---|---|---|
| blue（既定） | 青 | 0, 90, 255 |
| red | 赤 | 255, 75, 0 |
| orange | オレンジ | 246, 170, 0 |

<div class="attr">出典：『カラーユニバーサルデザイン推奨配色セット ガイドブック 第2版』（2018）p.2　制作：カラーユニバーサルデザイン推奨配色セット制作委員会</div>

<div class="takeaway">yellow と書いても orange、garnet と書いても red になります</div>

---

<!-- _class: band-top -->

## 灰色だけは、配色セットの外の色です

| _class | 配色セットの色名 | 画面用の RGB |
|---|---|---|
| green | 緑 | 3, 175, 122 |
| sky | 空色 | 77, 196, 255 |
| gray | （配色セットの外） | 77, 77, 77 |

<div class="attr">出典：同 p.2。ガイドブックは配色セットのグレーと青の組み合わせに △ を付けているので（同 p.8）、濃い灰にしました。</div>

<div class="takeaway">teal と書いても sky になります</div>

---

<!-- _class: divider -->

<div class="chapter-num">SECTION 2</div>

# 色の語

## 青と赤の区切りは、白い文字です

---

<!-- _class: red lay-cards3 -->

## 赤は、黄みに寄せた色です

- **帯**
  配色セットの赤です。
- **文字**
  暗くした<span class="hl">赤</span>を使います。
- **区切り**
  暗くした赤の地に、白い文字です。

<div class="takeaway">この1枚は red lay-cards3 です</div>

---

<!-- _class: divider orange -->

<div class="chapter-num">SECTION 3</div>

# 明るい色

## オレンジ・緑・空色の区切りは、濃い灰色の文字です

---

<!-- _class: sky lay-keyrow -->

## 空色は、青より明るい色です

- **帯**
  配色セットの空色です。
- **文字**
  暗くした<span class="hl">空色</span>を使います。
- **区切り**
  空色の地に、濃い灰色の文字です。

<div class="takeaway">この1枚は sky lay-keyrow です</div>

---

<!-- _class: green -->

## 強調は、色と太字の両方で示します

- 大事な語は、<span class="hl">メインの色と太字</span>で示します
- 下線マーカーは、<span class="mark">黄色の塗りと太字</span>です
- 「<span class="ng">不可</span>」は、色と太字に加えて、語そのものを書きます

<div class="takeaway">色が見分けにくくても、太字と語で伝わります</div>

---

<!-- _class: gray -->

## 確かめたことと、確かめていないことがあります

- **確かめたこと**
  色の差とコントラスト比を、4つの見え方で計算しました。
- **確かめていないこと**
  色弱の当事者による確認は、まだしていません。
- **配色セットの版**
  ver.4（2018年）の値です。ver.4.2 の値は確かめていません。

<div class="takeaway">計算は目安です。当事者に見てもらうのが確実です</div>

---

<!-- _class: refs -->

## 参考文献とクレジット

- 色の値：カラーユニバーサルデザイン推奨配色セット ver.4 の画面用 RGB。『カラーユニバーサルデザイン推奨配色セット ガイドブック 第2版』（2018）p.2。制作：カラーユニバーサルデザイン推奨配色セット制作委員会。https://jfly.uni-koeln.de/colorset/
- Machado GM, Oliveira MM, Fernandes LAF. A physiologically-based model for simulation of color vision deficiency. IEEE Trans Vis Comput Graph 2009;15(6):1291–1298.
- このテーマ：theme/tsutawaru-simple-cud.css（Apache-2.0）。tsutawaru-simple の色だけを替えた版です。
