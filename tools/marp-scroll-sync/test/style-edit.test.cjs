// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// lib/style-edit.cjs の検証（DESIGN.md 9.2 / 9.3）。実行: node --test tools/marp-scroll-sync/test/style-edit.test.cjs
//
// いちばん大事なのは「往復」：編集を当てた原稿を marp-core で描き直したとき、
//   (a) 発表者ノートが増えない (b) 枚数が変わらない (c) 対象の開始タグだけが変わり、ほかは 1 バイトも変わらない。
// ブラウザは使わない（描画結果の HTML を source-map.cjs の eachOpenTag で読む）。実デックは読むだけ。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '..');
const ROOT = path.resolve(EXT, '..', '..');
const SM = require(path.join(EXT, 'lib', 'source-map.cjs'));
const { planStyleEdit, mergeStyleValue, splitDecls } = require(path.join(EXT, 'lib', 'style-edit.cjs'));
const { slideStartLines } = require(path.join(EXT, 'lib', 'slide-split.cjs'));
const { Marp } = require(path.join(EXT, 'node_modules', '@marp-team', 'marp-core'));

const deckPath = (d) => path.join(ROOT, 'slides', d, d + '.md');
const LEC = 'sample-lecture';   // QR の見本スライド（index 3）と 80 枚への水増しに使う
const PARTS = 'sample-parts';   // HTML の部品が多い見本

// ---- 描画（extension.js の renderDeck と同じ条件：html:true、theme/*.css を academic.css 先頭で全部） ----
const THEMES = (() => {
  const dir = path.join(ROOT, 'theme');
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.css')); } catch (_) { /* テーマ無しでも動く */ }
  names.sort((a, b) => (a === 'academic.css' ? -1 : b === 'academic.css' ? 1 : a.localeCompare(b)));
  return names.map(n => fs.readFileSync(path.join(dir, n), 'utf8'));
})();
let MARP = null;
function render(src) {
  if (!MARP) {
    MARP = new Marp({ html: true });
    SM.attachLineInfo(MARP);
    for (const css of THEMES) { try { MARP.themeSet.add(css); } catch (_) { /* 任意 */ } }
  }
  const r = MARP.render(src);
  return { html: r.html.replace(/data-marpit-scope-[A-Za-z0-9_-]+/g, 'data-marpit-scope-X'), comments: r.comments };
}
function openTags(html) {
  const out = [];
  SM.eachOpenTag(html, 0, (tag, lt) => { out.push({ lt, end: tag.end, name: tag.name.toLowerCase(), text: html.slice(lt, tag.end) }); });
  return out;
}
function slideRanges(src) {
  const starts = slideStartLines(src);
  const lineCount = src.split('\n').length;
  return starts.map((s, i) => [s, starts[i + 1] !== undefined ? starts[i + 1] : lineCount]);
}
const styleOf = (tagText) => { const m = /\sstyle=(?:"([^"]*)"|'([^']*)')/i.exec(tagText); return m ? (m[1] !== undefined ? m[1] : m[2]) : ''; };

/** 描画結果から、スライドの範囲にある data-hline つきの要素を target の形で列挙する（Webview がやる数え方と同じ：同じ hline の中の DOM 順） */
function htmlTargets(html, range) {
  const seen = new Map();
  const out = [];
  for (const t of openTags(html)) {
    const m = /\sdata-hline="(\d+)"/.exec(t.text);
    if (!m) continue;
    const hline = Number(m[1]);
    const nth = seen.get(hline) || 0;
    seen.set(hline, nth + 1);
    if (hline >= range[0] && hline < range[1]) out.push({ kind: 'html', hline, nth, tag: t.name });
  }
  return out;
}

