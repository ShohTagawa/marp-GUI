#!/usr/bin/env node
// Marp スライドを「そのまま発表」するスクリプト（mac / Windows / Linux 共通）。
// bespoke テンプレートのHTMLを描画して Chrome(無ければ既定ブラウザ)で開くだけ。発表中のキー操作:
//   F = 全画面 /  P = 発表者ビュー(ノート・タイマー・次スライド) /  ←→ = ページ送り /  O = 一覧
//
// 使い方:
//   node tools/marp-present/present.mjs [slides/<deck>/<deck>.md] [--page N] [--no-open]
//   （引数なしなら最後に編集したデックを自動選択。--page N で N 枚目から開く）
// 環境変数:
//   CHROME_PATH  Chrome/Edge の実行パス（未指定なら OS ごとの標準インストール先を探す）
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, latestDeck, runMarp, themeSetArgs, openInBrowser, rel } from '../lib/marp-env.mjs';

const argv = process.argv.slice(2);
let page = 1;
let open = true;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--page') { page = Number(argv[++i]) || 1; continue; }
  if (a.startsWith('--page=')) { page = Number(a.slice(7)) || 1; continue; }
  if (a === '--no-open') { open = false; continue; }
  positional.push(a);
}

let md = positional[0];
if (!md) {
  md = latestDeck(ROOT);
  if (!md) { console.error('デックの .md が見つかりません。引数で指定してください: present.mjs <deck.md>'); process.exit(1); }
  console.log(`（引数なし）最後に編集したデックを自動選択: ${rel(md)}`);
}
if (!fs.existsSync(md)) { console.error(`not found: ${md}`); process.exit(1); }

const mdAbs = path.resolve(md);
const deckDir = path.dirname(mdAbs);
const deckName = path.basename(mdAbs, '.md');

// 画像の相対参照(../assets/… や ./src/…)を壊さないため、HTMLは md と同じ階層に置く。
// (marp は HTML 出力時に相対パスをそのまま残すので、out/ など別階層に出すと画像が消える。)
// 先頭ドット＋ *.html は .gitignore 済みなのでコミットされない。
const html = path.join(deckDir, '.marp-present.html');

try {
  console.log(`[1/2] marp: 発表用HTML(bespoke)を描画  → ${deckName}`);
  // --allow-local-files は付けない：HTML出力には不要で、marp の Puppeteer 経路を起こす。
  //   画像は Chrome 側の --allow-file-access-from-files（下の起動オプション）で file:// から読める。
  runMarp([mdAbs, ...themeSetArgs(ROOT), '-o', html]);

  const url = pathToFileURL(html).href + (page > 1 ? `#${page}` : '');
  if (open) {
    console.log('[2/2] ブラウザで開く  (F=全画面 / P=発表者ビュー / ←→=ページ送り / O=一覧)');
    const used = openInBrowser(url, { chromeArgs: ['--new-window', '--allow-file-access-from-files'] });
    console.log(`      browser: ${used}`);
  } else {
    console.log('[2/2] --no-open のため開きません');
  }
  console.log(`=> ${html}`);
} catch (e) {
  console.error('\n[ERROR] ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
}
