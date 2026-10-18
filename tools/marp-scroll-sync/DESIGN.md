# Marp Scroll Sync v0.2 設計（直接編集・完成スライドの再利用・コードの簡素化）

2026-09-20。事前調査（Marpit 仕様の実測／contenteditable の実測／156デックのコーパス分析／テーマCSS／VS Code API）に基づく。
このファイルはモジュール間の取り決め（インターフェース）の正本。実装を変えたらここも直す。

## 0. 絶対条件

- 標準の marp-cli（カスタムエンジン無し）での PDF / HTML / PNG 出力を一切変えない。原稿に書き込むものは、発表者ノートに混入せず、描画も変えない形式だけ。
- 拡張に新しい npm 依存を足さない（`@marp-team/marp-core` のみ）。トップレベルの require が失敗すると同期プレビューごと死ぬ。
- 原稿（.md）を壊さない。書き戻しは「位置が一意に確定したときだけ」。確定できなければ何も書かず、原稿の該当行へ案内する。1操作＝1 WorkspaceEdit（Cmd+Z 1回で戻る）。
- vscode に依存しないロジックは `lib/*.cjs` の純粋関数にして `node --test` で検証する。vscode 依存は `extension.js` と `lib/*-vscode.cjs` だけ。
- `engines.vscode` は `^1.80.0` のまま。新しい API は存在確認してから使う（無ければその機能だけ黙って無効）。

## 1. ファイル構成

```
tools/marp-scroll-sync/
  extension.js              配線（コマンド登録・Webview・メッセージ振り分け）
  lib/slide-split.cjs       スライド分割の正本（既存の slideStartLines を移設）。splitDeck / slideMeta / LIB_KEY
  lib/source-map.cjs        プレビューのテキストノード → 原稿オフセットの特定と、書き戻し編集の計算
  lib/slide-ops.cjs         スライド単位の操作（複製・削除・移動・新規・箇条書きの追加/削除）→ 編集の計算
  lib/folding.cjs           折りたたみ範囲・スライドラベル・パネルラベルの計算（純粋）
  lib/folding-vscode.cjs    FoldingRangeProvider・装飾・自動折りたたみ（vscode 依存）
  lib/library-core.cjs      完成スライドの印・台帳・貼り付け先への適応（CSS同梱・素材コピー・色の追従）（純粋＋fs）
  lib/library-vscode.cjs    印を付ける／ライブラリから挿入／貼り付け適応（vscode 依存）
  lib/corpus-core.cjs       全スライドの索引・検索・棚（shelf.json）・git 履歴の集計（純粋＋fs＋git）。7.1 / 8.2
  lib/corpus-vscode.cjs     検索への応答・サムネイル・複数枚の挿入・棚の読み書き・索引の裏作成（vscode 依存）。7.4 / 8.5
  lib/layout-variants.cjs   配置案（lay-*）の判定の表と、_class の書き換え（純粋）。8.3
  media/textnodes.js        ブラウザ側：section 内のテキストノードを DOM 順に列挙（source-map と対。テストと Webview で同じ物を使う）
  media/preview.js          ブラウザ側：プレビューの全 UI（既存のスクロール同期・tune に、直接編集・スライド操作・ギャラリーを追加）
  media/overflow.js         ブラウザ側：はみ出し検知 window.ssDetectOverflow（任意の部品。テストとプレビューで同じ物）。7.2
  media/layouts.js / .css   ブラウザ側：右クリックの配置案ポップアップ window.ssLayouts（任意の部品。window.ssPreview だけに頼る）。8.3
  media/boxedit.js / .css   ブラウザ側：Alt で箱を動かす・大きさを変える window.ssBoxEdit（任意の部品。window.ssPreview だけに頼る）。9章
  lib/style-edit.cjs        箱の位置と大きさを、開始タグの style 属性（Markdown の画像は alt）へ書く編集を計算する（純粋）。9.2 / 9.3
  media/preview.css         プレビュー専用 UI の CSS（すべて ss- 接頭辞。デックの CSS と衝突させない）
  test/*.test.cjs           node --test。ブラウザが要るものは puppeteer-core（リポジトリ直下の node_modules）＋手元の Chrome
tools/marp-library.mjs      CLI：台帳生成・サムネイル・候補出し・挿入（Claude からも使う）。library-core を import
slides/_library/index.json  台帳（生成物）。thumbs/<id>.png。ここに marp:true の md は置かない
slides/_library/corpus.json 全スライドの索引（生成物。.gitignore）
slides/_library/shelf.json  棚（呼び名と並び順。git で追跡する）
```

共通の「編集」表現（純粋関数はこれを返し、vscode 側が WorkspaceEdit に変換する）：

```js
// offset は doc.getText() の UTF-16 オフセット。複数あるときは互いに重ならないこと。呼び出し側は後ろから適用するか、WorkspaceEdit に一括で積む。
{ start: number, end: number, text: string }
```

## 2. 機能1：プレビュー上での直接編集

### 2.1 位置情報（source-map.cjs）

- `attachLineInfo(marp)`：markdown-it の core ルールを足す。
  - `t.map && t.nesting === 1` のトークンに `data-line`（map[0]）と `data-line-end`（map[1]）。
  - `html_block` トークンは、content 内の **すべての開始タグ** に `data-hline` / `data-hline-end` を足す。正規表現の一括置換ではなく、コメント・`<style>`・`<script>`・引用符内を飛ばす小さなトークナイザで行う（属性値に `<` があっても壊さない）。プレビュー専用であり、marp-cli の出力には影響しない。
- `near`：テキストノードから見て最も近い祖先の `[data-line]`（kind:'md'）か `[data-hline]`（kind:'html'）。`<section>` 自身の data-line は数えない。どちらも無ければ null（スライド全体を探索窓にする）。
- `locateNodes(sourceText, slideRange, nodes)`：順序つきカーソル探索。
  - 原稿のタグとコメントを同じ長さの `\0` で潰した「マスク済み原稿」を作る（属性値・ノートへの誤ヒット防止）。`<style>` の中身も潰す。
  - nodes を DOM 順に走査し、`[max(cursor, near.start の行頭), near.end の行頭)` の窓で、trim 済み文字列（と `& < >` を実体参照にした候補）を indexOf。見つかれば cursor を進め、見つからなければそのノードだけ飛ばす（cursor は動かさない。KaTeX・絵文字画像などソースに無い文字列のため）。
  - 戻り値：各ノードの `{ start, end, encoded:boolean } | null`。
- `planTextEdit(sourceText, slideRange, nodes, change)`：`change = { k, old, now }`。
  - ノード k が特定でき、原稿のその位置の文字列が old（または実体参照化した old）と一致するときだけ編集を返す。前後の空白は 1 バイトも変えない。
  - `encoded` なら now も `& < >` を実体参照にする。Markdown 由来（near.kind==='md' かつインライン HTML の外）のときは、編集で **増えた** `* _ \` < [` だけをバックスラッシュでエスケープする。
  - 失敗時は `{ ok:false, reason, line }`（line は案内先の行。分かる範囲で）。
- `planRangeSelect(...)`：ノード k の [startOffset, endOffset) を原稿の範囲に写す（プレビューで選択した文字にサイズ/色を当てるため）。実体参照を含むノードでは ok:false。

実測値（推敲済みの3デック・4,890ノード）：この方式で 100% 特定。html_block 内は parse5 の位置情報と 100% 一致。

### 2.2 ブラウザ側（media/textnodes.js, media/preview.js）

- `ssCollectTextNodes(section)` → `[{ node, t, near, svg }]`。除外：`section > header`、`section > footer`、`style`、`script`、空白だけのノード。`t` は nodeValue そのまま（trim しない）。`svg` は data-marpit-svg でない `<svg>` の中か。
- 編集の開始：テキストの上で **ダブルクリック**。対象は「クリックされたテキストノードを直接含む、最も近いブロック要素」（li / p / h1〜h6 / td / th / div / blockquote / figcaption など。span・strong・a などインライン要素は親へ遡る）。その要素に一時的に `contenteditable="plaintext-only"` と `spellcheck="false"` を付ける。**section 全体には絶対に付けない**（全選択→1文字でスライドが全消去されるのを実測）。
- インライン SVG の `<text>` / `<tspan>` は contenteditable が効かないので、同じ位置に小さな入力欄を重ねる（オーバーレイ方式）。確定時の流れは同じ。
- 確定：Enter（`isComposing` でなく keyCode!==229）と blur。破棄：Esc（スナップショットから元に戻す）。Shift+Enter または Cmd/Ctrl+Enter は、対象が li のとき「確定して、下に新しい箇条書きを作り、その編集を始める」。空の li で Backspace は「その箇条書きを消す」。
- 確定時：開始時に取ったスナップショット（ノードの同一性で照合）と比べて `changes:[{k, old, now}]` を作る。新しくできたテキストノードは、同じ親を持つ直前（無ければ直後）のノードへの追記として扱う。どちらも無ければ `unsupported`。元のノードが消えていたら now:'' として扱う。
- 編集中は `render` メッセージを 1 件だけ保留し、確定/破棄の直後に適用する。既存の keydown（j/k/矢印）と click のハンドラは、編集中と `isContentEditable` のとき何もしない。
- 描画後の検算：拡張が `expect:{ index, k, text }` を render に添える。再描画後にノード k の文字が text と違えば「表示と原稿がずれました（Cmd+Z で戻せます）」と出す。

