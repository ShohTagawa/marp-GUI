// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// スライド分割の正本（vscode 非依存・純粋関数）。
// extension.js / tools/*.mjs / テストの全部がここを使う。marp-core のページ分割と一致させること
// （148デックで実描画枚数と一致を確認済み。test/slide-split.test.cjs が回帰テスト）。
'use strict';

/**
 * 各スライドの開始行(0-based)を返す。marp-core のページ分割と一致するよう、
 * frontmatter を除外し、コードフェンス内と HTMLコメント内（発表者ノート等）を無視し、
 * setext 見出し（段落テキスト直後の ---）は区切りに数えない。
 * ただし直前が空行、または直前行で HTMLコメントが閉じた（-->）場合は区切り＝marp と一致。
 *   例: ノート `<!-- … -->` の直後に `---` を置く書き方は、marp ではページ区切りになる。
 *       これを取りこぼすと以降のスライドが1枚ずつズレる（同期・逆引きが別の場所へ飛ぶ）。
 */
function slideStartLines(text) {
  const lines = text.split(/\r?\n/);
  const starts = [];
  let i = 0;
  if (lines[0] !== undefined && /^---\s*$/.test(lines[0])) {
    let j = 1;
    while (j < lines.length && !/^---\s*$/.test(lines[j])) j++;
    i = j + 1; // frontmatter の閉じ --- の次行から最初のスライド
  }
  starts.push(i);
  let inFence = false;            // コードフェンス ``` / ~~~ の内側か
  let inComment = false;          // 複数行 HTMLコメント <!-- … --> の内側か
  let prevClosedComment = false;  // 直前の行で HTMLコメントが閉じたか（--> 直後の --- 判定用）
  for (let k = i; k < lines.length; k++) {
    const line = lines[k];
    const t = line.trim();
    // コメント内：閉じ --> を探すだけ。中の --- や ``` は区切り扱いしない
    if (inComment) {
      if (/-->/.test(line)) inComment = false;
      prevClosedComment = !inComment; // この行で閉じたら、次行の --- 判定に使う
      continue;
    }
    // コードフェンス内：閉じ記号を探すだけ
    if (inFence) {
      if (/^(```|~~~)/.test(t)) inFence = false;
      prevClosedComment = false;
      continue;
    }
    if (/^(```|~~~)/.test(t)) { inFence = true; prevClosedComment = false; continue; }
    // この行で開いて同一行内で閉じない HTMLコメント → 複数行コメントに入る
    if (/<!--/.test(line) && !/-->/.test(line.slice(line.indexOf('<!--') + 4))) {
      inComment = true; prevClosedComment = false; continue;
    }
    // 1行で完結する HTMLコメント（発表者ノート等）。marp では HTMLブロックが -->
    // の行で終わるので、直後の --- はページ区切りになる。複数行コメントと同じ扱いにする。
    // これを落とすと、ノート直後に --- を書いたデックだけ枚数が足りなくなる（例: 73枚→69枚）。
    if (/^<!--/.test(t) && /-->$/.test(t)) { prevClosedComment = true; continue; }
    if (/^---+\s*$/.test(line)) {
      const prev = k > 0 ? lines[k - 1].trim() : '';
      // 直前が空行 OR 直前行で HTMLコメントが閉じた（-->）→ スライド区切り（marp と一致）
      if (prev === '' || prevClosedComment) starts.push(k + 1);
    }
    prevClosedComment = false;
  }
  return starts;
}

/** 行番号(0-based)→ スライド index(0-based) */
function slideIndexForLine(starts, line) {
  let idx = 0;
  for (let n = 0; n < starts.length; n++) {
    if (starts[n] <= line) idx = n; else break;
  }
  return idx;
}

/** スライド index → 原稿の行範囲 [start, end)(end は exclusive。次スライドの開始行＝区切り --- の次行) */
function lineRangeForSlide(starts, idx, lineCount) {
  const start = starts[idx] !== undefined ? starts[idx] : 0;
  const end = starts[idx + 1] !== undefined ? starts[idx + 1] : lineCount;
  return [start, end];
}

/** frontmatter の行範囲 {start:0, end}（end は閉じ --- の行番号。無ければ null） */
function frontmatterRange(lines) {
  if (lines[0] === undefined || !/^---\s*$/.test(lines[0])) return null;
  let j = 1;
  while (j < lines.length && !/^---\s*$/.test(lines[j])) j++;
  if (j >= lines.length) return null;
  return { start: 0, end: j };
}

/**
 * デック全体を構造化して返す。
 *   slides[i] = { index, startLine, endLine, sepLine }
 *     startLine … スライド本文の先頭行（区切り --- の次行。1枚目は frontmatter の次行）
 *     endLine   … 本文の終わり（exclusive）。次の区切り --- の行番号、最後のスライドは lines.length
 *     sepLine   … このスライドの「前」にある区切り --- の行番号（1枚目は -1）
 */
function splitDeck(text) {
  const lines = text.split(/\r?\n/);
  const starts = slideStartLines(text);
  const fm = frontmatterRange(lines);
  const slides = starts.map((s, i) => ({
    index: i,
    startLine: s,
    endLine: starts[i + 1] !== undefined ? starts[i + 1] - 1 : lines.length,
    sepLine: i === 0 ? -1 : s - 1,
  }));
  return { lines, starts, frontmatter: fm, slides };
}

/** 「完成スライド」の印のキー名（_class と同じディレクティブコメントに同居させる。単独で書くとノートに混入する） */
const LIB_KEY = '_lib';

/**
 * スライド1枚の要約（折りたたみ行のラベル・一覧・台帳で共用）。
 *   classes … _class ディレクティブの値（空なら []）
 *   title   … .page-title の中身 → 無ければ最初の見出し(#〜###) → 無ければ ''
 *   marked  … LIB_KEY を含むディレクティブコメントがあるか
 */
function slideMeta(lines, startLine, endLine) {
  let classes = [], title = '', heading = '', marked = false;
  const libRe = new RegExp('^\\s*' + LIB_KEY + '\\s*:');
  for (let k = startLine; k < endLine && k < lines.length; k++) {
    const line = lines[k];
    const cm = line.match(/^\s*(?:<!--\s*)?_class\s*:\s*([^>]*?)\s*(?:-->)?\s*$/);
    if (cm && !classes.length) classes = cm[1].replace(/^["']|["']$/g, '').split(/\s+/).filter(Boolean);
    if (libRe.test(line.replace(/^\s*<!--\s*/, ''))) marked = true;
    if (!title) {
      const pt = line.match(/class\s*=\s*"[^"]*\bpage-title\b[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (pt) title = stripTags(pt[1]);
    }
    if (!heading) {
      const hm = line.match(/^#{1,3}\s+(.*)$/);
      if (hm) heading = stripTags(hm[1]).replace(/\*\*|__|`/g, '');
    }
  }
  return { classes, title: title || heading, marked };
}

function stripTags(s) {
  return String(s).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = {
  slideStartLines, slideIndexForLine, lineRangeForSlide,
  frontmatterRange, splitDeck, slideMeta, stripTags, LIB_KEY,
};
