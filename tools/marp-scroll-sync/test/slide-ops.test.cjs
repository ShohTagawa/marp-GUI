// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// lib/slide-ops.cjs のテスト。
//   すべての操作で、編集を当てた結果を slideStartLines で数え直し、期待枚数と一致することを検算する
//   （区切り --- は前の行しだいで setext 見出しに化けるので、文字列の見た目だけで判断しない）。
//   要所は marp-core の実描画枚数とも突き合わせる。
// 実行: node --test tools/marp-scroll-sync/test/slide-ops.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const EXT = path.resolve(__dirname, '..');
const REPO = path.resolve(EXT, '..', '..');
const { slideStartLines, splitDeck } = require(path.join(EXT, 'lib', 'slide-split.cjs'));
const ops = require(path.join(EXT, 'lib', 'slide-ops.cjs'));
const { applyEdits, duplicateSlide, deleteSlide, moveSlide, insertSlideAfter, newSlideTemplates, addBulletAfter, removeBullet, stripLibMark } = ops;

// ---------------------------------------------------------------- 道具

let Marp = null;
try { ({ Marp } = require(path.join(EXT, 'node_modules', '@marp-team', 'marp-core'))); } catch (_) { /* 無ければ描画の突き合わせだけ飛ばす */ }

function themeCssFiles() {
  const dir = path.join(REPO, 'theme');
  const names = fs.readdirSync(dir).filter(n => n.endsWith('.css'));
  names.sort((a, b) => (a === 'academic.css' ? -1 : b === 'academic.css' ? 1 : a.localeCompare(b)));
  return names.map(n => fs.readFileSync(path.join(dir, n), 'utf8'));
}
let cssCache = null;
function render(text) {
  const marp = new Marp({ html: true });
  if (!cssCache) cssCache = themeCssFiles();
  for (const c of cssCache) { try { marp.themeSet.add(c); } catch (_) { /* 任意 */ } }
  return marp.render(text);
}
function renderedCount(text) {
  return render(text).comments.length;
}

const count = (text) => slideStartLines(text).length;

/** スライド i の本文（前後の空行を落とした中身） */
function bodyOf(text, i) {
  const d = splitDeck(text);
  const s = d.slides[i];
  return d.lines.slice(s.startLine, s.endLine).join('\n').trim();
}
function bodies(text) {
  const d = splitDeck(text); // 1回だけ分割する（実デックのループで bodyOf を枚数ぶん呼ぶと遅い）
  return d.slides.map(s => d.lines.slice(s.startLine, s.endLine).join('\n').trim());
}

/**
 * 操作の結果を当てて検算する。枚数（自前の分割＋marp-core）・編集の形・revealLine・改行コードの混在なし。
 */
function run(text, res, expected) {
  assert.strictEqual(res.ok, true, 'ok でない: ' + res.reason);
  assert.ok(Array.isArray(res.edits) && res.edits.length >= 1);
  let prevEnd = -1;
  for (const e of [...res.edits].sort((a, b) => a.start - b.start)) {
    assert.ok(Number.isInteger(e.start) && Number.isInteger(e.end) && e.start <= e.end && e.end <= text.length);
    assert.ok(e.start >= prevEnd, '編集が重なっている');
    assert.strictEqual(typeof e.text, 'string');
    prevEnd = e.end;
  }
  const after = applyEdits(text, res.edits);
  assert.strictEqual(count(after), expected, '枚数が合わない\n' + after);
  if (Marp) assert.strictEqual(renderedCount(after), expected, 'marp-core の枚数が合わない\n' + after);
  const lineCount = after.split(/\r?\n/).length;
  assert.ok(Number.isInteger(res.revealLine) && res.revealLine >= 0 && res.revealLine < lineCount, 'revealLine が範囲外: ' + res.revealLine);
  // 改行コードを混ぜない
  if (/\r\n/.test(text)) assert.ok(!/(^|[^\r])\n/.test(after), 'CRLF の原稿に LF が混ざった');
  else assert.ok(!/\r/.test(after), 'LF の原稿に CR が混ざった');
  return after;
}

const FM = '---\nmarp: true\ntheme: academic\n---\n';
const DECK3 = FM + '\n# A\n\n- a1\n\n---\n\n# B\n\n- b1\n\n---\n\n# C\n';
const crlf = (s) => s.replace(/\n/g, '\r\n');

// ---------------------------------------------------------------- applyEdits

test('applyEdits: 順不同の複数編集を後ろから当てる（UTF-16 オフセット）', () => {
  const t = 'あ😀b\nc';
  assert.strictEqual(applyEdits(t, [{ start: 0, end: 1, text: 'X' }, { start: 3, end: 4, text: 'YY' }]), 'X😀YY\nc');
  assert.strictEqual(applyEdits(t, []), t);
  assert.strictEqual(applyEdits('abc', [{ start: 3, end: 3, text: 'd' }, { start: 0, end: 0, text: '_' }]), '_abcd');
});

// ---------------------------------------------------------------- 複製

test('duplicateSlide: 1枚目・途中・最後', () => {
  for (const i of [0, 1, 2]) {
    const after = run(DECK3, duplicateSlide(DECK3, i), 4);
    const b = bodies(after), src = bodies(DECK3);
    assert.strictEqual(b[i], src[i]);
    assert.strictEqual(b[i + 1], src[i]);
    const rest = b.slice(0, i).concat(b.slice(i + 2));
    assert.deepStrictEqual(rest, src.slice(0, i).concat(src.slice(i + 1)));
    // frontmatter は1バイトも変わらない
    assert.ok(after.startsWith(FM));
  }
});

test('duplicateSlide: revealLine はコピーの最初の行', () => {
  const res = duplicateSlide(DECK3, 1);
  const after = run(DECK3, res, 4);
  assert.strictEqual(after.split('\n')[res.revealLine], '# B');
  assert.strictEqual(splitDeck(after).slides[2].startLine <= res.revealLine, true);
});

test('duplicateSlide: 最後のスライド（末尾に改行が有る/無い/空行が複数）で末尾の書き方が変わらない', () => {
  for (const tailStr of ['', '\n', '\n\n\n']) {
    const t = FM + '\n# A\n\n---\n\n# C' + tailStr;
    const after = run(t, duplicateSlide(t, 1), 3);
    assert.deepStrictEqual(bodies(after), ['# A', '# C', '# C']);
    assert.strictEqual(after.match(/\n*$/)[0], tailStr, '末尾の改行の数が変わった');
    assert.ok(after.startsWith(t.replace(/\n*$/, '')), '元の部分が変わった');
  }
});

