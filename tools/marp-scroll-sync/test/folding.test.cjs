// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// lib/folding.cjs（純粋）と lib/folding-vscode.cjs（vscode スタブ上）のテスト。
//   node --test tools/marp-scroll-sync/test/folding.test.cjs
// 見本デック（slides/ の sample-*）は読むだけ（原本は書き換えない）。畳んだ表示の模擬は FOLDED_VIEW_OUT に書き出す。
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const F = require('../lib/folding.cjs');
const S = require('../lib/slide-split.cjs');

const REPO = path.resolve(__dirname, '..', '..', '..');
const DECKS = [
  'sample-lecture',   // frontmatter に style: がある（畳む範囲の試験に要る）
  'sample-layouts',
  'sample-parts',
].map(d => path.join(REPO, 'slides', d, d + '.md'));
const readDeck = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

// ---------------------------------------------------------------------------
// marp-core（extension.js の renderDeck と同じ条件）
// ---------------------------------------------------------------------------
let _Marp = null;
function newMarp() {
  if (!_Marp) _Marp = require(path.resolve(__dirname, '..', 'node_modules', '@marp-team', 'marp-core')).Marp;
  const marp = new _Marp({ html: true });
  const dir = path.join(REPO, 'theme');
  const names = fs.readdirSync(dir).filter(n => n.endsWith('.css'))
    .sort((a, b) => (a === 'academic.css' ? -1 : b === 'academic.css' ? 1 : a.localeCompare(b)));
  for (const n of names) { try { marp.themeSet.add(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (_) { /* 任意 */ } }
  return marp;
}
const visibleText = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, '');
function applyEdits(text, edits) {
  let t = text;
  for (const e of edits.slice().sort((a, b) => b.start - a.start)) t = t.slice(0, e.start) + e.text + t.slice(e.end);
  return t;
}

/** VS Code が捨てない形か：start<end、同じ開始行が無い、部分的な重なりが無い（入れ子か離れているかだけ） */
function assertNested(ranges, label) {
  const sorted = ranges.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  const starts = new Set();
  const stack = [];
  for (const r of sorted) {
    assert.ok(r.start < r.end, `${label}: 1行の範囲 ${JSON.stringify(r)}`);
    assert.ok(!starts.has(r.start), `${label}: 開始行が重複 ${r.start}`);
    starts.add(r.start);
    while (stack.length && stack[stack.length - 1].end < r.start) stack.pop();
    const top = stack[stack.length - 1];
    if (top) assert.ok(r.end <= top.end, `${label}: 交差 ${JSON.stringify(top)} × ${JSON.stringify(r)}`);
    stack.push(r);
  }
}

// ---------------------------------------------------------------------------
// 合成デック
// ---------------------------------------------------------------------------
const DECK = [
  '---',                                   // 0
  'marp: true',                            // 1
  'theme: academic',                       // 2
  'style: |',                              // 3
  '  .agenda { color: red; }',             // 4
  '',                                      // 5
  '  .agenda-row { margin: 0; }',          // 6
  'paginate: true',                        // 7
  '---',                                   // 8
  '',                                      // 9
  '<!-- _class: cover-hero -->',           // 10
  '',                                      // 11
  '# 表紙のタイトル',                        // 12
  '',                                      // 13
  '---',                                   // 14  スライド2
  '',                                      // 15
  '<!--',                                  // 16
  '_class: split',                         // 17
  '_lib: demo-split | 構成 | 2026-09-20',   // 18
  '-->',                                   // 19
  '',                                      // 20
  '<div class="page-title">今回の構成</div>', // 21
  '',                                      // 22
  '<div class="split-body"><div class="left">', // 23
  '',                                      // 24
  '- 左の文',                               // 25
  '',                                      // 26
  '</div><div class="right">',             // 27
  '<svg viewBox="0 0 10 10">',             // 28
  '<g><svg x="1"><rect/></svg></g>',       // 29 入れ子（1行で完結）
  '<svg x="2">',                           // 30 入れ子（複数行）
  '<rect/>',                               // 31
  '</svg>',                                // 32
  '</svg>',                                // 33
  '</div></div>',                          // 34
  '',                                      // 35
  '<!--',                                  // 36 発表者ノート
  'ここで構成を話す。',                       // 37
  '-->',                                   // 38
  '',                                      // 39
  '---',                                   // 40  スライド3
  '',                                      // 41
  '<style scoped>',                        // 42
  '.x { color: blue; }',                   // 43
  '</style>',                              // 44
  '',                                      // 45
  '```html',                               // 46
  '<svg>',                                 // 47 フェンス内は無視
  '',                                      // 48
  '---',                                   // 49 フェンス内の --- は区切りでない
  '</svg>',                                // 50
  '```',                                   // 51
  '',                                      // 52
  '<style>.y{color:red}</style>',          // 53 1行は範囲にしない
  '',                                      // 54
  '---',                                   // 55  スライド4（1行だけ）
  '# 一言',                                 // 56
].join('\n');

test('foldingRanges: スライド・frontmatter style・style・svg（入れ子）・ノート', () => {
  const r = F.foldingRanges(DECK);
  assertNested(r, 'synthetic');
  const pick = (kind) => r.filter(x => x.kind === kind).map(x => [x.start, x.end, x.slide]);
  assert.deepStrictEqual(pick('frontmatter-style'), [[3, 6, -1]]);
  // 1枚目は本文の最初の空でない行から。区切りの前の空行まで含める（畳むと --- が隙間なく並ぶ）
  assert.deepStrictEqual(pick('slide'), [[10, 13, 0], [14, 39, 1], [40, 54, 2], [55, 56, 3]]);
  assert.deepStrictEqual(pick('svg'), [[28, 33, 1], [30, 32, 1]]);
  assert.deepStrictEqual(pick('style'), [[42, 44, 2]]);
  // ディレクティブだけのコメント（16-19）は畳まない。ノート（36-38）は畳む
  assert.deepStrictEqual(pick('notes'), [[36, 38, 1]]);
});

test('foldingRanges: trimTrailingBlank で末尾の空行を範囲から外せる', () => {
  const r = F.foldingRanges(DECK, { trimTrailingBlank: true }).filter(x => x.kind === 'slide').map(x => [x.start, x.end]);
  assert.deepStrictEqual(r, [[10, 12], [14, 38], [40, 53], [55, 56]]);
});

test('foldingRanges: frontmatter なし・CRLF・空の原稿でも落ちない', () => {
  assert.deepStrictEqual(F.foldingRanges(''), []);
  const r = F.foldingRanges('# a\r\n\r\n本文\r\n\r\n---\r\n\r\n# b\r\n本文\r\n');
  assert.deepStrictEqual(r.map(x => [x.start, x.end, x.kind]), [[0, 3, 'slide'], [4, 7, 'slide']]);
  // 閉じ忘れの <svg> は次のスライドへ持ち越さない
  const r2 = F.foldingRanges('<svg>\n<rect/>\n\n---\n\n<svg>\n<rect/>\n</svg>\n');
  assert.deepStrictEqual(r2.filter(x => x.kind === 'svg').map(x => [x.start, x.end]), [[5, 7]]);
});

test('slideLabels: 番号｜クラス｜タイトル ★', () => {
  const l = F.slideLabels(DECK);
  assert.deepStrictEqual(l, [
    { line: 10, index: 0, text: '1 ｜ cover-hero ｜ 表紙のタイトル' },
    { line: 14, index: 1, text: '2 ｜ split ｜ 今回の構成 ★' },
    { line: 40, index: 2, text: '3' },
    { line: 55, index: 3, text: '4 ｜ 一言' },
  ]);
  // ラベルの行は、折りたたみ範囲の開始行と同じ（畳んだ行にラベルが残る）
  const starts = new Set(F.foldingRanges(DECK).filter(r => r.kind === 'slide').map(r => r.start));
  for (const x of l) assert.ok(starts.has(x.line), `line ${x.line}`);
});

test('panelLabels: 辞書・見出しの添え書き・split の左右・既存コメントの行は出さない', () => {
  const md = [
    '<div class="split-body">',                       // 0
    '<div>',                                          // 1 クラス無しでも1つ目＝左
    '',
    '### 左の見出し',
    '',
    '</div>',
    '<div class="fig-area">',                         // 6 2つ目＝右＋辞書
    '<img src="./src/fig01-x.png">',
    '</div>',
    '</div>',
    '',
    '<div class="sections">',                         // 11
    '<div class="sec-box">',                          // 12
    '<h3>あいうえおかきくけこさしすせそたちつてとなにぬねの</h3>', // 13
    '</div>',
    '<div class="sec-box"> <!-- 自分で書いたラベル -->',   // 15 出さない
    '</div>',
    '</div>',
    '',
    '<div class="cardrow"><div class="pcard"><div class="pc-h">要点A</div>本文</div></div>', // 19 1行で完結
    '',
    '<div class="box-accent">',                       // 21
    '',
    '**結論**：こうする',
    '',
    '</div>',
    '',
    '文の途中の <span class="takeaway">これは区画ではない</span>',
    '',
    '<div class="takeaway">要点</div>',               // 29
  ].join('\n');
  const got = F.panelLabels(md).map(x => [x.line, x.text, x.multiline]);
  assert.deepStrictEqual(got, [
    [0, '左右2分割', true],
    [1, '◀ 左パネル', true],
    [6, '▶ 右パネル・図の領域', true],
    [11, 'まとめ枠の並び', true],
    [12, 'まとめ枠：あいうえおかきくけこさしすせそたちつてと…', true],
    [19, 'カードの並び', false],
    [21, '強調の枠：結論', true],
    [29, '要点の帯', false],
  ]);
  // 1行に開始タグが複数ある書き方（手で書いたデックに多い）
  const two = F.panelLabels(DECK).filter(x => x.line === 23 || x.line === 27).map(x => [x.line, x.text]);
  assert.deepStrictEqual(two, [[23, '左右2分割 › ◀ 左パネル'], [27, '▶ 右パネル']]);
  // style / svg / フェンス / コメントの中は見ない
  assert.deepStrictEqual(F.panelLabels('```html\n<div class="left">\n```\n\n<!--\n<div class="left">\n-->\n'), []);
});

test('planWritePanelLabels: 開始タグと同じ行の行末にだけ書く。描画とノートは変わらない', () => {
  const marp = newMarp();
  const before = marp.render(DECK);
  const edits = F.planWritePanelLabels(DECK);
  assert.ok(edits.length >= 2, '書ける区画がある');
  const lineOfOffset = (o) => DECK.slice(0, o).split('\n').length - 1;
  for (const e of edits) {
    assert.strictEqual(e.start, e.end, '挿入だけ');
    assert.match(e.text, /^ <!-- [^\n]+ -->$/);
    assert.ok(!/--/.test(e.text.slice(5, -4)), 'ラベルの中に -- が無い');
    // 行末（次の文字が改行か終端）で、その行はタグで始まり開始タグを含む＝単独行のコメントにはならない
    assert.ok(e.start === DECK.length || DECK[e.start] === '\n', '行末');
    assert.match(DECK.split('\n')[lineOfOffset(e.start)], /^\s*<\/?[A-Za-z].*<[A-Za-z]|^\s*<[A-Za-z]/);
  }
  const written = applyEdits(DECK, edits);
  assert.strictEqual(written.split('\n').length, DECK.split('\n').length, '行数は変わらない');
  const after = newMarp().render(written);
  assert.deepStrictEqual(after.comments, before.comments, '発表者ノートが増えない');
  assert.strictEqual(visibleText(after.html), visibleText(before.html), 'HTML のテキストが変わらない');
  // 2回目は何も書かない（同じ行にコメントがある）
  assert.deepStrictEqual(F.planWritePanelLabels(written), []);
  // slideRange で絞れる（スライド3以降には区画が無い）
  assert.deepStrictEqual(F.planWritePanelLabels(DECK, [40, 57]), []);
  // CRLF：\r の手前に入る
  const crlf = '<div class="left">\r\n\r\n文\r\n\r\n</div>\r\n';
  const ce = F.planWritePanelLabels(crlf);
  assert.strictEqual(ce.length, 1);
  assert.strictEqual(applyEdits(crlf, ce), '<div class="left"> <!-- ◀ 左パネル -->\r\n\r\n文\r\n\r\n</div>\r\n');
});

test('planWritePanelLabels: ノートに混入しうる行（段落の途中の span など）には書かない', () => {
  const md = '# t\n\n段落の文\n<span class="takeaway">\n続き\n</span>\n\n    <div class="left">\n    コード\n';
  const edits = F.planWritePanelLabels(md);
  const written = applyEdits(md, edits);
  const a = newMarp().render(md), b = newMarp().render(written);
  assert.deepStrictEqual(b.comments, a.comments);
  assert.strictEqual(visibleText(b.html), visibleText(a.html));
});

// レビューで見つけた反例。どれも「html_block の中だ」と誤認して書くと、ラベルが発表者ノートに入るか、中身が変わる。
test('planWritePanelLabels: 種別1ブロックの直後・script/textarea・数式・タブ字下げには書かない（反例）', () => {
  const FM = '---\nmarp: true\ntheme: academic\n---\n\n';
  const cases = {
    // </style> </pre> の行で html_block は終わる。次の <span> だけの行は新しい種別7で、コメントを足すと段落になりノートに入る
    afterStyle: '# t\n\n<style>\n.a{}\n</style>\n<span class="takeaway">\ntext\n</span>\n',
    afterPre: '# t\n\n<pre>\ncode\n</pre>\n<span class="takeaway">\ntext\n</span>\n',
    // ノートの中の <div> を html_block の開始と数えない
    afterNoteWithDiv: '# t\n\n<!--\n<div>old</div>\n-->\n<span class="takeaway">\ntext\n</span>\n',
    // 中身がそのまま使われる要素：コメントを足すと JS・入力欄の中身が変わる
    inScript: '# t\n\n<script>\nconst s = `\n<div class="left">\nx\n</div>`;\n</script>\n',
    inTextarea: '# t\n\n<textarea>\n<div class="left">\nx\n</div>\n</textarea>\n',
    // 数式ブロックとタブ字下げ（＝コードブロック）では、書いたコメントが文字として出る
    mathBlock: '$$\n<div class="left">\nx\n$$\n',
    tabIndent: '\t<div class="left">\n\tx\n\t</div>\n',
  };
  for (const [name, body] of Object.entries(cases)) for (const eol of ['\n', '\r\n']) {
    const md = (FM + body).replace(/\n/g, eol);
    assert.deepStrictEqual(F.planWritePanelLabels(md), [], `${name} ${JSON.stringify(eol)}`);
  }
  // 逆に、書いてよい所は今までどおり書ける（描画・ノート・ページ分割が変わらないことも確かめる）
  const okCases = {
    inDivAfterNote: '<div class="body">\n<!--\nnote\n-->\n<span class="takeaway">\ntext\n</span>\n</div>\n',
    paraThenDiv: '文章\n<div class="left">\n\nx\n\n</div>\n',
    inList: '- item\n  <div class="left">\n  x\n  </div>\n',
    emoji: '# 😀𠮷\n\n😀😀<b>x</b>\n\n<div class="left">\n\n𠮷野家😀\n\n</div>\n',
    noTrailingNewline: '# t\n\n<div class="left">\n\nx\n\n</div>',
    lastLineOpen: '# t\n\n<div class="left">',
    dupes: '<div class="left">\n\nx\n\n</div>\n\n<div class="left">\n\nx\n\n</div>\n\n---\n\n<div class="left">\n\nx\n\n</div>\n',
    headWithDashes: '<div class="box-info">\n\n### a -- b --> c\n\n</div>\n',
    attrWithGt: '<div class="left" title="a > b">\n\nx\n\n</div>\n',
    trailingSpaces: '<div class="left">  \n\nx\n\n</div>\n',
    afterStyleDiv: '<style>\n.a{}\n</style>\n<div class="left">\n\nx\n\n</div>\n',
  };
  const scopeless = (h) => h.replace(/data-marpit-scope-\w+/g, 'S').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, '');
  for (const [name, body] of Object.entries(okCases)) for (const eol of ['\n', '\r\n']) {
    const md = (FM + body).replace(/\n/g, eol);
    const edits = F.planWritePanelLabels(md);
    assert.ok(edits.length >= 1, `${name}: 書ける`);
    for (const e of edits) assert.ok(e.start === md.length || /[\r\n \t]/.test(md[e.start]), `${name}: 行末（か行末の空白の手前）`);
    const written = applyEdits(md, edits);
    const a = newMarp().render(md), b = newMarp().render(written);
    assert.deepStrictEqual(b.comments, a.comments, `${name}: ノート`);
    assert.strictEqual(scopeless(b.html), scopeless(a.html), `${name}: コメント以外の HTML 全体`);
    assert.deepStrictEqual(S.slideStartLines(written), S.slideStartLines(md), `${name}: ページ分割`);
    assert.deepStrictEqual(F.planWritePanelLabels(written), [], `${name}: 2回目は書かない`);
  }
  // 重複する同じ行でも、それぞれの行末に入る（同じ場所に2回書かない）
  const d = F.planWritePanelLabels(FM + okCases.dupes);
  assert.strictEqual(new Set(d.map(e => e.start)).size, 3);
  // サロゲートペアの後ろでもオフセットは UTF-16 のまま（行末に入る）
  const em = FM + okCases.emoji;
  assert.strictEqual(applyEdits(em, F.planWritePanelLabels(em)).split('\n')[9], '<div class="left"> <!-- ◀ 左パネル -->');
});

