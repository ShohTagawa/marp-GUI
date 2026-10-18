// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// プレビュー（media/preview.js）のテスト用ハーネス。
//   - 見本デック（sample-lecture）の先頭 N 枚＋テスト用の追加スライドを marp-core で描画し、
//     extension.js の buildHtml が後段の配線で出す形と同じ HTML を作る。
//   - acquireVsCodeApi はモック（postMessage を window.__posted に記録）。2回呼ばれたら例外にして、1回だけの約束も確かめる。
//   - Chrome は tools/lib/marp-env.mjs と同じ順で探す（CHROME_PATH → OS 別の既知パス）。無ければ null を返し、テスト側が skip する。
// slides/ の原本は読むだけ。書き出す HTML は呼び出し側が渡す outDir（scratchpad か os.tmpdir()）に置く。
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const EXT_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(EXT_ROOT, '..', '..');
const DECK = path.join(REPO_ROOT, 'slides', 'sample-lecture', 'sample-lecture.md');

// 見本デックの先頭10枚には無い要素（インライン SVG の文字・span.hl・空の箇条書き・ゆるいリスト）を足すスライド。
// 直接編集のテストで使う。行は FIXTURE_MARK で探す。
const FIXTURE = [
  '<!-- _class: summary -->',
  '',
  '<div class="page-title">テスト用の追加</div>',
  '',
  '- 前半は普通で **ここは太字** そして後半も普通',
  '- 強調は <span class="hl">赤い文字</span> のあとに続く',
  '- jk を打つ行',
  '-',
  '- A &amp; B の行',
  '',
  '<div class="fig-area"><svg viewBox="0 0 400 120" width="400" height="120" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="180" height="60" fill="#C8611C"/><text x="100" y="48" text-anchor="middle" font-size="22" fill="#ffffff">箱の中の文字</text><text x="210" y="48" font-size="20" fill="#333333">右の<tspan fill="#C8611C">ラベル</tspan></text></svg></div>',
  '',
  '<div class="takeaway">追加スライドの要点</div>',
  '',
].join('\n');

function themeFiles() {
  const dir = path.join(REPO_ROOT, 'theme');
  const names = fs.readdirSync(dir).filter(n => n.endsWith('.css'));
  names.sort((a, b) => (a === 'academic.css' ? -1 : b === 'academic.css' ? 1 : a.localeCompare(b)));
  return names.map(n => path.join(dir, n));
}

/** 見本デックの frontmatter＋先頭 count 枚＋追加スライドの md を返す（原本は変えない） */
function deckSource(count) {
  const { splitDeck } = require(path.join(EXT_ROOT, 'lib', 'slide-split.cjs'));
  const text = fs.readFileSync(DECK, 'utf8');
  const d = splitDeck(text);
  const n = Math.min(count || 10, d.slides.length);
  const head = d.lines.slice(0, d.slides[n - 1].endLine).join('\n').replace(/\s+$/, '');
  return head + '\n\n---\n\n' + FIXTURE;
}

/** extension.js の renderDeck と同じ条件で描画する。位置情報は source-map の attachLineInfo、無ければ自前で足す */
function renderMd(md) {
  const { Marp } = require(path.join(EXT_ROOT, 'node_modules', '@marp-team', 'marp-core'));
  const marp = new Marp({ html: true });
  let attached = false;
  try {
    const sm = require(path.join(EXT_ROOT, 'lib', 'source-map.cjs'));
    if (typeof sm.attachLineInfo === 'function') { sm.attachLineInfo(marp); attached = true; }
  } catch (_) { /* まだ無い・壊れている → 下の自前版 */ }
  if (!attached) {
    marp.markdown.core.ruler.push('ss_line_numbers', (state) => {
      for (const t of state.tokens) {
        if (t.map && t.nesting === 1) { t.attrSet('data-line', String(t.map[0])); t.attrSet('data-line-end', String(t.map[1])); }
      }
    });
  }
  for (const abs of themeFiles()) { try { marp.themeSet.add(fs.readFileSync(abs, 'utf8')); } catch (_) { /* 任意 */ } }
  const { html, css } = marp.render(md);
  return { html, css, attached };
}