test('duplicateSlide: 区切りの前に空行が無いと setext 見出しになる書き方でも枚数が合う', () => {
  // 最後のスライドが段落で終わり改行も無い → そのまま --- を足すと h2 になる
  const t = FM + '\n段落だけ';
  const after = run(t, duplicateSlide(t, 0), 2);
  assert.deepStrictEqual(bodies(after), ['段落だけ', '段落だけ']);
  // frontmatter 直後に空行が無い1枚目
  const t2 = FM + '# A\n本文\n\n---\n\n# B\n';
  const after2 = run(t2, duplicateSlide(t2, 0), 3);
  assert.deepStrictEqual(bodies(after2), ['# A\n本文', '# A\n本文', '# B']);
});

test('duplicateSlide: 発表者ノートの直後に --- が来る書き方', () => {
  const t = FM + '\n# A\n\n<!-- ノートA -->\n---\n\n# B\n\n<!--\nノートB\n-->\n---\n\n# C\n\n<!-- ノートC -->';
  for (const i of [0, 1, 2]) {
    const after = run(t, duplicateSlide(t, i), 4);
    const b = bodies(after), src = bodies(t);
    assert.strictEqual(b[i + 1], src[i]);
    assert.strictEqual(b[i], src[i]);
    if (Marp) {
      // ノートもコピーされ、隣のスライドへ漏れない
      const notes = render(after).comments.map(c => c.join('|'));
      const srcNotes = render(t).comments.map(c => c.join('|'));
      const expect = srcNotes.slice(0, i + 1).concat([srcNotes[i]], srcNotes.slice(i + 1));
      assert.deepStrictEqual(notes, expect);
    }
  }
});

test('duplicateSlide: コードフェンス内・コメント内の --- を区切りと数えない', () => {
  const t = FM + '\n# A\n\n```yaml\n\n---\nkey: v\n```\n\n---\n\n# B\n\n<!--\n\n---\n-->\n\n---\n\n# C\n';
  assert.strictEqual(count(t), 3);
  for (const i of [0, 1, 2]) {
    const after = run(t, duplicateSlide(t, i), 4);
    assert.strictEqual(bodies(after)[i + 1], bodies(t)[i]);
  }
});

test('duplicateSlide: 区切りの前後の空行をそのまま保つ', () => {
  const t = FM + '\n# A\n\n\n\n---\n# B\n\n---\n\n\n# C\n';
  const after = run(t, duplicateSlide(t, 1), 4);
  // 元の区切りのまわりは変わらない（コピーは B の直後に同じ形で入る）
  assert.ok(after.includes('# A\n\n\n\n---\n# B\n\n---\n# B\n\n---\n\n\n# C\n'), after);
});

test('duplicateSlide: CRLF の原稿', () => {
  const t = crlf(DECK3);
  for (const i of [0, 1, 2]) {
    const after = run(t, duplicateSlide(t, i), 4);
    assert.strictEqual(bodies(after)[i + 1], bodies(DECK3)[i]);
  }
  const t2 = crlf(FM + '\n# A\n\n---\n\n段落');
  run(t2, duplicateSlide(t2, 1), 3);
});

test('duplicateSlide: frontmatter の無いデック・範囲外', () => {
  const t = '# A\n\n---\n\n# B\n';
  run(t, duplicateSlide(t, 0), 3);
  run(t, duplicateSlide(t, 1), 3);
  for (const bad of [-1, 2, 1.5, NaN, undefined]) {
    const r = duplicateSlide(t, bad);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.edits, []);
  }
});

// ---------------------------------------------------------------- _lib の印

const MARKED = '<!--\n_class: summary\n_lib: alc-agenda | 構成, アジェンダ | 2026-09-20\n-->';

test('stripLibMark: _class だけになったら1行形式へ戻す', () => {
  assert.strictEqual(stripLibMark(MARKED + '\n\n## 見出し\n'), '<!-- _class: summary -->\n\n## 見出し\n');
  assert.strictEqual(stripLibMark(crlf(MARKED + '\n\n## 見出し\n')), crlf('<!-- _class: summary -->\n\n## 見出し\n'));
  // 複数クラス
  assert.strictEqual(stripLibMark('<!--\n_class: split vcenter\n_lib: x | | 2026-09-20\n-->\n'), '<!-- _class: split vcenter -->\n');
  // _lib が先に書いてあっても同じ
  assert.strictEqual(stripLibMark('<!--\n_lib: x | | 2026-09-20\n_class: fig\n-->\n'), '<!-- _class: fig -->\n');
});

test('stripLibMark: 印のためだけに足した空の _class はコメントごと消す', () => {
  assert.strictEqual(stripLibMark('<!--\n_class:\n_lib: x | a | 2026-09-20\n-->\n\n## 見出し\n'), '## 見出し\n');
  assert.strictEqual(stripLibMark('# t\n\n<!--\n_class: ""\n_lib: x | a | 2026-09-20\n-->\n\n本文\n'), '# t\n\n本文\n');
});

test('stripLibMark: 他のキーが残るときは _lib の行だけ消す／印が無ければ何も変えない', () => {
  assert.strictEqual(
    stripLibMark('<!--\n_class: fig\n_paginate: false\n_lib: x | a | 2026-09-20\n-->\n'),
    '<!--\n_class: fig\n_paginate: false\n-->\n');
  const plain = '<!-- _class: fig -->\n\n<!--\nノート _lib: ではない\n-->\n\n```\n<!--\n_class: a\n_lib: x\n-->\n```\n';
  assert.strictEqual(stripLibMark(plain), plain);
  // 単独の1行形式（ノートに混入する書き方）も外す
  assert.strictEqual(stripLibMark('<!-- _lib: x | a | 2026-09-20 -->\n\n## h\n'), '## h\n');
});

test('duplicateSlide / insertSlideAfter: コピー側だけ _lib の印を外す', { skip: !Marp && 'marp-core なし' }, () => {
  const t = FM + '\n# A\n\n---\n\n' + MARKED + '\n\n<div class="page-title">構成</div>\n\n## 見出し\n\n---\n\n# C\n';
  const after = run(t, duplicateSlide(t, 1), 4);
  const d = splitDeck(after);
  const { slideMeta } = require(path.join(EXT, 'lib', 'slide-split.cjs'));
  const meta = d.slides.map(s => slideMeta(d.lines, s.startLine, s.endLine));
  assert.deepStrictEqual(meta.map(m => m.marked), [false, true, false, false]);
  assert.deepStrictEqual(meta[2].classes, ['summary']);
  assert.ok(bodyOf(after, 2).startsWith('<!-- _class: summary -->\n\n<div class="page-title">'));
  assert.strictEqual(bodyOf(after, 1), bodyOf(t, 1)); // 元は変えない
  // 描画：コピーにも summary クラスが付き、印はノートに出ない
  const r = render(after);
  assert.deepStrictEqual(r.comments, [[], [], [], []]);
  assert.strictEqual((r.html.match(/<section[^>]*class="summary"/g) || []).length, 2);

  const ins = run(t, insertSlideAfter(t, 0, bodyOf(t, 1)), 4);
  const d2 = splitDeck(ins);
  assert.deepStrictEqual(d2.slides.map(s => slideMeta(d2.lines, s.startLine, s.endLine).marked), [false, false, true, false]);
});

