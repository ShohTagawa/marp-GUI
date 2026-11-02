---
marp: true
theme: academic
paginate: true
size: 16:9
lang: ja
header: '<div class="hdr-left">部品ライブラリの見本</div><img class="hdr-logo" src="../assets/logo-placeholder.png" alt="ロゴ">'
footer: ''
---

<!-- _class: cover-hero -->

<div class="title-hero">
<div class="title-small">academic</div>
<div class="title-big long">部品の見本</div>
<div class="title-sub">よく使う部品を1枚ずつ並べました</div>
</div>

<div class="title-foot">
<div class="title-photo"><img src="../assets/profile-placeholder.png" alt="写真"></div>
<div class="title-meta">
<div class="title-name">氏名</div>
<div class="title-affil">所属</div>
</div>
</div>

---

<div class="page-title">13-1 箇条書き／13-3 ex</div>

## 生成AIは、答える道具から進める道具になりました

- **はじまりは、一問一答のチャットでした**
  聞いたことに、その場で答えが返ります。
- **いまは、目的を渡すと自分で手順を立てて進めます**
  調べて、まとめて、下書きまでが一続きになります。
- 行頭が太字でない項目は、●つきの箇条書きのままです

<div class="ex">例：<b>会議の記録</b>を渡すと、要点の整理から議事録の下書きまでを続けて進めます。</div>

---

<div class="page-title">13-2 boxed</div>

## 今日のねらいは3つです

<div class="boxed">

- **生成AIの仕組みを知りましょう**
  確率的な機械だと分かると、扱いやすいです。
- **危ない使い方との線引きができるようになります**
- **自分の仕事での活用を試す、一歩目になります**

</div>

<div class="takeaway">目標・ねらいの1枚だけに使い、項目は3つまでにします</div>

---

<div class="page-title">13-4 grid3</div>

## 生成AIの弱点は3つに分けて考えます

<div class="grid3">
<div class="fill">
<p class="t">ハルシネーション</p>
<p class="d">知らないことも、それらしく答えます。</p>
</div>
<div class="fill">
<p class="t">平均への寄り</p>
<p class="d">典型から外れるほど、出力に現れにくくなります。</p>
</div>
<div class="fill">
<p class="t">入力の扱い</p>
<p class="d">入力は、外部サーバーへの送信と同じです。</p>
</div>
</div>

<div class="takeaway">3列は1段だけ。4つ以上なら枚を分けます</div>

---

<div class="page-title">13-5 keyrow</div>

## 名前と一言を、3つまで横に並べます

<div class="keyrow">
<div><p class="t">Gemini アプリ</p><p class="d">対話</p></div>
<div><p class="t">Gemini Notebook</p><p class="d">資料から</p></div>
<div><p class="t">Workspace Studio</p><p class="d">自動化</p></div>
</div>

- **囲まずに、上の罫1本と太さだけで3つを並べます**
  名前は .t、一言は .d で書きます。

---

<div class="page-title">13-6 いまここ</div>

## 生成AIの使われ方は3段階で進んできました

<div class="flow">
<div class="fbox">聞くと答えが返る<span class="big">チャット</span></div>
<div class="arw"></div>
<div class="fbox">検索やファイルも扱う<span class="big">ツール連携</span></div>
<div class="arw"></div>
<div class="fbox now"><span class="nowtag">いまここ</span>手順を立てて作業する<span class="big">エージェント</span></div>
</div>

<div class="takeaway">色を差すのはフローの1か所だけにします</div>

---

<!-- _class: slido -->

<div class="page-title">13-7 slido</div>

## はじめに、会場の様子を教えてください

- **1-①　生成AIをどのくらいの頻度で使用されていますか？<span class="qtag">択一</span>**
  いちばん近いものを1つ選んでください。
- **1-②　生成AIを何に使っていますか<span class="qtag">複数選択</span>**

---

<div class="page-title">13-8 QR</div>

## QR は右の列に置き、枠は付けません

<div class="tcols qr-right">
<div>

- **QR は右の列に置きます**
  大きさは --qr-size で変えられます（大きくするなら .qr.lg）。
- **URL や参加コードは、QR の下の .cap に書きます**

</div>
<div class="qr"><img src="./src/fig08-qr-sample.png" alt="QR（見本）"><div class="cap">参加コード：見本</div></div>
</div>

---

<div class="page-title">13-9 出典</div>

## 外部の図には出典を付け、リンクはチップにまとめます

<div class="tcols fig-left">
<div>
<div class="ph" style="min-height:230px;">外部の図（見本）</div>
<div class="attr">出典：著者（年）「資料名」p.12 <a href="https://example.com/">https://example.com/</a></div>
</div>
<div>

- **図の下は .attr です**
  19pxの灰色で、リンクは下線だけです。

</div>
</div>

<div class="src-row">
<p class="note">注記は左に書き、出典のリンクは右のチップにまとめます。</p>
<div class="chips"><a class="fill tight" href="https://example.com/">指針 PDF</a><a class="fill tight" href="https://example.com/">Web ページ</a></div>
</div>

---

<div class="page-title">13-10 ng／13-11 mono</div>

## 表の中の「不可」は .ng、コマンドは .mono で書きます

| 使い方 | 判定（見本） | 条件・理由（見本） |
|---|---|---|
| 下調べに使う | 可 | 事実は自分で確かめる |
| 画像を生成する | <span class="ng">原則不可</span> | 許可が要る |
| 機密を入力する | <span class="ng">不可</span> | 機密保持に反する |

- **コマンドやアドレスは等幅にします**
  <span class="mono">ping 192.168.0.1</span> のように書くと、桁が揃います。

---

<div class="page-title">13-14 prompt の穴</div>

## 貼る文の〔　〕は、行の中に収まります

<div class="tcols">
<div>

- **〔　〕は受講者が埋める箇所です**
  太字とメインの濃い色で示します。

</div>
<div class="fill">
<div class="prompt"><span class="lab">貼る文</span>あなたは<span class="ph">〔科目名〕</span>の教員です。次のレポートを、<span class="ph">〔観点〕</span>の3段階で採点してください。</div>
</div>
</div>
