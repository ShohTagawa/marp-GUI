# Marp GUI（PDF＋プレゼン）— VS Code ローカル拡張

`marp: true` の Markdown を開くと、ステータスバーに 2 つのボタンが出ます（エディタ右上には 📄 だけ。
右上の ▶ は同期プレビュー拡張のもので、同じプレゼンを開きます。2 つ並ばないよう、この拡張の ▶ は右上に出しません）。

| ボタン | コマンド | 中身 |
|---|---|---|
| **▶ プレゼン** | `marpGui.present` | [`../../marp-present/present.mjs`](../../marp-present/present.mjs)：発表用 HTML を作って Chrome で全画面（F=全画面 / P=発表者ビュー / ←→=送り / O=一覧） |
| **📄 PDF** | `marpGui.exportPdf` | [`../build-pdf.mjs`](../build-pdf.mjs)：全スライドを分割印刷してベクターPDFに結合（`out/` に出力） |

設定（VS Code の設定画面で `marpGui` を検索）：

| キー | 既定 | 意味 |
|---|---|---|
| `marpGui.chunkSize` | 0（=20） | PDF 1 回の印刷ページ数。「Printing failed」で落ちるなら 12 など小さく |
| `marpGui.chromePath` | 空（自動） | Chrome/Edge の実行ファイルを固定したいとき |
| `marpGui.nodePath` | 空（PATH） | nvm 等で `node` が見つからないときだけ |

登録はリポジトリ直下の `npm run setup`（インストーラー）が行います（`~/.vscode/extensions/marp-gui.pdf` へのリンク）。
