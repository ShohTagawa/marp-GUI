// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// media/preview.js（プレビューのブラウザ側 UI）のテスト。puppeteer-core＋手元の Chrome で、見本デック（slides/ の sample-*）を描画して操作する。
//   node --test tools/marp-scroll-sync/test/preview.test.cjs
// Chrome か puppeteer-core が無い環境では全部 skip。
// スクリーンショットは環境変数 SS_SHOT_DIR（無ければ os.tmpdir() の下）に書く。目視確認用で、合否には使わない。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers/preview-harness.cjs');

const OUT = process.env.SS_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'ss-preview-'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const REVEAL_WAIT = 450;   // 逆引きの遅延（250ms）より十分長く

let browser = null, built = null, FX = -1;
before(async () => {
  built = H.buildPreviewHtml({ count: 10 });
  FX = built.fixtureIndex;
  browser = await H.launch();
});
after(async () => { if (browser) await browser.close(); });

/** テスト1本ごとに新しいページを開く（状態を持ち越さない） */
async function withPage(t, opts, fn) {
  if (!browser) { t.skip('Chrome か puppeteer-core が見つからない'); return; }
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const b = (opts.init || opts.md != null) ? H.buildPreviewHtml({ count: 10, init: opts.init, md: opts.md }) : built;
  const page = await H.openPage(browser, b, { outDir: OUT, width: opts.width || 1000, height: 800, name: `t-${process.pid}-${Math.random().toString(36).slice(2)}.html` });
  try {
    await fn(page);
    assert.deepEqual(page.__errors.filter(e => !/Content Security Policy.*stylesheet|Loading the stylesheet/.test(e)), [], 'ページ内で例外が出ていない');
  } finally { await page.close(); }
}
const posted = (page, type) => page.evaluate((ty) => window.__posted.filter(m => ty ? m.type === ty : m.type !== 'corpusPrefetch'), type || null);
const clearPosted = (page) => page.evaluate(() => { window.__posted.length = 0; });
const send = (page, msg) => page.evaluate((m) => { window.postMessage(m, '*'); return new Promise(r => setTimeout(r, 30)); }, msg);

/** スライド index の section の中で、文字列 sub を含むテキストノードを探し、その部分の画面上の矩形（中心）を返す。見える位置へスクロールもする */
async function textPoint(page, index, sub, where) {
  const r = await page.evaluate((index, sub, where) => {
    const frame = document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[index];
    const sec = frame.querySelector('section');
    const all = window.ssCollectTextNodes(sec);
    const k = all.findIndex(n => n.t.includes(sub));
    if (k < 0) return null;
    const node = all[k].node;
    node.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' });
    const at = node.nodeValue.indexOf(sub);
    const rg = document.createRange();
    rg.setStart(node, at); rg.setEnd(node, at + sub.length);
    const b = rg.getBoundingClientRect();
    const x = where === 'start' ? b.left + 1 : where === 'end' ? b.right - 1 : b.left + b.width / 2;
    return { k, x, y: b.top + b.height / 2, left: b.left, right: b.right, t: all[k].t, line: all[k].near ? all[k].near.start : null };
  }, index, sub, where || 'center');
  assert.ok(r, `「${sub}」がスライド ${index} に見つかる`);
  return r;
}
async function dbl(page, pt) { await page.mouse.click(pt.x, pt.y, { clickCount: 2, delay: 30 }); await sleep(60); }
const editingInfo = (page) => page.evaluate(() => {
  const el = document.querySelector('.ss-editing');
  const input = document.querySelector('.ss-svg-input');
  return { tag: el ? el.tagName.toLowerCase() : null, ce: el ? el.getAttribute('contenteditable') : null,
    cls: el ? el.className : null, input: input ? input.value : null,
    sectionCe: !!document.querySelector('section[contenteditable]') };
});
/** 編集中の要素の中で、sub を含むテキストノードの offset 位置（'end' は末尾）へキャレットを置く */
const caretIn = (page, sub, pos) => page.evaluate((sub, pos) => {
  const el = document.querySelector('.ss-editing');
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.includes(sub)) {
    const r = document.createRange(); r.setStart(n, pos === 'end' ? n.nodeValue.length : pos); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); return true;
  }
  return false;
}, sub, pos);

test('初期表示：UI を自前で作り、acquireVsCodeApi は1回だけ', async (t) => {
  await withPage(t, { init: { index: 2, marks: [false, false, true, false, false, false, false, false, false, false, true] } }, async (page) => {
    const s = await page.evaluate(() => ({
      acquired: window.__acquired,
      badge: document.querySelector('.ss-badge').textContent,
      cur: Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]')).findIndex(x => x.classList.contains('current-slide')),
      ops: Array.from(document.querySelectorAll('.ss-ops button')).map(b => b.getAttribute('data-op')),
      tuner: !!document.getElementById('ss-tuner'), toast: !!document.querySelector('.ss-toast'), gallery: !!document.querySelector('.ss-gallery'),
      stars: document.querySelectorAll('.ss-mark').length,
      markOn: document.querySelector('.ss-ops button[data-op="mark"]').classList.contains('ss-on'),
      hscroll: document.documentElement.scrollWidth > window.innerWidth,
    }));
    assert.equal(s.acquired, 1);
    assert.equal(s.badge, 'Slide 3/11');
    assert.equal(s.cur, 2);
    assert.deepEqual(s.ops, ['new', 'duplicate', 'moveUp', 'moveDown', 'delete', 'mark', 'library']);
    assert.ok(s.tuner && s.toast && s.gallery);
    assert.equal(s.stars, 2, '印のあるスライドの数だけ ★');
    assert.equal(s.markOn, true, '現在のスライドに印があれば ★ ボタンが点灯');
    assert.equal(s.hscroll, false, '横スクロールが出ない');
  });
});

test('単クリック → 遅延後に revealLine が1回', async (t) => {
  await withPage(t, async (page) => {
    const pt = await textPoint(page, 2, 'のしくみを知る');
    await page.mouse.click(pt.x, pt.y);
    assert.equal((await posted(page)).length, 0, 'すぐには送らない（ダブルクリック待ち）');
    await sleep(REVEAL_WAIT);
    const p = await posted(page);
    assert.equal(p.length, 1);
    assert.equal(p[0].type, 'revealLine');
    assert.equal(p[0].index, 2);
    assert.ok(built.lines[p[0].line].includes('のしくみを知る'), '原稿のその行に同じ文字がある');
    assert.ok(p[0].px > 0);
  });
});

test('余白のクリック → revealSlide', async (t) => {
  await withPage(t, async (page) => {
    const pt = await page.evaluate(() => {
      const f = document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[3];   // divider：右下は余白
      f.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = f.getBoundingClientRect(); return { x: r.right - 120, y: r.bottom - 60 };
    });
    await page.mouse.click(pt.x, pt.y);
    await sleep(REVEAL_WAIT);
    const p = await posted(page);
    assert.equal(p.length, 1);
    assert.ok(['revealSlide', 'revealLine', 'revealText'].includes(p[0].type));
    assert.equal(p[0].index, 3);
  });
});

test('ダブルクリック → reveal は送られず、葉のブロックだけが編集になる', async (t) => {
  await withPage(t, async (page) => {
    const pt = await textPoint(page, 2, 'のしくみを知る');
    await dbl(page, pt);
    await sleep(REVEAL_WAIT);
    assert.deepEqual(await posted(page), []);
    const e = await editingInfo(page);
    assert.equal(e.tag, 'li');
    assert.equal(e.ce, 'plaintext-only');
    assert.equal(e.sectionCe, false, 'section には contenteditable を付けない');
  });
});

test('li を編集して Enter → changes は1件で nodes[k].t === old', async (t) => {
  await withPage(t, async (page) => {
    const pt = await textPoint(page, 2, 'のしくみを知る');
    await dbl(page, pt);
    await caretIn(page, 'のしくみを知る', 'end');
    await page.keyboard.type('よ');
    await page.keyboard.press('Enter');
    await sleep(REVEAL_WAIT);
    const p = await posted(page);
    assert.equal(p.length, 1, '確定の1件だけ（逆引きは混ざらない）');
    const m = p[0];
    assert.equal(m.type, 'editCommit');
    assert.equal(m.index, 2);
    assert.equal(m.version, 12);
    assert.equal(m.then, 'none');
    assert.equal(m.changes.length, 1);
    const c = m.changes[0];
    assert.equal(m.nodes[c.k].t, c.old);
    assert.equal(c.now, c.old + 'よ');
    assert.deepEqual(Object.keys(m.nodes[0]).sort(), ['near', 'svg', 't'], 'nodes は { t, near, svg } だけ');
    assert.ok(Number.isInteger(m.line) && built.lines[m.line].includes('のしくみを知る'));
    assert.ok(m.lineEnd > m.line);
    assert.equal((await editingInfo(page)).tag, null, '編集状態が解けている');
    assert.equal(await page.evaluate(() => !!document.querySelector('[contenteditable]')), false);
  });
});

test('変えずに Enter → 何も送らない／Esc → 何も送らず DOM が元に戻る', async (t) => {
  await withPage(t, async (page) => {
    const pt = await textPoint(page, 2, 'のしくみを知る');
    const html0 = await page.evaluate(() => document.getElementById('wrap').innerHTML);
    await dbl(page, pt);
    await page.keyboard.press('Enter');
    await sleep(80);
    assert.deepEqual(await posted(page), []);
    await dbl(page, await textPoint(page, 2, 'のしくみを知る'));
    await page.keyboard.type('消える文字');
    assert.ok((await page.evaluate(() => document.getElementById('wrap').innerHTML)) !== html0);
    await page.keyboard.press('Escape');
    await sleep(REVEAL_WAIT);
    assert.deepEqual(await posted(page), []);
    const html1 = await page.evaluate(() => document.getElementById('wrap').innerHTML);
    // 巨大な文字列を assert の差分に出さない
    assert.ok(html1 === html0, `クラスも属性も残さず元どおり（長さ ${html0.length} → ${html1.length}）`);
  });
});

test('**太字** を含む行で、太字の外側だけを編集 → changes はそのノードだけ', async (t) => {
  await withPage(t, async (page) => {
    await dbl(page, await textPoint(page, FX, 'そして後半も普通'));
    assert.equal((await editingInfo(page)).tag, 'li');
    await caretIn(page, 'そして後半も普通', 'end');
    await page.keyboard.type('です');
    await page.keyboard.press('Enter');
    const [m] = await posted(page, 'editCommit');
    assert.equal(m.changes.length, 1);
    assert.equal(m.changes[0].old, ' そして後半も普通');
    assert.equal(m.changes[0].now, ' そして後半も普通です');
    assert.equal(m.nodes[m.changes[0].k].t, m.changes[0].old);
    assert.equal(await page.evaluate(() => document.querySelectorAll('strong').length > 0 && !!Array.from(document.querySelectorAll('strong')).find(s => s.textContent === 'ここは太字')), true, '太字の要素は壊れていない');
  });
});

test('太字の中をダブルクリック → 親の li が編集になり、太字の中だけ変わる', async (t) => {
  await withPage(t, async (page) => {
    await dbl(page, await textPoint(page, FX, 'ここは太字'));
    assert.equal((await editingInfo(page)).tag, 'li', 'strong でなく、それを含むブロック');
    await caretIn(page, 'ここは太字', 'end');
    await page.keyboard.type('!');
    await page.keyboard.press('Enter');
    const [m] = await posted(page, 'editCommit');
    assert.deepEqual(m.changes.map(c => [c.old, c.now]), [['ここは太字', 'ここは太字!']]);
  });
});

test('span.hl を含む行で、外側だけを編集', async (t) => {
  await withPage(t, async (page) => {
    await dbl(page, await textPoint(page, FX, 'のあとに続く'));
    await caretIn(page, 'のあとに続く', 'end');
    await page.keyboard.type('。');
    await page.keyboard.press('Enter');
    const [m] = await posted(page, 'editCommit');
    assert.deepEqual(m.changes.map(c => [c.old, c.now]), [[' のあとに続く', ' のあとに続く。']]);
    assert.equal(m.nodes[m.changes[0].k].near.kind, 'md');
  });
});