test('leakyLabelComments: marp-core が実際にノートへ入れるものと一致する（反例）', () => {
  const FM = '---\nmarp: true\n---\n\n';
  const cases = {
    afterStyle: '<style>\n.a{}\n</style>\n<!-- ラベルA -->\n',
    afterNoteWithDiv: '<!--\n<div>old</div>\n-->\n<!-- ラベルB -->\n',
    inDivAfterComment: '<div>\n<!-- a. -->\n<!-- ラベルC -->\n</div>\n',
    inDivAfterMulti: '<div>\n<!--\nnote\n-->\n<!-- ラベルD -->\n</div>\n',
    tab: '\t<!-- ラベルE -->\n',
    afterHeading: '# h\n<!-- ラベルF -->\n',
    inPara: '文\n<!-- ラベルG -->\n続き\n',
    inList: '- a\n  <!-- ラベルH -->\n',
    math: '$$\n<!-- ラベルI -->\n$$\n',
    afterHeadingSpan: '# h\n<span>\n<!-- ラベルJ -->\n</span>\n',
    inPre: '<pre>\n\n<!-- ラベルK -->\n</pre>\n',
  };
  for (const [name, body] of Object.entries(cases)) {
    const md = FM + body;
    const real = newMarp().render(md).comments.flat().filter(c => /ラベル/.test(c));
    assert.deepStrictEqual(F.leakyLabelComments(md).map(x => x.text), real, name);
  }
});

