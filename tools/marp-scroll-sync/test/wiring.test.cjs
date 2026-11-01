// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// extension.js の配線（メッセージの振り分け・版の照合・再描画のタイミング）の回帰テスト。ブラウザは使わない。
// 実行: node --test tools/marp-scroll-sync/test/wiring.test.cjs
// 仮想の vscode（helpers/vscode-stub.cjs）の上で activate し、Webview からのメッセージを直接流し込む。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXT = path.resolve(__dirname, '..');
const stub = require(path.join(EXT, 'test', 'helpers', 'vscode-stub.cjs'));
const { vscode, state } = stub;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const DECK = ['---', 'marp: true', 'theme: academic', '---', '', '# One', '', '- alpha', '- beta', '', '---', '', '# Two', '', 'para text', '', ''].join('\n');
const NODES = [
  { t: 'One', near: { kind: 'md', start: 5, end: 6 }, svg: false },
  { t: 'alpha', near: { kind: 'md', start: 7, end: 8 }, svg: false },
  { t: 'beta', near: { kind: 'md', start: 8, end: 9 }, svg: false },
];

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-wiring-'));
const orig = { createWebviewPanel: vscode.window.createWebviewPanel, applyEdit: vscode.workspace.applyEdit, showTextDocument: vscode.window.showTextDocument };
let ctx = null;
const knobs = { applyDelay: 0 };

function setup(text, opts = {}) {
  if (ctx) stub.disposeContext(ctx);
  stub.reset();
  for (const k of Object.keys(require.cache)) if (k === path.join(EXT, 'extension.js') || k.startsWith(path.join(EXT, 'lib') + path.sep)) delete require.cache[k];
  const MD = opts.md || path.join(TMP, 'd.md');
  fs.mkdirSync(path.dirname(MD), { recursive: true });
  fs.writeFileSync(MD, text);
  const doc = stub.makeDocument(text, { fsPath: MD });
  const ed = stub.makeEditor(doc, { active: true, line: 5 });
  vscode.window.activeTextEditor = ed;
  const toW = []; let handler = null, onDispose = null;
  const panel = {
    viewColumn: opts.panelColumn || 2,
    webview: { cspSource: 'x', html: '', postMessage: (m) => { toW.push(m); return Promise.resolve(true); }, asWebviewUri: (u) => u,
      onDidReceiveMessage: (h) => { handler = h; return { dispose() {} }; } },
    reveal() {}, onDidDispose: (h) => { onDispose = h; return { dispose() {} }; }, dispose() { if (onDispose) onDispose(); },
  };
  vscode.window.createWebviewPanel = () => panel;
  vscode.workspace.applyEdit = async (we) => {
    state.appliedEdits.push(we);
    if (knobs.applyDelay) await sleep(knobs.applyDelay);
    for (const op of we.ops) {
      const d = state.documents.find(x => x.uri.toString() === op.uri.toString());
      if (!d) return false;
      const s = d.offsetAt(op.range.start), e = d.offsetAt(op.range.end), t = d.getText();
      d.setText(t.slice(0, s) + op.text + t.slice(e));
      stub.fire.changeDoc(d, [{}]);
    }
    return true;
  };
  const ext = require(path.join(EXT, 'extension.js'));
  ctx = stub.makeContext(EXT);
  ext.activate(ctx);
  return { doc, ed, toW, panel, send: (m) => handler(m), type: (t) => { doc.setText(t); stub.fire.changeDoc(doc, [{}]); } };
}
const open = () => vscode.commands.executeCommand('marpScrollSync.openPreview');
const brief = (S, from) => S.toW.slice(from).filter(m => m.type !== 'tuneState');
const isDraw = (m) => m.type === 'render' || m.type === 'patch';
const headings = (doc) => doc.getText().match(/^# .*/gm);

test.after(() => {
  if (ctx) stub.disposeContext(ctx);
  Object.assign(vscode.window, { createWebviewPanel: orig.createWebviewPanel, showTextDocument: orig.showTextDocument });
  vscode.workspace.applyEdit = orig.applyEdit;
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 後始末の失敗は無視 */ }
  setTimeout(() => process.exit(process.exitCode || 0), 50).unref(); // 拡張の中のタイマーで終了が遅れないように
});

test('仮想 vscode で activate でき、プレビューを開ける', async () => {
  const S = setup(DECK); await open();
  assert.ok(S.panel.webview.html.includes('id="wrap"'));
  for (const c of ['openPreview', 'newSlide', 'duplicateSlide', 'moveSlideUp', 'moveSlideDown', 'deleteSlide']) assert.ok(state.commands.has('marpScrollSync.' + c), c);
});

test('editCommit：書き戻しの直後の render にだけ expect が付く', async () => {
  const S = setup(DECK); await open();
  const n = S.toW.length;
  S.send({ type: 'editCommit', index: 0, version: S.doc.version, nodes: NODES, changes: [{ k: 1, old: 'alpha', now: 'alphaX' }], then: 'none', line: 7, lineEnd: 8 });
  await sleep(100);
  assert.strictEqual(S.doc.lineAt(7).text, '- alphaX');
  const out = brief(S, n);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].expect, { index: 0, k: 1, text: 'alphaX' });
  assert.strictEqual(state.appliedEdits.length, 1);
});

test('slideOp / libraryInsert も version を照合する（描画が古い間は別のスライドを消さない）', async () => {
  const S = setup(DECK); await open();
  const v0 = S.doc.version;
  S.type(DECK.replace('# One', '# Zero\n\n---\n\n# One'));   // 1枚目の前に1枚足した。プレビューはまだ One / Two のまま
  state.messageAnswer = '削除';
  let n = S.toW.length;
  S.send({ type: 'slideOp', op: 'delete', index: 1, version: v0 });   // プレビューでは Two のつもり
  await sleep(100);
  assert.deepStrictEqual(headings(S.doc), ['# Zero', '# One', '# Two']);
  assert.ok(brief(S, n).some(m => m.type === 'editResult' && m.ok === false));
  assert.strictEqual(state.messages.length, 0, '確認ダイアログも出さない');
  n = S.toW.length;
  S.send({ type: 'libraryInsert', id: 'nope', index: 1, version: v0 });
  await sleep(50);
  assert.ok(brief(S, n).some(m => m.type === 'editResult' && m.ok === false));
  // 版が合っていれば消える
  S.send({ type: 'slideOp', op: 'delete', index: 1, version: S.doc.version });
  await sleep(100);
  assert.deepStrictEqual(headings(S.doc), ['# Zero', '# Two']);
});