test('全部消して打ち直す → 1件の書き換えとして扱う', async (t) => {
  await withPage(t, async (page) => {
    await dbl(page, await textPoint(page, FX, 'jk を打つ行'));
    await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta');
    await page.evaluate(() => { const el = document.querySelector('.ss-editing'); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await page.keyboard.type('新しい行');
    await page.keyboard.press('Enter');
    const [m] = await posted(page, 'editCommit');
    assert.deepEqual(m.changes.map(c => [c.old, c.now]), [['jk を打つ行', '新しい行']]);
  });
});

test("編集中の 'j' 'k' と矢印キー → 文字として入る／キャレットが動く（スライド送りにならない）", async (t) => {
  await withPage(t, async (page) => {
    await send(page, { type: 'scrollToSlide', index: FX });
    await dbl(page, await textPoint(page, FX, 'jk を打つ行'));
    await caretIn(page, 'jk を打つ行', 'end');
    await page.keyboard.type('jack');
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('Z');
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown');
    await page.keyboard.press('PageDown'); await page.keyboard.press('Home');
    const mid = await page.evaluate(() => ({ text: document.querySelector('.ss-editing').textContent, badge: document.querySelector('.ss-badge').textContent }));
    assert.ok(mid.text.includes('jaZck'), mid.text);
    assert.equal(mid.badge, `Slide ${FX + 1}/11`, 'スライドは動いていない');
    assert.deepEqual(await posted(page), [], 'gotoSlide も tune も送られない');
  });
});

test('編集していないときのキー：j/k・矢印でスライド送り、tune 中の ↑↓ は ±1px', async (t) => {
  await withPage(t, async (page) => {
    await page.keyboard.press('j');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('k');
    assert.deepEqual((await posted(page)).map(m => [m.type, m.index]), [['gotoSlide', 1], ['gotoSlide', 2], ['gotoSlide', 1]]);
    await clearPosted(page);
    // クリックで navMode を抜け、原稿側で文字が選ばれた（tuneState active）→ ↑ はサイズ調整
    const pt = await textPoint(page, 1, 'スライドの原稿');
    await page.mouse.click(pt.x, pt.y); await sleep(REVEAL_WAIT); await clearPosted(page);
    await send(page, { type: 'tuneState', active: true, size: 23, color: '#112233' });
    await page.keyboard.press('ArrowUp');
    await page.keyboard.down('Shift'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Shift');
    await page.keyboard.press('End');
    const p = await posted(page);
    assert.deepEqual(p[0], { type: 'tune', op: 'inc' });
    assert.equal(p[1].type, 'gotoSlide');
    assert.deepEqual(p[2], { type: 'gotoSlide', index: 10 });
  });
});

test('編集中に render → 差し替わらず、確定後に1件だけ適用される', async (t) => {
  await withPage(t, async (page) => {
    await dbl(page, await textPoint(page, 2, 'のしくみを知る'));
    await page.keyboard.type('途中');
    const r1 = H.renderForMessage(built.md.replace('のしくみを知る', 'のしくみを知る【古い保留】'));
    const r2 = H.renderForMessage(built.md.replace('のしくみを知る', 'のしくみを知る【新しい保留】'));
    await send(page, { type: 'render', html: r1.html, css: r1.css, index: 2, version: 13, marks: [] });
    await send(page, { type: 'render', html: r2.html, css: r2.css, index: 2, version: 14, marks: [] });
    const mid = await page.evaluate(() => ({ editing: !!document.querySelector('.ss-editing'), text: document.querySelector('.ss-editing').textContent,
      focused: document.activeElement === document.querySelector('.ss-editing'), body: document.getElementById('wrap').textContent.includes('保留】') }));
    assert.deepEqual(mid.editing && mid.focused && !mid.body, true, '編集中の DOM とフォーカスがそのまま');
    assert.ok(mid.text.includes('途中'));
    await page.keyboard.press('Enter');
    await sleep(60);
    const [m] = await posted(page, 'editCommit');
    assert.equal(m.version, 12, '編集を始めたときの version で送る');
    const end = await page.evaluate(() => { const t = document.getElementById('wrap').textContent; return { nw: t.includes('【新しい保留】'), old: t.includes('【古い保留】'), editing: !!document.querySelector('.ss-editing') }; });
    assert.deepEqual(end, { nw: true, old: false, editing: false });
    // 次の編集は新しい version で送られる
    await dbl(page, await textPoint(page, 2, '【新しい保留】'));
    await page.keyboard.type('x'); await page.keyboard.press('Enter');
    assert.equal((await posted(page, 'editCommit'))[1].version, 14);
  });
});

test('render はスクロール位置を保つ／expect の検算が食い違えばトースト', async (t) => {
  await withPage(t, async (page) => {
    await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
    const y0 = await page.evaluate(() => window.scrollY);
    const r = H.renderForMessage(built.md);
    const k = (await textPoint(page, 2, 'のしくみを知る')).k;
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y0);
    await send(page, { type: 'render', html: r.html, css: r.css, index: 2, version: 20, marks: [], expect: { index: 2, k, text: '「原稿＋プレビュー」のしくみを知る' } });
    assert.equal(await page.evaluate(() => window.scrollY), y0);
    assert.equal(await page.evaluate(() => document.querySelector('.ss-toast').classList.contains('ss-show')), false, '一致していれば何も出さない');
    await send(page, { type: 'render', html: r.html, css: r.css, index: 2, version: 21, marks: [], expect: { index: 2, k, text: '別の文字' } });
    const toast = await page.evaluate(() => { const e = document.querySelector('.ss-toast'); return { show: e.classList.contains('ss-show'), text: e.textContent }; });
    assert.equal(toast.show, true);
    assert.match(toast.text, /表示と原稿がずれました/);
  });
});

test("Shift+Enter／Cmd+Enter → then:'newBullet'（li のときだけ）", async (t) => {
  await withPage(t, async (page) => {
    await dbl(page, await textPoint(page, 2, 'のしくみを知る'));
    await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
    let p = await posted(page, 'editCommit');
    assert.equal(p.length, 1, '文字を変えていなくても送る（下に新しい箇条書きを作るため）');
    assert.equal(p[0].then, 'newBullet');
    assert.deepEqual(p[0].changes, []);
    assert.ok(Number.isInteger(p[0].line) && Number.isInteger(p[0].lineEnd));
    await clearPosted(page);
    await dbl(page, await textPoint(page, 2, 'のしくみを知る'));
    await page.keyboard.type('a');
    await page.keyboard.down('Meta'); await page.keyboard.press('Enter'); await page.keyboard.up('Meta');
    p = await posted(page, 'editCommit');
    assert.equal(p[0].then, 'newBullet');
    assert.equal(p[0].changes.length, 1);
    await clearPosted(page);
    // li でない要素（takeaway）では then は none。変えていなければ送らない
    await dbl(page, await textPoint(page, 2, '今日のゴール'));
    await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
    assert.deepEqual(await posted(page), []);
  });
});

test('startEdit → 空の li にキャレットが入り、打てる／空の li で Backspace → bulletDelete', async (t) => {
  await withPage(t, async (page) => {
    const line = built.lines.findIndex((l, i) => l === '-' && built.lines[i - 1] === '- jk を打つ行');
    assert.ok(line > 0);
    await send(page, { type: 'startEdit', line });
    let e = await editingInfo(page);
    assert.equal(e.tag, 'li');
    assert.equal(await page.evaluate(() => { const el = document.querySelector('.ss-editing'); const s = getSelection(); return document.activeElement === el && s.rangeCount === 1 && el.contains(s.anchorNode) && el.textContent.trim() === ''; }), true, '空の li にキャレットがある');
    await page.keyboard.type('abc');
    await page.keyboard.press('Enter');
    let p = await posted(page);
    assert.equal(p.length, 1);
    assert.equal(p[0].type, 'editCommit');
    assert.deepEqual(p[0].changes, [{ k: null, old: '', now: 'abc' }]);
    assert.equal(p[0].emptyTarget, true);
    assert.equal(p[0].line, line);
    await clearPosted(page);
    // 拡張が断った（ok:false）→ 打った文字を表示から消す
    await send(page, { type: 'editResult', ok: false, message: '原稿が先に変わりました。もう一度' });
    assert.equal(await page.evaluate((line) => document.querySelector('li[data-line="' + line + '"]').textContent.trim(), line), '');
    // もう一度入って Backspace
    await send(page, { type: 'startEdit', line });
    await page.keyboard.press('Backspace');
    p = await posted(page);
    assert.deepEqual(p, [{ type: 'bulletDelete', index: FX, version: 12, line, lineEnd: p[0].lineEnd }]);
    assert.ok(p[0].lineEnd > line);
    assert.equal((await editingInfo(page)).tag, null);
  });
});

test('startEdit：文字のある li でも始まる。文字のある li の Backspace は普通の削除', async (t) => {
  await withPage(t, async (page) => {
    const line = built.lines.indexOf('- jk を打つ行');
    await send(page, { type: 'startEdit', line });
    assert.equal((await editingInfo(page)).tag, 'li');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    const p = await posted(page);
    assert.equal(p.length, 1);
    assert.deepEqual(p[0].changes.map(c => [c.old, c.now]), [['jk を打つ行', 'jk を打つ']]);
  });
});

test('.takeaway と .page-title（position:absolute）でも編集できる。header は編集に入らない', async (t) => {
  await withPage(t, async (page) => {
    await dbl(page, await textPoint(page, 2, '今日のゴール'));
    let e = await editingInfo(page);
    assert.match(e.cls, /\btakeaway\b/);
    await caretIn(page, '今日のゴール', 'end');
    await page.keyboard.type('！');
    await page.keyboard.press('Enter');
    let [m] = await posted(page, 'editCommit');
    assert.equal(m.changes.length, 1);
    assert.equal(m.nodes[m.changes[0].k].near.kind, 'html');
    assert.equal(m.line, null, 'html_block の要素に data-line は無い（位置は nodes[k].near で伝わる）');
    await clearPosted(page);

    await dbl(page, await textPoint(page, 2, '今回の構成'));
    e = await editingInfo(page);
    assert.match(e.cls, /\bpage-title\b/);
    await page.keyboard.type('x');
    await page.keyboard.press('Enter');
    [m] = await posted(page, 'editCommit');
    assert.equal(m.changes.length, 1);
    assert.ok(m.changes[0].old.includes('今回の構成'));
    await clearPosted(page);

    // header（frontmatter 由来）は書き戻し先が本文に無い。編集に入らず、単クリックと同じ逆引きだけ
    const hp = await page.evaluate(() => {
      const f = document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[2];
      const b = f.querySelector('section > header .hdr-left').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await dbl(page, hp);
    e = await editingInfo(page);
    assert.equal(e.tag, null);
    assert.equal(e.input, null);
    assert.equal(await page.evaluate(() => !!document.querySelector('[contenteditable]')), false);
  });
});

test('SVG の text をダブルクリック → 入力欄を重ねる → 確定で editCommit／Esc で破棄', async (t) => {
  await withPage(t, async (page) => {
    const pt = await textPoint(page, FX, '箱の中の文字');
    await dbl(page, pt);
    let e = await editingInfo(page);
    assert.equal(e.input, '箱の中の文字');
    assert.equal(e.tag, null, 'contenteditable は使わない');
    const geo = await page.evaluate(() => {
      const i = document.querySelector('.ss-svg-input').getBoundingClientRect();
      const tx = Array.from(document.querySelectorAll('section svg text')).find(x => x.textContent === '箱の中の文字');
      const r = tx.getBoundingClientRect();
      return { dx: Math.abs((i.left + i.width / 2) - (r.left + r.width / 2)), dy: Math.abs((i.top + i.height / 2) - (r.top + r.height / 2)),
        hidden: getComputedStyle(tx).visibility, fs: parseFloat(getComputedStyle(document.querySelector('.ss-svg-input')).fontSize), rh: r.height };
    });
    assert.ok(geo.dx < 6 && geo.dy < 6, `入力欄が文字の位置に重なる ${JSON.stringify(geo)}`);
    assert.equal(geo.hidden, 'hidden');
    assert.ok(geo.fs > geo.rh * 0.6 && geo.fs < geo.rh * 1.2, `字の大きさが縮小率に合っている ${JSON.stringify(geo)}`);
    await page.keyboard.type('jk書き換え');   // 全選択されているので置き換わる。j/k でスライドが動かない
    await page.keyboard.press('Enter');
    let p = await posted(page);
    assert.equal(p.length, 1);
    assert.equal(p[0].type, 'editCommit');
    assert.deepEqual(p[0].changes.map(c => [c.old, c.now]), [['箱の中の文字', 'jk書き換え']]);
    assert.equal(p[0].nodes[p[0].changes[0].k].svg, true);
    assert.equal(p[0].nodes[p[0].changes[0].k].t, '箱の中の文字');
    assert.equal(await page.evaluate(() => !!document.querySelector('.ss-svg-input') || !!document.querySelector('.ss-svg-hidden')), false);
    await clearPosted(page);
    // tspan は tspan だけが対象。Esc で破棄
    await dbl(page, await textPoint(page, FX, 'ラベル'));
    e = await editingInfo(page);
    assert.equal(e.input, 'ラベル');
    await page.keyboard.type('捨てる');
    await page.keyboard.press('Escape');
    await sleep(REVEAL_WAIT);
    assert.deepEqual(await posted(page), []);
    assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('section svg tspan')).some(x => x.textContent === 'ラベル')), true);
  });
});

test('blur（外をクリック）で確定し、そのクリックでは逆引きしない', async (t) => {
  await withPage(t, async (page) => {
    await dbl(page, await textPoint(page, 2, 'のしくみを知る'));
    await caretIn(page, 'のしくみを知る', 'end');
    await page.keyboard.type('ね');
    const other = await textPoint(page, 2, '実際にテストを行ってみる');
    await page.mouse.click(other.x, other.y);
    await sleep(REVEAL_WAIT);
    const p = await posted(page);
    assert.deepEqual(p.map(m => m.type), ['editCommit']);
    assert.equal(p[0].changes[0].now, p[0].changes[0].old + 'ね');
  });
});

test('プレビューで文字を選択 → tuneSelect（1つのテキストノード内だけ）', async (t) => {
  await withPage(t, async (page) => {
    const a = await textPoint(page, 2, 'しくみ', 'start');
    const b = await textPoint(page, 2, 'しくみ', 'end');
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 3 }); await page.mouse.move(b.x + 1, b.y, { steps: 3 }); await page.mouse.up();
    await sleep(REVEAL_WAIT);
    const p = await posted(page);
    assert.deepEqual(p.map(m => m.type), ['tuneSelect'], '選択のあとのクリックで逆引きしない');
    const m = p[0];
    assert.equal(m.index, 2); assert.equal(m.version, 12); assert.equal(m.k, a.k);
    assert.equal(m.nodes[m.k].t.slice(m.start, m.end), 'しくみ');
    assert.ok(m.px > 0);
    await clearPosted(page);
    // 太字をまたぐ選択は送らない
    const c = await textPoint(page, FX, '前半は普通で', 'start');
    const d = await textPoint(page, FX, 'そして後半', 'end');
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(d.x, d.y, { steps: 5 }); await page.mouse.up();
    await sleep(REVEAL_WAIT);
    assert.deepEqual(await posted(page, 'tuneSelect'), []);
  });
});

test('tune ツールバー：スウォッチは var(--accent) を送る。tuneState の色は hex のときだけ color 入力へ', async (t) => {
  await withPage(t, async (page) => {
    await send(page, { type: 'tuneState', active: true, size: 25, color: '#112233' });
    let s = await page.evaluate(() => ({ active: document.getElementById('ss-tuner').getAttribute('data-active'), size: document.querySelector('#ss-tuner .ss-sz').textContent, color: document.querySelector('#ss-tuner input[type=color]').value }));
    assert.deepEqual(s, { active: '1', size: '25px', color: '#112233' });
    await send(page, { type: 'tuneState', active: true, size: null, color: 'var(--accent)' });
    s = await page.evaluate(() => ({ size: document.querySelector('#ss-tuner .ss-sz').textContent, color: document.querySelector('#ss-tuner input[type=color]').value }));
    assert.deepEqual(s, { size: '–', color: '#112233' }, 'hex でない色は入れない');
    const sw = await page.$$('#ss-tuner .ss-sw');
    for (const b of sw) await b.click();
    await page.click('#ss-tuner button[title^="+1px"]');
    await page.click('#ss-tuner button[title^="−1px"]');
    await page.click('#ss-tuner button[title^="サイズ/色"]');
    const p = await posted(page);
    assert.deepEqual(p.map(m => m.value || m.op), ['var(--accent)', 'var(--accent-dark)', '#1f6fb2', '#2e7d32', '#1a1a1a', 'inc', 'dec', 'clear']);
    assert.ok(p.every(m => m.type === 'tune'), 'ツールバーのクリックで逆引きしない');
    // 見た目はデックの実際のテーマ色（このデックは --accent: #C8611C）
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#ss-tuner .ss-sw')).backgroundColor), 'rgb(200, 97, 28)');
  });
});

test('指定ページへ送る：バッジを押す／G → 番号 → Enter で gotoSlide。範囲外は送らない', async (t) => {
  await withPage(t, { init: { index: 0 } }, async (page) => {
    await sleep(500);
    await page.click('.ss-badge');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('ss-jump')), true);
    await page.keyboard.type('７');   // 全角でも通す
    await page.keyboard.press('Enter');
    await sleep(REVEAL_WAIT);
    assert.deepEqual((await posted(page, 'gotoSlide')).map(m => m.index), [6]);
    assert.equal(await page.evaluate(() => document.querySelector('.ss-badge').classList.contains('ss-jumping')), false);
    assert.equal(await page.evaluate(() => document.querySelector('.ss-badge-text').textContent), 'Slide 7/11');
    await clearPosted(page);
    await page.keyboard.press('g');
    await page.keyboard.type('99');
    await page.keyboard.press('Enter');
    await sleep(100);
    assert.deepEqual(await posted(page, 'gotoSlide'), [], '範囲外は送らない');
    // 入力中の j / k はスライド送りにならない。Esc で閉じる
    await page.keyboard.type('j');
    await page.keyboard.press('Escape');
    await sleep(100);
    assert.deepEqual(await posted(page, 'gotoSlide'), []);
    assert.equal(await page.evaluate(() => document.querySelector('.ss-badge').classList.contains('ss-jumping')), false);
  });
});

test('スライド操作ボタン → slideOp（現在のスライドの index）', async (t) => {
  await withPage(t, { init: { index: 2 } }, async (page) => {
    await sleep(500);   // 初期のスムーズスクロールが終わるのを待つ
    for (const op of ['new', 'duplicate', 'moveUp', 'moveDown', 'delete', 'mark', 'library']) await page.click(`.ss-ops button[data-op="${op}"]`);
    await sleep(REVEAL_WAIT);
    assert.deepEqual(await posted(page), ['new', 'duplicate', 'moveUp', 'moveDown', 'delete', 'mark', 'library'].map(op => ({ type: 'slideOp', op, index: 2, version: 12 })));   // version＝表示している描画の版（拡張が照合する）
    // ボタン列は現在のスライドの外（すぐ上）にあり、スライドの中身を隠さない
    const g = await page.evaluate(() => {
      const o = document.querySelector('.ss-ops').getBoundingClientRect();
      const f = document.querySelector('svg.current-slide').getBoundingClientRect();
      return { above: o.bottom <= f.top + 4, right: Math.abs(o.right - f.right) < 4, inside: o.left >= 0 };
    });
    assert.deepEqual(g, { above: true, right: true, inside: true });
    // render で marks が変わると ★ が付く
    const r = H.renderForMessage(built.md);
    const marks = new Array(11).fill(false); marks[2] = true;
    await send(page, { type: 'render', html: r.html, css: r.css, index: 2, version: 13, marks });
    assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('.ss-mark').length, document.querySelector('.ss-ops button[data-op="mark"]').classList.contains('ss-on')]), [1, true]);
  });
});