### 2.3 メッセージ（Webview ⇄ 拡張）

既存：`scrollToSlide` `render` `tuneState`（→Webview）、`revealLine` `revealText` `revealSlide` `gotoSlide` `tune`（→拡張）。追加：

| 方向 | type | 中身 |
|---|---|---|
| →拡張 | `editCommit` | `{ index, version, nodes:[{t,near,svg}], changes:[{k,old,now}], then:'none'|'newBullet', line, lineEnd }`（line/lineEnd は編集要素の data-line / data-line-end。無ければ null） |
| →拡張 | `bulletDelete` | `{ index, version, line, lineEnd }` |
| →拡張 | `tuneSelect` | `{ index, version, nodes, k, start, end, px }` → 原稿側でその範囲を選択し、以後は既存の tune 経路 |
| →拡張 | `slideOp` | `{ op:'new'|'duplicate'|'delete'|'moveUp'|'moveDown'|'mark'|'library', index, version }` |
| →拡張 | `libraryInsert` | `{ id, index, version }`（index の次に挿入） |
| →Webview | `render` | 既存＋ `{ version, marks:[bool…], expect? }` |
| →Webview | `editResult` | `{ ok, message }`（トースト表示） |
| →Webview | `startEdit` | `{ line }`（再描画後、data-line===line の要素の編集を始める） |
| →Webview | `library` | `{ entries:[{id,title,pattern,deck,tags,thumb}] }`（ギャラリーを開く。thumb は webview URI か null） |

`version` は描画に使った `doc.version`。拡張側は現在の `doc.version` と違えば書き戻さない（「原稿が先に変わりました。もう一度」）。

### 2.4 スライド操作（slide-ops.cjs）

すべて `(text, index, …) → { edits:[…], revealLine }`。区切り `---` の前後の空行を保ち、marp のページ分割が壊れないこと（結果を `slideStartLines` で数え直して検算する）。

- `duplicateSlide` `deleteSlide` `moveSlide(text, index, ±1)` `insertSlideAfter(text, index, slideText)`
- `newSlideTemplates()`：空白／見出し＋箇条書き／split（左文・右図）／fig／message／divider の最小骨格。`theme/academic.css` にあるクラスだけを使う。
- `addBulletAfter(text, line, lineEnd)`：同じインデント・同じ記号（`-` `*` `+` `1.`）で次の行を作る。入れ子の子があれば lineEnd の位置に入れる。`removeBullet(text, line, lineEnd)`。
- 1枚目の前・最後の後・発表者ノート直後の `---` など境界条件をテストで固める。複製・挿入では `_lib` の印を落とす（同じ id が2つにならないように）。

## 3. 機能2：完成スライドの印と再利用

### 3.1 印（原稿に残す）

`_class` と同じディレクティブコメントに `_lib` キーを同居させる。Marpit は既知キーが1つでもあればコメント全体をディレクティブとして扱うので、ノートに入らず、HTML にも残らない（marp-core と marp-cli の両方で実測済み）。

```html
<!--
_class: summary
_lib: alc-agenda | 構成, アジェンダ | 2026-09-20
-->
```

- 値は `id | タグ(カンマ区切り) | 日付` の 1 行文字列（YAML の入れ子は使わない。Marpit の緩い YAML でも確実に通る形）。id は半角英数とハイフン、リポジトリ内で一意。
- `_class` の無いスライドに印を付けるときは `_class:` 行を足す。値は、グローバルな `class`（frontmatter か `<!-- class: … -->`）があればそれ、無ければ空文字。見た目が変わらないことをテストで確認する。
- 単独の `<!-- _lib: … -->` はノートに混入する。拡張は診断（Warning）を出す：「`_class` の行を消すと、この印が発表者ノートに出ます」。
- デック単位のメモは frontmatter の未知キー（無視される。実測済み）に置いてよいが、v0.2 では使わない。

### 3.2 台帳（生成物）

`slides/_library/index.json`：

```json
{ "generatedAt": "…", "entries": [ {
  "id": "alc-agenda", "tags": ["構成"], "markedAt": "2026-09-20",
  "deck": "slides/2026…/2026….md", "slide": 3, "title": "今回の構成", "pattern": "summary",
  "theme": "academic", "palette": { "accent": "#C8611C", "accentDark": "…", "accentSoft": "…", "sectionBg": "…" },
  "assets": ["./src/slido-qr.png"], "deckClasses": ["agenda", "agenda-row"], "cssBytes": 912,
  "thumb": "slides/_library/thumbs/alc-agenda.png"
} ] }
```

スライド本文は台帳に複製しない。挿入時に元デックの md から id で引き直す（常に最新）。

### 3.3 貼り付け先への適応（library-core.cjs `adaptSlide`）

入力：元デックの md・スライド本文・貼り付け先の md。出力：`{ slideText, destEdits, assetCopies:[{from,to}], warnings:[…] }`。

1. **ヘッダ・フッタ・テーマ色・ロゴ**：何もしない。frontmatter 由来なので貼り付け先に自動で従う（`_header` 等のローカル指定は全コーパスで 0 件）。
2. **素材**：`./src/…` を貼り付け先の `src/` へコピー。同名・同内容なら再利用、同名・別内容なら `-2` を付けて本文の参照も書き換える。`../assets/…` はデックの深さの差で相対パスを直す。
3. **デック固有 CSS**：スライドが使うクラス（class 属性と `_class`）のうち、テーマ（`theme/*.css`）に無く元デックの style（frontmatter `style:` と本文 `<style>`）で定義されているものを拾い、セレクタにそのクラスを含むルールを抜き出す。貼り付け先に同じ署名（正規化したセレクタ＋宣言）のルールがあれば省く。同名で中身が違うクラスが貼り付け先にあるとき（コーパスで 248 クラスが該当）は、そのスライド内の `<style scoped>` に入れる。衝突が無ければ貼り付け先 frontmatter の `style: |` の末尾に足す（無ければ作る）。`:root` は運ばない。
4. **色**：元デックの実効パレット 4 値（`--accent` `--accent-dark` `--accent-soft` `--section-bg`。frontmatter の `:root` 上書き → 無ければテーマ既定）と完全一致する hex を、本文・インライン SVG の属性・運ぶ CSS の中で `var(--accent, #元hex)` の形に置き換える（フォールバック付き。SVG 属性でも Chrome の PNG/PDF で効くことを実測済み）。元と先のパレットが同じなら何もしない。「元の色のまま」を選べること。意味としての赤（警告など）まで変わる恐れがあるので、置換した件数を warnings に出す。
5. **テーマ違い**：元と先の theme が違えば警告。貼り付け先テーマに無いクラスを列挙する（部品テーマ（非同梱） の部品を academic に貼ると素の div に崩れる。tsutawaru では縦に伸びて takeaway に被る＝実測）。
6. `_lib` の印は貼り付けたコピーから外し、代わりに `_from: <id>` を残す。

### 3.4 入口

- プレビューの ★（現在のスライドに印を付ける／外す。id とタグを入力）。
- コマンド／プレビューの 📚：台帳から選んで現在のスライドの次に挿入（QuickPick＋プレビュー内のサムネイル一覧）。
- ふつうのコピペ：`registerDocumentPasteEditProvider` がある VS Code でだけ、別デックから貼ったスライドに「貼り付け先に合わせて貼り付け」を出す（設定 `marpScrollSync.adaptivePaste` で切れる。既定 on）。
- CLI（Claude も使う）：`node tools/marp-library.mjs index|thumbs|list|candidates|insert <id> --into <md> --after <n>`。`npm run library` は index＋thumbs。

## 4. 機能3：コードの簡素化（原稿は変えない）