test('保留中の再描画（150ms）が applyEdit の待ちの間に走らない（expect / startEdit は書き戻した後の描画に付く）', async () => {
  const S = setup(DECK); await open();
  S.type(DECK.replace('para text', 'para text!'));               // 利用者が原稿を打つ → 150ms タイマー
  await sleep(100);
  knobs.applyDelay = 150;
  const n = S.toW.length;
  S.send({ type: 'editCommit', index: 0, version: S.doc.version, nodes: NODES, changes: [{ k: 1, old: 'alpha', now: 'alphaX' }], then: 'newBullet', line: 7, lineEnd: 8 });
  await sleep(400);
  knobs.applyDelay = 0;
  const out = brief(S, n);
  assert.deepStrictEqual(out.map(m => m.type), ['patch', 'startEdit'], '枚数が同じなので patch（8.4）');
  assert.deepStrictEqual(out[0].slides.map(x => x.index), [0, 1], '打った 2 枚目と、プレビューで直した 1 枚目');
  assert.strictEqual(out[0].version, S.doc.version);
  assert.deepStrictEqual(out[0].expect, { index: 0, k: 1, text: 'alphaX' });
  assert.strictEqual(out[1].line, 8);
});

test('プレビュー対象でない原稿へのスライド操作で、即時再描画のフラグが残らない', async () => {
  const S = setup(DECK); await open();
  const otherText = DECK.replace('One', 'Other');
  const other = stub.makeDocument(otherText, { fsPath: path.join(TMP, 'o.md') });
  vscode.window.activeTextEditor = stub.makeEditor(other, { active: true, line: 12 });
  await vscode.commands.executeCommand('marpScrollSync.duplicateSlide');
  await sleep(100);
  assert.strictEqual(other.getText().split('# Two').length - 1, 2, '別の原稿は複製される');
  assert.strictEqual(S.doc.getText(), DECK);
  const n = S.toW.length;
  S.type(DECK.replace('para text', 'para text!'));
  await sleep(60);
  assert.deepStrictEqual(brief(S, n), [], 'デバウンス（150ms）を待たずに描き直していない');
  await sleep(250);
  assert.strictEqual(brief(S, n).filter(isDraw).length, 1);
});

test('書くものが無い editCommit は表示を原稿どおりに描き直す／ノードを空にする変更が混じるときは expect を付けない', async () => {
  const S = setup(DECK); await open();
  let n = S.toW.length;
  S.send({ type: 'editCommit', index: 0, version: S.doc.version, nodes: NODES, changes: [{ k: 1, old: 'alpha', now: 'alpha  ' }], then: 'none', line: 7, lineEnd: 8 });
  await sleep(100);
  assert.strictEqual(S.doc.getText(), DECK);
  assert.strictEqual(state.appliedEdits.length, 0);
  let out = brief(S, n);
  assert.deepStrictEqual(out.map(m => m.type), ['patch']);
  assert.deepStrictEqual(out[0].slides.map(x => x.index), [0], 'html が同じでも、打った文字の残る 1 枚は差し替える');
  assert.strictEqual(out[0].expect, undefined);

  n = S.toW.length;
  S.send({ type: 'editCommit', index: 0, version: S.doc.version, nodes: NODES, changes: [{ k: 1, old: 'alpha', now: '' }, { k: 2, old: 'beta', now: 'betaY' }], then: 'none', line: 7, lineEnd: 9 });
  await sleep(100);
  out = brief(S, n);
  if (S.doc.getText() !== DECK) {          // 書けた場合だけ（断られたなら render は来ない）
    assert.ok(S.doc.getText().includes('betaY'));
    assert.strictEqual(out.filter(isDraw)[0].expect, undefined);
  } else assert.ok(out.some(m => m.type === 'editResult' && m.ok === false));
});

test('原稿のタブが無く、プレビューが左端の列にいるときは、原稿をプレビューの上に重ねない', async () => {
  const S = setup(DECK, { panelColumn: 1 }); await open();
  state.editors = [];                                            // 原稿のタブを閉じた
  const calls = [];
  vscode.window.showTextDocument = async (doc, o) => { calls.push(o); return stub.makeEditor(doc, { active: true }); };
  S.send({ type: 'slideOp', op: 'duplicate', index: 0, version: S.doc.version });
  await sleep(100);
  vscode.window.showTextDocument = orig.showTextDocument;
  assert.ok(calls.length >= 1);
  assert.strictEqual(calls[0].viewColumn, vscode.ViewColumn.Beside);
  assert.strictEqual(headings(S.doc).filter(h => h === '# One').length, 2);
});

test('編集中に操作ボタン：確定（editCommit）の直後に同じ版番号で届く slideOp は受ける。間に利用者の編集が入れば断る', async () => {
  let S = setup(DECK); await open();
  const v = S.doc.version;
  S.send({ type: 'editCommit', index: 0, version: v, nodes: NODES, changes: [{ k: 1, old: 'alpha', now: 'alphaX' }], then: 'none', line: 7, lineEnd: 8 });
  S.send({ type: 'slideOp', op: 'duplicate', index: 0, version: v });
  await sleep(150);
  assert.strictEqual(S.doc.getText().split('- alphaX').length - 1, 2, '確定した文字ごと複製される');

  S = setup(DECK); await open();
  const v2 = S.doc.version;
  S.send({ type: 'editCommit', index: 0, version: v2, nodes: NODES, changes: [{ k: 1, old: 'alpha', now: 'alphaX' }], then: 'none', line: 7, lineEnd: 8 });
  await sleep(100);
  S.type(S.doc.getText().replace('# One', '# Zero\n\n---\n\n# One'));
  S.send({ type: 'slideOp', op: 'duplicate', index: 0, version: v2 });
  await sleep(100);
  assert.strictEqual(S.doc.getText().split('# Zero').length - 1, 1, '版が進んでいるので複製しない');
});