const ENTRIES = [
  { id: 'lec-agenda', title: '今回の構成', pattern: 'summary', deck: 'slides/sample-lecture/sample-lecture.md', tags: ['構成', 'アジェンダ'], thumb: null },
  { id: 'lec-mendo', title: 'こんな「面倒」', pattern: 'summary', deck: 'slides/sample-lecture/sample-lecture.md', tags: ['導入'],
    thumb: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#fff"/><rect width="320" height="22" fill="#C8611C"/><rect x="20" y="40" width="200" height="12" fill="#999"/></svg>') },
  { id: 'lay-flow', title: '<b>タグは文字として出る</b>', pattern: 'split', deck: 'slides/sample-layouts/sample-layouts.md', tags: [], thumb: null },
];

test('library → ギャラリー表示 → 絞り込み → クリックで libraryInsert／Esc・背景クリックで閉じる', async (t) => {
  await withPage(t, { init: { index: 4 } }, async (page) => {
    await send(page, { type: 'library', entries: ENTRIES });
    let g = await page.evaluate(() => ({ open: document.querySelector('.ss-gallery').classList.contains('ss-open'),
      cards: document.querySelectorAll('.ss-gal-card').length, imgs: document.querySelectorAll('.ss-gal-card img').length,
      nothumb: Array.from(document.querySelectorAll('.ss-gal-nothumb')).map(e => e.textContent), injected: !!document.querySelector('.ss-gal-card b'),
      focus: document.activeElement === document.querySelector('.ss-gal-filter') }));
    assert.deepEqual(g, { open: true, cards: 3, imgs: 1, nothumb: ['今回の構成', '<b>タグは文字として出る</b>'], injected: false, focus: true });
    await page.keyboard.type('jk');   // 絞り込み入力中の j/k でスライドが動かない
    assert.equal(await page.evaluate(() => document.querySelectorAll('.ss-gal-card').length), 0);
    assert.deepEqual(await posted(page), []);
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    await page.keyboard.type('アジェンダ');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.ss-gal-card')).map(c => c.getAttribute('data-id'))), ['lec-agenda']);
    await page.click('.ss-gal-card[data-id="lec-agenda"]');
    await sleep(REVEAL_WAIT);
    assert.deepEqual(await posted(page), [{ type: 'libraryInsert', id: 'lec-agenda', index: 4, version: 12 }]);
    assert.equal(await page.evaluate(() => document.querySelector('.ss-gallery').classList.contains('ss-open')), false);
    await clearPosted(page);
    await send(page, { type: 'library', entries: ENTRIES });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('.ss-gallery').classList.contains('ss-open')), false);
    await send(page, { type: 'library', entries: [] });
    assert.match(await page.evaluate(() => document.querySelector('.ss-gal-empty').textContent), /まだありません/);
    await page.mouse.click(6, 6);   // パネルの外＝背景
    await sleep(REVEAL_WAIT);
    assert.equal(await page.evaluate(() => document.querySelector('.ss-gallery').classList.contains('ss-open')), false);
    assert.deepEqual(await posted(page), [], '背景クリックで逆引きしない');
  });
});

test('トースト：editResult を 3 秒表示', async (t) => {
  await withPage(t, async (page) => {
    await send(page, { type: 'editResult', ok: true, message: '反映しました（12行目）' });
    let s = await page.evaluate(() => { const e = document.querySelector('.ss-toast'); return [e.classList.contains('ss-show'), e.classList.contains('ss-err'), e.textContent]; });
    assert.deepEqual(s, [true, false, '反映しました（12行目）']);
    await send(page, { type: 'editResult', ok: false, message: '原稿が先に変わりました。もう一度' });
    s = await page.evaluate(() => { const e = document.querySelector('.ss-toast'); return [e.classList.contains('ss-show'), e.classList.contains('ss-err'), e.textContent]; });
    assert.deepEqual(s, [true, true, '原稿が先に変わりました。もう一度']);
    await sleep(2500);
    assert.equal(await page.evaluate(() => document.querySelector('.ss-toast').classList.contains('ss-show')), true, '2.5秒後はまだ出ている');
    await sleep(900);
    assert.equal(await page.evaluate(() => document.querySelector('.ss-toast').classList.contains('ss-show')), false, '3秒で消える');
  });
});

test('ホバーで薄い枠（編集できる要素だけ）', async (t) => {
  await withPage(t, async (page) => {
    const pt = await textPoint(page, 2, 'のしくみを知る');
    await page.mouse.move(pt.x, pt.y);
    assert.equal(await page.evaluate(() => { const e = document.querySelector('.ss-hover'); return e ? e.tagName.toLowerCase() : null; }), 'li');
    const hp = await page.evaluate(() => { const b = document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[2].querySelector('section > header .hdr-left').getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; });
    await page.mouse.move(hp.x, hp.y);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.ss-hover').length), 0, 'header には出さない');
  });
});

// ---------- レビューで見つけた反例（再発防止） ----------
// 見本デックに無い形をまとめた小さなデック。2枚目は背景画像つき（section が複数できる）。
const EDGE_MD = [
  '---', 'marp: true', 'theme: academic', '---', '',
  '# 反例', '',
  '- 前 **中太字** 後ろの文',
  '- a **b** c *d* e',
  '- 同じ文字列',
  '- 同じ文字列',
  '- 𠮷野家のしくみ を選ぶ',
  '- 貼り付ける行', '',
  '<div class="fig-area"><svg viewBox="0 0 400 100" width="400" height="100"><text x="10" y="30" font-size="20">改行を',
  '      含むラベル</text><text x="10" y="70" font-size="20">前の字<tspan fill="#C8611C">中</tspan>後ろの字</text></svg></div>', '',
  '---', '',
  '![bg right:40%](data:image/gif;base64,R0lGODlhAQABAAAAACw=)', '',
  '- 背景つきの項目', '',
].join('\n');
const edgeLines = EDGE_MD.split('\n');
/** .ss-editing の中で選択範囲を作る。body は el / r（Range）を使う式 */
const selectIn = (page, which) => page.evaluate((which) => {
  const el = document.querySelector('.ss-editing'); const r = document.createRange();
  const n = el.childNodes[which]; r.setStart(n, 0); r.setEnd(n, n.nodeValue.length);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}, which);

test('太字の前の文字を全部消して打ち直す → 太字の「前」のノードの書き換え（後ろのノードへ足さない）', async (t) => {
  await withPage(t, { md: EDGE_MD }, async (page) => {
    await sleep(400);
    await dbl(page, await textPoint(page, 0, '後ろの文'));
    await selectIn(page, 0);            // 「前 」
    await page.keyboard.press('Backspace');
    await page.keyboard.type('新');
    assert.equal(await page.evaluate(() => document.querySelector('.ss-editing').textContent), '新中太字 後ろの文');
    await page.keyboard.press('Enter');
    const [m] = await posted(page, 'editCommit');
    assert.deepEqual(m.changes.map(c => [c.old, c.now]), [['前 ', '新']], '表示と同じ場所（太字の前）に書く');
  });
});

test('太字と斜体の間の文字を消して打ち直す → Chrome がノードを使い回しても、間のノードだけが変わる', async (t) => {
  await withPage(t, { md: EDGE_MD }, async (page) => {
    await sleep(400);
    await dbl(page, await textPoint(page, 0, ' c '));
    await selectIn(page, 2);            // 「 c 」
    await page.keyboard.press('Backspace');
    await page.keyboard.type('X');
    const shown = await page.evaluate(() => { const el = document.querySelector('.ss-editing'); return { text: el.textContent, strong: el.querySelector('strong').textContent }; });
    await page.keyboard.press('Enter');
    await sleep(60);
    const p = await posted(page);
    if (shown.text === 'a bXd e' && shown.strong === 'b') {
      assert.deepEqual(p.map(m => m.type), ['editCommit']);
      assert.deepEqual(p[0].changes.map(c => [c.old, c.now]), [[' c ', 'X']], '太字の中（b）を X にしない');
    } else {
      // X が太字の中へ入る挙動の Chrome：b→bX と c→'' の2件になる。いずれにせよ表示と同じ内容
      assert.deepEqual(p[0].changes.map(c => [c.old, c.now]), [['b', 'bX'], [' c ', '']]);
    }
  });
});

test('太字をまたいで消す → 消えたノードは now:""（場所を取り違えない）', async (t) => {
  await withPage(t, { md: EDGE_MD }, async (page) => {
    await sleep(400);
    await dbl(page, await textPoint(page, 0, '後ろの文'));
    await page.evaluate(() => { const el = document.querySelector('.ss-editing'); const r = document.createRange(); r.setStart(el.firstChild, 1); r.setEnd(el.lastChild, 2); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    const [m] = await posted(page, 'editCommit');
    assert.deepEqual(m.changes.map(c => [c.old, c.now]), [['前 ', '前'], ['中太字', ''], [' 後ろの文', 'ろの文']]);
  });
});

test('同じ文字列が2つ → 2つ目を直すと k も line も2つ目', async (t) => {
  await withPage(t, { md: EDGE_MD }, async (page) => {
    await sleep(400);
    const pts = await page.evaluate(() => Array.from(document.querySelectorAll('li')).filter(l => l.textContent === '同じ文字列').map(l => { const b = l.getBoundingClientRect(); return { x: b.left + 30, y: b.top + b.height / 2 }; }));
    assert.equal(pts.length, 2);
    await dbl(page, pts[1]);
    await page.keyboard.type('Z');
    await page.keyboard.press('Enter');
    const [m] = await posted(page, 'editCommit');
    const second = edgeLines.lastIndexOf('- 同じ文字列');
    assert.equal(m.line, second);
    assert.equal(m.nodes[m.changes[0].k].near.start, second);
    assert.equal(m.nodes[m.changes[0].k - 1].t, '同じ文字列', '1つ前のノードが1つ目');
  });
});

test('サロゲートペアを含む行の tuneSelect → start/end は UTF-16 のオフセット', async (t) => {
  await withPage(t, { md: EDGE_MD }, async (page) => {
    await sleep(400);
    const a = await textPoint(page, 0, 'しくみ', 'start'), b = await textPoint(page, 0, 'しくみ', 'end');
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x + 1, b.y, { steps: 5 }); await page.mouse.up();
    await sleep(REVEAL_WAIT);
    const [m] = await posted(page, 'tuneSelect');
    assert.equal(m.start, '𠮷野家の'.length);   // 5（𠮷 は2単位）
    assert.equal(m.nodes[m.k].t.slice(m.start, m.end), 'しくみ');
  });
});

test('IME 変換中の Enter は確定にしない／改行入りの貼り付けは1行になる', async (t) => {
  await withPage(t, { md: EDGE_MD }, async (page) => {
    await sleep(400);
    await dbl(page, await textPoint(page, 0, '貼り付ける行'));
    await page.evaluate(() => {
      const el = document.querySelector('.ss-editing');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }));
    });
    assert.equal((await editingInfo(page)).tag, 'li', 'まだ編集中');
    assert.deepEqual(await posted(page), []);
    await caretIn(page, '貼り付ける行', 'end');
    await page.evaluate(() => {
      const dt = new DataTransfer(); dt.setData('text/plain', '一行目\r\n  二行目\n');
      document.querySelector('.ss-editing').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.keyboard.press('Enter');
    const [m] = await posted(page, 'editCommit');
    assert.equal(m.changes.length, 1);
    assert.equal(m.changes[0].now, '貼り付ける行一行目 二行目 ');
    assert.ok(!/[\r\n]/.test(m.changes[0].now));
  });
});

test('SVG：改行入りのラベルを開いて Enter しただけでは送らない／直下の文字が複数ある text は押した方が開く', async (t) => {
  await withPage(t, { md: EDGE_MD }, async (page) => {
    await sleep(400);
    await dbl(page, await textPoint(page, 0, '改行を'));
    assert.equal((await editingInfo(page)).input, '改行を 含むラベル'.replace(' ', '      '));
    await page.keyboard.press('Enter');
    await sleep(REVEAL_WAIT);
    assert.deepEqual(await posted(page), [], '変えていないのに原稿の改行を消さない');
    await dbl(page, await textPoint(page, 0, '後ろの字'));
    assert.equal((await editingInfo(page)).input, '後ろの字', '先頭の「前の字」ではなく、押した方');
    await page.keyboard.type('直した');
    await page.keyboard.press('Enter');
    const [m] = await posted(page, 'editCommit');
    assert.deepEqual(m.changes.map(c => [c.old, c.now]), [['後ろの字', '直した']]);
    assert.equal(m.nodes[m.changes[0].k].t, '後ろの字');
  });
});

test('背景画像つきのスライド（section が複数）でも、本文の section で逆引き・編集できる', async (t) => {
  await withPage(t, { md: EDGE_MD }, async (page) => {
    await send(page, { type: 'scrollToSlide', index: 1 });
    await sleep(900);
    const pt = await page.evaluate(() => {
      const li = Array.from(document.querySelectorAll('li')).find(l => l.textContent === '背景つきの項目');
      const b = li.getBoundingClientRect(); return { x: b.left + 40, y: b.top + b.height / 2 };
    });
    await dbl(page, pt);
    assert.equal((await editingInfo(page)).tag, 'li');
    await page.keyboard.type('Z');
    await page.keyboard.press('Enter');
    const [m] = await posted(page, 'editCommit');
    assert.equal(m.index, 1);
    assert.equal(m.line, edgeLines.indexOf('- 背景つきの項目'));
    assert.equal(m.nodes[m.changes[0].k].t, '背景つきの項目');
  });
});

test('空の render・1枚だけのデック・壊れた library でも例外を出さない', async (t) => {
  await withPage(t, { md: '---\nmarp: true\n---\n\n# 1枚だけ\n' }, async (page) => {
    for (const k of ['j', 'k', 'End', 'Home', 'ArrowDown']) await page.keyboard.press(k);
    assert.deepEqual(await posted(page), [], '1枚だけなら送る先が無い');
    assert.equal(await page.evaluate(() => document.querySelector('.ss-badge').textContent), 'Slide 1/1');
    await send(page, { type: 'render', html: '', css: '', index: 0, version: 2, marks: [] });
    assert.equal(await page.evaluate(() => document.querySelector('.ss-badge').textContent), 'Slide –');
    assert.equal(await page.evaluate(() => document.querySelector('.ss-ops').style.display), 'none');
    for (const k of ['j', 'End']) await page.keyboard.press(k);
    await send(page, { type: 'startEdit', line: 4 });
    await send(page, { type: 'scrollToSlide', index: 3 });
    await send(page, { type: 'editResult', ok: false });
    await send(page, { type: 'library', entries: [null, 'x', { title: 'id が無い' }, { id: 'ok', title: '残る' }] });
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.ss-gal-card')).map(c => c.getAttribute('data-id'))), ['ok']);
    await page.keyboard.press('Escape');
    // 元に戻せる
    const r = H.renderForMessage('---\nmarp: true\n---\n\n# 戻った\n\n---\n\n# 2枚目\n');
    await send(page, { type: 'render', html: r.html, css: r.css, index: 1, version: 3, marks: [false, true] });
    assert.equal(await page.evaluate(() => document.querySelector('.ss-badge').textContent), 'Slide 2/2');
    assert.deepEqual(await posted(page), []);
  });
});

test('expect.text が空（全部消した編集）のときは検算しない', async (t) => {
  await withPage(t, async (page) => {
    const r = H.renderForMessage(built.md);
    await send(page, { type: 'render', html: r.html, css: r.css, index: 2, version: 20, marks: [], expect: { index: 2, k: 3, text: '  ' } });
    assert.equal(await page.evaluate(() => document.querySelector('.ss-toast').classList.contains('ss-show')), false);
  });
});

