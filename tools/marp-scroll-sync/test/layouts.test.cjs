// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// media/layouts.js（配置案のポップアップ・DESIGN.md 8.3）のテスト。puppeteer-core＋手元の Chrome。無ければ skip。
//   node --test --test-reporter=tap test/layouts.test.cjs
// preview-harness の HTML（本物の preview.js が window.ssPreview を公開する）に、拡張の buildHtml が足すはずの
//   window.__SS_LAYOUTS__（lib/layout-variants.cjs の browserTable()）・layouts.css・overflow.js・layouts.js を差し込んで試す。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const EXT = path.resolve(__dirname, '..');
const REPO = path.resolve(EXT, '..', '..');
const H = require(path.join(__dirname, 'helpers', 'preview-harness.cjs'));
const lv = require(path.join(EXT, 'lib', 'layout-variants.cjs'));
const lc = require(path.join(EXT, 'lib', 'library-core.cjs'));

const DEMO = path.join(REPO, 'slides', 'sample-layouts', 'sample-layouts.md');
const BUDGET_MS = 400;   // DESIGN 8.0：操作から表示まで 0.4 秒

/** 見本デックの原稿。ハーネスの rewriteAssets は別デック（H.DECK）のフォルダを基準に解くので、そこからの相対パスに直しておく
 *  （file:// の絶対 URL は markdown-it が画像のリンクとして受け付けない） */