// ---------------------------------------------------------------- 挿入

test('insertSlideAfter: 1枚目の後・途中・最後の後（末尾改行 有/無）', () => {
  const body = '## 新しい\n\n- x';
  for (const tailStr of ['\n', '']) {
    const t = DECK3.replace(/\n$/, '') + tailStr;
    for (const i of [0, 1, 2]) {
      const res = insertSlideAfter(t, i, body);
      const after = run(t, res, 4);
      const b = bodies(after), src = bodies(t);
      assert.strictEqual(b[i + 1], body);
      assert.deepStrictEqual(b.slice(0, i + 1).concat(b.slice(i + 2)), src);
      assert.strictEqual(after.split('\n')[res.revealLine], '## 新しい');
      assert.strictEqual(after.match(/\n*$/)[0], tailStr);
    }
  }
});

test('insertSlideAfter: 本文の前後の空行・改行コードを原稿に合わせる／区切り入りは断る', () => {
  const t = crlf(DECK3);
  const after = run(t, insertSlideAfter(t, 1, '\n\n## 新\n- x\n\n\n'), 4);
  assert.strictEqual(bodies(after)[2], '## 新\n- x');
  // CRLF の本文を LF の原稿へ
  const after2 = run(DECK3, insertSlideAfter(DECK3, 2, '## 新\r\n\r\n- x\r\n'), 4);
  assert.strictEqual(bodies(after2)[3], '## 新\n\n- x');
  // 区切りを含む本文
  const bad = insertSlideAfter(DECK3, 0, '# a\n\n---\n\n# b');
  assert.strictEqual(bad.ok, false);
  assert.deepStrictEqual(bad.edits, []);
  // フェンス内の --- は区切りではないので通る
  run(DECK3, insertSlideAfter(DECK3, 0, '```\n\n---\n```'), 4);
  // 空の本文（空白スライド）
  run(DECK3, insertSlideAfter(DECK3, 0, ''), 4);
  run(DECK3, insertSlideAfter(DECK3, 2, ''), 4);
});

test('insertSlideAfter: ノート直後に --- が来る原稿・setext になりうる本文', () => {
  const t = FM + '\n# A\n\n<!-- ノートA -->\n---\n\n# B\n\n<!-- ノートB -->';
  for (const i of [0, 1]) {
    const after = run(t, insertSlideAfter(t, i, '段落で終わる本文'), 3);
    assert.strictEqual(bodies(after)[i + 1], '段落で終わる本文');
    if (Marp) {
      const notes = render(after).comments.map(c => c.join('|'));
      const expect = ['ノートA', 'ノートB']; expect.splice(i + 1, 0, '');
      assert.deepStrictEqual(notes, expect);
    }
  }
  // 挿入する本文がコメントで終わる
  const after = run(t, insertSlideAfter(t, 0, '# 新\n\n<!-- 新ノート -->'), 3);
  if (Marp) assert.deepStrictEqual(render(after).comments.map(c => c.join('|')), ['ノートA', '新ノート', 'ノートB']);
});

// ---------------------------------------------------------------- 削除

test('deleteSlide: 1枚目・途中・最後（末尾改行 有/無）', () => {
  for (const tailStr of ['\n', '', '\n\n']) {
    const t = DECK3.replace(/\n$/, '') + tailStr;
    for (const i of [0, 1, 2]) {
      const after = run(t, deleteSlide(t, i), 2);
      const src = bodies(t);
      assert.deepStrictEqual(bodies(after), src.filter((_, n) => n !== i));
      assert.ok(after.startsWith(FM), 'frontmatter が変わった');
      assert.strictEqual(after.match(/\n*$/)[0], tailStr, '末尾の改行の数が変わった');
    }
  }
});

test('deleteSlide: 1枚しかないデックは拒否する', () => {
  for (const t of [FM + '\n# A\n', '# A', FM]) {
    const r = deleteSlide(t, 0);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.edits, []);
    assert.match(r.reason, /1枚/);
  }
});

test('deleteSlide: ノート直後の ---・フェンス・CRLF', () => {
  const t = FM + '\n# A\n\n<!-- ノートA -->\n---\n\n# B\n\n```\n\n---\n```\n\n<!--\nノートB\n-->\n---\n\n# C\n\n<!-- ノートC -->\n';
  for (const src of [t, crlf(t)]) {
    for (const i of [0, 1, 2]) {
      const after = run(src, deleteSlide(src, i), 2);
      assert.deepStrictEqual(bodies(after), bodies(src).filter((_, n) => n !== i));
      if (Marp) {
        const notes = render(src).comments.map(c => c.join('|')).filter((_, n) => n !== i);
        assert.deepStrictEqual(render(after).comments.map(c => c.join('|')), notes);
      }
    }
  }
});

test('deleteSlide: 途中を消しても隣の区切りのまわりの空行は変わらない', () => {
  const t = FM + '\n# A\n\n\n---\n# B\n\n---\n\n\n# C\n';
  assert.strictEqual(applyEdits(t, deleteSlide(t, 1).edits), FM + '\n# A\n\n\n---\n\n\n# C\n');
});

// ---------------------------------------------------------------- 移動

test('moveSlide: 上へ・下へ・範囲外・±1 以外', () => {
  const up = run(DECK3, moveSlide(DECK3, 1, -1), 3);
  assert.deepStrictEqual(bodies(up), ['# B\n\n- b1', '# A\n\n- a1', '# C']);
  const down = run(DECK3, moveSlide(DECK3, 1, 1), 3);
  assert.deepStrictEqual(bodies(down), ['# A\n\n- a1', '# C', '# B\n\n- b1']);
  const res = moveSlide(DECK3, 1, 1);
  assert.strictEqual(applyEdits(DECK3, res.edits).split('\n')[res.revealLine], '# B');
  for (const [i, d] of [[0, -1], [2, 1], [1, 2], [1, 0], [5, 1]]) {
    const r = moveSlide(DECK3, i, d);
    assert.strictEqual(r.ok, false, i + ',' + d);
    assert.deepStrictEqual(r.edits, []);
  }
});

function roundTrip(text, label, exact = true) {
  const n = count(text);
  for (let i = 1; i < n; i++) {
    const r1 = moveSlide(text, i, -1);
    assert.strictEqual(r1.ok, true, label + ' up ' + i + ': ' + r1.reason);
    const mid = applyEdits(text, r1.edits);
    assert.strictEqual(count(mid), n, label + ' up ' + i);
    const r2 = moveSlide(mid, i - 1, 1);
    assert.strictEqual(r2.ok, true, label + ' down ' + i + ': ' + r2.reason);
    const back = applyEdits(mid, r2.edits);
    assert.strictEqual(count(back), n, label + ' down ' + i);
    assert.deepStrictEqual(bodies(back), bodies(text), label + ': 上へ→下へで中身が変わった (slide ' + i + ')');
    if (exact) assert.ok(back === text, label + ': 上へ→下へで元に戻らない (slide ' + i + ')');
  }
}