// ---------- ＋ボタン・検索ギャラリー・はみ出しバッジ（DESIGN.md 7.3 / 7.4） ----------
// 材料は、テーマも配色も違う見本デック 2 本（sample-lecture＝academic＋橙、sample-layouts＝tsutawaru-academic の既定の赤）を marp-core で描いたもの。
let CORPUS = null;
const corpus = (per) => (per ? H.corpusFixture({ per }) : (CORPUS || (CORPUS = H.corpusFixture({ per: 4 }))));
/** 全面ギャラリーを開く（拡張の gallery メッセージ。＋ はポップアップを開くようになった＝DESIGN.md 8.1） */
const openGal = (page, index) => send(page, { type: 'gallery', index });
const lastSearch = async (page) => (await posted(page, 'corpusSearch')).pop();
/** 拡張の代わりに corpusResults を返す。css は haveCss に無い分だけ（7.4 の約束どおり） */
async function answer(page, req, fx, over) {
  over = over || {};
  const items = over.items || fx.items.slice(req.offset, req.offset + req.limit);
  const css = {};
  for (const it of items) if (!req.haveCss.includes(it.cssKey)) css[it.cssKey] = fx.css[it.cssKey];
  await send(page, Object.assign({ type: 'corpusResults', reqId: req.reqId, total: fx.items.length, offset: req.offset, building: false, items, css }, over));
  await sleep(250);   // IntersectionObserver がサムネイルを作るのを待つ
}
const galState = (page) => page.evaluate(() => ({
  open: document.querySelector('.ss-gallery').classList.contains('ss-open'),
  title: document.querySelector('.ss-gal-title').textContent,
  keys: Array.from(document.querySelectorAll('.ss-gal-pick')).map(c => c.getAttribute('data-key')),
  sel: Array.from(document.querySelectorAll('.ss-gal-pick.ss-sel')).map(c => c.getAttribute('data-key') + '=' + c.querySelector('.ss-gal-order').textContent),
  selCount: document.querySelector('.ss-gal-selcount').textContent,
  insertDisabled: document.querySelector('.ss-gal-insert').disabled,
  count: document.querySelector('.ss-gal-count').textContent,
  more: !!document.querySelector('.ss-gal-more'),
  empty: document.querySelector('.ss-gal-empty') ? document.querySelector('.ss-gal-empty').textContent : null,
  focusKey: document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-key') : null,
  focusFilter: document.activeElement === document.querySelector('.ss-gal-filter'),
}));

test('＋ボタン：スライド数＋1 個（index −1〜）。余白の中央にあり、操作ボタン列・★ と重ならない', async (t) => {
  const marks = new Array(11).fill(false); marks[2] = true;
  await withPage(t, { width: 700, init: { index: 2, marks } }, async (page) => {
    const g = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]')).map(f => f.getBoundingClientRect());
      const btns = Array.from(document.querySelectorAll('.ss-insert'));
      const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      const others = Array.from(document.querySelectorAll('.ss-ops, .ss-mark')).map(e => e.getBoundingClientRect());
      return {
        index: btns.map(b => Number(b.getAttribute('data-index'))),
        overSlide: btns.filter(b => frames.some(f => hit(b.getBoundingClientRect(), f))).length,
        overUi: btns.filter(b => others.some(o => hit(b.getBoundingClientRect(), o))).length,
        size: btns[0].getBoundingClientRect().height,
        opacity: parseFloat(getComputedStyle(btns[3]).opacity),
        titles: [btns[0].title, btns[3].title],
      };
    });
    assert.deepEqual(g.index, [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(g.overSlide, 0, 'スライドの上に乗らない');
    assert.equal(g.overUi, 0, '操作ボタン列・★ と重ならない');
    assert.ok(g.size <= 24 && g.opacity === 0, '余白（30px）に収まり、ふだんは見えない（DESIGN.md 8.1）');
    assert.match(g.titles[0], /先頭/); assert.match(g.titles[1], /3 枚目の次/);
    // render で枚数が変わったら個数も変わる
    const r = H.renderForMessage('---\nmarp: true\n---\n\n# 1\n\n---\n\n# 2\n');
    await send(page, { type: 'render', html: r.html, css: r.css, index: 0, version: 13, marks: [] });
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.ss-insert')).map(b => b.getAttribute('data-index'))), ['-1', '0', '1']);
    await send(page, { type: 'render', html: '', css: '', index: 0, version: 14, marks: [] });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.ss-insert').length), 0);
  });
});

test('gallery メッセージ → 全面ギャラリーが開き、空の語で corpusSearch（手を入れた順）。入力は 250ms まとめて再検索し、受信済みの css は haveCss に載る', async (t) => {
  await withPage(t, { init: { index: 2 } }, async (page) => {
    const fx = corpus();
    await openGal(page, 4);
    await sleep(REVEAL_WAIT);
    let ps = await posted(page);
    assert.deepEqual(ps, [{ type: 'corpusSearch', reqId: ps[0].reqId, query: '', onlyMarked: false, sort: 'score', offset: 0, limit: 24, haveCss: [] }], '逆引きも gotoSlide も飛ばない');
    let g = await galState(page);
    assert.equal(g.open, true); assert.match(g.title, /5 枚目の次/); assert.equal(g.focusFilter, true);
    assert.match(g.count, /検索中/); assert.equal(g.insertDisabled, true);
    await answer(page, ps[0], fx);
    g = await galState(page);
    assert.equal(g.keys.length, 8); assert.equal(g.count, '8 / 8 件'); assert.equal(g.more, false);
    // 続けて打っても検索は 1 回
    await clearPosted(page);
    await page.keyboard.type('jk 自己');
    assert.deepEqual(await posted(page), [], 'デバウンス中は送らない。j/k でスライドも動かない');
    await sleep(400);
    ps = await posted(page);
    assert.equal(ps.length, 1);
    assert.deepEqual([ps[0].query, ps[0].sort, ps[0].offset], ['jk 自己', 'relevance', 0]);
    assert.deepEqual(ps[0].haveCss.slice().sort(), Object.keys(fx.css).sort());
    // 絞り込み・並びはすぐ送る
    await clearPosted(page);
    await page.click('.ss-gal-check input');
    await page.select('.ss-gal-sort', 'recent');
    ps = await posted(page);
    assert.deepEqual(ps.map(m => [m.onlyMarked, m.sort]), [[true, 'relevance'], [true, 'recent']]);
    // 0 件
    await answer(page, ps[1], fx, { items: [], total: 0 });
    g = await galState(page);
    assert.match(g.empty, /該当するスライドがありません/); assert.equal(g.count, '0 / 0 件');
    await answer(page, await lastSearch(page), fx, { items: [], total: 0, building: true });
    g = await galState(page);
    assert.match(g.empty, /索引を作成中/); assert.match(g.count, /索引を作成中/);
  });
});

test('カード：Shadow DOM の中に section があり、デックごとの css（--accent）が効く。script は入らず、video は controls 無し・preload=none', async (t) => {
  await withPage(t, async (page) => {
    const fx = corpus();
    const items = fx.items.map(x => Object.assign({}, x));
    items[0].html = items[0].html.replace(/<\/section>/, '<script>window.__pwned = 1<\/script><video controls autoplay src="x.mp4"></video></section>');
    items[0].title = '<i>題名はタグにならない</i>';
    await send(page, { type: 'gallery', index: 0 });
    await answer(page, await lastSearch(page), { items, css: fx.css });
    const g = await page.evaluate((cssMap) => Array.from(document.querySelectorAll('.ss-gal-pick')).map(c => {
      const root = c.querySelector('.ss-gal-shadow').shadowRoot;
      const sec = root && root.querySelector('div.marpit > svg[data-marpit-svg] section');
      const svg = root && root.querySelector('div.marpit > svg[data-marpit-svg]');
      const v = root && root.querySelector('video');
      const deckCss = (c.__ssItem && cssMap[c.__ssItem.cssKey]) || '';
      return { sec: !!sec, accent: sec ? getComputedStyle(sec).getPropertyValue('--accent').trim().toUpperCase() : null,
        w: sec ? getComputedStyle(sec).width : null, pe: root ? getComputedStyle(root.querySelector('div.marpit')).pointerEvents : null,
        script: root ? root.querySelectorAll('script').length : -1, video: v ? [v.hasAttribute('controls'), v.hasAttribute('autoplay'), v.getAttribute('preload')] : null,
        h: Math.round(c.querySelector('.ss-gal-thumbbox').getBoundingClientRect().height), tw: Math.round(c.querySelector('.ss-gal-thumbbox').getBoundingClientRect().width),
        // 幅の確かめ：section は svg と同じ幅・border-box・overflow:hidden（基本規則が生きている）。fonts の @import は url の中の ; で切れていない
        ov: sec ? getComputedStyle(sec).overflow : null, bs: sec ? getComputedStyle(sec).boxSizing : null,
        fit: sec && svg ? Math.round(sec.getBoundingClientRect().width - svg.getBoundingClientRect().width) : null,
        fontImport: /display=swap'\);/.test(deckCss) ? /display=swap'\);/.test(Array.from(root.querySelectorAll('style')).map(x => x.textContent).join('')) : 'n/a',
        badges: Array.from(c.querySelectorAll('.ss-gal-badge')).map(b => b.textContent), name: c.querySelector('.ss-gal-name').textContent, sub: c.querySelector('.ss-gal-sub').textContent };
    }), fx.css);
    assert.equal(g.length, 8);
    assert.ok(g.every(x => x.sec && x.w === '1280px' && x.pe === 'none' && x.script === 0), JSON.stringify(g.map(x => [x.sec, x.w, x.pe, x.script])));
    assert.deepEqual(g.map(x => x.accent), ['#C8611C', '#C8611C', '#C8611C', '#C8611C', '#A6192E', '#A6192E', '#A6192E', '#A6192E'], 'デックごとの配色');
    assert.ok(g.every(x => Math.abs(x.h - x.tw * 9 / 16) < 2), 'サムネイルは 16:9');
    // 2026-10-17 実測：@import url('…wght@400;700…') を ; で切ると、残った 700&display=swap'); の引用符が section の基本規則（1280×720・border-box・
    // overflow:hidden）まで呑み込み、section が svg より広くなって右側が切れていた（section 1060px／svg 975px・box-sizing content-box・overflow visible）
    assert.ok(g.every(x => x.ov === 'hidden' && x.bs === 'border-box' && x.fit === 0), 'section は svg と同じ幅・border-box・overflow:hidden: ' + JSON.stringify(g.map(x => [x.ov, x.bs, x.fit])));
    assert.ok(g.every(x => x.fontImport === true || x.fontImport === 'n/a'), 'fonts の @import は url の中の ; で切れずに <style> へ移る: ' + JSON.stringify(g.map(x => x.fontImport)));
    assert.ok(g.some(x => x.fontImport === true), '見本デックの css に Google Fonts の @import がある（この確かめが空振りしていない）: ' + JSON.stringify(g.map(x => x.fontImport)));
    assert.deepEqual(g[0].video, [false, false, 'none']);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.equal(g[0].name, '<i>題名はタグにならない</i>');
    assert.deepEqual(g[0].badges, ['添削 5 回']);
    assert.deepEqual(g[1].badges, ['★ 完成', '添削 4 回']);
    assert.deepEqual(g[4].badges, ['他 2 件', 'テーマ違い']);
    assert.match(g[4].sub, /sample-layouts #1/);
    // プレビュー本体の配色は変わらない（Shadow DOM の css が外へ漏れない）
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#wrap section')).getPropertyValue('--accent').trim().toUpperCase()), '#C8611C');
  });
});

test('見えているカードだけサムネイルを作る（24 件）。スクロールすると残りも作る／もっと見るで offset を進めて追記', async (t) => {
  await withPage(t, async (page) => {
    const fx = corpus(15);   // 15 枚 × 2 デック＝30 件
    assert.equal(fx.items.length, 30);
    await openGal(page, -1);
    await answer(page, await lastSearch(page), fx);
    const filled = () => page.evaluate(() => Array.from(document.querySelectorAll('.ss-gal-shadow')).filter(h => h.shadowRoot).length);
    let g = await galState(page);
    assert.equal(g.keys.length, 24); assert.equal(g.count, '24 / 30 件'); assert.equal(g.more, true);
    const n0 = await filled();
    assert.ok(n0 > 0 && n0 < 24, '最初は見えている分だけ：' + n0);
    await clearPosted(page);
    await page.evaluate(() => { const gr = document.querySelector('.ss-gal-grid'); gr.scrollTop = gr.scrollHeight; });
    await sleep(300);
    assert.ok(await filled() > n0);
    await page.click('.ss-gal-more');
    const req = await lastSearch(page);
    assert.deepEqual([req.offset, req.limit, req.query], [24, 24, '']);
    await answer(page, req, fx);
    g = await galState(page);
    assert.equal(g.keys.length, 30); assert.equal(new Set(g.keys).size, 30); assert.equal(g.count, '30 / 30 件'); assert.equal(g.more, false);
  });
});

test('複数選択 → corpusInsert は選んだ順・index・keepColors / keepTypo。検索し直しても選択は残る', async (t) => {
  await withPage(t, { init: { index: 2 } }, async (page) => {
    const fx = corpus();
    await openGal(page, -1);
    await answer(page, await lastSearch(page), fx);
    const k = fx.items.map(x => x.key);
    await page.click(`.ss-gal-pick[data-key="${k[5]}"] .ss-gal-name`);
    await page.click(`.ss-gal-pick[data-key="${k[1]}"] .ss-gal-thumbbox`);   // サムネイルの上を押しても選べる（中の文字は拾わない）
    await page.click(`.ss-gal-pick[data-key="${k[2]}"] .ss-gal-name`);
    await page.click(`.ss-gal-pick[data-key="${k[1]}"] .ss-gal-name`);       // もう一度押すと外れる
    await page.click(`.ss-gal-pick[data-key="${k[0]}"] .ss-gal-name`);
    let g = await galState(page);
    assert.deepEqual(g.sel.slice().sort(), [k[5] + '=1', k[2] + '=2', k[0] + '=3'].sort());
    assert.equal(g.selCount, '3 枚を選択中'); assert.equal(g.insertDisabled, false);
    // 別の語で検索し直しても、選択は残る
    await page.type('.ss-gal-filter', '重み');
    await sleep(400);
    await answer(page, await lastSearch(page), fx, { items: fx.items.slice(4, 6), total: 2 });
    g = await galState(page);
    assert.deepEqual(g.sel, [k[5] + '=1']); assert.equal(g.selCount, '3 枚を選択中');
    await clearPosted(page);
    await page.click('.ss-gal-foot label:nth-of-type(2) input');   // 元の組版を保つ
    await page.click('.ss-gal-insert');
    await sleep(REVEAL_WAIT);
    assert.deepEqual(await posted(page), [{ type: 'corpusInsert', index: -1, version: 12, keepColors: false, keepTypo: true,
      items: [5, 2, 0].map(i => ({ deck: fx.items[i].deck, slide: fx.items[i].slide })) }]);
    assert.equal((await galState(page)).open, false);
    // 開き直すと選択は空
    await openGal(page, 3);
    g = await galState(page);
    assert.deepEqual([g.sel, g.selCount, g.insertDisabled], [[], '0 枚を選択中', true]);
  });
});

test('ダブルクリックで、その 1 枚をすぐ挿入／「原稿を開く」は openSource だけ（選択しない）', async (t) => {
  await withPage(t, async (page) => {
    const fx = corpus();
    await openGal(page, 6);
    await answer(page, await lastSearch(page), fx);
    await clearPosted(page);
    const k = fx.items[6].key;
    await page.click(`.ss-gal-pick[data-key="${k}"] .ss-gal-open`);
    assert.deepEqual(await posted(page), [{ type: 'openSource', deck: fx.items[6].deck, slide: 3 }]);
    let g = await galState(page);
    assert.deepEqual([g.open, g.sel], [true, []]);
    await clearPosted(page);
    await page.click(`.ss-gal-pick[data-key="${k}"] .ss-gal-name`, { clickCount: 2, delay: 30 });
    await sleep(REVEAL_WAIT);
    assert.deepEqual(await posted(page), [{ type: 'corpusInsert', index: 6, version: 12, keepColors: false, keepTypo: false, items: [{ deck: fx.items[6].deck, slide: 3 }] }]);
    assert.equal((await galState(page)).open, false);
  });
});

