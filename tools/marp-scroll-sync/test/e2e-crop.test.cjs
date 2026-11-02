// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 通し試験（E2E）：画像のトリミング（DESIGN.md 9.6）。仮想 VS Code の上で本物の extension.js を動かし、
// 本物の Webview HTML（preview.js ＋ boxedit.js）を Chrome に読み込んで、Alt で選んだ画像を C／✂ で切る。
//   node --test tools/marp-scroll-sync/test/e2e-crop.test.cjs
//   作業フォルダ：OS の一時フォルダ（終わったら消す）。Chrome が無ければ skip。
// 原稿は合成の 4 枚（題・html の画像・Markdown の画像・中央寄せと !important）。画像は slides/assets の
// 見本の顔写真（400×400）。.qr の中では 175px 幅・左右 auto の余白が 262.5px（半端な 0.5px）になり、
// 「切って外すと原稿が元に戻る」ことを、四捨五入の境目で確かめられる。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers/e2e-harness.cjs');

const WORK = path.join(os.tmpdir(), 'marp-scroll-sync-e2e-crop-' + process.pid);
const BUDGET = 400;   // ms（DESIGN 8.0：操作から表示まで 0.4 秒）。CI の共有ランナーでは測るだけ
const Q = 400;        // settle の静穏時間
const FRONT = [
  '---', 'marp: true', 'theme: academic', 'paginate: true', 'size: 16:9',
  `header: '<div class="hdr-left">E2E</div><img class="hdr-logo" src="../assets/logo-placeholder.png" alt="Logo">'`,
  "footer: ''", '---', '',
].join('\n');
let browser, repo;
let deckSeq = 0;
const timings = [];
const haveChrome = !!H.findChrome();
const note = (label, ms) => { timings.push([label, ms]); };
test.before(async () => {
  if (!haveChrome) return;
  browser = await H.launch();
  repo = H.makeRepo(WORK, []);
});
test.after(async () => {
  if (browser) await browser.close();
  for (const [l, ms] of timings) console.log(`# 実測 ${l}: ${Math.round(ms)}ms`);
  fs.rmSync(WORK, { recursive: true, force: true });
});
function newDeck(body) {
  const name = 'e2e-crop' + (++deckSeq);
  const dir = path.join(repo.root, 'slides', name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const md = path.join(dir, name + '.md');
  fs.writeFileSync(md, FRONT + body);
  return md;
}
async function open(md, o) {
  const S = await H.openSession(Object.assign({ browser, mdPath: md, width: 1100, height: 900 }, o || {}));
  await S.settle(Q);
  return S;
}

const noErrors = (S, label) => {
  assert.deepEqual(S.consoleErrors, [], label + ': ブラウザのコンソールエラー');
  assert.deepEqual(S.extErrors.filter(e => !/local file is missing|@import/.test(e)), [], label + ': 拡張側の console.error');
};
const redraws = (S, mk) => S.sinceW(mk).filter(m => m.type === 'render' || m.type === 'patch');

async function undo(S) {
  const mk = S.mark();
  await S.page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
  await S.page.keyboard.down('Control'); await S.page.keyboard.press('z'); await S.page.keyboard.up('Control');
  await S.settle(Q);
  assert.equal(S.sinceE(mk, 'undo').length, 1, 'undo メッセージが拡張へ届く');
}

const toastText = (S) => S.page.evaluate(() => { const t = document.querySelector('.ss-toast'); return t && t.classList.contains('ss-show') ? t.textContent : ''; });

const T = (name, o, fn) => { if (typeof o === 'function') { fn = o; o = {}; } return test(name, Object.assign({ skip: haveChrome ? false : 'Chrome が見つからない', timeout: 240000 }, o), fn); };

/** スライド idx の中の selector の要素（画面に入れてから測る）。k は表示の縮小率、s* はスライドの座標（1280×720） */
async function boxRect(S, idx, selector, nth) {
  return S.page.evaluate((idx, selector, nth) => {
    const P = window.ssPreview, sec = P.sectionOf(P.slides()[idx]);
    const el = sec.querySelectorAll(selector)[nth || 0];
    if (!el) return null;
    const r0 = el.getBoundingClientRect();
    if (r0.top < 80 || r0.bottom > window.innerHeight - 80) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect(), s = sec.getBoundingClientRect(), cs = getComputedStyle(el);
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, k: s.width / 1280,
      sx: (r.left - s.left) / (s.width / 1280), sy: (r.top - s.top) / (s.width / 1280), sw: r.width / (s.width / 1280), sh: r.height / (s.width / 1280),
      style: el.getAttribute('style') || '', cssW: cs.width, cssH: cs.height, translate: cs.translate, marginLeft: cs.marginLeft };
  }, idx, selector, nth || 0);
}
async function altClick(S, x, y) {
  await S.page.mouse.move(x, y);
  await S.page.keyboard.down('Alt');
  await S.page.mouse.down(); await S.page.mouse.up();
  await S.page.keyboard.up('Alt');
}
/** (x,y) から (dx,dy) だけドラッグする。Cmd/Ctrl を押して吸着を切る（値を決め打ちで確かめるため） */
async function boxDrag(S, x, y, dx, dy, o) {
  o = o || {};
  await S.page.mouse.move(x, y);
  if (!o.snap) await S.page.keyboard.down('Meta');
  await S.page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await S.page.mouse.move(x + dx * i / 8, y + dy * i / 8);
    await S.page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  }
  if (o.beforeUp) await o.beforeUp();
  await S.page.mouse.up();
  if (!o.snap) await S.page.keyboard.up('Meta');
}
/** 確定（boxCommit を送る瞬間）から、描き直しの次の描画フレームまでを測る時計。
 *  boxedit.js は window の capture でポインタ・キーのイベントを止めるので、外からは確定の瞬間を拾えない。
 *  boxCommit を送る瞬間を起点にして、boxedit.js が自分で測った「pointerup → boxCommit」を足す */