test('moveSlide: 上へ移動して下へ戻すと完全一致（境界条件の詰め合わせ）', () => {
  const cases = {
    basic: DECK3,
    noTrailingEol: DECK3.replace(/\n$/, ''),
    crlf: crlf(DECK3),
    notes: FM + '\n# A\n\n<!-- ノートA -->\n---\n\n# B\n\n<!--\nノートB\n-->\n---\n\n# C\n\n<!-- ノートC -->\n---\n# D\n',
    notesLastNoEol: FM + '\n# A\n\n<!-- ノートA -->\n---\n\n# B\n\n<!-- ノートB -->\n---\n\n段落',
    fence: FM + '\n# A\n\n```\n\n---\n```\n\n---\n\n# B\n\n---\n\n# C',
    blanks: FM + '\n\n# A\n\n\n\n---\n# B\n\n---\n\n\n# C\n\n\n',
    noFm: '# A\n\n---\n\n# B\n',
    fmNoBlank: FM + '# A\n\n---\n# B\n',
    empty: FM + '\n# A\n\n---\n\n---\n\n# C\n',
  };
  for (const [k, t] of Object.entries(cases)) {
    // 空のスライドが最後の位置と入れ替わるときだけは、空行の数までは戻らない（中身と枚数は戻る）。
    // 最後の位置には区切りが無く、空の本文では「区切り前の空行」と「本文の空行」の区別が原稿に残らないため
    roundTrip(t, k, k !== 'empty');
    if (Marp) {
      // 途中経過も marp-core の枚数と合う
      const n = count(t);
      for (let i = 1; i < n; i++) assert.strictEqual(renderedCount(applyEdits(t, moveSlide(t, i, -1).edits)), n, k + ' ' + i);
    }
  }
});

test('moveSlide: ノートは本文と一緒に動く', { skip: !Marp && 'marp-core なし' }, () => {
  const t = FM + '\n# A\n\n<!-- ノートA -->\n---\n\n# B\n\n<!-- ノートB -->\n---\n\n段落C';
  const notes = (s) => render(s).comments.map(c => c.join('|'));
  assert.deepStrictEqual(notes(run(t, moveSlide(t, 0, 1), 3)), ['ノートB', 'ノートA', '']);
  assert.deepStrictEqual(notes(run(t, moveSlide(t, 2, -1), 3)), ['ノートA', '', 'ノートB']);
  assert.deepStrictEqual(notes(run(t, moveSlide(t, 1, 1), 3)), ['ノートA', '', 'ノートB']);
});

// ---------------------------------------------------------------- 新規スライドの骨格

test('newSlideTemplates: 形・academic.css に実在するクラスだけ', () => {
  const tpls = newSlideTemplates();
  assert.deepStrictEqual(tpls.map(t => t.id), ['blank', 'bullets', 'split', 'fig', 'message', 'divider']);
  const css = fs.readFileSync(path.join(REPO, 'theme', 'academic.css'), 'utf8');
  for (const t of tpls) {
    for (const key of ['id', 'label', 'description', 'text']) assert.ok(typeof t[key] === 'string' && t[key].length > 0, t.id + '.' + key);
    assert.ok(!/\r/.test(t.text));
    assert.strictEqual(count('\n' + t.text), 1, t.id + ': 区切りを含んでいる');
    // class="…" のクラスは academic.css にセレクタとして在る
    for (const m of t.text.matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) assert.ok(new RegExp('\\.' + c + '(?![\\w-])').test(css), t.id + ': .' + c + ' が academic.css に無い');
    }
    // _class のクラスは section.<x> として在る
    const dm = t.text.match(/_class:\s*([^\s>]+(?:\s+[^\s>-]+)*)\s*-->/);
    if (dm) for (const c of dm[1].split(/\s+/)) assert.ok(new RegExp('section\\.' + c + '(?![\\w-])').test(css), t.id + ': section.' + c + ' が academic.css に無い');
    // 箇条書きは3点まで（このリポジトリの決まり：1枚で見比べるのは3つまで）
    assert.ok((t.text.match(/^- /gm) || []).length <= 3);
  }
  // 呼ぶたびに新しい配列（呼び出し側が書き換えても正本が壊れない）
  newSlideTemplates()[0].text = 'x';
  assert.notStrictEqual(newSlideTemplates()[0].text, 'x');
});

test('newSlideTemplates: 各テンプレートを挿入して marp-core で描画できる', { skip: !Marp && 'marp-core なし' }, () => {
  for (const theme of ['academic', 'parts-deck', 'tsutawaru-academic']) {
    const base = '---\nmarp: true\ntheme: ' + theme + '\npaginate: true\n---\n\n# 表紙\n\n---\n\n# 終わり\n';
    for (const tpl of newSlideTemplates()) {
      for (const src of [base, crlf(base)]) {
        const after = run(src, insertSlideAfter(src, 0, tpl.text), 3);
        const r = render(after);
        const sections = r.html.match(/<section[\s\S]*?<\/section>/g);
        assert.strictEqual(sections.length, 3);
        const sec = sections[1];
        assert.deepStrictEqual(r.comments[1], [], tpl.id + ': ディレクティブがノートに漏れた');
        const dm = tpl.text.match(/_class:\s*(\S+)/);
        if (dm) assert.match(sec, new RegExp('<section[^>]*class="' + dm[1] + '"'), tpl.id);
        // 生の HTML がエスケープされず、Markdown も解釈されている
        assert.ok(!/&lt;div/.test(sec), tpl.id + ': div がエスケープされた');
        assert.ok(/<h[12][ >]/.test(sec), tpl.id + ': 見出しが無い');
        if (/^- /m.test(tpl.text)) assert.strictEqual((sec.match(/<li[ >]/g) || []).length, 3, tpl.id + ': div の中の箇条書きが解釈されていない');
      }
    }
  }
});

// ---------------------------------------------------------------- 箇条書きの追加

/** marp-core（markdown-it）が付ける li の行範囲 [line, lineEnd] を実測する。プレビューの data-line / data-line-end と同じ値 */
function liMaps(text) {
  const marp = new Marp({ html: true });
  const out = [];
  marp.markdown.core.ruler.push('ss_test_li', (s) => { for (const t of s.tokens) if (t.type === 'list_item_open' && t.map) out.push([t.map[0], t.map[1]]); });
  marp.render(text);
  return out;
}
function mapOf(text, line) {
  const m = liMaps(text).find(x => x[0] === line);
  assert.ok(m, 'li が見つからない: line ' + line);
  return m;
}
const lineNo = (text, s) => text.split(/\r?\n/).indexOf(s);