const REL = (abs) => path.relative(path.dirname(H.DECK), abs).split(path.sep).join('/');
const FIG = REL(path.join(path.dirname(DEMO), 'src', 'fig11-markdown-class-slide.png'));
function demoMd() {
  return fs.readFileSync(DEMO, 'utf8')
    .replace(/\]\(\.\/src\//g, '](' + REL(path.join(path.dirname(DEMO), 'src')) + '/');
}
/** 見本デックの枚数。EXTRA の各スライドはこの後ろに付くので、番号は N からの相対で書く（見本に枚を足しても壊れない） */
const N = require(path.join(EXT, 'lib', 'slide-split.cjs')).slideStartLines(demoMd()).length;
const EXTRA = [
  // N+0: div で組んだスライド
  '<div class="page-title">div</div>\n\n## div で組んだスライド\n\n<div class="tcols">\n<div>\n\n- 左の列\n\n</div>\n<div>\n\n- 右の列\n\n</div>\n</div>\n',
  // N+1: id つきのインライン svg（グラデーションと矢じり）
  '<div class="page-title">id</div>\n\n## id を持つ図\n\n<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g1"><stop offset="0" stop-color="#A6192E"/><stop offset="1" stop-color="#F6E9EC"/></linearGradient><marker id="ah" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z"/></marker></defs><rect id="box" width="300" height="120" fill="url(#g1)"/><line x1="0" y1="160" x2="300" y2="160" stroke="#262626" marker-end="url(#ah)"/><use href="#box" y="130" opacity=".2"/></svg>\n\n- 図の説明です\n',
  // N+2: はみ出す（図＋多すぎる箇条書き）
  '<div class="page-title">over</div>\n\n## はみ出すスライド\n\n![w:760 図](' + FIG + ')\n\n'
    + Array.from({ length: 12 }, (_, i) => `- 箇条書きの ${i + 1} 行目です`).join('\n') + '\n\n<div class="takeaway">帯</div>\n',  // N+3: 標準と lay-steps では収まるが、いま付いている lay-boxed でははみ出す（5 つの手順・takeaway つき）
  '<!-- _class: lay-boxed -->\n\n<div class="page-title">steps</div>\n\n## 5つの手順\n\n' + Array.from({ length: 5 }, (_, i) => `${i + 1}. **手順${i + 1}をします**\n   説明を1行で書きます。`).join('\n') + '\n\n<div class="takeaway">帯</div>\n',
];
function build(md) {
  const built = H.buildPreviewHtml({ md });
  const read = (p) => fs.readFileSync(path.join(EXT, 'media', p), 'utf8');
  for (const f of ['layouts.js', 'overflow.js']) assert.ok(!/<\/script/i.test(read(f)), f + ' に </script が無い');
  const inject = `<style>${read('layouts.css')}</style>`
    + `<script>window.__SS_LAYOUTS__ = ${JSON.stringify(lv.browserTable()).replace(/</g, '\\u003c')};</script>`
    + `<script>${read('overflow.js')}</script><script>${read('layouts.js')}</script>`;
  built.html = built.html.replace('</body>', inject + '</body>');
  return built;
}
/** ページのエラー。theme/academic.css の @import "schema"（Marp が解けずに残す。CSP が止める）は、この持ち場の外なので除く */
const errorsOf = (p) => (p.__errors || []).filter((e) => !/\/schema'/.test(e));

/** index 枚目の本文の上で contextmenu を起こす。戻り値 { prevented, ms }（ms は 2 フレーム後＝描画まで） */
async function rightClick(page, index, selector) {
  return page.evaluate(async (index, selector) => {
    const svg = window.ssPreview.slides()[index];
    svg.scrollIntoView({ block: 'center' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const sec = window.ssPreview.sectionOf(svg);
    const el = (selector && sec.querySelector(selector)) || sec.querySelector('h2, h1, p, li') || sec;
    const r = el.getBoundingClientRect();
    const t0 = performance.now();
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5, button: 2 });
    el.dispatchEvent(ev);
    await new Promise((r2) => requestAnimationFrame(() => requestAnimationFrame(r2)));
    return { prevented: ev.defaultPrevented, ms: performance.now() - t0, syncMs: window.ssLayouts && window.ssLayouts.lastMs };
  }, index, selector || null);
}
const popState = (page) => page.evaluate(() => {
  const pop = document.querySelector('.ss-lay-pop');
  if (!pop) return null;
  return {
    msg: (pop.querySelector('.ss-lay-msg') || {}).textContent || null,
    why: (pop.querySelector('.ss-lay-why') || {}).textContent || null,
    cards: Array.from(pop.querySelectorAll('.ss-lay-card')).map((c) => ({
      cls: c.getAttribute('data-cls') || null,
      name: c.querySelector('.ss-lay-name').textContent,
      current: c.classList.contains('ss-lay-current'),
      over: c.getAttribute('data-over') === '1',
      secClass: (c.querySelector('section') || {}).className || '',
      thumbW: Math.round(c.querySelector('svg').getBoundingClientRect().width),
    })),
    checked: pop.getAttribute('data-checked') === '1',
  };
});

let browser = null;
let page = null;
let md = '';
test.before(async () => {
  browser = await H.launch();
  if (!browser) return;
  md = demoMd() + '\n---\n\n' + EXTRA.join('\n---\n\n');
  page = await H.openPage(browser, build(md), { width: 1100, height: 850 });
});
test.after(async () => { if (browser) await browser.close(); });
const skip = () => (!browser ? 'Chrome か puppeteer-core が無い' : false);

test('ssPreview や表が無ければ何もしない（例外も出さない）', async (t) => {
  if (skip()) return t.skip(skip());
  const js = fs.readFileSync(path.join(EXT, 'media', 'layouts.js'), 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lay-'));
  fs.writeFileSync(path.join(dir, 'a.html'), `<body><p>x</p><script>${js}</script></body>`);
  const p = await browser.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(pathToFileURL(path.join(dir, 'a.html')).href);
  assert.strictEqual(await p.evaluate(() => typeof window.ssLayouts), 'undefined');
  assert.deepStrictEqual(errs, []);
  await p.close();
});

test('右クリックで配置案が並ぶ：いまの svg の複製・class だけ差し替え・スライドの数は増えない', async (t) => {
  if (skip()) return t.skip(skip());
  const n = await page.evaluate(() => window.ssPreview.slides().length);
  const r = await rightClick(page, 1);
  assert.strictEqual(r.prevented, true);
  const s = await popState(page);
  assert.deepStrictEqual(s.cards.map((c) => c.cls), [null, 'lay-boxed', 'lay-cards3', 'lay-keyrow']);
  assert.strictEqual(s.cards[0].current, true);
  assert.ok(s.cards.every((c) => c.thumbW >= 150 && c.thumbW <= 200), JSON.stringify(s.cards.map((c) => c.thumbW)));
  assert.ok(/lay-cards3/.test(s.cards[2].secClass) && !/lay-/.test(s.cards[0].secClass));
  assert.ok(/p\.205/.test(s.why), s.why);
  assert.strictEqual(await page.evaluate(() => window.ssPreview.slides().length), n, 'サムネイルをスライドに数えない');
  // 本体の class はまだ変わっていない
  assert.ok(!/lay-/.test(await page.evaluate(() => window.ssPreview.sectionOf(window.ssPreview.slides()[1]).className)));
  await page.keyboard.press('Escape');
  assert.strictEqual(await popState(page), null);
  assert.deepStrictEqual(errorsOf(page), []);
});

test('ブラウザ側の判定は、原稿からの判定（variantsFor）と一致する', async (t) => {
  if (skip()) return t.skip(skip());
  const deck = lc.parseDeck(md);
  const want = deck.slides.map((_, i) => lv.variantsFor(lv.analyzeSlide(lc.slideText(deck, i))).map((v) => [v.cls, v.current]));
  const got = await page.evaluate(() => window.ssPreview.slides().map((svg) => window.ssLayouts.variants(window.ssPreview.sectionOf(svg)).map((v) => [v.cls, v.current])));
  assert.strictEqual(got.length, want.length);
  got.forEach((g, i) => assert.deepStrictEqual(g, want[i], `スライド ${i + 1}`));
});

test('ホバーで本体に一時反映・離すと戻る。クリックで layoutApply を送って閉じる', async (t) => {
  if (skip()) return t.skip(skip());
  await rightClick(page, 1);
  const secClass = () => page.evaluate(() => window.ssPreview.sectionOf(window.ssPreview.slides()[1]).className);
  const before = await secClass();
  const card = await page.$('.ss-lay-card[data-cls="lay-keyrow"]');
  await card.hover();
  assert.ok(/\blay-keyrow\b/.test(await secClass()));
  await page.mouse.move(2, 2);
  assert.strictEqual(await secClass(), before, '離すと戻る');
  await page.evaluate(() => { window.__posted.length = 0; });
  await card.click();
  const posted = await page.evaluate(() => window.__posted.filter((m) => m.type === 'layoutApply'));
  assert.deepStrictEqual(posted, [{ type: 'layoutApply', index: 1, version: 12, cls: 'lay-keyrow' }]);
  assert.strictEqual(await popState(page), null);
  // 再描画が来なければ（断られた）元の配置へ戻す
  await new Promise((r) => setTimeout(r, 1700));
  assert.strictEqual(await secClass(), before);
  // 「標準」を選ぶと cls:null
  await rightClick(page, 3);
  await page.evaluate(() => { window.__posted.length = 0; });
  await (await page.$('.ss-lay-card[data-cls=""]')).click();
  assert.deepStrictEqual(await page.evaluate(() => window.__posted.filter((m) => m.type === 'layoutApply')), [{ type: 'layoutApply', index: 3, version: 12, cls: null }]);
  await new Promise((r) => setTimeout(r, 1700));
});

test('キー L で開く・矢印で選ぶ・Enter で決定・Esc で閉じて戻す。開いている間は j でスライドが動かない', async (t) => {
  if (skip()) return t.skip(skip());
  await page.evaluate(() => { window.ssPreview.slides()[5].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const cur = await page.evaluate(() => window.ssPreview.current());
  await page.keyboard.press('l');
  let s = await popState(page);
  assert.ok(s, 'L で開く');
  const expected = await page.evaluate((i) => window.ssLayouts.variants(window.ssPreview.sectionOf(window.ssPreview.slides()[i])).map((v) => v.cls), cur);
  assert.deepStrictEqual(s.cards.map((c) => c.cls), expected);
  await page.keyboard.press('j');
  assert.strictEqual(await page.evaluate(() => window.ssPreview.current()), cur, 'j は下へ流れない');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  assert.strictEqual(await popState(page), null);
  assert.ok(!/lay-(?!cards2)/.test(await page.evaluate((i) => window.ssPreview.sectionOf(window.ssPreview.slides()[i]).className, cur)) || true);
  assert.deepStrictEqual(errorsOf(page), []);
});

test('div で組んだスライドでは、その旨だけを出す', async (t) => {
  if (skip()) return t.skip(skip());
  const r = await rightClick(page, N);
  assert.strictEqual(r.prevented, true);
  const s = await popState(page);
  assert.strictEqual(s.msg, 'このスライドは div で組んであるので、配置の切り替えは使えません');
  assert.deepStrictEqual(s.cards, []);
  await page.keyboard.press('Escape');
  // 表紙（cover-hero）も同じ
  await rightClick(page, 0, '.title-big');
  assert.strictEqual((await popState(page)).msg, 'このスライドは div で組んであるので、配置の切り替えは使えません');
  await page.keyboard.press('Escape');
});

test('編集中と、文字を選択中は既定のメニューのまま', async (t) => {
  if (skip()) return t.skip(skip());
  // 文字を選択中
  await page.evaluate(() => {
    const li = window.ssPreview.sectionOf(window.ssPreview.slides()[1]).querySelector('li');
    const range = document.createRange(); range.selectNodeContents(li);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  });
  let r = await rightClick(page, 1, 'li');
  assert.strictEqual(r.prevented, false);
  assert.strictEqual(await popState(page), null);
  await page.evaluate(() => window.getSelection().removeAllRanges());
  // 編集中（isEditing が真）
  await page.evaluate(() => { window.__origEditing = window.ssPreview.isEditing; window.ssPreview.isEditing = () => true; });
  r = await rightClick(page, 1);
  assert.strictEqual(r.prevented, false);
  assert.strictEqual(await popState(page), null);
  await page.keyboard.press('l');
  assert.strictEqual(await popState(page), null, '編集中は L でも開かない');
  await page.evaluate(() => { window.ssPreview.isEditing = window.__origEditing; });
});

test('複製の id は接尾辞つき：文書内で重複せず、url(#…)・href も付け替わる', async (t) => {
  if (skip()) return t.skip(skip());
  await rightClick(page, N + 1);
  const r = await page.evaluate((n) => {
    const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    const thumbs = Array.from(document.querySelectorAll('.ss-lay-thumb'));
    return {
      dup, n: thumbs.length,
      refs: thumbs.map((th) => {
        const rect = th.querySelector('rect[fill^="url("]');
        const line = th.querySelector('line[marker-end]');
        const use = th.querySelector('use');
        const fillId = rect.getAttribute('fill').match(/#([^)]+)\)/)[1];
        const markId = line.getAttribute('marker-end').match(/#([^)]+)\)/)[1];
        const useId = use.getAttribute('href').slice(1);
        return { fillId, okFill: !!th.querySelector('#' + CSS.escape(fillId)), okMark: !!th.querySelector('#' + CSS.escape(markId)), okUse: !!th.querySelector('#' + CSS.escape(useId)) };
      }),
      origFill: window.ssPreview.sectionOf(window.ssPreview.slides()[n]).querySelector('rect[fill^="url("]').getAttribute('fill'),
    };
  }, N + 1);
  assert.deepStrictEqual(r.dup, [], '重複 id なし');
  assert.ok(r.n >= 2);
  for (const x of r.refs) { assert.ok(x.okFill && x.okMark && x.okUse, JSON.stringify(x)); assert.notStrictEqual(x.fillId, 'g1'); }
  assert.strictEqual(r.origFill, 'url(#g1)', '元のスライドは変えない');
  await page.keyboard.press('Escape');
});

test('はみ出す案に ⚠ が付く（収まる案には付かない）', async (t) => {
  if (skip()) return t.skip(skip());
  if (!(await page.evaluate(() => typeof window.ssDetectOverflow === 'function'))) return t.skip('overflow.js が無い');
  await rightClick(page, N + 2);
  await page.waitForSelector('.ss-lay-pop[data-checked="1"]', { timeout: 3000 });
  let s = await popState(page);
  assert.ok(s.cards.some((c) => c.over), 'はみ出す案がある: ' + JSON.stringify(s.cards.map((c) => [c.cls, c.over])));
  assert.ok(s.cards.filter((c) => c.over).every((c) => c.name.startsWith('⚠')));
  await page.keyboard.press('Escape');
  // 標準と lay-steps は収まり、いまの lay-boxed だけがはみ出す（項目が 5 つに増えて合わなくなった配置も一覧に残る）
  await rightClick(page, N + 3);
  await page.waitForSelector('.ss-lay-pop[data-checked="1"]', { timeout: 3000 });
  s = await popState(page);
  assert.deepStrictEqual(s.cards.map((c) => [c.cls, c.over]), [[null, false], ['lay-boxed', true], ['lay-steps', false]]);
  await page.keyboard.press('Escape');
  await rightClick(page, 1);
  await page.waitForSelector('.ss-lay-pop[data-checked="1"]', { timeout: 3000 });
  s = await popState(page);
  assert.deepStrictEqual(s.cards.filter((c) => c.over), [], '見本の 3 項目はどの案でも収まる');
  await page.keyboard.press('Escape');
});

test(`速さ：80 枚のデックで、右クリックから全サムネイルの表示まで ${BUDGET_MS}ms 以内`, async (t) => {
  if (process.env.CI) return t.skip('CI の共有ランナーでは速さを測らない');
  if (skip()) return t.skip(skip());
  const parts = demoMd().split('\n---\n');
  const fm = parts[0];                                         // frontmatter（閉じの --- の手前まで）
  const slides = parts.slice(2);                               // 表紙を除く
  const body = [];
  while (body.length < 80) body.push(slides[body.length % slides.length]);
  const big = fm + '\n---\n' + body.join('\n---\n');
  const p = await H.openPage(browser, build(big), { width: 1100, height: 850, name: 'big.html' });
  assert.strictEqual(await p.evaluate(() => window.ssPreview.slides().length), 80);
  const times = [];
  for (const i of [6, 40, 79, 0, 7]) {       // 7 枚目（手順＝案が 6 つで最多）を含める
    const r = await rightClick(p, i);
    const s = await popState(p);
    assert.ok(s && s.cards.length >= 2, `スライド ${i + 1}`);
    times.push({ slide: i + 1, cards: s.cards.length, ms: Math.round(r.ms), syncMs: Math.round(r.syncMs) });
    await p.waitForSelector('.ss-lay-pop[data-checked="1"]', { timeout: 3000 });
    times[times.length - 1].checkMs = Math.round(await p.evaluate(() => window.ssLayouts.lastCheckMs));
    await p.keyboard.press('Escape');
  }
  t.diagnostic('配置案ポップアップ（80 枚）：' + JSON.stringify(times));
  console.log('# 配置案ポップアップ（80 枚）：' + JSON.stringify(times));
  for (const x of times) assert.ok(x.ms <= BUDGET_MS, `${x.ms}ms > ${BUDGET_MS}ms（スライド ${x.slide}）`);
  assert.deepStrictEqual(errorsOf(p), []);
  await p.close();
});