test('leakyLabelComments: 単独行の短いコメントと #region だけ', () => {
  const md = [
    '<!-- 左パネル -->',                 // 0 ○
    '',
    '<!-- _class: split -->',            // 2 × ディレクティブ
    '',
    '<!-- ここで構成を話す。 -->',          // 4 × 句点あり＝ノート
    '',
    '<!-- #region 図 -->',               // 6 ○
    '',
    '<!-- #endregion -->',               // 8 ○
    '',
    '<div class="left"> <!-- 左 -->',    // 10 × 同じ行＝混入しない
    '<!-- 中のラベル -->',                // 11 × html_block の中＝混入しない
    '</div>',
    '',
    '<!-- あいうえおかきくけこさしすせそたちつてとな -->', // 14 × 21字
    '',
    '```',
    '<!-- コード例 -->',                  // 17 × フェンス内
    '```',
  ].join('\n');
  assert.deepStrictEqual(F.leakyLabelComments(md), [
    { line: 0, text: '左パネル' }, { line: 6, text: '#region 図' }, { line: 8, text: '#endregion' },
  ]);
  // 実際にノートへ入るのはこの3つ（と、ラベルではない 4 と 14）であることを marp-core で確かめる
  const { comments } = newMarp().render(md);
  const flat = comments.flat();
  for (const t of ['左パネル', '#region 図', '#endregion']) assert.ok(flat.includes(t), t);
  for (const t of ['左', '中のラベル', 'コード例']) assert.ok(!flat.includes(t), t);
});

