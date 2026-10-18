---
marp: true
theme: tsutawaru-academic
paginate: true
size: 16:9
lang: ja
header: '<div class="hdr-left">地球中心核の水素</div><img class="hdr-logo" src="../assets/logo-placeholder.png" alt="ロゴ">'
footer: ''
style: |
  :root {
    --measure: 42em;   /* 行長。16:9で右が余るので28em→42emに伸ばす */
  }
  section { word-break: auto-phrase; }   /* 狭い列で語の途中を折らない（lang: ja が要る） */
---

<!-- _class: cover-hero -->
<!-- _paginate: false -->

<div class="title-hero">
<div class="title-small">見本デック</div>
<div class="title-big">地球中心核の水素</div>
<div class="title-sub">コア形成の超高圧実験から、海の量の起源に迫る</div>
</div>

<div class="title-foot">
<div class="title-photo"><img src="../assets/profile-placeholder.png" alt="写真"></div>
<div class="title-meta">
<div class="title-name">田川 翔</div>
<div class="title-affil">田川翔「地球中心核の水素」Isotope News 2022年4月号 No.780, pp.26–30 より</div>
</div>
</div>

<!--
marp-GUI の見本デック。本文と数値は出典の記事どおり。図はすべてこのデックのために描いた。
-->

---

## 海の量は、なぜ決まったのか

- **海は、地球全体の質量の 0.023％にすぎない**
  わずかな量が、陸と海のある星のテイストを決めた。
- **理論は、海の数十倍〜百倍の水を予想する**
  近年の惑星形成理論は、大量の水がもたらされた可能性を指摘してきた。
- **偶然少なかったのか、調整されたのか**
  海の量を「調整」したメカニズムがあったのか、議論が続いている。

<div class="takeaway">核ができるときの、核と水の化学反応に注目します</div>

---

<!-- _class: lay-fig-left -->

## 地球の深部は、地震と実験で調べます

<svg viewBox="0 0 600 490" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="現在の地球の断面（4分の1）：深さ2,890 kmまでマントル、5,150 kmまで外核、6,370 kmまで内核"><path d="M140 450L520 450A380 380 0 0 0 140 70Z" fill="var(--rule, #D6D6D6)"/><path d="M140 450L347.6 450A207.6 207.6 0 0 0 140 242.4Z" fill="var(--accent, #A6192E)"/><path d="M140 450L212.8 450A72.8 72.8 0 0 0 140 377.2Z" fill="var(--accent-dark, #7D1322)"/><path d="M212.8 450A72.8 72.8 0 0 0 140 377.2" fill="none" stroke="#fff" stroke-width="2"/><path d="M140 70V450M130 70H140M130 242.4H140M130 377.2H140M130 450H140" fill="none" stroke="var(--ink, #262626)" stroke-width="2"/><text x="124" y="40" font-size="20" font-weight="700" text-anchor="end" fill="var(--ink, #262626)">深さ</text><text x="124" y="77" font-size="20" text-anchor="end" fill="var(--ink, #262626)">0 km</text><text x="124" y="249" font-size="20" text-anchor="end" fill="var(--ink, #262626)">2,890 km</text><text x="124" y="384" font-size="20" text-anchor="end" fill="var(--ink, #262626)">5,150 km</text><text x="124" y="457" font-size="20" text-anchor="end" fill="var(--ink, #262626)">6,370 km</text><text x="250" y="176" font-size="22" font-weight="700" text-anchor="middle" fill="var(--ink, #262626)">マントル</text><text x="250" y="204" font-size="20" text-anchor="middle" fill="var(--ink, #262626)">固体岩石</text><path d="M428 158L292 333" fill="none" stroke="var(--ink, #262626)" stroke-width="1.5"/><text x="436" y="150" font-size="22" font-weight="700" fill="var(--ink, #262626)">外核</text><text x="436" y="176" font-size="20" fill="var(--ink, #262626)">液体金属</text><text x="140" y="480" font-size="20" fill="var(--ink, #262626)"><tspan font-weight="700">内核</tspan>　固体金属</text></svg>