const LIST_DECK = FM + [
  '',
  '## 見出し',
  '',
  '<div class="right">',
  '',
  '- a',
  '  - c1',
  '  - c2',
  '- b',
  '',
  '</div>',
  '',
  '1. x',
  '2. y',
  '',
  '---',
  '',
  '* p',
  '',
  '* q',
  '',
  '段落',
  '',
  '- last',
].join('\n');

test('addBulletAfter: 同じインデントと記号・入れ子の子の後ろ・div に挟まれた箇条書き', { skip: !Marp && 'marp-core なし' }, () => {
  const T = LIST_DECK;
  const check = (src, itemText, expectNewText, expectAfterLineText) => {
    const line = lineNo(src, itemText);
    const [l, le] = mapOf(src, line);
    const res = addBulletAfter(src, l, le);
    const after = run(src, res, count(src));
    const ls = after.split(/\r?\n/);
    assert.strictEqual(res.newLine, res.revealLine);
    assert.strictEqual(ls[res.newLine], expectNewText, itemText);
    if (expectAfterLineText !== undefined) {
      let k = res.newLine - 1;
      while (k >= 0 && ls[k].trim() === '') k--;
      assert.strictEqual(ls[k], expectAfterLineText, itemText + ': 入る位置が違う');
    }
    // 描画すると、新しい行がちょうど1つの空の li になり、同じリストに入る（リストの数は変わらない）
    const lis = liMaps(after);
    assert.ok(lis.some(x => x[0] === res.newLine), itemText + ': 新しい行が li になっていない');
    assert.strictEqual(lis.length, liMaps(src).length + 1);
    const lists = (s) => (render(s).html.match(/<(ul|ol)[ >]/g) || []).length;
    assert.strictEqual(lists(after), lists(src), itemText + ': リストが割れた');
    return after;
  };
  for (const src of [T, crlf(T)]) {
    check(src, '- a', '- ', '  - c2');           // 入れ子の子の後ろ
    check(src, '  - c1', '  - ', '  - c1');       // 子どうし
    check(src, '  - c2', '  - ', '  - c2');
    const a = check(src, '- b', '- ', '- b');     // 直後に空行と </div>
    const ls = a.split(/\r?\n/);
    const nl = ls.indexOf('- ');
    assert.deepStrictEqual(ls.slice(nl + 1, nl + 3), ['', '</div>'], '</div> の前の空行が無くなった');
    check(src, '1. x', '2. ', '1. x');
    check(src, '2. y', '3. ', '2. y');            // 直後に空行と ---（区切りは壊れない）
    check(src, '* p', '* ', '* p');               // loose list は空行で離す
    check(src, '* q', '* ', '* q');
    check(src, '- last', '- ', '- last');         // ファイル末尾（改行なし）
  }
});

test('addBulletAfter: loose list は空行を挟む・末尾改行ありのファイル末尾・タスクリスト・引用内', () => {
  const t = FM + '\n* p\n\n* q\n';
  const r = addBulletAfter(t, 5, 7);
  assert.strictEqual(applyEdits(t, r.edits), FM + '\n* p\n\n* \n\n* q\n');
  assert.strictEqual(r.newLine, 7);
  const r2 = addBulletAfter(t, 7, 8);
  assert.strictEqual(applyEdits(t, r2.edits), FM + '\n* p\n\n* q\n\n* \n');
  assert.strictEqual(r2.newLine, 9);
  // lineEnd が空行を含んでいても（markdown-it は末尾の空行を項目に含めることがある）位置は同じ
  assert.deepStrictEqual(addBulletAfter(t, 5, 6).edits, r.edits);
  const task = FM + '\n- [x] done\n- [ ] todo\n';
  assert.strictEqual(applyEdits(task, addBulletAfter(task, 5, 6).edits), FM + '\n- [x] done\n- [ ] \n- [ ] todo\n');
  const quote = FM + '\n> - a\n> - b\n';
  assert.strictEqual(applyEdits(quote, addBulletAfter(quote, 5, 6).edits), FM + '\n> - a\n> - \n> - b\n');
  const paren = FM + '\n9) a\n';
  assert.strictEqual(applyEdits(paren, addBulletAfter(paren, 5, 6).edits), FM + '\n9) a\n10) \n');
  // 記号の後ろの空白の数を保つ
  const wide = FM + '\n-   a\n';
  assert.strictEqual(applyEdits(wide, addBulletAfter(wide, 5, 6).edits), FM + '\n-   a\n-   \n');
});

test('addBulletAfter / removeBullet: 箇条書きでない行・範囲外は ok:false', () => {
  for (const f of [addBulletAfter, removeBullet]) {
    for (const [l, le] of [[5, 6], [-1, 0], [999, 1000], [undefined, undefined]]) {
      const r = f(FM + '\n段落\n', l, le);
      assert.strictEqual(r.ok, false);
      assert.deepStrictEqual(r.edits, []);
    }
  }
});

// ---------------------------------------------------------------- 箇条書きの削除

test('removeBullet: 入れ子の子ごと消す・最後の1項目は消さない', { skip: !Marp && 'marp-core なし' }, () => {
  for (const src of [LIST_DECK, crlf(LIST_DECK)]) {
    const rm = (itemText) => {
      const [l, le] = mapOf(src, lineNo(src, itemText));
      return removeBullet(src, l, le);
    };
    const NL = /\r\n/.test(src) ? '\r\n' : '\n';
    // 子ごと
    let after = run(src, rm('- a'), 2);
    assert.ok(after.includes('<div class="right">' + NL + NL + '- b' + NL + NL + '</div>'), after);
    // 最後の兄弟：div の前の空行は残る
    after = run(src, rm('- b'), 2);
    assert.ok(after.includes('  - c2' + NL + NL + '</div>'), after);
    // 子だけ
    after = run(src, rm('  - c1'), 2);
    assert.ok(after.includes('- a' + NL + '  - c2' + NL + '- b'));
    // 番号付き（区切り --- の直前）
    after = run(src, rm('2. y'), 2);
    assert.ok(after.includes('1. x' + NL + NL + '---'));
    after = run(src, rm('1. x'), 2);
    // 先頭を消したら後ろを繰り上げる（2. のままだと <ol start="2"> になり表示が 2. から始まる）
    assert.ok(after.includes('</div>' + NL + NL + '1. y' + NL + NL + '---'), after);
    // loose list：間の空行が2つ並ばない
    after = run(src, rm('* p'), 2);
    assert.ok(after.includes('---' + NL + NL + '* q' + NL + NL + '段落'));
    after = run(src, rm('* q'), 2);
    assert.ok(after.includes('* p' + NL + NL + '段落'));
    // リストの最後の1項目
    const r = rm('- last');
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.edits, []);
    assert.strictEqual(r.revealLine, lineNo(src, '- last'));
  }
});

