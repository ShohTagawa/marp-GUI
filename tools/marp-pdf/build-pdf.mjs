#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// marp のスライドを「落ちずに」ベクターPDF化するビルドスクリプト（mac / Windows / Linux 共通）。
//
// 背景: スライド枚数が多い/インラインSVGが重いデックでは、Chrome の printToPDF が
//   "Failed converting Markdown. (Protocol error (Page.printToPDF): Printing failed)"
// で落ちる。原因は壊れたスライドではなく、1回の印刷で serialize するページの累積量が
// Chrome(Skia) の上限を超えること。個々のスライドは正常に描画できる。
//
// 解決: 全スライドを1つのHTMLに描画 → ページ範囲(既定20枚)ごとに分割印刷 → pdf-lib で結合。
//   - 各印刷ジョブの serialize 量が小さくなるので落ちない
//   - page.pdf() なのでベクター品質を維持(PNGラスタ化しない)
//   - ページ番号は全体描画時に 1..N で焼かれ、範囲印刷でもその番号を保持 → 連番が崩れない
//   - 結合は pdf-lib（純JS）。poppler の pdfunite は不要になった（Windows でも動く）
//
// 使い方:
//   node tools/marp-pdf/build-pdf.mjs [slides/<deck>/<deck>.md] [出力先.pdf] [--chunk N]
//   （引数なしなら最後に編集したデックを自動選択）
// 環境変数:
//   CHUNK        1チャンクのページ数 (既定 20)。--chunk N が優先
//   CHROME_PATH  Chrome/Edge の実行パス (未指定なら OS ごとの標準インストール先を探す)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT, latestDeck, findChrome, runMarp, themeSetArgs, ensureNodeModules, rel } from '../lib/marp-env.mjs';
import { printChunks } from './chunk-print.mjs';

// ── 引数 ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let chunk = Number(process.env.CHUNK) || 20;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--chunk') { chunk = Number(argv[++i]); continue; }
  if (a.startsWith('--chunk=')) { chunk = Number(a.slice(8)); continue; }
  positional.push(a);
}
if (!Number.isInteger(chunk) || chunk < 1) { console.error(`--chunk は1以上の整数: ${chunk}`); process.exit(1); }

let md = positional[0];
if (!md) {
  md = latestDeck(ROOT);
  if (!md) { console.error('デックの .md が見つかりません。引数で指定してください: build-pdf.mjs <deck.md>'); process.exit(1); }
  console.log(`（引数なし）最後に編集したデックを自動選択: ${rel(md)}`);
}
if (!fs.existsSync(md)) { console.error(`not found: ${md}`); process.exit(1); }

const mdAbs = path.resolve(md);
const deckDir = path.dirname(mdAbs);
const deckName = path.basename(mdAbs, '.md');
const out = path.resolve(positional[1] || path.join(deckDir, 'out', `${deckName}.pdf`));

// ── 前提チェック（Chrome・node_modules）────────────────────────────────────────
const chrome = findChrome();
ensureNodeModules(ROOT);
const { PDFDocument } = await import('pdf-lib');

fs.mkdirSync(path.dirname(out), { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-pdf-'));
// 中間HTMLは「元の .md と同じディレクトリ」に置く。
// marp は HTML 出力時に画像を ../assets/... など相対パスのまま残すため、
// 別ディレクトリ(例 /tmp)に置くと相対参照が壊れて画像が表示されなくなる。
const html = path.join(deckDir, `.marp-pdfbuild-${process.pid}.html`);
const cleanup = () => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(html, { force: true }); } catch {}
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

try {
  console.log('[1/4] marp: 全スライドを1つのHTMLに描画 (printToPDFを使わないので落ちない)');
  runMarp([mdAbs, ...themeSetArgs(ROOT), '--allow-local-files', '-o', html]);

  // スライド枚数は描画済みHTMLから数える（CRLF や frontmatter の書式差に影響されない）。
  const htmlText = fs.readFileSync(html, 'utf8');
  let n = (htmlText.match(/<svg[^>]*data-marpit-svg/g) || []).length;
  if (!n) {
    // 保険：md の --- 区切り数（旧 build-pdf.sh と同じロジック）
    const t = fs.readFileSync(mdAbs, 'utf8').replace(/\r\n/g, '\n');
    const m = t.match(/^---\n[\s\S]*?\n---\n/);
    const body = m ? t.slice(m[0].length) : t;
    n = body.split(/\n---\n/).length;
  }
  console.log(`      スライド枚数: ${n}  / チャンク: ${chunk} 枚ずつ  / Chrome: ${chrome}`);

  console.log('[2/4] ページ範囲ごとに分割印刷 (ベクター)');
  const jobs = [];
  for (let i = 1, idx = 0; i <= n; ) {
    const end = Math.min(i + chunk - 1, n);
    idx += 1;
    jobs.push({ range: `${i}-${end}`, out: path.join(tmp, `part_${String(idx).padStart(3, '0')}.pdf`) });
    i = end + 1;
  }
  await printChunks(html, jobs, { chromePath: chrome });

  console.log('[3/4] pdf-lib で結合');
  const merged = await PDFDocument.create();
  merged.setTitle(deckName);
  merged.setProducer('marp-GUI build-pdf.mjs');
  for (const j of jobs) {
    const src = await PDFDocument.load(fs.readFileSync(j.out));
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }
  fs.writeFileSync(out, await merged.save({ useObjectStreams: true }));

  console.log('[4/4] 完了');
  const first = merged.getPage(0).getSize();
  console.log(`      Pages: ${merged.getPageCount()}   Page size: ${first.width} x ${first.height} pts`);
  console.log(`=> ${out}`);
} catch (e) {
  console.error('\n[ERROR] ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
}