- 人類が掘った最大深度は 12 km
- 地震波で密度と層構造が分かる
- 候補の物質をその深さの条件にして、合うかを確かめる

<div class="attr">田川（2022）図1（p.26）をもとに作図</div>

---

<!-- _class: lay-fig-right -->

## 核は、マグマの海から金属が分かれてできました

<svg viewBox="0 0 600 500" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="初期の地球の扇形の断面：上からマグマオーシャン、固化したマントル、分離したコア。金属の滴が核へ沈み、マグマオーシャンの底で平衡に達する"><defs><marker id="hyd-ja-f2-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10Z" fill="var(--ink, #262626)"/></marker></defs><path d="M300 490L29.1 143.3A440 440 0 0 1 570.9 143.3Z" fill="var(--accent, #A6192E)" fill-opacity="0.25"/><path d="M300 490L96.8 230A330 330 0 0 1 503.2 230Z" fill="var(--rule, #D6D6D6)"/><path d="M300 490L195.3 356A170 170 0 0 1 404.7 356Z" fill="var(--accent, #A6192E)"/><path d="M96.8 230A330 330 0 0 1 503.2 230" fill="none" stroke="var(--ink, #262626)" stroke-width="2" stroke-dasharray="8 6"/><circle cx="548" cy="56" r="16" fill="var(--ink-weak, #6E6E6E)"/><path d="M562 46L592 24M556 38L580 16M568 56L596 42" fill="none" stroke="var(--ink-weak, #6E6E6E)" stroke-width="2" stroke-linecap="round"/><text x="526" y="38" font-size="20" text-anchor="end" fill="var(--ink, #262626)">衝突する天体</text><text x="300" y="112" font-size="20" text-anchor="middle" fill="var(--ink, #262626)"><tspan font-weight="700">マグマオーシャン</tspan>（液体）</text><path d="M345 173C349 185 359 193 359 201A14 14 0 0 1 331 201C331 193 341 185 345 173Z" fill="var(--accent-dark, #7D1322)"/><path d="M395 183C399 195 409 203 409 211A14 14 0 0 1 381 211C381 203 391 195 395 183Z" fill="var(--accent-dark, #7D1322)"/><path d="M445 203C449 215 459 223 459 231A14 14 0 0 1 431 231C431 223 441 215 445 203Z" fill="var(--accent-dark, #7D1322)"/><path d="M341 223L333 277" fill="none" stroke="var(--ink, #262626)" stroke-width="3" marker-end="url(#hyd-ja-f2-ah)"/><path d="M386 232L369 284" fill="none" stroke="var(--ink, #262626)" stroke-width="3" marker-end="url(#hyd-ja-f2-ah)"/><path d="M432 250L405 298" fill="none" stroke="var(--ink, #262626)" stroke-width="3" marker-end="url(#hyd-ja-f2-ah)"/><text x="456" y="318" font-size="20" fill="var(--ink, #262626)"><tspan x="456">金属が</tspan><tspan x="456" dy="24">核へ沈む</tspan></text><text x="225" y="284" font-size="20" font-weight="700" text-anchor="middle" fill="var(--ink, #262626)"><tspan x="225">固化した</tspan><tspan x="225" dy="24">マントル</tspan></text><text x="300" y="392" font-size="20" font-weight="700" text-anchor="middle" fill="#fff"><tspan x="300">分離した</tspan><tspan x="300" dy="24">コア</tspan></text><path d="M70 352L116 214" fill="none" stroke="var(--ink, #262626)" stroke-width="1.5"/><text x="6" y="374" font-size="20" fill="var(--ink, #262626)"><tspan x="6" font-weight="700">平衡の条件</tspan><tspan x="6" dy="26">約50万気圧</tspan><tspan x="6" dy="26">約3,500 K</tspan></text></svg>

