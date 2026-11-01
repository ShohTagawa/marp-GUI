// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// Latency benchmark: time from a gesture to the repainted preview.
//
//   npm run bench                         # all gestures, N=20 after 2 warm-ups, two decks
//   npm run bench -- --n 10 --warmup 1    # fewer samples
//   npm run bench -- --deck sample-hydrogen
//   npm run bench -- --json               # print the JSON result instead of the Markdown table
//   npm run bench -- --check              # exit 1 if any measured maximum exceeds 400 ms
//
// It drives the same harness as test/e2e.test.cjs: the real extension.js runs on the VS Code stub
// (test/helpers/vscode-stub.cjs) and the real Webview HTML runs in a local headless Chrome
// (puppeteer-core). It is NOT a real VS Code Webview. Nothing in slides/ is written: the decks are
// copied to a temporary repository under the OS temp folder, which is removed afterwards.
//
// Gestures (each sample is undone before the next one):
//   edit       double-click a bullet, type one character, press Enter      t0 = Enter keydown,  t1 = frame after the re-rendered slide
//   layouts    right-click a slide (layout variants)                          t0 = contextmenu,    t1 = frame in which every thumbnail is drawn
//   layoutApply  choose another layout in that popup (one _class word)      t0 = click,          t1 = frame after the re-rendered slide
//   insert     click the + between two slides (insert popup)                 t0 = click,          t1 = frame in which the first cards (up to 6) have thumbnails
//   duplicate  slide button "duplicate" (slide count changes: full render)   t0 = click,          t1 = frame after the render
//   moveDown   slide button "move down" (same count: patch of two slides)    t0 = click,          t1 = frame after the patch
//   boxDrag    Alt+click an inline SVG figure, drag it 40 px, release        t0 = pointerup,      t1 = frame after the re-rendered slide
//   type       one character typed into the source (editor side)             t0 = document change, t1 = frame after the re-render (includes the 150 ms debounce)
// Times t0/t1 are taken inside the page (performance.now) except for "type", which compares Date.now()
// in Node with Date.now() in the page (same machine clock).
// Results: a Markdown table on stdout and bench/out/latency-<timestamp>.json (git-ignored).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('../test/helpers/e2e-harness.cjs');

const BUDGET_MS = 400;   // DESIGN.md 8.0
const QUIET_MS = 400;    // settle: no messages for this long before the next sample

// ---------- arguments ----------
function parseArgs(argv) {
  const o = { n: 20, warmup: 2, decks: null, json: false, check: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v == null) throw new Error(a + ' needs a value'); return v; };
    if (a === '--n') o.n = Math.max(1, parseInt(val(), 10));
    else if (a === '--warmup') o.warmup = Math.max(0, parseInt(val(), 10));
    else if (a === '--deck') o.decks = val().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--json') o.json = true;
    else if (a === '--check') o.check = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return o;
}

// ---------- statistics ----------
function stats(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const q = (p) => s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null;
  return {
    n: s.length,
    median: s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null,
    p90: q(0.9), max: s.length ? s[s.length - 1] : null, min: s.length ? s[0] : null,
    over: s.filter(x => x > BUDGET_MS).length,
  };
}
const r1 = (x) => x == null ? null : Math.round(x * 10) / 10;

// ---------- the scratch repository ----------
const SAMPLE_DECKS = ['sample-hydrogen', 'sample-layouts', 'sample-parts', 'sample-lecture'];
const BIG = 'bench-hydrogen-x7';   // sample-hydrogen repeated 7 times (84 slides)

function makeBenchRepo(root) {
  const repo = H.makeRepo(root, SAMPLE_DECKS);
  // shelf (named slides shown first in the insert popup)
  const shelf = path.join(H.REPO_ROOT, 'slides', '_library', 'shelf.json');
  if (fs.existsSync(shelf)) {
    fs.mkdirSync(path.join(root, 'slides', '_library'), { recursive: true });
    fs.copyFileSync(shelf, path.join(root, 'slides', '_library', 'shelf.json'));
  }
  // large deck: the front matter once, the body seven times, without library marks (ids must be unique)
  const src = fs.readFileSync(repo.md['sample-hydrogen'], 'utf8');
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(src);
  const front = m[0], body = src.slice(front.length).replace(/^_lib:.*\r?\n/gm, '').replace(/\s+$/, '');
  const dir = path.join(root, 'slides', BIG);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, BIG + '.md'), front + Array(7).fill(body).join('\n\n---\n\n') + '\n');
  repo.md[BIG] = path.join(dir, BIG + '.md');
  return repo;
}