// ===== 7〜8章の配線（検索・挿入・棚・配置案・patch／render・部品が読めないとき） =====

const Module = require('module');
const REPO = path.join(TMP, 'repo');
const REAL_THEME = path.resolve(EXT, '..', '..', 'theme', 'academic.css');
const deckOf = (titles, extra) => ['---', 'marp: true', 'theme: academic', '---', ''].concat(
  titles.map((t, i) => (i ? '---\n\n' : '') + `# ${t}\n\n- ${t} の一つ目\n- ${t} の二つ目\n` + ((extra && extra[i]) || '') + '\n')).join('\n');
const SRC_A = deckOf(['自己紹介', 'Gamma の説明', '著作権の話'], { 1: '\n<script>alert(1)</script>\n' });
const SRC_B = deckOf(['Delta の手順', 'まとめ']);
const DEST = deckOf(['One', 'Two']);
const DEST_MD = path.join(REPO, 'slides', '20260901_Test_dest', '20260901_Test_dest.md');
const A_REL = 'slides/20260801_Test_a/20260801_Test_a.md', B_REL = 'slides/20260802_Test_b/20260802_Test_b.md';
const SHELF = path.join(REPO, 'slides', '_library', 'shelf.json');

function makeRepo() {
  fs.rmSync(REPO, { recursive: true, force: true });
  fs.mkdirSync(path.join(REPO, 'theme'), { recursive: true });
  fs.copyFileSync(REAL_THEME, path.join(REPO, 'theme', 'academic.css'));
  for (const [rel, text] of [[A_REL, SRC_A], [B_REL, SRC_B]]) {
    fs.mkdirSync(path.dirname(path.join(REPO, rel)), { recursive: true });
    fs.writeFileSync(path.join(REPO, rel), text);
  }
}
function setupRepo(text) { makeRepo(); return setup(text || DEST, { md: DEST_MD }); }
const last = (S, type, from) => S.toW.slice(from || 0).filter(m => m.type === type).pop();

test('corpusSearch → corpusResults：サムネイルは svg 1 枚・<script> は除く・css は cssKey ごとに 1 回だけ', async () => {
  const S = setupRepo(); await open();
  let t0 = Date.now();
  S.send({ type: 'corpusSearch', reqId: 1, query: 'Gamma', onlyMarked: false, sort: 'relevance', offset: 0, limit: 9, haveCss: [] });
  const cold = Date.now() - t0;
  const r1 = last(S, 'corpusResults');
  assert.ok(r1 && r1.reqId === 1, '同期で応答する');
  assert.strictEqual(r1.total, 1);
  const it = r1.items[0];
  assert.strictEqual(it.deck, A_REL); assert.strictEqual(it.slide, 2); assert.strictEqual(it.title, 'Gamma の説明');
  assert.ok(/^<svg\b[^>]*data-marpit-svg/.test(it.html) && it.html.trim().endsWith('</svg>'));
  assert.strictEqual((it.html.match(/data-marpit-svg/g) || []).length, 1, 'スライド 1 枚分だけ');
  assert.ok(!/<script/i.test(it.html), '<script> は除く');
  assert.ok(it.html.includes('Gamma') && !it.html.includes('自己紹介'));
  assert.ok(typeof r1.css[it.cssKey] === 'string' && r1.css[it.cssKey].length > 1000);
  assert.strictEqual(it.sameTheme, true);

  t0 = Date.now();
  S.send({ type: 'corpusSearch', reqId: 2, query: '著作権', offset: 0, limit: 9, haveCss: [it.cssKey] });
  const warm = Date.now() - t0;
  const r2 = last(S, 'corpusResults');
  assert.strictEqual(r2.reqId, 2); assert.strictEqual(r2.items[0].slide, 3);
  assert.deepStrictEqual(r2.css, {}, '持っている css は送り直さない');
  // 速さは手元でだけ assert する（CI の共有ランナーでは測って出すだけ。ほかの速さの試験と同じ扱い）
  if (!process.env.CI) assert.ok(warm < 30, `キャッシュ済みの応答は 30ms 以内（実測 ${warm}ms）`);
  console.log(`# corpusSearch（合成 3 デック）：初回 ${cold}ms／キャッシュ済み ${warm}ms`);

  // 未保存の原稿（textOf）：開いている A の 2 枚目を書き換えると、サムネイルにも映る
  const a = stub.makeDocument(SRC_A.replace('Gamma の説明', 'Gamma の改題'), { fsPath: path.join(REPO, A_REL) });
  stub.fire.changeDoc(a, [{}]);
  await sleep(1700);                                           // 索引は応答の外で作り直す
  S.send({ type: 'corpusSearch', reqId: 3, query: '改題', offset: 0, limit: 9, haveCss: [] });
  await sleep(1700);
  S.send({ type: 'corpusSearch', reqId: 4, query: '改題', offset: 0, limit: 9, haveCss: [] });
  const r4 = last(S, 'corpusResults');
  assert.strictEqual(r4.total, 1, '未保存の内容で当たる');
  assert.ok(r4.items[0].html.includes('改題'));
});

