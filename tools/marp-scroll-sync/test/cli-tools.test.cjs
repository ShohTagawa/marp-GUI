// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 同期プレビュー拡張の外にある道具の小さな検証（npm test の対象がこのフォルダなので、ここに置く）。
//   - tools/lib/marp-env.mjs：Windows の start に渡す URL（cmdSafeUrl）・shellSync の引数の制限・latestDeck が隠しファイルを拾わない
//   - tools/marp-present/present.mjs：bespoke のページ送りバーを右端へ移す CSS を発表用 HTML に入れる
//   - tools/marp-pdf/vscode-extension/package.json：信頼していないフォルダ・仮想ファイルシステムでは動かない、実行ファイルのパスはユーザー設定だけ
//   node --test tools/marp-scroll-sync/test/cli-tools.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const REPO = path.resolve(__dirname, '..', '..', '..');
const ENV_URL = pathToFileURL(path.join(REPO, 'tools', 'lib', 'marp-env.mjs')).href;
const env = () => import(ENV_URL);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('marp-env：cmdSafeUrl は cmd.exe が意味を持つ文字を %XX にする（既にある %XX はそのまま）', async () => {
  const { cmdSafeUrl } = await env();
  // ^ で逃がす方式だと「a^&calc」の ^& が ^^& になって & が生き返る
  assert.strictEqual(cmdSafeUrl('file:///C:/d/a^&calc.md'), 'file:///C:/d/a%5E%26calc.md');
  assert.strictEqual(cmdSafeUrl('file:///C:/d/x|y<z>(1)!"q".md'), 'file:///C:/d/x%7Cy%3Cz%3E%281%29%21%22q%22.md');
  assert.strictEqual(cmdSafeUrl('file:///C:/d/a%20b%25c.md#3'), 'file:///C:/d/a%20b%25c.md#3', '既にある %XX は変えない');
  assert.strictEqual(cmdSafeUrl('file:///C:/d/%PATH%.md'), 'file:///C:/d/%25PATH%25.md', '%名前% の展開にならない');
  // pathToFileURL の結果を通しても、cmd の記号は 1 つも残らない
  const u = cmdSafeUrl(pathToFileURL(path.join(os.tmpdir(), 'a^&calc (1)!.md')).href);
  assert.ok(!/[&|<>^()!"]/.test(u), u);
  assert.ok(!/%(?![0-9A-F]{2})/i.test(u), u);
});

test('marp-env：shellSync は固定の語だけを受ける（シェルを通るため）', async () => {
  const { shellSync } = await env();
  for (const bad of [['echo', ['a&calc']], ['echo', ['a b']], ['echo', ['$(id)']], ['npm', ['install', 'x;y']], ['np m', []]]) {
    assert.throws(() => shellSync(bad[0], bad[1]), /shellSync/, JSON.stringify(bad));
  }
  const r = shellSync('node', ['--version'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.match(String(r.stdout), /^v\d+\./);
});

test('marp-env：latestDeck は "_" と "." で始まる md（macOS の ._*.md など）を拾わない', async () => {
  const { latestDeck } = await env();
  const root = tmp('marp-env-latest-');
  try {
    const dir = path.join(root, 'slides', 'deck');
    fs.mkdirSync(dir, { recursive: true });
    const md = '---\nmarp: true\n---\n\n# a\n';
    const deck = path.join(dir, 'deck.md');
    fs.writeFileSync(deck, md);
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(deck, old, old);
    fs.writeFileSync(path.join(dir, '._deck.md'), md);   // 新しいが隠しファイル
    fs.writeFileSync(path.join(dir, '_keep.md'), md);    // 新しいが一時ファイル
    fs.writeFileSync(path.join(dir, 'notes.md'), '# marp: true ではない\n');
    assert.strictEqual(latestDeck(root), deck);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('present.mjs：発表用 HTML に、ページ送りバーを右端の縦に移す CSS を 1 回だけ入れる（takeaway 帯に被らない）', { timeout: 120000 }, (t) => {
  if (!fs.existsSync(path.join(REPO, 'node_modules', '@marp-team', 'marp-cli', 'package.json'))) return t.skip('npm install の前（marp-cli が無い）');
  const dir = tmp('marp-present-');
  try {
    const md = path.join(dir, 'deck.md');
    fs.writeFileSync(md, '---\nmarp: true\ntheme: academic\npaginate: true\n---\n\n# 1\n\n---\n\n# 2\n\n<div class="takeaway">帯</div>\n');
    const run = () => spawnSync(process.execPath, [path.join(REPO, 'tools', 'marp-present', 'present.mjs'), md, '--no-open'], { encoding: 'utf8', timeout: 110000 });
    const r = run();
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const html = fs.readFileSync(path.join(dir, '.marp-present.html'), 'utf8');
    assert.strictEqual(html.split('id="ss-osc-side"').length, 2, 'CSS は 1 回だけ');
    assert.ok(html.indexOf('id="ss-osc-side"') < html.indexOf('</head>'), '<head> の中');
    assert.match(html, /\.bespoke-marp-parent>\.bespoke-marp-osc\{\s*left:auto;right:12px;top:50%/, '右端・縦の中央');
    assert.match(html, /<script id="ss-osc-side-js">[\s\S]*\(\\d\+\)\\D\+\(\\d\+\)/, '「3 / 12」の書き換え（正規表現が HTML の中で壊れていない）');
    // 描き直すたびに入れ直す（二重にならない）
    assert.strictEqual(run().status, 0);
    assert.strictEqual(fs.readFileSync(path.join(dir, '.marp-present.html'), 'utf8').split('id="ss-osc-side"').length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('marp-pdf 拡張の manifest：信頼していないフォルダ・仮想ファイルシステムでは動かない／Chrome と node のパスはユーザー設定だけ／▶ は 1 つ', () => {
  const dir = path.join(REPO, 'tools', 'marp-pdf', 'vscode-extension');
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.capabilities.untrustedWorkspaces.supported, false);
  assert.strictEqual(pkg.capabilities.virtualWorkspaces.supported, false);
  const props = pkg.contributes.configuration.properties;
  // 受け取ったフォルダの .vscode/settings.json が、起動する実行ファイルを差し替えられないように
  assert.strictEqual(props['marpGui.chromePath'].scope, 'machine');
  assert.strictEqual(props['marpGui.nodePath'].scope, 'machine');
  // エディタ右上の ▶ は同期プレビュー拡張のもの 1 つだけ（同じ when で 2 つ並んでいた）
  const titlePdf = pkg.contributes.menus['editor/title'].map((m) => m.command);
  assert.ok(!titlePdf.includes('marpGui.present'), JSON.stringify(titlePdf));
  assert.ok(titlePdf.includes('marpGui.exportPdf'));
  const ss = JSON.parse(fs.readFileSync(path.join(REPO, 'tools', 'marp-scroll-sync', 'package.json'), 'utf8'));
  assert.ok(ss.contributes.menus['editor/title'].some((m) => m.command === 'marpScrollSync.present' && /marpScrollSync\.isMarp/.test(m.when || '')), '同期プレビュー拡張の ▶ が Marp の原稿に出る');
  // %key% は英語・日本語の両方の nls にある
  const keys = new Set((JSON.stringify(pkg).match(/%([\w.]+)%/g) || []).map((k) => k.slice(1, -1)));
  for (const f of ['package.nls.json', 'package.nls.ja.json']) {
    const nls = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const k of keys) assert.ok(typeof nls[k] === 'string' && nls[k], f + ' に ' + k);
  }
});
