// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// lib/layout-variants.cjs（配置案・DESIGN.md 8.3）のテスト。純粋関数だけ（ブラウザ不要）。
//   node --test --test-reporter=tap test/layout-variants.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '..');
const REPO = path.resolve(EXT, '..', '..');
const lv = require(path.join(EXT, 'lib', 'layout-variants.cjs'));
const { applyEdits } = require(path.join(EXT, 'lib', 'slide-ops.cjs'));
const { slideStartLines } = require(path.join(EXT, 'lib', 'slide-split.cjs'));

const clsOf = (vs) => vs.map((v) => v.cls);
const FM = '---\nmarp: true\ntheme: tsutawaru-academic\n---\n\n';

const THREE = '## 題\n\n- **一つめ**\n  説明です。\n- **二つめ**\n  説明です。\n- **三つめ**\n  説明です。\n';
const FOUR = THREE + '- **四つめ**\n  説明です。\n';
const FIVE = FOUR + '- **五つめ**\n  説明です。\n';
const STEPS = '## 手順\n\n1. はじめにこれをします\n2. つぎにこれをします\n3. 最後にこれをします\n';
const FIG = '## 図\n\n![w:700 図の説明](./src/fig01-x.png)\n\n- 一つめの説明\n- 二つめの説明\n';
const LEAD = '<div class="page-title">要点</div>\n\n## 伝えたいこと\n\n原稿を書き換えずに、並べ方だけを試せます。\n';

test('表：8〜14 個・名前は lay-*・テーマ §14 に CSS がある', () => {
  assert.ok(lv.LAYOUTS.length >= 8 && lv.LAYOUTS.length <= 14, String(lv.LAYOUTS.length));
  const css = fs.readFileSync(path.join(REPO, 'theme', 'tsutawaru-academic.css'), 'utf8');
  const sec14 = css.slice(css.indexOf('14. 配置クラス'));
  assert.ok(sec14.length > 100, '§14 がある');
  const seen = new Set();
  for (const v of lv.LAYOUTS) {
    assert.match(v.cls, lv.LAY_RE);
    assert.ok(!seen.has(v.cls), '重複なし ' + v.cls); seen.add(v.cls);
    assert.ok(new RegExp('\\.' + v.cls + '\\b').test(sec14), '§14 に ' + v.cls);
    assert.ok(v.label && v.why && v.when, v.cls);
  }
  // §14 の外（既存の行）に lay-* は無い
  assert.ok(!/\.lay-[a-z]/.test(css.slice(0, css.indexOf('14. 配置クラス'))));
});

