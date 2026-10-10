---
marp: true
theme: academic
paginate: true
size: 16:9
header: '<div class="hdr-left">同期プレビュー入門</div><img class="hdr-logo" src="../assets/logo-placeholder.png" alt="ロゴ">'
footer: ''
style: |
  :root { --hdr-left-w: 23%; --accent: #C8611C; --accent-dark: #8f3f12; --accent-soft: #FBEAD9; }
  section .page-title { left: 20%; width: 38%; }
  /* ===== 開始の前に：QR を右に置く行 ===== */
  .sec-qr-row { display: flex; align-items: center; gap: 16px; }
  .sec-qr-row .sq-text { flex: 1; min-width: 0; }
  .sec-qr-row .sq-qr { flex: 0 0 160px; text-align: center; }
  /* ===== 期限の表・帯 ===== */
  table.dtbl { border-collapse: collapse; font-size: 20px; }
  table.dtbl th, table.dtbl td { border: 1px solid #ccc; padding: 4px 14px; }
  table.dtbl td.l { text-align: left; }
  .band { background: #FBEAD9; border-radius: 8px; padding: 8px 14px; margin-top: 10px; }
  .ask { margin-top: 10px; font-size: 21px; line-height: 1.5; }
---

<!-- _class: cover-hero -->

<div class="title-event">見本デック 03</div>
<div class="title-big">同期プレビュー入門</div>
<div class="title-sub">15 分で試す、プレビュー上の直接編集</div>

<div class="meta">
<div class="name">氏名</div>
<div class="affil">所属</div>
</div>

---

<div class="page-title">はじめに</div>

## 15 分でやること

- 今日のテーマは同期プレビューです。スライドの原稿を、プレビューの上で直します
- PC で VS Code を開いてください
- 手元に **自分の原稿** があれば、それでも構いません

---

<!-- _class: summary -->

<div class="page-title">今回の構成</div>

## 3 つのステップで進めます

- 同期プレビューとは何かを理解する
- 「原稿＋プレビュー」のしくみを知る
- 実際にテストを行ってみる

<div class="takeaway">今日のゴール：毎日の「ちょっと面倒」を、ひとつ直してみる</div>

---

<!-- _class: summary -->

<div class="page-title">開始の前に</div>

## 参加用の QR を読み取ってください

<div class="sec-qr-row">
<div class="sq-text">

- 質問は匿名で送れます
- 回答は画面に出ます
- 読み取れない人は隣の人の画面を見てください

</div>
<div class="sq-qr"><img src="./src/slido-qr-sample.png" alt="参加用 QR" width="150"></div>
</div>

<div class="takeaway">質問はいつでもどうぞ</div>

---

<div class="page-title">こんな「面倒」</div>

## 原稿を直すときの「ちょっと面倒」

- 原稿の**誤字を見落とす**
- 直したい行を探すのに時間がかかる
- 直したつもりが、描画に反映されていない

---

<div class="page-title">期限</div>

## 提出物と期限

<div style="text-align:center">
<table class="dtbl" style="display:inline-table; margin:6px 0">
<tr><th>項目</th><th>期限</th></tr>
<tr><td class="l">動画の<strong>視聴期限</strong></td><td><span class="hl-dark mono">6/16（火）</span></td></tr>
<tr><td class="l"><strong>課題</strong>の提出</td><td><span class="hl-dark mono">6/16（火）</span></td></tr>
<tr><td class="l">リフレクションシート</td><td><span class="hl-dark mono">6/16（火）</span></td></tr>
<tr><td class="l">提出先</td><td class="mono">すべて LMS</td></tr>
</table>
</div>

<div class="band" style="font-size:18px">公開が遅れたため、視聴期限・課題とも <span class="hl">6/16（火）まで延長</span>。</div>

<div class="ask">「なぜ反映されない？」を AI に聞いても、<strong>仕組みを知らなければ答えの正否を判断できない</strong>。<br>中身を知れば、安心して直せる。</div>

---

<!-- _class: fig -->

<div class="page-title">この回の地図</div>

## 「原稿を直してからページが出るまで」を 1 本の旅として追う

<div class="fig-area">
<svg viewBox="20 40 920 120" width="100%" style="max-height:220px">
  <g font-size="16" text-anchor="middle">
    <g><rect x="30" y="48" width="115" height="62" rx="8" fill="#fff" stroke="#C8611C" stroke-width="2.5"/><text x="87" y="84" font-weight="700" fill="#8f3f12">原稿</text></g>
    <text x="158" y="84" fill="#C8611C" font-size="24" font-weight="800">→</text>
    <g><rect x="172" y="48" width="115" height="62" rx="8" fill="#fff" stroke="#3E78B2" stroke-width="2"/><text x="229" y="84" font-weight="700">プレビュー</text></g>
    <text x="300" y="84" fill="#C8611C" font-size="24" font-weight="800">→</text>
    <g><rect x="314" y="48" width="110" height="62" rx="8" fill="#fff" stroke="#3C8A57" stroke-width="2"/><text x="369" y="84" font-weight="700">lint</text></g>
    <text x="436" y="84" fill="#C8611C" font-size="24" font-weight="800">→</text>
    <g><rect x="450" y="48" width="200" height="62" rx="8" fill="#FBEAD9" stroke="#C8611C" stroke-width="2"/><text x="550" y="84" font-weight="700" fill="#8f3f12">PNG で目視</text></g>
    <text x="660" y="84" fill="#C8611C" font-size="24" font-weight="800">→</text>
    <g><rect x="674" y="48" width="110" height="62" rx="8" fill="#fff" stroke="#6B6F76" stroke-width="2"/><text x="729" y="84" font-weight="700">PDF</text></g>
    <text x="796" y="84" fill="#C8611C" font-size="24" font-weight="800">→</text>
    <g><rect x="810" y="48" width="120" height="62" rx="8" fill="#FBEAD9" stroke="#C8611C" stroke-width="2.5"/><text x="870" y="84" font-weight="700" fill="#8f3f12">ページ表示</text></g>
  </g>
</svg>
</div>

<div class="takeaway">ゴールは 1 つ ── 直した結果を描画で確かめること</div>

---

<div class="page-title">準備</div>

## 準備するもの

- VS Code と Node.js
- Google Chrome（PDF とプレゼンに使います）
- この見本のフォルダ

---

<!-- _class: split -->

<div class="page-title">やってみる</div>

## 左で直し、右で確かめる

<div class="split-body">
<div class="left">

- 原稿をダブルクリックして打ち直す
- Enter で確定、Esc で破棄

</div>
<div class="right">

- 右クリックで配置の候補を見る
- 変わるのは `_class` の 1 語だけ

</div>
</div>

---

<!-- _class: summary -->

<div class="page-title">まとめ</div>

## 今日の 3 点

- 原稿が唯一の正本です
- プレビューの操作は、原稿への小さな編集になります
- 直した結果は描画で確かめます

<div class="takeaway">次は自分の原稿で試してください</div>