test('corpusInsert：2 枚を index −1 へ・1 つの編集／version 不一致は断る／自分自身からも入れられる', async () => {
  const S = setupRepo(); await open();
  const v0 = S.doc.version;
  let n = S.toW.length;
  S.send({ type: 'corpusInsert', items: [{ deck: A_REL, slide: 2 }, { deck: B_REL, slide: 1 }], index: -1, version: v0, keepColors: false, keepTypo: true });
  await sleep(200);
  assert.deepStrictEqual(headings(S.doc), ['# Gamma の説明', '# Delta の手順', '# One', '# Two']);
  assert.strictEqual(state.appliedEdits.length, 1, '複数枚でも WorkspaceEdit は 1 つ（Cmd+Z 1回）');
  assert.ok(brief(S, n).some(m => m.type === 'editResult' && m.ok === true && /2 枚/.test(m.message)));
  assert.ok(brief(S, n).some(m => m.type === 'render'), '枚数が変わったので render');
  assert.ok(S.doc.getText().startsWith('---\nmarp: true'), 'frontmatter は先頭のまま');

  // 古い版のまま（プレビューがまだ描き直していない）→ 断る
  n = S.toW.length;
  const before = S.doc.getText();
  S.send({ type: 'corpusInsert', items: [{ deck: B_REL, slide: 2 }], index: 0, version: v0 });
  await sleep(100);
  assert.strictEqual(S.doc.getText(), before);
  assert.ok(brief(S, n).some(m => m.type === 'editResult' && m.ok === false));
  assert.strictEqual(state.appliedEdits.length, 1);

  // 自己挿入：いまの原稿の 4 枚目（Two）を 1 枚目の次へ
  const selfRel = path.relative(REPO, DEST_MD).split(path.sep).join('/');
  S.send({ type: 'corpusInsert', items: [{ deck: selfRel, slide: 4 }], index: 0, version: S.doc.version });
  await sleep(200);
  assert.deepStrictEqual(headings(S.doc), ['# Gamma の説明', '# Two', '# Delta の手順', '# One', '# Two']);
  assert.strictEqual(state.appliedEdits.length, 2);

  // リポジトリの外・存在しないスライドは、原稿を変えずに断る
  const keep = S.doc.getText();
  n = S.toW.length;
  S.send({ type: 'corpusInsert', items: [{ deck: '../x.md', slide: 1 }], index: 0, version: S.doc.version });
  S.send({ type: 'corpusInsert', items: [{ deck: A_REL, slide: 99 }], index: 0, version: S.doc.version });
  await sleep(150);
  assert.strictEqual(S.doc.getText(), keep);
  assert.strictEqual(brief(S, n).filter(m => m.type === 'editResult' && m.ok === false).length, 2);
});

test('overflowReport：直前に挿入したスライドがはみ出していたら、1 回だけ知らせる', async () => {
  const S = setupRepo(); await open();
  S.send({ type: 'corpusInsert', items: [{ deck: A_REL, slide: 1 }], index: 0, version: S.doc.version });
  await sleep(200);
  let n = S.toW.length;
  S.send({ type: 'overflowReport', version: S.doc.version, slides: [{ index: 0, bottomPx: 40 }] });   // 入れたのは index 1。関係ないスライド
  assert.strictEqual(brief(S, n).length, 0);
  S.send({ type: 'corpusInsert', items: [{ deck: A_REL, slide: 3 }], index: 0, version: S.doc.version });
  await sleep(200);
  n = S.toW.length;
  S.send({ type: 'overflowReport', version: S.doc.version, slides: [{ index: 1, bottomPx: 23.6, hitsTakeaway: true }] });
  const msg = brief(S, n).find(m => m.type === 'editResult');
  assert.ok(msg && /スライド 2 が 24px はみ出しています/.test(msg.message) && /元の組版を保つ/.test(msg.message) && /右クリック/.test(msg.message), msg && msg.message);
  n = S.toW.length;
  S.send({ type: 'overflowReport', version: S.doc.version, slides: [{ index: 1, bottomPx: 23.6 }] });
  assert.strictEqual(brief(S, n).length, 0, '同じ挿入については 2 度言わない');
});

test('shelfEdit → shelf.json を書いて shelfState を返す／外で書き換えられたら読み直す／壊れたファイルには書かない', async () => {
  const S = setupRepo(); await open();
  S.send({ type: 'corpusPrefetch', kind: 'shelf', reqId: 7, limit: 9, haveCss: [] });
  let st = last(S, 'shelfState');
  assert.deepStrictEqual(st.shelves, [], '棚はまだ無い');
  const top = last(S, 'corpusResults');
  assert.strictEqual(top.reqId, 7); assert.ok(top.items.length >= 5, '先読み：手を入れた順の上位');

  S.send({ type: 'shelfEdit', op: 'add', shelf: '自己紹介', label: '自己紹介 学外用', deck: A_REL, slide: 1, title: '自己紹介', id: null });
  S.send({ type: 'shelfEdit', op: 'add', shelf: '自己紹介', label: '手順', deck: B_REL, slide: 1, title: 'Delta の手順', id: null });
  st = last(S, 'shelfState');
  assert.strictEqual(st.ok, true);
  assert.deepStrictEqual(st.shelves.map(x => [x.name, x.items.map(i => i.label)]), [['自己紹介', ['自己紹介 学外用', '手順']]]);
  assert.ok(st.shelves[0].items[0].html.includes('<svg') && st.shelves[0].items[0].deck === A_REL);
  const disk = JSON.parse(fs.readFileSync(SHELF, 'utf8'));
  assert.strictEqual(disk.shelves[0].items[0].label, '自己紹介 学外用');
  assert.strictEqual(disk.shelves[0].items[0].title, '自己紹介');

  S.send({ type: 'shelfEdit', op: 'move', shelf: '自己紹介', from: 1, to: 0 });
  S.send({ type: 'shelfEdit', op: 'rename', shelf: '自己紹介', at: 0, label: '手順（3枚）' });
  S.send({ type: 'shelfEdit', op: 'renameShelf', shelf: '自己紹介', name: 'よく使う' });
  st = last(S, 'shelfState');
  assert.deepStrictEqual(st.shelves.map(x => [x.name, x.items.map(i => i.label)]), [['よく使う', ['手順（3枚）', '自己紹介 学外用']]]);

  // 検索は呼び名にも当たり、棚のスライドが先頭
  S.send({ type: 'corpusSearch', reqId: 8, query: '学外用', offset: 0, limit: 9, haveCss: [] });
  const r = last(S, 'corpusResults');
  assert.strictEqual(r.items[0].deck, A_REL); assert.strictEqual(r.items[0].slide, 1);
  assert.ok(r.items[0].shelf && r.items[0].shelf.label === '自己紹介 学外用');

  // 位置と呼び名が食い違う remove は、別の項目を消さない（呼び名で探し直す）
  S.send({ type: 'shelfEdit', op: 'remove', shelf: 'よく使う', at: 0, label: '自己紹介 学外用' });
  st = last(S, 'shelfState');
  assert.deepStrictEqual(st.shelves[0].items.map(i => i.label), ['手順（3枚）']);

  // 外で書き換え（CLI や手編集）→ 次の先読みで読み直す。行方不明は消さずに残す
  await sleep(20);
  fs.writeFileSync(SHELF, JSON.stringify({ version: 1, shelves: [{ name: '外で作った棚', items: [{ label: 'まとめ', deck: B_REL, title: 'まとめ' }, { label: '迷子', deck: 'slides/none/none.md', slide: 3 }] }] }, null, 2) + '\n');
  S.send({ type: 'corpusPrefetch', kind: 'shelf', reqId: 9, limit: 9, haveCss: [] });
  st = last(S, 'shelfState');
  assert.deepStrictEqual(st.shelves.map(x => x.name), ['外で作った棚']);
  assert.strictEqual(st.shelves[0].items[0].slide, 2);
  assert.strictEqual(st.shelves[0].items[1].missing, true);

  // 失敗（無い棚）→ ok:false と、いまの正しい棚
  S.send({ type: 'shelfEdit', op: 'rename', shelf: '無い棚', at: 0, label: 'x' });
  st = last(S, 'shelfState');
  assert.strictEqual(st.ok, false); assert.ok(st.message); assert.deepStrictEqual(st.shelves.map(x => x.name), ['外で作った棚']);

  // 壊れた shelf.json には書かない
  await sleep(20);
  fs.writeFileSync(SHELF, '{ こわれた');
  S.send({ type: 'shelfEdit', op: 'add', shelf: 'x', label: 'y', deck: A_REL, slide: 1, title: '自己紹介', id: null });
  st = last(S, 'shelfState');
  assert.strictEqual(st.ok, false);
  assert.strictEqual(fs.readFileSync(SHELF, 'utf8'), '{ こわれた');
});