async function installBoxProbe(S) {
  await S.page.evaluate(() => {
    if (window.__ssBoxProbe) return;
    const P = window.__ssBoxProbe = { t0: 0, redraw: null, kind: null };
    const post0 = window.ssPreview.post;
    window.ssPreview.post = function (m) {
      if (m && m.type === 'boxCommit') { P.t0 = performance.now(); P.redraw = null; P.kind = null; }
      return post0.apply(this, arguments);
    };
    window.ssPreview.onRender((e) => { const k = e.kind; requestAnimationFrame(() => { if (P.redraw == null) { P.redraw = performance.now() - P.t0 + (window.ssBoxEdit.stats.upToCommitMs || 0); P.kind = k; } }); });
  });
}
const boxProbe = (S) => S.page.evaluate(() => Object.assign({}, window.__ssBoxProbe));
const boxSel = (S) => S.page.evaluate(() => {
  const s = window.ssBoxEdit && window.ssBoxEdit.selected();
  return s ? { tag: s.el.tagName.toLowerCase(), cls: String(s.el.className || ''), target: s.target, refused: s.refused || null, connected: s.el.isConnected } : null;
});
/** 原稿の行ごとの差分（行数が同じ前提）。[行番号, 前, 後] */
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  assert.equal(A.length, B.length, '行数が変わらない');
  const out = [];
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) out.push([i, A[i], B[i]]);
  return out;
}
const styleOf = (line) => { const m = /\sstyle="([^"]*)"/.exec(line); return m ? m[1] : null; };

const CROP_FIG = path.join(H.REPO_ROOT, 'slides', 'assets', 'profile-placeholder.png');
const CROP_BODY = [
  '<div class="page-title">試験の表紙</div>', '', '# トリミング', '', '見本の著者', '',
  '---', '',
  '<div class="page-title">img を切る</div>', '', '## html の画像', '',
  '<div class="figbox">', '<img src="./src/fig.png" alt="図" style="width: 260px">', '</div>', '',
  '<div class="after">下の段落</div>', '',
  '---', '',
  '<div class="page-title">md を切る</div>', '', '## Markdown の画像', '',
  '![w:240 見本](./src/fig.png)', '',
  '<div class="after">下の段落2</div>', '',
  '---', '',
  '<div class="page-title">中央寄せと important</div>', '', '## auto と !important', '',
  '<style scoped>', '  section .imp img { clip-path: none !important; width: 160px; }', '</style>', '',
  '<div class="qr" style="width: 700px"><img src="./src/fig.png" alt="中央"></div>', '',
  '<div class="imp"><img src="./src/fig.png" alt="imp"></div>', '',
].join('\n');
/** 選択枠（見えている範囲）と札・✂ ボタン */
const cropUi = (S) => S.page.evaluate(() => {
  const vis = (e) => e && getComputedStyle(e).display !== 'none';
  const b = document.querySelector('.ss-box-sel'), btn = document.querySelector('.ss-box-cropbtn'), g = document.querySelector('.ss-box-ghost');
  const r = b.getBoundingClientRect(), br = btn.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2,
    tag: (document.querySelector('.ss-box-tag-sel') || {}).textContent || '', btn: vis(btn) ? btn.textContent : '',
    bx: br.left + br.width / 2, by: br.top + br.height / 2, ghost: vis(g), state: window.ssBoxEdit.cropState() };
});

