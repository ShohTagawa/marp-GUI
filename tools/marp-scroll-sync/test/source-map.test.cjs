// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// lib/source-map.cjs の検証（DESIGN.md 2.1）。実行: node --test tools/marp-scroll-sync/test/source-map.test.cjs
//
// いちばん大事なのは「往復」：プレビューのノード k を書き換える編集を原稿に当てて描き直したとき、
// テキストノード列の差分が「k だけが期待どおりに変わった」であること。別のノードが変わった・枚数が変わった・
// k が変わっていない、は全部失敗。書けない型は planTextEdit が ok:false を返していればよい（書かないのは許容）。
//
// ブラウザが要るテストは puppeteer-core（リポジトリ直下の node_modules）＋手元の Chrome。無ければ skip。
// 実デックは読むだけ（書き換えた原稿はメモリ上で作って描画する。slides/ には何も書かない）。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const EXT = path.resolve(__dirname, '..');
const ROOT = path.resolve(EXT, '..', '..');
const SM = require(path.join(EXT, 'lib', 'source-map.cjs'));
const { slideStartLines } = require(path.join(EXT, 'lib', 'slide-split.cjs'));
const { Marp } = require(path.join(EXT, 'node_modules', '@marp-team', 'marp-core'));
const TEXTNODES_JS = fs.readFileSync(path.join(EXT, 'media', 'textnodes.js'), 'utf8');

const DECKS = ['sample-lecture', 'sample-layouts', 'sample-parts'];
const deckPath = (d) => path.join(ROOT, 'slides', d, d + '.md');

// ---- 描画（extension.js の renderDeck と同じ条件：html:true、theme/*.css を academic.css 先頭で全部） ----
const THEMES = (() => {
  const dir = path.join(ROOT, 'theme');
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.css')); } catch (_) { /* テーマ無しでも動く */ }
  names.sort((a, b) => (a === 'academic.css' ? -1 : b === 'academic.css' ? 1 : a.localeCompare(b)));
  return names.map(n => fs.readFileSync(path.join(dir, n), 'utf8'));
})();

function newMarp(extraRule) {
  const marp = new Marp({ html: true });
  if (extraRule) marp.markdown.core.ruler.push('test_probe', extraRule);
  SM.attachLineInfo(marp);
  for (const css of THEMES) { try { marp.themeSet.add(css); } catch (_) { /* 任意 */ } }
  return marp;
}

/**
 * スライド1枚ずつの HTML（<svg data-marpit-svg>…</svg>）。描画のたびに変わる・編集と無関係に変わる属性はならす：
 *   data-marpit-scope-XXXX … <style scoped> の乱数／見出しの id … 同じ見出しが他のスライドにあると -1 が付く
 */