test('nextFoldActions: 初回・切り替え・開いたスライドの中の style/svg は畳んだまま', () => {
  const ranges = F.foldingRanges(DECK);
  const kinds = ['style', 'svg'];
  const first = F.nextFoldActions({ ranges, prevSlide: null, curSlide: 1, kinds });
  // cur(=2枚目, 14行) 以外のスライドと、全部の style / svg / frontmatter の style
  assert.deepStrictEqual(first.fold.slice().sort((a, b) => a - b), [3, 10, 28, 30, 40, 42, 55]);
  assert.deepStrictEqual(first.unfold, [14]); // 今のスライドは（復元された状態で畳まれていても）開く
  const move = F.nextFoldActions({ ranges, prevSlide: 1, curSlide: 2, kinds });
  assert.deepStrictEqual(move, { fold: [14, 42], unfold: [40] });
  const back = F.nextFoldActions({ ranges, prevSlide: 2, curSlide: 1, kinds: ['style', 'svg', 'notes'] });
  assert.deepStrictEqual(back, { fold: [40, 28, 30, 36], unfold: [14] });
  assert.deepStrictEqual(F.nextFoldActions({ ranges, prevSlide: 1, curSlide: 1, kinds }), { fold: [], unfold: [] });
  // kinds が空ならスライドだけ
  assert.deepStrictEqual(F.nextFoldActions({ ranges, prevSlide: 0, curSlide: 3, kinds: [] }), { fold: [10], unfold: [55] });
  // 範囲を持たないスライド（1行だけ）の行は返さない
  const tiny = F.foldingRanges('# a\n\n---\n\n# b\n\n本文\n');
  assert.deepStrictEqual(F.nextFoldActions({ ranges: tiny, prevSlide: 1, curSlide: 0, kinds }), { fold: [2], unfold: [0] });
});

test('slideHeads / slideIndexAt: 区切り行は次のスライドに数える', () => {
  const heads = F.slideHeads(DECK);
  assert.deepStrictEqual(heads, [0, 14, 40, 55]);
  assert.strictEqual(F.slideIndexAt(heads, 13), 0);
  assert.strictEqual(F.slideIndexAt(heads, 14), 1);
  assert.strictEqual(F.slideIndexAt(heads, 49), 2); // フェンス内の --- は区切りでない
  assert.strictEqual(F.slideIndexAt(heads, 56), 3);
  assert.strictEqual(F.slideAtLine(DECK, 14), 1);
});

// ---------------------------------------------------------------------------
// 実デック
// ---------------------------------------------------------------------------
const FOLDED_VIEW_OUT = process.env.FOLDED_VIEW_OUT || '';
const report = [];

for (const p of DECKS) {
  const name = path.basename(p);
  const text = readDeck(p);
  test(`実デック ${name}: 範囲が入れ子を壊さず、slideStartLines と整合する`, { skip: text === null && 'デックが無い' }, () => {
    const lines = text.split(/\r?\n/);
    const ranges = F.foldingRanges(text);
    assertNested(ranges, name);
    const starts = S.slideStartLines(text);
    const slides = ranges.filter(r => r.kind === 'slide');
    // 2行以上あるスライドは全部範囲になる
    const bySlide = new Map(slides.map(r => [r.slide, r]));
    for (let i = 0; i < starts.length; i++) {
      const r = bySlide.get(i);
      const bodyEnd = (starts[i + 1] !== undefined ? starts[i + 1] - 1 : lines.length) - 1; // 次の --- の前の行
      if (!r) { assert.ok(bodyEnd - starts[i] < 2, `slide ${i + 1} に範囲が無い`); continue; }
      if (i === 0) {
        assert.ok(r.start >= starts[0], '1枚目は本文の先頭行から');
        assert.ok(lines.slice(starts[0], r.start).every(l => l.trim() === ''), '先頭の空行だけを飛ばす');
      } else {
        assert.strictEqual(r.start, starts[i] - 1, `slide ${i + 1} は区切り行から`);
        assert.match(lines[r.start], /^---+\s*$/);
      }
      if (i < starts.length - 1) assert.strictEqual(r.end, bodyEnd, `slide ${i + 1} は次の --- の前の行まで`);
      else assert.ok(r.end <= bodyEnd);
    }
    // スライド以外の範囲は、どれか1枚のスライド（か frontmatter）に収まる
    for (const r of ranges) {
      if (r.kind === 'slide') continue;
      if (r.kind === 'frontmatter-style' || r.kind === 'frontmatter-style-all') { assert.ok(r.end < starts[0] - 1); continue; }
      const host = bySlide.get(r.slide);
      assert.ok(host && host.start <= r.start && r.end <= host.end, `${r.kind} ${r.start}-${r.end} がスライド ${r.slide + 1} に収まらない`);
    }
    // ラベルは全スライドに1つずつ、範囲の開始行に付く
    const labels = F.slideLabels(text);
    assert.strictEqual(labels.length, starts.length);
    for (const l of labels) { const r = bySlide.get(l.index); if (r) assert.strictEqual(l.line, r.start); }

    // 畳んだ表示の模擬：3枚目を開いた状態（他のスライドと style / svg は畳む）
    const cur = Math.min(2, starts.length - 1);
    const act = F.nextFoldActions({ ranges, prevSlide: null, curSlide: cur, kinds: ['style', 'svg'] });
    const vis = F.visibleLines(lines.length, ranges, act.fold);
    const allFolded = F.visibleLines(lines.length, ranges, ranges.filter(r => r.kind === 'slide' || r.kind === 'frontmatter-style').map(r => r.start));
    assert.ok(vis.length < lines.length / 2, `${lines.length} → ${vis.length}`);
    report.push({ name, lines: lines.length, slides: starts.length, open3: vis.length, allFolded: allFolded.length, vis, text: lines, labels, panel: F.panelLabels(text), folded: new Set(act.fold) });
  });

  test(`実デック ${name}: パネルラベルを書いても描画とノートが変わらない`, { skip: text === null && 'デックが無い' }, () => {
    const edits = F.planWritePanelLabels(text);
    assert.ok(edits.length > 0);
    const written = applyEdits(text, edits);
    assert.strictEqual(written.split(/\r?\n/).length, text.split(/\r?\n/).length);
    const a = newMarp().render(text), b = newMarp().render(written);
    assert.strictEqual(b.comments.length, a.comments.length, '枚数');
    assert.deepStrictEqual(b.comments, a.comments, '発表者ノート');
    assert.strictEqual(visibleText(b.html), visibleText(a.html), 'テキスト');
    // 書いたあとは、折りたたみ範囲もスライド分割も変わらない
    assert.deepStrictEqual(S.slideStartLines(written), S.slideStartLines(text));
    assert.deepStrictEqual(F.foldingRanges(written), F.foldingRanges(text));
    assert.deepStrictEqual(F.leakyLabelComments(written), F.leakyLabelComments(text));
  });
}

