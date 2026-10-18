// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// media/home.js（Marp ホームの Webview）のサムネイルのテスト。puppeteer-core＋手元の Chrome。無ければ skip。
//   node --test tools/marp-scroll-sync/test/home.test.cjs
// lib/home-vscode.cjs の buildHtml と同じ形の HTML（home.css・window.__SS_HOME__・home.js）を、acquireVsCodeApi の
// 代わりの小さな模擬で開き、拡張の代わりに homeData / homeThumbData を送る。サムネイルの絵とデックの css は、
// preview.test.cjs と同じ見本デック（sample-lecture・sample-layouts）の描画（preview-harness の corpusFixture）。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require(path.join(__dirname, 'helpers', 'preview-harness.cjs'));

const EXT = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-home-'));
const haveChrome = !!H.findChrome();
let browser = null;
test.before(async () => { if (haveChrome) browser = await H.launch(); });
test.after(async () => {
  if (browser) await browser.close();
  fs.rmSync(OUT, { recursive: true, force: true });
});

/** home-vscode.cjs の buildHtml と同じ並び。CSP は外へ取りに行かない形（Google Fonts の @import は読み込まれずに止まる） */
function homeHtml(state) {
  const read = (p) => fs.readFileSync(path.join(EXT, 'media', p), 'utf8').replace(/<\/(script|style)/gi, '<\\/$1');
  const mock = 'window.__posted = [];'
    + 'window.acquireVsCodeApi = function () { return { postMessage: function (m) { window.__posted.push(structuredClone(m)); },'
    + ' getState: function () { return ' + JSON.stringify(state || {}) + '; }, setState: function () {} }; };';
  return '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src file: data:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; font-src data:;">'
    + '<style>' + read('home.css') + '</style></head><body><div id="home"></div>'
    + '<script>' + mock + '</script><script>window.__SS_HOME__ = {};</script><script>' + read('home.js') + '</script></body></html>';
}
const send = (page, msg) => page.evaluate((m) => { window.postMessage(m, '*'); return new Promise((r) => setTimeout(r, 30)); }, msg);
async function waitPosted(page, type, ms) {
  const t0 = Date.now();
  for (;;) {
    const got = await page.evaluate((ty) => window.__posted.filter((m) => m.type === ty), type);
    if (got.length) return got;
    if (Date.now() - t0 > (ms || 3000)) throw new Error(type + ' が送られてこない');
    await new Promise((r) => setTimeout(r, 30));
  }
}

test('サムネイル：fonts の @import（url の中に ; がある）があっても、section は svg と同じ幅・border-box・overflow:hidden', { skip: haveChrome ? false : 'Chrome が見つからない' }, async () => {
  const fx = H.corpusFixture({ per: 4 });
  const page = await H.openPage(browser, { html: homeHtml({ tab: 'top' }) }, { outDir: OUT, width: 1100, height: 900, name: 'home-' + process.pid + '.html' });
  try {
    await waitPosted(page, 'homeReady');
    await send(page, { type: 'homeData', top: fx.items, topTotal: fx.items.length, withChurn: true, recent: [], shelves: [], decks: [] });
    const req = (await waitPosted(page, 'homeThumbs')).pop();
    assert.ok(req.keys.length >= 1, '見えているカードの絵を頼む');
    const byKey = new Map(fx.items.map((it) => [it.deck + '#' + it.slide, it]));
    const items = req.keys.map((k) => byKey.get(k.deck + '#' + k.slide)).filter(Boolean).map((it) => ({ key: it.key, cssKey: it.cssKey, html: it.html }));
    assert.strictEqual(items.length, req.keys.length);
    await send(page, { type: 'homeThumbData', reqId: req.reqId, css: fx.css, items });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const g = await page.evaluate((cssMap, keyCss) => Array.from(document.querySelectorAll('.hm-shadow')).filter((h) => h.shadowRoot).map((h) => {
      const root = h.shadowRoot;
      const svg = root.querySelector('div.marpit > svg[data-marpit-svg]');
      const sec = svg && svg.querySelector('section');
      const deckCss = cssMap[keyCss[h.dataset.key]] || '';
      const cs = sec ? getComputedStyle(sec) : null;
      return { key: h.dataset.key, ov: cs && cs.overflow, bs: cs && cs.boxSizing, w: cs && cs.width,
        fit: sec && svg ? Math.round(sec.getBoundingClientRect().width - svg.getBoundingClientRect().width) : null,
        fontImport: /display=swap'\);/.test(deckCss) ? /display=swap'\);/.test(Array.from(root.querySelectorAll('style')).map((x) => x.textContent).join('')) : 'n/a' };
    }), fx.css, Object.fromEntries(fx.items.map((it) => [it.key, it.cssKey])));
    assert.strictEqual(g.length, items.length, '頼んだ分の絵が出る: ' + JSON.stringify(g.map((x) => x.key)));
    // 以前は /@import\s[^;]+;/ が wght@400;700 の ; で切れ、残った引用符が section の基本規則（1280×720・border-box・overflow:hidden）を
    // 文字列として呑み込んでいた（section が svg より広く、右側が切れる）。preview.js と同じ IMPORT_RE で直した
    assert.ok(g.every((x) => x.ov === 'hidden' && x.bs === 'border-box' && x.w === '1280px' && x.fit === 0), JSON.stringify(g.map((x) => [x.key, x.ov, x.bs, x.w, x.fit])));
    assert.ok(g.every((x) => x.fontImport === true || x.fontImport === 'n/a'), 'fonts の @import は url の中の ; で切れずに <style> へ移る: ' + JSON.stringify(g.map((x) => x.fontImport)));
    assert.ok(g.some((x) => x.fontImport === true), '見本デックの css に Google Fonts の @import がある（この確かめが空振りしていない）');
    const errors = page.__errors.filter((e) => !/Content Security Policy|Loading the stylesheet|Refused to load/.test(e));
    assert.deepStrictEqual(errors, [], 'ページ内で例外が出ていない');
  } finally { await page.close(); }
});