- **折りたたみ範囲**（FoldingRangeProvider）：スライド（区切り `---` の行から、次の `---` の前の行まで。1枚目は本文先頭行から）／frontmatter の `style: |` ブロック／複数行の `<style>`・`<svg>`・発表者ノート（複数行コメント）。Marp 公式拡張の範囲と開始行が同じなら VS Code が片方を捨てるだけで害はない。
- **既定で畳む**：設定 `marpScrollSync.autoFold`（既定 true）。Marp の md を開いたら、カーソルのあるスライド以外を畳む。カーソルやプレビューの選択が別のスライドへ移ったら、前のスライドを畳み、今のスライドを開く。開いたスライドの中でも `style`・`svg` は畳んだまま（設定 `marpScrollSync.autoFoldKinds`、既定 `["style","svg"]`、`"notes"` も指定可）。検索ウィジェット使用中・複数カーソル・選択範囲があるときは何もしない。ステータスバーとコマンド `marpScrollSync.toggleAutoFold` で切り替え。`editor.fold`/`editor.unfold` の `selectionLines` を使い、対象ドキュメントがアクティブなエディタのときだけ実行する。
- **スライドのラベル**：各スライドの先頭（区切り `---` の行）に装飾（after.contentText）で `  12 ｜ summary ｜ 今回の構成 ★` を出す。畳んでも何のスライドか分かる。
- **パネルのラベル**：`<div class="left">` などの行末に薄い装飾で `◀ 左パネル`。クラス名→日本語の辞書（left/right、split-body、sections/sec-box、cols、cardrow/pcard、qa-grid、takeaway、page-title、fig-area、box-*、callout-*、stepbox、flowrow/fbox、cover-hero 系）。sec-box や pcard は中の見出し文も添える。原稿には何も書かない。
- **ラベルを原稿に残したいとき**：コマンド `marpScrollSync.writePanelLabels` が、開始タグと **同じ行** に `<!-- 左パネル -->` を書く。単独行のコメントはノートに混入するので書かない（実測）。
- **診断**：ノートに混入する位置にある「ラベル風の短いコメント」（句読点なし・20字以内・1行）と `#region` に Information を出す。

## 5. 既存機能への小変更

- tune のスウォッチ「赤（テーマ）」「濃赤」は `var(--accent)` / `var(--accent-dark)` を書く（貼り付け先の色に追従する）。`input[type=color]` へは hex のときだけ反映する。
- `.ss-tune` は持ち出し先でも未定義クラスとして残るだけで害はない（style 属性で完結している）。

## 6. 実装で確定した点（2026-09-20。上の取り決めからの差分）

実装と独立レビューで、取り決めを次のように具体化・変更した。食い違うときはこの節が正。

- **slide-ops の戻り値**は `{ ok, edits, revealLine, reason? }`（`addBulletAfter` は `newLine` も）。失敗時は `ok:false`・`edits:[]`・`reason`（そのままトーストに出せる日本語）。番号付きリストでは後続の番号を振り直すので `edits` が複数件になる。全操作は結果を `slideStartLines` で数え直し、期待枚数と違えば書かせない。原稿に `***` `___` `- - -`・字下げした `---`・`headingDivider`・「見出し/箇条書き/表の直後に空行なしの `---`」があるとき（`slide-split.cjs` の枚数が marp とずれる書き方。コーパス 171 本では 0 件）は、スライド操作を断って該当行へ案内する。
- **`data-hline` はそのタグ自身の行**（`data-hline-end` は html_block の終わり）。`fence` / `code_block` にも `data-line` を付ける。
- **`planTextEdit` の失敗理由**：`no-node` `not-located` `bad-change` `stale` `newline` `ambiguous` `autolink` `code-highlight` `code-delimiter` `maybe-code` `emphasis-boundary` `unknown-context` `emoji-shortcode` `line-head` `entity-boundary` `setext` `hard-break`。どれも「書かずに該当行へ案内」。文言は `extension.js` の `REASON_TEXT`。`space-boundary` を追加。
- 「前後の空白は 1 バイトも変えない」の例外は 2 つ：直前の `&` を `&amp;` に書き直すとき、直前の `\` の直後に ASCII 記号が来るとき（書かないと表示が入力と食い違う）。
- **`ssCollectTextNodes` の除外**に数式の出力（`.katex` / `mjx-container`）を追加（式の中の文字が本文の同じ文字に当たり、誤って本文を書き換えるのを実測）。
- **空の li に初めて打った文字**は `changes:[{k:null, old:'', now}]`＋`emptyTarget:true`＋`line/lineEnd` で送り、拡張は `planEmptyFill`（その行が記号だけのときに限り行末へ足す）に通す。
- **新しくできたテキストノード**は「要素を挟まずに隣り合う直前（無ければ直後）のノードへの追記」。`<strong>` などを飛び越えない（原稿では太字の反対側に書かれるため）。`changes` の対応づけは、ノード数と親タグの並びが開始時と同じなら並び順、違えばノードの同一性。
- **`render` の `expect.text` が空**（全部消した編集）のときは検算しない。
- **取り消し**：プレビューにフォーカスがあると Cmd+Z が原稿に届かないので、`undo` / `redo` メッセージを拡張へ送り、原稿側で実行してフォーカスを戻す。
- **1操作＝1 WorkspaceEdit** は、編集後の全文との最小差分 1 置換で実現する（`extension.js` の `replaceMinimal`。文字の編集＋箇条書きの追加のように 2 段の操作も 1 回の Cmd+Z で戻る。サロゲートペアと CRLF の途中では切らない）。
- **印**：`_class` の無いスライドに印を付けるとき、グローバル class があればその値を `_class` に写す。`findLeakyMarks` は `reason:'alone'|'yaml'` を返す。id に半角英数・ハイフン・アンダースコア以外を含む印は台帳に載せない（id がサムネイルのファイル名になるため）。
- **色の置換の対象**は、開始タグの中（属性値）と `<style>` の中身、運ぶ CSS だけ。地の文や見出しに書かれた色コードは変えない（`var(…)` がそのまま表示されてしまうため）。
- **テーマ部品を上書きするデック側のルールは運ばない**。`@keyframes` は同梱する。`library` メッセージには挿入位置 `index` が付く。
- **折りたたみ**：スライドの範囲は末尾の空行も含む（畳むと `---` が隙間なく並ぶ）。キーボードで次のスライドの区切り行に乗っただけでは前を畳まず、本文へ入った時点で畳む（↑ で戻れなくなるのを防ぐ）。「畳めたか」は `visibleRanges` が 2 つ以上に分かれたかで判定する。`register()` は例外を外へ出さない。
- **version の照合は `undo` / `redo` 以外の全メッセージ**（`slideOp`・`libraryInsert` も）。Webview の index は「表示している描画」のものなので、原稿が先に変わっていたら断る（再描画の保留中に別のスライドを消さない）。例外は 1 つ：編集中に操作ボタンを押すと `editCommit` と `slideOp` が同じ版番号で続けて届くので、直前の自分の文字の書き戻し（枚数が変わらないもの）の 1 つ前の版に限り `slideOp` / `libraryInsert` を受ける（`extension.js` の `staleForSlideOp`）。コマンド経由（version なし）は今の原稿のカーソルから index を求めるので照合しない。
- **再描画のタイミング**：`replaceMinimal` は書く直前に保留中の再描画タイマー（150ms。8.4）を消す（直後に即時の再描画が来る。書けなかったら張り直す）。`pendingExpect` / `pendingStartEdit` は `minVersion`（書き戻し後の版）を持ち、それ未満の描画には付けない。即時再描画のフラグ（`renderImmediate`）は、対象がプレビュー中の原稿のときだけ立てる。
- **書くものが無い `editCommit`**（前後の空白だけ変えた等）は、表示を原稿どおりに描き直す（打った空白を表示に残さない）。`changes` にノードを空にするものが混じるときは、番号がずれるので `expect` を付けない。
- **端の空白の外側に打った文字**（リンクや太字の直後で打つと、次のテキストノードの先頭の空白より前に入る）：`source-map.cjs` の `planEdgeEdit` が、原稿の同じ位置に同じ空白（半角空白・タブ）を確かめたうえで、空白の外側へ挿入する。強調記号（`* _ ~`）の隣は `emphasis-boundary`、裸の URL の隣は `autolink`、コードの中・行頭/行末・直前が `\` は `space-boundary` で断る。文字を消した・置き換えた編集は従来どおり trim 済みどうしで比べる。
- **`ensureEditor`**：原稿のタブが無いとき、プレビューが列 1 にいれば `ViewColumn.Beside`、それ以外は列 1 に開く（プレビューの上に重ねない）。
- **`lib/slide-split.cjs` は本体の一部**（トップレベルの素の require）。0 の「どのモジュールが落ちても本体は動く」の対象外。スライド分割の正本を 2 か所に持たないための判断で、配布時はこのファイルを必ず同梱する。
- **台帳は未保存の内容も見る**：`buildIndex(repoRoot, { textOf })`。拡張は開いている文書の内容を渡すので、印を付けた直後（保存前）でもギャラリーと挿入の対象になる（サムネイルは無い）。CLI はディスクの原稿だけ。
- **素材の判定**：`#` と `%23` で始まる参照は素材ではない（data URI の中の `fill='url(%23g)'`）。
- **CLI**：オプションはコマンドの前後どちらでもよい。`--root` 省略時は、今いるフォルダに `theme/` と `slides/` があればそこ、無ければスクリプトのあるリポジトリ（`tools/` を symlink した写しで実リポジトリに書かないため。対象を stderr に 1 行出す）。`thumbs` は重複 id を理由つきで飛ばす。`mark` は id を直したとき・既存の印の id を変えたときに知らせる。
- **コマンドの追加**：`newSlide` `duplicateSlide` `moveSlideUp` `moveSlideDown` `deleteSlide`（カーソルのあるスライドが対象。プレビューを開いていなくても使える）。