test('removeBullet: ファイル末尾（改行なし）の項目・revealLine', () => {
  const t = FM + '\n- a\n- b';
  const r = removeBullet(t, 6, 7);
  assert.strictEqual(applyEdits(t, r.edits), FM + '\n- a');
  assert.strictEqual(r.revealLine, 5);
  const r0 = removeBullet(t, 5, 6);
  assert.strictEqual(applyEdits(t, r0.edits), FM + '\n- b');
  assert.strictEqual(r0.revealLine, 5);
  // 入れ子の子が1つだけ → その子は「リストの最後の1項目」
  const nested = FM + '\n- a\n  - only\n- b\n';
  assert.strictEqual(removeBullet(nested, 6, 7).ok, false);
  // 記号が違えば別のリスト（CommonMark）
  const two = FM + '\n- a\n\n* b\n';
  assert.strictEqual(removeBullet(two, 5, 6).ok, false);
});

test('addBulletAfter → removeBullet で元に戻る', { skip: !Marp && 'marp-core なし' }, () => {
  for (const src of [LIST_DECK, crlf(LIST_DECK), LIST_DECK + '\n']) {
    for (const [l, le] of liMaps(src)) {
      const add = addBulletAfter(src, l, le);
      assert.strictEqual(add.ok, true);
      const mid = applyEdits(src, add.edits);
      const m = mapOf(mid, add.newLine);
      const del = removeBullet(mid, m[0], m[1]);
      assert.strictEqual(del.ok, true, 'line ' + l + ': ' + del.reason);
      assert.ok(applyEdits(mid, del.edits) === src, 'line ' + l + ': 元に戻らない');
    }
  }
});

// ---------------------------------------------------------------- 見本デック3本（全スライドでループ）

const REAL_DECKS = [
  'slides/sample-lecture',
  'slides/sample-layouts',
  'slides/sample-parts',
];

for (const rel of REAL_DECKS) {
  const name = path.basename(rel);
  const file = path.join(REPO, rel, name + '.md');
  // 原本は読むだけ。編集はすべてメモリ上の文字列に対して行う（slides/ を書き換えない）
  test('見本デック ' + name + ': 複製→+1／上へ→下へで完全一致／削除→-1', { timeout: 600000, skip: !fs.existsSync(file) && 'デックが無い' }, (t) => {
    const original = fs.readFileSync(file, 'utf8');
    for (const text of [original, crlf(original.replace(/\r\n/g, '\n'))]) {
      const n = count(text);
      assert.ok(n > 5);
      const src = bodies(text);
      for (let i = 0; i < n; i++) {
        const dup = duplicateSlide(text, i);
        assert.strictEqual(dup.ok, true, 'dup ' + i + ': ' + dup.reason);
        const a = applyEdits(text, dup.edits);
        assert.strictEqual(count(a), n + 1, 'dup ' + i);
        const b = bodies(a);
        assert.strictEqual(b[i + 1], stripLibMark(src[i]).trim(), 'dup ' + i + ': コピーの中身が違う');
        assert.deepStrictEqual(b.slice(0, i + 1).concat(b.slice(i + 2)), src, 'dup ' + i + ': 他のスライドが変わった');

        const del = deleteSlide(text, i);
        assert.strictEqual(del.ok, true, 'del ' + i + ': ' + del.reason);
        const d = applyEdits(text, del.edits);
        assert.strictEqual(count(d), n - 1, 'del ' + i);
        assert.deepStrictEqual(bodies(d), src.filter((_, k) => k !== i), 'del ' + i + ': 他のスライドが変わった');

        // 複製してすぐ消すと、スライドの中身は元どおり
        const del2 = deleteSlide(a, i + 1);
        assert.strictEqual(del2.ok, true);
        assert.deepStrictEqual(bodies(applyEdits(a, del2.edits)), src, 'dup→del ' + i);

        const ins = insertSlideAfter(text, i, newSlideTemplates()[1].text);
        assert.strictEqual(ins.ok, true, 'ins ' + i + ': ' + ins.reason);
        assert.strictEqual(count(applyEdits(text, ins.edits)), n + 1, 'ins ' + i);
      }
      roundTrip(text, name);
    }
    // marp-core の実描画でも確かめる（全スライドでやると重いので、先頭・2枚目・中央・最後）
    if (Marp) {
      const n = count(original);
      assert.strictEqual(renderedCount(original), n);
      for (const i of [...new Set([0, 1, Math.floor(n / 2), n - 1])]) {
        assert.strictEqual(renderedCount(applyEdits(original, duplicateSlide(original, i).edits)), n + 1, 'marp dup ' + i);
        assert.strictEqual(renderedCount(applyEdits(original, deleteSlide(original, i).edits)), n - 1, 'marp del ' + i);
        if (i > 0) assert.strictEqual(renderedCount(applyEdits(original, moveSlide(original, i, -1).edits)), n, 'marp move ' + i);
      }
    }
    t.diagnostic(name + ': ' + count(original) + ' 枚');
  });
}

// ---------------------------------------------------------------- レビューで見つけた反例（再発防止）

test('入口の守り：原稿が文字列でなくても例外を投げない', () => {
  for (const bad of [undefined, null, 42, {}]) {
    for (const r of [duplicateSlide(bad, 0), deleteSlide(bad, 0), moveSlide(bad, 0, 1), insertSlideAfter(bad, 0, 'x'), addBulletAfter(bad, 0, 1), removeBullet(bad, 0, 1)]) {
      assert.strictEqual(r.ok, false);
      assert.deepStrictEqual(r.edits, []);
      assert.strictEqual(typeof r.reason, 'string');
    }
  }
  // 行・index が数値でない
  assert.strictEqual(duplicateSlide(DECK3, '0').ok, false);
  assert.strictEqual(addBulletAfter(DECK3, '7', 8).ok, false);
  assert.strictEqual(moveSlide(DECK3, 0, 2).ok, false);
});

test('空の原稿・frontmatter だけ・frontmatter の閉じ --- で終わる原稿', () => {
  for (const t of ['', '\n', FM, FM.trimEnd(), crlf(FM), crlf(FM).trimEnd(), '# only']) {
    const d = duplicateSlide(t, 0);
    const after = run(t, d, 2);
    assert.ok(after.startsWith(t), '元の原稿は先頭にそのまま残る');
    run(t, insertSlideAfter(t, 0, '# new'), 2);
    assert.strictEqual(deleteSlide(t, 0).ok, false);
    assert.strictEqual(moveSlide(t, 0, 1).ok, false);
  }
  // 閉じていない frontmatter は全体が frontmatter 扱い：書かずに断る
  const open = '---\nmarp: true';
  assert.strictEqual(duplicateSlide(open, 0).ok, false);
  assert.deepStrictEqual(insertSlideAfter(open, 0, '# x').edits, []);
});