/** 相対パスの素材を file:// の絶対 URL にする（extension.js の rewriteAssets の代わり） */
function rewriteAssets(html, docDir) {
  return html.replace(/(\bsrc\s*=\s*|\bposter\s*=\s*)(["'])([^"']+)\2/g, (full, attr, q, val) => {
    if (/^(https?:|data:|#|\/\/)/.test(val) || /^[a-zA-Z]+:/.test(val)) return full;
    return `${attr}${q}${pathToFileURL(path.resolve(docDir, val)).href}${q}`;
  });
}


// ---------- 検索ギャラリー（DESIGN.md 7.3 / 7.4）の材料 ----------
// テーマの違う見本デック 2 本。配色も違う（sample-lecture＝academic＋橙 #C8611C、sample-layouts＝tsutawaru-academic の既定のガーネット #A6192E）ので、
// Shadow DOM の中でデックごとの css が効いているかを色で確かめられる。
const DECK_TSUTAWARU = path.join(REPO_ROOT, 'slides', 'sample-layouts', 'sample-layouts.md');

/**
 * corpusResults メッセージの材料を作る。拡張（7.4）と同じく、デックごとに marp-core で 1 回描いてスライド単位の svg に切る。
 *   opts.decks … 原稿の絶対パスの配列（既定：ALC と tsutawaru）
 *   opts.per   … 1 デックから先頭何枚を使うか（既定 4）
 * 戻り値 { items, css }。items は 7.4 の形。sameTheme は 1 本目のデックを「貼り付け先と同じテーマ」とみなす。
 */
function corpusFixture(opts) {
  opts = opts || {};
  const decks = opts.decks || [DECK, DECK_TSUTAWARU];
  const per = opts.per || 4;
  const items = [], css = {};
  decks.forEach((abs, di) => {
    const md = fs.readFileSync(abs, 'utf8');
    const r = renderMd(md);
    const body = rewriteAssets(r.html, path.dirname(abs));
    // 入れ子の svg（図）で切らないよう、スライド枠（data-marpit-svg）の開始タグだけで分ける
    const parts = body.split(/(?=<svg[^>]*\bdata-marpit-svg)/).slice(1);
    if (parts.length) parts[parts.length - 1] = parts[parts.length - 1].replace(/<\/div>\s*$/, '');
    const deck = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
    const deckName = path.basename(abs, '.md');
    const theme = (/^theme:\s*(\S+)/m.exec(md) || [])[1] || 'default';
    const cssKey = 'css-' + di + '-' + deckName;
    css[cssKey] = r.css;
    const dm = /^(\d{4})(\d{2})(\d{2})_/.exec(deckName);
    parts.slice(0, per).forEach((html, i) => {
      const tm = /class="page-title"[^>]*>([^<]+)</.exec(html) || /<h1[^>]*>([^<]+)</.exec(html) || /class="title-big"[^>]*>([^<]+)</.exec(html);
      items.push({
        key: deck + '#' + (i + 1), deck, deckName, slide: i + 1, title: tm ? tm[1].trim() : '(無題)',
        pattern: (/<section[^>]*\bclass="([^"]*)"/.exec(html) || [])[1] || '', theme, date: dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : null,
        marked: di === 0 && i === 1, touched: di === 0 ? 5 - i : 0, tune: 0, dupCount: (di === 1 && i === 0) ? 3 : 1,
        snippet: '', sameTheme: di === 0, cssKey, html,
      });
    });
  });
  return { items, css };
}

const MOCK = `
  window.__posted = [];
  window.__acquired = 0;
  window.acquireVsCodeApi = function () {
    if (++window.__acquired > 1) throw new Error('acquireVsCodeApi は1回しか呼べない');
    // structuredClone：DOM 参照など複製できない物を送ろうとしたら、本物の postMessage と同じくここで落ちる
    return { postMessage: function (m) { window.__posted.push(structuredClone(m)); }, getState: function () {}, setState: function () {} };
  };`;

/**
 * プレビューの HTML を作る。
 *   opts.count … 実デックの先頭から何枚使うか（既定 10。追加スライドがその後ろに1枚付く）
 *   opts.init  … window.__SS_INIT__ の上書き
 *   opts.md    … 実デックの代わりに描画する md（反例のテスト用。frontmatter から全部を渡す）
 * 戻り値 { html, md, lines, slideCount, fixtureIndex, attached }
 */
function buildPreviewHtml(opts) {
  opts = opts || {};
  const md = typeof opts.md === 'string' ? opts.md : deckSource(opts.count || 10);
  const r = renderMd(md);
  const slideCount = (r.html.match(/<svg[^>]*data-marpit-svg/g) || []).length;
  const init = Object.assign({ index: 0, version: 12, marks: new Array(slideCount).fill(false) }, opts.init || {});
  const read = (p) => fs.readFileSync(path.join(EXT_ROOT, 'media', p), 'utf8');
  // </script> が紛れていると HTML が壊れる。配線側でも同じ注意が要るので、ここで確かめておく
  for (const f of ['textnodes.js', 'preview.js']) if (/<\/script/i.test(read(f))) throw new Error(f + ' に </script が含まれている');
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src file: https: data:; media-src file: https: data: blob:; style-src https: 'unsafe-inline'; script-src 'unsafe-inline'; font-src file: https: data:;">
<style>${read('preview.css')}</style><style id="deck-css">${r.css}</style>
</head>
<body><div id="wrap">${rewriteAssets(r.html, path.dirname(DECK))}</div>
<script>${MOCK}</script>
<script>window.__SS_INIT__ = ${JSON.stringify(init)};</script>
<script>${read('textnodes.js')}</script><script>${read('preview.js')}</script>
</body></html>`;
  return { html, md, lines: md.split('\n'), slideCount, fixtureIndex: slideCount - 1, attached: r.attached, deckDir: path.dirname(DECK) };
}

/** render メッセージ用に、md を描画し直した { html, css } を返す */
function renderForMessage(md) {
  const r = renderMd(md);
  return { html: rewriteAssets(r.html, path.dirname(DECK)), css: r.css };
}

/** Chrome / Edge の実行パス。tools/lib/marp-env.mjs の findChrome と同じ順。無ければ null */
function findChrome() {
  const env = process.env.CHROME_PATH;
  if (env) return fs.existsSync(env) ? env : null;
  const cands = [];
  if (process.platform === 'darwin') {
    cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
  } else if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || '';
    cands.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  } else {
    for (const d of (process.env.PATH || '').split(path.delimiter)) {
      for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) cands.push(path.join(d, n));
    }
  }
  return cands.find(p => p && fs.existsSync(p)) || null;
}

function loadPuppeteer() {
  try { return require(require.resolve('puppeteer-core', { paths: [REPO_ROOT] })); } catch (_) { return null; }
}

/** Chrome を起こす。Chrome か puppeteer-core が無ければ null（テストは skip） */
async function launch() {
  const puppeteer = loadPuppeteer();
  const chrome = findChrome();
  if (!puppeteer || !chrome) return null;
  return puppeteer.launch({ executablePath: chrome, headless: true,
    args: ['--allow-file-access-from-files', '--font-render-hinting=none', '--no-first-run'] });
}

/** HTML を outDir に書き、その幅で開いたページを返す */
async function openPage(browser, built, opts) {
  opts = opts || {};
  const outDir = opts.outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'ss-preview-'));
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, opts.name || 'preview.html');
  fs.writeFileSync(file, built.html);
  const page = await browser.newPage();
  await page.setViewport({ width: opts.width || 1000, height: opts.height || 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  page.__errors = errors;
  return page;
}

module.exports = { corpusFixture, DECK_TSUTAWARU, buildPreviewHtml, renderForMessage, renderMd, deckSource, findChrome, launch, openPage, DECK, FIXTURE, EXT_ROOT, REPO_ROOT };