test('layoutApply：_class の lay-* を 1 回の編集で差し替える／外す／version 不一致と変な名前は断る', async () => {
  const S = setupRepo(); await open();
  assert.ok(S.panel.webview.html.includes('window.__SS_LAYOUTS__ = {'), '判定の表を埋め込む');
  assert.ok(S.panel.webview.html.includes('ssDetectOverflow'), 'overflow.js を読み込む');
  assert.ok(S.panel.webview.html.includes('ssLayouts'), 'layouts.js を読み込む');
  const v0 = S.doc.version;
  S.send({ type: 'layoutApply', index: 1, version: v0, cls: 'lay-boxed' });
  await sleep(150);
  assert.strictEqual(state.appliedEdits.length, 1);
  assert.ok(/<!--\s*_class:\s*lay-boxed\s*-->/.test(S.doc.getText()), S.doc.getText());
  assert.ok(S.doc.getText().indexOf('lay-boxed') > S.doc.getText().indexOf('# One'), '2 枚目に付く');
  assert.deepStrictEqual(headings(S.doc), ['# One', '# Two']);

  let n = S.toW.length;
  S.send({ type: 'layoutApply', index: 0, version: v0, cls: 'lay-cards3' });        // 古い版
  S.send({ type: 'layoutApply', index: 0, version: S.doc.version, cls: 'lay-x"><script>' });
  await sleep(100);
  assert.strictEqual(state.appliedEdits.length, 1);
  assert.strictEqual(brief(S, n).filter(m => m.type === 'editResult' && m.ok === false).length, 2);

  S.send({ type: 'layoutApply', index: 1, version: S.doc.version, cls: 'lay-steps' });
  await sleep(150);
  assert.ok(S.doc.getText().includes('lay-steps') && !S.doc.getText().includes('lay-boxed'));
  S.send({ type: 'layoutApply', index: 1, version: S.doc.version, cls: null });
  await sleep(150);
  assert.ok(!/lay-/.test(S.doc.getText()), '標準（null）で外れる');
  assert.strictEqual(state.appliedEdits.length, 3);

  // コマンド（プレビューなしでも使える）：一覧から選ぶ
  state.quickPickAnswer = (items) => items.find(i => i.v.cls === 'lay-boxed');
  S.ed.selection = new vscode.Selection(new vscode.Position(6, 0), new vscode.Position(6, 0));
  await vscode.commands.executeCommand('marpScrollSync.changeLayout');
  await sleep(150);
  assert.ok(/_class:\s*lay-boxed/.test(S.doc.getText()));
  for (const c of ['searchSlides', 'rebuildCorpus', 'changeLayout']) assert.ok(state.commands.has('marpScrollSync.' + c), c);
});

test('patch と render の切り替え：1 枚だけ変われば patch、枚数が変われば render、needRender には全体で応える', async () => {
  const S = setupRepo(deckOf(['One', 'Two', 'Three'])); await open();
  let n = S.toW.length;
  S.type(S.doc.getText().replace('Two の一つ目', 'Two の一つ目！'));
  await sleep(60);
  assert.strictEqual(brief(S, n).length, 0, '150ms は待つ');
  await sleep(200);
  let out = brief(S, n);
  assert.deepStrictEqual(out.map(m => m.type), ['patch']);
  assert.deepStrictEqual(out[0].slides.map(x => x.index), [1]);
  assert.ok(/^<svg\b[^>]*data-marpit-svg/.test(out[0].slides[0].html) && out[0].slides[0].html.endsWith('</svg>'));
  assert.ok(out[0].slides[0].html.includes('Two の一つ目！') && !out[0].slides[0].html.includes('Three'));
  assert.strictEqual(out[0].version, S.doc.version);
  assert.ok(Array.isArray(out[0].marks));

  n = S.toW.length;                                              // 行が増える：後ろのスライドの data-line もずれるので、後ろも送る
  S.type(S.doc.getText().replace('- Two の二つ目', '- Two の二つ目\n- Two の三つ目'));
  await sleep(260);
  out = brief(S, n);
  assert.deepStrictEqual(out.map(m => m.type), ['patch']);
  assert.deepStrictEqual(out[0].slides.map(x => x.index), [1, 2]);

  n = S.toW.length;                                              // 枚数が変わる → render
  S.type(S.doc.getText() + '\n---\n\n# Four\n');
  await sleep(260);
  out = brief(S, n);
  assert.deepStrictEqual(out.map(m => m.type), ['render']);
  assert.ok(out[0].html.includes('Four'));

  n = S.toW.length;                                              // css が変わる（style: を足す）→ render
  S.type(S.doc.getText().replace('theme: academic', 'theme: academic\nstyle: |\n  section { color: #123456; }'));
  await sleep(260);
  assert.deepStrictEqual(brief(S, n).map(m => m.type), ['render']);

  n = S.toW.length;                                              // 変化なし（frontmatter の外の空行）でも版は進むので、空の patch で版を伝える
  S.type(S.doc.getText() + '\n');
  await sleep(260);
  out = brief(S, n);
  assert.deepStrictEqual(out.map(m => m.type), ['patch']);
  assert.strictEqual(out[0].version, S.doc.version);

  n = S.toW.length;
  S.send({ type: 'needRender', version: S.doc.version });
  out = brief(S, n);
  assert.deepStrictEqual(out.map(m => m.type), ['render'], '当てられなかった patch の代わりに全体を送る');
});