test('畳んだ表示の模擬を書き出す（FOLDED_VIEW_OUT 指定時）', { skip: !FOLDED_VIEW_OUT && 'FOLDED_VIEW_OUT が無い' }, () => {
  const out = [];
  for (const r of report) {
    out.push(`# ${r.name}: ${r.lines} 行 / ${r.slides} 枚 → 3枚目だけ開いた状態 ${r.open3} 行 / 全部畳んだ状態 ${r.allFolded} 行`);
  }
  out.push('');
  const r = report[0];
  if (r) {
    const sl = new Map(r.labels.map(l => [l.line, l.text]));
    const pl = new Map(r.panel.map(l => [l.line, l.text]));
    out.push(`## ${r.name}（3枚目を開いた状態。行番号は1始まり。⋯ は畳んだ行、« » は装飾のラベル）`);
    for (const k of r.vis) {
      const deco = sl.has(k) ? `   «${sl.get(k)}»` : pl.has(k) ? `   «${pl.get(k)}»` : '';
      out.push(String(k + 1).padStart(5) + '  ' + r.text[k].slice(0, 110) + (r.folded.has(k) ? ' ⋯' : '') + deco);
    }
  }
  fs.mkdirSync(path.dirname(FOLDED_VIEW_OUT), { recursive: true });
  fs.writeFileSync(FOLDED_VIEW_OUT, out.join('\n') + '\n');
});

// ---------------------------------------------------------------------------
// vscode スタブ上の配線
// ---------------------------------------------------------------------------
const stub = require('./helpers/vscode-stub.cjs');
const isMarpDoc = (doc) => doc.languageId === 'markdown' && /^---[\s\S]*?\n\s*marp\s*:\s*true/m.test(doc.getText().slice(0, 2000));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('folding-vscode: register が走り、provider・装飾・診断・コマンドが動く', async () => {
  stub.reset();
  const { vscode, state } = stub;
  const real = readDeck(DECKS[0]);
  const doc = stub.makeDocument(real || DECK, { fsPath: '/tmp/ss-folding/deck.md' });
  const plain = stub.makeDocument('# ただのメモ\n\n---\n\n本文\n', { fsPath: '/tmp/ss-folding/memo.md' });
  const ed = stub.makeEditor(doc, { active: true });
  const context = stub.makeContext();
  const mod = require('../lib/folding-vscode.cjs');
  const handle = mod.register(context, { isMarpDoc });
  try {
    assert.strictEqual(typeof handle.onPreviewNavigate, 'function');
    assert.strictEqual(typeof handle.refresh, 'function');

    // provider：Marp の md だけ範囲を返す
    assert.strictEqual(state.foldingProviders.length, 1);
    assert.deepStrictEqual(state.foldingProviders[0].selector, { language: 'markdown' });
    const provider = state.foldingProviders[0].provider;
    const got = provider.provideFoldingRanges(doc);
    const want = F.foldingRanges(doc.getText());
    assert.strictEqual(got.length, want.length);
    assert.ok(got.length > 10);
    assert.ok(got.every(r => r instanceof vscode.FoldingRange && r.start < r.end));
    assert.deepStrictEqual(provider.provideFoldingRanges(plain), []);

    // 装飾：スライドラベルとパネルラベル（after.contentText）
    const decos = Array.from(ed.decorations.values());
    assert.strictEqual(decos.length, 2);
    const slideDecos = decos[0];
    assert.strictEqual(slideDecos.length, F.slideLabels(doc.getText()).length);
    assert.match(slideDecos[0].renderOptions.after.contentText, /^1( ｜|$)/);
    assert.ok(state.decorationTypes.every(t => t.options.after.color instanceof vscode.ThemeColor), '色は ThemeColor');

    // コマンド4つ
    for (const id of ['toggleAutoFold', 'foldOtherSlides', 'unfoldAllSlides', 'writePanelLabels']) {
      assert.ok(state.commands.has('marpScrollSync.' + id), id);
    }
    // ステータスバー
    const item = state.statusItems[0];
    assert.ok(item.visible);
    assert.match(item.text, /^\$\(fold\)/);

    // 初回の自動折りたたみ（350ms 後）。カーソルは1枚目
    await sleep(450);
    const folds = state.executed.filter(x => x.command === 'editor.fold');
    assert.ok(folds.length >= 1, 'editor.fold が呼ばれる');
    const arg = folds[0].args[0];
    assert.strictEqual(arg.levels, 1);
    const slideStarts = want.filter(r => r.kind === 'slide');
    assert.ok(!arg.selectionLines.includes(slideStarts[0].start), '今のスライドは畳まない');
    assert.ok(arg.selectionLines.includes(slideStarts[1].start));
    assert.ok(arg.selectionLines.includes(want.find(r => r.kind === 'frontmatter-style').start), 'frontmatter の style も畳む');

    // カーソルが3枚目へ（キーボード）→ 1枚目を畳み、3枚目を開く
    state.executed.length = 0;
    const l3 = slideStarts[2].start;
    ed.selection = new vscode.Selection(l3 + 2, 0, l3 + 2, 0);
    stub.fire.selection({ textEditor: ed, selections: ed.selections, kind: vscode.TextEditorSelectionChangeKind.Keyboard });
    await sleep(20);
    assert.deepStrictEqual(state.executed.map(x => x.command), ['editor.unfold', 'editor.fold']);
    assert.deepStrictEqual(state.executed[0].args[0], { selectionLines: [l3], levels: 1 });
    assert.ok(state.executed[1].args[0].selectionLines.includes(slideStarts[0].start));

    // Command 由来・選択範囲あり・複数カーソルでは動かない
    state.executed.length = 0;
    const l5 = slideStarts[4].start;
    ed.selection = new vscode.Selection(l5 + 1, 0, l5 + 1, 0);
    stub.fire.selection({ textEditor: ed, selections: ed.selections, kind: vscode.TextEditorSelectionChangeKind.Command });
    ed.selection = new vscode.Selection(l5 + 1, 0, l5 + 1, 3);
    stub.fire.selection({ textEditor: ed, selections: ed.selections, kind: vscode.TextEditorSelectionChangeKind.Mouse });
    ed.selections = [new vscode.Selection(l5 + 1, 0, l5 + 1, 0), new vscode.Selection(l5 + 2, 0, l5 + 2, 0)];
    stub.fire.selection({ textEditor: ed, selections: ed.selections, kind: vscode.TextEditorSelectionChangeKind.Keyboard });
    await sleep(20);
    assert.deepStrictEqual(state.executed, []);

    // プレビューからの移動は onPreviewNavigate で
    ed.selection = new vscode.Selection(l5 + 1, 0, l5 + 1, 0);
    await handle.onPreviewNavigate(ed, 4);
    assert.deepStrictEqual(state.executed.map(x => x.command), ['editor.unfold', 'editor.fold']);
    assert.deepStrictEqual(state.executed[0].args[0].selectionLines, [l5]);
    assert.ok(state.executed[1].args[0].selectionLines.includes(l3));

    // エディタがアクティブでない間（プレビューにフォーカス）は畳まず、戻ったときに畳む
    state.executed.length = 0;
    vscode.window.activeTextEditor = undefined;
    const l7 = slideStarts[6].start;
    ed.selection = new vscode.Selection(l7 + 1, 0, l7 + 1, 0);
    await handle.onPreviewNavigate(ed, 6);
    assert.deepStrictEqual(state.executed, []);
    stub.fire.activeEditor(ed);
    await sleep(20);
    assert.deepStrictEqual(state.executed.map(x => x.command), ['editor.fold']);
    assert.ok(state.executed[0].args[0].selectionLines.includes(l5));
    assert.ok(!state.executed[0].args[0].selectionLines.includes(l7));

    // foldOtherSlides / unfoldAllSlides
    state.executed.length = 0;
    await vscode.commands.executeCommand('marpScrollSync.foldOtherSlides');
    const fo = state.executed.filter(x => x.command === 'editor.fold')[0].args[0].selectionLines;
    assert.ok(fo.includes(slideStarts[0].start) && !fo.includes(l7));
    await vscode.commands.executeCommand('marpScrollSync.unfoldAllSlides');
    const un = state.executed.filter(x => x.command === 'editor.unfold').pop().args[0];
    assert.deepStrictEqual(un, { selectionLines: slideStarts.map(r => r.start), levels: 1 });

    // toggleAutoFold：設定を書き換え、オフにしたら全部開く。以後はカーソルを動かしても畳まない
    state.executed.length = 0;
    await vscode.commands.executeCommand('marpScrollSync.toggleAutoFold');
    assert.deepStrictEqual(state.configUpdates.pop(), { key: 'marpScrollSync.autoFold', value: false, target: vscode.ConfigurationTarget.Global });
    assert.ok(state.executed.some(x => x.command === 'editor.unfoldAll'));
    assert.match(item.text, /^\$\(unfold\)/);
    state.executed.length = 0;
    ed.selection = new vscode.Selection(l3 + 1, 0, l3 + 1, 0);
    stub.fire.selection({ textEditor: ed, selections: ed.selections, kind: vscode.TextEditorSelectionChangeKind.Mouse });
    await sleep(20);
    assert.deepStrictEqual(state.executed, []);

    // writePanelLabels：今のスライドにだけ、1つの WorkspaceEdit で書く
    const before = doc.getText();
    const slideWithPanels = F.panelLabels(before).find(l => l.multiline && l.safe);
    ed.selection = new vscode.Selection(slideWithPanels.line, 0, slideWithPanels.line, 0);
    await vscode.commands.executeCommand('marpScrollSync.writePanelLabels');
    assert.strictEqual(state.appliedEdits.length, 1);
    const after = doc.getText();
    assert.notStrictEqual(after, before);
    assert.strictEqual(after.split('\n').length, before.split('\n').length);
    assert.match(after.split('\n')[slideWithPanels.line], /^\s*<.*<!-- .+ -->$/);
    const cur = F.slideAtLine(before, slideWithPanels.line);
    const changed = after.split('\n').map((l, k) => (l !== before.split('\n')[k] ? k : -1)).filter(k => k >= 0);
    assert.ok(changed.every(k => F.slideAtLine(before, k) === cur), '他のスライドには書かない');

    // 診断：ノートに混入するラベル風コメント → Information。テキスト変更は 300ms デバウンス
    doc.setText(after + '\n---\n\n<!-- 左パネル -->\n\n<!-- #region 図 -->\n\n# 追加\n');
    stub.fire.changeDoc(doc);
    await sleep(380);
    const diags = state.diagnostics.get('marpScrollSync.labels').get(doc.uri.toString());
    assert.strictEqual(diags.length, F.leakyLabelComments(doc.getText()).length);
    assert.ok(diags.length >= 2);
    assert.ok(diags.every(d => d.severity === vscode.DiagnosticSeverity.Information));
    assert.strictEqual(Array.from(ed.decorations.values())[0].length, F.slideLabels(doc.getText()).length, 'ラベルも更新される');

    // 設定でラベルを消せる
    state.config['marpScrollSync.slideLabels'] = false;
    state.config['marpScrollSync.panelLabels'] = false;
    stub.fire.config(['marpScrollSync.slideLabels']);
    assert.deepStrictEqual(Array.from(ed.decorations.values()), [[], []]);

    // Marp でない md には何も出さない
    const ed2 = stub.makeEditor(plain);
    stub.fire.activeEditor(ed2);
    assert.strictEqual(item.visible, false);
    handle.refresh(ed2);
    assert.deepStrictEqual(Array.from(ed2.decorations.values()), [[], []]);
  } finally {
    stub.disposeContext(context);
  }
});

