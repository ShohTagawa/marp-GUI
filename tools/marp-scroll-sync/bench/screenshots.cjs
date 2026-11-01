// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// Screenshots for the README (docs/img/en, docs/img/ja): npm run screenshots
//
//   npm run screenshots                  # both languages, written to docs/img/{en,ja}/
//   npm run screenshots -- --lang en     # one language
//   npm run screenshots -- --out <dir>   # write <dir>/{en,ja}/ instead
//
// Uses the same harness as test/e2e.test.cjs: the real extension.js on the VS Code stub and the
// real Webview HTML in a local headless Chrome (puppeteer-core), at 800 x 560 CSS px and device scale 2.
// The decks are the sample decks slides/sample-hydrogen (en) and slides/sample-hydrogen-ja (ja),
// copied to a temporary repository first, so nothing in slides/ is written. The preview's buttons
// and messages are in Japanese in both sets (the Webview is not localised).
//
//   01-overview      current slide (5) framed, slide buttons above it, size/colour bar below
//   02-direct-edit   in-place editing after a double-click (slide 2)
//   03-layouts       layout variants after a right-click (slide 6)
//   04-slide-buttons close-up of the slide buttons (crop of 01)
//   05-insert-popup  the + between slides 4 and 5 and its popup
//   06-box-edit      the figure of slide 4 selected with Alt (resize handles)
//   07-slides        six finished slides of the deck (1, 2, 3, 5, 9, 10), rendered with marp-core
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const H = require('../test/helpers/e2e-harness.cjs');

const W = 800, HGT = 560, SCALE = 2;   // tall enough for slide buttons + slide + size/colour bar
const DECKS = { en: 'sample-hydrogen', ja: 'sample-hydrogen-ja' };

function parseArgs(argv) {
  const o = { langs: ['en', 'ja'], out: path.join(H.REPO_ROOT, 'docs', 'img') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--lang') o.langs = argv[++i].split(',');
    else if (argv[i] === '--out') o.out = path.resolve(argv[++i]);
    else throw new Error('unknown argument: ' + argv[i]);
  }
  return o;
}
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n || 2);

/** Scroll so that slide i sits at `top` CSS px from the top of the viewport */
async function scrollSlide(page, i, top) {
  await page.evaluate((i, top) => {
    const svg = window.ssPreview.slides()[i];
    const r = svg.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top - top, behavior: 'instant' });
  }, i, top);
  await frames(page, 3);
}
async function selectSlide(S, i) {
  const pt = await S.page.evaluate((i) => {
    const svg = window.ssPreview.slides()[i];
    svg.scrollIntoView({ block: 'center', behavior: 'instant' });
    const b = svg.getBoundingClientRect();
    return { x: b.left + b.width - 30, y: b.top + b.height - 30 };
  }, i);
  await frames(S.page);
  await S.page.mouse.click(pt.x, pt.y);
  await S.waitFor(() => S.page.evaluate((i) => window.ssPreview.current() === i, i), 'slide selected', 3000);
  await S.settle(400);
}
/** Screenshot of the viewport (clip is given in viewport coordinates; puppeteer wants document coordinates) */
async function shot(page, file, clip) {
  const c = clip || { x: 0, y: 0, width: W, height: HGT };
  const off = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  await page.screenshot({ path: file, type: 'png', captureBeyondViewport: false, clip: { x: c.x + off.x, y: c.y + off.y, width: c.width, height: c.height } });
}

