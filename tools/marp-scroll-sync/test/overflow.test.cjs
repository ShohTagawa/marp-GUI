// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// media/overflow.js（window.ssDetectOverflow）のテスト。DESIGN.md 7.2。
// 実行： node --test --test-reporter=tap tools/marp-scroll-sync/test/overflow.test.cjs
// Chrome か puppeteer-core が無ければ skip。描画条件は extension.js の renderDeck と同じ（helpers/preview-harness.cjs の renderMd）。
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const H = require('./helpers/preview-harness.cjs');

const OVERFLOW_JS = fs.readFileSync(path.join(H.EXT_ROOT, 'media', 'overflow.js'), 'utf8');
const BUDGET_MS = 2; // 1 枚あたりの予算（80 枚のデックで）

const FM = [
  '---', 'marp: true', 'theme: academic', 'paginate: true', 'size: 16:9',
  "header: '<div class=\"hdr-left\">はみ出し検知</div>'", "footer: ''", '---', '',
].join('\n');
const lines = (n, s) => Array.from({ length: n }, (_, i) => `- ${s || '箇条書きの行'} ${i + 1}`).join('\n');
const rows = (n) => ['| 項目 | 値 | 備考 |', '|---|---|---|'].concat(Array.from({ length: n }, (_, i) => `| 行 ${i + 1} | ${i * 3} | 備考の文 |`)).join('\n');

// 1 枚ずつ名前で引けるようにする（並び＝ SLIDES の順）
const SLIDES = [
  ['fit', '## 収まる\n\n' + lines(3)],
  ['long', '## はみ出す\n\n' + lines(16)],
  ['tkFit', '## takeaway と収まる本文\n\n' + lines(3) + '\n\n<div class="takeaway">要点の帯</div>'],
  ['tkHit', '## takeaway に被る\n\n' + lines(11) + '\n\n<div class="takeaway">要点の帯</div>'],
  ['vcFit', '<!-- _class: vcenter -->\n\n## 縦中央で収まる\n\n<div class="body">\n\n' + lines(3) + '\n\n</div>\n\n<div class="takeaway">要点</div>'],
  ['vsFit', '<!-- _class: vspread -->\n\n## 均等配置で収まる\n\n<div class="body">\n\n' + lines(4) + '\n\n</div>'],
  ['vcOver', '<!-- _class: vcenter -->\n\n## 縦中央であふれる\n\n<div class="body">\n\n' + lines(18) + '\n\n</div>\n\n<div class="takeaway">要点</div>'],
  ['splitFit', '<!-- _class: split -->\n\n## 左右で収まる\n\n<div class="split-body">\n<div class="left">\n\n' + lines(3, '左') + '\n\n</div>\n<div class="right">\n\n' + lines(3, '右') + '\n\n</div>\n</div>'],
  ['splitRight', '<!-- _class: split -->\n\n## 右だけあふれる\n\n<div class="split-body">\n<div class="left">\n\n' + lines(2, '左') + '\n\n</div>\n<div class="right">\n\n' + lines(18, '右') + '\n\n</div>\n</div>'],
  ['tableFit', '## 表が収まる\n\n' + rows(4)],
  ['tableOver', '## 表があふれる\n\n' + rows(16)],
  ['img', '## 画像\n\n<img id="slowimg" src="https://overflow-test.invalid/slow.png" style="display:block;width:200px">'],
  ['bg', '## 背景画像つき\n\n![bg right:30%](https://overflow-test.invalid/bg.png)\n\n' + lines(3)],
  ['bgOver', '## 背景画像つきであふれる\n\n![bg right:30%](https://overflow-test.invalid/bg.png)\n\n' + lines(16)],
  ['sibling', '## 隣のブロックへ食い込む\n\n<div style="height:120px">\n\n' + lines(6) + '\n\n</div>\n\n<div style="background:#eee;padding:10px">次のブロック</div>'],
  ['absOnly', '## 絶対配置は数えない\n\n- 本文\n\n<div style="position:absolute;left:40px;top:650px;width:300px;height:200px;background:#c00">飾り</div>'],
  // 流し込みの takeaway（summary 型など）：高さの決まった入れ物から本文があふれると、帯の下へ潜る
  ['flowTkHit', '## 流し込みの takeaway に潜る\n\n<div style="height:380px">\n\n' + lines(12) + '\n\n</div>\n\n<div class="takeaway" style="position:static">要点の帯</div>'],
  ['flowTkFit', '## 流し込みの takeaway と収まる\n\n<div style="height:380px">\n\n' + lines(4) + '\n\n</div>\n\n<div class="takeaway" style="position:static">要点の帯</div>'],
  ['clip', '## 切り取る入れ物は箱で測る\n\n<div style="height:200px;overflow:hidden">\n\n' + lines(20) + '\n\n</div>'],
];
const INDEX = Object.fromEntries(SLIDES.map(([k], i) => [k, i]));
const DECK_MD = FM + SLIDES.map(([, md]) => md).join('\n\n---\n\n') + '\n';