test('古い reqId の応答は捨てる／閉じたあとに届いた応答でも例外を出さない', async (t) => {
  await withPage(t, async (page) => {
    const fx = corpus();
    await openGal(page, 0);
    const first = await lastSearch(page);
    await page.type('.ss-gal-filter', 'lecture');
    await sleep(400);
    const second = await lastSearch(page);
    assert.ok(second.reqId !== first.reqId);
    await answer(page, first, fx);                                   // 遅れて届いた古い応答
    let g = await galState(page);
    assert.deepEqual(g.keys, []); assert.match(g.count, /検索中/);
    await answer(page, second, fx, { items: fx.items.slice(0, 2), total: 2 });
    g = await galState(page);
    assert.deepEqual(g.keys, fx.items.slice(0, 2).map(x => x.key));
    // 古い応答で届いた css も取ってある（次の検索で送り直させない）
    await page.click('.ss-gal-check input');
    assert.deepEqual((await lastSearch(page)).haveCss.slice().sort(), Object.keys(fx.css).sort());
    await page.keyboard.press('Escape');
    await answer(page, await lastSearch(page), fx);
    await send(page, { type: 'corpusResults', reqId: 'x', items: [null, 'x', { deck: 1 }], css: null });
    g = await galState(page);
    assert.deepEqual([g.open, g.keys], [false, []]);
  });
});

test('ギャラリーを開いている間のキー：Esc・↑↓←→・Space・Enter。j/k・Cmd+Z はスライド送り／undo にならない', async (t) => {
  await withPage(t, { init: { index: 3 } }, async (page) => {
    const fx = corpus();
    await send(page, { type: 'gallery', index: 3, query: '自己紹介', onlyMarked: true });
    let req = await lastSearch(page);
    assert.deepEqual([req.query, req.onlyMarked, req.sort], ['自己紹介', true, 'relevance']);
    await answer(page, req, fx);
    await clearPosted(page);
    const k = fx.items.map(x => x.key);
    await page.keyboard.press('ArrowLeft');    // 検索欄の中ではキャレット移動
    assert.equal((await galState(page)).focusFilter, true);
    await page.keyboard.press('ArrowDown');
    assert.equal((await galState(page)).focusKey, k[0]);
    await page.keyboard.press('ArrowRight');
    assert.equal((await galState(page)).focusKey, k[1]);
    await page.keyboard.press('ArrowDown');    // 幅 1000px では 3 列。真下は 3 つ先
    assert.equal((await galState(page)).focusKey, k[4]);
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    for (const key of ['j', 'k', 'PageDown', 'Home']) await page.keyboard.press(key);
    await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
    assert.deepEqual(await posted(page), [], 'スライド送りも undo の転送もしない');
    let g = await galState(page);
    assert.deepEqual(g.sel.slice().sort(), [k[4] + '=1', k[3] + '=2'].sort());
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
    assert.equal((await galState(page)).focusFilter, true, 'いちばん上の行からは検索欄へ戻る');
    await page.keyboard.press('Enter');
    assert.deepEqual(await posted(page), [{ type: 'corpusInsert', index: 3, version: 12, keepColors: false, keepTypo: false,
      items: [4, 3].map(i => ({ deck: fx.items[i].deck, slide: fx.items[i].slide })) }]);
    // 何も選んでいないときの Enter：カードの上ならその 1 枚、検索欄なら何もしない
    await clearPosted(page);
    await send(page, { type: 'gallery' });   // index 省略＝現在のスライドの次
    await answer(page, await lastSearch(page), fx);
    await clearPosted(page);
    await page.keyboard.press('Enter');
    assert.deepEqual(await posted(page), []);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.deepEqual(await posted(page), [{ type: 'corpusInsert', index: 3, version: 12, keepColors: false, keepTypo: false, items: [{ deck: fx.items[0].deck, slide: 1 }] }]);
    // Esc・背景クリックで閉じる。閉じたあとは j でスライド送りに戻る
    await send(page, { type: 'gallery', index: 0 });
    await page.keyboard.press('Escape');
    assert.equal((await galState(page)).open, false);
    await send(page, { type: 'gallery', index: 0 });
    await page.mouse.click(6, 6);
    assert.equal((await galState(page)).open, false);
    await clearPosted(page);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('j');
    assert.deepEqual(await posted(page, 'gotoSlide'), [{ type: 'gotoSlide', index: 4 }]);
  });
});

test('編集中は ＋ を押しても開かない（編集を確定するだけ）。もう一度押すと開く', async (t) => {
  await withPage(t, async (page) => {
    await dbl(page, await textPoint(page, 2, 'のしくみを知る'));
    assert.equal((await editingInfo(page)).tag, 'li');
    assert.equal(await page.evaluate(() => document.getElementById('ss-layer').classList.contains('ss-editing-on')), true);
    await page.keyboard.type('X');
    await page.click('.ss-insert[data-index="2"]');
    await sleep(REVEAL_WAIT);
    assert.deepEqual((await posted(page)).map(m => m.type), ['editCommit']);
    const popOpen = () => page.evaluate(() => document.querySelector('.ss-pop').classList.contains('ss-open'));
    assert.deepEqual([await popOpen(), (await editingInfo(page)).tag], [false, null]);
    assert.match(await page.evaluate(() => document.querySelector('.ss-toast').textContent), /もう一度/);
    await page.click('.ss-insert[data-index="2"]');
    assert.equal(await popOpen(), true);
    assert.equal((await lastSearch(page)).type, 'corpusSearch');
  });
});

test('はみ出しバッジ：ssDetectOverflow があれば ⚠ と overflowReport。結果が同じなら送り直さない。無ければ何もしない', async (t) => {
  const marks = new Array(11).fill(false); marks[3] = true;
  await withPage(t, async (page) => {
    const r = H.renderForMessage(built.md);
    await send(page, { type: 'render', html: r.html, css: r.css, index: 0, version: 13, marks });
    await sleep(500);
    assert.deepEqual([await page.evaluate(() => document.querySelectorAll('.ss-over').length), await posted(page)], [0, []], '検知器が無ければ何もしない');
    await page.evaluate(() => {
      window.__ofCalls = 0; window.__ofBad = new Set([3, 7]);
      window.ssDetectOverflow = (section) => {
        window.__ofCalls++;
        if (!section || section.tagName.toLowerCase() !== 'section') throw new Error('section が渡されていない');
        const i = Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]')).indexOf(section.closest('svg[data-marpit-svg]'));
        if (i === 5) throw new Error('検知器の例外は 1 枚だけの問題にする');
        return window.__ofBad.has(i) ? { overflow: true, bottomPx: 41.6, hitsTakeaway: i === 3, hitsHeader: false } : { overflow: false, bottomPx: -12, hitsTakeaway: false, hitsHeader: false };
      };
    });
    await send(page, { type: 'render', html: r.html, css: r.css, index: 0, version: 14, marks });
    await sleep(800);
    assert.deepEqual(await posted(page), [{ type: 'overflowReport', version: 14, slides: [
      { index: 3, bottomPx: 42, hitsTakeaway: true, hitsHeader: false }, { index: 7, bottomPx: 42, hitsTakeaway: false, hitsHeader: false }] }]);
    assert.equal(await page.evaluate(() => window.__ofCalls), 11, '全スライドに 1 回ずつ');
    const g = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]'));
      const star = document.querySelector('.ss-mark').getBoundingClientRect();
      return Array.from(document.querySelectorAll('.ss-over')).map(e => {
        const b = e.getBoundingClientRect(), f = frames[Number(e.getAttribute('data-index'))].getBoundingClientRect();
        return { i: e.getAttribute('data-index'), text: e.textContent, title: e.title, above: b.bottom <= f.top + 4 && b.left >= f.left,
          rightOfStar: e.getAttribute('data-index') === '3' ? b.left >= star.right - 1 : null };
      });
    });
    assert.deepEqual(g.map(x => [x.i, x.text, x.above, x.rightOfStar]), [['3', '⚠ はみ出し', true, true], ['7', '⚠ はみ出し', true, null]]);
    assert.match(g[0].title, /42px/); assert.match(g[0].title, /takeaway/); assert.doesNotMatch(g[1].title, /takeaway/);
    // 同じ結果の描き直しでは送らない。変わったら送る
    await clearPosted(page);
    await send(page, { type: 'render', html: r.html, css: r.css, index: 0, version: 15, marks });
    await sleep(800);
    assert.deepEqual(await posted(page), []);
    await page.evaluate(() => { window.__ofBad = new Set([7]); });
    await send(page, { type: 'render', html: r.html, css: r.css, index: 0, version: 16, marks });
    await sleep(800);
    assert.deepEqual(await posted(page), [{ type: 'overflowReport', version: 16, slides: [{ index: 7, bottomPx: 42, hitsTakeaway: false, hitsHeader: false }] }]);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.ss-over').length), 1);
    // 編集中は回さない。終えたら回る
    await clearPosted(page);
    await dbl(page, await textPoint(page, 2, 'のしくみを知る'));
    await page.evaluate(() => { window.__ofCalls = 0; window.__ofBad = new Set(); });
    await send(page, { type: 'render', html: r.html, css: r.css, index: 0, version: 17, marks });
    await page.evaluate(() => document.querySelector('#wrap img') && document.querySelector('#wrap img').dispatchEvent(new Event('load')));
    await sleep(800);
    assert.equal(await page.evaluate(() => window.__ofCalls), 0);
    await page.keyboard.press('Escape');
    await sleep(900);
    assert.equal(await page.evaluate(() => window.__ofCalls), 11);
    assert.deepEqual((await posted(page, 'overflowReport')).map(m => m.slides), [[]]);
  });
});

// 目視確認用のスクリーンショット（合否は「撮れたか」だけ）。幅 700px と 1400px。
for (const width of [700, 1400]) {
  test(`スクリーンショット ${width}px`, async (t) => {
    const marks = new Array(11).fill(false); marks[2] = true; marks[10] = true;
    await withPage(t, { width, init: { index: 2, marks } }, async (page) => {
      await sleep(600);
      const shot = (name) => page.screenshot({ path: path.join(OUT, `shot-${width}-${name}.png`) });
      const pt = await textPoint(page, 2, 'のしくみを知る');
      await page.evaluate(() => document.querySelector('svg.current-slide').scrollIntoView({ block: 'start', behavior: 'instant' }));
      const pt2 = await page.evaluate(() => { const li = Array.from(document.querySelectorAll('svg.current-slide li')).find(l => l.textContent.includes('のしくみを知る')); const b = li.getBoundingClientRect(); return { x: b.left + 40, y: b.top + b.height / 2 }; });
      await page.mouse.move(pt2.x, pt2.y);
      await shot('1-hover');
      await dbl(page, pt2);
      await page.keyboard.type('（編集中）');
      await shot('2-editing');
      await page.keyboard.press('Escape');
      await send(page, { type: 'editResult', ok: false, message: '原稿が先に変わりました。もう一度' });
      await sleep(250);
      await shot('3-toast');
      await send(page, { type: 'scrollToSlide', index: 10 });
      await sleep(2500);   // 長い距離のスムーズスクロールは 1 秒以上かかる。終わる前に押すと mouseup が別の要素に落ちる
      await dbl(page, await textPoint(page, 10, '箱の中の文字'));
      assert.equal((await editingInfo(page)).input, '箱の中の文字');
      await shot('4-svg-input');
      await page.keyboard.press('Escape');
      await dbl(page, await textPoint(page, 10, '追加スライドの要点'));
      await shot('5-takeaway-editing');
      await page.keyboard.press('Escape');
      const many = []; for (let i = 0; i < 9; i++) many.push(Object.assign({}, ENTRIES[i % 3], { id: ENTRIES[i % 3].id + '-' + i }));
      await send(page, { type: 'library', entries: many });
      await sleep(200);
      await shot('6-gallery');
      assert.ok(fs.existsSync(path.join(OUT, `shot-${width}-6-gallery.png`)));
      await page.keyboard.press('Escape');
      // ＋ボタン（ふだんの薄さ／ホバー）と ⚠
      await page.evaluate(() => { window.ssDetectOverflow = (sec) => ({ overflow: !!sec.querySelector('.takeaway'), bottomPx: 37, hitsTakeaway: true, hitsHeader: false }); });
      const r = H.renderForMessage(built.md);
      await send(page, { type: 'render', html: r.html, css: r.css, index: 2, version: 13, marks });
      await send(page, { type: 'scrollToSlide', index: 2 });
      await sleep(2500);
      await page.evaluate(() => window.scrollBy({ top: -120, behavior: 'instant' }));
      await sleep(200);
      await shot('7-insert-buttons');
      await page.hover('.ss-insert[data-index="2"]');
      await sleep(250);
      await shot('8-insert-hover');
      // 挿入ポップアップ（棚 2 つ＋上位。1 枚を Shift で選んだ状態）と、「名前を付ける…」の入力
      const fx = corpus(6);
      await answerPrefetch(page, fx, shelvesOf(fx));
      await page.click('.ss-insert[data-index="2"]');
      await answer(page, await lastSearch(page), fx, { items: fx.items.slice(0, 9) });
      await shot('8b-popup');
      await page.keyboard.down('Shift');
      await page.click('.ss-pop .ss-pc-shelf:nth-child(2) .ss-gal-thumbbox');
      await page.keyboard.up('Shift');
      await page.hover('.ss-pop .ss-pc:not(.ss-pc-shelf)');
      await page.click('.ss-pop .ss-pc:not(.ss-pc-shelf) .ss-pc-add');
      await sleep(150);
      await shot('8c-popup-naming');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      // 検索ギャラリー（見本デック 2 本。3 枚を選んだ状態。先頭に棚）
      await openGal(page, 2);
      await answer(page, await lastSearch(page), fx, { total: 40 });
      for (const i of [1, 7, 3]) await page.click(`.ss-gal-grid > .ss-gal-pick[data-key="${fx.items[i].key}"] .ss-gal-name`);
      await page.evaluate(() => document.querySelector('.ss-gal-grid').scrollTo(0, 0));
      await sleep(400);
      await shot('9-corpus-gallery');
      assert.ok(fs.existsSync(path.join(OUT, `shot-${width}-9-corpus-gallery.png`)));
      void pt;
    });
  });
}

// ====================================================================================================
// ＋ポップアップ・棚・差し替え（patch）・公開 API（DESIGN.md 8.0 / 8.1 / 8.2 / 8.3 / 8.4）
// ====================================================================================================
const SETTLE = 1300;   // 開いた直後のスムーズスクロール（現在のスライドへ）が終わるのを待つ。途中で座標を取るとずれる
const SKELETON_BUDGET = 100, THUMBS_BUDGET = 400, PATCH_BUDGET = 50;   // ms。超えたら失敗（DESIGN.md 8.0）
// CI の共有ランナーでは速さの予算を assert しない（測って # timings に出すだけ。手元では assert する）。
// 速さ以外の確かめ（枚数・並び・応答）は CI でも行う。ほかのテストファイルの速さの試験と同じ扱い。
const TIME_BUDGETS = !process.env.CI;
const TIMINGS = [];
after(() => { if (TIMINGS.length) console.log('# timings\n' + TIMINGS.map(s => '#   ' + s).join('\n')); });

