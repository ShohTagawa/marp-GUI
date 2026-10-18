// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// lib/library-core.cjs のテスト（完成スライドの印・台帳・貼り付け先への適応）。
//   1) 印の形式：writeMark が作る原稿を marp-core で描画し、発表者ノートに出ず HTML も変わらないこと
//   2) CSS の小さなパーサ・テーマのクラス・パレット
//   3) 一時リポジトリ（本物の theme/*.css を写したもの）での台帳生成と adaptSlide
// 実行: node --test tools/marp-scroll-sync/test/library-core.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT = path.resolve(__dirname, '..');
const REPO = path.resolve(EXT, '..', '..');
const core = require(path.join(EXT, 'lib', 'library-core.cjs'));
const { slideStartLines } = require(path.join(EXT, 'lib', 'slide-split.cjs'));

// ---------------------------------------------------------------- 描画の道具（extension.js の renderDeck と同じ条件）

function makeMarp() {
  const { Marp } = require(path.join(EXT, 'node_modules', '@marp-team', 'marp-core'));
  const m = new Marp({ html: true });
  const dir = path.join(REPO, 'theme');
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.css'))
    .sort((a, b) => (a === 'academic.css' ? -1 : b === 'academic.css' ? 1 : a.localeCompare(b)));
  for (const n of names) m.themeSet.add(fs.readFileSync(path.join(dir, n), 'utf8'));
  return m;
}
const render = (md) => makeMarp().render(md);
const FM = (extra) => `---\nmarp: true\ntheme: parts-deck\n${extra || ''}paginate: true\n---\n\n`;

// ---------------------------------------------------------------- 3.1 印

test('parseMark: 形式どおりに読む／クォート付きも読む／無ければ null', () => {
  assert.deepStrictEqual(
    core.parseMark('<!--\n_class: summary\n_lib: day-agenda | 構成, アジェンダ | 2026-09-20\n-->\n\n# t'),
    { id: 'day-agenda', tags: ['構成', 'アジェンダ'], at: '2026-09-20' });
  assert.deepStrictEqual(
    core.parseMark('<!--\n_class: summary\n_lib: "x-1 | a: b, c #d | 2026-01-02"\n-->'),
    { id: 'x-1', tags: ['a: b', 'c #d'], at: '2026-01-02' });
  assert.deepStrictEqual(core.parseMark('<!-- _class: fig\n_lib: only-id -->'), { id: 'only-id', tags: [], at: '' });
  assert.strictEqual(core.parseMark('<!-- _class: fig -->\n# t'), null);
  // コードフェンスの中の見本は印ではない
  assert.strictEqual(core.parseMark('```html\n<!--\n_class: a\n_lib: x | | d\n-->\n```'), null);
});

test('writeMark → parseMark → removeMark の往復で原稿が元に戻る', () => {
  const cases = [
    '<!-- _class: summary -->\n\n# 見出し\n\n- a\n',
    '<!--\n_class: summary\n_paginate: false\n-->\n\n# 見出し\n',
    '<!-- _paginate: false -->\n\n# 見出し\n',
  ];
  for (const src of cases) {
    const marked = core.writeMark(src, { id: 'abc-1', tags: ['構成', 'QR'], at: '2026-09-20' });
    assert.deepStrictEqual(core.parseMark(marked), { id: 'abc-1', tags: ['構成', 'QR'], at: '2026-09-20' });
    assert.strictEqual(core.findLeakyMarks(marked).length, 0, marked);
    assert.ok(!/\n[ \t]+_class/.test(marked) || /\n[ \t]+_class/.test(src), '1行コメントの空白を字下げとして残さない');
    const back = core.removeMark(marked);
    // 1行コメントは1行コメントに戻る。複数行は複数行のまま
    assert.strictEqual(back, src);
  }
  // 付け直しは差し替え（2行にならない）
  const twice = core.writeMark(core.writeMark(cases[0], { id: 'a', tags: [], at: 'd' }), { id: 'b', tags: ['t'], at: 'd' });
  assert.strictEqual((twice.match(/_lib:/g) || []).length, 1);
  assert.strictEqual(core.parseMark(twice).id, 'b');
});