test('folding-vscode: autoFold=false なら初回も畳まない。isMarpDoc が例外を投げても落ちない', async () => {
  stub.reset();
  const { state } = stub;
  state.config['marpScrollSync.autoFold'] = false;
  const doc = stub.makeDocument(DECK, { fsPath: '/tmp/ss-folding/deck2.md' });
  stub.makeEditor(doc, { active: true });
  const context = stub.makeContext();
  const mod = require('../lib/folding-vscode.cjs');
  mod.register(context, { isMarpDoc });
  const ctx2 = stub.makeContext();
  assert.doesNotThrow(() => mod.register(ctx2, { isMarpDoc() { throw new Error('boom'); } }));
  try {
    await sleep(450);
    assert.deepStrictEqual(state.executed.filter(x => /^editor\./.test(x.command)), []);
    assert.match(state.statusItems[0].text, /^\$\(unfold\)/);
  } finally {
    stub.disposeContext(context); stub.disposeContext(ctx2);
  }
});

test('folding-vscode: キーボードで区切り行に乗っただけでは前のスライドを畳まない（↑ で末尾へ戻れる）', async () => {
  stub.reset();
  const { vscode, state } = stub;
  const doc = stub.makeDocument(DECK, { fsPath: '/tmp/ss-folding/deck3.md' });
  const ed = stub.makeEditor(doc, { active: true, line: 12 }); // 1枚目
  const context = stub.makeContext();
  const handle = require('../lib/folding-vscode.cjs').register(context, { isMarpDoc });
  const key = (line, kind) => {
    ed.selection = new vscode.Selection(line, 0, line, 0);
    stub.fire.selection({ textEditor: ed, selections: ed.selections, kind: kind || vscode.TextEditorSelectionChangeKind.Keyboard });
    return sleep(15);
  };
  const folded = () => state.executed.filter(x => x.command === 'editor.fold').flatMap(x => x.args[0].selectionLines);
  const unfolded = () => state.executed.filter(x => x.command === 'editor.unfold').flatMap(x => x.args[0].selectionLines);
  try {
    await sleep(450); // 初回の折りたたみ
    const s1 = F.foldingRanges(DECK).find(r => r.kind === 'slide' && r.slide === 0).start;
    state.executed.length = 0;
    await key(14);                       // ↓ で2枚目の区切り行へ：2枚目を開くだけ
    assert.deepStrictEqual(unfolded(), [14]);
    assert.ok(!folded().includes(s1), '1枚目はまだ畳まない');
    state.executed.length = 0;
    await key(13);                       // ↑ で1枚目の末尾へ戻る：2枚目を畳む。1枚目は開いたまま
    assert.ok(folded().includes(14) && !folded().includes(s1));
    state.executed.length = 0;
    await key(14); await key(15);        // 区切り行 → 本文へ入った時点で1枚目を畳む
    assert.ok(folded().includes(s1), '本文へ入ったら前のスライドを畳む');
    state.executed.length = 0;
    await key(40, vscode.TextEditorSelectionChangeKind.Mouse); // クリックはその場で畳む
    assert.ok(folded().includes(14));
    // 区切り行で止まったままプレビューから別のスライドへ：後回しの分も一緒に畳む
    state.executed.length = 0;
    await key(55);                       // 4枚目の区切り行（3枚目は後回し）
    assert.ok(!folded().includes(40));
    ed.selection = new vscode.Selection(12, 0, 12, 0);
    await handle.onPreviewNavigate(ed, 0);
    assert.ok(folded().includes(40), '後回しにした3枚目も畳む');
  } finally { stub.disposeContext(context); }
});

