#!/usr/bin/env node
// tools/marp-png.mjs — デックを全ページ PNG に描画する（目視確認用・mac / Windows 共通）。
//
//   node tools/marp-png.mjs [slides/<deck>/<deck>.md] [出力先.png]
//   （引数なしなら最後に編集したデック。出力は slides/<deck>/out/<deck>.NNN.png）
//
// CLAUDE.md の「直したと言う前に必ずレンダリングして目で確認する」を1コマンドで行うためのもの。
// 中身は marp-cli の --images png（theme/*.css を全部渡す）。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, latestDeck, runMarp, themeSetArgs, rel } from './lib/marp-env.mjs';

let [md, out] = process.argv.slice(2);
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

try {
  runMarp([mdAbs, ...themeSetArgs(ROOT), '--images', 'png', '--allow-local-files', '-o', out]);
  const dir = path.dirname(out);
  const pngs = fs.readdirSync(dir).filter((f) => f.startsWith(deckName + '.') && f.endsWith('.png')).sort();
  console.log(`=> ${pngs.length} 枚: ${rel(dir)}/${deckName}.001.png …`);
} catch (e) {
  console.error('\n[ERROR] ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
}
