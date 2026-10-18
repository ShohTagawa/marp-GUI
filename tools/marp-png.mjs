#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// tools/marp-png.mjs — デックを全ページ PNG に描画する（目視確認用・mac / Windows 共通）。
//
//   node tools/marp-png.mjs [slides/<deck>/<deck>.md] [出力先.png]
//   node tools/marp-png.mjs [slides/<deck>/<deck>.md] -o <出力先.png>   （--output でも可）
//   （引数なしなら最後に編集したデック。出力は slides/<deck>/out/<deck>.NNN.png。
//     出力先を指定したときは <出力先の名前>.NNN.png になる）
//
// このプロジェクトの決まり「見た目を直したら、PNG に描画して目で確かめてから完了とする」を
// 1コマンドで行うためのもの。中身は marp-cli の --images png（theme/*.css を全部渡す）。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, latestDeck, runMarp, themeSetArgs, rel } from './lib/marp-env.mjs';

const argv = process.argv.slice(2);
const positional = [];
let outOpt = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-o' || a === '--output') {
    outOpt = argv[++i];
    if (!outOpt) { console.error(`${a} の後に出力先のパスを書いてください（例: -o out/deck.png）`); process.exit(1); }
    continue;
  }
  if (a.startsWith('--output=')) { outOpt = a.slice('--output='.length); continue; }
  positional.push(a);
}
let [md, out] = positional;
if (outOpt) out = outOpt;
if (!md) {
  md = latestDeck(ROOT);
  if (!md) { console.error('デックの .md が見つかりません'); process.exit(1); }
  console.log(`（引数なし）最後に編集したデックを自動選択: ${rel(md)}`);
}
if (!fs.existsSync(md)) { console.error(`not found: ${md}`); process.exit(1); }
const mdAbs = path.resolve(md);
const deckName = path.basename(mdAbs, '.md');
out = path.resolve(out || path.join(path.dirname(mdAbs), 'out', `${deckName}.png`));
fs.mkdirSync(path.dirname(out), { recursive: true });

// marp-cli は -o x.png に対して x.001.png, x.002.png … を書く（1枚だけのデックでは x.png のこともある）。
// 数えるのは「出力先の名前」で始まり、今回の実行で書かれたファイルだけ（前回の残りを数えない）。
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const outExt = path.extname(out) || '.png';
const outBase = path.basename(out, path.extname(out));
const outRe = new RegExp(`^${escapeRe(outBase)}(\\.\\d+)?${escapeRe(outExt)}$`);
const started = Date.now() - 1000; // ファイルシステムの時刻の丸め分だけ余裕を持たせる

try {
  runMarp([mdAbs, ...themeSetArgs(ROOT), '--images', 'png', '--allow-local-files', '-o', out]);
  const dir = path.dirname(out);
  const pngs = fs.readdirSync(dir)
    .filter((f) => outRe.test(f) && fs.statSync(path.join(dir, f)).mtimeMs >= started)
    .sort();
  if (!pngs.length) throw new Error(`PNG が書き出されていません: ${rel(out)}`);
  console.log(`=> ${pngs.length} 枚: ${rel(dir)}/${pngs[0]}${pngs.length > 1 ? ' …' : ''}`);
} catch (e) {
  console.error('\n[ERROR] ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
}