T('トリミング：<img> を C で切る → Enter で 1 回だけ書く（clip-path と margin-*）→ 0 で外す。Esc で取り消し。Markdown の画像は <img> に書き換える', async () => {
  assert.ok(fs.existsSync(CROP_FIG), '見本の画像がある: ' + CROP_FIG);
  const md = newDeck(CROP_BODY);
  fs.copyFileSync(CROP_FIG, path.join(path.dirname(md), 'src', 'fig.png'));
  const S = await open(md, { width: 1400, height: 900 });
  try {
    const t0 = S.doc.getText();
    const IMG = '.figbox img';
    await S.page.evaluate(() => window.ssPreview.slides()[1].scrollIntoView({ block: 'center', behavior: 'instant' }));
    await H.sleep(200);
    let r = await boxRect(S, 1, IMG);
    const below0 = (await boxRect(S, 1, '.after')).sy;
    const m0 = await S.page.evaluate(() => { const P = window.ssPreview, el = P.sectionOf(P.slides()[1]).querySelector('.figbox img'); const cs = getComputedStyle(el); return [parseFloat(cs.marginTop), parseFloat(cs.marginBottom)]; });
    await altClick(S, r.cx, r.cy);
    let sel = await boxSel(S);
    assert.deepEqual([sel.tag, sel.target.kind], ['img', 'html'], JSON.stringify(sel));
    let ui = await cropUi(S);
    assert.equal(ui.btn, '✂ 切る', '札の右に ✂ ボタン');

    // C でトリミングへ。上の縁を 40 下げ、下の縁を 60 上げる（ドラッグ中は送らない）
    const d0 = S.undoDepth();
    let mk = S.mark();
    await S.page.keyboard.press('c');
    ui = await cropUi(S);
    assert.deepEqual(ui.state && ui.state.cut, [0, 0, 0, 0], 'トリミング中');
    assert.equal(ui.btn, '✓ 確定');
    await boxDrag(S, ui.cx, ui.y, 0, 40 * r.k);
    ui = await cropUi(S);
    await boxDrag(S, ui.cx, ui.y + ui.h, 0, -60 * r.k);
    ui = await cropUi(S);
    assert.deepEqual(ui.state.cut, [40, 0, 60, 0], JSON.stringify(ui.state));
    assert.match(ui.tag, /切り: 上40 右0 下60 左0/, ui.tag);
    assert.ok(ui.ghost, '切られる部分を暗く重ねて見せる');
    assert.ok(Math.abs(ui.h / r.k - (r.sh - 100)) < 1.5, `枠は見えている範囲: ${ui.h / r.k} / ${r.sh - 100}`);
    const live = (await boxRect(S, 1, '.after')).sy;
    assert.ok(Math.abs(below0 - live - 100) < 1.5, `周りが詰まる: ${below0} → ${live}`);
    assert.equal(S.sinceE(mk, 'boxCommit').length, 0, '確定までは送らない');
    // 矢印は直前に触った縁（下）を動かす：↑ で 10 切り増し → ↓ で戻す
    await S.page.keyboard.down('Shift'); await S.page.keyboard.press('ArrowUp'); await S.page.keyboard.up('Shift');
    assert.deepEqual((await cropUi(S)).state.cut, [40, 0, 70, 0]);
    await S.page.keyboard.down('Shift'); await S.page.keyboard.press('ArrowDown'); await S.page.keyboard.up('Shift');

    // Enter で確定：boxCommit 1 回、原稿の 1 行、undo 1 回、patch で 1 枚
    await installBoxProbe(S);
    await S.page.keyboard.press('Enter');
    await S.waitFor(async () => (await boxProbe(S)).redraw != null, 'トリミングのあとの描き直し', 3000);
    const p = await boxProbe(S);
    note('トリミング：Enter → 表示の確定（' + p.kind + '）', p.redraw);
    if (!process.env.CI) assert.ok(p.redraw < BUDGET, `Enter から表示まで ${Math.round(p.redraw)}ms`);
    await S.settle(Q);
    assert.equal(S.sinceE(mk, 'boxCommit').length, 1, 'boxCommit は 1 回');
    assert.deepEqual(redraws(S, mk).map(m => m.type), ['patch'], '1 枚だけ差し替える');
    assert.equal(S.undoDepth(), d0 + 1, '1 操作＝undo 1 回');
    const t1 = S.doc.getText();
    let df = lineDiff(t0, t1);
    assert.equal(df.length, 1, JSON.stringify(df));
    const st = styleOf(df[0][2]);
    assert.equal(st, `width: 260px; clip-path: inset(40px 0 60px 0); margin-top: ${Math.round(m0[0] - 40)}px; margin-bottom: ${Math.round(m0[1] - 60)}px`);
    sel = await boxSel(S);
    assert.ok(sel && sel.connected && sel.tag === 'img', 'patch の後も選択が続く: ' + JSON.stringify(sel));
    ui = await cropUi(S);
    assert.equal(ui.state, null, 'トリミングは終わる');
    assert.match(ui.tag, /切り: 上40 右0 下60 左0/, '札に切り量: ' + ui.tag);
    const after = await boxRect(S, 1, '.after');
    assert.ok(Math.abs(after.sy - live) < 1.5, `描き直した後も同じ位置: ${live} → ${after.sy}`);
    const cs = await S.page.evaluate(() => { const P = window.ssPreview; return getComputedStyle(P.sectionOf(P.slides()[1]).querySelector('.figbox img')).clipPath; });
    assert.match(cs, /^inset\(40px 0px 60px/, cs);

    // Esc：切り直しても送らず、見た目が戻る
    mk = S.mark();
    await S.page.keyboard.press('c');
    ui = await cropUi(S);
    assert.deepEqual(ui.state.cut, [40, 0, 60, 0], '前の切り量から始まる');
    await boxDrag(S, ui.x, ui.cy, 50 * r.k, 0);
    assert.deepEqual((await cropUi(S)).state.cut, [40, 0, 60, 50]);
    await S.page.keyboard.press('Escape');
    await S.settle(Q);
    assert.equal(S.sinceE(mk, 'boxCommit').length, 0, 'Esc は送らない');
    r = await boxRect(S, 1, IMG);
    assert.match(r.style, /clip-path: inset\(40px 0(px)? 60px( 0(px)?)?\)/, '元の切り量へ戻る: ' + r.style);
    assert.ok(!/margin-left/.test(r.style), r.style);
    assert.ok(await boxSel(S), 'Esc 1 回目は選択を残す');

    // 0：トリミングを外して確定 → 原稿は元どおり
    mk = S.mark();
    await S.page.keyboard.press('c');
    await S.page.keyboard.press('0');
    await S.settle(Q);
    assert.equal(S.sinceE(mk, 'boxCommit').length, 1);
    assert.equal(S.doc.getText(), t0, '0 で外すと原稿は元どおり');
    assert.ok(Math.abs((await boxRect(S, 1, '.after')).sy - below0) < 1.5, '周りも元の位置');
    await undo(S);
    assert.equal(S.doc.getText(), t1, 'undo で切った状態へ');
    await undo(S);
    assert.equal(S.doc.getText(), t0);

    // Markdown の画像：✂ ボタン → 左の縁を 30 → Enter で確定。<p><img> に書き換わり、選択は <img> へ引き継ぐ
    await S.page.keyboard.press('Escape');
    await S.page.evaluate(() => window.ssPreview.slides()[2].scrollIntoView({ block: 'center', behavior: 'instant' }));
    await H.sleep(200);
    r = await boxRect(S, 2, 'p img');
    await altClick(S, r.cx, r.cy);
    sel = await boxSel(S);
    assert.equal(sel.target.kind, 'mdimg', JSON.stringify(sel));
    ui = await cropUi(S);
    mk = S.mark();
    await S.page.mouse.click(ui.bx, ui.by);
    ui = await cropUi(S);
    assert.ok(ui.state, '✂ でトリミングへ');
    await boxDrag(S, ui.x, ui.cy, 30 * r.k, 0);
    const d1 = S.undoDepth();
    await S.page.keyboard.press('Enter');
    await S.settle(Q);
    assert.equal(S.sinceE(mk, 'boxCommit').length, 1);
    assert.equal(S.undoDepth(), d1 + 1, '書き換えとトリミングで 1 回');
    df = lineDiff(t0, S.doc.getText());
    assert.equal(df.length, 1, JSON.stringify(df));
    assert.equal(df[0][1], '![w:240 見本](./src/fig.png)');
    assert.match(df[0][2], /^<p><img src="\.\/src\/fig\.png" alt="見本" style="width: 240px; clip-path: inset\(0 0 0 30px\); margin-left: -?\d+px"><\/p>$/, df[0][2]);
    assert.match(await toastText(S), /Markdown の画像を <img> に書き換えました/);
    sel = await boxSel(S);
    assert.ok(sel && sel.connected && sel.target.kind === 'html' && sel.target.tag === 'img', '書き換えた <img> を選んだまま: ' + JSON.stringify(sel));
    await undo(S);
    assert.equal(S.doc.getText(), t0);

    // 外側クリックでも確定する（右の縁を 20）
    await S.page.keyboard.press('Escape');
    await S.page.evaluate(() => window.ssPreview.slides()[1].scrollIntoView({ block: 'center', behavior: 'instant' }));
    await H.sleep(200);
    r = await boxRect(S, 1, IMG);
    await altClick(S, r.cx, r.cy);
    await S.page.keyboard.press('c');
    ui = await cropUi(S);
    await boxDrag(S, ui.x + ui.w, ui.cy, -20 * r.k, 0);
    mk = S.mark();
    const out = await boxRect(S, 1, '.after');
    await S.page.mouse.click(out.x + out.w + 30, out.cy);   // 外側クリック＝確定
    await S.settle(Q);
    assert.equal(S.sinceE(mk, 'boxCommit').length, 1, '外側クリックで 1 回');
    df = lineDiff(t0, S.doc.getText());
    assert.equal(df.length, 1, JSON.stringify(df));
    assert.match(styleOf(df[0][2]), /^width: 260px; clip-path: inset\(0 20px 0 0\); margin-right: -?\d+px$/, df[0][2]);
    assert.equal(await boxSel(S), null, '外側クリックは選択も終える');
    assert.equal(['revealLine', 'revealText', 'revealSlide'].reduce((n, ty) => n + S.sinceE(mk, ty).length, 0), 0, 'そのクリックで原稿へ飛ばない');
    await undo(S);
    assert.equal(S.doc.getText(), t0);

    // テーマの margin: 0 auto（.qr img）：左を切ると中央寄せの左を今の数値で固定し、知らせる。見えている左端は動かない
    await S.page.evaluate(() => window.ssPreview.slides()[3].scrollIntoView({ block: 'center', behavior: 'instant' }));
    await H.sleep(200);
    r = await boxRect(S, 3, '.qr img');
    await altClick(S, r.cx, r.cy);
    await S.page.keyboard.press('c');
    ui = await cropUi(S);
    await boxDrag(S, ui.x, ui.cy, 20 * r.k, 0);
    await S.page.keyboard.press('Enter');
    await S.settle(Q);
    let l = S.doc.getText().split('\n').find(x => x.startsWith('<div class="qr"'));
    assert.match(await toastText(S), /中央寄せ/, '中央寄せを固定したと知らせる: ' + l);
    const ml = /margin-left: (-?\d+)px/.exec(l);
    assert.ok(ml && /clip-path: inset\(0 0 0 20px\)/.test(l), l);
    let r2 = await boxRect(S, 3, '.qr img');
    assert.ok(Math.abs(r2.sx + 20 - r.sx) < 1.5, `見えている左端は動かない: ${r.sx} → ${r2.sx + 20}`);
    // 外す（C → 0）と auto に戻る。auto の余白が X.5px のとき、四捨五入した数との差がちょうど 0.5 になる（以前は < 0.5 で比べて
    // margin-left: 263px が原稿に残っていた。boxedit.js の marginFor）
    await S.page.keyboard.press('c'); await S.page.keyboard.press('0');
    await S.settle(Q);
    assert.equal(S.doc.getText(), t0, '外すと auto に戻る（原稿は元どおり。auto の余白 ' + r.marginLeft + '）');
    // デック側が clip-path: none !important：!important つきで書く
    await S.page.keyboard.press('Escape');
    r = await boxRect(S, 3, '.imp img');
    await altClick(S, r.cx, r.cy);
    await S.page.keyboard.press('c');
    ui = await cropUi(S);
    await boxDrag(S, ui.cx, ui.y + ui.h, 0, -30 * r.k);
    await S.page.keyboard.press('Enter');
    await S.settle(Q);
    l = S.doc.getText().split('\n').find(x => x.startsWith('<div class="imp">'));
    assert.match(l, /style="clip-path: inset\(0 0 30px 0\) !important; margin-bottom: -?\d+px !important"/, l);
    r2 = await boxRect(S, 3, '.imp img');
    const cp = await S.page.evaluate(() => { const P = window.ssPreview; return getComputedStyle(P.sectionOf(P.slides()[3]).querySelector('.imp img')).clipPath; });
    assert.match(cp, /^inset\(0px 0px 30px/, '効いている: ' + cp);
    await undo(S);
    assert.equal(S.doc.getText(), t0);
    noErrors(S, 'トリミング');
  } finally { await S.close(); }
});