// 1x1 の PNG（遅れて返す画像の中身）
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function pageHtml(r, width) {
  return '<!doctype html><html><head><meta charset="utf-8"><style>' + r.css + '</style>'
    + '<style>body{margin:0}svg[data-marpit-svg]{display:block;width:' + width + 'px;margin:0 0 12px}</style></head><body>'
    + '<div id="deck">' + r.html + '</div><script>' + OVERFLOW_JS + '</script></body></html>';
}

let browser = null;
let tmp = null;
let held = []; // 止めてある画像のリクエスト
test.before(async () => {
  browser = await H.launch();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-overflow-'));
});
test.after(async () => {
  if (browser) await browser.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/** ページを開く。overflow-test.invalid への画像は止めておき、release() で返す */
async function open(md, width, name) {
  const r = H.renderMd(md);
  const file = path.join(tmp, name || 'p.html');
  fs.writeFileSync(file, pageHtml(r, width || 1280));
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  held = [];
  page.on('request', (req) => {
    if (/overflow-test\.invalid\/slow\.png/.test(req.url())) { held.push(req); return; }
    if (/overflow-test\.invalid/.test(req.url())) { req.respond({ status: 200, contentType: 'image/png', body: PNG_1PX }); return; }
    if (/^https?:/.test(req.url())) { req.abort(); return; } // Web フォントなど外へは出ない
    req.continue();
  });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  return page;
}
const detectAll = (page) => page.evaluate(() => [...document.querySelectorAll('svg[data-marpit-svg]')]
  .map((svg) => window.ssDetectOverflow(svg.querySelector('section'))));

test('収まる／はみ出す／takeaway／vcenter・vspread／split／表／隣のブロック／絶対配置／切り取る入れ物', async (t) => {
  if (!browser) return t.skip('Chrome か puppeteer-core がありません');
  const page = await open(DECK_MD, 1280, 'kinds.html');
  try {
    const r = await detectAll(page);
    const of = (k) => r[INDEX[k]];
    const msg = (k) => k + ' ' + JSON.stringify(of(k));
    for (const k of ['fit', 'tkFit', 'vcFit', 'vsFit', 'splitFit', 'tableFit', 'bg', 'absOnly', 'clip', 'flowTkFit']) {
      assert.equal(of(k).overflow, false, msg(k));
      assert.equal(of(k).unknown, false, msg(k));
      assert.ok(of(k).bottomPx <= 0, msg(k));
    }
    for (const k of ['long', 'tkHit', 'vcOver', 'splitRight', 'tableOver', 'bgOver', 'sibling']) assert.equal(of(k).overflow, true, msg(k));
    // 下へはみ出た量は 1280×720 の座標で。16 行は 1 行 40px 前後なので、床を 100px 以上超える
    assert.ok(of('long').bottomPx > 100, msg('long'));
    assert.ok(of('splitRight').bottomPx > 100, msg('splitRight'));
    assert.ok(of('tableOver').bottomPx > 0, msg('tableOver'));
    // takeaway：被れば hitsTakeaway、床は帯の上端
    assert.equal(of('tkHit').hitsTakeaway, true, msg('tkHit'));
    assert.ok(of('tkHit').bottomPx > 0, msg('tkHit'));
    assert.equal(of('tkFit').hitsTakeaway, false, msg('tkFit'));
    // 流し込みの takeaway：下端には届かないが、帯に潜った本文は hitsTakeaway（箱の編集で大きくした QR が注意書きを帯の下へ押し込む、の再発防止）
    assert.equal(of('flowTkHit').hitsTakeaway, true, msg('flowTkHit'));
    assert.equal(of('flowTkHit').overflow, true, msg('flowTkHit'));
    assert.equal(of('flowTkFit').hitsTakeaway, false, msg('flowTkFit'));
    assert.equal(of('long').hitsTakeaway, false, msg('long'));
    // vcenter であふれると takeaway にも被る
    assert.equal(of('vcOver').hitsTakeaway, true, msg('vcOver'));
    // 高さの決まった入れ物からあふれて次のブロックに潜る：下端には届かないが、隣との重なりで分かる
    assert.equal(of('sibling').hitsSibling, true, msg('sibling'));
    assert.ok(of('sibling').bottomPx <= 0, msg('sibling'));
    for (const k of ['fit', 'long', 'tkHit', 'splitFit', 'tableFit']) assert.equal(of(k).hitsSibling, false, msg(k));
    // ヘッダー帯：縦中央であふれた本文は上にも出る。ほかは食い込まない
    assert.equal(of('vcOver').hitsHeader, true, msg('vcOver'));
    for (const k of Object.keys(INDEX)) if (k !== 'vcOver') assert.equal(of(k).hitsHeader, false, msg(k));
  } finally { await page.close(); }
});

test('画像：読み込み前は pending（高さ 0 で測っている）。読み込み後に測り直すと、大きな画像ははみ出しになる', async (t) => {
  if (!browser) return t.skip('Chrome か puppeteer-core がありません');
  const page = await open(DECK_MD, 1280, 'img.html');
  try {
    const at = INDEX.img;
    const one = () => page.evaluate((i) => window.ssDetectOverflow(document.querySelectorAll('svg[data-marpit-svg]')[i].querySelector('section')), at);
    const before = await one();
    assert.equal(before.pending, true, JSON.stringify(before));
    assert.equal(before.overflow, false, JSON.stringify(before));
    assert.ok(held.length >= 1, '画像のリクエストを止められていません');
    // 1x1 の画像を返す。幅 200px 指定なので高さも 200px → 収まる
    for (const req of held) await req.respond({ status: 200, contentType: 'image/png', body: PNG_1PX });
    await page.waitForFunction(() => document.getElementById('slowimg').complete && document.getElementById('slowimg').naturalWidth > 0);
    const loaded = await one();
    assert.equal(loaded.pending, false, JSON.stringify(loaded));
    assert.equal(loaded.overflow, false, JSON.stringify(loaded));
    // 同じ画像を縦長にすると、はみ出す（置換要素の箱で測っている）
    await page.evaluate(() => { const i = document.getElementById('slowimg'); i.style.height = '700px'; i.style.minHeight = '700px'; i.style.maxHeight = 'none'; i.style.flexShrink = '0'; });
    const tall = await one();
    assert.equal(tall.overflow, true, JSON.stringify(tall));
    assert.ok(tall.bottomPx > 50, JSON.stringify(tall));
    // ほかのスライドは pending にならない
    const fit = await page.evaluate((i) => window.ssDetectOverflow(document.querySelectorAll('svg[data-marpit-svg]')[i].querySelector('section')), INDEX.fit);
    assert.equal(fit.pending, false);
  } finally { await page.close(); }
});

test('背景画像つき：svg の中に section が複数あっても、どれを渡しても本文の section で測る', async (t) => {
  if (!browser) return t.skip('Chrome か puppeteer-core がありません');
  const page = await open(DECK_MD, 1280, 'bg.html');
  try {
    const r = await page.evaluate((iFit, iOver) => {
      const svgs = document.querySelectorAll('svg[data-marpit-svg]');
      const per = (i) => [...svgs[i].querySelectorAll('section')].map((s) => ({ role: s.getAttribute('data-marpit-advanced-background'), out: window.ssDetectOverflow(s) }));
      return { fit: per(iFit), over: per(iOver) };
    }, INDEX.bg, INDEX.bgOver);
    assert.ok(r.fit.length >= 2, '背景つきなのに section が 1 枚だけ: ' + JSON.stringify(r.fit.map((x) => x.role)));
    assert.ok(r.fit.some((x) => x.role === 'background') && r.fit.some((x) => x.role === 'content'));
    for (const x of r.fit) { assert.equal(x.out.overflow, false, JSON.stringify(x)); assert.equal(x.out.unknown, false); }
    for (const x of r.over) assert.equal(x.out.overflow, true, JSON.stringify(x));
    const px = r.over.map((x) => x.out.bottomPx);
    assert.ok(px.every((v) => v === px[0]), 'section ごとに値が違う: ' + px.join(','));
  } finally { await page.close(); }
});

test('縮小・拡大表示（700px / 1400px）でも、値は 1280×720 の座標で同じ', async (t) => {
  if (!browser) return t.skip('Chrome か puppeteer-core がありません');
  const base = await open(DECK_MD, 1280, 'w1280.html');
  const ref = await detectAll(base);
  await base.close();
  for (const w of [700, 1400]) {
    const page = await open(DECK_MD, w, 'w' + w + '.html');
    try {
      const r = await detectAll(page);
      assert.equal(r.length, ref.length);
      r.forEach((o, i) => {
        if (i === INDEX.img) return; // 画像は止めてあるので pending。値は比べない
        const k = SLIDES[i][0];
        assert.equal(o.overflow, ref[i].overflow, `${w}px ${k} ${JSON.stringify(o)} / ${JSON.stringify(ref[i])}`);
        assert.equal(o.hitsTakeaway, ref[i].hitsTakeaway, `${w}px ${k}`);
        assert.equal(o.hitsSibling, ref[i].hitsSibling, `${w}px ${k}`);
        // 縮小で文字の箱が端数になるぶんの遊び（1280 座標で 2px）
        assert.ok(Math.abs(o.bottomPx - ref[i].bottomPx) <= 2, `${w}px ${k}: ${o.bottomPx} vs ${ref[i].bottomPx}`);
      });
    } finally { await page.close(); }
  }
});

test('配置案のサムネイル：縮小した複製・画面外でも同じ判定。display:none の中・文書の外は unknown（overflow は false）', async (t) => {
  if (!browser) return t.skip('Chrome か puppeteer-core がありません');
  const page = await open(DECK_MD, 1280, 'clone.html');
  try {
    const r = await page.evaluate((iFit, iLong, iTk) => {
      const svgs = document.querySelectorAll('svg[data-marpit-svg]');
      const marpit = svgs[0].parentElement; // div.marpit（テーマの css はこの下に効く）
      const mk = (i, css) => {
        const host = document.createElement('div');
        host.style.cssText = css;
        const wrap = document.createElement('div');
        wrap.className = marpit.className;
        wrap.appendChild(svgs[i].cloneNode(true));
        host.appendChild(wrap);
        document.body.appendChild(host);
        return host.querySelector('section');
      };
      const THUMB = 'position:absolute;left:0;top:0;width:1280px;transform:scale(.18);transform-origin:0 0;';
      const OFF = 'position:absolute;left:-6000px;top:-4000px;width:256px;';
      const NONE = 'display:none;';
      const out = {};
      for (const [k, i] of [['fit', iFit], ['long', iLong], ['tk', iTk]]) {
        out[k] = {
          ref: window.ssDetectOverflow(svgs[i].querySelector('section')),
          thumb: window.ssDetectOverflow(mk(i, THUMB)),
          off: window.ssDetectOverflow(mk(i, OFF)),
          none: window.ssDetectOverflow(mk(i, NONE)),
        };
      }
      const detached = svgs[iLong].cloneNode(true).querySelector('section');
      out.detached = window.ssDetectOverflow(detached);
      out.nul = window.ssDetectOverflow(null);
      return out;
    }, INDEX.fit, INDEX.long, INDEX.tkHit);
    for (const k of ['fit', 'long', 'tk']) {
      for (const where of ['thumb', 'off']) {
        const o = r[k][where], ref = r[k].ref;
        assert.equal(o.unknown, false, `${k}/${where} ${JSON.stringify(o)}`);
        assert.equal(o.overflow, ref.overflow, `${k}/${where} ${JSON.stringify(o)} / ${JSON.stringify(ref)}`);
        assert.equal(o.hitsTakeaway, ref.hitsTakeaway, `${k}/${where}`);
        assert.ok(Math.abs(o.bottomPx - ref.bottomPx) <= 3, `${k}/${where}: ${o.bottomPx} vs ${ref.bottomPx}`);
      }
      assert.deepEqual({ overflow: r[k].none.overflow, unknown: r[k].none.unknown }, { overflow: false, unknown: true }, `${k}/none ${JSON.stringify(r[k].none)}`);
    }
    assert.deepEqual({ overflow: r.detached.overflow, unknown: r.detached.unknown }, { overflow: false, unknown: true });
    assert.deepEqual({ overflow: r.nul.overflow, unknown: r.nul.unknown }, { overflow: false, unknown: true });
  } finally { await page.close(); }
});

test('速さ：80 枚のデックで 1 枚あたり ' + BUDGET_MS + 'ms 以内（開いた直後の 1 巡目も、2 巡目以降も）。測るだけで DOM を変えない', async (t) => {
  if (process.env.CI) return t.skip('CI の共有ランナーでは速さを測らない');
  if (!browser) return t.skip('Chrome か puppeteer-core がありません');
  // 型の違う 8 枚（takeaway・split・表・長い箇条書き…）× 10 ＝ 80 枚
  const kinds = ['fit', 'long', 'tkHit', 'vcFit', 'splitRight', 'tableOver', 'sibling', 'bgOver'].map((k) => SLIDES[INDEX[k]][1]);
  const md = FM + Array.from({ length: 80 }, (_, i) => kinds[i % kinds.length]).join('\n\n---\n\n') + '\n';
  const page = await open(md, 900, 'perf.html');
  try {
    const r = await page.evaluate(() => {
      const secs = [...document.querySelectorAll('svg[data-marpit-svg]')].map((s) => s.querySelector('section'));
      const before = document.getElementById('deck').innerHTML;
      const run = () => { const t0 = performance.now(); let n = 0; for (const s of secs) if (window.ssDetectOverflow(s).overflow) n++; return { ms: performance.now() - t0, n }; };
      const first = run();
      const later = [run(), run(), run(), run(), run()].map((x) => x.ms).sort((a, b) => a - b);
      // 1 枚ずつの最大（1 枚だけ極端に遅い型が無いか）
      let worst = 0;
      for (const s of secs) { const t0 = performance.now(); window.ssDetectOverflow(s); worst = Math.max(worst, performance.now() - t0); }
      return { count: secs.length, flagged: first.n, first: first.ms, median: later[2], worst, same: before === document.getElementById('deck').innerHTML };
    });
    t.diagnostic(`80 枚：1 巡目 ${r.first.toFixed(1)}ms（1 枚 ${(r.first / r.count).toFixed(3)}ms）／2 巡目以降の中央値 ${r.median.toFixed(1)}ms（1 枚 ${(r.median / r.count).toFixed(3)}ms）／1 枚の最大 ${r.worst.toFixed(2)}ms`);
    assert.equal(r.count, 80);
    assert.equal(r.flagged, 60, 'はみ出す型 6 種 × 10 枚'); // fit・vcFit 以外
    assert.ok(r.first / r.count <= BUDGET_MS, `1 巡目が遅い: 1 枚 ${(r.first / r.count).toFixed(3)}ms`);
    assert.ok(r.median / r.count <= BUDGET_MS, `2 巡目以降が遅い: 1 枚 ${(r.median / r.count).toFixed(3)}ms`);
    assert.equal(r.same, true, '検知が DOM を書き換えています');
  } finally { await page.close(); }
});

test('整った見本デック（sample-layouts）を誤ってはみ出しと言わない', async (t) => {
  if (!browser) return t.skip('Chrome か puppeteer-core がありません');
  const name = 'sample-layouts';
  const dir = path.join(H.REPO_ROOT, 'slides', name);
  const mdPath = path.join(dir, name + '.md');
  if (!fs.existsSync(mdPath)) return t.skip('見本デックがありません');
  const r0 = H.renderMd(fs.readFileSync(mdPath, 'utf8'));
  // 素材はデックのフォルダから読む（原本は変えない）
  const html = pageHtml(r0, 1000).replace('<head>', '<head><base href="' + pathToFileURL(dir).href + '/">');
  const file = path.join(tmp, 'layouts.html');
  fs.writeFileSync(file, html);
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((res) => { i.onload = i.onerror = res; })))));
    const r = await detectAll(page);
    const bad = r.map((o, i) => ({ i: i + 1, ...o })).filter((o) => o.overflow || o.unknown);
    t.diagnostic(`${r.length} 枚中 はみ出し判定 ${bad.length} 枚`);
    // デックは著者が直し続けるので 1 枚までは許す（検知の誤りなら何枚も出る）
    assert.ok(bad.length <= 1, '誤検知の疑い: ' + JSON.stringify(bad));
  } finally { await page.close(); }
});