test('<style scoped> のあるデックでも patch になる（描くたびに変わる目印を連番に付け替える）', async () => {
  const text = deckOf(['One', 'Two', 'Three'], { 1: '\n<style scoped>\nli { color: #123456; }\n</style>\n' });
  const S = setupRepo(text); await open();
  assert.ok(/data-marpit-scope-ss0\b/.test(S.panel.webview.html));
  const n = S.toW.length;
  S.type(S.doc.getText().replace('Three の一つ目', 'Three の一つ目！'));
  await sleep(260);
  const out = brief(S, n);
  assert.deepStrictEqual(out.map(m => m.type), ['patch']);
  assert.deepStrictEqual(out[0].slides.map(x => x.index), [2], 'scoped のスライドは変わっていないので送らない');
});

test('部品が読めないとき：検索・配置案が落ちても本体は動き、従来の ★ ギャラリーに退避する', async () => {
  const origLoad = Module._load;
  const hook = function (request, ...rest) {
    if (/(corpus-vscode|layout-variants)\.cjs$/.test(String(request))) throw new Error('読めない（テスト）');
    return origLoad.call(this, request, ...rest);
  };
  const origErr = console.error; console.error = () => {};
  Module._load = hook;
  let S;
  try { S = setupRepo(); } finally { Module._load = origLoad; console.error = origErr; }
  await open();
  const html = S.panel.webview.html;
  assert.ok(html.includes('id="wrap"') && html.includes('One'), 'プレビューは開く');
  assert.ok(!html.includes('__SS_LAYOUTS__ = {') , '判定の表が無ければ layouts.js も入れない');
  let n = S.toW.length;
  S.send({ type: 'corpusSearch', reqId: 5, query: 'x', offset: 0, limit: 9, haveCss: [] });
  const r = last(S, 'corpusResults', n);
  assert.ok(r && r.reqId === 5 && r.items.length === 0 && r.error, '「検索中…」で止めない');
  S.send({ type: 'shelfEdit', op: 'add', shelf: 'x', label: 'y', deck: A_REL, slide: 1 });
  assert.strictEqual(last(S, 'shelfState', n).ok, false);
  S.send({ type: 'corpusPrefetch', kind: 'shelf', reqId: 6, limit: 9, haveCss: [] });
  S.send({ type: 'overflowReport', version: S.doc.version, slides: [] });
  S.send({ type: 'layoutApply', index: 0, version: S.doc.version, cls: 'lay-boxed' });
  S.send({ type: 'corpusInsert', items: [{ deck: A_REL, slide: 1 }], index: 0, version: S.doc.version });
  S.send({ type: 'slideOp', op: 'library', index: 0, version: S.doc.version });
  await sleep(300);
  assert.strictEqual(S.doc.getText(), DEST, '原稿は変えない');
  assert.strictEqual(brief(S, n).filter(m => m.type === 'editResult' && m.ok === false).length, 2);
  assert.ok(brief(S, n).some(m => m.type === 'library'), '📚 は従来の ★ ギャラリー（library メッセージ）');
  // 直接編集は従来どおり
  S.send({ type: 'slideOp', op: 'duplicate', index: 0, version: S.doc.version });
  await sleep(150);
  assert.strictEqual(headings(S.doc).filter(h => h === '# One').length, 2);
});

test('部品があるとき：📚 は検索つきのギャラリー（gallery）を開き、コマンドは ＋ポップアップ（insertPopup）を開く', async () => {
  const S = setupRepo(); await open();
  let n = S.toW.length;
  S.send({ type: 'slideOp', op: 'library', index: 1, version: S.doc.version });
  await sleep(100);
  assert.deepStrictEqual(brief(S, n).filter(m => m.type === 'gallery').map(m => m.index), [1]);
  n = S.toW.length;
  await vscode.commands.executeCommand('marpScrollSync.searchSlides');
  assert.deepStrictEqual(brief(S, n).filter(m => m.type === 'insertPopup').map(m => m.index), [0]);
});

