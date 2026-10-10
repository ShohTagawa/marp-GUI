// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// lib/slide-split.cjs の回帰テスト。
//   1) splitDeck / slideMeta の単体テスト
//   2) slides/ と PonchiE/ 配下の marp:true の md 全部で、slideStartLines の枚数が marp-core の実描画枚数と一致すること
//      （ここがズレると、同期・逆引き・スライド操作の全部が1枚ずつズレる）
// 実行: node --test tools/marp-scroll-sync/test/slide-split.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const EXT = path.resolve(__dirname, '..');
const REPO = path.resolve(EXT, '..', '..');
const split = require(path.join(EXT, 'lib', 'slide-split.cjs'));
const { slideStartLines, slideIndexForLine, lineRangeForSlide, frontmatterRange, splitDeck, slideMeta, LIB_KEY } = split;

// ---------------------------------------------------------------- 単体

const DECK = [
  '---',            // 0
  'marp: true',     // 1
  'theme: academic',// 2
  '---',            // 3
  '',               // 4
  '# 一枚目',       // 5
  '',               // 6
  '---',            // 7
  '',               // 8
  '<!-- _class: summary -->', // 9
  '',               // 10
  '<div class="page-title">今回の<b>構成</b></div>', // 11
  '',               // 12
  '## 見出し',      // 13
  '',               // 14
  '<!-- 発表者ノート -->', // 15
  '---',            // 16  ノート直後の --- は区切り
  '',               // 17
  '段落',           // 18
  '---',            // 19  setext 見出し（区切りではない）
  '',               // 20
  '```',            // 21
  '',               // 22
  '---',            // 23  フェンス内（区切りではない）
  '```',            // 24
  '',               // 25
  '<!--',           // 26
  '',               // 27
  '---',            // 28  コメント内（区切りではない）
  '-->',            // 29
  '---',            // 30  複数行コメントが閉じた直後は区切り
  '',               // 31
  '### 最後',       // 32
].join('\n');

test('slideStartLines: frontmatter・ノート直後・setext・フェンス・コメント', () => {
  assert.deepStrictEqual(slideStartLines(DECK), [4, 8, 17, 31]);
});

test('slideStartLines: CRLF でも同じ行番号', () => {
  assert.deepStrictEqual(slideStartLines(DECK.replace(/\n/g, '\r\n')), [4, 8, 17, 31]);
});

test('slideStartLines: frontmatter 無し', () => {
  assert.deepStrictEqual(slideStartLines('# a\n\n---\n\n# b\n'), [0, 3]);
});

test('splitDeck: startLine / endLine / sepLine', () => {
  const d = splitDeck(DECK);
  assert.deepStrictEqual(d.frontmatter, { start: 0, end: 3 });
  assert.deepStrictEqual(d.slides, [
    { index: 0, startLine: 4, endLine: 7, sepLine: -1 },
    { index: 1, startLine: 8, endLine: 16, sepLine: 7 },
    { index: 2, startLine: 17, endLine: 30, sepLine: 16 },
    { index: 3, startLine: 31, endLine: 33, sepLine: 30 },
  ]);
  // 区切りの行は本当に --- で、endLine は次のスライドの sepLine と同じ
  for (const s of d.slides) {
    if (s.sepLine >= 0) assert.match(d.lines[s.sepLine], /^---+\s*$/);
    const next = d.slides[s.index + 1];
    if (next) assert.strictEqual(s.endLine, next.sepLine);
  }
});

test('splitDeck: 末尾に改行があると最後の endLine は行数（空の最終行を含む）', () => {
  const d = splitDeck('# a\n\n---\n\n# b\n');
  assert.strictEqual(d.lines.length, 6);
  assert.deepStrictEqual(d.slides[1], { index: 1, startLine: 3, endLine: 6, sepLine: 2 });
});

test('slideIndexForLine / lineRangeForSlide / frontmatterRange', () => {
  const starts = slideStartLines(DECK);
  assert.strictEqual(slideIndexForLine(starts, 0), 0);
  assert.strictEqual(slideIndexForLine(starts, 7), 0);
  assert.strictEqual(slideIndexForLine(starts, 8), 1);
  assert.strictEqual(slideIndexForLine(starts, 32), 3);
  assert.deepStrictEqual(lineRangeForSlide(starts, 1, 33), [8, 17]);
  assert.deepStrictEqual(lineRangeForSlide(starts, 3, 33), [31, 33]);
  assert.strictEqual(frontmatterRange(['# a']), null);
  assert.strictEqual(frontmatterRange(['---', 'marp: true']), null);
});