test('folding-vscode: vscode の API や解析が例外を投げても register・イベント・provider は例外を外へ出さない', async () => {
  stub.reset();
  const { vscode, state } = stub;
  const doc = stub.makeDocument(DECK, { fsPath: '/tmp/ss-folding/deck4.md' });
  const ed = stub.makeEditor(doc, { active: true });
  const mod = require('../lib/folding-vscode.cjs');
  // 1) register の途中で API が落ちる → 何もしない戻り値を返す
  const orig = vscode.window.createStatusBarItem;
  vscode.window.createStatusBarItem = () => { throw new Error('no status bar'); };
  const ctxA = stub.makeContext();
  let h;
  try { assert.doesNotThrow(() => { h = mod.register(ctxA, { isMarpDoc }); }); } finally { vscode.window.createStatusBarItem = orig; }
  assert.strictEqual(typeof h.onPreviewNavigate, 'function');
  assert.doesNotThrow(() => h.refresh());
  await h.onPreviewNavigate(ed, 1);
  stub.disposeContext(ctxA);
  // 2) api が無い・context.subscriptions だけの最小形でも落ちない
  const ctxB = stub.makeContext();
  assert.doesNotThrow(() => mod.register(ctxB, undefined));
  stub.disposeContext(ctxB);
  // 3) 原稿の取得が落ちる doc（閉じかけ等）でも provider とイベントは例外を出さない
  stub.reset();
  const bad = stub.makeDocument(DECK, { fsPath: '/tmp/ss-folding/deck5.md' });
  const edBad = stub.makeEditor(bad, { active: true });
  const ctxC = stub.makeContext();
  let boom = false;
  const h3 = mod.register(ctxC, { isMarpDoc: (d) => d === bad || isMarpDoc(d) });
  try {
    const realGetText = bad.getText.bind(bad);
    bad.getText = (...a) => { if (boom) throw new Error('getText boom'); return realGetText(...a); };
    await sleep(450);
    boom = true; bad.version = (bad.version || 1) + 1; // キャッシュを外す
    assert.deepStrictEqual(stub.state.foldingProviders[0].provider.provideFoldingRanges(bad), []);
    assert.doesNotThrow(() => stub.fire.selection({ textEditor: edBad, selections: edBad.selections, kind: stub.vscode.TextEditorSelectionChangeKind.Mouse }));
    assert.doesNotThrow(() => stub.fire.activeEditor(edBad));
    assert.doesNotThrow(() => h3.refresh(edBad));
    await h3.onPreviewNavigate(edBad, 2);
    await stub.vscode.commands.executeCommand('marpScrollSync.foldOtherSlides');
    await stub.vscode.commands.executeCommand('marpScrollSync.writePanelLabels');
    await sleep(30);
    assert.strictEqual(stub.state.appliedEdits.length, 0);
  } finally { stub.disposeContext(ctxC); }
});

// ---- frontmatter の「調整つまみ」（:root { … }）は畳まない ----
test('frontmatter style: 先頭の :root（調整つまみ）は見せたまま、後ろのデック固有 CSS だけを自動で畳む', () => {
  const md = [
    '---', 'marp: true', 'theme: tsutawaru-academic', 'style: |',
    '  :root {',
    '    /* ── ヘッダー幅の調整つまみ { 波括弧入りコメント } ── */',
    '    --hdr-left-w: fit-content;  /* 左の題字帯の幅 */',
    '    --measure: 42em;',
    '  }',
    '',
    '  /* デック固有 */',
    '  .foo { color: red; }',
    '  .bar { color: blue; }',
    '---', '', '# A', '', '---', '', '# B', '',
  ].join('\n');
  const ranges = F.foldingRanges(md);
  const fm = ranges.filter(r => r.kind.startsWith('frontmatter')).map(r => [r.kind, r.start, r.end]);
  assert.deepStrictEqual(fm, [['frontmatter-style-all', 3, 12], ['frontmatter-style', 10, 12]]);
  // 自動で畳むのは後ろ半分だけ。つまみの行（4〜8）は見えたまま
  const act = F.nextFoldActions({ ranges, prevSlide: null, curSlide: 0, kinds: ['style', 'svg'] });
  assert.ok(act.fold.includes(10), 'デック固有 CSS は畳む');
  assert.ok(!act.fold.includes(3), 'style: の行（＝つまみごと）は畳まない');
  const visible = F.visibleLines(md.split('\n').length, ranges, act.fold);
  for (const ln of [3, 4, 5, 6, 7, 8]) assert.ok(visible.includes(ln), 'つまみの行 ' + ln + ' が見えている');
  assert.ok(!visible.includes(11) && !visible.includes(12), 'デック固有 CSS の中身は隠れる');
  // CRLF でも同じ
  const fmCr = F.foldingRanges(md.replace(/\n/g, '\r\n')).filter(r => r.kind.startsWith('frontmatter')).map(r => [r.kind, r.start, r.end]);
  assert.deepStrictEqual(fmCr, fm);
});