async function deckShots(browser, repo, deck, dir) {
  const S = await H.openSession({ browser, mdPath: repo.md[deck], width: W, height: HGT });
  try {
    if (S.activateError) throw S.activateError;
    await S.page.setViewport({ width: W, height: HGT, deviceScaleFactor: SCALE });
    await S.settle(400);
    await S.page.mouse.move(W - 2, HGT - 2);

    // 01 overview and 04 close-up: slide 5 is current
    await selectSlide(S, 4);
    await S.page.mouse.move(W - 2, 2);
    await scrollSlide(S.page, 4, 62);
    await shot(S.page, path.join(dir, '01-overview.png'));
    await shot(S.page, path.join(dir, '04-slide-buttons.png'), { x: 120, y: 0, width: 680, height: 300 });

    // 02 direct edit: double-click the first body paragraph of slide 2
    await selectSlide(S, 1);
    await scrollSlide(S.page, 1, 40);
    const q = await S.page.evaluate(() => {
      const sec = window.ssPreview.sectionOf(window.ssPreview.slides()[1]);
      const el = sec.querySelector('li p, li, p');
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const n = w.nextNode();
      const rg = document.createRange(); rg.setStart(n, 0); rg.setEnd(n, Math.min(4, n.nodeValue.length));
      const b = rg.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await S.page.mouse.click(q.x, q.y, { clickCount: 2, delay: 30 });
    await S.waitFor(() => S.page.evaluate(() => !!document.querySelector('.ss-editing')), 'edit starts', 3000);
    await S.page.keyboard.press('End');
    await frames(S.page, 3);
    await shot(S.page, path.join(dir, '02-direct-edit.png'), { x: 0, y: 0, width: W, height: 480 });
    await S.page.keyboard.press('Escape');
    await S.settle(400);

    // 03 layout variants: right-click slide 6
    await selectSlide(S, 5);
    await scrollSlide(S.page, 5, 40);
    await S.page.evaluate(() => {
      const sec = window.ssPreview.sectionOf(window.ssPreview.slides()[5]);
      const el = sec.querySelector('h2') || sec;
      const rc = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rc.left + 40, clientY: rc.top + 10, button: 2 }));
    });
    await S.waitFor(() => S.page.evaluate(() => { const pop = document.querySelector('.ss-lay-pop'); return pop && Array.from(pop.querySelectorAll('.ss-lay-card')).every(c => c.querySelector('svg section')); }), 'layout thumbnails', 5000);
    await frames(S.page, 3);
    await shot(S.page, path.join(dir, '03-layouts.png'));
    await S.page.evaluate(() => window.ssLayouts.close());
    await S.settle(400);

    // 05 insert popup: the + between slides 4 and 5
    await scrollSlide(S.page, 4, 300);
    const g = await S.page.evaluate(() => {
      const b = document.querySelector('.ss-insert[data-index="3"]');
      return { x: parseFloat(b.style.left) - window.scrollX, y: parseFloat(b.style.top) - window.scrollY };
    });
    await S.page.mouse.move(g.x + 120, g.y + 2);
    await frames(S.page, 3);
    await S.page.evaluate(() => document.querySelector('.ss-insert[data-index="3"]').click());
    await S.waitFor(() => S.page.evaluate(() => {
      const pop = document.querySelector('.ss-pop.ss-open'); if (!pop) return false;
      const cards = Array.from(pop.querySelectorAll('.ss-pc'));
      const filled = cards.filter(c => { const s = c.querySelector('.ss-gal-shadow'); return s && s.shadowRoot && s.shadowRoot.querySelector('section'); }).length;
      return cards.length > 0 && filled >= Math.min(4, cards.length);
    }), 'insert popup', 8000);
    await S.page.mouse.move(W - 2, HGT - 2);
    await frames(S.page, 4);
    await shot(S.page, path.join(dir, '05-insert-popup.png'));
    await S.page.evaluate(() => window.ssPreview.closePopups());
    await S.settle(400);

    // 06 box editing: Alt+click the figure of slide 4, Alt+Up to the <svg>
    await selectSlide(S, 3);
    await scrollSlide(S.page, 3, 40);
    const f = await S.page.evaluate(() => {
      const sec = window.ssPreview.sectionOf(window.ssPreview.slides()[3]);
      const r = sec.querySelector('svg[data-hline]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await S.page.mouse.move(f.x, f.y);
    await S.page.keyboard.down('Alt');
    await S.page.mouse.down(); await S.page.mouse.up();
    for (let up = 0; up < 4; up++) {
      const t = await S.page.evaluate(() => { const x = window.ssBoxEdit.selected(); return x && x.target ? x.target.tag : null; });
      if (t === 'svg') break;
      await S.page.keyboard.press('ArrowUp');
      await frames(S.page);
    }
    await S.page.keyboard.up('Alt');
    const tag = await S.page.evaluate(() => { const x = window.ssBoxEdit.selected(); return x && x.target ? x.target.tag : null; });
    if (tag !== 'svg') throw new Error('06-box-edit: the figure could not be selected');
    // the first click on a shape inside the figure shows a hint toast; let it fade before the shot
    await S.waitFor(() => S.page.evaluate(() => !document.querySelector('.ss-toast.ss-show')), 'toast hidden', 6000);
    await new Promise((r) => setTimeout(r, 800));   // the fade-out transition
    await S.page.mouse.move(W - 2, HGT - 2);
    await frames(S.page, 4);
    await shot(S.page, path.join(dir, '06-box-edit.png'), { x: 0, y: 0, width: W, height: 500 });
    await S.page.keyboard.press('Escape');
    if (S.consoleErrors.length || S.extErrors.length) throw new Error('errors while taking screenshots: ' + JSON.stringify(S.consoleErrors.concat(S.extErrors)).slice(0, 400));
  } finally { await S.close(); }
}

/** 07: six slides in a 3 x 2 grid, rendered with marp-core and the repository themes (no preview UI) */
async function slidesGrid(browser, repo, deck, file) {
  const md = fs.readFileSync(repo.md[deck], 'utf8');
  const r = H.marpRender(md);
  const pick = [1, 2, 3, 5, 9, 10];
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${r.css}
    html, body { margin: 0; background: #e9e9ec; }
    .marpit { display: grid; grid-template-columns: repeat(3, 500px); gap: 16px; padding: 16px 25px; width: max-content; }
    .marpit > svg { width: 500px; height: 281.25px; display: none; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
    ${pick.map(n => `.marpit > svg:nth-of-type(${n})`).join(', ')} { display: block; }
  </style></head><body>${r.html}</body></html>`;
  const tmp = path.join(path.dirname(repo.md[deck]), '.screenshots-grid.html');
  fs.writeFileSync(tmp, html);
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1600, height: 625, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await frames(page, 3);
    await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: 1600, height: 625 } });
  } finally { await page.close(); fs.rmSync(tmp, { force: true }); }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!H.findChrome()) { console.error('screenshots: Google Chrome or Microsoft Edge was not found (set CHROME_PATH).'); return 2; }
  const browser = await H.launch();
  if (!browser) { console.error('screenshots: puppeteer-core is not installed (run npm install).'); return 2; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-gui-shots-'));
  try {
    const repo = H.makeRepo(path.join(root, 'repo'), Object.values(DECKS).concat(['sample-layouts', 'sample-parts']));
    const shelf = path.join(H.REPO_ROOT, 'slides', '_library', 'shelf.json');
    if (fs.existsSync(shelf)) {
      fs.mkdirSync(path.join(root, 'repo', 'slides', '_library'), { recursive: true });
      fs.copyFileSync(shelf, path.join(root, 'repo', 'slides', '_library', 'shelf.json'));
    }
    for (const lang of o.langs) {
      const deck = DECKS[lang];
      if (!deck) throw new Error('unknown language: ' + lang);
      const dir = path.join(o.out, lang);
      fs.mkdirSync(dir, { recursive: true });
      await deckShots(browser, repo, deck, dir);
      await slidesGrid(browser, repo, deck, path.join(dir, '07-slides.png'));
      console.log(`${lang}: ${deck} -> ${path.relative(process.cwd(), dir) || dir}/01-overview.png … 07-slides.png`);
    }
  } finally {
    await browser.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  return 0;
}

main().then((c) => { process.exitCode = c; }, (e) => { console.error('screenshots failed: ' + (e && e.stack || e)); process.exitCode = 1; });