test('writeMark: _class の無いスライドには _class 行を足す（グローバル class を引き継ぐ）。外せば元どおり', () => {
  const src = '# 見出し\n\n- a\n';
  const plain = core.writeMark(src, { id: 'p1', tags: [], at: '2026-09-20' });
  assert.match(plain, /^<!--\n_class:\n_lib: p1 \|  \| 2026-09-20\n-->\n\n# 見出し/);
  assert.strictEqual(core.removeMark(plain), src);
  const withG = core.writeMark(src, { id: 'p1', tags: [], at: '2026-09-20' }, { globalClass: 'teal' });
  assert.match(withG, /_class: teal\n_lib:/);
});

test('writeMark: 値が YAML を壊すときだけ自動でクォートする。id とタグは掃除する', () => {
  const a = core.writeMark('<!-- _class: x -->', { id: 'ok', tags: ['a:b', 'c#d'], at: 'd' });
  assert.match(a, /_lib: ok \| a:b, c#d \| d\n/);
  const b = core.writeMark('<!-- _class: x -->', { id: 'ok', tags: ['e: f', 'g #h'], at: 'd' });
  assert.match(b, /_lib: "ok \| e: f, g #h \| d"\n/);
  const c = core.writeMark('<!-- _class: x -->', { id: ' Bad ID/日本語 ', tags: ['a|b', 'c-->d', 'e,f'], at: 'd' });
  const mk = core.parseMark(c);
  assert.strictEqual(mk.id, 'bad-id');
  assert.deepStrictEqual(mk.tags, ['a b', 'cd', 'e f']);
  assert.throws(() => core.writeMark('# t', { id: '日本語', tags: [] }), /id/);
});

test('marp-core 実測：印を付けても comments（発表者ノート）にも HTML にも出ず、描画が 1 バイトも変わらない', () => {
  const body = '\n\n# 見出し\n\n- a\n- b\n\n<!-- 本物のノート -->\n\n---\n\n# 次\n';
  const variants = [
    { name: '日本語タグ', fm: '', head: '<!-- _class: summary -->', mark: { id: 'day-agenda', tags: ['構成', 'アジェンダ'] } },
    { name: 'コロンと#', fm: '', head: '<!-- _class: summary -->', mark: { id: 'c1', tags: ['a:b', 'e: f', 'g #h', 'x:'] } },
    { name: '引用符と\\', fm: '', head: '<!-- _class: summary -->', mark: { id: 'c2', tags: ['say "hi"', "it's", 'a\\b'] } },
    { name: '_class 無し', fm: '', head: '', mark: { id: 'n1', tags: ['t'] } },
    { name: 'グローバル class あり', fm: 'class: teal\n', head: '', mark: { id: 'g1', tags: ['t'] }, globalClass: 'teal' },
    { name: '_paginate と同居', fm: '', head: '<!--\n_class: summary\n_paginate: false\n-->', mark: { id: 'm1', tags: ['t'] } },
    { name: '_class 無しで _paginate だけ', fm: 'class: navy\n', head: '<!-- _paginate: false -->', mark: { id: 'm2', tags: ['t'] }, globalClass: 'navy' },
  ];
  for (const v of variants) {
    const slide0 = v.head + body.split('\n---\n')[0];
    const rest = '\n---\n' + body.split('\n---\n')[1];
    const a = render(FM(v.fm) + slide0 + rest);
    const marked = core.writeMark(slide0, { ...v.mark, at: '2026-09-20' }, { globalClass: v.globalClass });
    const b = render(FM(v.fm) + marked + rest);
    assert.strictEqual(b.html, a.html, v.name + ': HTML が変わった');
    assert.strictEqual(b.css, a.css, v.name + ': CSS が変わった');
    assert.deepStrictEqual(b.comments, [['本物のノート'], []], v.name + ': ノートが変わった');
    assert.ok(!/_lib|2026-09-20/.test(b.html), v.name + ': HTML に印が残った');
    assert.strictEqual(core.findLeakyMarks(FM(v.fm) + marked + rest).length, 0, v.name);
    assert.strictEqual(core.parseMark(marked).id, v.mark.id);
  }
});

test('findLeakyMarks: 単独の _lib と、YAML として壊れた値を見つける（marp-core の実際の混入と一致）', () => {
  const md = FM('') + [
    '<!-- _lib: alone1 | t | d -->',           // 単独 → 混入
    '', '# a', '', '---', '',
    '<!--', '_class: summary', '_lib: bad1 | e: f | d', '-->', // 壊れた YAML → コメントごと混入
    '', '# b', '', '---', '',
    '<!--', '_class: summary', '_lib: "ok1 | e: f | d"', '-->',
    '', '# c', '', '---', '',
    '```html', '<!-- _lib: sample | t | d -->', '```', '',
  ].join('\n');
  const leaks = core.findLeakyMarks(md);
  assert.deepStrictEqual(leaks.map((l) => [l.id, l.reason]), [['alone1', 'alone'], ['bad1', 'yaml']]);
  const lines = md.split('\n');
  for (const l of leaks) assert.match(lines[l.line], /_lib:/);
  // marp-core でも同じスライドだけにノートが出る
  const r = render(md);
  assert.deepStrictEqual(r.comments.map((c) => c.length), [1, 1, 0, 0]);
});

test('markSlideEdit: デック全文に対する差分 1 件。グローバル class（本文の <!-- class: --> も）を引き継ぐ', () => {
  const md = FM('class: teal\n') + '# 一枚目\n\n---\n\n<!-- class: navy -->\n\n# 二枚目\n\n---\n\n# 三枚目\n';
  const e = core.markSlideEdit(md, 2, { id: 's3', tags: ['x'], at: 'd' });
  const out = core.applyEdits(md, [e]);
  assert.match(out, /_class: navy\n_lib: s3 \| x \| d/);
  assert.strictEqual(slideStartLines(out).length, 3);
  const deck = core.parseDeck(out);
  assert.deepStrictEqual(deck.slides.map((s) => s.marked), [false, false, true]);
  const e2 = core.markSlideEdit(out, 2, null);
  assert.strictEqual(core.applyEdits(out, [e2]), md);
  assert.strictEqual(core.markSlideEdit(md, 0, null), null);
});

test('suggestId: 題名の英数字とイベント略号から作り、既存 id は連番で避ける', () => {
  const p = 'slides/20260623_LEC_15min04_workspace-studio/20260623_LEC_15min04_workspace-studio.md';
  assert.strictEqual(core.suggestId('Workspace Studio とは', p, 3, []), 'lec-workspace-studio');
  assert.strictEqual(core.suggestId('Workspace Studio とは', p, 3, ['lec-workspace-studio']), 'lec-workspace-studio-2');
  assert.match(core.suggestId('今回の構成', p, 3, []), /^lec-.*-3$/);
});

// ---------------------------------------------------------------- CSS

test('cssRules: @media・@keyframes・コメント・文字列内の波括弧に耐える', () => {
  const css = `
    @import "academic";
    /* .ghost { color: red } */
    .a, .b > .c { color: #C8611C; content: "}{" ; }
    @media (min-width: 10px) { .m .a { margin: 0 } }
    @keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
    section.fig .x[data-k=".notclass"]::after { content: '/* no */'; }
  `;
  const rules = core.cssRules(css);
  assert.deepStrictEqual(rules.map((r) => r.selector), ['.a, .b > .c', '.m .a', '@keyframes spin', 'section.fig .x[data-k=".notclass"]::after']);
  assert.deepStrictEqual(rules[0].classes, ['a', 'b', 'c']);
  assert.strictEqual(rules[1].atRule, '@media (min-width: 10px)');
  assert.deepStrictEqual(rules[2].classes, []);
  assert.deepStrictEqual(rules[3].classes, ['fig', 'x']);
  assert.match(rules[0].body, /content: "\}\{"/);
  assert.match(rules[3].body, /\/\* no \*\//);
  assert.ok(!rules.some((r) => r.classes.includes('ghost')));
  // 元の位置を指している
  assert.strictEqual(css.slice(rules[0].start, rules[0].end).trim().startsWith('.a, .b'), true);
  assert.match(core.ruleToCss(rules[1]), /^@media \(min-width: 10px\) \{ \.m \.a \{ margin: 0; \} \}$/);
});

test('cssRules: 署名は空白・末尾セミコロン・hex の大文字小文字の揺れを同一視し、中身が違えば変わる', () => {
  const sig = (s) => core.cssRules(s)[0].signature;
  assert.strictEqual(sig('.a{color:#ABC;margin:0}'), sig('.a  {\n  color: #abc ;\n  margin: 0;\n}'));
  assert.strictEqual(sig('.a>.b{x:1}'), sig('.a > .b { x: 1; }'));
  assert.notStrictEqual(sig('.a{color:#abc}'), sig('.a{color:#abd}'));
  assert.notStrictEqual(sig('.a{x:1}'), sig('@media print{.a{x:1}}'));
});

test('themeClasses: 本物の theme/*.css から。tsutawaru-academic は academic のクラスも含む', () => {
  const tc = core.themeClasses(REPO);
  assert.ok(tc.all.has('takeaway') && tc.all.has('page-title'));
  assert.ok(tc.byTheme.academic.has('takeaway'));
  assert.ok(tc.byTheme['tsutawaru-academic'].has('page-title') && tc.byTheme['tsutawaru-academic'].has('takeaway'));
});

test('parseDeck: パレットは frontmatter の上書き → テーマの既定', () => {
  const d0 = core.parseDeck('---\nmarp: true\ntheme: academic\n---\n\n# t\n', { repoRoot: REPO });
  assert.strictEqual(d0.palette.accent.toLowerCase(), '#a6192e');
  assert.strictEqual(d0.palette.sectionBg.toLowerCase(), '#faf5f6');
  const d1 = core.parseDeck('---\nmarp: true\ntheme: tsutawaru-academic\nclass: lead\n---\n\n# t\n', { repoRoot: REPO });
  assert.strictEqual(d1.globalClass, 'lead');
  assert.strictEqual(d1.palette.accent.toLowerCase(), '#a6192e');   // tsutawaru-academic は academic の土台の色
  const d2 = core.parseDeck([
    '---', 'marp: true', 'theme: academic', "header: '<div class=\"hdr-left\">題</div>'",
    'style: |', '  :root { --accent: #C8611C; --accent-dark: #8A3F0E; }', '  .agenda { color: red; }', '',
    '---', '', '# t', '', '<style scoped>', '.only { x: 1 }', '</style>', '', '---', '', '<style>', '.g { y: 2 }', '</style>', '',
  ].join('\n'), { repoRoot: REPO });
  assert.strictEqual(d2.palette.accent, '#C8611C');
  assert.strictEqual(d2.palette.accentDark, '#8A3F0E');
  assert.strictEqual(d2.palette.accentSoft.toLowerCase(), '#f8e5ea');
  assert.strictEqual(d2.headerRaw, '<div class="hdr-left">題</div>');
  assert.deepStrictEqual(d2.styleBlocks.map((b) => [b.kind, b.scoped, b.slideIndex]), [['frontmatter', false, -1], ['inline', true, 0], ['inline', false, 1]]);
  assert.match(d2.styleBlocks[0].css, /^:root \{/);
  assert.strictEqual(d2.text.slice(d2.styleBlocks[1].start, d2.styleBlocks[1].end), '\n.only { x: 1 }\n');
  assert.strictEqual(d2.slides.length, 2);
});

// ---------------------------------------------------------------- 一時リポジトリ

function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-lib-test-'));
  fs.mkdirSync(path.join(root, 'theme'));
  for (const n of fs.readdirSync(path.join(REPO, 'theme'))) {
    if (n.endsWith('.css')) fs.copyFileSync(path.join(REPO, 'theme', n), path.join(root, 'theme', n));
  }
  const w = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };
  w('slides/assets/logo-placeholder.png', 'LOGO');
  // 元デック：オレンジ配色・デック固有 CSS・素材あり
  const src = w('slides/20260101_SRC_a/20260101_SRC_a.md', [
    '---', 'marp: true', 'theme: academic', 'paginate: true',
    "header: '<div class=\"hdr-left\">元</div><img class=\"hdr-logo\" src=\"../assets/logo-placeholder.png\">'",
    'style: |',
    '  :root { --accent: #C8611C; --accent-dark: #8A3F0E; --accent-soft: #FBE9DC; }',
    '  .agenda { display: grid; gap: 8px; }',
    '  .agenda .row { border-left: 4px solid #c8611c; background: url("./src/bg-tile.png"); }',
    '  .agenda .row b { color: var(--accent-dark, #8A3F0E); }',
    '  .takeaway { font-size: 30px; }',
    '  .unused { color: blue; }',
    '  @keyframes pop { from { opacity: 0 } to { opacity: 1 } }',
    '  .qrbox { animation: pop 1s; border: 1px solid #ABC; }',
    '---', '',
    '<!-- _class: cover-hero -->', '', '# 表紙', '', '---', '',
    '<!--', '_class: summary', '_lib: src-agenda | 構成, QR | 2026-09-20', '-->', '',
    '<div class="page-title">今回の構成</div>', '',
    '<div class="agenda">', '<div class="row" style="color:#C8611C"><b>1</b> はじめに</div>', '</div>', '',
    '<div class="qrbox"><img src="./src/qr.png" alt="QR"><img src="../assets/logo-placeholder.png"></div>', '',
    '<svg viewBox="0 0 10 10"><rect fill="#8a3f0e" stroke="var(--accent, #C8611C)" width="10" height="10"/></svg>', '',
    '<a href="https://example.com/#C8611C">リンク</a> &#123;', '',
    '<div class="takeaway">要点</div>', '',
    '<!-- 本物のノート #C8611C -->', '',
    '---', '', '# 三枚目', '',
  ].join('\n'));
  w('slides/20260101_SRC_a/src/qr.png', 'QR-IMAGE-A');
  w('slides/20260101_SRC_a/src/bg-tile.png', 'TILE');
  // out/ と _library/ は走査しない
  w('slides/20260101_SRC_a/out/copy.md', '---\nmarp: true\n---\n\n<!--\n_class: a\n_lib: should-not-appear | | d\n-->\n');
  w('slides/_library/x.md', '---\nmarp: true\n---\n\n<!--\n_class: a\n_lib: should-not-appear2 | | d\n-->\n');
  // marp でない md は無視
  w('slides/20260101_SRC_a/原稿.md', '<!--\n_class: a\n_lib: not-marp | | d\n-->\n');
  // 貼り付け先(1)：parts-deck teal。style: | なし。src/qr.png が同名・別内容
  const d1 = w('slides/grp/20260202_DST_b/20260202_DST_b.md', [
    '---', 'marp: true', 'theme: parts-deck', 'class: teal', 'paginate: true', '---', '',
    '# 先1', '', '---', '', '# 先2', '',
  ].join('\n'));
  w('slides/grp/20260202_DST_b/src/qr.png', 'ANOTHER-QR');
  // 貼り付け先(2)：academic 既定色。.agenda が同名・別物。style: | あり
  const d2 = w('slides/20260303_DST_c/20260303_DST_c.md', [
    '---', 'marp: true', 'theme: academic', 'style: |', '  .agenda { display: flex; }', '', '---', '',
    '# 先1', '',
  ].join('\n'));
  // 重複 id
  w('slides/20260404_P_x/20260404_P_x.md', '---\nmarp: true\ntheme: ponchie\n---\n\n<!--\n_class: a\n_lib: src-agenda | dup | 2026-01-01\n-->\n\n# ぽんち\n\n---\n\n<!-- _lib: leak-one | | d -->\n\n# x\n');
  return { root, src, d1, d2 };
}

test('slideDeps: デック固有クラスだけを拾い、参照する @keyframes と素材も付ける', () => {
  const R = mkRepo();
  const deck = core.parseDeck(R.src, { repoRoot: R.root });
  const deps = core.slideDeps(deck, 1, R.root);
  assert.deepStrictEqual(deps.deckClasses, ['agenda', 'qrbox', 'row']);
  assert.ok(deps.classes.includes('summary') && deps.classes.includes('takeaway'));
  assert.deepStrictEqual(deps.rules.map((r) => r.selector), ['.agenda', '.agenda .row', '.agenda .row b', '.qrbox', '@keyframes pop']);
  assert.deepStrictEqual(deps.assets.sort(), ['../assets/logo-placeholder.png', './src/bg-tile.png', './src/qr.png']);
  assert.ok(deps.cssBytes > 100);
  assert.deepStrictEqual(deps.themeOverrides, ['takeaway']);
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('buildIndex: out・_library・marp でない md を除き、重複 id は両方残して warnings に出す', () => {
  const R = mkRepo();
  const idx = core.buildIndex(R.root);
  assert.deepStrictEqual(idx.entries.map((e) => e.id).sort(), ['leak-one', 'src-agenda', 'src-agenda']);
  const e = idx.entries.find((x) => x.deck.startsWith('slides/'));
  assert.deepStrictEqual(
    { deck: e.deck, slide: e.slide, title: e.title, pattern: e.pattern, theme: e.theme, tags: e.tags, markedAt: e.markedAt },
    { deck: 'slides/20260101_SRC_a/20260101_SRC_a.md', slide: 2, title: '今回の構成', pattern: 'summary', theme: 'academic', tags: ['構成', 'QR'], markedAt: '2026-09-20' });
  assert.strictEqual(e.palette.accent, '#C8611C');
  assert.deepStrictEqual(e.deckClasses, ['agenda', 'qrbox', 'row']);
  assert.strictEqual(e.thumb, null);
  assert.ok(idx.warnings.some((w) => /重複/.test(w) && /P_x/.test(w) && /SRC_a/.test(w)), idx.warnings.join('\n'));
  assert.ok(idx.warnings.some((w) => /発表者ノート/.test(w) && /P_x\.md:15/.test(w)), idx.warnings.join('\n'));
  assert.throws(() => core.findEntry(idx, 'src-agenda'), /2 か所/);
  assert.strictEqual(core.findEntry(idx, 'nope'), null);
  const p = core.writeIndex(R.root, idx);
  assert.strictEqual(p, path.join(R.root, 'slides', '_library', 'index.json'));
  assert.strictEqual(core.readIndex(R.root).entries.length, 3);
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('adaptSlide → parts-deck teal：素材コピー（同名別内容は -2）・共有素材の相対パス・CSS 同梱・色の追従・_from', () => {
  const R = mkRepo();
  const before = fs.readFileSync(R.d1, 'utf8');
  const plan = core.adaptSlide({ srcMdPath: R.src, id: 'src-agenda', destMdPath: R.d1, repoRoot: R.root, afterIndex: 0 });
  // 計画だけ。まだ何も書かれていない
  assert.strictEqual(fs.readFileSync(R.d1, 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(path.dirname(R.d1), 'src', 'qr-2.png')));

  const t = plan.slideText;
  assert.ok(!/_lib:/.test(t));
  assert.match(t, /_class: summary teal\n_from: src-agenda\n/);           // 貼り付け先の配色プリセットを引き継ぐ
  assert.match(t, /src="\.\/src\/qr-2\.png"/);                              // 同名・別内容
  assert.match(t, /src="\.\.\/\.\.\/assets\/logo-placeholder\.png"/);             // 深さの差
  assert.match(t, /style="color:var\(--accent, #C8611C\)"/);
  assert.match(t, /fill="var\(--accent-dark, #8a3f0e\)"/);                  // SVG 属性・小文字も一致
  assert.match(t, /stroke="var\(--accent, #C8611C\)"/);                     // 既に var( の中 → 二重にしない
  assert.ok(!/var\(--accent, var\(/.test(t));
  assert.match(t, /example\.com\/#C8611C/);                                 // URL のフラグメントは触らない
  assert.match(t, /本物のノート #C8611C/);                                  // コメントの中も触らない
  assert.deepStrictEqual(plan.assetCopies.map((c) => path.relative(R.root, c.to)).sort(),
    ['slides/grp/20260202_DST_b/src/bg-tile.png', 'slides/grp/20260202_DST_b/src/qr-2.png']);
  assert.ok(plan.warnings.some((w) => /qr-2\.png/.test(w)));
  assert.ok(plan.warnings.some((w) => /テーマが違います/.test(w)));
  assert.ok(plan.warnings.some((w) => /か所/.test(w) && /var\(--accent/.test(w)));
  assert.ok(plan.warnings.some((w) => /\.takeaway/.test(w)));
  assert.strictEqual(plan.destEdits.length, 2);

  const after = core.applyAdaptPlan(plan);
  assert.strictEqual(after, fs.readFileSync(R.d1, 'utf8'));
  assert.strictEqual(fs.readFileSync(path.join(path.dirname(R.d1), 'src', 'qr-2.png'), 'utf8'), 'QR-IMAGE-A');
  assert.strictEqual(fs.readFileSync(path.join(path.dirname(R.d1), 'src', 'qr.png'), 'utf8'), 'ANOTHER-QR');
  assert.strictEqual(slideStartLines(after).length, 3);
  const dest = core.parseDeck(after, { repoRoot: R.root });
  assert.strictEqual(dest.slides[1].title, '今回の構成');
  assert.strictEqual(dest.slides[1].from, 'src-agenda');
  assert.strictEqual(dest.slides[1].marked, false);
  const css = dest.styleBlocks[0].css;
  assert.match(css, /\.agenda \{ display: grid; gap: 8px; \}/);
  assert.match(css, /border-left: 4px solid var\(--accent, #c8611c\)/);
  assert.match(css, /url\("\.\/src\/bg-tile\.png"\)/);
  assert.match(css, /var\(--accent-dark, #8A3F0E\)/);
  assert.ok(!/var\(--accent-dark, var\(/.test(css));
  assert.match(css, /@keyframes pop/);
  assert.ok(!/:root|\.unused|\.takeaway/.test(css));
  assert.match(css, /#ABC/);                                                // パレット外の色はそのまま

  // 描画できて、ノートに何も漏れない
  const r = render(after);
  assert.deepStrictEqual(r.comments.map((c) => c.join('|')), ['', '本物のノート #C8611C', '']);
  assert.match(r.html, /class="summary teal"/);

  // もう一度同じスライドを入れても CSS も素材も増えない
  const plan2 = core.adaptSlide({ srcMdPath: R.src, id: 'src-agenda', destMdPath: R.d1, repoRoot: R.root, afterIndex: 2 });
  assert.strictEqual(plan2.assetCopies.length, 0);
  assert.strictEqual(plan2.destEdits.length, 1, '2回目は本文の挿入だけ');
  assert.strictEqual(plan2.info.carried + plan2.info.scoped, 0);
  assert.match(plan2.slideText, /qr-2\.png/);                               // 1回目にコピーした同内容を再利用
  const after2 = core.applyAdaptPlan(plan2);
  assert.strictEqual((after2.match(/\.agenda \{ display: grid/g) || []).length, 1);
  assert.strictEqual(slideStartLines(after2).length, 4);
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('adaptSlide → 同名で中身の違うクラスがある先：そのクラスのルールは <style scoped> に、他は frontmatter に', () => {
  const R = mkRepo();
  const plan = core.adaptSlide({ srcMdPath: R.src, slideIndex: 1, destMdPath: R.d2, repoRoot: R.root, afterIndex: 0 });
  const scoped = (plan.slideText.match(/<style scoped>\n([\s\S]*?)\n<\/style>/) || [])[1] || '';
  assert.match(scoped, /^\.agenda \{ display: grid/m);
  assert.match(scoped, /^\.agenda \.row \{/m);
  assert.ok(!/qrbox/.test(scoped));
  assert.ok(plan.warnings.some((w) => /同名で中身の違うクラス/.test(w) && /\.agenda/.test(w)));
  assert.ok(!plan.warnings.some((w) => /テーマが違います/.test(w)));
  const after = core.applyAdaptPlan(plan, { dryRun: true });
  const dest = core.parseDeck(after, { repoRoot: R.root });
  assert.match(dest.styleBlocks[0].css, /\.agenda \{ display: flex; \}\n\/\* ── ライブラリ src-agenda[^\n]*\n\.qrbox \{/);
  assert.match(dest.styleBlocks[0].css, /@keyframes pop/);
  assert.ok(!/display: grid/.test(dest.styleBlocks[0].css));
  assert.strictEqual(dest.slides.length, 2);
  assert.strictEqual(slideStartLines(after).length, 2);
  // dryRun はファイルに触らない
  assert.ok(!fs.existsSync(path.join(path.dirname(R.d2), 'src')));
  assert.ok(!/qrbox/.test(fs.readFileSync(R.d2, 'utf8')));
  // 印の無いスライドを slideIndex で運ぶと _from は付かない
  const p3 = core.adaptSlide({ srcMdPath: R.src, slideIndex: 2, destMdPath: R.d2, repoRoot: R.root });
  assert.strictEqual(p3.slideText, '# 三枚目');
  assert.deepStrictEqual(p3.destEdits, []);
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('adaptSlide keepColors：色も _class も元のまま。パレットが同じ先でも置換しない', () => {
  const R = mkRepo();
  const plan = core.adaptSlide({ srcMdPath: R.src, id: 'src-agenda', destMdPath: R.d1, repoRoot: R.root, keepColors: true });
  assert.match(plan.slideText, /style="color:#C8611C"/);
  assert.match(plan.slideText, /_class: summary\n_from:/);
  assert.strictEqual(plan.info.colorReplacements, 0);
  // 元と同じパレットの先（元デック自身へ）→ 置換 0・素材コピー 0・CSS 0
  const self = core.adaptSlide({ srcMdPath: R.src, id: 'src-agenda', destMdPath: R.src, repoRoot: R.root, afterIndex: 1 });
  assert.strictEqual(self.info.colorReplacements, 0);
  assert.strictEqual(self.assetCopies.length, 0);
  assert.strictEqual(self.destEdits.length, 1);
  assert.throws(() => core.adaptSlide({ srcMdPath: R.src, id: 'nope', destMdPath: R.d1, repoRoot: R.root }), /印が/);
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('insertSlideEdit: 先頭・途中・末尾（末尾に改行が無い原稿も）で枚数がちょうど 1 増える', () => {
  const md = FM('') + '# a\n\n<!-- ノート -->\n---\n\n# b';
  for (const after of [-1, 0, 1]) {
    const out = core.applyEdits(md, [core.insertSlideEdit(md, after, '\n\n# new\n\n')]);
    assert.strictEqual(slideStartLines(out).length, 3, String(after));
    const deck = core.parseDeck(out);
    assert.strictEqual(deck.slides[after + 1].title, 'new');
    assert.strictEqual(render(out).comments.length, 3);
  }
  assert.throws(() => core.insertSlideEdit(md, 5, '# x'), /--after/);
});

test('replacePaletteColors: 3桁/6桁・大文字小文字を同一視し、変数定義の右辺と var( の中は触らない', () => {
  const map = new Map([['#aabbcc', '--accent']]);
  const r = core.replacePaletteColors('a{color:#ABC;--accent: #aabbcc;b:var(--x, #AABBCC);c: #aabbccdd;d:#aabbcd}', map, { css: true });
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.text, 'a{color:var(--accent, #ABC);--accent: #aabbcc;b:var(--x, #AABBCC);c: #aabbccdd;d:#aabbcd}');
});

// ---------------------------------------------------------------- lib/library-vscode.cjs（'vscode' はスタブ）
// 目的は「register() が例外なく走り、登録したコマンド・provider が一通り動く」ことの確認。
// 入力欄や貼り付けウィジェットの実際の見え方は実機でしか確かめられない。

const stub = require('./helpers/vscode-stub.cjs');
const libVscode = require(path.join(EXT, 'lib', 'library-vscode.cjs'));

function setupVscode(R) {
  stub.reset();
  const posted = [];
  const ctx = stub.makeContext();
  const api = {
    isMarpDoc: (doc) => /^---\r?\n[\s\S]*?\bmarp:\s*true\b/.test(doc.getText().slice(0, 2048)),
    repoRootFor: () => R.root,
    postToPreview: (m) => posted.push(m),
    webviewUriFor: (abs) => 'webview://' + abs,
  };
  const lib = libVscode.register(ctx, api);
  return { ctx, lib, posted };
}

test('library-vscode: register が例外なく走り、コマンド 3 つと貼り付け provider を登録する。API が無ければ貼り付けだけ無効', () => {
  const R = mkRepo();
  const { ctx, lib } = setupVscode(R);
  for (const c of ['marpScrollSync.markSlide', 'marpScrollSync.insertFromLibrary', 'marpScrollSync.rebuildLibrary']) assert.ok(stub.state.commands.has(c), c);
  assert.strictEqual(stub.state.pasteProviders.length, 1);
  assert.deepStrictEqual(Object.keys(lib).sort(), ['insert', 'marksFor', 'openGallery', 'toggleMark']);
  stub.disposeContext(ctx);
  // 古い VS Code：registerDocumentPasteEditProvider が無い
  stub.reset();
  const keep = stub.vscode.languages.registerDocumentPasteEditProvider;
  delete stub.vscode.languages.registerDocumentPasteEditProvider;
  try {
    const ctx2 = stub.makeContext();
    libVscode.register(ctx2, { isMarpDoc: () => true, repoRootFor: () => R.root });
    assert.strictEqual(stub.state.pasteProviders.length, 0);
    assert.ok(stub.state.commands.has('marpScrollSync.markSlide'));
    stub.disposeContext(ctx2);
  } finally { stub.vscode.languages.registerDocumentPasteEditProvider = keep; }
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('library-vscode: 印を付ける→marksFor→外す（1 操作 = 1 WorkspaceEdit）。使用中の id は入力欄で弾く', async () => {
  const R = mkRepo();
  const { ctx, lib } = setupVscode(R);
  const doc = stub.makeDocument(fs.readFileSync(R.d1, 'utf8'), { fsPath: R.d1 });
  const ed = stub.makeEditor(doc, { active: true, line: 11 }); // 2 枚目
  const before = doc.getText();
  const asked = [];
  stub.state.inputBoxAnswer = (o) => {
    asked.push(o);
    if (asked.length === 1) {
      assert.match(o.value, /^dst-/);
      assert.match(o.validateInput('src-agenda'), /既に使われています/);
      assert.match(o.validateInput('日本語'), /半角/);
      assert.strictEqual(o.validateInput('dst-second'), null);
      return 'dst-second';
    }
    return '例, テスト';
  };
  assert.strictEqual(await stub.vscode.commands.executeCommand('marpScrollSync.markSlide'), true);
  assert.strictEqual(stub.state.appliedEdits.length, 1);
  assert.match(doc.getText(), /<!--\n_class: teal\n_lib: dst-second \| 例, テスト \| \d{4}-\d\d-\d\d\n-->\n\n# 先2/);
  assert.deepStrictEqual(lib.marksFor(doc), [false, true]);
  assert.strictEqual(render(doc.getText()).html, render(before).html, '印で描画が変わった');
  // もう一度で外れ、原稿が元に戻る
  assert.strictEqual(await lib.toggleMark(ed, 1), true);
  assert.strictEqual(doc.getText(), before);
  assert.deepStrictEqual(lib.marksFor(doc), [false, false]);
  // 入力をやめたら何も書かない
  stub.state.inputBoxAnswer = undefined;
  assert.strictEqual(await lib.toggleMark(ed, 0), false);
  assert.strictEqual(doc.getText(), before);
  stub.disposeContext(ctx);
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('library-vscode: insert は本文＋frontmatter style を 1 つの WorkspaceEdit で入れ、素材をコピーし、警告を見せる', async () => {
  const R = mkRepo();
  // 重複 id があると挿入できない（どちらか決められない）→ まず重複を消す
  fs.rmSync(path.join(R.root, 'slides', '20260404_P_x'), { recursive: true, force: true });
  const { ctx, lib, posted } = setupVscode(R);
  const doc = stub.makeDocument(fs.readFileSync(R.d1, 'utf8'), { fsPath: R.d1 });
  const ed = stub.makeEditor(doc, { active: true, line: 7 });
  assert.strictEqual(await lib.insert(ed, 'src-agenda', 0, {}), true);
  assert.strictEqual(stub.state.appliedEdits.length, 1);
  assert.strictEqual(stub.state.appliedEdits[0].size, 2);
  const deck = core.parseDeck(doc.getText());
  assert.strictEqual(deck.slides.length, 3);
  assert.strictEqual(deck.slides[1].from, 'src-agenda');
  assert.match(doc.getText(), /style: \|\n {2}\/\* ── ライブラリ src-agenda/);
  assert.ok(fs.existsSync(path.join(path.dirname(R.d1), 'src', 'qr-2.png')));
  assert.strictEqual(ed.selection.active.line, deck.slides[1].startLine);
  const warn = stub.state.messages.filter((m) => m.level === 'warn');
  assert.strictEqual(warn.length, 1);
  assert.match(warn[0].message, /テーマが違います/);
  // 無い id はエラー表示だけで、原稿は変えない
  const t = doc.getText();
  assert.strictEqual(await lib.insert(ed, 'no-such', 0, {}), false);
  assert.strictEqual(doc.getText(), t);
  assert.ok(stub.state.messages.some((m) => m.level === 'error'));

  // QuickPick 経由（配色が違うので色の扱いも聞かれる）
  const picks = [];
  stub.state.quickPickAnswer = (items) => { picks.push(items); return items[0]; };
  await stub.vscode.commands.executeCommand('marpScrollSync.insertFromLibrary');
  assert.strictEqual(picks.length, 2);
  assert.deepStrictEqual([picks[0][0].label, picks[0][0].description], ['今回の構成', 'summary']);
  assert.match(picks[0][0].detail, /20260101_SRC_a #2/);
  assert.match(picks[0][0].detail, /構成, QR/);
  assert.strictEqual(core.parseDeck(doc.getText()).slides.length, 4);
  assert.strictEqual((doc.getText().match(/\.agenda \{ display: grid/g) || []).length, 1, 'CSS が二重に入った');

  // ギャラリー：サムネイルがあれば webview URI、無ければ null
  await lib.openGallery(ed, 2);
  assert.deepStrictEqual(posted[0], { type: 'library', index: 2, entries: [{ id: 'src-agenda', title: '今回の構成', pattern: 'summary', deck: 'slides/20260101_SRC_a/20260101_SRC_a.md', tags: ['構成', 'QR'], thumb: null }] });
  fs.mkdirSync(path.join(R.root, 'slides', '_library', 'thumbs'), { recursive: true });
  fs.writeFileSync(path.join(R.root, 'slides', '_library', 'thumbs', 'src-agenda.png'), 'PNG');
  await lib.openGallery(ed, 2);
  assert.match(posted[1].entries[0].thumb, /^webview:\/\/.*src-agenda\.png$/);
  stub.disposeContext(ctx);
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('library-vscode: 診断（混入する印に Warning）と rebuildLibrary（統合ターミナルで CLI）', async () => {
  const R = mkRepo();
  fs.mkdirSync(path.join(R.root, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(R.root, 'tools', 'marp-library.mjs'), '');
  const leaky = path.join(R.root, 'slides', '20260404_P_x', '20260404_P_x.md');
  stub.reset();
  const doc = stub.makeDocument(fs.readFileSync(leaky, 'utf8'), { fsPath: leaky });
  stub.makeEditor(doc, { active: true });
  const ctx = stub.makeContext();
  libVscode.register(ctx, { isMarpDoc: () => true, repoRootFor: () => R.root });
  const list = stub.state.diagnostics.get('marp-library').get(doc.uri.toString());
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].range.start.line, 14);
  assert.strictEqual(list[0].severity, stub.vscode.DiagnosticSeverity.Warning);
  assert.match(list[0].message, /発表者ノートに出ます/);
  await stub.vscode.commands.executeCommand('marpScrollSync.rebuildLibrary');
  assert.strictEqual(stub.state.terminals.length, 1);
  assert.strictEqual(stub.state.terminals[0].options.cwd, R.root);
  assert.match(stub.state.terminals[0].sent[0], /marp-library\.mjs index; node tools\/marp-library\.mjs thumbs/);
  stub.disposeContext(ctx);
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('library-vscode: 貼り付け適応。コピー時に出所を添え、別デックへ貼るときだけ「貼り付け先に合わせて貼り付け」を返す', async () => {
  const R = mkRepo();
  const { ctx } = setupVscode(R);
  const { provider, metadata } = stub.state.pasteProviders[0];
  assert.deepStrictEqual(metadata.copyMimeTypes, [libVscode.PASTE_MIME]);
  const srcDoc = stub.makeDocument(fs.readFileSync(R.src, 'utf8'), { fsPath: R.src });
  const destDoc = stub.makeDocument(fs.readFileSync(R.d1, 'utf8'), { fsPath: R.d1 });
  const V = stub.vscode;
  // 2 枚目を丸ごとコピー
  const sdeck = core.parseDeck(srcDoc.getText());
  const s = sdeck.slides[1];
  const range = new V.Range(s.startLine, 0, s.endLine, 0);
  const dt = new V.DataTransfer();
  dt.set('text/plain', new V.DataTransferItem(srcDoc.getText(range)));
  provider.prepareDocumentPaste(srcDoc, [range], dt);
  assert.deepStrictEqual(JSON.parse(await dt.get(libVscode.PASTE_MIME).asString()), { fsPath: R.src, slideIndex: 1 });

  // 同じデックへの貼り付けには何も出さない
  assert.strictEqual(await provider.provideDocumentPasteEdits(srcDoc, [new V.Range(s.endLine, 0, s.endLine, 0)], dt, {}, {}), undefined);
  // frontmatter の中へも出さない
  assert.strictEqual(await provider.provideDocumentPasteEdits(destDoc, [new V.Range(2, 0, 2, 0)], dt, {}, {}), undefined);
  // 設定で切れる
  stub.state.config['marpScrollSync.adaptivePaste'] = false;
  assert.strictEqual(await provider.provideDocumentPasteEdits(destDoc, [new V.Range(8, 0, 8, 0)], dt, {}, {}), undefined);
  delete stub.state.config['marpScrollSync.adaptivePaste'];

  const edits = await provider.provideDocumentPasteEdits(destDoc, [new V.Range(8, 0, 8, 0)], dt, {}, {});
  assert.strictEqual(edits.length, 1);
  const e = edits[0];
  assert.strictEqual(e.title, '貼り付け先に合わせて貼り付け');
  assert.deepStrictEqual(e.yieldTo, [V.DocumentDropOrPasteEditKind.Text]);
  assert.match(e.insertText, /_class: summary teal\n_from: src-agenda/);
  assert.ok(!/_lib:/.test(e.insertText));
  assert.match(e.insertText, /\.\/src\/qr-2\.png/);
  assert.strictEqual(e.additionalEdit.size, 1);
  assert.match(e.additionalEdit.ops[0].text, /^style: \|\n {2}\/\*/);
  // 選ばれるまで素材はコピーしない
  assert.ok(!fs.existsSync(path.join(path.dirname(R.d1), 'src', 'qr-2.png')));
  provider.resolveDocumentPasteEdit(e, {});
  assert.ok(fs.existsSync(path.join(path.dirname(R.d1), 'src', 'qr-2.png')));
  assert.ok(stub.state.messages.some((m) => m.level === 'warn'));

  // 出所の無い貼り付け（他のアプリから）には何も出さない
  const dt2 = new V.DataTransfer();
  dt2.set('text/plain', new V.DataTransferItem('<div class="agenda">x</div>'));
  assert.strictEqual(await provider.provideDocumentPasteEdits(destDoc, [new V.Range(8, 0, 8, 0)], dt2, {}, {}), undefined);
  stub.disposeContext(ctx);
  fs.rmSync(R.root, { recursive: true, force: true });
});

// ================================================================ レビューで見つけた不具合の再発防止

test('再発防止: CRLF の原稿に LF を混ぜない（印の付け外し・挿入）。付けて外せば 1 バイトも変わらない', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  const bareLF = (s) => (s.match(/(^|[^\r])\n/g) || []).length;
  const deck = crlf(FM('class: teal\n') + '<!-- _class: summary -->\n\n# あ😀\n\n---\n\n# 二枚目 𠮷\n');
  for (const idx of [0, 1]) {
    const e = core.markSlideEdit(deck, idx, { id: 'crlf-1', tags: ['日本語😀'], at: '2026-09-20' });
    const marked = core.applyEdits(deck, [e]);
    assert.strictEqual(bareLF(marked), 0, 'LF が混ざった');
    assert.strictEqual(core.parseDeck(marked).slides[idx].mark.id, 'crlf-1');
    assert.strictEqual(slideStartLines(marked).length, 2);
    const back = core.applyEdits(marked, [core.markSlideEdit(marked, idx, null)]);
    assert.strictEqual(back, deck);
    // 描画も同じ
    const a = render(deck), b = render(marked);
    assert.strictEqual(b.html, a.html);
    assert.deepStrictEqual(b.comments, a.comments);
  }
  // 挿入：元が LF・先が CRLF → 入る本文も frontmatter の追記も CRLF
  const R = mkRepo();
  fs.writeFileSync(R.d1, crlf(fs.readFileSync(R.d1, 'utf8')));
  const plan = core.adaptSlide({ srcMdPath: R.src, slideIndex: 1, destMdPath: R.d1, repoRoot: R.root, afterIndex: 0 });
  const out = core.applyAdaptPlan(plan, { dryRun: true });
  assert.strictEqual(bareLF(out), 0);
  assert.strictEqual(bareLF(plan.slideText), 0);
  assert.strictEqual(slideStartLines(out).length, 3);
  // 元が CRLF・先が LF → LF に揃う。_class の調整（teal を足す）も CRLF の元で効く
  const R2 = mkRepo();
  fs.writeFileSync(R2.src, crlf(fs.readFileSync(R2.src, 'utf8')));
  const p2 = core.adaptSlide({ srcMdPath: R2.src, slideIndex: 1, destMdPath: R2.d1, repoRoot: R2.root, afterIndex: 0 });
  assert.ok(!/\r/.test(p2.slideText));
  assert.match(p2.slideText, /_class: summary teal\n/);
  fs.rmSync(R.root, { recursive: true, force: true });
  fs.rmSync(R2.root, { recursive: true, force: true });
});

test('再発防止: frontmatter の閉じ --- で終わる原稿（改行なし）に印を付けても --- を壊さない', () => {
  const deck = '---\nmarp: true\n---';
  const e = core.markSlideEdit(deck, 0, { id: 'eof', tags: [], at: 'd' });
  const after = core.applyEdits(deck, [e]);
  assert.match(after, /^---\nmarp: true\n---\n<!--\n/);
  assert.strictEqual(core.parseDeck(after).slides[0].mark.id, 'eof');
  // 空の原稿・1 枚だけ・末尾改行なしでも例外を出さない
  for (const t of ['', '# only', FM() + '# only']) {
    const ed = core.markSlideEdit(t, 0, { id: 'one', tags: [], at: 'd' });
    const out = core.applyEdits(t, [ed]);
    assert.strictEqual(core.parseDeck(out).slides.length, 1);
    assert.strictEqual(core.applyEdits(out, [core.markSlideEdit(out, 0, null)]), t);
  }
  assert.throws(() => core.markSlideEdit(FM() + '# a\n', 5, { id: 'x', tags: [], at: 'd' }), /スライド 6 がありません/);
});

test('再発防止: 地の文・見出しに書かれた色コードは var(…) にしない（属性値と <style> の中だけ）', () => {
  const map = new Map([['#c8611c', '--accent']]);
  const src = '# 色 #C8611C\n\n既定は #C8611C です。\n\n<div style="color:#C8611C" data-x=\'#c8611c\'>箱 #C8611C</div>\n\n'
    + '<svg><rect fill="#C8611C"/><text>#C8611C</text></svg>\n\n<style scoped>\n.a { color: #C8611C; }\n</style>\n';
  const r = core.replacePaletteColors(src, map);
  assert.strictEqual(r.count, 4);
  assert.match(r.text, /^# 色 #C8611C\n\n既定は #C8611C です。/);
  assert.match(r.text, />箱 #C8611C<\/div>/);
  assert.match(r.text, /<text>#C8611C<\/text>/);
  assert.match(r.text, /style="color:var\(--accent, #C8611C\)"/);
  assert.match(r.text, /\.a \{ color: var\(--accent, #C8611C\); \}/);
});

test('再発防止: 断片が自分で持つ <style> のルールと、元デック内で重複するルールは二重に運ばない', () => {
  const R = mkRepo();
  const s = path.join(R.root, 'slides', '20260505_SRC_d', '20260505_SRC_d.md');
  fs.mkdirSync(path.dirname(s), { recursive: true });
  fs.writeFileSync(s, ['---', 'marp: true', 'theme: academic', 'style: |', '  .mybox { border: 2px solid blue; }', '  .mybox { border: 2px solid blue }', '  .other { color: red; }', '---', '',
    '<!-- _class: summary -->', '', '<div class="mybox other">箱</div>', '', '<style>', '.other { color: red; }', '</style>', ''].join('\n'));
  const plan = core.adaptSlide({ srcMdPath: s, slideIndex: 0, destMdPath: R.d1, repoRoot: R.root, afterIndex: 0 });
  const css = plan.destEdits.map((e) => e.text).join('');
  assert.strictEqual((css.match(/\.mybox \{/g) || []).length, 1, css);
  assert.ok(!/\.other \{[^}]*\}\n {2}|style: \|[\s\S]*\.other/.test(plan.destEdits[0].text), '本文の <style> にあるルールは frontmatter に足さない');
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('再発防止: 手書きの危ない id（../ や日本語）は台帳に載せず、場所を警告する（サムネイルのファイル名になるため）', () => {
  const R = mkRepo();
  const p = path.join(R.root, 'slides', '20260606_EVIL_e', '20260606_EVIL_e.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '---\nmarp: true\n---\n\n<!--\n_class: a\n_lib: ../../../evil | t | d\n-->\n\n# t\n\n---\n\n<!--\n_class: a\n_lib: 日本語 | t | d\n-->\n');
  const idx = core.buildIndex(R.root);
  assert.ok(idx.entries.every((e) => /^[A-Za-z0-9][\w-]*$/.test(e.id)), JSON.stringify(idx.entries.map((e) => e.id)));
  assert.strictEqual(idx.warnings.filter((w) => /使えません/.test(w)).length, 2);
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('再発防止: diffEdit はサロゲートペアの真ん中で切らない', () => {
  const a = 'x😀y', b = 'x😁y'; // 上位サロゲートが共通
  const e = core.diffEdit(a, b, 10);
  assert.deepStrictEqual(e, { start: 11, end: 13, text: '😁' });
  const c = 'x\u{20BB7}y', d = 'x\u{21BB7}y'; // 下位サロゲートが共通（𠮷 と別の字）
  const e2 = core.diffEdit(c, d, 0);
  assert.deepStrictEqual(e2, { start: 1, end: 3, text: '\u{21BB7}' });
  assert.strictEqual(core.applyEdits(c, [e2]), d);
});

test('再発防止(vscode): CRLF の文書でも印の付け外しが正しい位置に入り、コードフェンス内の見本は marksFor に数えない', async () => {
  const R = mkRepo();
  const { ctx, lib } = setupVscode(R);
  const text = (FM() + '# 一枚目 😀\n\n```html\n<!--\n_class: a\n_lib: sample | | d\n-->\n```\n\n---\n\n<!-- _class: fig -->\n\n# 二枚目\n').replace(/\n/g, '\r\n');
  const p = path.join(R.root, 'slides', '20260707_CRLF_f', '20260707_CRLF_f.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  const doc = stub.makeDocument(text, { fsPath: p });
  const ed = stub.makeEditor(doc, { active: true, line: 0 });
  assert.deepStrictEqual(lib.marksFor(doc), [false, false]);
  const answers = ['crlf-mark', 'タグ'];
  stub.state.inputBoxAnswer = () => answers.shift();
  assert.strictEqual(await lib.toggleMark(ed, 1), true);
  assert.deepStrictEqual(lib.marksFor(doc), [false, true]);
  assert.ok(!/(^|[^\r])\n/.test(doc.getText()), 'LF が混ざった');
  assert.match(doc.getText(), /<!--\r\n_class: fig\r\n_lib: crlf-mark \| タグ \| \d{4}-\d\d-\d\d\r\n-->/);
  assert.strictEqual(await lib.toggleMark(ed, 1), true);
  assert.strictEqual(doc.getText(), text);
  stub.disposeContext(ctx);
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('再発防止: data URI の中の url(%23g) を素材と数えない', () => {
  const css = `.ic { background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><rect fill='url(%23g)'/></svg>"); }\n.bg { background: url(./src/fig01-a.png); }`;
  assert.deepStrictEqual(core.listRefs('<style>\n' + css + '\n</style>').map((r) => r.ref), ['./src/fig01-a.png']);
});

test('再発防止: buildIndex は textOf で渡された未保存の内容を優先する（印を付けた直後・保存前でも台帳に載る）', () => {
  const R = mkRepo();
  const f = path.join(R.root, 'slides', '20260101_SRC_a', '20260101_SRC_a.md');
  const live = fs.readFileSync(f, 'utf8').replace(/_lib: src-agenda/, '_lib: src-agenda-live');
  const idx = core.buildIndex(R.root, { textOf: (p) => (p === f ? live : undefined) });
  assert.ok(idx.entries.some((e) => e.id === 'src-agenda-live' && e.deck.startsWith('slides/')));
  assert.ok(!core.buildIndex(R.root).entries.some((e) => e.id === 'src-agenda-live'), 'ディスクの原稿は変えていない');
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('再発防止: 警告文は利用者が使える名前で案内する（--keep-colors／PNG で takeaway を確認）', () => {
  const src = fs.readFileSync(path.join(EXT, 'lib', 'library-core.cjs'), 'utf8');
  assert.ok(!/にするには keepColors）/.test(src));
  assert.ok(/--keep-colors/.test(src) && /PNG で takeaway と本文の重なりを確認/.test(src));
});

test('再発防止(CLI): --root はコマンドの前でもよい／番号の省略・重複 id の thumbs は理由を言う', () => {
  const { spawnSync } = require('node:child_process');
  const R = mkRepo();
  const cli = path.join(REPO, 'tools', 'marp-library.mjs');
  const run = (...a) => spawnSync(process.execPath, [cli, ...a], { encoding: 'utf8', cwd: os.tmpdir() });
  let r = run('--root', R.root, 'index');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/知らないコマンド/.test(r.stdout + r.stderr));
  assert.ok(fs.existsSync(path.join(R.root, 'slides', '_library', 'index.json')));
  r = run('mark', path.join(R.root, 'slides', '20260101_SRC_a', '20260101_SRC_a.md'), '--root', R.root);
  assert.strictEqual(r.status, 1);
  assert.ok(/番号が要ります/.test(r.stderr) && !/undefined/.test(r.stderr), r.stderr);
  r = run('thumbs', 'src-agenda', '--root', R.root);
  assert.ok(/重複しているので描きません/.test(r.stdout), r.stdout);
  fs.rmSync(R.root, { recursive: true, force: true });
});

// ───────────────────────── 7.2 元の組版を保つ（keepTypo） ─────────────────────────

/** academic の元デック（sec-box・callout・表・デック固有の .attr と feat3）と、tsutawaru / academic / parts-deck の貼り付け先 */
function mkTypoRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-kt-test-'));
  fs.mkdirSync(path.join(root, 'theme'));
  for (const n of fs.readdirSync(path.join(REPO, 'theme'))) {
    if (n.endsWith('.css')) fs.copyFileSync(path.join(REPO, 'theme', n), path.join(root, 'theme', n));
  }
  const w = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };
  const src = w('slides/20260101_KT_src/20260101_KT_src.md', [
    '---', 'marp: true', 'theme: academic', 'paginate: true', 'style: |',
    '  section.feat3 .sec-box { padding: 8px 22px; }',
    '  .attr { font-size: 15px; color: #777; }',
    '---', '',
    '<!-- _class: summary feat3 -->', '', '## 三つの特徴', '',
    '<div class="sections">', '<div class="sec-box">', '', '### ① 見出し', '', '- 箇条書き', '', '</div>', '</div>', '',
    '<div class="callout-gray">補足の囲み</div>', '',
    '<div class="attr">出典：どこか</div>', '',
    '<div class="takeaway">要点</div>', '',
    '---', '', '## 表の枚', '', '| a | b |', '|---|---|', '| 1 | 2 |', '',
    '<style scoped>', 'td { color: red; }', '</style>', '',
    '---', '', '## 部品の枚', '', '<div class="stepbox"><div class="st">① 手順</div></div>', '',
  ].join('\n'));
  const parts = w('slides/20260101_KT_parts/20260101_KT_parts.md', ['---', 'marp: true', 'theme: parts-deck', '---', '', '# 部品', '', '<div class="flowrow"><div class="fbox blue">箱</div></div>', ''].join('\n'));
  const dest = (name, theme) => w(`slides/${name}/${name}.md`, ['---', 'marp: true', `theme: ${theme}`, 'paginate: true', '---', '', '# 先頭', ''].join('\n'));
  return { root, src, parts, tsu: dest('20260102_KT_tsu', 'tsutawaru-academic'), aca: dest('20260102_KT_aca', 'academic'), cd: dest('20260102_KT_cd', 'parts-deck') };
}
const ktBlock = (t) => (/\/\* ss-keep-typo:start[\s\S]*?ss-keep-typo:end \*\//.exec(t) || [''])[0];

test('keepTypo：付けなければ本文は従来と 1 バイトも変わらない。勧めの警告は実測済みの組み合わせ（academic→tsutawaru）だけ', () => {
  const R = mkTypoRepo();
  const base = { srcMdPath: R.src, slideIndex: 0, repoRoot: R.root, afterIndex: 0 };
  const off = core.adaptSlide({ ...base, destMdPath: R.tsu });
  const off2 = core.adaptSlide({ ...base, destMdPath: R.tsu, keepTypo: false });
  assert.equal(off.slideText, off2.slideText);
  assert.deepEqual(off.destEdits, off2.destEdits);
  assert.ok(!/ss-keep-typo/.test(off.slideText));
  assert.equal(off.info.keepTypo, 0);
  assert.ok(off.warnings.some((w) => /元の組版を保つ/.test(w) && /収まりやすい/.test(w)), off.warnings.join('\n'));
  // 選んだときは勧めない
  const on = core.adaptSlide({ ...base, destMdPath: R.tsu, keepTypo: true });
  assert.ok(!on.warnings.some((w) => /収まりやすい/.test(w)));
  // keepTypo の塊を除けば、本文は付けないときと同じ
  assert.equal(on.slideText.replace(/\/\* ss-keep-typo:start[\s\S]*?ss-keep-typo:end \*\/\n/, '').trim(), off.slideText.trim());
  // 同じテーマ・実測していない組み合わせでは勧めない
  for (const d of [R.aca, R.cd]) {
    const p = core.adaptSlide({ ...base, destMdPath: d });
    assert.ok(!p.warnings.some((w) => /収まりやすい/.test(w)), d);
  }
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('keepTypo：academic→tsutawaru は縦の寸法だけを <style scoped> に持ち込む。題・枠・配色・デック固有クラスには触らない', () => {
  const R = mkTypoRepo();
  const plan = core.adaptSlide({ srcMdPath: R.src, slideIndex: 0, destMdPath: R.tsu, repoRoot: R.root, afterIndex: 0, keepTypo: true });
  const b = ktBlock(plan.slideText);
  assert.ok(b, plan.slideText);
  assert.ok(plan.info.keepTypo > 0);
  assert.match(b, /ss-keep-typo:start academic → tsutawaru-academic/);
  assert.match(b, /\nsection \{[^}]*line-height: 1\.55;[^}]*letter-spacing: 0\.01em;/);
  assert.match(b, /--measure: none/);
  // 見出し h3 の行送りは Marp 同梱 default の 1.25（academic は書いていない）
  assert.match(b, /section :where\(h3\) \{[^}]*line-height: 1\.25;/);
  // 囲み部品は元テーマの余白に
  assert.match(b, /section\.summary \.sec-box \{[^}]*padding-top: 12px; padding-bottom: 12px;/);
  // 運んだデック固有の調整（feat3）は、その後ろで効かせ直す
  const iTheme = b.indexOf('section.summary .sec-box {'), iDeck = b.indexOf('section.feat3 .sec-box { padding-top: 8px; padding-bottom: 8px; }');
  assert.ok(iDeck > iTheme && iTheme >= 0, b);
  // 触らないもの：スライドの題（h1/h2）・takeaway・page-title・ヘッダ・色・横の余白・min-height:0・デックが自前で定義した .attr
  assert.ok(!/:where\(h[12]\)/.test(b), b);
  assert.ok(!/takeaway|page-title|header|footer|hdr-/.test(b), b);
  assert.ok(!/color|background|border|padding-left|padding-right|margin-left|margin-right/.test(b), b);
  assert.ok(!/min-height: 0/.test(b), b);
  assert.ok(!/\.attr/.test(b), b);
  // 使っていない要素（表）のルールは入れない
  assert.ok(!/table|\btd\b|\bth\b/.test(b), b);
  // 描画できて、scoped になっている（ほかのスライドへ漏れない）
  const after = core.applyAdaptPlan(plan, { dryRun: true });
  const out = render(after);
  assert.match(out.css, /section\[data-marpit-scope-[^\]]+\][^{]*\{[^}]*line-height:\s*1\.55/);
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('keepTypo：既にある <style scoped> にまとめる。2 回目の挿入（貼り付け先から別の先へ）でも二重にならない', () => {
  const R = mkTypoRepo();
  const plan = core.adaptSlide({ srcMdPath: R.src, slideIndex: 1, destMdPath: R.tsu, repoRoot: R.root, afterIndex: 0, keepTypo: true });
  assert.equal((plan.slideText.match(/<style scoped>/g) || []).length, 1, plan.slideText);
  assert.match(plan.slideText, /td \{ color: red; \}\n\/\* ss-keep-typo:start/);
  assert.match(ktBlock(plan.slideText), /:where\(table\)/);
  // 入れた先から、もう一度 tsutawaru の別デックへ：塊は 1 つのまま・元テーマ名も覚えている
  const after = core.applyAdaptPlan(plan);
  const again = path.join(R.root, 'slides', '20260103_KT_tsu2', '20260103_KT_tsu2.md');
  fs.mkdirSync(path.dirname(again), { recursive: true });
  fs.writeFileSync(again, '---\nmarp: true\ntheme: tsutawaru-academic\n---\n\n# 先頭\n');
  const p2 = core.adaptSlide({ srcMdPath: R.tsu, srcText: after, slideIndex: 1, destMdPath: again, repoRoot: R.root, afterIndex: 0, keepTypo: true });
  assert.equal((p2.slideText.match(/ss-keep-typo:start/g) || []).length, 1, p2.slideText);
  assert.equal((p2.slideText.match(/<style scoped>/g) || []).length, 1);
  assert.match(p2.slideText, /ss-keep-typo:start academic → tsutawaru-academic/);
  assert.equal(ktBlock(p2.slideText), ktBlock(plan.slideText));
  // 元のテーマ（academic）の先へ入れ直すと、持ち込みは要らないので塊ごと消える（デック自身の scoped は残る）
  const p3 = core.adaptSlide({ srcMdPath: R.tsu, srcText: after, slideIndex: 1, destMdPath: R.aca, repoRoot: R.root, afterIndex: 0, keepTypo: true });
  assert.ok(!/ss-keep-typo/.test(p3.slideText), p3.slideText);
  assert.match(p3.slideText, /td \{ color: red; \}/);
  fs.rmSync(R.root, { recursive: true, force: true });
});

test('keepTypo：同じテーマなら何もしない。貼り付け先に部品が無い組み合わせは何もせず理由を warnings に', () => {
  const R = mkTypoRepo();
  const same = core.adaptSlide({ srcMdPath: R.src, slideIndex: 0, destMdPath: R.aca, repoRoot: R.root, afterIndex: 0, keepTypo: true });
  assert.ok(!/ss-keep-typo/.test(same.slideText));
  assert.equal(same.info.keepTypo, 0);
  // parts-deck の部品（flowrow / fbox）は academic に無い → 組版だけ戻しても形は戻らない
  const p = core.adaptSlide({ srcMdPath: R.parts, slideIndex: 0, destMdPath: R.aca, repoRoot: R.root, afterIndex: 0, keepTypo: true });
  assert.ok(!/ss-keep-typo/.test(p.slideText), p.slideText);
  // 配布版には parts-deck（部品テーマ）が無いので「theme/ に無い」の理由になる。本体では「部品が無い」の理由
  assert.ok(p.warnings.some((w) => (/元の組版は持ち込みません/.test(w) && /\.flowrow|\.fbox/.test(w)) || /theme\/ に無い/.test(w)), p.warnings.join('\n'));
  // theme/ に無いテーマ
  const odd = path.join(R.root, 'slides', '20260104_KT_odd', '20260104_KT_odd.md');
  fs.mkdirSync(path.dirname(odd), { recursive: true });
  fs.writeFileSync(odd, '---\nmarp: true\ntheme: gaia\n---\n\n# 先頭\n');
  const q = core.adaptSlide({ srcMdPath: R.src, slideIndex: 0, destMdPath: odd, repoRoot: R.root, afterIndex: 0, keepTypo: true });
  assert.ok(!/ss-keep-typo/.test(q.slideText));
  assert.ok(q.warnings.some((w) => /theme\/ に無い/.test(w)), q.warnings.join('\n'));
  fs.rmSync(R.root, { recursive: true, force: true });
});