- **frontmatter の調整つまみは畳まない**（2026-09-20 追加）：`style:` が `:root { … }` で始まるとき（ヘッダー幅・行長のつまみ。よく触る）、その閉じ `}` までは見せたままにし、後ろに続くデック固有 CSS だけを `frontmatter-style` として自動で畳む。`style:` 全体は `frontmatter-style-all` として範囲だけ出す（手で畳める。自動では畳まない）。`:root` が先頭に無いデックは従来どおり丸ごと畳む。

- **書き戻したらすぐ保存する**（2026-09-26 追加。利用者の要望：プレビューで直した分を保存し忘れ、Claude Code が同じ原稿を書き換えてぶつかる）：この拡張が原稿に書いた直後に `doc.save()` を呼ぶ（`extension.js` の `saveAfterWrite`。設定 `marpScrollSync.saveAfterEdit`、既定 on）。呼ぶ場所は `replaceMinimal` の applyEdit 成功後（直接編集・箱・箇条書きの削除・スライド操作・配置案・コーパス挿入がここを通る）、サイズ/色の `<span>`、プレビューからの undo/redo の後、`library-vscode` の印と挿入、`folding-vscode` の区画ラベル。書けなかった・書くものが無かったときは呼ばない。保存の失敗（ディスクの方が新しい等）は書き戻しの成否に混ぜず、ログに出すだけ。無題の文書と `save` の無い文書（試験の stub）は触らない。原稿のタブで打った文字は対象外（VS Code 標準の `files.autoSave` の領分）。貼り付け適応（`DocumentPasteEdit.additionalEdit`）は VS Code が適用するので保存しない（エディタ側の操作なので利用者が保存する）。

### 未解決・実機でしか確かめられないこと

- VS Code 実機での確認：日本語 IME（変換確定の Enter と編集確定の Enter）、ダブルクリックの間隔が 250ms より長い場合、初回の自動折りたたみのタイミング、見出し範囲（VS Code 標準）との重なり、貼り付け適応（独自 MIME が運ばれるか）。
- テーマが違う先へ挿入したときの縦伸び（部品テーマ（非同梱） → tsutawaru で takeaway に接する）は警告だけで、自動では直さない。挿入後は必ず PNG で目視する。
- 色の追従は元パレット 4 値と完全一致する hex だけ。既定の赤 `#A6192E` を意味色として直書きした箇所は、配色の違う先でも赤のまま残る。
- `<div>直下の文字<ul>…</ul></div>` の「直下の文字」を編集すると、div 全体が編集可能になり子の li にもキャレットが入る。
- `slide-split.cjs` が marp と食い違う書き方（上記の区切り記法、行の途中から始まる複数行コメント直後の `---`、4 連バッククォートのフェンス、`headingDivider`）。コーパスでは 0 件。

## 7. 既存スライドの検索と再利用（コーパス）— 2026-09-20 追加

利用者の要望：プレビューのスライドの間に ＋ を置き、**既存の全スライド**から検索して（★ だけでなく「自己紹介」「生成AIの重み」など）、丸ごと入れたい。git の変更履歴で自分がよく手を入れたスライドは使える資産なので、見つけやすくしたい。作り込んだ旧デック（academic / 部品テーマ（非同梱））のスライドを、新しいテーマ（tsutawaru-academic）で使い回したい。

### 7.1 索引（lib/corpus-core.cjs。純粋＋fs＋git 呼び出し。vscode 非依存）

- `buildCorpus(repoRoot, { withChurn=true, cache=null, textOf=null, git=null, onProgress=null }) → { version, generatedAt, head, withChurn, decks:{[deck]:{mtimeMs,size,churn}}, entries[], warnings[] }`（書き込みはしない）
  - 対象：`slides/` 配下の `marp: true` の md（`_library`・`out`・`node_modules`・`.bak`・`work/`・`old/`・`orig/`・`parts/` は除く。`parts/` は作者の手元のデック群で 14 枚中 10 枚が本体と重複していたため）。スライド分割は `slide-split.cjs`。
  - `withChurn:false` でも、md が変わっていないデックは `cache` の churn を引き継ぐ（そのデックの全 entry に churn があり、`decks[deck].churn` が true のとき）。`churn.last` は日付のほか `'worktree'`（未コミットの手直し）か空文字。
  - `cache`（前回の戻り値）を渡すと、md の `mtimeMs+size` が同じデックは再計算しない。churn は `head`（git の HEAD）も同じときだけ再利用。
  - `textOf(abs)` は未保存の原稿を差し込む口（library-core の buildIndex と同じ流儀）。
- entry：
  ```js
  { key: 'slides/…/x.md#12', deck: 'slides/…/x.md', deckName: '20260101_Event_…', slide: 12 /* 1始まり */,
    title, pattern /* _class */, theme, date: '2026-06-23'|null /* ディレクトリ名から */,
    text /* タグ・記号・ノートを除いた本文。600字まで */, chars, hasSvg, hasImg, hasVideo, assets /* ./src 参照の数 */,
    deckClasses /* デック固有クラスの数 */, mark: {id,tags}|null, from: id|null, tune /* ss-tune の数 */,
    churn: { touched, lines, last }|null, group: 'A'|'B'|null, converted: boolean /* pptx 変換のまま */,
    score, dupOf: key|null, dupCount }
  ```
  - `churn`：tools/marp-library.mjs の `churnOf`（版ごとにスライドを題名＋類似度で対応付け、内容が変わった版の数 touched と変更行数 lines を数える）を移設して使う。
  - `score`（手を入れた度合い。式はコードのコメントに明記し、テストで固定する）：★ > touched > lines > tune > group A/B、`converted` は減点、新しいデックに小さな加点。
  - 重複のまとめ：正規化した題名が同じで本文の文字 4-gram Jaccard ≥ 0.7 のものを同じ束にし、score が最大（同点なら新しい）を代表にする。他は `dupOf` に代表の key。代表の `dupCount` に束の大きさ。
- `searchCorpus(corpus, query, { onlyMarked, sort:'relevance'|'score'|'recent', theme, excludeDeck, dedupe=true, offset=0, limit=24, shelf /* resolveShelf の戻り値 */ }) → { total, items:[{ entry, snippet, titleHit, dupCount, shelf:{name,label}|null }] }`
  - 棚のスライドは先頭に出す（語が空で並びの指定が無ければ棚の並び順）。棚どうしは重複としてまとめない。関連度には score を 1.0 倍で足す（題名の一致どうしの中で、添削済みを上に、変換のままを下に。題名に当たらないものが、当たったものを越えることはない）。
  - 索引を読んだ直後の最初の検索だけ、正規化の cache を作るので約 30ms かかる。拡張は索引を作った直後に空の検索を 1 回呼んで温める。
  - query は空白区切りの AND。NFKC・小文字化した題名・本文・タグ・デック名・型に対する部分一致（日本語なので分かち書きはしない）。題名の一致を重く見る。query が空なら score 順。
- `corpusPath(repoRoot)` = `slides/_library/corpus.json`（生成物。`.gitignore` に入れる）。`readCorpus` / `writeCorpus`。
- CLI（tools/marp-library.mjs）：`corpus [--no-churn]`（索引を作り直す）、`search <語…> [--marked] [--sort score|recent] [--theme x] [--top N] [--json]`。`search --no-shelf`（棚を先頭に出さない）。挿入は既存の `insert --from <md> --slide <n> --into <md> --after <n>`（`--keep-typo` は未対応）。`npm run library` は index＋thumbs＋corpus、`npm run corpus` は corpus だけ。
- 実測（165 デック・4,070 枚）：churn 抜き・cache なし 0.4〜0.5 秒、cache あり 約 0.12 秒、churn つき 約 6.4 秒、検索 1 回 5ms 以下。

### 7.2 テーマをまたぐ挿入（lib/library-core.cjs の adaptSlide）と、はみ出し検知（media/overflow.js）

- `window.ssDetectOverflow(section) → { overflow, bottomPx /* 本文が下へはみ出た量。0 以下なら収まっている */, padPx, hitsTakeaway, hitsHeader, hitsSibling /* 隣のブロックへの食い込み。overflow の条件に入る */, pending /* img の load 後に測り直す */, unknown /* 測れない。overflow は必ず false */ }`
  - `hitsSibling` は、display が block/flex/grid/list-item/flow-root の入れ物の直下のブロックどうしだけを見る（表の中・行内・float・インライン SVG は見ない）。`overflowReport` の形は変えていない。
  - section は 1280×720 の座標系で測る（表示の縮小率で割る）。`position:absolute|fixed` の要素・header・footer・ページ番号は「本文」に数えない。`.takeaway`（下端固定）と本文の重なり、ヘッダー帯への食い込みも見る。
  - テスト（puppeteer）とプレビューで同じ物を使う。