function renderChunks(src) {
  const html = newMarp().render(src).html;
  return html.split(/(?=<svg data-marpit-svg)/).filter(p => p.startsWith('<svg data-marpit-svg'))
    .map(p => p.replace(/data-marpit-scope-[A-Za-z0-9_-]+/g, 'data-marpit-scope-X').replace(/(<h[1-6]) id="[^"]*"/g, '$1'));
}

function slideRanges(src) {
  const starts = slideStartLines(src);
  const lineCount = src.split('\n').length;
  return starts.map((s, i) => [s, starts[i + 1] !== undefined ? starts[i + 1] : lineCount]);
}

// ---- Chrome ----
let browser = null, page = null, skipReason = '';
test.before(async () => {
  try {
    const puppeteer = require(require.resolve('puppeteer-core', { paths: [ROOT] }));
    const env = await import(pathToFileURL(path.join(ROOT, 'tools', 'lib', 'marp-env.mjs')).href);
    const exe = env.findChrome();
    browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
    page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="w"></div></body></html>');
    await page.evaluate(TEXTNODES_JS);
  } catch (e) {
    skipReason = 'Chrome / puppeteer-core が使えない: ' + String(e && e.message || e).split('\n')[0];
    if (browser) { try { await browser.close(); } catch (_) { /* 無視 */ } }
    browser = null; page = null;
  }
});
test.after(async () => { if (browser) await browser.close(); });

/** スライドの HTML を Chrome に読ませ、media/textnodes.js で列挙する（Webview と同じ物） */
async function collect(chunkList) {
  return page.evaluate((list) => list.map((h) => {
    const w = document.getElementById('w');
    w.innerHTML = h;
    return window.ssCollectTextNodes(w.querySelector('section')).map(n => ({ t: n.t, near: n.near, svg: n.svg }));
  }), chunkList);
}

async function loadDeck(src) {
  const chunks = renderChunks(src);
  const ranges = slideRanges(src);
  assert.strictEqual(chunks.length, ranges.length, 'slide-split の枚数と描画の枚数が一致');
  return { src, chunks, ranges, nodes: await collect(chunks) };
}

const splitWs = (t) => {
  const tr = t.trim();
  return { lead: t.slice(0, t.length - t.trimStart().length), tr, trail: t.slice(t.trimEnd().length) };
};

/**
 * ノード (i,k) の trim 済み文字列を core に変える編集を当てて描き直し、結果を判定する。
 * 戻り値: { refused: reason } | { ok:true, plan } | { bad: '理由' }
 *   mode 'exact' … k が now と完全一致、他は不変／'trim' … k は前後の空白を除いて一致／
 *   'gone' … k が消える（隣のノードと合体するので、section 全体の文字列を空白抜きで比べる）
 */
async function roundTrip(deck, i, k, core, mode) {
  const nd = deck.nodes[i][k];
  const { lead, trail } = splitWs(nd.t);
  const now = lead + core + trail;
  const plan = SM.planTextEdit(deck.src, deck.ranges[i], deck.nodes[i], { k, old: nd.t, now });
  if (!plan.ok) return { refused: plan.reason, plan };
  const src2 = SM.applyEdits(deck.src, plan.edits);
  const chunks2 = renderChunks(src2);
  if (chunks2.length !== deck.chunks.length) return { bad: `枚数が変わった ${deck.chunks.length}→${chunks2.length}`, plan };
  for (let j = 0; j < chunks2.length; j++) {
    if (j !== i && chunks2[j] !== deck.chunks[j]) return { bad: `別のスライド ${j} が変わった`, plan };
  }
  const [after] = await collect([chunks2[i]]);
  const got = after.map(n => n.t);
  const exp = deck.nodes[i].map((n, j) => (j === k ? now : n.t));
  if (mode === 'gone') {
    const flat = (a) => a.join('').replace(/\s+/g, '');
    return flat(got) === flat(exp) ? { ok: true, plan } : { bad: `消した結果が違う ${JSON.stringify(got)}`, plan };
  }
  if (got.length !== exp.length) return { bad: `ノード数 ${exp.length}→${got.length} ${JSON.stringify(got.slice(Math.max(0, k - 1), k + 3))}`, plan };
  for (let j = 0; j < got.length; j++) {
    const same = got[j] === exp[j] || (mode === 'trim' && j === k && got[j].trim() === exp[j].trim());
    if (!same) return { bad: `ノード ${j} = ${JSON.stringify(got[j].slice(0, 60))}（期待 ${JSON.stringify(exp[j].slice(0, 60))}）`, plan };
  }
  return { ok: true, plan };
}

const describeBad = (deck, i, k, r) =>
  `slide ${i} node ${k} ${JSON.stringify(deck.nodes[i][k].t.trim().slice(0, 30))} near=${JSON.stringify(deck.nodes[i][k].near)}: ${r.bad} edit=${JSON.stringify(r.plan && r.plan.edit)}`;

// ---------------------------------------------------------------------------
// 合成デック（DESIGN 2.1 の検証項目を 1 本に詰めたもの）
// ---------------------------------------------------------------------------
const SYN_LINES = [
  "---",
  "marp: true",
  "theme: academic",
  "header: '<div class=\"hdr-left\">同じ文 同じ文</div>'",
  "paginate: true",
  "---",
  "",
  "# 同じ文 同じ文",
  "",
  "同じ文 と 同じ文 と **同じ文** と <span class=\"hl\">同じ文</span> と同じ文",
  "",
  "- 行頭記号だけが違う行",
  "* 行頭記号だけが違う行",
  "+ 行頭記号だけが違う行",
  "",
  "1. 行頭記号だけが違う行",
  "",
  "> 行頭記号だけが違う行",
  "",
  "<!-- 同じ文 発表者ノートの中に同じ文がある -->",
  "",
  "---",
  "",
  "# <!-- fit --> Fit 見出し",
  "",
  "[文字](http://example.com/文字 \"文字\") と ![文字 alt](a.png \"文字\") と 文字",
  "",
  "| 見出しA | 見出しB |",
  "|---|---|",
  "| セル | **セル** \\| セル |",
  "| A&amp;B | &lt;tag&gt; |",
  "",
  "発表者ノートの中に同じ文がある",
  "",
  "<!-- 発表者ノートの中に同じ文がある -->",
  "",
  "---",
  "",
  "## コード",
  "",
  "インライン `const a = 1;` と `a < b && c` と ``x ` y``",
  "",
  "```js",
  "const a = \"<div>\"; // コメント",
  "function f(x) { return x * 2; }",
  "```",
  "",
  "    indented code",
  "",
  "~~~",
  "plain fence",
  "~~~",
  "",
  "---",
  "",
  "## 絵文字と数式",
  "",
  "絵文字 :smile: と 😀 の後ろ。数式 $x^2 + y$ の後ろ、$$E=mc^2$$ の後ろ",
  "",
  "$$",
  "y = ax + b",
  "$$",
  "",
  "実体 &amp; と AT&T と &copy; と &nbsp;空白&nbsp; と &quot;引用&quot; と &#39;単&#39; と &#x3042; と &#12354;",
  "",
  "エスケープ \\*星\\* と \\_下線\\_ と \\`バック\\` と \\<山\\> と \\[角\\] と 1\\. 番号 と \\\\ 円",
  "",
  "<https://example.com> と https://example.org と ~~取消~~ と *斜体* と __太字__ と ***両方***",
  "",
  "---",
  "",
  "<div class=\"sections\">",
  "<div class=\"sec-box\">",
  "",
  "### 中の見出し",
  "",
  "- 中の **箇条** 書き",
  "- A &amp; B <b>太い</b> C",
  "",
  "</div>",
  "<div class=\"sec-box\" title=\"a > b < c\" data-x='q\"q'>",
  "HTML の中 &lt;tag&gt; と &amp; と 同じ文",
  "<span",
  "  class=\"hl\"",
  "  title=\"改行をまたぐ\">またぐ</span> 同じ文",
  "<br/>改行後 <IMG src=\"a.png\" alt=\"同じ文\"> 大文字後",
  "</div>",
  "",
  "包まれていない文字",
  "",
  "</div>",
  "<svg viewBox=\"0 0 100 50\" xmlns=\"http://www.w3.org/2000/svg\"><text x=\"1\" y=\"10\">SVG 同じ文</text><text x=\"1\" y=\"30\"><tspan>同じ文</tspan> A &amp; B</text></svg>",
  "",
  "<style scoped>",
  ".x::before { content: \"同じ文\"; }",
  "</style>",
  "",
  "<div class=\"takeaway\">同じ文</div>",
  "",
  "---",
  "",
  "## 窓の上限",
  "",
  "<div class=\"box-info\">",
  "",
  "<div class=\"in\">入れ子</div> 窓の外の裸の文字 &amp; 記号",
  "</div>",
  "",
  "- ",
  "- 空でない",
  "",
  "| a | b |",
  "|---|---|",
  "|   | x |",
  "",
  "前**強調**後",
  "",
];
const SYN = SYN_LINES.join('\n');

// ===========================================================================
// 1. data-hline の注入（純粋）
// ===========================================================================
const stripHline = (s) => s.replace(/ data-hline="\d+" data-hline-end="\d+"/g, '');

const TRICKY_HTML = [
  '<div class="a" title="x > y < z" data-q=\'"<b>"\'>文字 <b>太</b></div>',
  '<!-- <div>コメントの中</div> -->\n<p>後ろ</p>',
  '<style>\n.a > .b::before { content: "<div>"; }\n</style>\n<div>x</div>',
  '<script>if (a < b && c > d) { document.write("<p>x</p>"); }</script><span>y</span>',
  '<br/><img src="a.png" alt="a > b"/><hr />\n<IMG SRC="A.PNG"><DIV Class="X">大文字</DIV>',
  '<span\n  class="hl"\n  title="改行をまたぐ"\n>またぐ</span>',
  '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><g transform="translate(1,2)"><path d="M0 0 L10 10"/><text x="1" y="2">a &lt; b</text></g></svg>',
  '<div>3 < 5 かつ 5 > 3 で a<b とも書く</div>',
  '<my-element data-x="1"></my-element><a href="https://example.com/?a=1&b=2">リンク</a>',
  '<div class="x"\n\n>空行をまたぐタグは markdown-it が切るので触らない</div>',
  '<![CDATA[ <div>x</div> ]]><?xml version="1.0"?><!DOCTYPE html><p>z</p>',
  '<div title=\'閉じない引用符>文字</div>',
];

test('injectHlines: 注入前後で「属性を除いた HTML」が変わらない（文字列）', () => {
  for (const h of TRICKY_HTML) {
    const out = SM.injectHlines(h, 10, 20);
    assert.strictEqual(stripHline(out), h, h);
  }
});

test('injectHlines: 開始タグだけに、そのタグの行番号が付く（コメント・style・script の中には付けない）', () => {
  const out = SM.injectHlines('<div class="a">\n<p>x</p>\n<!-- <i>no</i> -->\n<style>\n.a>b{}\n</style>\n<span\n class="s">y</span>\n</div>', 100, 109);
  const got = [...out.matchAll(/<([A-Za-z-]+) data-hline="(\d+)" data-hline-end="(\d+)"/g)].map(m => m[1] + '@' + m[2] + '-' + m[3]);
  assert.deepStrictEqual(got, ['div@100-109', 'p@101-109', 'span@106-109']);
  assert.ok(!/<i data-hline/.test(out) && !/<style data-hline/.test(out));
  // 属性値の中の < > を持つタグ・自己終了タグ・大文字タグ
  const o2 = SM.injectHlines(TRICKY_HTML[0] + TRICKY_HTML[4], 0, 1);
  assert.strictEqual((o2.match(/data-hline=/g) || []).length, 2 + 5);
  assert.ok(o2.includes('<br data-hline="0" data-hline-end="1"/>'));
  assert.ok(o2.includes('<IMG data-hline="1" data-hline-end="1" SRC="A.PNG">')); // 改行の後ろなので次の行
  // 本文の不等号はタグにしない
  assert.strictEqual((SM.injectHlines(TRICKY_HTML[7], 0, 1).match(/data-hline=/g) || []).length, 1);
});

test('attachLineInfo: 実デックの全 html_block で、属性を除くと元の content に戻る／二重に足さない', (t) => {
  let blocks = 0, tags = 0, decks = 0;
  for (const d of DECKS) {
    if (!fs.existsSync(deckPath(d))) continue;
    decks++;
    const src = fs.readFileSync(deckPath(d), 'utf8');
    const before = [];
    // attachLineInfo より先に走るルールで元の content を控える
    const marp = newMarp((state) => { for (const tk of state.tokens) if (tk.type === 'html_block') before.push(tk.content); });
    SM.attachLineInfo(marp); // 二度呼んでも二重にならない
    const after = [];
    marp.markdown.core.ruler.push('test_after', (state) => { for (const tk of state.tokens) if (tk.type === 'html_block') after.push(tk.content); });
    marp.render(src);
    assert.strictEqual(after.length, before.length);
    for (let i = 0; i < before.length; i++) {
      assert.strictEqual(stripHline(after[i]), before[i], `${d} html_block #${i}`);
      assert.ok(!/data-hline="\d+" data-hline-end="\d+" data-hline=/.test(after[i]), '二重注入なし');
      tags += (after[i].match(/ data-hline="/g) || []).length;
    }
    blocks += before.length;
  }
  if (!decks) return t.skip('実デックが無い');
  t.diagnostic(`html_block ${blocks} 個・注入したタグ ${tags} 個`);
});

test('injectHlines: Chrome で解釈した DOM も、属性を除けば同じ（実 DOM）', async (t) => {
  if (!page) return t.skip(skipReason);
  const res = await page.evaluate((list) => list.map(([a, b]) => {
    const da = document.createElement('div'), db = document.createElement('div');
    da.innerHTML = a; db.innerHTML = b;
    let n = 0;
    db.querySelectorAll('[data-hline]').forEach((e) => { n++; e.removeAttribute('data-hline'); e.removeAttribute('data-hline-end'); });
    return { same: da.innerHTML === db.innerHTML, n, elements: da.querySelectorAll('*').length, inRaw: da.querySelectorAll('style, script').length };
  }), TRICKY_HTML.map(h => [h, SM.injectHlines(h, 0, 9)]));
  res.forEach((r, i) => assert.ok(r.same, 'DOM が変わった: ' + TRICKY_HTML[i]));
  // style / script 以外の全要素に付いている。除くもの：本文の「a<b とも書く」（Chrome は <b> 要素と読むが、こちらは本文の
  // 不等号とみなして付けない＝near が親の div になるだけで害は無い）／空行をまたぐタグ・CDATA・閉じない引用符
  [0, 1, 2, 3, 4, 5, 6, 8].forEach((i) => assert.strictEqual(res[i].n, res[i].elements - res[i].inRaw, TRICKY_HTML[i]));
});

// ===========================================================================
// 2. マスクと探索（純粋）
// ===========================================================================
test('maskRegion: 長さが変わらない／コメント・タグ属性・style・リンク先・画像・数式は潰れ、本文は残る', () => {
  const s = '同じ文 <span title="同じ文">同じ文</span> <!-- 同じ文 --> [同じ文](http://x/同じ文 "同じ文") ![同じ文](a.png) $同じ文$ `同じ文`\n<style>\n.a::before{content:"同じ文"}\n</style>\n';
  const { masked, code } = SM.maskRegion(s, 0, s.length);
  assert.strictEqual(masked.length, s.length);
  assert.strictEqual(masked.split('同じ文').length - 1, 4); // 本文・span の中・リンクの文字・コードの中
  assert.strictEqual(code.length, 1);
  assert.strictEqual(masked.replace(/\0/g, '').includes('http'), false);
});

test('locateNodes: 同じ語は前から順に消費する／frontmatter の header・発表者ノートには当たらない', () => {
  const ranges = slideRanges(SYN);
  const p = { kind: 'md', start: 9, end: 10 };
  const nodes = [
    { t: '同じ文 同じ文', near: { kind: 'md', start: 7, end: 8 }, svg: false },
    { t: '同じ文 と 同じ文 と ', near: p, svg: false }, { t: '同じ文', near: p, svg: false },
    { t: ' と ', near: p, svg: false }, { t: '同じ文', near: p, svg: false }, { t: ' と同じ文', near: p, svg: false },
  ];
  const locs = SM.locateNodes(SYN, ranges[0], nodes);
  assert.ok(locs.every(Boolean));
  const line9 = SYN.split('\n').slice(0, 9).join('\n').length + 1;
  assert.strictEqual(locs[1].start, line9);
  assert.strictEqual(SYN.slice(locs[2].start - 2, locs[2].end + 2), '**同じ文**');
  assert.strictEqual(SYN.slice(locs[4].start - 1, locs[4].end + 1), '>同じ文<');
  for (let i = 1; i < locs.length; i++) assert.ok(locs[i].start >= locs[i - 1].end, '原稿順');
  // near が無くても（スライド全体が窓）ノートの中の文には当たらない
  const r1 = SM.locateNodes(SYN, ranges[1], [{ t: '発表者ノートの中に同じ文がある', near: null, svg: false }]);
  assert.ok(r1[0] && SYN.slice(r1[0].start - 5, r1[0].start) !== '<!-- ');
  assert.strictEqual(SYN.slice(r1[0].start - 1, r1[0].start), '\n');
  // 原稿に無い文字（数式・絵文字の出力）は null。cursor は動かず、次のノードは見つかる
  const r2 = SM.locateNodes(SYN, ranges[3], [{ t: 'x2+y', near: null, svg: false }, { t: '絵文字と数式', near: null, svg: false }]);
  assert.strictEqual(r2[0], null);
  assert.ok(r2[1]);
});

test('planTextEdit: 古い old・範囲外の k・改行入りの入力は書かない', () => {
  const ranges = slideRanges(SYN);
  const nodes = [{ t: '同じ文 同じ文', near: { kind: 'md', start: 7, end: 8 }, svg: false }];
  assert.strictEqual(SM.planTextEdit(SYN, ranges[0], nodes, { k: 0, old: '別の文', now: 'x' }).reason, 'stale');
  assert.strictEqual(SM.planTextEdit(SYN, ranges[0], nodes, { k: 3, old: 'a', now: 'b' }).ok, false);
  assert.strictEqual(SM.planTextEdit(SYN, ranges[0], nodes, { k: 0, old: nodes[0].t, now: '同じ文\n同じ文' }).reason, 'newline');
  const same = SM.planTextEdit(SYN, ranges[0], nodes, { k: 0, old: nodes[0].t, now: nodes[0].t });
  assert.ok(same.ok && same.edit === null);
  const miss = SM.planTextEdit(SYN, ranges[0], [{ t: '原稿に無い', near: { kind: 'md', start: 7, end: 8 }, svg: false }], { k: 0, old: '原稿に無い', now: 'x' });
  assert.deepStrictEqual([miss.ok, miss.reason, miss.line], [false, 'not-located', 7]);
});

test('planEmptyFill: 記号だけの行の末尾に足す。それ以外は書かない', () => {
  const ranges = slideRanges(SYN);
  const lines = SYN.split('\n');
  const li = lines.indexOf('- ');
  assert.ok(li > 0);
  const r = SM.planEmptyFill(SYN, ranges[5], { kind: 'md', line: li, lineEnd: li + 1 }, ' 新しい *項目* ');
  assert.ok(r.ok);
  assert.strictEqual(SM.applyEdits(SYN, r.edits).split('\n')[li], '- 新しい \\*項目\\*');
  // 空白なしの記号だけ・見出し記号・行頭で化ける入力
  const t2 = '---\nmarp: true\n---\n\n-\n\n## \n\n- x\n';
  assert.strictEqual(SM.applyEdits(t2, SM.planEmptyFill(t2, [3, 9], { line: 4, lineEnd: 5 }, 'あ').edits).split('\n')[4], '- あ');
  assert.strictEqual(SM.applyEdits(t2, SM.planEmptyFill(t2, [3, 9], { line: 6, lineEnd: 7 }, '# 見出し').edits).split('\n')[6], '## \\# 見出し');
  assert.strictEqual(SM.planEmptyFill(t2, [3, 9], { line: 8, lineEnd: 9 }, 'y').reason, 'not-empty');
  assert.strictEqual(SM.planEmptyFill(t2, [3, 9], { line: 1, lineEnd: 2 }, 'y').reason, 'out-of-slide');
  assert.strictEqual(SM.planEmptyFill(t2, [3, 9], { kind: 'html', line: 4, lineEnd: 5 }, 'y').reason, 'html-empty');
  assert.strictEqual(SM.planEmptyFill(t2, [3, 9], { line: 4, lineEnd: 5 }, 'a\nb').reason, 'newline');
  const none = SM.planEmptyFill(t2, [3, 9], { line: 4, lineEnd: 5 }, '   ');
  assert.ok(none.ok && none.edit === null);
  // CRLF：\r の手前に入れる
  const t3 = t2.replace(/\n/g, '\r\n');
  assert.strictEqual(SM.applyEdits(t3, SM.planEmptyFill(t3, [3, 9], { line: 4, lineEnd: 5 }, 'あ').edits).split('\r\n')[4], '- あ');
});

// ===========================================================================
// 2b. レビューで見つけた型の再発防止（純粋。ノードは手で組む）
// ===========================================================================
const FM = '---\nmarp: true\n---\n\n';
/** 1 行目が本文 1 段落だけのデックで、その段落（または near を指定した行）のノードを old → now に変える */
function planOne(src, line, old, now, kind) {
  const nodes = [{ t: old, near: { kind: kind || 'md', start: line, end: line + 1 }, svg: false }];
  return SM.planTextEdit(src, slideRanges(src)[0], nodes, { k: 0, old, now });
}

test('ページ分割を壊さない：--- / -- / - - - / === を入力しても区切り線・setext・frontmatter にならない（LF/CRLF）', () => {
  for (const crlf of [false, true]) {
    const X = (x) => (crlf ? x.replace(/\n/g, '\r\n') : x);
    for (const typed of ['---', '--', '- - -', '===', '-', '+ x', '# x', '> x', '1. x', '1) x']) {
      const src = X(FM + '前の段落\n\n本文\n\n後ろ\n');
      const r = planOne(src, 6, '本文', typed);
      assert.ok(r.ok, typed);
      const out = SM.applyEdits(src, r.edits);
      assert.strictEqual(slideStartLines(out).length, 1, 'スライドが増えない: ' + typed);
      assert.ok(/^(\\|\d+\\)/.test(out.split(/\r?\n/)[6]), JSON.stringify(out.split(/\r?\n/)[6]));
    }
    // frontmatter の無い原稿の 1 行目を --- にしても frontmatter の開始にならない
    const bare = X('本文だけ');
    const rb = SM.planTextEdit(bare, [0, 1], [{ t: '本文だけ', near: { kind: 'md', start: 0, end: 1 }, svg: false }], { k: 0, old: '本文だけ', now: '---' });
    assert.strictEqual(SM.applyEdits(bare, rb.edits), '\\---');
    // 差分が行の途中から始まるのに、行全体が区切り線・箇条書きに化ける → \ を入れる場所が無いので書かない
    assert.strictEqual(planOne(X(FM + '前\n\n--x\n\n後\n'), 6, '--x', '---').reason, 'line-head');
    assert.strictEqual(planOne(X(FM + '前\n\n-x\n\n後\n'), 6, '-x', '-').reason, 'line-head');
    assert.strictEqual(planOne(X(FM + '前\n\n-x\n\n後\n'), 6, '-x', '-xy').ok, true); // もともと化けない形のままなら書く
    // setext 見出しの文字を全部消すと、下線の --- が区切り線（ページ分割）になる → 書かない
    const st = X(FM + '見出し\n---\n\n本文\n');
    assert.strictEqual(planOne(st, 4, '見出し', '').reason, 'setext');
    assert.strictEqual(planOne(st, 4, '見出し', '見出し改').ok, true);
    // 強制改行 \ の次の行を全部消すと \ が文字として出る → 書かない
    const hb = X(FM + '行\\\n次\n');
    assert.strictEqual(SM.planTextEdit(hb, slideRanges(hb)[0], [{ t: '行', near: { kind: 'md', start: 4, end: 6 } }, { t: '\n次', near: { kind: 'md', start: 4, end: 6 } }], { k: 1, old: '\n次', now: '\n' }).reason, 'hard-break');
  }
});

test('文字としての & と \\ の直後への入力：実体参照・エスケープに化けさせない', () => {
  // 「A &」に「lt;」を足す → そのまま書くと A &lt;（表示は A <）。& から書き直す
  let src = FM + 'A &\n';
  let r = planOne(src, 4, 'A &', 'A &lt;');
  assert.strictEqual(SM.applyEdits(src, r.edits).split('\n')[4], 'A &amp;lt;');
  // 消した結果くっついて &amp; になる
  src = FM + 'A &x amp; B\n';
  r = planOne(src, 4, 'A &x amp; B', 'A &amp; B');
  assert.strictEqual(SM.applyEdits(src, r.edits).split('\n')[4], 'A &amp;amp; B');
  // html_block の中でも同じ
  src = FM + '<div>P & Q</div>\n';
  r = planOne(src, 4, 'P & Q', 'P &amp; Q', 'html');
  assert.strictEqual(SM.applyEdits(src, r.edits).split('\n')[4], '<div>P &amp;amp; Q</div>');
  // & がノードの外（別のノード）にあるときは触れないので書かない
  // （原稿で隣り合う 2 つのノードは実際にはまず出ない。ノード列を手で組んで守りだけ確かめる）
  src = FM + 'A &x\n';
  const near = { kind: 'md', start: 4, end: 5 };
  assert.strictEqual(SM.planTextEdit(src, slideRanges(src)[0], [{ t: 'A &', near }, { t: 'x', near }], { k: 1, old: 'x', now: 'lt;x' }).reason, 'entity-boundary');
  // もともと実体参照の形だったもの（R&D; など）を触らない編集は普通に書ける
  src = FM + 'AT&T と B\n';
  assert.strictEqual(planOne(src, 4, 'AT&T と B', 'AT&T と BC').edit.text, 'C');
  // 「C:\」の直後に ASCII 記号 → \ が食われないよう \ を足す
  src = FM + 'C:\\\n';
  assert.strictEqual(SM.applyEdits(src, planOne(src, 4, 'C:\\', 'C:\\!').edits).split('\n')[4], 'C:\\\\!');
  src = FM + 'C:\\x.y\n';
  assert.strictEqual(SM.applyEdits(src, planOne(src, 4, 'C:\\x.y', 'C:\\.y').edits).split('\n')[4], 'C:\\\\.y');
});

test('絵文字ショートコード :smile: は止められないので書かない（時刻 10:30:45 は書ける）', () => {
  const src = FM + '本文\n';
  assert.strictEqual(planOne(src, 4, '本文', ':smile: 本文').reason, 'emoji-shortcode');
  assert.strictEqual(planOne(src, 4, '本文', '本文 :+1:').reason, 'emoji-shortcode');
  assert.strictEqual(planOne(src, 4, '本文', '10:30:45 本文').ok, true);
  const s2 = FM + ':smile\n';
  assert.strictEqual(planOne(s2, 4, ':smile', ':smile:').reason, 'emoji-shortcode');
  assert.strictEqual(SM.planEmptyFill(FM + '- \n', [4, 5], { line: 4, lineEnd: 5 }, ':smile:').reason, 'emoji-shortcode');
  // 空白だけの行は「記号だけの行」ではない
  assert.strictEqual(SM.planEmptyFill(FM + 'a\n\nb\n', [4, 7], { line: 5, lineEnd: 6 }, 'x').reason, 'not-empty');
  assert.strictEqual(SM.applyEdits(FM + '- \n', SM.planEmptyFill(FM + '- \n', [4, 5], { line: 4, lineEnd: 5 }, '---').edits).split('\n')[4], '- \\---');
});

test('順序に頼った特定が信用できないとき（手前に特定できないノード＋同じ語）は書かない', () => {
  // &hearts; は実体参照の表に無い → 1 つ目のノードは特定できず、2 つ目の「重要」が手前の「重要」に当たる
  const src = FM + '&hearts; 重要 <b>重要</b> と 唯一\n';
  const near = { kind: 'md', start: 4, end: 5 };
  const nodes = [{ t: '♥ 重要 ', near }, { t: '重要', near }, { t: ' と 唯一', near }];
  const locs = SM.locateNodes(src, slideRanges(src)[0], nodes);
  assert.strictEqual(locs[0], null);
  assert.strictEqual(SM.planTextEdit(src, slideRanges(src)[0], nodes, { k: 1, old: '重要', now: '重要!' }).reason, 'ambiguous');
  assert.strictEqual(SM.planRangeSelect(src, slideRanges(src)[0], nodes, { k: 1, start: 0, end: 2 }).reason, 'ambiguous');
  // 窓の中に 1 回しか出ない文字列は、順序に頼っていないので書ける
  const r = SM.planTextEdit(src, slideRanges(src)[0], nodes, { k: 2, old: ' と 唯一', now: ' と 唯一無二' });
  assert.ok(r.ok);
  assert.strictEqual(SM.applyEdits(src, r.edits).split('\n')[4], '&hearts; 重要 <b>重要</b> と 唯一無二');
});

test('端の空白の外側に打った文字は、原稿でも空白の外側に入る（リンク・太字の直後で打つと次のノードの先頭に入る）', () => {
  const near = { kind: 'md', start: 4, end: 5 };
  const plan = (line, ts, change) => {
    const src = FM + line + '\n';
    const r = SM.planTextEdit(src, slideRanges(src)[0], ts.map(t => ({ t, near })), change);
    return r.ok ? (r.edits.length ? SM.applyEdits(src, r.edits).split('\n')[4] : null) : r.reason;
  };
  const L1 = '- 公式は <https://example.com/docs> を見る', N1 = ['公式は ', 'https://example.com/docs', ' を見る'];
  assert.strictEqual(plan(L1, N1, { k: 2, old: ' を見る', now: 'X を見る' }), '- 公式は <https://example.com/docs>X を見る');
  assert.strictEqual(plan(L1, N1, { k: 0, old: '公式は ', now: '公式は X' }), '- 公式は X<https://example.com/docs> を見る');
  // 強調記号の隣は flanking の判定が変わりうるので書かない／裸の URL の直後はリンク先が変わるので書かない
  assert.strictEqual(plan('- a **bold** text', ['a ', 'bold', ' text'], { k: 2, old: ' text', now: 'X text' }), 'emphasis-boundary');
  assert.strictEqual(plan('- see https://x.com/a <b>c</b>', ['see ', 'https://x.com/a', ' ', 'c'], { k: 0, old: 'see ', now: 'see X' }), 'autolink');
  // Markdown の記号はエスケープして入れる
  assert.strictEqual(plan('- a [link](u) text', ['a ', 'link', ' text'], { k: 2, old: ' text', now: '*X text' }), '- a [link](u)\\*X text');
  // 空白の内側の編集・消した編集はこれまでどおり
  assert.strictEqual(plan('- a [link](u) text', ['a ', 'link', ' text'], { k: 2, old: ' text', now: ' texts' }), '- a [link](u) texts');
  assert.strictEqual(plan('- a [link](u) text', ['a ', 'link', ' text'], { k: 0, old: 'a ', now: 'new' }), '- new [link](u) text');
  assert.strictEqual(plan('- a [link](u) text', ['a ', 'link', ' text'], { k: 2, old: ' text', now: 'text' }), null);
});

test('サロゲートペア：差分が文字の途中で切れない／オフセットは UTF-16 のまま合う', () => {
  const src = FM + '<div>😀あ😀 と 𠮷野家</div>\n';
  let r = planOne(src, 4, '😀あ😀 と 𠮷野家', '😁あ😀 と 𠮷野家', 'html'); // 上位サロゲートが同じ・下位だけ違う
  assert.deepStrictEqual([src.slice(r.edit.start, r.edit.end), r.edit.text], ['😀', '😁']);
  r = planOne(src, 4, '😀あ😀 と 𠮷野家', '😀あ😀 と 𩸽野家', 'html');
  assert.deepStrictEqual([src.slice(r.edit.start, r.edit.end), r.edit.text], ['𠮷', '𩸽']);
  r = planOne(src, 4, '😀あ😀 と 𠮷野家', '😀あ😀 と 𠮷野', 'html');
  assert.strictEqual(SM.applyEdits(src, r.edits).split('\n')[4], '<div>😀あ😀 と 𠮷野</div>');
  // 数値参照で書かれた絵文字（表示は 2 コードユニット、原稿は 9 文字）を差し替える
  const s2 = FM + '<div>&#x1F600;あ</div>\n';
  r = planOne(s2, 4, '😀あ', '😁あ', 'html');
  assert.strictEqual(SM.applyEdits(s2, r.edits).split('\n')[4], '<div>😁あ</div>');
  const sel = SM.planRangeSelect(src, slideRanges(src)[0], [{ t: ' 😀あ😀 と 𠮷野家', near: { kind: 'html', start: 4, end: 5 }, svg: false }], { k: 0, start: 9, end: 12 });
  assert.ok(sel.ok);
  assert.strictEqual(src.slice(sel.start, sel.end), '𠮷野'); // nodeValue 上のオフセット（先頭空白込み・UTF-16）
});

test('壊れた入力で例外を投げない（拡張のメッセージ処理を落とさない）／空のデック・1 枚だけ・末尾改行なし', () => {
  assert.doesNotThrow(() => {
    SM.locateNodes('', [0, 0], []);
    SM.locateNodes(undefined, undefined, undefined);
    SM.locateNodes('abc', [5, 1], [null, 5, { t: 5 }, { t: 'abc', near: { kind: 'md', start: 'x', end: NaN } }, { t: 'b', near: { kind: 'md', start: 99, end: 100 } }]);
    SM.planTextEdit(undefined, undefined, undefined, undefined);
    SM.planTextEdit('a', [0, 1], [{ t: 'a', near: null }], null);
    SM.planTextEdit('a', [0, 1], [{ t: 'a', near: null }], { k: 0 });
    SM.planRangeSelect('abc', [0, 1], [{ t: 'abc', near: null }], null);
    SM.planRangeSelect('abc', [0, 1], [{ t: 'abc', near: null }], { k: 0, start: NaN, end: 2 });
    SM.planEmptyFill('abc', [0, 1], null, 'x');
    SM.planEmptyFill(undefined, undefined, undefined, undefined);
    SM.attachLineInfo(null); SM.attachLineInfo({});
    SM.injectHlines(undefined, 0, 0); SM.injectHlines('<', 0, 0); SM.injectHlines('<div', 0, 0); SM.injectHlines('<div "', 0, 0);
  });
  assert.strictEqual(SM.planTextEdit('', [0, 0], [{ t: 'a', near: null }], { k: 0, old: 'a', now: 'b' }).ok, false);
  const one = '# 一枚だけ 末尾改行なし';
  const r = SM.planTextEdit(one, [0, 1], [{ t: '一枚だけ 末尾改行なし', near: { kind: 'md', start: 0, end: 1 } }], { k: 0, old: '一枚だけ 末尾改行なし', now: '一枚だけ 末尾改行なし★' });
  assert.strictEqual(SM.applyEdits(one, r.edits), one + '★');
  // 記号だらけの原稿でも時間が爆発しない（マスクは段落の終わりを覚えておく）
  const t0 = Date.now();
  SM.locateNodes('$a '.repeat(20000) + '\n', [0, 1], [{ t: 'x', near: null }]);
  SM.locateNodes('&'.repeat(20000) + '\n', [0, 1], [{ t: '&'.repeat(50) + 'x', near: null }]);
  assert.ok(Date.now() - t0 < 2000);
});

// ===========================================================================
// 3. 合成デック：全ノード × 編集の型（実 DOM で往復）
// ===========================================================================
const EDITS = {
  append: { f: (tr) => tr + '★検', mode: 'exact' },
  prepend: { f: (tr) => '検★' + tr, mode: 'exact' },
  replace: { f: () => '全部かえた', mode: 'exact' },
  mid: { f: (tr) => (tr.length > 1 ? tr.slice(0, 1) + '中' + tr.slice(1) : null), mode: 'exact' },
  delLast: { f: (tr) => (tr.length > 2 ? tr.slice(0, -1) : null), mode: 'trim' },
  // Markdown・HTML の記法として働く記号を全部。入力どおりに表示されること
  special: { f: (tr) => tr + ' a*b_c`d<e[f]g&h>i~j$k|l\\m', mode: 'exact' },
  specialHead: { f: (tr) => '# - 1. > <b> &amp; ' + tr, mode: 'exact' },
  punct: { f: (tr) => '（' + tr + '）。', mode: 'exact' },
  empty: { f: () => '', mode: 'gone' },
};
// 断ってよい理由（誤った場所へ書くより、書かないほうを選ぶ型）
const ALLOWED_REFUSALS = new Set(['code-highlight', 'code-delimiter', 'autolink', 'maybe-code', 'emphasis-boundary', 'setext', 'hard-break', 'line-head', 'entity-boundary', 'emoji-shortcode', 'ambiguous']);

async function propertyRun(t, deck, names, stride) {
  const bad = [], summary = {};
  for (const name of names) {
    const st = { ok: 0, refused: {} };
    let g = 0;
    for (let i = 0; i < deck.nodes.length; i++) for (let k = 0; k < deck.nodes[i].length; k++) {
      if ((g++) % stride) continue;
      const core = EDITS[name].f(deck.nodes[i][k].t.trim());
      if (core === null) continue;
      const r = await roundTrip(deck, i, k, core, EDITS[name].mode);
      if (r.ok) st.ok++;
      else if (r.refused) {
        st.refused[r.refused] = (st.refused[r.refused] || 0) + 1;
        if (!ALLOWED_REFUSALS.has(r.refused)) bad.push(`${name}: slide ${i} node ${k} を理由 ${r.refused} で断った`);
      } else bad.push(name + ': ' + describeBad(deck, i, k, r));
    }
    summary[name] = st;
    t.diagnostic(`${name}: ok ${st.ok} / 断り ${JSON.stringify(st.refused)}`);
  }
  return { bad, summary };
}

for (const [label, src] of [['LF', SYN], ['CRLF', SYN.replace(/\n/g, '\r\n')]]) {
  test(`合成デック(${label}): 全ノードを特定でき、どの編集も「k だけが期待どおり」か「断る」`, async (t) => {
    if (!page) return t.skip(skipReason);
    const deck = await loadDeck(src);
    // 特定：原稿に無い文字（数式 KaTeX/MathJax の出力・絵文字は img）はノードにならないか null。ここでは全部見つかる
    const miss = [];
    deck.nodes.forEach((nodes, i) => SM.locateNodes(src, deck.ranges[i], nodes).forEach((l, k) => { if (!l) miss.push([i, k, nodes[k].t]); }));
    assert.deepStrictEqual(miss, []);
    const { bad, summary } = await propertyRun(t, deck, Object.keys(EDITS), 1);
    assert.deepStrictEqual(bad, []);
    // 断るのはコード（ハイライトつき）とオートリンクだけ、という型の確認
    assert.deepStrictEqual(Object.keys(summary.append.refused).sort(), ['autolink', 'code-highlight']);
    assert.ok(summary.append.ok >= 70);
  });
}

test('合成デック: 個別の型（同じ語・リンク・表・実体参照・エスケープ・SVG・窓の上限）', async (t) => {
  if (!page) return t.skip(skipReason);
  const deck = await loadDeck(SYN);
  const find = (i, pred, nth) => { let c = 0; for (let k = 0; k < deck.nodes[i].length; k++) if (pred(deck.nodes[i][k]) && c++ === (nth || 0)) return k; return -1; };
  const editOf = async (i, k, core) => {
    assert.ok(k >= 0, 'ノードが見つかる');
    const r = await roundTrip(deck, i, k, core, 'exact');
    assert.ok(r.ok, r.bad || r.refused);
    return r.plan.edit;
  };
  const lineOf = (off) => SYN.slice(0, off).split('\n').length - 1;
  const L = SYN.split('\n');

  // 同じ語が同一ブロックに複数回：<span class="hl"> の中の 同じ文 は 4 つ目（header・見出しの 2 つは別）
  let e = await editOf(0, find(0, n => n.t === '同じ文', 1), '同じ文X');
  assert.strictEqual(SYN.slice(e.start - 3, e.start), '同じ文');
  assert.strictEqual(SYN.slice(e.end, e.end + 7), '</span>');
  // 行頭記号だけが違う行：3 つ目（+ の行）
  e = await editOf(0, find(0, n => n.t.trim() === '行頭記号だけが違う行', 2), '行頭記号だけが違う行Z');
  assert.strictEqual(L[lineOf(e.start)], '+ 行頭記号だけが違う行');
  // 発表者ノートの中に同じ文：本文のほうに書く
  e = await editOf(1, find(1, n => n.t.trim() === '発表者ノートの中に同じ文がある'), '本文だけ');
  assert.strictEqual(L[lineOf(e.start)], '発表者ノートの中に同じ文がある');
  // リンク：文字 は [文字] の中。url・title・画像の alt には触れない
  e = await editOf(1, find(1, n => n.t === '文字'), '文字2');
  assert.strictEqual(SYN.slice(e.end, e.end + 2), '](');
  // 段落の最後の「と 文字」：画像の alt・title の 文字 を飛ばして本文に当たる
  e = await editOf(1, find(1, n => n.t.trim() === 'と 文字'), 'と 文字3');
  assert.ok(L[lineOf(e.start)].endsWith('と 文字') && e.end === SYN.indexOf('\n', e.start));
  // <!-- fit --> 見出し
  await editOf(1, find(1, n => n.t.trim() === 'Fit 見出し'), 'Fit 見出し改');
  // 表のセル：| を入力したら \| で書く
  e = await editOf(1, find(1, n => n.t === '見出しB'), '見出し|B');
  assert.strictEqual(e.text, '\\|');
  // 実体参照つきのセル A&amp;B：既存の &amp; は 1 バイトも触らず、足した & も実体参照で
  e = await editOf(1, find(1, n => n.t === 'A&B'), 'A&B&C');
  assert.deepStrictEqual([e.text, SYN.slice(e.start - 7, e.start)], ['&amp;C', 'A&amp;B']);
  // Markdown 由来に * _ ` < [ を入力 → バックスラッシュで止める
  e = await editOf(0, find(0, n => n.t.trim() === '行頭記号だけが違う行', 0), '行頭記号*だ_け`が<違[う行');
  assert.strictEqual(e.text, '\\*だ\\_け\\`が\\<違\\[');
  // html_block 内に < & → 実体参照。表示は入力どおり（roundTrip が確認済み）
  e = await editOf(4, find(4, n => n.t.trim() === '大文字後'), '大文字後 a<b & c>d');
  assert.strictEqual(e.text, ' a&lt;b &amp; c&gt;d');
  // インライン SVG の <tspan> の次のテキスト（実体参照つき）
  e = await editOf(4, find(4, n => n.svg && n.t.trim() === 'A & B'), 'A & B & C');
  assert.strictEqual(e.text, ' &amp; C');
  // <style scoped> の content:"同じ文" を飛ばして takeaway の 同じ文 に当たる
  e = await editOf(4, deck.nodes[4].length - 1, '同じ文！');
  assert.ok(L[lineOf(e.start)].startsWith('<div class="takeaway">'));
  // 窓の上限：先に開いた <div> が near になる「包まれていない文字」は、html_block の行範囲の外にある → 広げて見つける
  const kw = find(5, n => n.t.trim().startsWith('窓の外の裸の文字'));
  assert.ok(deck.nodes[5][kw].near.kind === 'html' && lineOf(SM.locateNodes(SYN, deck.ranges[5], deck.nodes[5])[kw].start) >= deck.nodes[5][kw].near.end);
  await editOf(5, kw, '窓の外の裸の文字 & 記号を直した');
  // 既存のバックスラッシュエスケープ・数値参照の行：差分の外は触らない
  const ke = find(3, n => n.t.startsWith('エスケープ *星*'));
  e = await editOf(3, ke, deck.nodes[3][ke].t.replace('下線', '下線X'));
  assert.deepStrictEqual([e.text, e.end - e.start], ['X', 0]);
  const kn = find(3, n => n.t.startsWith('実体 & と AT&T'));
  e = await editOf(3, kn, deck.nodes[3][kn].t.replace('引用', '引用文'));
  assert.deepStrictEqual([e.text, SYN.slice(e.end, e.end + 6)], ['文', '&quot;']);

  // planRangeSelect：見えている文字の範囲 → 原稿の範囲
  const kp = find(0, n => n.t.startsWith('同じ文 と 同じ文'));
  const sel = SM.planRangeSelect(SYN, deck.ranges[0], deck.nodes[0], { k: kp, start: 6, end: 9 });
  assert.ok(sel.ok);
  assert.deepStrictEqual([SYN.slice(sel.start, sel.end), sel.line, sel.startCol], ['同じ文', 9, 6]);
  assert.strictEqual(SM.planRangeSelect(SYN, deck.ranges[3], deck.nodes[3], { k: kn, start: 0, end: 6 }).reason, 'encoded');
  assert.strictEqual(SM.planRangeSelect(SYN, deck.ranges[4], deck.nodes[4], { k: find(4, n => n.svg), start: 0, end: 2 }).reason, 'svg');
  assert.strictEqual(SM.planRangeSelect(SYN, deck.ranges[2], deck.nodes[2], { k: find(2, n => n.t === 'const a = 1;'), start: 0, end: 2 }).reason, 'code');

  // 断る型
  const refuse = async (i, k, core, reason) => { const r = await roundTrip(deck, i, k, core, 'exact'); assert.strictEqual(r.refused, reason); };
  await refuse(2, find(2, n => n.t === 'const'), 'let', 'code-highlight');
  await refuse(2, find(2, n => n.t === 'const a = 1;'), 'const a = `1`;', 'code-delimiter');
  await refuse(3, find(3, n => n.t === 'https://example.com'), 'https://example.jp', 'autolink');
  await refuse(2, find(2, n => n.t.trim() === 'indented code'), 'indented *code*', 'maybe-code');
  // 「前**強調**後」の 強調 に「」を足すと ** が left-flanking でなくなり、記号が丸見えになる → 断る。
  // 「中の **箇条** 書き」は ** の外が空白なので「」を足しても強調のまま → 書く
  await refuse(5, find(5, n => n.t === '強調'), '「強調」', 'emphasis-boundary');
  await editOf(4, find(4, n => n.t === '箇条'), '「箇条」');
  await editOf(5, find(5, n => n.t === '後'), '。後');
  // 断らない型：コード（言語名なし）・インデントのコードに記号なしの文字・行頭の太字に「
  await editOf(2, find(2, n => n.t.trim() === 'plain fence'), 'plain <fence> & *x*');
  await editOf(2, find(2, n => n.t.trim() === 'indented code'), 'indented code 2');
  await editOf(2, find(2, n => n.t === 'a < b && c'), 'a < b && c || d');
});

test('レビューで見つけた型（実 DOM で往復）：数式の出力は数えない／--- ・& ・\\ ・ノートと同じ文（LF/CRLF）', async (t) => {
  if (!page) return t.skip(skipReason);
  for (const crlf of [false, true]) {
    const X = (x) => (crlf ? x.replace(/\n/g, '\r\n') : x);
    // math: katex の出力には「x」「AAA」というテキストノードがある。数えると本文の同じ語に当たって、式を直したつもりで本文が変わる
    const km = await loadDeck(X('---\nmarp: true\nmath: katex\n---\n\n数式 $x$ は x であり x\n\nAAA $AAA$ AAA\n\n$$\ny = ax\n$$\n\n後ろ y = ax\n'));
    assert.deepStrictEqual(km.nodes[0].map(n => n.t.trim()), ['数式', 'は x であり x', 'AAA', 'AAA', '後ろ y = ax']);
    const mj = await loadDeck(X('---\nmarp: true\n---\n\n数式 $x$ は x であり x\n'));
    assert.deepStrictEqual(mj.nodes[0].map(n => n.t.trim()), ['数式', 'は x であり x']);
    for (let k = 0; k < km.nodes[0].length; k++) {
      const r = await roundTrip(km, 0, k, km.nodes[0][k].t.trim() + '★検', 'exact');
      assert.ok(r.ok, `katex node ${k}: ${r.bad || r.refused}`);
    }
    const cases = [
      ['本文\n', 0, '---'], ['本文\n', 0, '- - -'], ['前\n次\n\n後\n', 1, '---'], ['前\n次\n\n後\n', 1, '==='],
      ['- a\n- b\n', 1, '---'], ['> 引用\n', 0, '---'], ['# 見出し\n', 0, '---'],
      ['A &\n', 0, 'A &lt;'], ['A &x amp; B\n', 0, 'A &amp; B'], ['<div>P & Q</div>\n', 0, 'P &amp; Q'], ['<div>P & Q</div>\n', 0, 'P &#38; Q'],
      ['C:\\\n', 0, 'C:\\!'], ['C:\\x.y\n', 0, 'C:\\.y'], ['C:\\dir\n', 0, 'C:\\*dir*'],
      ['<!-- 本文X -->\n\n本文X\n', 0, '直した'], ['<!--\n本文X\n-->\n本文X\n', 0, '直した'],
      ['```\n<!-- 本文X\n```\n\n本文X -->\n', 1, '直した'],
      ['<div>😀あ😀 と 𠮷野家</div>\n', 0, '😁あ😀 と 𩸽野家'], ['<div>&#x1F600;あ</div>\n', 0, '😀いあ'],
      ['10:30 開始\n', 0, '10:30:45 開始'],
    ];
    for (const [body, k, core] of cases) {
      const deck = await loadDeck(X(FM + body));
      const r = await roundTrip(deck, 0, k, core, 'exact');
      assert.ok(r.ok, `${crlf ? 'CRLF' : 'LF'} ${JSON.stringify(body)} → ${JSON.stringify(core)}: ${r.bad || r.refused}`);
      // 発表者ノート（コメント）の中には書いていない
      const out = SM.applyEdits(deck.src, r.plan.edits);
      if (body.startsWith('<!--')) assert.strictEqual((out.match(/<!--[^]*?-->/g) || []).join(), (deck.src.match(/<!--[^]*?-->/g) || []).join());
    }
    // frontmatter の無い 1 枚だけ・末尾改行なしの原稿
    const bare = await loadDeck(X('本文だけ'));
    const rb = await roundTrip(bare, 0, 0, '---', 'exact');
    assert.ok(rb.ok, rb.bad || rb.refused);
  }
});

// ===========================================================================
// 4. 実デック3本：特定率・往復・性能
// ===========================================================================
for (const d of DECKS) {
  test(`実デック ${d}: 特定率・等間隔 150 ノード以上の往復・locateNodes の時間`, { timeout: 600000 }, async (t) => {
    if (!page) return t.skip(skipReason);
    if (!fs.existsSync(deckPath(d))) return t.skip('デックが無い');
    const deck = await loadDeck(fs.readFileSync(deckPath(d), 'utf8'));
    // --- 特定率（インライン SVG の外で 99% 以上）と性能（1 回 50ms 以内） ---
    let n = 0, ok = 0, nSvg = 0, okSvg = 0, maxMs = 0, total = 0;
    const miss = [];
    deck.nodes.forEach((nodes, i) => {
      SM.locateNodes(deck.src, deck.ranges[i], nodes); // JIT を温める
      const t0 = process.hrtime.bigint();
      const locs = SM.locateNodes(deck.src, deck.ranges[i], nodes);
      maxMs = Math.max(maxMs, Number(process.hrtime.bigint() - t0) / 1e6);
      nodes.forEach((nd, k) => {
        total++;
        if (nd.svg) { nSvg++; if (locs[k]) okSvg++; } else { n++; if (locs[k]) ok++; }
        if (!locs[k]) miss.push(`slide ${i} node ${k} ${JSON.stringify(nd.t.trim().slice(0, 30))} near=${JSON.stringify(nd.near)} svg=${nd.svg}`);
        else {
          // 見つけた位置の原稿は、表示の文字そのもの（encoded でなければ）
          const seg = deck.src.slice(locs[k].start, locs[k].end);
          if (!locs[k].encoded) assert.strictEqual(seg, nd.t.trim());
        }
      });
    });
    t.diagnostic(`${deck.chunks.length} 枚・ノード ${total}：SVG 外 ${ok}/${n}・SVG 内 ${okSvg}/${nSvg}・locateNodes 最大 ${maxMs.toFixed(2)}ms/枚`);
    for (const m of miss) t.diagnostic('特定できず: ' + m);
    assert.ok(n === 0 || ok / n >= 0.99, `SVG 外の特定率 ${ok}/${n}`);
    assert.ok(maxMs < 50, `locateNodes ${maxMs}ms`);

    // --- 往復：等間隔に 150 ノード以上を「元の文字列＋★検」に ---
    const stride = Math.max(1, Math.floor(total / 150));
    const { bad, summary } = await propertyRun(t, deck, ['append'], stride);
    const tried = summary.append.ok + Object.values(summary.append.refused).reduce((a, b) => a + b, 0);
    assert.deepStrictEqual(bad, []);
    assert.ok(tried >= Math.min(150, total), `試したノード ${tried}`);
    assert.ok(summary.append.ok / tried >= 0.95, '書けた割合');
    // --- 記号の入力・先頭への挿入・全消去も、間隔を広げて ---
    const r2 = await propertyRun(t, deck, ['special', 'specialHead', 'punct', 'delLast', 'empty'], stride * 4 + 1);
    assert.deepStrictEqual(r2.bad, []);
  });
}