test('insertSlideAfter: *** ___ - - - 字下げつき --- を含む本文は断る（marp では区切りになる）', { skip: !Marp && 'marp-core なし' }, () => {
  for (const hr of ['***', '___', '- - -', ' ---', '* * *', '_ _ _', '   ----']) {
    const body = '# x\n\n' + hr + '\n\n# y';
    assert.strictEqual(renderedCount(FM + '\n' + body), 2, 'marp では ' + hr + ' が区切りになる（前提の確認）');
    const r = insertSlideAfter(DECK3, 0, body);
    assert.strictEqual(r.ok, false, hr);
    assert.deepStrictEqual(r.edits, []);
  }
  // フェンス内・コメント内・番号付き箇条書きの区切り記号・強調は区切りではない
  for (const body of ['```\n***\n```', '<!--\nnote\n***\n-->\n\n# x', '**太字**\n\n* a\n* b', '# x\n\n--- という記号']) {
    run(DECK3, insertSlideAfter(DECK3, 0, body), 4);
  }
});

test('原稿に *** の区切り・headingDivider があるときは、スライド操作を断る（枚数が marp とずれるため）', () => {
  const t1 = FM + '\n# A\n\n***\n\n# B\n\n---\n\n# C\n';
  const t2 = '---\nmarp: true\nheadingDivider: 2\n---\n\n# A\n\n## B\n\n---\n\n# C\n';
  for (const t of [t1, t2, crlf(t1)]) {
    for (const r of [duplicateSlide(t, 0), deleteSlide(t, 0), moveSlide(t, 0, 1), insertSlideAfter(t, 0, '# n')]) {
      assert.strictEqual(r.ok, false);
      assert.deepStrictEqual(r.edits, []);
    }
  }
  assert.strictEqual(duplicateSlide(t1, 0).revealLine, 7, '案内先は *** の行');
  // フェンスの中の *** は数えない
  run(FM + '\n```\n***\n```\n\n---\n\n# B\n', duplicateSlide(FM + '\n```\n***\n```\n\n---\n\n# B\n', 0), 3);
});

test('最後のスライドが「… -->」という地の文で終わる（コメントの閉じではない）', () => {
  for (const base of [FM + '\n# A\n\n---\n\n# B\n\n矢印は `-->` と書く -->', FM + '\n# A\n<!-- n -->\n---\n\n# B\n\n矢印 -->\n']) {
    for (const t of [base, crlf(base)]) {
      const d = run(t, duplicateSlide(t, 1), 3);
      assert.strictEqual(bodyOf(d, 2), bodyOf(t, 1));
      run(t, insertSlideAfter(t, 1, '# n'), 3);
      const up = run(t, moveSlide(t, 1, -1), 2);
      assert.strictEqual(bodyOf(up, 0), bodyOf(t, 1));
      assert.strictEqual(bodyOf(up, 1), bodyOf(t, 0));
    }
  }
});

test('サロゲートペア・結合文字があってもオフセットがずれない', () => {
  const t = FM + '\n# 😀𠮷野家\n\n- 🍣寿司\n- 𩸽 が\n\n---\n\n# B👨‍👩‍👧\n';
  for (const src of [t, crlf(t)]) {
    const d = run(src, duplicateSlide(src, 0), 3);
    assert.strictEqual(bodyOf(d, 1), bodyOf(src, 0));
    assert.strictEqual(bodyOf(d, 2), bodyOf(src, 1));
    const a = addBulletAfter(src, 7, 8);
    const added = run(src, a, 2).split(/\r?\n/);
    assert.deepStrictEqual(added.slice(7, 10), ['- 🍣寿司', '- ', '- 𩸽 が']);
    assert.strictEqual(a.newLine, 8);
    const removed = run(src, removeBullet(src, 7, 8), 2);
    assert.ok(!removed.includes('🍣') && removed.includes('- 𩸽'));
    const m = run(src, moveSlide(src, 0, 1), 2);
    assert.strictEqual(applyEdits(m, moveSlide(m, 1, -1).edits), src);
  }
});

test('字下げした <div> で左右に分けた箇条書き：隣のパネルの項目を兄弟とみなさない・タグを消さない', { skip: !Marp && 'marp-core なし' }, () => {
  for (const pad of ['  ', ' ']) {
    const base = FM + '\n<div class="cols">\n' + pad + '<div class="left">\n\n- a\n\n' + pad + '</div>\n' + pad + '<div class="right">\n\n- c\n\n' + pad + '</div>\n</div>\n';
    for (const src of [base, crlf(base)]) {
      const NL = /\r\n/.test(src) ? '\r\n' : '\n';
      const la = lineNo(src, '- a'), lc = lineNo(src, '- c');
      const maps = liMaps(src);
      const ma = maps.find(m => m[0] === la), mc = maps.find(m => m[0] === lc);
      // 各パネルに1項目ずつ：どちらも「最後の1項目」なので消さない（以前は </div> と <div class="right"> ごと消した）
      for (const m of [ma, mc]) {
        const r = removeBullet(src, m[0], m[1]);
        assert.strictEqual(r.ok, false, JSON.stringify(applyEdits(src, r.edits)));
      }
      // 追加：自分のパネルの中・tight のまま（以前は </div> の後ろに入る／空行を挟んで loose になった）
      let after = run(src, addBulletAfter(src, ma[0], ma[1]), 1);
      assert.ok(after.includes('- a' + NL + '- ' + NL + NL + pad + '</div>'), JSON.stringify(after));
      after = run(src, addBulletAfter(src, mc[0], mc[1]), 1);
      assert.ok(after.includes('- c' + NL + '- ' + NL + NL + pad + '</div>' + NL + '</div>'), JSON.stringify(after));
    }
  }
});

test('項目の補足に1行の <div>…</div> を字下げして添える書き方（PreFD デックの型）は項目の一部として扱う', { skip: !Marp && 'marp-core なし' }, () => {
  const src = FM + '\n<div style="font-size:24px">\n\n- 一\n- 二\n  <div style="margin-left:2em">補足1</div>\n  <div style="margin-left:2em">補足2</div>\n- 三\n  <div>補足3</div>\n\n</div>\n';
  const maps = liMaps(src);
  const m2 = maps.find(m => m[0] === lineNo(src, '- 二'));
  let after = run(src, addBulletAfter(src, m2[0], m2[1]), 1);
  assert.ok(after.includes('補足2</div>\n- \n- 三'), after);
  after = run(src, removeBullet(src, m2[0], m2[1]), 1);
  assert.ok(after.includes('- 一\n- 三\n  <div>補足3</div>'), after);
  const m3 = maps.find(m => m[0] === lineNo(src, '- 三'));
  after = run(src, addBulletAfter(src, m3[0], m3[1]), 1);
  assert.ok(after.includes('補足3</div>\n- \n\n</div>'), after);
});