- `adaptSlide({ …, keepTypo })`：`keepTypo:true` のとき、元テーマの組版（本文サイズ・行間・行長・箇条書きの間隔など、はみ出しの原因になる差）をそのスライドの `<style scoped>` で持ち込む。何を持ち込むかは実測で決める（作り込んだスライド 12 枚以上を tsutawaru / 部品テーマ（非同梱） の新規デックへ入れ、`ssDetectOverflow` と PNG 目視で、持ち込み前後を比べる）。成り立たないテーマの組み合わせでは何もせず warnings に理由を書く。ヘッダ・フッタ・配色は貼り付け先のまま。
  - 確定した形：持ち込む塊は `<style scoped>` 内の `/* ss-keep-typo:start <元テーマ> → <先テーマ> … */ 〜 /* ss-keep-typo:end */`（消せば貼り付け先の組版に戻る）。`info.keepTypo` に持ち込んだ行数。スライドの題（クラスの付かない h1/h2）は「貼り付け先の枠」として扱い、戻さない（`section.message h1` など型つきの題は本文扱い）。Marp 同梱 default テーマの値（見出しの line-height 1.25、li+li の margin-top .25em）は library-core.cjs に定数で持つ。
  - 「収まりやすい」の勧め（warnings の `元の組版を保つ…収まりやすい`）は academic → tsutawaru-academic だけ。部品テーマ（非同梱） → tsutawaru-academic は改善するが収まり切らない（実測）。
- 既存の警告（テーマ違い）には、はみ出しの実測結果を足せるよう、拡張側が挿入後にプレビューの検知結果を受け取る（7.3）。

### 7.3 プレビュー（media/preview.js / preview.css）

- **＋ボタン**：各スライドの間（と、1枚目の上・最後の下）に `.ss-insert`。見せ方と開く物は 8.1 が正（マウスを乗せたときだけ・小さなポップアップ）。1枚目の上は index −1。📚 ボタンは `slideOp 'library'` を送り、拡張が `gallery` を返して全面ギャラリーを開く（挿入位置 = 現在のスライドの次）。検索の部品が読めないときは、従来の ★ ギャラリー（`library` メッセージ）に退避する。
- **検索ギャラリー**：検索欄（250ms デバウンス）、絞り込み `★ 完成だけ`、並び `関連順 / 手を入れた順 / 新しい順`。カード＝その場で描いたサムネイル（Shadow DOM の中に `<style>デックの css</style><div class="marpit">スライドの svg</div>`。Marpit は `:root` を `section` に書き換えるので Shadow DOM の中でも配色が効く）、題名、デック名と日付、バッジ（★／添削 n 回／同じ内容が他 n 件／テーマ違い）。カードのクリックで選択（複数可）、ダブルクリックで即挿入、「原稿を開く」。下部バー：`n 枚を選択中［ここに挿入］ ☐ 元の色のまま ☐ 元の組版を保つ`。「もっと見る」で次の 24 件。Esc・背景クリックで閉じる。
- **はみ出しバッジ**：描画のたびに全スライドへ `ssDetectOverflow` を回し（requestIdleCallback で分割）、はみ出したスライドの枠の上に `⚠ はみ出し`。結果が変わったら `overflowReport` を送る。

### 7.4 メッセージ

| 方向 | type | 中身 |
|---|---|---|
| →拡張 | `corpusSearch` | `{ reqId, query, onlyMarked, sort, offset, limit, haveCss:[cssKey…] }` |
| →Webview | `corpusResults` | `{ reqId, total, offset, building /* 索引を作成中か */, items:[{ key, deck, deckName, slide, title, pattern, theme, date, marked, touched, tune, dupCount, snippet, sameTheme, cssKey, html }], css:{ [cssKey]: string } /* haveCss に無い分だけ */ }` |
| →拡張 | `corpusInsert` | `{ items:[{ deck, slide }], index /* この次に入れる。−1＝先頭 */, version, keepColors, keepTypo }` |
| →拡張 | `openSource` | `{ deck, slide }`（その原稿をエディタで開き、該当スライドへ） |
| →拡張 | `overflowReport` | `{ version, slides:[{ index, bottomPx, hitsTakeaway, hitsHeader }] }`（はみ出したものだけ） |
| →Webview | `gallery` | `{ index, query?, onlyMarked? }`（全面ギャラリーを開く。既存の `library` メッセージの後継。`library` は互換のため残す） |
| →Webview | `insertPopup` | `{ index? }`（＋ポップアップを開く。省略＝現在のスライドの次。コマンド `searchSlides` から） |
| →拡張 | `corpusPrefetch` | `{ kind:'shelf', reqId, limit:9, haveCss }`（プレビューを開いた直後のアイドル時間に 1 回）。応答は `shelfState`＋同じ reqId の `corpusResults`（query 空・手を入れた順）。片方だけ・無応答でも Webview は動く |
| →拡張 | `shelfEdit` | add:`{op,shelf,label,deck,slide,title,id\|null}` / rename:`{op,shelf,at,label}` / move:`{op,shelf,from,to}` / remove:`{op,shelf,at,label}` / renameShelf:`{op,shelf,name}` / moveShelf:`{op,from,to}`（`shelf` は棚名、`at/from/to` は 0 始まり） |
| →Webview | `shelfState` | `{ ok, message?, shelves:[{ name, items:[{ label, how /* 'id'\|'title'\|'slide' */, missing?, …corpusResults の item と同じ項目 }] }], css }`。`ok:false` で `shelves` があればそれを正とする（無ければ Webview が直前の姿へ戻す） |
| →拡張 | `layoutApply` | `{ index, version, cls\|null }`（8.3） |
| →Webview | `patch` | `{ version, slides:[{ index, html /* svg 1 個 */ }], marks, expect? }`（8.4） |
| →拡張 | `needRender` | `{ version }`（当てられない patch を受けた Webview が、全体の描き直しを頼む） |

`corpusResults` の item には、上の表の項目に加えて `id`（★ の id。無ければ null）と `shelf:{name,label}|null` が付く。失敗時は `items:[]` と `error`。

- `corpusInsert` は複数枚でも **1 つの WorkspaceEdit**（Cmd+Z 1回）。`adaptSlide` を貼り付け先の途中経過のテキスト（`destText`）に順に当て、最後に最小差分の 1 置換にする。素材のコピーは従来どおり。警告はまとめて出す。
- `corpusInsert` の細目（lib/corpus-vscode.cjs の `insert`）：`index` は枚数の範囲に丸める。自分自身のデックから入れるときは「操作の前の原稿」を元にする。リポジトリの外の deck は断る。結果の枚数が「入れた数だけ」増えていなければ書かない。素材は先にコピーし、書けなかったら今回コピーした分だけ消す。version の照合は `slideOp` と同じ（6章 `staleForSlideOp`）。
- `overflowReport`：直前の `corpusInsert` の後（原稿の版がそのまま）の報告に、入れたスライドが含まれていたら、1 回だけ `editResult { ok:true, message:'スライド n が ◯px はみ出しています（元の組版を保つ で入れ直すか、右クリックで別の配置を試せます）' }` を返す（keepTypo で入れた後は後半だけ）。
- 索引（lib/corpus-vscode.cjs）：メモリに持つ。初回は corpus.json を土台（cache）にして churn 抜きでその場で作り（実測 0.4〜0.5 秒。プレビューを開いた 1.2 秒後か、最初の `corpusPrefetch` のどちらか早い方）、直後に空の検索で温める。corpus.json が無い・churn 抜き・HEAD が違うときは、裏で `node tools/marp-library.mjs corpus --root <repo>` を子プロセスで 1 本だけ走らせる（`process.execPath`＋`ELECTRON_RUN_AS_NODE=1`。実測 約 6 秒。走っている間は `building:true`）。終わったら読み直す。以後は「md を触った（保存・変更イベント）」か 60 秒より古いときに、**応答の後で** cache つきで作り直す（約 0.12 秒。検索の応答は待たせない）。
- サムネイル：デックごとに marp-core で 1 回描いてスライドの svg 単位に切り（`<script>` は除く）、md の mtime（開いている原稿は文書の版）をキーに LRU 40 デック。素材の参照は webview URI に直す（`localResourceRoots` にリポジトリ直下が入っているので他デックの素材も読める）。css は cssKey（`deck@キー`）ごとに 1 回だけ送る（`haveCss` に無い分）。1 回の応答でサムネイルの描画に使うのは 90ms まで。超えた分のデックは `html:''` で先に返し、裏で描いてから**同じ reqId でもう一度** `corpusResults` を送る（offset 0 のときだけ。Webview は reqId が古ければ捨てる）。
- 棚：`shelf.json` の mtime＋size が変わっていたら読み直す（外での書き換え）。壊れたファイルには書かない（`shelfState ok:false`）。`remove` は位置と呼び名が食い違うとき、呼び名で探し直す（別の項目を消さない）。

## 8. 追加の取り決め（2026-09-20 の追加要望。7章と食い違うときはこちらが正）

### 8.0 速さの予算（最優先の非機能要件）