- 衝突した天体の金属が、マグマオーシャンを通って沈む
- その途中で化学反応が起き、元素が核へ分配される
- 平衡の条件は、約50万気圧・3,500 K

<div class="attr">田川（2022）図2（p.27）をもとに作図</div>

---

<!-- _class: lay-cards3 -->

## 核には、鉄より軽い元素が入っています

- **約8％軽い**
  同じ圧力・温度の純鉄より、核の密度は低い。
- **約70年の未解決問題**
  核の密度欠損問題と呼ばれる。
- **水素だけなら、海の100倍近い水**
  候補は Si・O・C・S・H。今回は水素に着目する。

<div class="takeaway">Fe（金属）＋ H₂O（マグマ）⇄ FeO（マグマ）＋ 2H（金属）</div>

---

<!-- _class: lay-keyrow -->

## 先行研究は、正反対の結果でした

- **核に入りやすい**
  Okuchi (1997)。ただしコア形成より低い圧力。
- **核に入らない**
  Clesi et al. (2018)、Malavergne et al. (2019)。
- **追試が待たれていた**
  コア形成の条件での実験が必要だった。

<div class="takeaway">コア形成の条件で、分配係数を直接決めます</div>

---

<!-- _class: lay-fig-right -->

## ダイヤモンドで、地球の深部をつくります

