// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// ホーム画面の配線（extension.js → lib/home-vscode.cjs）：コマンドで開く・一覧・検索・サムネイル・開く・最近の記録。
// 仮想 vscode（helpers/vscode-stub.cjs）。ブラウザは使わない。
// 実行: node --test tools/marp-scroll-sync/test/home-wiring.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXT = path.resolve(__dirname, '..');
const stub = require(path.join(EXT, 'test', 'helpers', 'vscode-stub.cjs'));
const { vscode, state } = stub;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 一時リポジトリ：theme/academic.css ＋ デック 2 本（ホームは「theme/academic.css のある場所」をリポジトリと見なす）
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-home-wiring-'));
fs.mkdirSync(path.join(TMP, 'theme'), { recursive: true });
fs.copyFileSync(path.resolve(EXT, '..', '..', 'theme', 'academic.css'), path.join(TMP, 'theme', 'academic.css'));
const mkDeck = (name, slides) => {
  const dir = path.join(TMP, 'slides', name); fs.mkdirSync(dir, { recursive: true });
  const md = path.join(dir, name + '.md');
  fs.writeFileSync(md, ['---', 'marp: true', 'theme: academic', '---', ''].concat(slides.map(s => s + '\n\n---\n')).join('\n'));
  return md;
};
const MD1 = mkDeck('20260101_T_intro', ['# 自己紹介\n\n- 見本大学 山田', '# 研究の概要\n\n- 地球中心核の水素']);
const MD2 = mkDeck('20260102_T_net', ['# ネットワークとは\n\n- LAN と WAN', '# IP アドレス\n\n- 住所のしくみ']);

const orig = { createWebviewPanel: vscode.window.createWebviewPanel, showTextDocument: vscode.window.showTextDocument };
let ctx = null, panels = [], shown = [];

function fakePanel(viewType) {
  const toW = []; let handler = null, onDispose = null;
  const p = { viewType, title: '', toW, viewColumn: 1,
    webview: { cspSource: 'vscode-resource:', html: '', postMessage: (m) => { toW.push(m); return Promise.resolve(true); }, asWebviewUri: (u) => ({ toString: () => 'https://file+.vscode-resource/' + String(u.fsPath || u) }),
      onDidReceiveMessage: (h) => { handler = h; return { dispose() {} }; } },
    reveal() { this.revealed = (this.revealed || 0) + 1; }, onDidDispose: (h) => { onDispose = h; return { dispose() {} }; }, dispose() { this.disposed = true; if (onDispose) onDispose(); },
    send: (m) => handler && handler(m), get handler() { return handler; } };
  return p;
}
function setup() {
  if (ctx) stub.disposeContext(ctx);
  stub.reset(); panels = []; shown = [];
  for (const k of Object.keys(require.cache)) if (k === path.join(EXT, 'extension.js') || k.startsWith(path.join(EXT, 'lib') + path.sep)) delete require.cache[k];
  vscode.window.createWebviewPanel = (viewType) => { const p = fakePanel(viewType); panels.push(p); return p; };
  vscode.window.showTextDocument = async (doc, opts) => { shown.push({ doc, opts }); return orig.showTextDocument(doc, opts); };
  // ホームが「どのリポジトリか」を知るために、一時リポジトリの原稿を 1 つアクティブにしておく
  const text = fs.readFileSync(MD1, 'utf8');
  const doc = stub.makeDocument(text, { fsPath: MD1 });
  vscode.window.activeTextEditor = stub.makeEditor(doc, { active: true, line: 0 });
  const ext = require(path.join(EXT, 'extension.js'));
  ctx = stub.makeContext(EXT);
  ext.activate(ctx);
  return { doc };
}
const homePanel = () => panels.find(p => p.viewType === 'marpHome');
const waitFor = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(20); } return fn(); };

test.after(() => {
  if (ctx) stub.disposeContext(ctx);
  Object.assign(vscode.window, { createWebviewPanel: orig.createWebviewPanel, showTextDocument: orig.showTextDocument });
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 後始末の失敗は無視 */ }
  setTimeout(() => process.exit(process.exitCode || 0), 50).unref();
});

test('コマンド marpScrollSync.home でホームが開き、homeReady に一覧（デック・手を入れた順・棚・最近）が返る', async () => {
  setup();
  assert.ok(state.commands.has('marpScrollSync.home'), 'コマンドが登録されている');
  assert.ok(state.statusItems.some(s => /Marp/.test(s.text) && s.command === 'marpScrollSync.home' && s.visible), 'ステータスバーに 🏠 Marp');
  await vscode.commands.executeCommand('marpScrollSync.home');
  const p = homePanel();
  assert.ok(p, 'marpHome の WebviewPanel が作られる');
  assert.ok(/Marp ホーム/.test(p.webview.html) && /nonce=/.test(p.webview.html) && /hm-grid/.test(p.webview.html), 'HTML に題・nonce・画面の css/js が入る');
  p.send({ type: 'homeReady' });
  const d = await waitFor(() => p.toW.find(m => m.type === 'homeData'));
  assert.ok(d, 'homeData が返る');
  assert.equal(d.repoRoot, TMP);
  const names = d.decks.map(x => x.deckName);
  assert.ok(names.includes('20260102_T_net') && names.includes('20260101_T_intro'), '2 本のデックが一覧に出る（' + names.join(',') + '）');
  assert.ok(names.indexOf('20260102_T_net') < names.indexOf('20260101_T_intro'), '新しい順');
  assert.ok(d.decks.find(x => x.deckName === '20260101_T_intro').slides >= 2, '枚数（末尾の --- で空の 1 枚が増えることがある）');
  assert.ok(Array.isArray(d.top) && Array.isArray(d.shelves) && Array.isArray(d.recent));
  assert.ok(typeof d.ms === 'number', '一覧を作った時間（ms）が返る');
  // 速さの予算（DESIGN.md 8.0）は手元でだけ assert する。CI の共有ランナーでは測るだけ（ほかの速さの試験と同じ扱い）
  if (!process.env.CI) assert.ok(d.ms < 400, '一覧は 0.4 秒以内（実測 ' + d.ms + 'ms）');
  // 2 回目は同じパネルを前に出す（作り直さない）
  await vscode.commands.executeCommand('marpScrollSync.home');
  assert.equal(panels.filter(x => x.viewType === 'marpHome').length, 1);
  assert.ok(p.revealed >= 1);
});