/** 描画結果をスライド枠（svg[data-marpit-svg]）ごとに切る。拡張が patch を作るときと同じ切り方 */
function splitSlides(html) {
  const parts = html.split(/(?=<svg[^>]*\bdata-marpit-svg)/).slice(1);
  if (parts.length) parts[parts.length - 1] = parts[parts.length - 1].replace(/<\/div>\s*$/, '');
  return parts;
}
/** 棚 2 つ（自己紹介 9 枚＋行方不明 1 件／生成AI 2 枚）。item は corpusResults と同じ形に label を足したもの */
function shelvesOf(fx) {
  const a = fx.items.slice(0, 9).map((it, i) => Object.assign({}, it, { label: '自己紹介 その' + (i + 1) }));
  a.push({ label: '消えたスライド', missing: true });
  const b = fx.items.slice(9, 11).map((it, i) => Object.assign({}, it, { label: '生成AI ' + (i + 1) }));
  return [{ name: '自己紹介', items: a }, { name: '生成AI', items: b }];
}
/** 先読み（corpusPrefetch）に拡張の代わりに答える：shelfState（棚と css）＋ corpusResults（上位） */
async function answerPrefetch(page, fx, shelves) {
  let req = null;
  for (let i = 0; i < 40 && !req; i++) { req = (await posted(page, 'corpusPrefetch'))[0] || null; if (!req) await sleep(50); }
  assert.ok(req, 'プレビューを開いたあとのアイドル時間に corpusPrefetch が飛ぶ');
  assert.deepEqual([req.kind, Number.isInteger(req.reqId), Array.isArray(req.haveCss)], ['shelf', true, true]);
  await send(page, { type: 'shelfState', shelves, css: fx.css });
  await send(page, { type: 'corpusResults', reqId: req.reqId, total: fx.items.length, offset: 0, building: false, items: fx.items.slice(0, 9), css: {} });
  return req;
}
const popState = (page) => page.evaluate(() => {
  const el = document.querySelector('.ss-pop');
  const r = el.getBoundingClientRect();
  const cards = Array.from(el.querySelectorAll('.ss-pc'));
  return {
    open: el.classList.contains('ss-open'), up: el.classList.contains('ss-up'),
    rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, vw: document.documentElement.clientWidth, vh: window.innerHeight,
    focusFilter: document.activeElement === el.querySelector('.ss-pop-filter'),
    heads: Array.from(el.querySelectorAll('.ss-pop-h')).map(e => e.firstChild.textContent),
    tabs: Array.from(el.querySelectorAll('.ss-shelf-tab')).map(e => e.textContent + (e.classList.contains('ss-on') ? '*' : '')),
    shelf: Array.from(el.querySelectorAll('.ss-pc-shelf .ss-pc-name')).map(e => e.textContent),
    other: Array.from(el.querySelectorAll('.ss-pc:not(.ss-pc-shelf)')).map(e => e.getAttribute('data-key')),
    filled: cards.filter(c => { const hst = c.querySelector('.ss-gal-shadow'); return hst && hst.shadowRoot && hst.shadowRoot.querySelector('section'); }).length,
    // 同じスライドが棚と上位の両方に出ていれば両方に印が付く。ここでは重複をまとめる
    sel: Array.from(new Set(Array.from(el.querySelectorAll('.ss-pc.ss-sel')).map(c => c.getAttribute('data-key') + '=' + c.querySelector('.ss-gal-order').textContent))),
    active: Array.from(document.querySelectorAll('.ss-insert.ss-active')).map(b => b.getAttribute('data-index')),
  };
});
/** ＋ の帯（index の次の間）の中心の画面座標。見える所へスクロールしてから返す */
const gapPoint = (page, index) => page.evaluate((index) => {
  const b = document.querySelector('.ss-insert[data-index="' + index + '"]');
  const y = parseFloat(b.style.top) - window.scrollY;
  if (y < 80 || y > window.innerHeight - 80) window.scrollTo(0, parseFloat(b.style.top) - window.innerHeight / 2);
  return { x: parseFloat(b.style.left) - window.scrollX, y: parseFloat(b.style.top) - window.scrollY };
}, index);
const insertLook = (page, index) => page.evaluate((index) => {
  const b = document.querySelector('.ss-insert[data-index="' + index + '"]');
  const cs = getComputedStyle(b);
  return { near: b.classList.contains('ss-near'), opacity: parseFloat(cs.opacity), pe: cs.pointerEvents };
}, index);

test('＋ はスライドの間にマウスを乗せたときだけ現れる（1 枚目の上＝−1・最後の下も）。100ms 以内。スライドの上では消える', async (t) => {
  await withPage(t, { init: { index: 2 } }, async (page) => {
    await sleep(SETTLE);
    for (const idx of [-1, 3, 10]) {
      const before = await insertLook(page, idx);
      assert.deepEqual([before.near, before.opacity, before.pe], [false, 0, 'none'], `ふだんは見えず、押せない（index ${idx}）`);
      const p = await gapPoint(page, idx);
      await page.mouse.move(p.x + 180, p.y + 6);   // ボタンの真上でなくても、間の帯の中なら出る
      const t0 = Date.now();
      await sleep(80);
      let look = await insertLook(page, idx);
      // 「100ms 以内」は手元でだけ確かめる。CI の共有ランナーでは、見えるようになるまで最大 1 秒待つ（出ること自体は確かめる）
      for (let i = 0; !TIME_BUDGETS && i < 46 && !(look.near && look.opacity === 1); i++) { await sleep(20); look = await insertLook(page, idx); }
      assert.deepEqual([look.near, look.opacity, look.pe], [true, 1, 'auto'], `帯に乗ると ${TIME_BUDGETS ? '100ms' : '1 秒'} 以内に見える（index ${idx}・${Date.now() - t0}ms）`);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.ss-insert.ss-near').length), 1, '出るのは 1 つだけ');
      // 余白より少し広い：スライドの端 6px に入っていても出ている
      await page.mouse.move(p.x + 180, p.y + 15 + 6);
      if (idx !== 10) assert.equal((await insertLook(page, idx)).near, true, '当たり判定は余白より少し広い');
      await page.mouse.move(p.x + 180, p.y + 120 * (idx === 10 ? -1 : 1));   // スライドの中へ
      await sleep(80);
      const gone = await insertLook(page, idx);
      assert.deepEqual([gone.near, gone.opacity], [false, 0], 'スライドの上では消える');
    }
    assert.deepEqual(await posted(page), [], '乗せただけでは何も送らない');
  });
});