// ---------- in-page probe ----------
// Records, for every render/patch the Webview applies, the time of the next animation frame
// (the first frame that can show the result).
async function installProbe(page) {
  await page.evaluate(() => {
    if (window.__bench) return;
    const B = window.__bench = { renders: [], enterAt: null };
    window.ssPreview.onRender((info) => {
      const kind = info && info.kind;
      requestAnimationFrame(() => B.renders.push({ kind, painted: performance.now(), wall: Date.now() }));
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.altKey && !e.shiftKey) B.enterAt = performance.now(); }, true);
  });
}
const rendersAfter = (page, t0) => page.evaluate((t0) => window.__bench.renders.filter(r => r.painted >= t0), t0);
async function waitRenderAfter(S, t0, label, field) {
  const r = await S.waitFor(async () => { const a = await rendersAfter(S.page, t0); return a.length ? a[0] : null; }, label, 8000);
  return r[field || 'painted'] - t0;
}

// ---------- targets ----------
/** Points of plain bullets (li text of at least 6 characters, not inside header/footer) on every slide */
function bulletTargets(page) {
  return page.evaluate(() => {
    const out = [];
    window.ssPreview.slides().forEach((svg, i) => {
      const sec = window.ssPreview.sectionOf(svg);
      if (!sec) return;
      const li = Array.from(sec.querySelectorAll('li')).find(l => !l.querySelector('ul,ol,svg,img') && l.textContent.trim().length >= 6);
      if (li) out.push(i);
    });
    return out;
  });
}
/** Scroll slide i into view and return the centre of its first suitable bullet's first text run */
function bulletPoint(page, i) {
  return page.evaluate((i) => {
    const svg = window.ssPreview.slides()[i];
    const sec = window.ssPreview.sectionOf(svg);
    const li = Array.from(sec.querySelectorAll('li')).find(l => !l.querySelector('ul,ol,svg,img') && l.textContent.trim().length >= 6);
    li.scrollIntoView({ block: 'center', behavior: 'instant' });
    const w = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    let n = w.nextNode(); while (n && n.nodeValue.trim().length < 3) n = w.nextNode();
    const rg = document.createRange(); rg.setStart(n, 0); rg.setEnd(n, Math.min(n.nodeValue.length, 3));
    const b = rg.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, i);
}
const restFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// ---------- gestures ----------
async function gestureEdit(S, ctx) {
  const i = ctx.bullets[ctx.k++ % ctx.bullets.length];
  const before = S.doc.getText();
  const pt = await bulletPoint(S.page, i);
  await restFrames(S.page);
  await S.page.mouse.click(pt.x, pt.y, { clickCount: 2, delay: 30 });
  await S.waitFor(() => S.page.evaluate(() => !!document.querySelector('.ss-editing')), 'edit starts', 3000);
  await S.page.keyboard.press('End');
  await S.page.keyboard.type('Q');
  await S.page.keyboard.press('Enter');
  const enterAt = await S.page.evaluate(() => window.__bench.enterAt);
  const ms = await waitRenderAfter(S, enterAt, 'edit re-render');
  await S.settle(QUIET_MS);
  const changed = S.doc.getText() !== before;
  await undoTo(S, before);
  if (!changed) throw new Error('edit: the source did not change (slide ' + (i + 1) + ')');
  return ms;
}
async function gestureLayouts(S, ctx) {
  const i = ctx.layoutSlides[ctx.k++ % ctx.layoutSlides.length];
  const ms = await S.page.evaluate(async (i) => {
    const svg = window.ssPreview.slides()[i];
    svg.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const sec = window.ssPreview.sectionOf(svg);
    const el = sec.querySelector('h2, h1, p, li') || sec;
    const rc = el.getBoundingClientRect();
    const t0 = performance.now();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rc.left + 5, clientY: rc.top + 5, button: 2 }));
    return new Promise((resolve) => {
      const tick = () => {
        const pop = document.querySelector('.ss-lay-pop');
        const cards = pop ? Array.from(pop.querySelectorAll('.ss-lay-card')) : [];
        const done = pop && (cards.length ? cards.every(c => c.querySelector('svg section')) : !!pop.querySelector('.ss-lay-msg'));
        if (done) resolve({ ms: performance.now() - t0, cards: cards.length });
        else if (performance.now() - t0 > 8000) resolve({ ms: null, cards: -1 });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, i);
  await S.page.evaluate(() => window.ssLayouts && window.ssLayouts.close());
  await restFrames(S.page);
  if (ms.ms == null) throw new Error('layouts: popup did not complete (slide ' + (i + 1) + ')');
  ctx.cards.push(ms.cards);
  return ms.ms;
}
/** Slides whose layout popup offers at least one variant other than the current one */
async function applicableSlides(S, nSlides) {
  const out = [];
  for (let i = 1; i < nSlides; i++) {
    const n = await S.page.evaluate(async (i) => {
      const svg = window.ssPreview.slides()[i];
      svg.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const sec = window.ssPreview.sectionOf(svg);
      const el = sec.querySelector('h2, h1, p, li') || sec;
      const rc = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rc.left + 5, clientY: rc.top + 5, button: 2 }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const pop = document.querySelector('.ss-lay-pop');
      const k = pop ? pop.querySelectorAll('.ss-lay-card:not(.ss-lay-current)').length : 0;
      window.ssLayouts.close();
      return k;
    }, i);
    if (n > 0) out.push(i);
  }
  return out;
}
async function gestureLayoutApply(S, ctx) {
  if (!ctx.applySlides.length) throw new Error('layoutApply: no slide offers another layout');
  const i = ctx.applySlides[ctx.k++ % ctx.applySlides.length];
  const before = S.doc.getText();
  const r = await S.page.evaluate(async (i, k) => {
    const svg = window.ssPreview.slides()[i];
    svg.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const sec = window.ssPreview.sectionOf(svg);
    const el = sec.querySelector('h2, h1, p, li') || sec;
    const rc = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rc.left + 5, clientY: rc.top + 5, button: 2 }));
    const t = performance.now();
    for (;;) {
      await new Promise((res) => requestAnimationFrame(res));
      const pop = document.querySelector('.ss-lay-pop');
      const cards = pop ? Array.from(pop.querySelectorAll('.ss-lay-card:not(.ss-lay-current)')) : [];
      if (cards.length) { const c = cards[k % cards.length]; const t0 = performance.now(); c.click(); return { t0, cls: c.getAttribute('data-cls') }; }
      if (performance.now() - t > 5000) return { err: 'no variant card' };
    }
  }, i, ctx.k);
  if (r.err) throw new Error('layoutApply: ' + r.err + ' (slide ' + (i + 1) + ')');
  const ms = await waitRenderAfter(S, r.t0, 'layoutApply re-render');
  await S.settle(QUIET_MS);
  const changed = S.doc.getText() !== before;
  await undoTo(S, before);
  if (!changed) throw new Error('layoutApply: the source did not change (slide ' + (i + 1) + ')');
  return ms;
}
async function gestureInsert(S, ctx) {
  const n = await S.page.evaluate(() => window.ssPreview.slides().length);
  const idx = (ctx.k++ * 3) % Math.max(1, n - 1);
  const r = await S.page.evaluate(async (idx) => {
    const b = document.querySelector('.ss-insert[data-index="' + idx + '"]');
    if (!b) return { err: 'no + button at ' + idx };
    b.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const t0 = performance.now();
    b.click();
    let skel = null;
    return new Promise((resolve) => {
      const tick = () => {
        const pop = document.querySelector('.ss-pop.ss-open');
        if (pop && skel == null) skel = performance.now() - t0;
        const cards = pop ? Array.from(pop.querySelectorAll('.ss-pc')) : [];
        const want = Math.min(6, cards.length);
        const filled = cards.filter(c => { const s = c.querySelector('.ss-gal-shadow'); return s && s.shadowRoot && s.shadowRoot.querySelector('section'); }).length;
        if (pop && cards.length && filled >= want) resolve({ ms: performance.now() - t0, skel, cards: cards.length });
        else if (performance.now() - t0 > 8000) resolve({ ms: null, skel, cards: cards.length, filled });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, idx);
  await S.page.evaluate(() => window.ssPreview.closePopups());
  await S.settle(QUIET_MS);
  if (r.err || r.ms == null) throw new Error('insert: ' + (r.err || 'popup did not fill ' + JSON.stringify(r)));
  ctx.skel.push(r.skel);
  return r.ms;
}
/** Slides that contain an inline SVG figure written as HTML in the source (box-editable) */
function figureSlides(page) {
  return page.evaluate(() => {
    const out = [];
    window.ssPreview.slides().forEach((svg, i) => {
      const sec = window.ssPreview.sectionOf(svg);
      if (sec && sec.querySelector('svg[data-hline]')) out.push(i);
    });
    return out;
  });
}
async function installBoxProbe(page) {
  await page.evaluate(() => {
    if (window.__benchBox) return;
    const P = window.__benchBox = { t0: 0, redraw: null };
    const post0 = window.ssPreview.post;
    window.ssPreview.post = function (m) {
      if (m && m.type === 'boxCommit') { P.t0 = performance.now(); P.redraw = null; }
      return post0.apply(this, arguments);
    };
    // boxedit.js stops pointer events in the capture phase, so pointerup cannot be observed from outside;
    // it measures pointerup -> boxCommit itself (stats.upToCommitMs), which is added here
    window.ssPreview.onRender(() => requestAnimationFrame(() => {
      if (P.redraw == null && P.t0) P.redraw = performance.now() - P.t0 + ((window.ssBoxEdit && window.ssBoxEdit.stats.upToCommitMs) || 0);
    }));
  });
}
async function gestureBoxDrag(S, ctx) {
  if (!ctx.figures.length) throw new Error('boxDrag: no inline SVG figure in this deck');
  const i = ctx.figures[ctx.k++ % ctx.figures.length];
  const before = S.doc.getText();
  await installBoxProbe(S.page);
  const b = await S.page.evaluate((i) => {
    const sec = window.ssPreview.sectionOf(window.ssPreview.slides()[i]);
    const el = sec.querySelector('svg[data-hline]');
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, i);
  await restFrames(S.page);
  await S.page.mouse.move(b.x, b.y);
  await S.page.keyboard.down('Alt');
  await S.page.mouse.down(); await S.page.mouse.up();
  await S.waitFor(() => S.page.evaluate(() => !!(window.ssBoxEdit && window.ssBoxEdit.selected())), 'box selected', 3000);
  // a click usually lands on a shape inside the figure (refused); Alt+Up selects the enclosing <svg>
  for (let up = 0; up < 4; up++) {
    const t = await S.page.evaluate(() => { const x = window.ssBoxEdit.selected(); return x && x.target ? x.target.tag : null; });
    if (t === 'svg') break;
    await S.page.keyboard.press('ArrowUp');
    await restFrames(S.page);
  }
  await S.page.keyboard.up('Alt');
  const tag = await S.page.evaluate(() => { const x = window.ssBoxEdit.selected(); return x && x.target ? x.target.tag : null; });
  if (tag !== 'svg') throw new Error('boxDrag: could not select the figure (slide ' + (i + 1) + ')');
  await S.page.evaluate(() => { window.__benchBox.t0 = 0; window.__benchBox.redraw = null; });
  await S.page.keyboard.down('Meta');   // no snapping
  await S.page.mouse.down();
  for (let s = 1; s <= 8; s++) { await S.page.mouse.move(b.x + 5 * s, b.y); await restFrames(S.page); }
  await S.page.mouse.up();
  await S.page.keyboard.up('Meta');
  await S.waitFor(() => S.page.evaluate(() => window.__benchBox.redraw != null), 'boxDrag re-render', 8000);
  const ms = await S.page.evaluate(() => window.__benchBox.redraw);
  await S.settle(QUIET_MS);
  await S.page.keyboard.press('Escape');
  const changed = S.doc.getText() !== before;
  await undoTo(S, before);
  if (!changed) throw new Error('boxDrag: the source did not change (slide ' + (i + 1) + ')');
  return ms;
}
async function selectSlide(S, i) {
  const pt = await S.page.evaluate((i) => {
    const svg = window.ssPreview.slides()[i];
    svg.scrollIntoView({ block: 'center', behavior: 'instant' });
    const b = svg.getBoundingClientRect();
    return { x: b.left + 8, y: b.top + 8 };
  }, i);
  await restFrames(S.page);
  await S.page.mouse.click(pt.x, pt.y);
  await S.waitFor(() => S.page.evaluate((i) => window.ssPreview.current() === i, i), 'slide selected', 3000);
  await S.settle(QUIET_MS);
}
function gestureSlideOp(op) {
  return async (S, ctx) => {
    const n = await S.page.evaluate(() => window.ssPreview.slides().length);
    const i = 1 + (ctx.k++ * 2) % Math.max(1, n - 2);   // never the last slide (moveDown) and not the cover
    await selectSlide(S, i);
    const before = S.doc.getText();
    const t0 = await S.page.evaluate((op) => {
      const b = document.querySelector('.ss-ops button[data-op="' + op + '"]');
      const t = performance.now();
      b.click();
      return t;
    }, op);
    const ms = await waitRenderAfter(S, t0, op + ' re-render');
    await S.settle(QUIET_MS);
    const changed = S.doc.getText() !== before;
    await undoTo(S, before);
    if (!changed) throw new Error(op + ': the source did not change (slide ' + (i + 1) + ')');
    return ms;
  };
}
async function gestureType(S, ctx) {
  const text = S.doc.getText();
  const lines = text.split('\n');
  const cands = ctx.typeLines || (ctx.typeLines = lines.map((l, j) => (/^- \S/.test(l) && l.length > 8 ? j : -1)).filter(j => j >= 0));
  const j = cands[ctx.k++ % cands.length];
  const changed = lines.slice(); changed[j] = changed[j] + 'Q';
  const perfT0 = await S.page.evaluate(() => performance.now());   // lower bound for the renders to look at
  const t0 = Date.now();
  S.typeInDoc(changed.join('\n'));
  const r = await S.waitFor(async () => { const a = await rendersAfter(S.page, perfT0); return a.length ? a[0] : null; }, 'type re-render', 8000);
  const ms = r.wall - t0;
  await S.settle(QUIET_MS);
  S.typeInDoc(text);
  await S.settle(QUIET_MS);
  return ms;
}
async function undoTo(S, text) {
  for (let i = 0; i < 3 && S.doc.getText() !== text; i++) { await S.exec('undo'); await S.settle(QUIET_MS); }
  if (S.doc.getText() !== text) throw new Error('undo did not restore the source');
}

const GESTURES = [
  ['edit', 'Direct edit (double-click, type, Enter)', gestureEdit],
  ['layouts', 'Layout thumbnails (right-click)', gestureLayouts],
  ['layoutApply', 'Layout switch (choose a thumbnail)', gestureLayoutApply],
  ['insert', 'Insert popup (+ between slides)', gestureInsert],
  ['duplicate', 'Slide operation: duplicate (full render)', gestureSlideOp('duplicate')],
  ['moveDown', 'Slide operation: move down (patch)', gestureSlideOp('moveDown')],
  ['boxDrag', 'Box drag (Alt+click, drag 40 px)', gestureBoxDrag],
  ['type', 'Typing one character in the source', gestureType],
];

// ---------- main ----------
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 30).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
  if (!H.findChrome()) { console.error('bench: Google Chrome or Microsoft Edge was not found (set CHROME_PATH).'); return 2; }
  const browser = await H.launch();
  if (!browser) { console.error('bench: puppeteer-core is not installed (run npm install).'); return 2; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-gui-bench-'));
  const repo = makeBenchRepo(path.join(root, 'repo'));
  const decks = o.decks || ['sample-hydrogen', BIG];
  const result = {
    date: new Date().toISOString(),
    machine: { os: `${os.type()} ${os.release()} (${process.platform} ${process.arch})`, cpu: (os.cpus()[0] || {}).model || '?', cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30) },
    node: process.version,
    chrome: await browser.version(),
    marpCore: require(path.join(H.EXT_ROOT, 'node_modules', '@marp-team', 'marp-core', 'package.json')).version,
    harness: 'real extension.js on the VS Code stub + real Webview HTML in headless Chrome (not a real VS Code Webview)',
    n: o.n, warmup: o.warmup, budgetMs: BUDGET_MS, conditions: [],
  };
  let exit = 0;
  try {
    for (const deck of decks) {
      if (!repo.md[deck]) throw new Error('unknown deck: ' + deck + ' (choose from ' + Object.keys(repo.md).join(', ') + ')');
      const S = await H.openSession({ browser, mdPath: repo.md[deck], width: 1100, height: 800, outDir: path.join(root, 'webview') });
      try {
        if (S.activateError) throw S.activateError;
        await installProbe(S.page);
        const nSlides = await S.page.evaluate(() => window.ssPreview.slides().length);
        const cond = { deck, slides: nSlides, sourceKB: r1(Buffer.byteLength(S.doc.getText()) / 1024), gestures: [] };
        const bullets = await bulletTargets(S.page);
        const layoutSlides = Array.from({ length: nSlides - 1 }, (_, j) => j + 1);
        const applySlides = await applicableSlides(S, Math.min(nSlides, 24));
        const figures = await figureSlides(S.page);
        for (const [key, label, fn] of GESTURES) {
          const ctx = { k: 0, bullets, layoutSlides, applySlides, figures, cards: [], skel: [] };
          const samples = [];
          let cold = null;
          for (let s = 0; s < o.warmup + o.n; s++) {
            await installProbe(S.page);
            const w0 = Date.now();
            const ms = await fn(S, ctx);
            if (process.env.BENCH_DEBUG) process.stderr.write(`    ${key}#${s}: ${r1(ms)} ms (sample took ${Date.now() - w0} ms)\n`);
            if (s === 0) cold = ms;
            if (s >= o.warmup) samples.push(ms);
          }
          const st = stats(samples);
          const g = { key, label, first: r1(cold), median: r1(st.median), p90: r1(st.p90), max: r1(st.max), min: r1(st.min), n: st.n, over400: st.over, samples: samples.map(r1) };
          if (key === 'layouts') g.thumbnails = stats(ctx.cards.slice(o.warmup)).median;
          if (key === 'insert') g.skeletonMedian = r1(stats(ctx.skel.slice(o.warmup)).median);
          cond.gestures.push(g);
          if (o.check && st.max > BUDGET_MS) exit = 1;
          process.stderr.write(`  ${deck} ${key}: median ${g.median} ms, max ${g.max} ms (N=${g.n})\n`);
        }
        cond.consoleErrors = S.consoleErrors.slice(0, 5);
        cond.extErrors = S.extErrors.slice(0, 5);
        result.conditions.push(cond);
      } finally { await S.close(); }
    }
  } finally {
    await browser.close();
    if (!o.keep) fs.rmSync(root, { recursive: true, force: true });
  }
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'latency-' + result.date.replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
  if (o.json) { console.log(JSON.stringify(result, null, 2)); return exit; }
  console.log(`# Latency from gesture to repainted preview\n`);
  console.log(`- Date: ${result.date}`);
  console.log(`- Machine: ${result.machine.cpu}, ${result.machine.cores} cores, ${result.machine.memGB} GB; ${result.machine.os}`);
  console.log(`- Node ${result.node}; ${result.chrome} (headless); @marp-team/marp-core ${result.marpCore}`);
  console.log(`- Harness: ${result.harness}`);
  console.log(`- N = ${o.n} per gesture after ${o.warmup} warm-up sample(s); "first" is the first (cold) sample; times in ms\n`);
  console.log('| Deck (slides) | Gesture | N | Median | p90 | Max | > 400 ms | First |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const c of result.conditions) {
    for (const g of c.gestures) console.log(`| ${c.deck} (${c.slides}) | ${g.label} | ${g.n} | ${g.median} | ${g.p90} | ${g.max} | ${g.over400} | ${g.first} |`);
  }
  console.log(`\nJSON: ${path.relative(path.join(H.EXT_ROOT, '..', '..'), outFile)}`);
  return exit;
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error('bench failed: ' + (e && e.stack || e)); process.exitCode = 1; });