test('corpus-vscode：索引の裏作成は多重起動しない／終わったら読み直す', async () => {
  makeRepo();
  fs.mkdirSync(path.join(REPO, 'tools'), { recursive: true });
  // 原稿の側の tools/marp-library.mjs は「marp-GUI の作業フォルダ」の目印。実行するのは拡張と同じリポジトリの CLI（SEC-01）
  fs.writeFileSync(path.join(REPO, 'tools', 'marp-library.mjs'), 'throw new Error("must not run")\n');
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(EXT, 'lib') + path.sep)) delete require.cache[k];
  const cv = require(path.join(EXT, 'lib', 'corpus-vscode.cjs'));
  const core = require(path.join(EXT, 'lib', 'corpus-core.cjs'));
  const spawned = []; const posted = [];
  const doc = stub.makeDocument(DEST, { fsPath: DEST_MD });
  const c = stub.makeContext(EXT);
  const svc = cv.register(c, {
    isMarpDoc: () => true, repoRootFor: () => REPO, postToPreview: (m) => posted.push(m), panelDoc: () => doc,
    renderForThumb: () => ({ html: '<div class="marpit"><svg data-marpit-svg viewBox="0 0 1 1"><foreignObject><section>a</section></foreignObject></svg></div>', css: 'x' }),
    replaceMinimal: async () => true, afterSlideChange() {}, ensureEditor: async () => null,
    spawn: (cmd, args, o) => { const h = {}; const ch = { on: (ev, fn) => { h[ev] = fn; return ch; }, kill() {}, h, cmd, args, o }; spawned.push(ch); return ch; },
  });
  svc.search(doc, { reqId: 1, query: '', offset: 0, limit: 3, haveCss: [] });
  assert.strictEqual(posted[0].type, 'corpusResults');
  assert.strictEqual(posted[0].building, true, 'corpus.json が無い → その場で作って応答し、裏で作り直す');
  assert.strictEqual(spawned.length, 1);
  assert.deepStrictEqual(spawned[0].args.slice(1), ['corpus', '--root', REPO]);
  assert.strictEqual(spawned[0].args[0], path.resolve(EXT, '..', 'marp-library.mjs'), '同梱の CLI（拡張のフォルダの隣）を動かす');
  assert.ok(!spawned[0].args[0].startsWith(REPO + path.sep), '原稿のリポジトリの tools/marp-library.mjs は実行しない');
  assert.strictEqual(spawned[0].cmd, process.execPath);
  assert.ok(!spawned[0].o.shell);
  assert.strictEqual(spawned[0].o.env.ELECTRON_RUN_AS_NODE, '1');
  svc.rebuild(doc); svc.search(doc, { reqId: 2, query: '', offset: 0, limit: 3, haveCss: [] });
  assert.strictEqual(spawned.length, 1, '走っている間は重ねて起動しない');
  // 子プロセスが churn つきの索引を書いて終わった、という体にする
  const full = core.buildCorpus(REPO, { withChurn: false });
  for (const e of full.entries) if (e.deck === B_REL) e.churn = { touched: e.slide === 2 ? 7 : 1, lines: 70, last: '2026-09-01' };
  full.decks[B_REL].churn = true; full.withChurn = true;
  core.writeCorpus(REPO, full);
  spawned[0].h.exit(0);
  posted.length = 0;
  svc.search(doc, { reqId: 3, query: 'まとめ', offset: 0, limit: 3, haveCss: [] });
  assert.strictEqual(posted[0].building, false);
  assert.strictEqual(posted[0].items[0].touched, 7, '読み直した索引（churn つき）で応える');
  stub.disposeContext(c);
});

// ---------- 通し試験（作者の手元の、配布しない試験）で見つけた不具合の再発防止 ----------
test('サムネイルの html：タグの中の on*= と javascript: の URL を外す（Webview の CSP は unsafe-inline なので、入れると動く）', async () => {
  makeRepo();
  const C_REL = 'slides/20260803_Test_c/20260803_Test_c.md';
  fs.mkdirSync(path.dirname(path.join(REPO, C_REL)), { recursive: true });
  fs.writeFileSync(path.join(REPO, C_REL), deckOf(['Epsilon の危ない部品'], { 0: '\n<img src="./src/none.png" onerror="window.pwned=1" alt="a > b">\n<a href="javascript:alert(1)" onclick=\'x()\'>リンク</a>\n\n本文の onclick= という文字は残す\n' }));
  const S = setup(DEST, { md: DEST_MD }); await open();
  S.send({ type: 'corpusSearch', reqId: 1, query: 'Epsilon', offset: 0, limit: 9, haveCss: [] });
  const it = last(S, 'corpusResults').items[0];
  assert.ok(it && it.html.includes('<img'), 'img 自体は残る');
  assert.ok(!/<[a-zA-Z][^<>]*\son[a-z]+\s*=/i.test(it.html), 'タグの中の on*= は外す');
  assert.ok(!/javascript:/i.test(it.html), 'javascript: の URL は外す');
  assert.ok(it.html.includes('本文の onclick= という文字は残す'), '本文の文字は変えない');
});

test('shelf.json が外で変わったら、次の検索の応答に棚を載せ直す（1 回だけ）', async () => {
  const S = setupRepo(); await open();
  S.send({ type: 'corpusPrefetch', kind: 'shelf', reqId: 1, limit: 9, haveCss: [] });
  S.send({ type: 'corpusSearch', reqId: 2, query: '', sort: 'score', offset: 0, limit: 9, haveCss: [] });
  assert.strictEqual(last(S, 'corpusResults').shelves, undefined, '変わっていなければ棚は載せない');
  fs.mkdirSync(path.dirname(SHELF), { recursive: true });
  fs.writeFileSync(SHELF, JSON.stringify({ version: 1, shelves: [{ name: '外で作った棚', items: [{ label: '外から', deck: A_REL, slide: 1, title: '自己紹介' }] }] }, null, 2) + '\n');
  S.send({ type: 'corpusSearch', reqId: 3, query: '', sort: 'score', offset: 0, limit: 9, haveCss: [] });
  const r3 = last(S, 'corpusResults');
  assert.deepStrictEqual((r3.shelves || []).map(x => [x.name, x.items.map(i => i.label)]), [['外で作った棚', ['外から']]]);
  S.send({ type: 'corpusSearch', reqId: 4, query: '', sort: 'score', offset: 0, limit: 9, haveCss: [] });
  assert.strictEqual(last(S, 'corpusResults').shelves, undefined, '2 度目は載せない');
});

test('原稿を触ったら、検索を待たずに 1.5 秒後に索引を作り直す（印を付けた直後の 📚 に映る）', async () => {
  const S = setupRepo(); await open();
  S.send({ type: 'corpusSearch', reqId: 1, query: 'Gamma', offset: 0, limit: 9, haveCss: [] });
  const a = stub.makeDocument(SRC_A.replace('Gamma の説明', 'Gamma の改題'), { fsPath: path.join(REPO, A_REL) });
  stub.fire.changeDoc(a, [{}]);
  await sleep(1750);
  S.send({ type: 'corpusSearch', reqId: 2, query: '改題', offset: 0, limit: 9, haveCss: [] });
  assert.strictEqual(last(S, 'corpusResults').total, 1, '触ってから最初の検索で、もう当たる');
});

