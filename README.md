# marp-GUI

**日本語** | [English](README.en.md)

Marp のスライドを、**VS Code のプレビュー上でさわって作る**ための環境です。
原稿はふつうの Markdown のまま。プレビューで文字をダブルクリックして直したり、右クリックで配置を選んだり、スライドを並べ替えたりできます。

- 同期プレビュー：原稿のカーソル位置のスライドを横に表示（クリックで原稿の該当行へ）
- プレビューで直接編集：文字をダブルクリック → Enter で原稿に書き戻す
- 配置案：スライドを右クリック → 3列カード・図と文の2カラムなどを見比べて1クリックで切り替え
- スライド操作：追加・複製・並べ替え・削除、既存スライドの検索と挿入
- 📄 PDF（ベクター・文字がにじまない）と ▶ プレゼン（Chrome で全画面）

mac / Windows で使えます（テストは Ubuntu でも走ります）。Node.js 20 以上。

> **ご注意**：このソフトウェアは無償で「現状のまま（AS IS）」提供しており、いかなる保証もありません。法律が認める最大限の範囲で、使用によって生じた損害について、作者および貢献者は責任を負いません。詳しくは下の「[免責事項](#免責事項)」をご覧ください。

## できること

![見本デック「地球中心核の水素」の完成スライドを並べた一覧](docs/img/ja/07-slides.png)

このような学術スライドを、ふつうの Markdown から作れます。上は見本デック「地球中心核の水素」の一部です。

![英語の見本デック「Getting started with marp-GUI」の 6 枚](docs/img/en/08-getting-started.png)

英語の見本デック「Getting started with marp-GUI」（`slides/sample-getting-started/`、12 枚）は、直接編集・配置クラス・スライド操作・箱の編集・書き出し・lint という使い方そのものを英語で説明します。

![同期プレビューで、いま選んでいるスライドを青い枠で示している画面](docs/img/ja/01-overview.png)

VS Code の右側に開く同期プレビューです。原稿（左側）のカーソルを動かすと、プレビューもそのスライドへ移り、青い枠で示します。上にスライド操作のボタン、下に文字の大きさと色のバーが出ます。

---

## 1. 必要なもの（先に入れておく）

| もの | 入手先 |
|---|---|
| **VS Code** | https://code.visualstudio.com/ |
| **Node.js**（LTS 版） | https://nodejs.org/ja/download |
| **Google Chrome**（または Edge） | PDF とプレゼンに使います |

## 2. ダウンロード

このページ上の緑の **「Code」ボタン → 「Download ZIP」** を押し、ZIP を展開します。
展開したフォルダ（`marp-GUI-main`）は、**書類フォルダなど、ずっと置いておく場所**へ移してください（ダウンロードフォルダのままだと、消したときに使えなくなります）。

git が使える方は：

```bash
git clone https://github.com/ShohTagawa/marp-GUI.git
```

## 3. インストール（ダブルクリック1回）

| mac | Windows |
|---|---|
| `install-mac.command` を **右クリック →「開く」**（初回だけ。確認が出たら「開く」） | `install-windows.bat` を **ダブルクリック**（「PC を保護しました」と出たら「詳細情報」→「実行」） |

黒い画面で必要な部品が入り（初回は数分）、最後に VS Code が見本のスライドを開きます。
VS Code が先に開いていた場合は、コマンドパレット（⌘⇧P / Ctrl+Shift+P）で **「Developer: Reload Window」** を実行してください。

ターミナルに慣れている方は、フォルダで次の1行でも同じです。

```bash
npm run setup
```

また、**Antigravity IDE** や **Claude Code** などの AI コーディングエージェントをお使いの場合は、`marp-GUI` フォルダを開いた状態でチャット欄に **「tool にある内容をインストールして」** と伝えるだけでも、自動で `npm run setup`（依存パッケージの導入と拡張機能のリンク）まで完了します。

> フォルダを別の場所へ動かしたら、もう一度インストーラーを実行してください（VS Code / Antigravity IDE への登録を貼り直します）。

## 4. 使ってみる

1. VS Code で **フォルダ `marp-GUI` を開いた状態**にする（「ファイル」→「フォルダーを開く」）
2. `slides/sample-layouts/sample-layouts.md` を開く
3. **⌘K M**（Windows は **Ctrl+K M**）で、右に同期プレビューが開きます

| やりたいこと | 操作 |
|---|---|
| ホームを開く（最近・棚・手を入れた順・検索） | **⌘K H**（Windows は **Ctrl+K H**）、または右下の **🏠 Marp** |
| 文字を直す | プレビューの文字を **ダブルクリック** → 打つ → **Enter**（Esc で取り消し） |
| 配置を変える | プレビューのスライドを **右クリック** → 案を選ぶ |
| スライドを足す・複製・移動・削除 | スライド右上のボタン（＋ ⧉ ↑ ↓ 🗑） |
| スライドの間に既存スライドを入れる | スライドの間にマウスを乗せて出る **＋** |
| 箱を動かす・大きさを変える | **Alt（mac は Option）＋クリック** → ドラッグ |
| PDF にする | 画面下のステータスバーの **📄 PDF**（`out/` フォルダに出ます） |
| 発表する | ステータスバーの **▶ プレゼン**（F=全画面 / P=発表者ビュー / ←→=ページ送り） |
| 元に戻す | ⌘Z / Ctrl+Z |

### 文字を直す

![プレビューの文字をダブルクリックして、その場で編集している画面](docs/img/ja/02-direct-edit.png)

プレビューの文字をダブルクリックすると、その場で打ち直せます。Enter で確定すると、原稿の該当箇所だけが書き換わります。

### 配置を変える

![スライドを右クリックして、配置案のサムネイルが並んだ画面](docs/img/ja/03-layouts.png)

スライドを右クリックすると、同じ原稿のまま並び方を変えた案がサムネイルで並びます。選ぶと原稿の1行（`_class`）だけが変わります。

### スライドを足す・複製・移動・削除

![選んだスライドの右上に、追加・複製・移動・削除のボタンが出ている画面](docs/img/ja/04-slide-buttons.png)

プレビューで選んだスライドの右上にボタンが出ます。新しいスライドの追加、複製、前後への移動、削除ができます。

### 既存のスライドを入れる

![スライドの間の ＋ を押して、既存スライドを選ぶポップアップが開いた画面](docs/img/ja/05-insert-popup.png)

スライドの間にマウスを乗せると ＋ が出ます。押すと、ほかのデックのスライドを検索して、その位置に入れられます。

### 箱を動かす・大きさを変える

![Alt（Option）＋クリックで選んだ箱に枠とハンドルが出ている画面](docs/img/ja/06-box-edit.png)

Alt（mac は Option）を押しながらクリックすると、箱に枠が出ます。ドラッグで移動し、角のハンドルで大きさを変えられます。

操作の一覧と細かい設定は [tools/marp-scroll-sync/README.md](tools/marp-scroll-sync/README.md) にあります。

## 5. 自分のスライドを作る

見本のフォルダをまるごと複製して、名前を変えるのがいちばん簡単です。

```
slides/
  my-talk/            ← フォルダ名と
    my-talk.md        ← md の名前をそろえる
    src/              ← 画像はここに入れ、md からは ./src/fig01-xxx.png で参照
    out/              ← PDF などはここに出ます
  assets/             ← ロゴなど、複数のデックで共有する画像
```

- ファイル名は **半角英数とハイフン** だけにしてください（全角・空白はリンク切れの原因になります）
- ロゴは `slides/assets/logo-placeholder.png` を差し替えるか、md 先頭の `header:` の画像を書き換えます
- 表紙の写真は `slides/assets/profile-placeholder.png` を差し替えます

### 原稿の書き方（最小）

```markdown
---
marp: true
theme: tsutawaru-academic
paginate: true
header: '<div class="hdr-left">発表タイトル</div><img class="hdr-logo" src="../assets/logo-placeholder.png" alt="ロゴ">'
---

<!-- _class: lay-cards3 -->

## 見出し

- **1つめ**
  説明
- **2つめ**
  説明
- **3つめ**
  説明

<div class="takeaway">この1枚で言いたいこと</div>
```

- スライドの区切りは `---`（前後に空行）
- `<!-- _class: lay-cards3 -->` のような **配置クラス**を1語足すだけで並び方が変わります（右クリックの配置案が、これを書き換えます）。
  使える配置は `sample-layouts.md`、部品は `sample-parts.md` を見てください
- 下端の要点帯は `<div class="takeaway">…</div>`

### 構造の仕組み：CSS の「器」に Markdown を埋める

`marp-GUI` は、MIT ライセンスの [Marp (Marpit)](https://marp.app/) の上に、**「CSS で作った器（`theme/*.css`）の中に、素の Markdown を流し込む」** 構造をとっています。

- **動かさない枠（不変条件）**：見出し・ヘッダー・下端の要点帯（`.takeaway`）・16:9 の外枠は CSS 側で固定されており、本文をどう書き換えても位置がブレません。
- **配置クラス（`lay-*`）で並べ替え**：原稿の Markdown はそのままに、`<!-- _class: lay-cards3 -->` や `lay-flow`・`lay-fig-right` などの 1 語だけで 12 種類のレイアウトに切り替わります。そのため、過去のスライドを `＋` ボタンから差し込んでも、今のデックの CSS デザインに自動で馴染みます。
- **GUI 操作も AI 編集も同じ Markdown へ**：プレビュー上でのダブルクリック文字編集・右クリックの配置切り替え・`Alt`＋ドラッグでの枠移動は、すべて元の Markdown 原稿への 1 回の編集（`⌘Z` / `Ctrl+Z` 1 回で戻せる単位）として書き戻されます。
- **CSS のデザイン調整も AI に依頼可能**：「このページの余白を少し広げて」「カードの配色を落ち着かせて」のように AI エージェントへ頼めば、`theme/*.css` やスライド内の `style`・インライン SVG 図解・発表者ノート（`<!-- ... -->`）まで対話的に調整できます。

## 6. うまく行かないとき

| 症状 | 対処 |
|---|---|
| ⌘K M でプレビューが出ない／ボタンが無い | インストーラーをもう一度実行 → VS Code で「Developer: Reload Window」 |
| 📄 / ▶ が出ない | md の先頭に `marp: true` があるか。VS Code で **marp-GUI フォルダ** を開いているか |
| PDF が「Printing failed」で止まる | ターミナルで `npm run pdf:safe -- slides/<デック>/<デック>.md`（分割を細かくします） |
| 「Node.js が見つかりません」 | Node.js を入れたあと、VS Code とインストーラーを開き直す |
| 状態を確かめたい | `npm run setup:check` |

## 7. ターミナルから使う（任意）

```bash
npm run pdf      -- slides/<デック>/<デック>.md   # ベクターPDF（引数なし＝最後に編集したデック）
npm run present  -- slides/<デック>/<デック>.md   # Chrome で全画面プレゼン
npm run png      -- slides/<デック>/<デック>.md   # 全ページを PNG に
npm run lint     -- slides/<デック>               # 囲み過多・文字過多などの点検
```

## 8. テスト（開発者向け）

同期プレビュー拡張のテストは `tools/marp-scroll-sync/test/` にあり、Node の標準テストランナーで走ります。

```bash
npm test
```

- 純粋なロジック（スライドの分割・原稿への対応付け・スライド操作・折りたたみ・ライブラリ・索引・配置案・ホーム画面）は、`slides/` の見本デック 3 本（`sample-layouts`・`sample-parts`・`sample-lecture`）だけを使います。
- プレビューを実際に動かす試験（直接編集・箱の編集とトリミング・ギャラリー・通し試験）は、手元の Google Chrome と `puppeteer-core`（`npm install` で入ります）を使います。Chrome が見つからないときは、その試験だけ skip になります。
- 全部で 346 件（畳んだ表示の模擬を書き出す 1 件は、`FOLDED_VIEW_OUT` を指定したときだけ走ります）。手元の Chrome ありで約 5 分（ファイルを 1 つずつ直列に走らせます。速さの予算を測る試験があるためです）。
- GitHub Actions（`.github/workflows/test.yml`）が macOS・Windows・Ubuntu × Node 20・22 で同じテストを回します（共有ランナーでは速さの試験だけ skip）。
- 見本デック `sample-lecture` は、テストが頼る構造（表・インライン SVG・QR の列・`_class` の有無）を 1 本に集めた「講義の見本」です。中身は架空です。
- `npm run bench` は、同じ仕組みで「操作から描き直しまで」の時間を測ります（結果は [docs/benchmark.md](docs/benchmark.md)）。`npm run screenshots` は `docs/img/` の画面写真を撮り直し、`npm run demo:ranking` は小さな一時 git リポジトリを作って、ライブラリが手直しの回数でスライドを並べる様子を見せます。

## 中身

```
theme/            テーマ 5 つ：academic.css（土台）・tsutawaru-academic.css（推奨）・
                  tsutawaru-simple.css・tsutawaru-simple-cud.css（色覚の多様性に配慮した配色）・ponchie.css（1 枚の全体像）
slides/           見本デック 14 本：sample-getting-started（使い方・英語）、sample-hydrogen・-academic・
                  -ponchie・-tsutawaru-simple・-tsutawaru-simple-cud の英語版と日本語版（-ja）、
                  sample-layouts（配置クラス）・sample-parts（部品）・sample-lecture（試験用）。共有画像は assets/
docs/             DESIGN.en.md・design-rules.md（lint の規則）・benchmark.md・security-review.md・examples/
tools/
  marp-scroll-sync/   VS Code 拡張：同期プレビュー・直接編集・配置案・スライド操作
  marp-pdf/           ベクターPDF（分割印刷→結合）と、📄/▶ ボタンの VS Code 拡張
  marp-present/       Chrome で全画面プレゼン
  marp-library.mjs    既存スライドの検索・挿入（プレビューの ＋ から使われる）
  marp-png.mjs        全ページを PNG に
  tsutawaru-lint.mjs  デザイン規則の点検（メッセージは --lang en|ja）
  demo/               手直しの回数で並べる様子の実演（npm run demo:ranking）
  run-tests.mjs       テストを 1 ファイルずつ直列に走らせる（npm test。Node.js 20 以降で動く）
  setup.mjs           セットアップ本体（インストーラーが呼ぶ）
install-mac.command / install-windows.bat
```

VS Code 拡張はマーケットプレイスを通さず、このフォルダを `~/.vscode/extensions/`（および Antigravity IDE の `~/.antigravity-ide/extensions/`）に登録（リンク）して使います。外すときは `marp-gui.scroll-sync` と `marp-gui.pdf` を削除してください（リンクなので、本体は消えません）。

## 設計の背景と謝辞

### Marp（Yuki Hattori さん / Marp Team）へ

`marp-GUI` は、**[Yuki Hattori さん（@yhatt）](https://github.com/yhatt)** と **[Marp Team](https://github.com/marp-team)** が開発し MIT ライセンスで公開されている **[Marp（Markdown Presentation Ecosystem）](https://marp.app/)**（`@marp-team/marp-core`・`@marp-team/marpit`・`@marp-team/marp-cli`）の基盤の上に成り立っています。Markdown と CSS だけで美しく拡張性の高いスライドを組める仕組みを作り、長年にわたりメンテナンスし続けてくださっていることに深く感謝いたします。

### 中島聡さんへ

本ツールの「AI と人間が共有する器（DSL）として CSS テーマと制限付き Markdown を定義し、重いレンダリングや PDF・動画合成は手元の Mac / PC の決定論的ハーネスに任せる」という設計思想、およびオンデマンド講義動画パイプラインにおけるアバター合成は、**中島聡さん（[@snakajima](https://x.com/snakajima) / Receptron）** の記事 **「バイブなもの作りの時代」** と、オープンソースとして公開された **[AvatarScript](https://github.com/receptron/avatarscript)**・**[MulmoCast](https://github.com/receptron/mulmocast-cli)**（ならびに shinshin86 さんの **[Mesh Avatar Studio](https://x.com/shinshin86/status/2106593371762651346)**）から多大な示唆と恩恵を受けています。

詳しい背景と構造の対応については、**[中島聡さんへの感謝と、`marp-GUI` の設計思想について（docs/THANKS-nakajima.md）](docs/THANKS-nakajima.md)** をご覧ください。

## ご寄付のお願い

このツールは、限られた予算の中で開発しています。役に立ったと感じていただけたら、千葉大学基金へのご寄付をご検討いただけるとうれしいです。ご寄付は千葉大学の教育・研究を支えるもので、このソフトウェアの開発に使途を指定するものではありません。

- 千葉大学基金：https://kikin.chiba-u.ac.jp/
- ご寄付の方法：https://kikin.chiba-u.ac.jp/howto

## ライセンス

各ソースファイルの先頭に `SPDX-License-Identifier: Apache-2.0` と著作権表示を入れています。

Apache License 2.0（[LICENSE](LICENSE)）。テーマ・拡張・ツールとも自由に使い、改変できます。

## 免責事項

以下は Apache License 2.0 の第7条（保証の否認）と第8条（責任の制限）の内容を、確認のために補足して記したものです。ライセンスの条件を変更・追加するものではありません。内容が食い違う場合は、[LICENSE](LICENSE) が優先します。

- このソフトウェアは無償で「現状のまま（AS IS）」提供しており、明示・黙示を問わず、商品性、特定目的への適合性、権利を侵害していないことを含め、いかなる保証もありません。
- 適用される法律が認める最大限の範囲で、作者および貢献者は、このソフトウェアの使用または使用できなかったことから生じた損害（データの消失、スライドや原稿の破損、業務の中断、その他の直接・間接・付随的・結果的な損害を含みます）について、一切の責任を負いません。
- 法律上どうしても責任を免れることができない場合でも、その責任は、利用者がこのソフトウェアに支払った金額（無償のため 0 円）を上限とします。
- このソフトウェアは原稿ファイルを直接書き換えます。大切な原稿は、ご自身でバックアップを取ってからお使いください。
- サポートはできる範囲で行うものです。作者には、質問への回答・不具合の修正・更新の提供を行う義務はなく、このソフトウェアは予告なく変更・提供終了することがあります。困ったときは、まず「[うまく行かないとき](#6-うまく行かないとき)」を見て、それでも解決しなければ [CONTRIBUTING.md](CONTRIBUTING.md) の手順で GitHub の issue にお知らせください。
- Marp は原稿中の HTML をそのまま描画します。出どころのわからない、または信頼できないデック（.md ファイル）を開くときは、中身を確かめてからにしてください。どのファイルを開くかは、利用者ご自身の責任で判断してください。
- コードの大部分は、作者の仕様に沿って AI のコーディングエージェントが書きました。346 件の自動テスト（`npm test`）で確かめ、リポジトリの GitHub Actions のワークフローが Ubuntu・macOS・Windows × Node.js 20・22 で同じテストを回します。セキュリティの点検の結果は、まだ直していない項目も含めて [docs/security-review.md](docs/security-review.md) にあります。テストと点検で不具合や脆弱性は減らせますが、無くせるわけではありません。