**操作してから表示が変わるまで 0.4 秒を超えない**（ポップアップの提示でも、プレビュー上の編集でも）。実測：marp-core の描画は 80 枚のデックで 30〜50ms（Marp インスタンスを使い回すと 30ms 台）。遅さの原因は描画ではなく、(a) Webview がデック全体（80 枚で 1.4MB）を innerHTML で差し替えること、(b) エディタ入力の 700ms デバウンス、(c) サムネイル用の CSS（1 デック約 100KB）をカードごとに解析すること。対策：

- **変わったスライドだけ差し替える**（8.4）。Marp インスタンスとテーマは使い回す（theme/*.css の mtime が変わったら作り直す）。
- サムネイルの CSS は `CSSStyleSheet`＋`adoptedStyleSheets` でデックごとに 1 回だけ解析し、同じデックのカードで共有する。
- ポップアップは **まず骨組み（題名だけのカード）を同期的に出し**、サムネイルは後から埋める。棚（8.2）のスライドは、プレビューを開いたあとのアイドル時間に先読みしておく。
- テスト（puppeteer）で時間を測り、予算を超えたら失敗にする：＋ポップアップの初回表示、配置案ポップアップの表示、1 枚だけ変わったときの差し替え。値は実測して README に載せる。

### 8.1 ＋ボタンと挿入ポップアップ

- ＋ボタンは **スライドとスライドの間にマウスを乗せたときだけ** 現れる（1 枚目の上・最後の下も同じ）。常時は見せない。キーボードでは、スライドを選んで `+`（または `i`）で同じポップアップを開ける。
- クリックすると、その場に **小さなポップアップ**（全面ギャラリーではない）が開く。中身：検索欄、棚（8.2。名前つきのサムネイルを 3 列・最大 9 枚）、その下に「手を入れた順」の上位。検索欄に打つと結果に置き換わる。サムネイルのクリックで即挿入、Shift+クリックで複数選択して「ここに挿入」。右上の「もっと探す」で 7.3 の全面ギャラリー。Esc・外側クリックで閉じる。

### 8.2 棚：名前と並び順を自分で決める（slides/_library/shelf.json。git で追跡する）

自己紹介のように同じ用途のスライドが何枚もあるとき、「自己紹介 学外用」「自己紹介 3枚構成の1枚目」のような **呼び名** と **並び順** を利用者が自分で付けられるようにする。

```json
{ "version": 1, "shelves": [ { "name": "自己紹介", "items": [
    { "label": "自己紹介 学外用", "deck": "slides/…/x.md", "id": "self-intro-ext", "slide": 2, "title": "自己紹介" } ] } ] }
```

- 参照の解決順：`id`（★ の印）→ 同じデックで題名が一致するスライド → `slide` 番号。見つからなければ「行方不明」として棚に残し、消さない。★ を強制しない（名前を付けるだけなら元デックを書き換えない）。
- lib/corpus-core.cjs：`readShelf(repoRoot)`（列挙されない `warnings[]`・`exists`・`broken` を持つ。壊れたファイルは空の棚で `broken:true`）、`writeShelf(repoRoot, shelf) → { ok, path, reason? }`（例外を投げない。今あるファイルが壊れていれば書かない。2 スペース字下げ・末尾改行。一時ファイルに書いて置き換える）、`resolveShelf(shelf, corpus) → [{ name, items:[{ label, entry|null, how:'id'|'title'|'slide'|null, ref }] }]`（`how:'slide'` は番号だけで当てた＝題名が変わっている）。編集関数は `{ ok, shelf, reason?, existed? }` を返す（index は 0 始まり。`shelfAdd` は同じスライドが既にあれば呼び名だけ直して `existed:true`。`shelfRemove` で項目を省くと空の棚だけを消す）。編集関数は純粋で、 `shelfAdd / shelfRename / shelfMove / shelfRemove / shelfRenameShelf / shelfMoveShelf`。検索は label と棚名にも当たり、棚のスライドを先頭に出す。
- UI：カードの「名前を付ける…」（呼び名と棚を選ぶ・新しい棚も作れる）。ポップアップと全面ギャラリーの棚の中は、ドラッグか Alt+←→ で並べ替え、呼び名はダブルクリックで直す。メッセージ：`shelfEdit { op:'add'|'rename'|'move'|'remove'|'renameShelf'|'moveShelf', … }` → 拡張が shelf.json を書き、`shelfState { shelves }` を返す。
- UI の確定：選択中（Shift+クリックで 1 枚以上選んだあと）は、Shift なしのクリックも選択の切り替え。棚のカードでは、呼び名の上のクリックは挿入にしない（ダブルクリックで改名するため。サムネイルのクリックで挿入）。
- CLI：`shelf list` / `shelf add <md> <番号> --shelf 自己紹介 --label "自己紹介 学外用"` / `shelf move …`（項目を省くと棚そのものの並び順）/ `shelf remove …` / `shelf rename --name`（棚の名前）。CLI の番号は 1 始まり。Claude が新規デックを作るときも、まず棚を見る。

### 8.3 配置案：右クリックで「別の配置にしたらどう見えるか」を並べる

パターンごとにコードを書き分けない。**同じ Markdown のまま、`_class` に 1 語足すだけで配置が変わる CSS**（配置クラス `lay-*`）を `theme/tsutawaru-academic.css` の §14 に用意する。根拠は『伝わるデザインの基本』（docs/tsutawaru-rules.md・docs/tsutawaru-guide.md）。

- 対象は「素の構造」のスライド：section の直下が h1/h2、ul/ol、p、img/figure/インライン svg、`.page-title`、`.takeaway`、`.note` などだけ（レイアウト用の div で包んでいない）。包んであるスライドでは、使える配置案は出さず、その旨を 1 行で示す。
- 配置クラスの例（実装担当が本の規則と実測で決める。8〜12 個。どれも既存デックで未使用の名前にする）：`lay-list`（見出し＋説明の箇条書き＝既定）／`lay-boxed`（項目を塗りで囲む）／`lay-cards2`（2×2）／`lay-cards3`（3 列）／`lay-keyrow`（上罫だけの 3 列）／`lay-flow`（左→右の箱と矢印）／`lay-steps`（番号つきの縦の手順）／`lay-fig-right`・`lay-fig-left`（図と文の 2 カラム）／`lay-fig-top`（図を上に大きく）／`lay-lead`（1 文を大きく）。2026-09-26 追加：`lay-points`（要点だけ 2〜5 行を 34px で縦の中央に。`headBreak:false`＝見出し＋説明の形でない項目だけ）／`lay-fig-only`（図 1 枚だけを中央に。`text:false`＝文が無いときだけ）。試験の EXTRA スライドの番号は見本デックの枚数 N からの相対で書く。
- lib/layout-variants.cjs（純粋）：`analyzeSlide(slideText) → { plain:boolean, items, hasStrongHead, hasFigure, hasTable, … }`、`variantsFor(analysis) → [{ cls, label, why /* 本のどの規則か */ }]`（項目が 3 つなら cards3・keyrow、4 つなら cards2、図があれば fig-*、のように絞る。**1 枚で見比べるのは 3 つまで** の規則に反する案は出さない）、`planSetLayout(text, index, cls|null) → { ok, edits }`（`_class` の `lay-*` を差し替える。★ の印やほかのクラスは保つ。`_class` が無ければ足す）。
- media/layouts.js（ブラウザ側）：スライドの右クリック（と、操作ボタン列の「配置」ボタン）で、**いまのスライドの DOM を複製してクラスだけ差し替えた小さなサムネイル** を並べたポップアップを出す。再描画も拡張との往復も要らないので一瞬で出る。各案に `ssDetectOverflow` を当て、はみ出す案には ⚠ を付ける（選べるが勧めない）。クリックで `layoutApply { index, version, cls }` → 拡張が `planSetLayout` で書き戻す（Cmd+Z 1回）。ホバーで大きなプレビュー（現在のスライドの枠に一時的に反映。離すと戻る）。
- preview.js は `window.ssPreview = { slides(), sectionOf(svg), current(), version(), post(msg), toast(message, isError?), isEditing(), onRender(fn({kind:'render'|'patch', indices})) → 登録を外す関数, closePopups() }` を公開し、layouts.js はこれだけに頼る（`current / version / isEditing` は関数）。`closePopups()` は window に CustomEvent `ss-close-popups` も出すので、ほかの部品はこれを聞いて自分のポップアップを閉じる。
- 確定した形：配置クラスは 10 個（`lay-list` は作らず、ポップアップの先頭に「標準（cls:null＝lay-* を外す）」を出す）。`variantsFor → [{ cls, label, why, group, current, fits }]`（いま付いている lay-* は条件に合わなくても `fits:false` で残す）。`planSetLayout → { ok, edits(0〜1件), revealLine, reason? }`（YAML 配列の `_class` は断る）。判定の表は `browserTable()` を拡張が `window.__SS_LAYOUTS__` として埋め込み、条件の解き方 `matches()` は layout-variants.cjs と layouts.js の 2 か所にある（Webview は eval 不可。見本デック全枚で一致をテスト）。`window.ssLayouts = { open(index?, x?, y?), close(), analyze, variants, lastMs, lastCheckMs }`。操作ボタン列の「配置」ボタンはまだ無い（右クリックだけ）。
- 拡張の配線：`buildHtml` は `textnodes.js → overflow.js → preview.js → __SS_LAYOUTS__ → layouts.js` の順に埋め込む。overflow.js・layouts.js・layouts.css・layout-variants.cjs は任意の部品で、読めなければ黙って外す（`</script` `</style` は `<\/` に直して埋める）。`layoutApply` は editChain に載せ、version の照合は `slideOp` と同じ。`planSetLayout` の結果で枚数が変わるときは書かない。`!ok` は reason をトーストに出して `revealLine` へ案内。コマンド `marpScrollSync.changeLayout` は、カーソルのあるスライドの `variantsFor` を QuickPick で出す（プレビューが無くても使える）。

### 8.4 変わったスライドだけ差し替える

- 拡張：描画した html をスライド（`<svg data-marpit-svg …>…</svg>`）単位に切り、前回送った内容と文字列で比べる。枚数と css が同じなら `patch { version, slides:[{ index, html }], marks, expect? }` を送り、違えば従来の `render`。原稿側の入力のデバウンスは 700ms → 150ms（patch が軽いので）。
  - 確定した形（extension.js）：`lastSent { uri, css, head, tail, slides[] }` と比べ、uri・css・スライドの外側（head / tail）・枚数が同じときだけ patch。変わったスライドが 0 枚でも、版と印を伝えるために空の patch を送る。描画に失敗したとき・パネルを閉じたとき・`needRender` を受けたときは `lastSent` を捨てて render。
  - **`<style scoped>` の目印（`data-marpit-scope-XXXXXXXX`）は描くたびに乱数で変わる**（実測。そのままだと scoped のあるデックは毎回 css が違い、patch にならない）。プレビュー用の描画では、出てきた順の連番（`…-ss0` `…-ss1`）に html と css の両方で付け替える（`stableScopes`）。
  - プレビューで文字を直した直後（`editCommit`）は、そのスライドを次の patch に必ず含める（`forceSlides`。html が前回と同じでも、表示には打った文字が残っているため）。
  - Marp とテーマは `marpCache { deck, thumb }` で使い回す（キーは repoRoot＋theme/*.css の mtime。deck は行番号つき、thumb は行番号なし）。描画が例外を出したら deck 側を捨てて次回作り直す。
  - 実測（80 枚・html 1.7MB）：入力から patch の送信まで 約 215ms（デバウンス 150ms＋描画と比較 約 60ms）。送る量は 1.6MB → 約 15KB。
- Webview：`patch` で該当の svg だけ差し替える（スクロール位置・選択中のスライド・ほかのスライドの画像や動画の状態を保つ）。編集中の保留（pendingRender）・`expect` の検算・はみ出し検知・＋ボタンの再配置は `render` と同じ扱い。

### 8.5 拡張側の部品（lib/corpus-vscode.cjs）

`register(context, api) → { search(doc,m), prefetch(doc,m), insert(doc,m) → {ok,message}, openSource(doc,m), shelfEdit(doc,m), onOverflow(doc,m), openPopup(index,{full}), rebuild(doc), invalidate(), warm(doc), stats, isBuilding() }`。
`api = { isMarpDoc, repoRootFor, postToPreview, panelDoc, renderForThumb(mdAbs,text) → {html,css}, replaceMinimal, afterSlideChange, ensureEditor, spawn? /* テスト用 */ }`。
`register` が落ちても（require の失敗も含む）同期プレビュー本体は動く：`corpusSearch` には `error` つきの空の `corpusResults`、`shelfEdit` には `shelfState ok:false`、`corpusInsert` / `layoutApply` には `editResult ok:false` を返し、📚 は従来の ★ ギャラリーを開く。

コマンド：`marpScrollSync.searchSlides`（「Marp: 既存のスライドを検索して挿入…」。プレビューが無ければ開いてから ＋ポップアップ）、`marpScrollSync.rebuildCorpus`、`marpScrollSync.changeLayout`。

### 8.6 未解決（7〜8章）

- （解決済み）test/e2e.test.cjs の「8. 9.」「9b.」「11.」「12.」は 8章の取り決め（📚＝検索つきギャラリー・patch・150ms）に合わせて直した。7〜8章の通し試験は test/e2e-flows.test.cjs（a〜g＋反例 1〜4。0.4 秒の予算を assert で固定）。
- 題名は `slideMeta` が page-title を優先して取る。コピー元の page-title が残ったスライドは誤った題名で当たる（デック側の直し忘れ）。
- `-b4` のようなフォーク・控えのデックは、フォルダ名が `.bak` でないので索引に載る。除外の規則は未定。
- VS Code 実機の Webview では未確認：ドラッグでの並べ替え、IME での呼び名入力、Alt+←→、右クリック（既定のコンテキストメニューの抑止）、子プロセスの起動（`ELECTRON_RUN_AS_NODE`）。
- 索引の初回作成（0.4〜0.5 秒）は同期処理で、その間は拡張ホストが止まる（プレビューを開いた直後の 1 回だけ）。

### 8.7 通し試験で確定した点（2026-09-20）

- **スクリプトは nonce 方式**（2026-10-02）：Webview の CSP は `script-src 'nonce-…'` だけ。nonce は拡張の読み込みごとに乱数で作り（extension.js `SCRIPT_NONCE`）、拡張自身の `<script>` と Marp の補助スクリプト（`new Marp({ script: { nonce } })`）にだけ付ける。他人のデックの `<script>`・`on*=`・`javascript:` は、プレビュー本体でもサムネイルでも動かない。以前の `'unsafe-inline'` では、デックのスクリプトが先に `acquireVsCodeApi()` を取って拡張になりすませた。buildHtml に `<script>` を足すときは nonce を付け忘れないこと（付け忘れると黙って動かない）。
- **サムネイルの html は二重に洗う**：以前の CSP（`'unsafe-inline'`）では、`<img onerror=…>` のようなイベント属性は Shadow DOM に入れた瞬間に動いた（実測で動いた）。nonce 方式にした今も、念のための守りとして残す。拡張（corpus-vscode.cjs `safeThumb`）が `<script>`・タグの中の `on*=`・`javascript:` の URL を外し、Webview（preview.js `fillShadow`）も DOM で `on*` 属性と `javascript:` を外してから入れる。プレビュー本体（自分の原稿）は対象外。
- **古い版の patch は当てない**：`patch.version` がいま表示している版より小さければ捨てる（同じ版は当てる＝書くものが無い editCommit の描き戻し）。
- **棚の読み直し**：拡張は Webview へ最後に送った棚の shelf.json の姿（mtime＋size）を覚え、`corpusSearch`（offset 0）のときに変わっていたら `corpusResults.shelves` に棚を載せ直す。Webview は棚つきの応答を受けたら、結果が前と同じでも棚を描き直す。壊れた shelf.json を直したあと・CLI で棚を足したあとに、プレビューを開き直さなくてよい。
- **索引の作り直しの時機**：原稿（.md）の変更・保存から `DIRTY_MS`（1.5 秒）後に、検索を待たずに裏で作り直す（デバウンス）。以前は「次の検索の後」だったので、印を付けた直後の 📚 で ★ が映らなかった。
- `.ss-pc-act`（「名前を付ける…」「×」）は、見えていない間は `pointer-events:none`。
- CLI：`insert --keep-typo` を追加。
- 試験用の控えは名前を `_` で始める（`_keep-*.md`）。索引（walkDecks）は `_` 始まりを飛ばすので、検索結果を汚さない。

## 9. Alt で箱を動かす・大きさを変える（2026-09-20 追加）

利用者の要望：プレビューで Alt を押すと div などの箱に枠線が出て、その箱の移動・拡大モードになり、場所やサイズを変えたい（例：QR を大きくして右へ寄せる）。

### 9.1 操作（media/boxedit.js / boxedit.css。window.ssPreview にだけ頼る）

- **Alt を押している間**、ポインタの下の要素に枠線と「タグ名.クラス 幅×高さ」の札を出す。対象は section の中の HTML 要素（header・footer・ページ番号・プレビュー UI は除く）。**Alt+クリックで選択**すると、8 つのハンドルつきの枠になる。選択後は Alt を離してもよい。
- ドラッグ＝移動、ハンドル＝大きさ。img / svg / video / canvas は縦横比を保つ（Shift で解除）。それ以外は自由（Shift で比率固定）。矢印キー＝1px、Shift+矢印＝10px。Alt+↑＝親の箱へ、Alt+↓＝元の子へ戻る。`0`（ゼロ）＝位置と大きさを元に戻す。Esc・外側クリックで終了。
- ドラッグ中は **Webview の中だけで** 要素の style を直接書き換える（拡張との往復なし。requestAnimationFrame で 1 フレーム 1 回）。離したときに 1 回だけ `boxCommit` を送る。値は 1280×720 の座標系の整数 px（表示の縮小率で割る）。
- 吸着：section の中央線・兄弟要素の端・元の位置に 6px 以内で吸い付き、案内線を出す（Cmd/Ctrl を押している間は吸着しない）。
- 直接編集（ダブルクリック）・クリック逆引き・右クリックの配置案とは排他：箱を選択中はそれらを止め、編集中（isEditing）は箱を選べない。
- 速さ：Alt を押してから枠が出るまで・ドラッグ中の 1 フレーム・離してから表示が確定するまで、いずれも 8.0 の予算内（テストで測る）。

### 9.2 書き戻すもの（標準の HTML の style 属性だけ。marp-cli の出力でもそのまま効く）

- **位置**＝`translate: Xpx Ypx`。見た目だけ動かす個別の CSS プロパティで、既存の `transform` を壊さず、周りの要素は動かない（入れ子の flex / grid の中でも必ず効く）。0,0 になったら消す。
- **大きさ**＝`width` / `height`。レイアウトに効くので、周りは流し込み直される。縦横比を保つ要素は `width` と `height` の両方を書く（デックの CSS が両方を固定していることが多い）。
- インラインの style はセレクタより強いが、デック側が `!important` のときは負ける。Webview が「書いた値と computed が食い違う」ことを見つけたら `important:true` を付けて送り、`!important` つきで書く。
- 原稿に他の宣言があれば残し、順序も保つ。style 属性が無ければ足す。`style=""` が空になったら属性ごと消す。

### 9.3 対象の特定（lib/style-edit.cjs。純粋）

- HTML ブロックの中のタグ：要素の `data-hline`（そのタグが書かれた行）と、**同じ `data-hline` を持つ要素の中で DOM 順に何番目か**（nth）とタグ名で決める。原稿側は、その行の開始タグを source-map.cjs と同じトークナイザで数える（コメント・引用符の中の `<` を数えない）。タグ名が合わなければ書かない。開始タグが複数行にまたがっていてもよい。
- Markdown の画像 `![alt](src)`：大きさだけ。Marp の書式で alt に `w:NNNpx` / `h:NNNpx` を入れる（既にあれば値を差し替える）。位置は書けないので、動かそうとしたら「Markdown の画像は大きさだけ変えられます」と出す。対象は `data-line` の段落の中の n 番目の画像（src も照合する）。
- Markdown 由来の要素（p・li・見出しなど `data-line` だけの要素）は v1 では対象外（枠は出すが、選ぶと理由を 1 行で示す）。
- `planStyleEdit(sourceText, slideRange, target, style) → { ok, edits, line, reason? }`。`target = { kind:'html', hline, nth, tag } | { kind:'mdimg', line, nth, src }`、`style = { translate:[x,y]|null|undefined, width:number|null|undefined, height:number|null|undefined, important?:boolean }`（null＝その宣言を消す、undefined＝触らない）。結果を marp-core で描き直して、ノートが増えない・ページ分割が変わらない・対象の要素だけ style が変わることをテストで固める。

### 9.4 メッセージ

| 方向 | type | 中身 |
|---|---|---|
| →拡張 | `boxCommit` | `{ index, version, target, style }` → `planStyleEdit` → `replaceMinimal`（editChain・version 照合は editCommit と同じ）。失敗は `editResult ok:false` と該当行への案内 |

確定後は 8.4 の patch で 1 枚だけ差し替わる。はみ出しは 7.3 の ⚠ がそのまま働く。

### 9.5 実装で確定した点（2026-09-20。通し試験 `test/e2e-flows.test.cjs` の h1〜h6 で固めた）

- **配線**（extension.js）：`buildHtml` は layouts.js の次に `media/boxedit.css` / `boxedit.js` を載せる（`optional()`。読めなければ黙って外す）。`lib/style-edit.cjs` が読めないときは boxedit.js も載せない（動かせても書けないため）。それでも `boxCommit` が届いたら「箱の編集の部品を読み込めませんでした」。
- `boxCommit` は `PREVIEW_EDIT_TYPES` に入り、editChain・version 照合は editCommit と同じ（不一致は `REASON_TEXT.stale`。Webview は editResult ok:false で見た目を戻す）。`handleBoxCommit`：`forceSlides.add(index)` → `planStyleEdit` → `applyEditsChecked` → 枚数が変わらないことを確かめて `replaceMinimal`。書くものが無ければ（edits が空）その場で描き直して表示を原稿どおりに戻す。失敗は `postEditResult(false, …)` と `guideToLine(plan.line)`（`mdimg-move` は案内しない）。
- **Markdown の画像**：宛先は「`target.line` の段落の n 番目の画像（背景画像は数えない）」。Webview の src は Webview 用の URI なので、拡張は `target.basename`（ファイル名）を `src` として渡し、style-edit の末尾一致は検算にだけ使う。
- **target**：`{ kind:'html', hline, nth, tag }`（nth は同じ section の中で同じ `data-hline` を持つ要素の DOM 順）｜`{ kind:'mdimg', line, nth, src, basename }`。style-edit は 9.3 に加えて `ambiguous`（スライド先頭からと直前の空行からの数え方が食い違う）を返す。同じプロパティの重複宣言は最初の 1 つに寄せる。属性を消して行が空白だけになるときは改行ごと消す（空行は html_block を切る）。
- **断られた要素**（Markdown の要素・SVG の図形）は、ハンドルなしの点線枠として仮に選ばれる（Alt+↑ で書き戻せる親へ上がるため）。矢印・ドラッグ・`0` は効かない。
- 吸着の 6px は画面の px。縮小率はスライド svg の viewBox 幅で割る（4:3 でも狂わない）。`important:true` は「!important を付ければ値が通る」ときだけ。
- **はみ出し**（media/overflow.js）：流し込み（position: static）の `.takeaway` も重なりだけ見る（床は決めない。インライン SVG の箱は除く）。ある実デックで QR を 180px にすると、注意書きが帯の下へ潜るのに ⚠ が出なかったため。実デック 6 本（計 328 枚）で新しく ⚠ が付くのは 1 枚だけで、実際に枠が帯に隠れている。
- **実測**（headless Chrome・実デックの写し）：離してから表示の確定まで 70〜82ms（patch 1 枚）。プレビューの QR の位置・大きさ（1280×720 の座標で x=640.6, 190×190）は、同じ原稿を標準の marp-cli で PNG にした結果と一致。
- **未確認**：VS Code 実機の Webview で Option+クリック・Option+↑ が届くか、Windows で Alt がメニューバーに取られないか。札の「幅×高さ」は border-box、原稿に書く width は CSS の width（content-box の要素では食い違って見える。QR は札 190×190・原稿 180px）。


## 10. ホーム画面（v0.3）

起動直後の「ホーム」に当たる Webview。**原稿は書かない**（7〜9 章の編集系とは独立。読むだけ）。

- `lib/home-core.cjs`：純粋（vscode 非依存）。`mostEdited`（touched／human／score／recent の並べ替え。dupOf と「変換のまま・未修正」は出さない）、`decksOf`（entries → デック単位）、`recentPush/recentItems`（最近開いたデック・上限 12）、`search`（corpus-core の searchCorpus の包み）、`shelfItems`、`splitSlides/safeThumb`。
- `lib/home-vscode.cjs`：`register(context, api)`。WebviewPanel `marpHome`（ViewColumn.Active・retainContextWhenHidden）。索引と棚は `api.corpusFor/shelfFor`（corpus-vscode のメモリ上の索引を共有。無ければ corpus.json → buildCorpus）。サムネイルは `api.renderThumb(webview, mdAbs, text)`（extension.js の `renderForThumb` に webview を渡せるようにした）。LRU 40 デック。
- `media/home.css`／`media/home.js`：画面。preview.js と同じ Shadow DOM＋adoptedStyleSheets でサムネイルを描く。
- 入口：コマンド `marpScrollSync.home`（⌘K H）、ステータスバー `$(home) Marp`（常時）、editor/title のアイコン、起動時（`home.onStartup`）。

メッセージ：W→E `homeReady`／`homeRefresh`／`homeSearch {reqId, query, sort}`／`homeThumbs {reqId, keys, haveCss}`／`homeOpen {deck, slide, preview}`／`homeSetPreview`／`homeRebuild`。E→W `homeData`／`homeResults`（reqId が最新でなければ Webview は捨てる）／`homeThumbData`（60ms の予算を越えた残りは同じ reqId の後便）／`homeRecent`／`homeToast`／`homeQuery`。

決めたこと：速さの予算は 8.0 と同じ 0.4 秒（一覧は索引のメモリから作るだけ。サムネイルは後から埋める）。「最近」は `workspaceState`。起動時の自動表示は、ワークスペースに theme/academic.css があり・Marp の原稿が表示されておらず・直近 60 秒に出していないときだけ。「手を入れた順」の既定は直した回数。索引の `churn.human`（AI 名義のコミットを除いた人の版の回数）があれば「人が直した回数」の並べ替えも出る。