test('＋ をクリック → その近くに小さなポップアップ。検索欄にフォーカス、corpusSearch（空の語・手を入れた順・9 件）。画面からはみ出さず、下に入らなければ上へ', async (t) => {
  await withPage(t, { init: { index: 2 } }, async (page) => {
    const fx = corpus(6);
    await sleep(SETTLE);
    const p = await gapPoint(page, 4);
    await page.mouse.click(p.x, p.y);
    await sleep(REVEAL_WAIT);
    const ps = await posted(page);
    assert.deepEqual(ps, [{ type: 'corpusSearch', reqId: ps[0].reqId, query: '', onlyMarked: false, sort: 'score', offset: 0, limit: 9, haveCss: [] }], '逆引きも gotoSlide も飛ばない');
    let g = await popState(page);
    assert.deepEqual([g.open, g.focusFilter, g.active], [true, true, ['4']]);
    assert.equal((await galState(page)).open, false, '全面ギャラリーではない');
    assert.ok(g.rect.right - g.rect.left <= 460, '小さい');
    assert.ok(g.rect.left >= 0 && g.rect.right <= g.vw && g.rect.top >= 0 && g.rect.bottom <= g.vh, '画面の中に収まる');
    const btn = await page.evaluate(() => { const r = document.querySelector('.ss-insert.ss-active').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    assert.ok(g.up ? g.rect.bottom <= btn.top : g.rect.top >= btn.bottom, '＋ を隠さない');
    assert.ok(Math.min(Math.abs(g.rect.top - btn.bottom), Math.abs(btn.top - g.rect.bottom)) <= 20, '＋ のすぐ近く');
    await answer(page, ps[0], fx, { items: fx.items.slice(0, 9) });
    g = await popState(page);
    assert.deepEqual([g.other.length, g.filled, g.shelf.length], [9, 9, 0], '棚が空なら「手を入れた順」を 9 枚');
    // Esc で閉じる
    await page.keyboard.press('Escape');
    assert.deepEqual([(await popState(page)).open, (await popState(page)).active], [false, []]);
    // ＋ が画面の下のほうにあるときは上に出す
    await page.evaluate(() => { const b = document.querySelector('.ss-insert[data-index="1"]'); window.scrollTo(0, parseFloat(b.style.top) - window.innerHeight + 90); });
    await sleep(100);
    const low = await page.evaluate(() => { const b = document.querySelector('.ss-insert[data-index="1"]'); return { x: parseFloat(b.style.left) - window.scrollX, y: parseFloat(b.style.top) - window.scrollY }; });
    await page.mouse.click(low.x, low.y);
    g = await popState(page);
    assert.deepEqual([g.open, g.up], [true, true]);
    assert.ok(g.rect.top >= 0 && g.rect.bottom <= low.y, '上に出て、画面の中に収まる');
    // 外側クリックで閉じる。そのクリックで原稿へ飛ばない
    await clearPosted(page);
    await page.mouse.click(30, 30);
    await sleep(REVEAL_WAIT);
    assert.equal((await popState(page)).open, false);
    assert.deepEqual(await posted(page), []);
  });
});

test('速さ（8.0）：先読み済みなら、クリックから骨組みが 100ms 以内・棚 9 枚のサムネイルが 400ms 以内。届いた結果は次に開いた瞬間に出る', async (t) => {
  await withPage(t, { init: { index: 2 } }, async (page) => {
    const fx = corpus(6);
    await answerPrefetch(page, fx, shelvesOf(fx));
    await gapPoint(page, 3);
    // 先読みの応答の直後（サムネイルの作り置きが済んでいるとは限らない）に開いて測る
    const m = await page.evaluate(() => new Promise((resolve) => {
      const pop = document.querySelector('.ss-pop');
      const t0 = performance.now();
      document.querySelector('.ss-insert[data-index="3"]').click();
      void pop.offsetHeight;   // レイアウトまで含める
      const shelfCards = pop.querySelectorAll('.ss-pc-shelf').length, all = pop.querySelectorAll('.ss-pc').length;
      const names = Array.from(pop.querySelectorAll('.ss-pc-shelf .ss-gal-shadow')).filter(hst => hst.shadowRoot || hst.textContent.trim()).length;
      const skeleton = performance.now() - t0;
      const filled = () => Array.from(pop.querySelectorAll('.ss-pc-shelf.ss-gal-pick .ss-gal-shadow')).filter(hst => hst.shadowRoot && hst.shadowRoot.querySelector('section')).length;
      const tick = () => {
        if (filled() >= 9) { void pop.offsetHeight; resolve({ skeleton, thumbs: performance.now() - t0, shelfCards, all, names }); }
        else if (performance.now() - t0 > 3000) resolve({ skeleton, thumbs: Infinity, shelfCards, all, names, filled: filled() });
        else setTimeout(tick, 4);
      };
      tick();
    }));
    TIMINGS.push(`＋ポップアップ（棚 9 枚＋上位 6 枚・先読み済み）：骨組み ${m.skeleton.toFixed(1)}ms／棚 9 枚のサムネイル ${m.thumbs.toFixed(1)}ms`);
    assert.deepEqual([m.shelfCards, m.all, m.names], [9, 15, 9], 'クリックと同期して、棚 9 枚（行方不明は 10 枚目なので出ない）＋上位 6 枚の骨組みが出る');
    if (TIME_BUDGETS) {
      assert.ok(m.skeleton <= SKELETON_BUDGET, `骨組み ${m.skeleton.toFixed(1)}ms ≤ ${SKELETON_BUDGET}ms`);
      assert.ok(m.thumbs <= THUMBS_BUDGET, `サムネイル ${m.thumbs}ms ≤ ${THUMBS_BUDGET}ms`);
    } else assert.ok(Number.isFinite(m.thumbs), `棚 9 枚のサムネイルが 3 秒以内に出ない（${m.filled} 枚）`);
    const g = await popState(page);
    assert.deepEqual(g.tabs, ['自己紹介*', '生成AI']);
    assert.deepEqual(g.heads, ['棚', '手を入れた順']);
    assert.equal(g.shelf[0], '自己紹介 その1');
    // 並行して問い合わせも飛んでいる。同じ並びの応答では描き直さない（カードの要素が同じまま）
    const req = await lastSearch(page);
    assert.equal(req.query, '');
    await page.evaluate(() => { window.__card0 = document.querySelector('.ss-pop .ss-pc:not(.ss-pc-shelf)'); });
    await answer(page, req, fx, { items: fx.items.slice(0, 9) });
    assert.equal(await page.evaluate(() => window.__card0 === document.querySelector('.ss-pop .ss-pc:not(.ss-pc-shelf)')), true);
    // 開き直し：作り済みのサムネイルを使い回すので、開いた瞬間に絵が入っている
    await page.keyboard.press('Escape');
    const again = await page.evaluate(() => {
      const t0 = performance.now();
      document.querySelector('.ss-insert[data-index="5"]').click();
      const pop = document.querySelector('.ss-pop');
      const n = Array.from(pop.querySelectorAll('.ss-pc .ss-gal-shadow')).filter(hst => hst.shadowRoot && hst.shadowRoot.querySelector('section')).length;
      void pop.offsetHeight;
      return { n, ms: performance.now() - t0 };
    });
    TIMINGS.push(`＋ポップアップの開き直し：15 枚とも絵つきで ${again.ms.toFixed(1)}ms`);
    assert.equal(again.n, 15);
    if (TIME_BUDGETS) assert.ok(again.ms <= SKELETON_BUDGET, `開き直し ${again.ms.toFixed(1)}ms ≤ ${SKELETON_BUDGET}ms`);
  });
});

test('サムネイルの css は adoptedStyleSheets でデックごとに 1 回だけ解析して共有する（<style> にデックの css を入れない）。中は pointer-events:none・script なし', async (t) => {
  await withPage(t, async (page) => {
    const fx = corpus(6);
    await answerPrefetch(page, fx, shelvesOf(fx));
    await page.evaluate(() => document.querySelector('.ss-insert[data-index="0"]').click());
    await sleep(400);
    const r = await page.evaluate(() => {
      const hosts = Array.from(document.querySelectorAll('.ss-pop .ss-pc .ss-gal-shadow')).filter(hst => hst.shadowRoot);
      const byKey = new Map();
      let shared = true, bigStyle = 0, scripts = 0;
      for (const hst of hosts) {
        const k = hst.__ssItem.cssKey, sh = hst.shadowRoot.adoptedStyleSheets;
        if (sh.length !== 2) shared = false;
        if (byKey.has(k) && byKey.get(k) !== sh[0]) shared = false;
        byKey.set(k, sh[0]);
        for (const st of hst.shadowRoot.querySelectorAll('style')) if (st.textContent.length > 2000) bigStyle++;
        scripts += hst.shadowRoot.querySelectorAll('script').length;
      }
      const sheets = Array.from(byKey.values());
      const sec = hosts[0].shadowRoot.querySelector('section');
      return { hosts: hosts.length, decks: byKey.size, distinct: new Set(sheets).size, shared, bigStyle, scripts,
        fixShared: hosts.every(hst => hst.shadowRoot.adoptedStyleSheets[1] === hosts[0].shadowRoot.adoptedStyleSheets[1]),
        pe: getComputedStyle(hosts[0].shadowRoot.querySelector('div.marpit')).pointerEvents,
        accent: getComputedStyle(sec).getPropertyValue('--accent').trim() !== '' || getComputedStyle(sec).fontSize !== '' };
    });
    assert.ok(r.hosts >= 12 && r.decks === 2, `2 デック・${r.hosts} 枚`);
    assert.deepEqual([r.shared, r.distinct, r.fixShared, r.bigStyle, r.scripts, r.pe], [true, 2, true, 0, 0, 'none']);
    assert.ok(r.accent);
  });
});

test('ポップアップ：クリックで即 corpusInsert（index は ＋ の位置）。Shift+クリックで複数 →「ここに挿入」。チェックは keepColors / keepTypo', async (t) => {
  await withPage(t, { init: { index: 2 } }, async (page) => {
    const fx = corpus(6);
    await answerPrefetch(page, fx, shelvesOf(fx));
    await page.evaluate(() => document.querySelector('.ss-insert[data-index="-1"]').click());
    await sleep(300);
    await clearPosted(page);
    await page.click('.ss-pop .ss-pc-shelf:nth-child(2) .ss-gal-thumbbox');
    assert.deepEqual(await posted(page), [{ type: 'corpusInsert', index: -1, version: 12, keepColors: false, keepTypo: false, items: [{ deck: fx.items[1].deck, slide: fx.items[1].slide }] }]);
    assert.equal((await popState(page)).open, false, '入れたら閉じる');
    // 複数：Shift+クリックで選んだ順。選び始めたら、ふつうのクリックも選択の切り替え
    await page.evaluate(() => document.querySelector('.ss-insert[data-index="6"]').click());
    await sleep(200);
    await clearPosted(page);
    await page.keyboard.down('Shift');
    await page.click('.ss-pop .ss-pc-shelf:nth-child(3) .ss-gal-thumbbox');
    await page.click('.ss-pop .ss-pc-shelf:nth-child(1) .ss-gal-thumbbox');
    await page.keyboard.up('Shift');
    await page.click('.ss-pop .ss-pc-shelf:nth-child(5) .ss-gal-thumbbox');
    await page.click('.ss-pop .ss-pc-shelf:nth-child(1) .ss-gal-thumbbox');   // 外す
    let g = await popState(page);
    assert.deepEqual(g.sel, [fx.items[2].key + '=1', fx.items[4].key + '=2']);
    assert.deepEqual(await posted(page, 'corpusInsert'), [], '選んでいる間は入れない');
    await page.click('.ss-pop .ss-pop-check:nth-of-type(1) input');
    await page.click('.ss-pop .ss-pop-check:nth-of-type(2) input');
    await page.click('.ss-pop-insert');
    assert.deepEqual(await posted(page, 'corpusInsert'), [{ type: 'corpusInsert', index: 6, version: 12, keepColors: true, keepTypo: true,
      items: [{ deck: fx.items[2].deck, slide: fx.items[2].slide }, { deck: fx.items[4].deck, slide: fx.items[4].slide }] }]);
    // 「もっと探す」→ 全面ギャラリー（挿入位置・語・チェックを持ち越す）。ポップアップは同時に 1 つだけ
    await page.evaluate(() => document.querySelector('.ss-insert[data-index="4"]').click());
    await page.keyboard.type('自己');
    await page.click('.ss-pop-more');
    g = await popState(page);
    const gs = await galState(page);
    assert.deepEqual([g.open, gs.open], [false, true]);
    assert.match(gs.title, /5 枚目の次/);
    assert.equal((await lastSearch(page)).query, '自己');
    assert.equal(await page.evaluate(() => document.querySelector('.ss-gal-foot .ss-gal-check input').checked), true);
  });
});

test('ポップアップの検索：150ms まとめて送り、結果に置き換わる。古い reqId の応答は捨てる。消すと棚に戻る', async (t) => {
  await withPage(t, async (page) => {
    const fx = corpus(6);
    await answerPrefetch(page, fx, shelvesOf(fx));
    await page.evaluate(() => document.querySelector('.ss-insert[data-index="2"]').click());
    await sleep(100);
    const first = await lastSearch(page);
    await clearPosted(page);
    await page.keyboard.type('jk');
    assert.deepEqual(await posted(page), [], 'デバウンス中は送らない。j/k でスライドも動かない');
    await sleep(260);
    const s1 = await lastSearch(page);
    assert.deepEqual([s1.query, s1.sort, s1.limit], ['jk', 'relevance', 9]);
    assert.deepEqual(s1.haveCss.slice().sort(), Object.keys(fx.css).sort(), '受信済みの css は送り直させない');
    assert.deepEqual((await popState(page)).heads, ['検索中…']);
    await page.keyboard.type(' 重み');
    await sleep(260);
    const s2 = await lastSearch(page);
    assert.ok(s2.reqId > s1.reqId && s2.query === 'jk 重み');
    // 古い応答（最初の空の語・1 つ前の語）は捨てる
    await answer(page, first, fx, { items: fx.items.slice(0, 9) });
    await answer(page, s1, fx, { items: fx.items.slice(0, 5), total: 5 });
    assert.deepEqual((await popState(page)).heads, ['検索中…']);
    await answer(page, s2, fx, { items: fx.items.slice(10, 12), total: 2 });
    let g = await popState(page);
    assert.deepEqual([g.heads, g.other, g.shelf.length, g.filled], [['検索結果（2 件）'], [fx.items[10].key, fx.items[11].key], 0, 2]);
    // Enter：カードに降りて Enter で、その 1 枚を入れる
    await clearPosted(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.deepEqual((await posted(page, 'corpusInsert')).map(m => [m.index, m.items]), [[2, [{ deck: fx.items[10].deck, slide: fx.items[10].slide }]]]);
    // 語を消すと棚と上位に戻る。0 件の表示
    await page.evaluate(() => document.querySelector('.ss-insert[data-index="2"]').click());
    await page.keyboard.type('zzz');
    await sleep(260);
    await answer(page, await lastSearch(page), fx, { items: [], total: 0 });
    assert.match(await page.evaluate(() => document.querySelector('.ss-pop .ss-pop-note').textContent), /該当するスライドがありません/);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
    await sleep(260);
    g = await popState(page);
    assert.deepEqual([g.heads, g.shelf.length], [['棚', '手を入れた順'], 9]);
    // 閉じたあとに届いた応答でも例外を出さない
    const late = await lastSearch(page);
    await page.keyboard.press('Escape');
    await answer(page, late, fx);
    assert.equal((await popState(page)).open, false);
  });
});

test('キーボード：スライドを選んで + か i でポップアップ（現在のスライドの次）。編集中の i は文字として入る', async (t) => {
  await withPage(t, { init: { index: 2 } }, async (page) => {
    await sleep(SETTLE);
    await clearPosted(page);
    await page.keyboard.press('i');
    let g = await popState(page);
    assert.deepEqual([g.open, g.active, g.focusFilter], [true, ['2'], true]);
    assert.ok(g.rect.top >= 0 && g.rect.bottom <= g.vh);
    await page.keyboard.type('ij+');   // 開いている間は検索欄に入る（開き直さない・スライドも動かない）
    assert.equal(await page.evaluate(() => document.querySelector('.ss-pop-filter').value), 'ij+');
    assert.deepEqual(await posted(page, 'gotoSlide'), []);
    await page.keyboard.press('Escape');
    await page.keyboard.press('j');
    await sleep(100);
    await page.keyboard.press('+');
    g = await popState(page);
    assert.deepEqual([g.open, g.active], [true, ['3']]);
    await page.keyboard.press('Escape');
    // 遠くのスライドを選んでいるとき：＋ が画面の外でも、見える所へ寄せて開く
    await send(page, { type: 'scrollToSlide', index: 9 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.keyboard.press('i');
    g = await popState(page);
    assert.deepEqual([g.open, g.active], [true, ['9']]);
    assert.ok(g.rect.top >= 0 && g.rect.bottom <= g.vh, '画面の中に出る');
    await page.keyboard.press('Escape');
    // 編集中
    await dbl(page, await textPoint(page, 2, 'のしくみを知る'));
    await caretIn(page, 'のしくみを知る', 'end');
    await page.keyboard.type('i+');
    assert.equal((await popState(page)).open, false);
    assert.match(await page.evaluate(() => document.querySelector('.ss-editing').textContent), /i\+/);
    await page.keyboard.press('Escape');
  });
});

test('棚：名前を付ける…（その場の入力・新しい棚）／呼び名の改名／Alt+←→ とドラッグで並べ替え／外す／棚名の改名。見た目は先に変わり、失敗の shelfState で戻る', async (t) => {
  await withPage(t, async (page) => {
    const fx = corpus(6);
    const shelves = shelvesOf(fx);
    await answerPrefetch(page, fx, shelves);
    let dialogs = 0;
    page.on('dialog', async (d) => { dialogs++; await d.dismiss(); });
    await page.evaluate(() => document.querySelector('.ss-insert[data-index="1"]').click());
    await sleep(300);
    await clearPosted(page);
    const edits = async () => (await posted(page, 'shelfEdit')).map(m => { const o = Object.assign({}, m); delete o.type; return o; });
    // 1) 名前を付ける…（上位のカード → 新しい棚）
    await page.hover('.ss-pop .ss-pc:not(.ss-pc-shelf)');
    await page.click('.ss-pop .ss-pc:not(.ss-pc-shelf) .ss-pc-add');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('ss-nf-label')), true, '呼び名の入力にフォーカス');
    assert.equal(await page.evaluate(() => document.activeElement.value), fx.items[0].title, '初期値は題名');
    await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta');
    await page.keyboard.type('表紙 学外用');
    await page.select('.ss-nf-shelf', '+');
    await page.type('.ss-nf-new', '表紙');
    await page.keyboard.press('Enter');
    assert.deepEqual(await edits(), [{ op: 'add', shelf: '表紙', label: '表紙 学外用', deck: fx.items[0].deck, slide: fx.items[0].slide, title: fx.items[0].title, id: null }]);
    let g = await popState(page);
    assert.deepEqual([g.open, g.tabs, g.shelf], [true, ['自己紹介', '生成AI', '表紙*'], ['表紙 学外用']], '応答を待たずに、新しい棚とカードが出る');
    assert.deepEqual(await posted(page, 'corpusInsert'), [], '名前を付けただけでは挿入しない');
    // 失敗の応答（shelves なし）→ 直前の姿へ戻す
    await send(page, { type: 'shelfState', ok: false, message: 'shelf.json に書けませんでした' });
    g = await popState(page);
    assert.deepEqual(g.tabs, ['自己紹介*', '生成AI']);
    assert.match(await page.evaluate(() => document.querySelector('.ss-toast.ss-err').textContent), /書けません/);
    // 2) 呼び名をダブルクリックで改名（クリックでは挿入しない）
    await clearPosted(page);
    await page.click('.ss-pop .ss-pc-shelf:nth-child(2) .ss-pc-name', { clickCount: 2, delay: 30 });
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('ss-inline')), true);
    await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta');
    await page.keyboard.type('自己紹介 jk 学内用');
    await page.keyboard.press('Enter');
    assert.deepEqual(await posted(page), [{ type: 'shelfEdit', op: 'rename', shelf: '自己紹介', at: 1, label: '自己紹介 jk 学内用' }], '挿入も、j/k のスライド送りも起きない');
    assert.equal((await popState(page)).shelf[1], '自己紹介 jk 学内用');
    // Esc は改名だけを破棄（ポップアップは閉じない）
    await page.click('.ss-pop .ss-pc-shelf:nth-child(3) .ss-pc-name', { clickCount: 2, delay: 30 });
    await page.keyboard.type('捨てる');
    await page.keyboard.press('Escape');
    g = await popState(page);
    assert.deepEqual([g.open, g.shelf[2]], [true, '自己紹介 その3']);
    // 3) Alt+→ で並べ替え（フォーカスは動かしたカードに付いていく）
    await clearPosted(page);
    await page.focus('.ss-pop .ss-pc-shelf:nth-child(1)');
    await page.keyboard.down('Alt'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Alt');
    assert.deepEqual(await edits(), [{ op: 'move', shelf: '自己紹介', from: 0, to: 1 }, { op: 'move', shelf: '自己紹介', from: 1, to: 2 }]);
    g = await popState(page);
    assert.deepEqual(g.shelf.slice(0, 3), ['自己紹介 jk 学内用', '自己紹介 その3', '自己紹介 その1']);
    assert.equal(await page.evaluate(() => document.activeElement.querySelector('.ss-pc-name').textContent), '自己紹介 その1');
    // 4) ドラッグで並べ替え（5 枚目 → 1 枚目）
    await clearPosted(page);
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.ss-pop .ss-pc-shelf');
      const dt = new DataTransfer();
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      fire(cards[4], 'dragstart'); fire(cards[0], 'dragover'); fire(cards[0], 'drop'); fire(cards[4], 'dragend');
    });
    assert.deepEqual(await edits(), [{ op: 'move', shelf: '自己紹介', from: 4, to: 0 }]);
    assert.equal((await popState(page)).shelf[0], '自己紹介 その5');
    // 5) 棚から外す
    await clearPosted(page);
    await page.hover('.ss-pop .ss-pc-shelf:nth-child(1)');
    await page.click('.ss-pop .ss-pc-shelf:nth-child(1) .ss-pc-x');
    assert.deepEqual(await edits(), [{ op: 'remove', shelf: '自己紹介', at: 0, label: '自己紹介 その5' }]);
    g = await popState(page);
    assert.equal(g.shelf.includes('自己紹介 その5'), false);
    assert.deepEqual(await posted(page, 'corpusInsert'), []);
    // 6) 棚名：タブで切り替え、ダブルクリックで改名、Alt+← で棚の並べ替え
    await clearPosted(page);
    await page.click('.ss-pop .ss-shelf-tab:nth-child(2)');
    g = await popState(page);
    assert.deepEqual([g.tabs, g.shelf], [['自己紹介', '生成AI*'], ['生成AI 1', '生成AI 2']]);
    await page.click('.ss-pop .ss-shelf-tab:nth-child(2)', { clickCount: 2, delay: 30 });
    await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta');
    await page.keyboard.type('生成AIの説明');
    await page.keyboard.press('Enter');
    await page.focus('.ss-pop .ss-shelf-tab:nth-child(2)');
    await page.keyboard.down('Alt'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Alt');
    assert.deepEqual(await edits(), [{ op: 'renameShelf', shelf: '生成AI', name: '生成AIの説明' }, { op: 'moveShelf', from: 1, to: 0 }]);
    assert.deepEqual((await popState(page)).tabs, ['生成AIの説明*', '自己紹介']);
    // 7) 成功の shelfState（拡張の正本）で表示を置き換える。失敗＋shelves つきなら、その shelves が正
    await send(page, { type: 'shelfState', shelves: [{ name: '自己紹介', items: shelves[0].items.slice(0, 2) }] });
    g = await popState(page);
    assert.deepEqual([g.tabs, g.shelf], [['自己紹介*'], ['自己紹介 その1', '自己紹介 その2']]);
    await page.hover('.ss-pop .ss-pc-shelf:nth-child(1)');
    await page.click('.ss-pop .ss-pc-shelf:nth-child(1) .ss-pc-x');
    assert.deepEqual((await popState(page)).shelf, ['自己紹介 その2']);
    await send(page, { type: 'shelfState', ok: false, message: '断られました', shelves: [{ name: '自己紹介', items: shelves[0].items.slice(0, 3) }] });
    assert.deepEqual((await popState(page)).shelf, ['自己紹介 その1', '自己紹介 その2', '自己紹介 その3']);
    assert.equal(dialogs, 0, 'プロンプトダイアログは使わない');
    // 8) 全面ギャラリーにも棚が出る（語が空のとき）。カードの「名前を付ける…」も同じ入力
    await page.keyboard.press('Escape');
    await openGal(page, 1);
    await answer(page, await lastSearch(page), fx);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.ss-gal-grid > .ss-shelf .ss-pc-name')).map(e => e.textContent)), ['自己紹介 その1', '自己紹介 その2', '自己紹介 その3']);
    await clearPosted(page);
    await page.click('.ss-gal-grid > .ss-gal-pick .ss-gal-naming');
    await page.keyboard.press('Enter');
    const ad = (await edits())[0];
    assert.deepEqual([ad.op, ad.shelf, ad.label], ['add', '自己紹介', fx.items[0].title]);
    assert.deepEqual((await galState(page)).sel, [], '名前を付けても選択はしない');
  });
});

test('patch：その 1 枚の svg だけ差し替わり、ほかの svg は同じ要素のまま。スクロール位置・選択中のスライド・版・印を保つ。当てられない patch は needRender', async (t) => {
  await withPage(t, { init: { index: 2 } }, async (page) => {
    await sleep(SETTLE);
    const parts = splitSlides(H.renderForMessage(built.md.replace('のしくみを知る', 'のしくみを知る（差し替え後）')).html);
    assert.equal(parts.length, built.slideCount);
    await page.evaluate(() => {
      window.scrollTo(0, 777);
      window.__old = Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]'));
      window.__ins = Array.from(document.querySelectorAll('.ss-insert')).map(b => b.style.top);
      window.__ops = document.querySelector('.ss-ops').style.top;
      window.__renders = [];
      window.ssPreview.onRender((e) => window.__renders.push(e));
    });
    await clearPosted(page);
    await send(page, { type: 'patch', version: 13, slides: [{ index: 2, html: parts[2] }], marks: new Array(11).fill(false),
      expect: { index: 2, k: 0, text: '＊食い違う文字＊' } });
    const r = await page.evaluate(() => {
      const now = Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]'));
      return { same: now.map((s, i) => s === window.__old[i]), scrollY: window.scrollY,
        cur: now.findIndex(s => s.classList.contains('current-slide')), text: now[2].textContent.includes('（差し替え後）'),
        version: window.ssPreview.version(), renders: window.__renders,
        ins: JSON.stringify(Array.from(document.querySelectorAll('.ss-insert')).map(b => b.style.top)) === JSON.stringify(window.__ins),
        ops: document.querySelector('.ss-ops').style.top === window.__ops,
        toast: document.querySelector('.ss-toast').textContent };
    });
    assert.deepEqual(r.same, r.same.map((_, i) => i !== 2), '2 枚目（index 2）だけが新しい要素。ほかは === で同じ');
    assert.deepEqual([r.scrollY, r.cur, r.text, r.version, r.ins, r.ops], [777, 2, true, 13, true, true]);
    assert.deepEqual(r.renders, [{ kind: 'patch', indices: [2] }]);
    assert.match(r.toast, /ずれました/, 'expect の検算は render と同じ');
    // 印が変わる patch：★ を置き直す。版が進んだので、以後の操作は新しい版で送られる
    const marks = new Array(11).fill(false); marks[4] = true;
    await send(page, { type: 'patch', version: 14, slides: [{ index: 4, html: parts[4] }], marks });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.ss-mark').length), 1);
    await page.click('.ss-ops button[data-op="duplicate"]');
    assert.deepEqual(await posted(page, 'slideOp'), [{ type: 'slideOp', op: 'duplicate', index: 2, version: 14 }]);
    // 当てられない patch（範囲外・svg でない）は 1 枚も当てず、全体の描き直しを頼む
    await clearPosted(page);
    await page.evaluate(() => { window.__old = Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]')); });
    await send(page, { type: 'patch', version: 15, slides: [{ index: 1, html: parts[1] }, { index: 99, html: parts[0] }] });
    await send(page, { type: 'patch', version: 15, slides: [{ index: 1, html: '<p>svg ではない</p>' }] });
    assert.deepEqual(await posted(page), [{ type: 'needRender', version: 15 }, { type: 'needRender', version: 15 }]);
    assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]')).every((s, i) => s === window.__old[i]) && window.ssPreview.version()), 14);
  });
});