test('homeSearch：題名で当たる。古い reqId の応答は Webview が捨てられるよう reqId を返す', async () => {
  const p = homePanel();
  p.send({ type: 'homeSearch', reqId: 7, query: 'ネットワーク' });
  const r = await waitFor(() => p.toW.find(m => m.type === 'homeResults' && m.reqId === 7));
  assert.ok(r); assert.equal(r.query, 'ネットワーク'); assert.ok(r.total >= 1);
  assert.equal(r.items[0].deckName, '20260102_T_net'); assert.equal(r.items[0].slide, 1); assert.equal(r.items[0].title, 'ネットワークとは');
  p.send({ type: 'homeSearch', reqId: 8, query: '' });
  const r2 = await waitFor(() => p.toW.find(m => m.type === 'homeResults' && m.reqId === 8));
  assert.ok(r2 && Array.isArray(r2.items), '空の問い合わせでも必ず応答する');
});

test('homeThumbs：頼んだ枚だけ描いて返す（css は cssKey ごとに 1 回）。素材の参照はこのパネルの webview URI', async () => {
  const p = homePanel();
  const deck = 'slides/20260101_T_intro/20260101_T_intro.md';
  p.send({ type: 'homeThumbs', reqId: 1, keys: [{ deck, slide: 1 }, { deck, slide: 2 }], haveCss: [] });
  // 時間の予算（60ms）を越えると、続きは同じ reqId の後便で届く。全部そろうまで集める
  const all = () => p.toW.filter(m => m.type === 'homeThumbData' && m.reqId === 1);
  await waitFor(() => all().reduce((n, m) => n + m.items.length, 0) >= 2);
  const t = { items: all().flatMap(m => m.items), css: Object.assign({}, ...all().map(m => m.css)) };
  assert.equal(t.items.length, 2);
  assert.ok(/data-marpit-svg/.test(t.items[0].html) && /自己紹介/.test(t.items[0].html));
  assert.ok(/研究の概要/.test(t.items[1].html));
  assert.equal(t.items[0].cssKey, t.items[1].cssKey);
  assert.equal(Object.keys(t.css).length, 1, '同じデックの css は 1 回だけ');
  // 2 度目は haveCss に入れると css を送らない
  p.send({ type: 'homeThumbs', reqId: 2, keys: [{ deck, slide: 1 }], haveCss: [t.items[0].cssKey] });
  const t2 = await waitFor(() => p.toW.find(m => m.type === 'homeThumbData' && m.reqId === 2));
  assert.equal(Object.keys(t2.css).length, 0);
});

test('homeOpen：原稿を開いて該当スライドの行にカーソル。最近開いたデックに記録され、homeRecent が届く', async () => {
  const p = homePanel();
  const before = shown.length;
  p.send({ type: 'homeOpen', deck: 'slides/20260102_T_net/20260102_T_net.md', slide: 2, preview: false });
  await waitFor(() => shown.length > before);
  const last = shown[shown.length - 1];
  assert.equal(last.doc.uri.fsPath, MD2);
  assert.equal(last.opts.preview, false, 'プレビュー（イタリックのタブ）ではなく、ふつうに開く');
  const ed = state.editors.find(e => e.document === last.doc);
  assert.ok(ed, 'エディタができる');
  const lines = last.doc.getText().split('\n');
  const line = ed.selection.active.line;
  assert.ok(/^# IP アドレス/.test(lines[line]) || /^---$/.test(lines[line - 1] || '') || /^# IP/.test(lines[line + 1] || ''), '2 枚目の先頭付近にカーソル（行 ' + line + '：' + lines[line] + '）');
  const rec = ctx.workspaceState.get('marpScrollSync.home.recent', []);
  assert.equal(rec[0].deck, 'slides/20260102_T_net/20260102_T_net.md');
  const hr = await waitFor(() => p.toW.find(m => m.type === 'homeRecent'));
  assert.ok(hr && hr.recent[0].deckName === '20260102_T_net');
});

test('homeOpen：リポジトリの外・無い原稿は開かず、homeToast で知らせる', async () => {
  const p = homePanel();
  const before = shown.length;
  p.send({ type: 'homeOpen', deck: '../../etc/passwd', slide: 1, preview: false });
  const t = await waitFor(() => p.toW.find(m => m.type === 'homeToast'));
  assert.ok(t && t.warn);
  await sleep(50);
  assert.equal(shown.length, before);
});

test('起動時：ワークスペースに theme/academic.css が無ければホームは勝手に開かない（既定の仮想 vscode）', async () => {
  setup();
  await sleep(750);
  assert.equal(panels.filter(x => x.viewType === 'marpHome').length, 0);
});