test('番号付きリスト：追加・削除で後ろの番号を振り直す（桁が変わるとき・全部 1. の流儀は触らない）', { skip: !Marp && 'marp-core なし' }, () => {
  const olStart = (text) => { const m = render(text).html.match(/<ol[^>]*>/); return m ? m[0] : ''; };
  const base = FM + '\n1. a\n   - 子\n2. b\n\n3. c\n\n段落\n';
  for (const src of [base, crlf(base)]) {
    const L = (s) => s.split(/\r?\n/);
    let after = run(src, addBulletAfter(src, 5, 7), 1);
    assert.deepStrictEqual(L(after).slice(5, 11), ['1. a', '   - 子', '2. ', '3. b', '', '4. c']);
    after = run(src, removeBullet(src, 5, 7), 1);
    assert.deepStrictEqual(L(after).slice(5, 8), ['1. b', '', '2. c']);
    assert.ok(!/start=/.test(olStart(after)), '先頭を消しても 1 から始まる');
    after = run(src, removeBullet(src, 7, 9), 1);
    assert.deepStrictEqual(L(after).slice(5, 8), ['1. a', '   - 子', '2. c']);
  }
  // 全部 1. と書く流儀：追加は 2.（既存の挙動）で、後ろの 1. は触らない
  const ones = FM + '\n1. a\n1. b\n1. c\n';
  assert.deepStrictEqual(run(ones, addBulletAfter(ones, 5, 6), 1).split('\n').slice(5, 9), ['1. a', '2. ', '1. b', '1. c']);
  assert.deepStrictEqual(run(ones, removeBullet(ones, 5, 6), 1).split('\n').slice(5, 7), ['1. b', '1. c']);
  // 9→10 は桁が変わる：子の字下げが合わなくなるので振り直さない
  const nine = FM + '\n8. h\n9. i\n   - 子\n';
  assert.deepStrictEqual(run(nine, addBulletAfter(nine, 5, 6), 1).split('\n').slice(5, 9), ['8. h', '9. ', '9. i', '   - 子']);
  // 追加→削除で完全に元へ戻る
  const added = addBulletAfter(base, 5, 7);
  const t2 = applyEdits(base, added.edits);
  assert.strictEqual(applyEdits(t2, removeBullet(t2, added.newLine, added.newLine + 1).edits), base);
  // 編集は互いに接しない（同じ位置への挿入と置換を並べない）
  const es = [...added.edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < es.length; i++) assert.ok(es[i].start > es[i - 1].end);
});

test('字下げなしの続きの行（lazy continuation）を持つ項目：追加→削除で元に戻る', { skip: !Marp && 'marp-core なし' }, () => {
  const src = FM + '\n### 他案\n\n- 一\n- 二\n→ 補足の行\n\n</div>\n';
  const m = mapOf(src, lineNo(src, '- 二'));
  assert.deepStrictEqual(m, [8, 11], '続きの行は項目の範囲に入る（前提の確認）');
  const a = addBulletAfter(src, m[0], m[1]);
  const t2 = run(src, a, 1);
  assert.ok(t2.includes('→ 補足の行\n- \n\n</div>'), t2);
  const back = removeBullet(t2, a.newLine, a.newLine + 1);
  assert.strictEqual(back.ok, true, back.reason);
  assert.strictEqual(applyEdits(t2, back.edits), src);
  // 続きの行がインラインのタグ（<img>）で始まる書き方（東大EIPデックの型）
  const img = FM + '\n- 一\n- 二\n<img src="./src/x.png" width="300">\n### 次\n';
  const mi = mapOf(img, lineNo(img, '- 二'));
  const ai = addBulletAfter(img, mi[0], mi[1]);
  const ti = run(img, ai, 1);
  assert.strictEqual(applyEdits(ti, removeBullet(ti, ai.newLine, ai.newLine + 1).edits), img);
  // 段落のあとに始まる別のリストは、段落より上の項目を兄弟とみなさない
  const two = FM + '\n- x\n\n段落1\n段落2\n- y\n';
  assert.strictEqual(removeBullet(two, 9, 10).ok, false);
});

test('stripLibMark: 発表者ノートの中の「_lib: …」という行は消さない／1つのスライドに印が2つあれば両方外す', () => {
  const note = '<!--\n_class: fig\n_lib: a | t | d\n-->\n\n# A\n\n<!-- 発表者ノート\n_lib: これはノートの中の行\n-->';
  assert.strictEqual(stripLibMark(note), '<!-- _class: fig -->\n\n# A\n\n<!-- 発表者ノート\n_lib: これはノートの中の行\n-->');
  assert.strictEqual(stripLibMark(crlf(note)), crlf('<!-- _class: fig -->\n\n# A\n\n<!-- 発表者ノート\n_lib: これはノートの中の行\n-->'));
  // <!-- と同じ行・--> と同じ行に書く形
  assert.strictEqual(stripLibMark('<!-- _class: summary\n_lib: a | t | d -->\n\n# A'), '<!-- _class: summary -->\n\n# A');
  assert.strictEqual(stripLibMark('<!--\n_lib: a\n_class: fig\n-->\n# A\n<!--\n_class: x\n_lib: b\n-->'), '<!-- _class: fig -->\n# A\n<!-- _class: x -->');
});

test('見出し・箇条書き・表の直後に空行なしで --- がある原稿：marp は区切るが slide-split は数えないので、操作を断る', { skip: !Marp && 'marp-core なし' }, () => {
  for (const head of ['# A', '- a\n- b', '|a|b|\n|-|-|\n|1|2|']) {
    const t = FM + '\n' + head + '\n---\n\n# B\n\n---\n\n# C\n';
    assert.strictEqual(renderedCount(t), 3, 'marp は3枚（前提の確認）');
    assert.strictEqual(count(t), 2, 'slide-split は2枚と数える（前提の確認。直ったらこのテストと守りを外す）');
    for (const r of [duplicateSlide(t, 0), deleteSlide(t, 1), moveSlide(t, 0, 1), insertSlideAfter(t, 0, '# n')]) {
      assert.strictEqual(r.ok, false);
      assert.deepStrictEqual(r.edits, []);
      assert.strictEqual(r.revealLine, t.split('\n').indexOf('---', 4));
    }
    assert.strictEqual(insertSlideAfter(DECK3, 0, head + '\n---\n\n# x').ok, false);
  }
  // 段落の直後の ---（setext 見出し）は marp も区切らない：操作できる
  const setext = FM + '\n見出しになる段落\n---\n\n本文\n\n---\n\n# B\n';
  assert.strictEqual(renderedCount(setext), 2);
  run(setext, duplicateSlide(setext, 0), 3);
});