test('docs/design-rules.md に英語・日本語の節があり、why に書籍のページ番号を含まない', () => {
  const doc = fs.readFileSync(path.join(REPO, 'docs', 'design-rules.md'), 'utf8');
  const cut = doc.search(/^# デザインのルール/m);
  assert.ok(cut > 0, 'docs/design-rules.md に日本語の節（# デザインのルール）がある');
  for (const v of lv.LAYOUTS.concat([lv.BASE])) {
    assert.ok(v.why && !/p\.\d+/.test(v.why), `${v.cls}: why にページ番号を含まない`);
  }
});

test('analyzeSlide：素の構造を読む', () => {
  let a = lv.analyzeSlide(THREE);
  assert.deepStrictEqual([a.plain, a.lists, a.items, a.hasStrongHead, a.headBreak, a.ordered, a.figures], [true, 1, 3, true, true, false, 0]);
  assert.strictEqual(a.title, '題');
  a = lv.analyzeSlide(STEPS);
  assert.deepStrictEqual([a.items, a.ordered], [3, true]);
  a = lv.analyzeSlide('## 題\n\n- ① 集める\n- ② 読む\n- ③ まとめる\n');
  assert.strictEqual(a.ordered, true, '①②③ で始まる項目は順序あり');
  a = lv.analyzeSlide(FIG);
  assert.deepStrictEqual([a.plain, a.figures, a.items], [true, 1, 2]);
  a = lv.analyzeSlide('## 題\n\n<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>\n\n説明の段落です。\n');
  assert.deepStrictEqual([a.plain, a.figures, a.paragraphs], [true, 1, 1]);
  a = lv.analyzeSlide(LEAD + '\n<div class="takeaway">帯</div>\n');
  assert.deepStrictEqual([a.plain, a.paragraphs, a.lists, a.hasTakeaway, a.textChars], [true, 1, 0, true, 21]);
  a = lv.analyzeSlide('<!-- _class: vcenter lay-cards3 -->\n\n' + THREE);
  assert.deepStrictEqual([a.layout, a.classes], ['lay-cards3', ['vcenter', 'lay-cards3']]);
});

test('analyzeSlide：素の構造でないもの', () => {
  assert.deepStrictEqual(pick(lv.analyzeSlide('## 題\n\n<div class="tcols">\n<div>\n\n- a\n\n</div>\n</div>\n')), [false, 'div']);
  assert.deepStrictEqual(pick(lv.analyzeSlide('<!-- _class: split -->\n\n## 題\n\n- a\n- b\n')), [false, 'pattern']);
  assert.deepStrictEqual(pick(lv.analyzeSlide('## 題\n\n```js\nconst a = 1;\n```\n')), [false, 'code']);
  assert.deepStrictEqual(pick(lv.analyzeSlide('## 題だけ\n')), [false, 'empty']);
  // 文中のタグ（<b> <span>）は div 扱いにしない
  assert.strictEqual(lv.analyzeSlide('## 題\n\n<b>太字</b>で始まる段落です。\n').plain, true);
  // コメントの中の div は数えない
  assert.strictEqual(lv.analyzeSlide('<!--\n<div class="x">\n-->\n\n' + THREE).plain, true);
  function pick(a) { return [a.plain, a.reason]; }
});

test('analyzeSlide：包み（.body）は透過し、出典の行（attr / cite / src-row）は数えない', () => {
  const pick = (a) => [a.plain, a.reason, a.wrapped];
  const of = (md) => clsOf(lv.variantsFor(lv.analyzeSlide(md)));
  // .body の中の素の Markdown で判定する
  const wrapped = '## 題\n\n<div class="body">\n\n- **一**\n  説明\n- **二**\n  説明\n- **三**\n  説明\n\n</div>\n\n<div class="takeaway">帯</div>\n';
  assert.deepStrictEqual(pick(lv.analyzeSlide(wrapped)), [true, null, true]);
  assert.deepStrictEqual(of(wrapped), [null, 'lay-boxed', 'lay-cards3', 'lay-keyrow']);
  assert.strictEqual(lv.analyzeSlide(wrapped.replace('class="body"', 'class="body vcenter"')).plain, true, '縦配分の語は可');
  // 透過しない包み：ほかのクラス・style・中が Markdown として読まれない書き方（開きタグの次が空行でない）・入れ子の div
  assert.deepStrictEqual(pick(lv.analyzeSlide(wrapped.replace('class="body"', 'class="body figwrap"'))), [false, 'div', false]);
  assert.deepStrictEqual(pick(lv.analyzeSlide(wrapped.replace('class="body"', 'class="body" style="width:900px"'))), [false, 'div', false]);
  assert.strictEqual(lv.analyzeSlide('## 題\n\n<div class="body">\n- a\n- b\n</div>\n').plain, false, '空行なし＝中は HTML のまま');
  assert.strictEqual(lv.analyzeSlide('## 題\n\n<div class="body">\n\n<div class="tcols">\n\n- a\n\n</div>\n\n</div>\n').plain, false, '中に div があれば不可');
  assert.strictEqual(lv.analyzeSlide('## 題\n\n<div class="body">\n\n<div class="body">\n\n- a\n- b\n\n</div>\n\n</div>\n').plain, false, '二重の包みは透過しない');
  // 出典の行
  const fig = '## 図\n\n![](./src/a.png)\n<div class="attr">出典：<a href="https://example.org">例</a></div>\n';
  assert.deepStrictEqual(pick(lv.analyzeSlide(fig)), [true, null, false], '画像の直後の行の attr（空行なし）も図として数える');
  assert.deepStrictEqual(of(fig), [null, 'lay-fig-top', 'lay-fig-only'], '出典は文に数えない');
  assert.deepStrictEqual(of('## 題\n\n- a\n- b\n- c\n\n<div class="cite">著者（2024）. 書名.</div>\n'), [null, 'lay-boxed', 'lay-cards3', 'lay-keyrow', 'lay-points']);
  const srcRow = '## 題\n\n- a\n- b\n\n<div class="src-row"><p class="note">注記</p>\n<div class="chips"><a class="fill tight" href="https://example.org">PDF</a></div>\n</div>\n\n<div class="takeaway">帯</div>\n';
  const a = lv.analyzeSlide(srcRow);
  assert.deepStrictEqual([a.plain, a.items, a.hasTakeaway], [true, 2, true], '入れ子の div を持つ src-row も丸ごと読み飛ばす');
  // .body の中の attr
  assert.deepStrictEqual(of('## 図\n\n<div class="body">\n\n![](./src/a.png)\n\n<div class="attr">出典：例</div>\n\n- 説明\n\n</div>\n'), [null, 'lay-fig-right', 'lay-fig-left', 'lay-fig-top']);
  const t = lv.browserTable();
  assert.deepStrictEqual([t.sideClasses, t.wrapClass, t.wrapExtra], [lv.SIDE_CLASSES, 'body', ['vtop', 'vcenter', 'vspread']]);
});

test('analyzeSlide：スライド内の <style> は数えない・HTML の <p> は段落、<p><img></p> は図（ブラウザ側と同じ）', () => {
  const pick = (a) => [a.plain, a.reason, a.figures, a.paragraphs, a.lists, a.items];
  const of = (md) => clsOf(lv.variantsFor(lv.analyzeSlide(md)));
  // <style scoped> はブラウザ側でも section 直下の style として飛ばされる。原稿側も数えない
  const styled = '## 題\n\n<style scoped>\n  ul { color: red; }\n</style>\n\n- a\n- b\n- c\n';
  assert.deepStrictEqual(pick(lv.analyzeSlide(styled)), [true, null, 0, 0, 1, 3]);
  assert.deepStrictEqual(of(styled), of('## 題\n\n- a\n- b\n- c\n'));
  // HTML で書いた段落は段落として数える
  assert.deepStrictEqual(pick(lv.analyzeSlide('## 題\n\n<p class="lead">大きな一文です。</p>\n')), [true, null, 0, 1, 0, 0]);
  // 画像のトリミング（Markdown の画像 → <p><img style="…"></p> への書き換え）の前後で、配置案は変わらない
  const md = '## 図\n\n![w:400 図](./src/a.png)\n\n- 説明\n';
  const html = '## 図\n\n<p><img src="./src/a.png" alt="図" style="width: 400px; clip-path: inset(0 0 0 30px); margin-left: -30px"></p>\n\n- 説明\n';
  assert.deepStrictEqual(pick(lv.analyzeSlide(html)), [true, null, 1, 0, 1, 1]);
  assert.deepStrictEqual(of(html), of(md));
  assert.deepStrictEqual(of(html), [null, 'lay-fig-right', 'lay-fig-left', 'lay-fig-top']);
});

test('variantsFor：デザイン規則で絞る', () => {
  const of = (md) => clsOf(lv.variantsFor(lv.analyzeSlide(md)));
  assert.deepStrictEqual(of(THREE), [null, 'lay-boxed', 'lay-cards3', 'lay-keyrow']);
  assert.deepStrictEqual(of(FOUR), [null, 'lay-cards2']);
  assert.deepStrictEqual(of(FIVE), [null], '5 項目を横に並べる案は出さない');
  assert.deepStrictEqual(of(STEPS), [null, 'lay-boxed', 'lay-cards3', 'lay-keyrow', 'lay-flow', 'lay-steps', 'lay-points']);
  const five = '## 手順\n\n1. a\n2. b\n3. c\n4. d\n5. e\n';
  assert.deepStrictEqual(of(five), [null, 'lay-steps', 'lay-points'], '5 つの手順は縦（番号つき／要点だけ）だけ');
  assert.deepStrictEqual(of(five + '6. f\n'), [null]);
  assert.deepStrictEqual(of(FIG), [null, 'lay-fig-right', 'lay-fig-left', 'lay-fig-top']);
  assert.deepStrictEqual(of('## 図\n\n![](./src/a.png)\n'), [null, 'lay-fig-top', 'lay-fig-only'], '文が無ければ左右の案は出さず、図だけの案が出る');
  assert.deepStrictEqual(of(LEAD), [null, 'lay-lead']);
  assert.deepStrictEqual(of('## 題\n\n' + 'あ'.repeat(80) + '\n'), [null], '長い段落に lead は出さない');
  assert.deepStrictEqual(of('## 題\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- x\n- y\n- z\n'), [null], '表があれば案なし');
  assert.deepStrictEqual(of('## 題\n\n- a\n  - a1\n- b\n- c\n'), [null], '入れ子の箇条書きには出さない');
  assert.deepStrictEqual(of('## 題\n\n<div class="grid3">\n</div>\n'), [], '素の構造でなければ空');
  // 長い項目はカード・列に入れない
  const long = '## 題\n\n' + [1, 2, 3].map((n) => `- **見出し${n}**\n  ${'長い説明'.repeat(18)}`).join('\n') + '\n';
  assert.deepStrictEqual(of(long), [null, 'lay-boxed']);
  // 要点だけ（lay-points）：1行1要点の短い項目 2〜5 行。見出し＋説明の形・6 行以上・長い項目・図つきには出さない
  const pts = '## 題\n\n- 原稿は素の Markdown で書く\n- 配置は _class の1語で決める\n- 横に並べるのは3つまで\n- 図があれば文と左右に分ける\n- はみ出す案には印が付く\n';
  assert.deepStrictEqual(of(pts), [null, 'lay-points'], '順序が無いので手順の案は出ない');
  assert.deepStrictEqual(of(pts + '- 六つめの要点\n'), [null], '6 行には出さない');
  assert.deepStrictEqual(of(pts.replace('- はみ出す案には印が付く\n', '')), [null, 'lay-cards2', 'lay-points']);
  assert.ok(!of(THREE).includes('lay-points'), '見出し＋説明の形には出さない');
  assert.ok(!of('## 題\n\n- ' + 'あ'.repeat(41) + '\n- 短い\n').includes('lay-points'), '41 字の項目には出さない');
  assert.ok(!of(FIG).includes('lay-fig-only'), '文があれば図だけの案は出さない');
  assert.deepStrictEqual(of('<div class="page-title">図</div>\n\n![](./src/a.png)\n\n<div class="takeaway">帯</div>\n'), [null, 'lay-fig-top', 'lay-fig-only'], '見出しなし・図と帯だけ');
});

test('variantsFor：current と、条件に合わなくなった今の配置', () => {
  let vs = lv.variantsFor(lv.analyzeSlide(THREE));
  assert.strictEqual(vs[0].current, true);
  assert.ok(vs.every((v) => v.why && v.label));
  vs = lv.variantsFor(lv.analyzeSlide('<!-- _class: lay-cards3 -->\n\n' + FIVE));
  assert.deepStrictEqual(clsOf(vs), [null, 'lay-cards3']);
  assert.deepStrictEqual([vs[0].current, vs[1].current, vs[1].fits], [false, true, false]);
});

test('browserTable：JSON にできて、表と同じ中身', () => {
  const t = JSON.parse(JSON.stringify(lv.browserTable()));
  assert.deepStrictEqual(t.layouts.map((v) => v.cls), lv.LAYOUTS.map((v) => v.cls));
  assert.ok(new RegExp(t.orderHead, 'i').test('① 集める'));
  assert.ok(t.patternClasses.includes('split'));
  assert.strictEqual(t.notPlainText, 'このスライドは div で組んであるので、配置の切り替えは使えません');
});

// ───────────────────────── planSetLayout ─────────────────────────

function apply(text, index, cls) {
  const r = lv.planSetLayout(text, index, cls);
  assert.ok(r.ok, r.reason);
  assert.ok(r.edits.length <= 1, '1 操作＝1 置換');
  const after = applyEdits(text, r.edits);
  assert.strictEqual(slideStartLines(after).length, slideStartLines(text).length, '枚数は変わらない');
  return after;
}

test('planSetLayout：_class が無ければ 1 行形式で足す／差し替える／外すと元に戻る', () => {
  const md = FM + THREE + '\n---\n\n' + FOUR;
  const a1 = apply(md, 0, 'lay-cards3');
  assert.ok(a1.includes('---\n\n<!-- _class: lay-cards3 -->\n\n## 題'), a1);
  const a2 = apply(a1, 0, 'lay-keyrow');
  assert.ok(a2.includes('<!-- _class: lay-keyrow -->') && !a2.includes('lay-cards3'));
  const a3 = apply(a2, 0, null);
  assert.strictEqual(a3, md, '外すと 1 バイトも違わず元に戻る');
  // 2 枚目だけが変わる
  const b = apply(md, 1, 'lay-cards2');
  assert.strictEqual(b.indexOf('lay-cards2') > b.indexOf('\n---\n\n## 題\n\n- **一つめ**', 10), true);
  assert.strictEqual(lv.analyzeSlide(b.split('\n---\n')[2]).layout, 'lay-cards2');
  // 何も付いていないスライドから外す＝何もしない
  assert.deepStrictEqual(lv.planSetLayout(md, 0, null).edits, []);
  // 同じ配置をもう一度＝何もしない
  assert.deepStrictEqual(lv.planSetLayout(a1, 0, 'lay-cards3').edits, []);
});

test('planSetLayout：ほかのクラス・_lib の印・ほかのディレクティブを保つ', () => {
  const md = FM + '<!--\n_class: vcenter lay-boxed\n_lib: goal-3 | 目標, 箇条書き | 2026-09-20\n_paginate: false\n-->\n\n' + THREE;
  const a = apply(md, 0, 'lay-cards3');
  assert.ok(a.includes('<!--\n_class: vcenter lay-cards3\n_lib: goal-3 | 目標, 箇条書き | 2026-09-20\n_paginate: false\n-->'), a);
  const b = apply(a, 0, null);
  assert.ok(b.includes('<!--\n_class: vcenter\n_lib: goal-3 | 目標, 箇条書き | 2026-09-20\n_paginate: false\n-->'), b);
  // lay-* だけの _class と _lib：外しても _class の行は残す（_lib を単独にするとノートに出る）
  const md2 = FM + '<!--\n_class: lay-boxed\n_lib: goal-3 | 目標 | 2026-09-20\n-->\n\n' + THREE;
  const c = apply(md2, 0, null);
  assert.ok(/<!--\n_class:\n_lib: goal-3 \| 目標 \| 2026-09-20\n-->/.test(c), c);
  // 1 行形式・引用符つき
  const d = apply(FM + '<!-- _class: "vtop lay-flow" -->\n\n' + STEPS, 0, 'lay-steps');
  assert.ok(d.includes('<!-- _class: "vtop lay-steps" -->'), d);
});

test('planSetLayout：グローバル class は写してから足す。外すと消える', () => {
  const md = '---\nmarp: true\ntheme: tsutawaru-academic\nclass: em-blue\n---\n\n' + THREE;
  const a = apply(md, 0, 'lay-keyrow');
  assert.ok(a.includes('<!-- _class: em-blue lay-keyrow -->'), a);
  assert.strictEqual(apply(a, 0, null), md);
  // 途中の <!-- class: x --> も同じ扱い
  const md2 = FM + '<!-- class: teal -->\n\n## 一\n\n- a\n\n---\n\n' + THREE;
  assert.ok(apply(md2, 1, 'lay-boxed').includes('<!-- _class: teal lay-boxed -->'));
});

test('planSetLayout：CRLF・コードの柵の中・末尾に改行なし・範囲外', () => {
  const crlf = (FM + THREE).replace(/\n/g, '\r\n');
  const a = apply(crlf, 0, 'lay-cards3');
  assert.ok(a.includes('<!-- _class: lay-cards3 -->\r\n\r\n## 題'));
  assert.ok(!/[^\r]\n/.test(a), 'LF を混ぜない');
  const fenced = FM + '## 題\n\n```md\n<!-- _class: lay-flow -->\n```\n\n- a\n- b\n';
  const b = apply(fenced, 0, 'lay-boxed');
  assert.ok(b.includes('```md\n<!-- _class: lay-flow -->\n```'), '柵の中は触らない');
  assert.ok(b.includes('<!-- _class: lay-boxed -->\n\n## 題'));
  const noeol = FM + '## 一\n\n- a\n\n---\n\n## 二\n\n- a\n- b';
  assert.ok(apply(noeol, 1, 'lay-boxed').endsWith('<!-- _class: lay-boxed -->\n\n## 二\n\n- a\n- b'));
  assert.strictEqual(lv.planSetLayout(FM + THREE, 5, 'lay-boxed').ok, false);
  assert.strictEqual(lv.planSetLayout(FM + THREE, 0, 'grid3').ok, false, 'lay-* 以外は受けない');
  assert.strictEqual(lv.planSetLayout(FM + '<!-- _class: [a, b] -->\n\n' + THREE, 0, 'lay-boxed').ok, false, 'YAML 配列は断る');
});

test('marp-core で描く：class が付く・発表者ノートが増えない・ページ分割が変わらない', () => {
  const { Marp } = require(path.join(EXT, 'node_modules', '@marp-team', 'marp-core'));
  const render = (md) => {
    const marp = new Marp({ html: true });
    for (const n of ['academic.css', 'tsutawaru-academic.css']) marp.themeSet.add(fs.readFileSync(path.join(REPO, 'theme', n), 'utf8'));
    return marp.render(md);
  };
  const md = '---\nmarp: true\ntheme: tsutawaru-academic\nclass: em-blue\n---\n\n'
    + '<!--\n_class: vcenter\n_lib: goal-3 | 目標 | 2026-09-20\n-->\n\n' + THREE + '\n<!-- これは発表者ノート -->\n\n---\n\n' + STEPS + '\n---\n\n' + FIG;
  const before = render(md);
  let cur = md;
  for (const [i, cls] of [[0, 'lay-cards3'], [1, 'lay-flow'], [2, 'lay-fig-right'], [1, 'lay-steps'], [0, null], [2, null], [1, null]]) {
    cur = apply(cur, i, cls);
    const r = render(cur);
    assert.deepStrictEqual(r.comments, before.comments, `ノートが変わらない（${i}, ${cls}）`);
    assert.strictEqual((r.html.match(/<section/g) || []).length, (before.html.match(/<section/g) || []).length);
    const secs = r.html.match(/<section[^>]*>/g);
    if (cls) assert.ok(new RegExp('class="[^"]*\\b' + cls + '\\b').test(secs[i]), secs[i]);
    else assert.ok(!/lay-/.test(secs[i]), secs[i]);
    // 1 枚目は元から _class: vcenter がグローバル class を置き換えている（そこは変えない）。2・3 枚目は写して保つ
    if (i > 0) assert.ok(/class="[^"]*em-blue/.test(secs[i]), 'グローバル class を保つ: ' + secs[i]);
    else assert.ok(/class="[^"]*vcenter/.test(secs[i]), secs[i]);
  }
  assert.strictEqual(cur, md, '全部外すと元の原稿に戻る');
  assert.strictEqual(render(cur).html, before.html);
});