test('slideMeta: classes / title / marked', () => {
  const d = splitDeck(DECK);
  const m0 = slideMeta(d.lines, d.slides[0].startLine, d.slides[0].endLine);
  assert.deepStrictEqual(m0, { classes: [], title: '一枚目', marked: false });
  const m1 = slideMeta(d.lines, d.slides[1].startLine, d.slides[1].endLine);
  assert.deepStrictEqual(m1, { classes: ['summary'], title: '今回の構成', marked: false }); // page-title が見出しより優先
  const m3 = slideMeta(d.lines, d.slides[3].startLine, d.slides[3].endLine);
  assert.strictEqual(m3.title, '最後');
});

test('slideMeta: 複数行ディレクティブの _class（複数クラス）と _lib の印', () => {
  assert.strictEqual(LIB_KEY, '_lib');
  const lines = ['<!--', '_class: split vcenter', '_lib: alc-agenda | 構成, アジェンダ | 2026-09-20', '-->', '', '## **太字**の`見出し`'];
  assert.deepStrictEqual(slideMeta(lines, 0, lines.length), { classes: ['split', 'vcenter'], title: '太字の見出し', marked: true });
  // 1行形式の印（単独。ノートに混入する書き方だが、印としては拾う）
  assert.strictEqual(slideMeta(['<!-- _lib: x | | 2026-09-20 -->'], 0, 1).marked, true);
  // 本文中の "_lib" という文字は印ではない
  assert.strictEqual(slideMeta(['変数 _lib を使う'], 0, 1).marked, false);
  // 範囲外は見ない
  assert.strictEqual(slideMeta(lines, 4, 5).marked, false);
});

// ---------------------------------------------------------------- 実デック全数（marp-core の実描画枚数と突き合わせ）

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** frontmatter に marp: true がある md だけ */
function isMarpDeck(text) {
  const lines = text.split(/\r?\n/);
  const fm = frontmatterRange(lines);
  if (!fm) return false;
  return lines.slice(1, fm.end).some(l => /^marp\s*:\s*true\s*$/.test(l));
}

function themeCssFiles() {
  const dir = path.join(REPO, 'theme');
  const names = fs.readdirSync(dir).filter(n => n.endsWith('.css'));
  // extension.js の renderDeck と同じ：academic を先頭に（他のテーマが @import するため）
  names.sort((a, b) => (a === 'academic.css' ? -1 : b === 'academic.css' ? 1 : a.localeCompare(b)));
  return names.map(n => fs.readFileSync(path.join(dir, n), 'utf8'));
}

test('ワークスペースの全デック：slideStartLines の枚数 = marp-core の実描画枚数', { timeout: 600000 }, (t) => {
  let Marp;
  try { ({ Marp } = require(path.join(EXT, 'node_modules', '@marp-team', 'marp-core'))); }
  catch (_) { t.skip('marp-core が入っていません（npm run setup）'); return; }
  const css = themeCssFiles();
  const files = [...walk(path.join(REPO, 'slides'), []), ...walk(path.join(REPO, 'PonchiE'), [])].sort();
  const decks = files.map(f => ({ f, text: fs.readFileSync(f, 'utf8') })).filter(d => isMarpDeck(d.text));
  assert.ok(decks.length >= 1, 'デックが見つからない: ' + decks.length);
  const mismatches = [], errors = [];
  for (const { f, text } of decks) {
    const mine = slideStartLines(text).length;
    let rendered;
    try {
      const marp = new Marp({ html: true });
      for (const c of css) { try { marp.themeSet.add(c); } catch (_) { /* 任意 */ } }
      const r = marp.render(text);
      rendered = r.comments.length;
      const sections = (r.html.match(/<section[\s>]/g) || []).length;
      // 発表者ノートの配列と <section> の数は同じはず（違えば数え方の前提が崩れている）
      if (sections !== rendered) errors.push(path.relative(REPO, f) + ': comments=' + rendered + ' section=' + sections);
    } catch (e) {
      errors.push(path.relative(REPO, f) + ': 描画エラー ' + String(e.message || e));
      continue;
    }
    if (mine !== rendered) mismatches.push(path.relative(REPO, f) + ': slideStartLines=' + mine + ' marp=' + rendered);
  }
  t.diagnostic('照合したデック: ' + decks.length + ' 本');
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(mismatches, []);
});