test('patch のあと、はみ出しは差し替えた枚だけ測り直す', async (t) => {
  await withPage(t, async (page) => {
    const parts = splitSlides(H.renderForMessage(built.md).html);
    await page.evaluate(() => {
      window.__ofSeen = []; window.__ofBad = new Set([3]);
      window.ssDetectOverflow = (section) => {
        const i = Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]')).indexOf(section.closest('svg[data-marpit-svg]'));
        window.__ofSeen.push(i);
        return { overflow: window.__ofBad.has(i), bottomPx: 20, hitsTakeaway: false, hitsHeader: false };
      };
    });
    const r = H.renderForMessage(built.md);
    await send(page, { type: 'render', html: r.html, css: r.css, index: 0, version: 13, marks: [] });
    await sleep(700);
    assert.deepEqual((await posted(page, 'overflowReport')).map(m => m.slides.map(s => s.index)), [[3]]);
    await clearPosted(page);
    await page.evaluate(() => { window.__ofSeen = []; window.__ofBad = new Set([5]); });
    await send(page, { type: 'patch', version: 14, slides: [{ index: 5, html: parts[5] }] });
    await sleep(500);
    assert.deepEqual(await page.evaluate(() => Array.from(new Set(window.__ofSeen))), [5], '測るのは差し替えた 1 枚だけ');
    assert.deepEqual((await posted(page, 'overflowReport')).map(m => [m.version, m.slides.map(s => s.index)]), [[14, [3, 5]]], 'ほかの枚の結果は保つ');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.ss-over').length), 2);
  });
});

test('編集中の patch は保留して 1 件にまとめ、確定/破棄のあとに当てる。あとから render が来たら render が勝つ', async (t) => {
  await withPage(t, { init: { index: 2 } }, async (page) => {
    const a = splitSlides(H.renderForMessage(built.md.replace('のしくみを知る', 'のしくみを知る（A）')).html);
    await sleep(SETTLE);
    await dbl(page, await textPoint(page, 2, 'のしくみを知る'));
    assert.equal((await editingInfo(page)).tag, 'li');
    await page.evaluate(() => { window.__old = Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]')); window.__renders = []; window.ssPreview.onRender((e) => window.__renders.push(e)); });
    await send(page, { type: 'patch', version: 13, slides: [{ index: 4, html: a[4] }] });
    await send(page, { type: 'patch', version: 14, slides: [{ index: 2, html: a[2] }] });
    await send(page, { type: 'patch', version: 15, slides: [{ index: 4, html: a[4] }] });
    let st = await page.evaluate(() => ({ same: Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]')).every((s, i) => s === window.__old[i]), v: window.ssPreview.version(), editing: window.ssPreview.isEditing() }));
    assert.deepEqual(st, { same: true, v: 12, editing: true }, '編集中は差し替えない');
    await page.keyboard.press('Escape');
    await sleep(100);
    st = await page.evaluate(() => ({ same: Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]')).map((s, i) => s === window.__old[i]), v: window.ssPreview.version(), renders: window.__renders,
      text: document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[2].textContent.includes('（A）') }));
    assert.deepEqual(st.same, st.same.map((_, i) => i !== 2 && i !== 4));
    assert.deepEqual([st.v, st.text, st.renders], [15, true, [{ kind: 'patch', indices: [4, 2] }]], '3 件が 1 回の差し替えにまとまる');
    // patch → render の順に届いたら、render だけを当てる
    await dbl(page, await textPoint(page, 2, 'のしくみを知る'));
    const full = H.renderForMessage(built.md.replace('のしくみを知る', 'のしくみを知る（全体）'));
    await page.evaluate(() => { window.__renders.length = 0; });
    await send(page, { type: 'patch', version: 16, slides: [{ index: 2, html: a[2] }] });
    await send(page, { type: 'render', html: full.html, css: full.css, index: 2, version: 17, marks: [] });
    await page.keyboard.press('Escape');
    await sleep(100);
    st = await page.evaluate(() => ({ v: window.ssPreview.version(), renders: window.__renders, text: document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[2].textContent.includes('（全体）') }));
    assert.deepEqual(st, { v: 17, renders: [{ kind: 'render', indices: null }], text: true });
    // render → patch の順なら、render の上に patch を当てる
    await dbl(page, await textPoint(page, 2, 'のしくみを知る'));
    await page.evaluate(() => { window.__renders.length = 0; });
    await send(page, { type: 'render', html: full.html, css: full.css, index: 2, version: 18, marks: [] });
    await send(page, { type: 'patch', version: 19, slides: [{ index: 2, html: a[2] }] });
    await page.keyboard.press('Escape');
    await sleep(100);
    st = await page.evaluate(() => ({ v: window.ssPreview.version(), kinds: window.__renders.map(e => e.kind), text: document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[2].textContent.includes('（A）') }));
    assert.deepEqual(st, { v: 19, kinds: ['render', 'patch'], text: true });
  });
});

test('速さ（8.4）：80 枚のデックで、1 枚の patch の適用が 50ms 以内。render（全体差し替え）との実測比', async (t) => {
  // 見本デックの先頭 10 枚を 8 回くり返して 80 枚にする（図・画像つきの実際の重さで測る）
  const src = H.deckSource(10);
  const fmEnd = src.indexOf('\n---', 3) + 4;
  const body = src.slice(fmEnd).replace(/^\s*\n/, '');
  const md = src.slice(0, fmEnd) + '\n' + new Array(8).fill(body).join('\n\n---\n\n');
  await withPage(t, { md, init: { index: 40 } }, async (page) => {
    const n = await page.evaluate(() => document.querySelectorAll('div.marpit > svg[data-marpit-svg]').length);
    assert.ok(n >= 80, `${n} 枚`);
    const full = H.renderForMessage(md);
    const parts = splitSlides(full.html);
    assert.equal(parts.length, n);
    await page.evaluate(() => { window.__done = null; window.ssPreview.onRender(() => { void document.body.offsetHeight; if (window.__done) window.__done(performance.now()); }); });
    const measure = (msg) => page.evaluate((m) => new Promise((resolve) => {
      const t0 = performance.now();
      window.__done = (t1) => { window.__done = null; resolve(t1 - t0); };
      window.postMessage(m, '*');
    }), msg);
    const patchMs = [], renderMs = [];
    for (let i = 0; i < 5; i++) {
      patchMs.push(await measure({ type: 'patch', version: 20 + i, slides: [{ index: 40 + i, html: parts[40 + i] }] }));
      await sleep(80);
    }
    for (let i = 0; i < 3; i++) {
      renderMs.push(await measure({ type: 'render', html: full.html, css: full.css, index: 40, version: 30 + i, marks: [] }));
      await sleep(300);
    }
    const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const p = med(patchMs), r = med(renderMs);
    TIMINGS.push(`${n} 枚のデック（html ${(full.html.length / 1024).toFixed(0)}KB）：patch 1 枚 ${p.toFixed(1)}ms（最大 ${Math.max(...patchMs).toFixed(1)}ms）／render 全体 ${r.toFixed(1)}ms → patch は render の 1/${(r / p).toFixed(1)}`);
    if (TIME_BUDGETS) assert.ok(Math.max(...patchMs) <= PATCH_BUDGET, `patch ${patchMs.map(x => x.toFixed(1)).join(' / ')}ms ≤ ${PATCH_BUDGET}ms`);
  });
});

test('公開 API：window.ssPreview（slides / sectionOf / current / post / version / toast / isEditing / onRender / closePopups）。右クリックは止めない', async (t) => {
  await withPage(t, { init: { index: 3 } }, async (page) => {
    await sleep(200);
    await clearPosted(page);
    const r = await page.evaluate(() => {
      const p = window.ssPreview;
      const ss = p.slides();
      const out = { keys: Object.keys(p).sort(), n: ss.length, sec: p.sectionOf(ss[3]).tagName.toLowerCase(), cur: p.current(), ver: p.version(), editing: p.isEditing() };
      p.post({ type: 'layoutApply', index: 3, version: p.version(), cls: 'lay-cards3' });
      p.toast('配置を変えました');
      out.toast = document.querySelector('.ss-toast.ss-show').textContent;
      const off = p.onRender(() => { throw new Error('ほかの部品の失敗'); });
      out.offIsFn = typeof off === 'function';
      // 右クリックは layouts.js が扱う。ここでは preventDefault しない
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      ss[3].dispatchEvent(ev);
      out.ctxPrevented = ev.defaultPrevented;
      return out;
    });
    assert.deepEqual(r.keys, ['closePopups', 'current', 'isEditing', 'onRender', 'post', 'sectionOf', 'slides', 'toast', 'version']);
    assert.deepEqual([r.n, r.sec, r.cur, r.ver, r.editing, r.toast, r.offIsFn, r.ctxPrevented], [11, 'section', 3, 12, false, '配置を変えました', true, false]);
    assert.deepEqual(await posted(page), [{ type: 'layoutApply', index: 3, version: 12, cls: 'lay-cards3' }]);
    // onRender の中で例外が出ても、描き直しは最後まで進む
    const full = H.renderForMessage(built.md);
    await send(page, { type: 'render', html: full.html, css: full.css, index: 5, version: 13, marks: [] });
    assert.deepEqual(await page.evaluate(() => [window.ssPreview.current(), window.ssPreview.version()]), [5, 13]);
    // closePopups：ポップアップも全面ギャラリーも閉じ、ほかの部品へ ss-close-popups を知らせる。開くときは同時に 1 つだけ
    await page.evaluate(() => { window.__closed = 0; window.addEventListener('ss-close-popups', () => window.__closed++); });
    await page.keyboard.press('i');
    assert.equal((await popState(page)).open, true);
    const c1 = await page.evaluate(() => window.__closed);
    assert.ok(c1 >= 1, '開くときに、ほかのポップアップを閉じさせる');
    await page.evaluate(() => window.ssPreview.closePopups());
    assert.equal((await popState(page)).open, false);
    await openGal(page, 2);
    assert.equal((await galState(page)).open, true);
    await page.evaluate(() => window.ssPreview.closePopups());
    assert.equal((await galState(page)).open, false);
    // isEditing
    await dbl(page, await textPoint(page, 2, 'のしくみを知る'));
    assert.equal(await page.evaluate(() => window.ssPreview.isEditing()), true);
    await page.keyboard.press('Escape');
  });
});

// ---------- 通し試験（作者の手元の、配布しない試験）で見つけた不具合の再発防止 ----------
test('サムネイル：onerror= などのイベント属性と javascript: の URL は外してから入れる（CSP が unsafe-inline なので、入れると動く）', async (t) => {
  await withPage(t, async (page) => {
    const fx = corpus();
    const items = fx.items.map(x => Object.assign({}, x));
    items[0].html = items[0].html.replace(/<\/section>/, '<img src="./no-such.png" onerror="window.__pwnedAttr = 1" alt="x"><a href="javascript:window.__pwnedHref=1" onclick="window.__pwnedClick=1">リンク</a><svg width="10" height="10" onload="window.__pwnedSvg = 1"></svg></section>');
    await send(page, { type: 'gallery', index: 0 });
    await answer(page, await lastSearch(page), { items, css: fx.css });
    await sleep(400);   // 画像の読み込み失敗（onerror が動くならここまでに動く）
    const g = await page.evaluate(() => {
      const root = document.querySelector('.ss-gal-pick .ss-gal-shadow').shadowRoot;
      return { img: !!root.querySelector('img'), handlers: Array.from(root.querySelectorAll('*')).filter(e => Array.from(e.attributes).some(a => /^on/i.test(a.name))).length,
        href: root.querySelector('a').getAttribute('href'), pwned: [window.__pwnedAttr, window.__pwnedHref, window.__pwnedClick, window.__pwnedSvg].map(x => x === undefined ? 0 : x) };
    });
    assert.ok(g.img, '画像そのものは残す');
    assert.equal(g.handlers, 0, 'on* 属性は残さない');
    assert.equal(g.href, null, 'javascript: の href は外す');
    assert.deepEqual(g.pwned, [0, 0, 0, 0], '何も実行されない');
  });
});

test('patch：いま表示している版より古い patch は当てない（順序が入れ替わって届いても、新しい表示を上書きしない）', async (t) => {
  await withPage(t, { init: { index: 2 } }, async (page) => {
    await sleep(SETTLE);
    const fresh = splitSlides(H.renderForMessage(built.md.replace('のしくみを知る', 'のしくみを知る（新しい版）')).html);
    const stale = splitSlides(H.renderForMessage(built.md.replace('のしくみを知る', 'のしくみを知る（古い版）')).html);
    const marks = new Array(built.slideCount).fill(false);
    await send(page, { type: 'patch', version: 20, slides: [{ index: 2, html: fresh[2] }], marks });
    await clearPosted(page);
    await send(page, { type: 'patch', version: 19, slides: [{ index: 2, html: stale[2] }], marks });
    const s = await page.evaluate(() => ({ text: document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[2].textContent, version: window.ssPreview.version() }));
    assert.ok(s.text.includes('（新しい版）') && !s.text.includes('（古い版）'), '古い patch で上書きしない');
    assert.equal(s.version, 20);
    // 同じ版の patch は当てる（書くものが無い editCommit のあと、表示を原稿どおりに戻す経路）
    await send(page, { type: 'patch', version: 20, slides: [{ index: 2, html: stale[2] }], marks });
    assert.ok((await page.evaluate(() => document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[2].textContent)).includes('（古い版）'));
  });
});