test('書き戻したらすぐ保存する（saveAfterEdit）：editCommit・slideOp・undo は save、書くものが無いとき・設定 off は save しない', async () => {
  const S = setup(DECK); await open();
  const saves = [];
  S.doc.save = async () => { saves.push({ text: S.doc.getText(), edits: state.appliedEdits.length }); return true; };
  // 文字の書き戻し → applyEdit の後に 1 回 save
  S.send({ type: 'editCommit', index: 0, version: S.doc.version, nodes: NODES, changes: [{ k: 1, old: 'alpha', now: 'alphaX' }], then: 'none', line: 7, lineEnd: 8 });
  await sleep(100);
  assert.strictEqual(saves.length, 1);
  assert.strictEqual(saves[0].edits, 1, 'applyEdit の後で保存する');
  assert.ok(saves[0].text.includes('- alphaX'), '保存する中身は書き戻し後の原稿');
  // 書くものが無い editCommit（同じ文字）は save しない
  S.send({ type: 'editCommit', index: 0, version: S.doc.version, nodes: NODES, changes: [{ k: 2, old: 'beta', now: 'beta' }], then: 'none', line: 8, lineEnd: 9 });
  await sleep(100);
  assert.strictEqual(saves.length, 1);
  // スライド操作 → save
  state.messageAnswer = '削除';
  S.send({ type: 'slideOp', op: 'delete', index: 1, version: S.doc.version });
  await sleep(100);
  assert.deepStrictEqual(headings(S.doc), ['# One']);
  assert.strictEqual(saves.length, 2);
  // version 不一致で断ったときは save しない
  S.send({ type: 'slideOp', op: 'duplicate', index: 0, version: S.doc.version - 5 });
  await sleep(100);
  assert.strictEqual(saves.length, 2);
  // プレビューからの undo → 原稿側で undo した後に save
  S.send({ type: 'undo' });
  await sleep(100);
  assert.ok(state.executed.some(x => x.command === 'undo'));
  assert.strictEqual(saves.length, 3);
  // 設定 off → 書き戻しても save しない
  state.config['marpScrollSync.saveAfterEdit'] = false;
  const nodesX = NODES.map(x => (x.t === 'alpha' ? Object.assign({}, x, { t: 'alphaX' }) : x));   // 表示は書き戻し後の文字になっている
  S.send({ type: 'editCommit', index: 0, version: S.doc.version, nodes: nodesX, changes: [{ k: 1, old: 'alphaX', now: 'alphaY' }], then: 'none', line: 7, lineEnd: 8 });
  await sleep(100);
  assert.strictEqual(S.doc.lineAt(7).text, '- alphaY');
  assert.strictEqual(saves.length, 3);
  delete state.config['marpScrollSync.saveAfterEdit'];
  // save が例外を投げても書き戻し自体は成功のまま（editResult に失敗を出さない）
  S.doc.save = async () => { throw new Error('disk full'); };
  const n = S.toW.length;
  const nodesY = NODES.map(x => (x.t === 'alpha' ? Object.assign({}, x, { t: 'alphaY' }) : x));
  S.send({ type: 'editCommit', index: 0, version: S.doc.version, nodes: nodesY, changes: [{ k: 1, old: 'alphaY', now: 'alphaZ' }], then: 'none', line: 7, lineEnd: 8 });
  await sleep(100);
  assert.strictEqual(S.doc.lineAt(7).text, '- alphaZ');
  assert.ok(!brief(S, n).some(m => m.type === 'editResult' && m.ok === false));
});

// ---------- セキュリティの回帰試験（docs/security-review.md SEC-01・SEC-02） ----------
test('▶ プレゼン：同梱の present.mjs を引数の配列で起動する（シェルに命令行を送らない）。原稿のパスの $( ) や ` は展開されない／ワークスペースより上へ repoRoot をたどらない', async () => {
  const cp = require('child_process');
  const { EventEmitter } = require('events');
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-present-'));
  const W = path.join(OUT, 'ws');                                   // 開いているワークスペースフォルダ
  fs.mkdirSync(path.join(OUT, 'theme'), { recursive: true });       // ワークスペースの外（1 つ上）の theme/academic.css
  fs.writeFileSync(path.join(OUT, 'theme', 'academic.css'), '/* @theme academic */');
  const md = path.join(W, 'slides', 'a$(touch PWNED)`id`', 'deck.md');
  const calls = [];
  const origSpawn = cp.spawn, origWf = vscode.workspace.getWorkspaceFolder;
  cp.spawn = (cmd, args, o) => {
    calls.push({ cmd, args, o });
    const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter();
    setImmediate(() => ch.emit('close', 0));
    return ch;
  };
  try {
    const S = setup(DECK, { md });
    S.doc.save = async () => true;
    vscode.workspace.getWorkspaceFolder = (uri) => (uri && uri.fsPath && uri.fsPath.startsWith(W + path.sep) ? { uri: { fsPath: W } } : undefined);
    await vscode.commands.executeCommand('marpScrollSync.present');
    await sleep(20);
    assert.strictEqual(calls.length, 1, JSON.stringify(calls.map(c => c.args)));
    const c = calls[0];
    assert.strictEqual(c.cmd, process.execPath);
    assert.ok(Array.isArray(c.args), '引数は配列');
    assert.deepStrictEqual(c.args, [path.resolve(EXT, '..', 'marp-present', 'present.mjs'), md, '--page', '1'], '原稿のパスは 1 つの引数のまま渡る');
    assert.ok(!c.o.shell, 'shell: true にしない');
    assert.strictEqual(c.o.cwd, W, 'repoRoot はワークスペースフォルダの中に限る（外の theme/academic.css まで上がらない）');
    assert.strictEqual((state.terminals || []).length, 0, '統合ターミナルに命令行を送らない');
    assert.ok(!fs.existsSync(path.join(W, 'PWNED')) && !fs.existsSync(path.join(EXT, 'PWNED')));
  } finally {
    cp.spawn = origSpawn; vscode.workspace.getWorkspaceFolder = origWf;
    fs.rmSync(OUT, { recursive: true, force: true });
  }
});