test('frontmatter style: つまみだけのデックは何も畳まない／:root が先頭でないデックは従来どおり丸ごと畳む', () => {
  const only = ['---', 'marp: true', 'style: |', '  :root {', '    --measure: 42em;', '  }', '---', '', '# A', ''].join('\n');
  const r1 = F.foldingRanges(only).filter(r => r.kind.startsWith('frontmatter')).map(r => r.kind);
  assert.deepStrictEqual(r1, ['frontmatter-style-all']);
  const a1 = F.nextFoldActions({ ranges: F.foldingRanges(only), prevSlide: null, curSlide: 0, kinds: ['style'] });
  assert.ok(!a1.fold.includes(2));

  const other = ['---', 'marp: true', 'style: |', '  section { font-size: 26px; }', '  :root { --measure: 42em; }', '  .x { color: red; }', '---', '', '# A', ''].join('\n');
  const r2 = F.foldingRanges(other).filter(r => r.kind.startsWith('frontmatter')).map(r => [r.kind, r.start, r.end]);
  assert.deepStrictEqual(r2, [['frontmatter-style', 2, 5]]);

  // 閉じていない :root（書きかけ）でも落ちず、従来どおり
  const open = ['---', 'marp: true', 'style: |', '  :root {', '    --measure: 42em;', '  .x { color: red; }', '---', '', '# A', ''].join('\n');
  assert.doesNotThrow(() => F.foldingRanges(open));
});

test('frontmatter style: つまみの判定は 引用符・url( )・{ の改行・:ROOT・セレクタ並記 で崩れない（つまみの行が必ず見える）', () => {
  const mk = (css, after) => ['---', 'marp: true', 'style: |', ...css, ...(after || []), '---', '', '# A', '', '---', '', '# B', ''].join('\n');
  const tail = ['  h1 {', '    color: red;', '  }'];
  const fmOf = (md) => F.foldingRanges(md).filter(r => r.slide === -1).map(r => [r.kind, r.start, r.end]);
  // knob = つまみの行数（style: の次の行から数えて、閉じ } まで）
  const expectKnob = (css, knobLines, label) => {
    const md = mk([...css, ...tail]);
    const end = 2 + css.length + tail.length;
    assert.deepStrictEqual(fmOf(md), [['frontmatter-style-all', 2, end], ['frontmatter-style', 3 + knobLines, end]], label);
    const ranges = F.foldingRanges(md);
    const act = F.nextFoldActions({ ranges, prevSlide: null, curSlide: 0, kinds: ['style', 'svg'] });
    const visible = F.visibleLines(md.split('\n').length, ranges, act.fold);
    for (let ln = 2; ln <= 2 + knobLines; ln++) assert.ok(visible.includes(ln), label + '：つまみの行 ' + ln + ' が見えている');
  };
  expectKnob(['  :root {', '    --x: "a}b";', '    --y: 1;', '  }'], 4, '値の文字列の中の }');
  expectKnob(['  :root {', "    --x: 'a{b';", '    --y: 1;', '  }'], 4, '値の文字列の中の {');
  expectKnob(['  :root {', '    --u: url(http://x/*y);', '    --y: 1;', '  }'], 4, 'url( ) の中の /*');
  expectKnob(['  :root', '  {', '    --y: 1;', '  }'], 4, '{ が次の行');
  expectKnob(['  :ROOT {', '    --y: 1;', '  }'], 3, '大文字');
  expectKnob(['  :root, section {', '    --y: 1;', '  }'], 3, 'セレクタの並記');
  expectKnob(['  :root{--a:1;--b:2}'], 1, '1行で閉じる（ALC デックの形）');
  expectKnob(['  /* a', '     b { */', '  /* c } */', '', '  :root {', '    --y: 1;', '  }'], 7, '前に複数行のコメント');
  expectKnob(['\t:root {', '\t\t--y: 1;', '\t}'].concat([]), 3, 'タブの字下げ');

  // :root が2回：1つ目だけがつまみ。2つ目からは畳む
  assert.deepStrictEqual(fmOf(mk(['  :root {', '    --a: 1;', '  }', '  :root {', '    --b: 1;', '  }', '  h1 {}'])),
    [['frontmatter-style-all', 2, 9], ['frontmatter-style', 6, 9]]);
  // つまみの後ろが1行だけ・空行だけ → 自動で畳む範囲は出さない
  assert.deepStrictEqual(fmOf(mk(['  :root {', '    --a: 1;', '  }', '  h1 { color: red; }'])), [['frontmatter-style-all', 2, 6]]);
  assert.deepStrictEqual(fmOf(mk(['  :root {', '    --a: 1;', '  }', '', ''])), [['frontmatter-style-all', 2, 5]]);
  // style: の後ろに別のキーが続く：範囲は style の中身まで。後ろのキーは隠れない
  assert.deepStrictEqual(fmOf(mk(['  :root {', '    --a: 1;', '  }', ...tail], ["header: 'x'", 'paginate: true'])),
    [['frontmatter-style-all', 2, 8], ['frontmatter-style', 6, 8]]);
  // style: |- ／ style: > でも同じ
  for (const key of ['style: |-', 'style: >', 'style: |+2']) {
    const md = mk(['  :root {', '    --a: 1;', '  }', ...tail]).replace('style: |', key);
    assert.deepStrictEqual(fmOf(md), [['frontmatter-style-all', 2, 8], ['frontmatter-style', 6, 8]], key);
  }
  // つまみではないもの：@import が先頭／:root を含むだけの別セレクタ → 従来どおり丸ごと
  assert.deepStrictEqual(fmOf(mk(['  @import url("x.css");', '  :root {', '    --a: 1;', '  }'])), [['frontmatter-style', 2, 6]]);
  assert.deepStrictEqual(fmOf(mk(['  :root section {', '    --a: 1;', '  }', '  h1 {}'])), [['frontmatter-style', 2, 6]]);
  // style: が無い・1行の style: は範囲なし
  assert.deepStrictEqual(fmOf(['---', 'marp: true', '---', '', '# A', ''].join('\n')), []);
  assert.deepStrictEqual(fmOf(['---', 'marp: true', 'style: "section{color:red}"', '---', '', '# A', ''].join('\n')), []);
  // どの形でも、同じ開始行の範囲・交差する範囲が無い（VS Code は片方を捨てる）
  for (const css of [['  :root {', '    --x: "a}b";', '  }', ...tail], ['  :root{--a:1}', ...tail], ['  :root {', '    --a: 1;', '  } h1 {', '    color: red;', '  }', '  h2 {}']]) {
    const rs = F.foldingRanges(mk(css));
    for (const a of rs) for (const b of rs) {
      if (a === b) continue;
      assert.ok(a.start !== b.start, '同じ開始行');
      assert.ok(!(a.start < b.start && b.start <= a.end && b.end > a.end), '交差');
    }
  }
});