<svg viewBox="0 0 600 440" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ダイヤモンドアンビルセルの模式図（縮尺は不正確）：向かい合う2つのダイヤモンドが Re 板を挟み、その穴に含水ガラスと Fe 箔が入る。加熱用レーザーと X 線はダイヤモンドを通る"><path d="M200 10V48" fill="none" stroke="var(--ink-weak, #6E6E6E)" stroke-width="8"/><path d="M186 46H214L200 66Z" fill="var(--ink-weak, #6E6E6E)"/><path d="M200 430V384" fill="none" stroke="var(--ink-weak, #6E6E6E)" stroke-width="8"/><path d="M186 386H214L200 366Z" fill="var(--ink-weak, #6E6E6E)"/><text x="184" y="36" font-size="20" text-anchor="end" fill="var(--ink, #262626)">加圧</text><path d="M175 70H425L348 196H252Z" fill="var(--fill-2, #FAFAFA)" stroke="var(--ink-weak, #6E6E6E)" stroke-width="2"/><path d="M252 232H348L425 358H175Z" fill="var(--fill-2, #FAFAFA)" stroke="var(--ink-weak, #6E6E6E)" stroke-width="2"/><path d="M150 196H262V232H150ZM338 196H450V232H338Z" fill="var(--ink-weak, #6E6E6E)"/><rect x="262" y="196" width="76" height="36" fill="var(--accent, #A6192E)" fill-opacity="0.25"/><rect x="276" y="209" width="48" height="10" fill="var(--accent-dark, #7D1322)"/><path d="M300 8V186" fill="none" stroke="var(--accent, #A6192E)" stroke-width="4"/><path d="M290 184H310L300 204Z" fill="var(--accent, #A6192E)"/><path d="M300 432V248" fill="none" stroke="var(--ink, #262626)" stroke-width="4"/><path d="M290 250H310L300 230Z" fill="var(--ink, #262626)"/><text x="312" y="30" font-size="20" font-weight="700" fill="var(--accent-dark, #7D1322)">加熱用レーザー</text><text x="312" y="426" font-size="20" font-weight="700" fill="var(--ink, #262626)">X 線（SPring-8）</text><text x="142" y="221" font-size="20" text-anchor="end" fill="var(--ink, #262626)">Re 板</text><path d="M405 100L462 88M324 212L482 150M332 228L482 290" fill="none" stroke="var(--ink, #262626)" stroke-width="1.5"/><text x="468" y="92" font-size="20" fill="var(--ink, #262626)">ダイヤモンド</text><text x="488" y="156" font-size="20" fill="var(--ink, #262626)">Fe 箔</text><text x="488" y="296" font-size="20" fill="var(--ink, #262626)">含水ガラス</text></svg>

- 鉄箔と、水を含むガラスを挟んで加圧する
- レーザーで約3,100〜4,600 K に加熱し、急冷する
- SPring-8 の X 線で、鉄の体積の膨張から水素量を決める

<div class="attr">田川（2022）図3・図4（p.28）をもとに作図（縮尺は不正確）</div>

<div class="takeaway">直径5 cm の装置で、地球の中心の圧力まで届きます</div>

---

<!-- _class: lay-fig-left -->

## 20 マイクロメートルの試料から、水の量を測ります

<svg viewBox="0 0 600 450" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="3つの段階：約20マイクロメートル角の試料の断面、各画素が検出器として働く結像型 SIMS、断面の水濃度分布が分かる同位体像"><rect x="0" y="0" width="600" height="116" rx="3" fill="var(--fill, #F1F1F1)"/><rect x="22" y="23" width="70" height="70" fill="var(--accent, #A6192E)" fill-opacity="0.25"/><circle cx="57" cy="58" r="15" fill="var(--accent-dark, #7D1322)"/><text x="114" y="50" font-size="22" font-weight="700" fill="var(--ink, #262626)">試料の断面</text><text x="114" y="84" font-size="20" fill="var(--ink, #262626)">約 20 µm 角</text><path d="M276 126H324L300 152Z" fill="var(--accent, #A6192E)"/><rect x="0" y="162" width="600" height="116" rx="3" fill="var(--fill, #F1F1F1)"/><path d="M22 185H92V255H22ZM39.5 185V255M57 185V255M74.5 185V255M22 202.5H92M22 220H92M22 237.5H92" fill="none" stroke="var(--ink, #262626)" stroke-width="2"/><text x="114" y="212" font-size="22" font-weight="700" fill="var(--ink, #262626)">結像型 SIMS</text><text x="114" y="246" font-size="20" fill="var(--ink, #262626)">各画素が検出器として働く</text><path d="M276 288H324L300 314Z" fill="var(--accent, #A6192E)"/><rect x="0" y="324" width="600" height="116" rx="3" fill="var(--fill, #F1F1F1)"/><rect x="22" y="347" width="70" height="70" fill="var(--accent, #A6192E)" fill-opacity="0.25"/><path d="M22 347H92V417H22ZM39.5 347V417M57 347V417M74.5 347V417M22 364.5H92M22 382H92M22 399.5H92" fill="none" stroke="var(--ink, #262626)" stroke-width="2"/><text x="114" y="374" font-size="22" font-weight="700" fill="var(--ink, #262626)">同位体像</text><text x="114" y="408" font-size="20" fill="var(--ink, #262626)">断面の水濃度分布が分かる</text></svg>

- この大きさで水素を定量した報告は、ほぼ無かった
- 北海道大学の同位体顕微鏡（結像型 SIMS）を使う
- 撮った像そのものが、定量の結果になる

<div class="attr">田川（2022）図6（p.29）をもとに作図。模式図で、測定データではない</div>

---

<!-- _class: lay-fig-right -->

## 水素は、核に強く分配されます

<svg viewBox="0 0 600 370" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="分配係数の対数軸（0.1〜100）の模式図：1 の破線は偏りなし。本研究の 29〜57 は金属の側に大きく寄る"><path d="M213.3 30V240" fill="none" stroke="var(--ink-weak, #6E6E6E)" stroke-width="2" stroke-dasharray="7 5"/><text x="203" y="50" font-size="20" text-anchor="end" fill="var(--ink, #262626)">D<tspan dy="5" font-size="18">H</tspan><tspan dy="-5"> = 1</tspan></text><text x="203" y="76" font-size="20" text-anchor="end" fill="var(--ink, #262626)">偏りなし</text><text x="590" y="40" font-size="22" font-weight="700" text-anchor="end" fill="var(--accent-dark, #7D1322)">本研究</text><text x="590" y="68" font-size="20" text-anchor="end" fill="var(--ink, #262626)">30〜60万気圧</text><text x="590" y="94" font-size="20" text-anchor="end" fill="var(--ink, #262626)">3,080〜4,560 K</text><text x="492.3" y="138" font-size="22" font-weight="700" text-anchor="middle" fill="var(--accent-dark, #7D1322)">29〜57</text><rect x="466.8" y="150" width="50.9" height="56" fill="var(--accent, #A6192E)"/><path d="M40 240H560M40 240V250M213.3 240V250M386.7 240V250M560 240V250" fill="none" stroke="var(--ink, #262626)" stroke-width="2"/><text x="40" y="276" font-size="20" text-anchor="middle" fill="var(--ink, #262626)">0.1</text><text x="213.3" y="276" font-size="20" text-anchor="middle" fill="var(--ink, #262626)">1</text><text x="386.7" y="276" font-size="20" text-anchor="middle" fill="var(--ink, #262626)">10</text><text x="560" y="276" font-size="20" text-anchor="middle" fill="var(--ink, #262626)">100</text><text x="203" y="314" font-size="20" text-anchor="end" fill="var(--ink-weak, #6E6E6E)">マグマに残りやすい</text><text x="223" y="314" font-size="20" fill="var(--ink-weak, #6E6E6E)">金属（核）に入りやすい</text><text x="300" y="356" font-size="20" font-weight="700" text-anchor="middle" fill="var(--ink, #262626)">分配係数 D<tspan dy="5" font-size="18">H</tspan><tspan dy="-5">（対数目盛）</tspan></text></svg>

- 30〜60万気圧、3,080〜4,560 K で D<sub>H</sub> は 29〜57
- 第一原理計算の結果とも合う
- 低い値の報告は、常圧に戻してから測ったためだろう

<div class="attr">田川（2022）図7（p.29）をもとに作図。模式図で、値は本文から</div>

<div class="takeaway">コア形成の条件を挟んで、初めて実験で決めました</div>

---

<!-- _class: lay-lead -->

## 核の水素は、今の海の 30〜70 倍

核へ水素が取り込まれることが、海の量を「調整」した主なメカニズムではないか。

---

<!-- _class: lay-steps -->

## これから分かること

1. **水の起源の候補を絞る**
   C 型小惑星のサンプルリターン（はやぶさ2、OSIRIS-REx）の結果と合わせる。
2. **水素以外の軽元素を調べる**
   密度欠損は、水素だけでは説明しきれない。
3. **地球全体の化学組成を決める**
   核の組成が分かって、はじめて地球の起源が分かる。

---

<!-- _class: refs -->

## 参考文献

- 出典：田川翔「地球中心核の水素」<br>Isotope News 2022年4月号 No.780, pp.26–30
- 出典の参考文献（p.30 の記載どおり）：

<div class="tcols">
<div>

- 1）Tagawa, et al., Nat. Commun., 12, 2588（2021）
- 2）Fischer, et al., GCA, 167, 177-194（2015）
- 3）Siebert, et al., Science, 339, 1194-1197（2013）
- 4）Rubie, et al., Icarus, 248, 89-108（2015）
- 5）Hirose, et al., Nat. Rev. Earth Environ, 2, 645-658（2021）
- 6）Okuchi, Science, 278, 1781-1784（1997）
- 7）Clesi, et al., Sci. Adv., 4, e1701876（2018）

</div>
<div>

- 8）Malavergne, et al., Icarus, 321, 473-485（2019）
- 9）Hirao, et al., MRE, 5, 018403（2020）
- 10）圦本，顕微鏡，41, 134-137（2006）
- 11）坂本，J. Mass Spectrom. Soc. Jpn., 69, 176-181（2021）
- 12）Li, et al., Nat. Geosci., 13, 453-458（2020）
- 13）Iizuka-Oku, et al., Nat. Commun., 8, 14096（2017）

</div>
</div>