/** 往復の検算。戻り値は編集後の対象タグの字句 */
function assertRoundTrip(src, before, target, plan, label) {
  const after = render(SM.applyEdits(src, plan.edits));
  assert.deepStrictEqual(after.comments, before.comments, label + ': 発表者ノートが変わった');
  const A = openTags(before.html), B = openTags(after.html);
  assert.strictEqual(B.length, A.length, label + ': 要素の数が変わった');
  // 対象＝同じ data-hline の nth 番目
  let k = -1, c = 0;
  for (let i = 0; i < A.length; i++) {
    const m = /\sdata-hline="(\d+)"/.exec(A[i].text);
    if (m && Number(m[1]) === target.hline) { if (c === target.nth) { k = i; break; } c++; }
  }
  assert.ok(k >= 0, label + ': 描画結果に対象が無い');
  assert.strictEqual(A[k].name, target.tag.toLowerCase(), label);
  // 対象の開始タグを抜いた残りは 1 バイトも変わらない
  const restA = before.html.slice(0, A[k].lt) + before.html.slice(A[k].end);
  const restB = after.html.slice(0, B[k].lt) + after.html.slice(B[k].end);
  assert.ok(restA === restB, label + ': 対象以外が変わった');
  // 対象は style だけが変わる
  const strip = (t) => t.replace(/\sstyle=("[^"]*"|'[^']*')/i, '');
  assert.strictEqual(strip(B[k].text), strip(A[k].text), label + ': style 以外の属性が変わった');
  return B[k].text;
}

const wrap = (body) => '---\nmarp: true\n---\n\n# 1\n\n---\n\n' + body + '\n\n---\n\n# 3\n';
const rangeOf = (src, idx) => slideRanges(src)[idx];
const lineOfStr = (src, needle) => src.slice(0, src.indexOf(needle)).split('\n').length - 1;
function plan1(src, needle, nth, tag, style) {
  return planStyleEdit(src, rangeOf(src, 1), { kind: 'html', hline: lineOfStr(src, needle), nth, tag }, style);
}

// ---------------------------------------------------------------------------
test('style の値のマージ：字句と順序を保つ・二重にしない・消す', () => {
  const st = (o) => ({ translate: undefined, width: undefined, height: undefined, ...o });
  assert.strictEqual(mergeStyleValue('', st({ translate: '12px -8px' }), false), 'translate: 12px -8px');
  assert.strictEqual(mergeStyleValue('color:red', st({ width: '200px' }), false), 'color:red;width:200px');
  assert.strictEqual(mergeStyleValue('color: red;', st({ width: '200px', height: '100px' }), false), 'color: red; width: 200px; height: 100px;');
  assert.strictEqual(mergeStyleValue('width:10px;color:red;WIDTH:30px', st({ width: '200px' }), false), 'width:200px;color:red');
  assert.strictEqual(mergeStyleValue('color: red; width: 10px', st({ width: null }), false), 'color: red');
  assert.strictEqual(mergeStyleValue(' width: 10px ; ', st({ width: null }), false), '');
  assert.strictEqual(mergeStyleValue('color: red', st({ width: '5px' }), true), 'color: red; width: 5px !important');
  // ; で割ってはいけない所
  const tricky = "background: url(data:image/png;base64,AA;BB) /* a;b */; content: ';'; font-family: &quot;A;B&quot;";
  assert.deepStrictEqual(splitDecls(tricky).length, 3);
  assert.strictEqual(mergeStyleValue(tricky, st({ translate: '1px 2px' }), false), tricky + '; translate: 1px 2px');
  assert.strictEqual(mergeStyleValue(tricky + '; translate: 1px 2px', st({ translate: null }), false), tricky);
  // 改行で並べた style は、その並べ方に合わせる
  assert.strictEqual(mergeStyleValue('color: red;\n  margin: 0', st({ width: '9px' }), false), 'color: red;\n  margin: 0;\n  width: 9px');
  // width を含む別のプロパティには触らない
  assert.strictEqual(mergeStyleValue('max-width: 10px; border-width: 2px', st({ width: '7px' }), false), 'max-width: 10px; border-width: 2px; width: 7px');
});

test('html：同じ行の開始タグを injectHlines と同じ数え方で数える', () => {
  const body = [
    '<!-- <div class="x"> コメントの中の div は数えない -->',
    '<style scoped>',
    ' .a > b { color: red } /* <div> */',
    '',
    ' .c { }',
    '</style>',
    '',
    '<div class="row" title="a > <b> c">',
    '<div class="sq-url"><a href="https://example.com/?a=1&b=2">日本語😀<br>x</a></div><img src="./q.png" alt="QR" />',
    '<IMG src=a/b.png',
    '     ALT="x"',
    '>',
    '<p STYLE=\'color: red\'>t</p>',
    '</div>',
  ].join('\n');
  for (const eol of ['\n', '\r\n']) {
    const src = wrap(body).split('\n').join(eol);
    const before = render(src);
    const range = rangeOf(src, 1);
    const targets = htmlTargets(before.html, range);
    assert.deepStrictEqual(targets.map(t => t.tag + t.nth), ['div0', 'div0', 'a1', 'br2', 'img3', 'img0', 'p0']);
    for (const t of targets) {
      const plan = planStyleEdit(src, range, t, { translate: [12.4, -8], width: 200, height: 150.6 });
      assert.ok(plan.ok, eol.length + ' ' + JSON.stringify(t) + ' ' + plan.reason);
      assert.strictEqual(plan.line, t.hline);
      const tagText = assertRoundTrip(src, before, t, plan, t.tag + t.nth);
      assert.match(styleOf(tagText), /translate: 12px -8px; width: 200px; height: 151px$/);
      // 2 回当てても二重にならない
      const src2 = SM.applyEdits(src, plan.edits);
      const again = planStyleEdit(src2, range, t, { translate: [12.4, -8], width: 200, height: 150.6 });
      assert.ok(again.ok); assert.deepStrictEqual(again.edits, []);
      const moved = planStyleEdit(src2, range, t, { translate: [1, 2] });
      const src3 = SM.applyEdits(src2, moved.edits);
      assert.strictEqual(src3.split('translate').length, src2.split('translate').length);
      // reset で元の原稿に戻る
      const reset = planStyleEdit(src3, range, t, { translate: null, width: null, height: null });
      assert.ok(reset.ok);
      assert.strictEqual(SM.applyEdits(src3, reset.edits), src, 'reset ' + t.tag + t.nth);
    }
  }
});

test('html：書く場所と書き方', () => {
  let src = wrap('<div class="a">\n<img src="./q.png" />\n<img src=x/>\n<br>\n</div>');
  let p = plan1(src, '<img src="./q', 0, 'img', { width: 10, height: 10 });
  assert.ok(SM.applyEdits(src, p.edits).includes('<img src="./q.png" style="width: 10px; height: 10px" />'));
  p = plan1(src, '<img src=x', 0, 'img', { width: 10 }); // 引用符なしの値の / は値の一部
  assert.ok(SM.applyEdits(src, p.edits).includes('<img src=x/ style="width: 10px">'));
  p = plan1(src, '<br>', 0, 'br', { translate: [0, 0] });
  assert.ok(p.ok); assert.deepStrictEqual(p.edits, []); // 0,0 は書かない
  p = plan1(src, '<br>', 0, 'br', { translate: [-0.2, 3], important: true });
  assert.ok(SM.applyEdits(src, p.edits).includes('<br style="translate: 0px 3px !important">'));

  // 既存の style：' の引用符・大文字・引用符なし
  src = wrap('<div class="a">\n<p STYLE=\'font-family: "A B"; color: red\'>x</p>\n<p style=color:red>y</p>\n<p style="translate: 3px 4px">z</p>\n<p class="k"\n   style="width: 5px"\n   id="i">w</p>\n</div>');
  p = plan1(src, '<p STYLE', 0, 'p', { width: 30 });
  assert.ok(SM.applyEdits(src, p.edits).includes('<p STYLE=\'font-family: "A B"; color: red; width: 30px\'>x</p>'));
  p = plan1(src, '<p style=color', 0, 'p', { width: 30 });
  assert.ok(SM.applyEdits(src, p.edits).includes('<p style="color:red;width:30px">y</p>'));
  p = plan1(src, '<p style="translate', 0, 'p', { translate: [0, 0] });
  assert.ok(SM.applyEdits(src, p.edits).includes('\n<p>z</p>\n')); // 宣言が無くなったら属性ごと（前の空白も 1 つ）
  p = plan1(src, '<p class="k"', 0, 'p', { width: null }); // 複数行の開始タグ。属性が載っていた行の改行ごと消える
  assert.ok(SM.applyEdits(src, p.edits).includes('<p class="k"\n   id="i">w</p>'));
  p = plan1(src, '<p class="k"', 0, 'p', { height: 8 });
  assert.ok(SM.applyEdits(src, p.edits).includes('   style="width: 5px; height: 8px"\n'));
});

test('html：書かない場合', () => {
  const src = wrap('<div class="a">\n<span>x</span>\n</div>\n\n```html\n<div class="in-fence">\n```');
  const range = rangeOf(src, 1);
  const L = lineOfStr(src, '<span>');
  const r = (t, st) => planStyleEdit(src, range, t, st === undefined ? { width: 10 } : st);
  assert.strictEqual(r({ kind: 'html', hline: L, nth: 0, tag: 'div' }).reason, 'tag-mismatch');
  assert.strictEqual(r({ kind: 'html', hline: L, nth: 1, tag: 'span' }).reason, 'tag-not-found');
  assert.strictEqual(r({ kind: 'html', hline: 4, nth: 0, tag: 'h1' }).reason, 'out-of-slide');
  assert.strictEqual(r({ kind: 'html', hline: 9999, nth: 0, tag: 'div' }).reason, 'out-of-slide');
  assert.strictEqual(r({ kind: 'html', hline: L, nth: 0, tag: 'span' }, { width: 'big' }).reason, 'bad-style');
  assert.strictEqual(r({ kind: 'html', hline: L, nth: 0, tag: 'span' }, { translate: [1] }).reason, 'bad-style');
  assert.strictEqual(r({ kind: 'svg', hline: L }).ok, false);
  for (const bad of [null, undefined, 3, 'x']) assert.strictEqual(planStyleEdit(src, range, bad, { width: 1 }).ok, false);
  assert.strictEqual(planStyleEdit(null, range, { kind: 'html', hline: L, nth: 0, tag: 'span' }, { width: 1 }).ok, false);
  assert.strictEqual(planStyleEdit(src, range, { kind: 'html', hline: L, nth: 0, tag: 'span' }, null).ok, false);

  // 空行を含むコメントの中から数え始めてしまう書き方は、2 通りの数え方が食い違うので書かない
  const src2 = wrap('<!-- メモ\n\n<div class="ghost"> --><div class="real">x</div>');
  const p = planStyleEdit(src2, rangeOf(src2, 1), { kind: 'html', hline: lineOfStr(src2, '<div class="ghost">'), nth: 0, tag: 'div' }, { width: 10 });
  assert.strictEqual(p.ok, false); assert.strictEqual(p.reason, 'ambiguous');
});

test('mdimg：alt のキーワードだけを差し替える・足す・消す', () => {
  const body = '説明 `![x](no.png)` と ![図 w:100 drop-shadow](./src/a.png "題 (1)") と\n![](<./src/b c.png>) ![bg right](./bg.png) ![参照][r] ![日本語😀 height:40px](./src/c(1).png)\n\n[r]: ./r.png';
  for (const eol of ['\n', '\r\n']) {
    const src = wrap(body).split('\n').join(eol);
    const range = rangeOf(src, 1);
    const line = lineOfStr(src, '説明');
    const go = (nth, s, style) => planStyleEdit(src, range, { kind: 'mdimg', line, nth, src: s }, style);
    const before = render(src);
    const check = (p, expectIn) => {
      assert.ok(p.ok, p.reason);
      const out = SM.applyEdits(src, p.edits);
      assert.ok(out.includes(expectIn), out);
      const after = render(out);
      assert.deepStrictEqual(after.comments, before.comments);
      assert.strictEqual(openTags(after.html).length, openTags(before.html).length);
      return out;
    };
    check(go(0, './src/a.png', { width: 320, height: 200 }), '![図 w:320px drop-shadow h:200px](./src/a.png "題 (1)")');
    check(go(0, 'https://file+.vscode-resource.vscode-cdn.net/x/slides/d/src/a.png', { width: null }), '![図 drop-shadow](./src/a.png');
    const out = check(go(1, './src/b%20c.png', { width: 50.4 }), '![w:50px](<./src/b c.png>)');
    assert.strictEqual(go(1, './src/b c.png', { width: 50.4 }).line, line + 1);
    // 足して消すと元に戻る
    const back = planStyleEdit(out, range, { kind: 'mdimg', line, nth: 1, src: './src/b c.png' }, { translate: null, width: null, height: null });
    assert.strictEqual(SM.applyEdits(out, back.edits), src);
    // bg は数えない → 2 番目は参照形式、3 番目が c(1).png
    assert.strictEqual(go(2, './r.png', { width: 10 }).reason, 'mdimg-ref');
    check(go(3, './src/c(1).png', { height: 80 }), '![日本語😀 height:80px](./src/c(1).png)');
    assert.strictEqual(go(3, './src/zzz.png', { height: 80 }).reason, 'src-mismatch');
    assert.strictEqual(go(0, './src/a.png', { translate: [3, 0], width: 10 }).reason, 'mdimg-move');
    assert.strictEqual(go(9, './src/a.png', { width: 10 }).reason, 'img-not-found');
    // 描画結果：w/h が style になっている（Marp の書式として効いている）
    const html = render(SM.applyEdits(src, go(0, './src/a.png', { width: 320, height: 200 }).edits)).html;
    assert.match(html, /<img src="\.\/src\/a\.png"[^>]*style="width:320px;height:200px;/);
  }
});



// ---------------------------------------------------------------------------
// 実デック（読むだけ）
// ---------------------------------------------------------------------------
function realDeck(name, slideIdxs, mustContain) {
  const file = deckPath(name);
  if (!fs.existsSync(file)) return { skip: 'デックが無い: ' + name };
  const src = fs.readFileSync(file, 'utf8');
  const before = render(src);
  const ranges = slideRanges(src);
  assert.strictEqual(before.comments.length, ranges.length, '枚数の数え方が marp と合わない');
  const stat = { ok: 0, refused: {}, total: 0 };
  for (const idx of slideIdxs) {
    const range = ranges[idx];
    const targets = htmlTargets(before.html, range);
    for (const t of targets) {
      stat.total++;
      const style = { translate: [40, -12], width: 200, height: 200 };
      const plan = planStyleEdit(src, range, t, style);
      if (!plan.ok) { stat.refused[plan.reason] = (stat.refused[plan.reason] || 0) + 1; continue; }
      stat.ok++;
      const tagText = assertRoundTrip(src, before, t, plan, name + ' #' + (idx + 1) + ' ' + t.tag + '@' + t.hline + '/' + t.nth);
      const sty = styleOf(tagText);
      assert.match(sty, /translate: ?40px -12px/); assert.match(sty, /width: ?200px/); assert.match(sty, /height: ?200px/);
      const src2 = SM.applyEdits(src, plan.edits);
      assert.deepStrictEqual(planStyleEdit(src2, range, t, style).edits, [], '2 回目は変更なし');
      // style 属性が無かった要素（＝編集が挿入だけ）は、reset で完全に元へ戻る
      if (plan.edits.length === 1 && plan.edits[0].start === plan.edits[0].end) {
        const reset = planStyleEdit(src2, range, t, { translate: null, width: null, height: null });
        assert.strictEqual(SM.applyEdits(src2, reset.edits), src, 'reset で戻らない');
      }
    }
  }
  if (mustContain) mustContain(src, before, ranges);
  return stat;
}

test('見本デック：sample-lecture の QR スライド（QR を大きくして右へ）', (t) => {
  const stat = realDeck(LEC, [3], (src, before, ranges) => {
    const range = ranges[3];
    const hline = lineOfStr(src, '<img src="./src/slido-qr-sample.png"');
    const target = { kind: 'html', hline, nth: 0, tag: 'img' };
    const plan = planStyleEdit(src, range, target, { translate: [60, 0], width: 180, height: 180, important: true });
    assert.ok(plan.ok, plan.reason);
    const out = SM.applyEdits(src, plan.edits);
    assert.ok(out.includes('<img src="./src/slido-qr-sample.png" alt="参加用 QR" width="150" style="translate: 60px 0px !important; width: 180px !important; height: 180px !important">'), out.split('\n').find(l => l.includes('slido-qr-sample')));
    assertRoundTrip(src, before, target, plan, 'QR');
    const reset = planStyleEdit(out, range, target, { translate: null, width: null, height: null });
    assert.strictEqual(SM.applyEdits(out, reset.edits), src);
    // 開始タグが複数ある行：<div class="sq-url"><a …>…<br>
    const L = lineOfStr(src, '<div class="sq-url"><a ');
    const names = ['div', 'a', 'br'];
    names.forEach((tag, nth) => {
      const p = planStyleEdit(src, range, { kind: 'html', hline: L, nth, tag }, { translate: [5, 5] });
      assert.ok(p.ok, tag + ' ' + p.reason);
      assertRoundTrip(src, before, { kind: 'html', hline: L, nth, tag }, p, 'sq-url ' + tag);
      assert.strictEqual(planStyleEdit(src, range, { kind: 'html', hline: L, nth, tag: 'section' }, { translate: [5, 5] }).reason, 'tag-mismatch');
    });
  });
  if (stat.skip) return t.skip(stat.skip);
  t.diagnostic('sample-lecture #4: ' + JSON.stringify(stat));
  assert.ok(stat.total >= 8 && stat.ok === stat.total, JSON.stringify(stat));   // 見本の QR スライドは HTML 要素 9 個
});

test('見本デック：sample-parts の数枚', (t) => {
  const stat = realDeck(PARTS, [1, 2, 3, 4, 5]);
  if (stat.skip) return t.skip(stat.skip);
  t.diagnostic('sample-parts #2-6: ' + JSON.stringify(stat));
  assert.ok(stat.total > 10 && stat.ok === stat.total, JSON.stringify(stat));
});

test('速さ：80 枚のデックで 1 回 5ms 以内', (t) => {
  const file = deckPath(LEC);
  let src;
  if (fs.existsSync(file)) {
    src = fs.readFileSync(file, 'utf8');
    const one = src.slice(src.indexOf('\n---\n', src.indexOf('\n---\n', 4) + 5)); // frontmatter の後ろ（スライドの並び）
    while (slideStartLines(src).length < 80) src += '\n' + one;
  } else {
    src = '---\nmarp: true\n---\n' + Array.from({ length: 80 }, (_, i) => '\n# ' + i + '\n\n<div class="a">\n<img src="./q.png">\n</div>\n').join('\n---\n');
  }
  const ranges = slideRanges(src);
  assert.ok(ranges.length >= 80);
  // 最後のスライドのいちばん後ろの img（無ければ div）
  const idx = ranges.length - 1;
  const lines = src.split('\n');
  let target = null;
  for (let l = ranges[idx][1] - 1; l >= ranges[idx][0] && !target; l--) {
    const m = /^<(img|div)[\s>]/.exec(lines[l] || '');
    if (m) target = { kind: 'html', hline: l, nth: 0, tag: m[1] };
  }
  assert.ok(target);
  const style = { translate: [10, 20], width: 300, height: 300 };
  for (let i = 0; i < 20; i++) planStyleEdit(src, ranges[idx], target, style); // 暖機
  const N = 200;
  const t0 = process.hrtime.bigint();
  let p;
  for (let i = 0; i < N; i++) p = planStyleEdit(src, ranges[idx], target, style);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  assert.ok(p.ok, p.reason);
  t.diagnostic('planStyleEdit: ' + ms.toFixed(3) + ' ms/回（' + ranges.length + ' 枚・' + src.length + ' 文字）');
  assert.ok(ms < 5, ms + ' ms');
});
