// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 折りたたみ範囲・スライドラベル・パネルラベルの計算（vscode 非依存・純粋関数）。
// 原稿（.md）は読むだけ。原稿に書くのは planWritePanelLabels の編集だけで、それも
// 「開始タグと同じ行の行末」に限る（単独行のコメントは発表者ノートに混入する＝実測）。
// vscode 側の配線は lib/folding-vscode.cjs。DESIGN.md 4 が取り決めの正本。
'use strict';

const { splitDeck, slideMeta, stripTags } = require('./slide-split.cjs');

// ---------------------------------------------------------------------------
// 共通：原稿を1行ずつ走査して「その行がどんな文脈にあるか」を出す
// ---------------------------------------------------------------------------

// markdown-it の html_block 種別6（段落を中断でき、空行まで続く）を始めるタグ名。
// ここに無いタグ（span・svg・img など）は段落の途中だと html_inline になり、
// そこに置いたコメントは発表者ノートに入る。ラベルを書いてよい行の判定に使う。
const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details ' +
  'dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html ' +
  'iframe legend li link main menu menuitem nav noframes ol optgroup option p param section summary table tbody td ' +
  'tfoot th thead title tr track ul').split(' '));

// Marpit / marp-core が知っているディレクティブのキー。コメントの中にこれが1つでもあれば
// コメント全体がディレクティブ扱いになり、発表者ノートには入らない。
const DIRECTIVE_KEY_RE = new RegExp('^\\s*_?(?:class|theme|paginate|header|footer|style|size|math|lang|marp|title|author|' +
  'description|keywords|url|image|headingDivider|color|backgroundColor|backgroundImage|backgroundPosition|' +
  'backgroundRepeat|backgroundSize|transition|auto-scaling)\\s*:');

/** コメントの中身（<!-- と --> を除いた文字列）がディレクティブか */
function isDirectiveComment(inner) {
  return String(inner).split(/\r?\n/).some(l => DIRECTIVE_KEY_RE.test(l));
}

/** 行頭の字下げを桁数で返す（タブは4桁ごとのタブ位置まで。markdown-it と同じ数え方）。字数で数えると、タブ1つの行をコードブロックと見抜けない */
function indentCols(line) {
  let n = 0;
  for (const ch of line) { if (ch === ' ') n++; else if (ch === '\t') n += 4 - (n % 4); else break; }
  return n;
}

/**
 * 原稿を走査し、行ごとの文脈と、複数行ブロック（style / svg / コメント）の範囲を返す。
 *   ctx[k] = { fence, comment, style, svg, html, slide }
 *     fence/comment/style/svg … その行の「先頭」がそれぞれの内側か
 *     html  … その行の先頭が、前の行から続く html_block の内側か（空行で切れる）
 *     slide … スライド index（frontmatter は -1。区切り --- の行は「その行が頭に付くスライド」に入れる）
 *   blocks = [{ start, end, kind:'style'|'svg'|'notes', slide, directive? }]（1行で完結するものは含めない）
 * スライドの境目で svg / style の状態を捨てる。コード例の中の `<svg>` などで閉じ忘れと誤認しても、
 * 被害をその1枚に閉じ込めるため。
 */
function scan(text) {
  const deck = splitDeck(text);
  const { lines, slides } = deck;
  const ctx = new Array(lines.length);
  const blocks = [];
  // 行 → スライド index。区切り行はそのスライドの見出し行として扱う（畳んだとき見えるのがこの行なので）
  const slideOf = new Array(lines.length).fill(-1);
  for (const s of slides) {
    const from = s.sepLine >= 0 ? s.sepLine : s.startLine;
    for (let k = from; k < s.endLine && k < lines.length; k++) slideOf[k] = s.index;
  }
  const sepLines = new Set(slides.filter(s => s.sepLine >= 0).map(s => s.sepLine));

  let inFence = false, inMath = false, inComment = false, html = false;
  let raw = '';          // 中身をそのまま扱う要素の内側：'style' | 'script' | 'textarea'（コメントを書くと中身が変わる）
  let block1 = false;    // html_block 種別1（<pre> <script> <style> <textarea>。空行では切れず、終了タグの行で終わる）の内側か
  let prevEndsBlock = false; // 直前の行でブロックが閉じた（種別1・コメント・見出し）。種別7はこの直後なら始められる
  let commentStart = -1, commentBuf = '', styleStart = -1;
  let svgStack = [];
  const bodyStart = slides.length ? slides[0].startLine : 0;
  const TOKEN = /<!--|-->|<(?:style|script|textarea)\b|<\/(?:style|script|textarea)\s*>|<svg\b|<\/svg\s*>/gi;
  const BLOCK1_OPEN = /^<(?:pre|script|style|textarea)(?=[\s>]|$)/i;
  const BLOCK1_CLOSE = /<\/(?:pre|script|style|textarea)>/i;

  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (k < bodyStart) { ctx[k] = { fence: false, comment: false, style: false, svg: false, html: false, slide: -1 }; continue; }
    if (sepLines.has(k) && !inComment && !inFence) { raw = ''; svgStack = []; html = false; block1 = false; inMath = false; }
    // fence は「書かれた文字がそのまま出る場所」の意味で、数式ブロック（$$ … $$）も含める。
    // style は <script> <textarea> の内側も含む（どれもコメントを足すと中身が変わる）。
    ctx[k] = { fence: inFence || inMath, comment: inComment, style: raw !== '', svg: svgStack.length > 0, html: html || block1, slide: slideOf[k] };

    const t = line.trim();
    const indent = indentCols(line);
    const prevBlank = k === bodyStart || lines[k - 1].trim() === '' || sepLines.has(k - 1) || prevEndsBlock;
    prevEndsBlock = false;
    if (inFence) { if (/^(```|~~~)/.test(t)) { inFence = false; prevEndsBlock = true; } continue; }
    if (inMath) { if (/\$\$\s*$/.test(t)) { inMath = false; prevEndsBlock = true; } continue; }
    // フェンスの判定は slide-split.cjs と同じ条件にしておく（区切りの数え方とずれないように）
    if (!inComment && !raw && /^(```|~~~)/.test(t)) { inFence = true; ctx[k].fenceOpen = true; continue; }
    if (!inComment && !raw && !html && !block1) {
      // 数式ブロック：$$ で始まり、同じ行で閉じていない（marp-core は既定で数式が有効）
      if (indent < 4 && /^\$\$/.test(t) && !(t.length > 3 && /\$\$\s*$/.test(t))) { inMath = true; ctx[k].fenceOpen = true; continue; }
    }

    const startedInComment = inComment;
    // 行内を左から読む。コメントの中では --> だけ、style / script / textarea の中ではその終了タグだけを見る
    TOKEN.lastIndex = 0;
    let m, segStart = 0;
    while ((m = TOKEN.exec(line))) {
      const tok = m[0].toLowerCase();
      if (inComment) {
        if (tok === '-->') {
          commentBuf += line.slice(segStart, m.index);
          if (commentStart < k) {
            blocks.push({ start: commentStart, end: k, kind: 'notes', slide: slideOf[commentStart], directive: isDirectiveComment(commentBuf) });
          }
          inComment = false;
        }
        continue;
      }
      if (raw) {
        if (tok.startsWith('</' + raw)) {
          if (raw === 'style' && styleStart < k) blocks.push({ start: styleStart, end: k, kind: 'style', slide: slideOf[styleStart] });
          raw = '';
        }
        continue;
      }
      if (tok === '<!--') { inComment = true; commentStart = k; commentBuf = ''; segStart = m.index + 4; }
      else if (tok === '<style' || tok === '<script' || tok === '<textarea') { raw = tok.slice(1); if (raw === 'style') styleStart = k; }
      else if (tok === '<svg') { svgStack.push(k); }
      else if (tok.startsWith('</svg')) {
        const s = svgStack.pop();
        if (s !== undefined && s < k) blocks.push({ start: s, end: k, kind: 'svg', slide: slideOf[s] });
      }
    }
    if (inComment) commentBuf += line.slice(segStart) + '\n';

    // html_block の続き判定（次の行のための状態）。markdown-it の規則をなぞる：
    //   種別1 <pre|script|style|textarea> … 終了タグのある行まで（空行では切れない）。次の行は新しいブロック
    //   種別2 <!-- …                        … --> のある行まで。次の行は新しいブロック
    //   種別6 ブロックタグで始まる行          … 空行まで
    //   種別7 タグだけの行                   … 空行まで。段落は中断できない（直前が空行かブロックの終わりのときだけ）
    // すでに html_block の中（種別6・7）なら、コメントや <style> があっても空行まで同じブロックが続く。
    // ここを甘く見て「html_block の中」と誤認すると、書いたラベルが発表者ノートに入る。迷ったら false に倒す。
    if (block1) {
      if (BLOCK1_CLOSE.test(line)) { block1 = false; prevEndsBlock = true; }
    } else if (t === '') html = false;
    else if (!html) {
      if (startedInComment) { if (!inComment) prevEndsBlock = true; }          // 種別2の続き・終わり
      else if (indent < 4 && /^<!--/.test(t)) { if (!inComment) prevEndsBlock = true; } // 種別2の開始（1行で閉じたら次は新しいブロック）
      else if (indent < 4 && BLOCK1_OPEN.test(t)) {
        if (BLOCK1_CLOSE.test(t)) prevEndsBlock = true; else block1 = true;
      } else {
        const tm = t.match(/^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)/);
        if (indent < 4 && tm && BLOCK_TAGS.has(tm[1].toLowerCase())) html = true;
        // <svg …> や <span …> だけの行（種別7）も空行まで続く html_block になる
        else if (indent < 4 && prevBlank && /^<\/?[A-Za-z][^>]*>\s*$/.test(t)) html = true;
        else if (indent < 4 && /^#{1,6}(?:\s|$)/.test(t)) prevEndsBlock = true; // ATX 見出しは1行で閉じる
      }
    }
  }
  return { deck, ctx, blocks };
}

// ---------------------------------------------------------------------------
// 折りたたみ範囲
// ---------------------------------------------------------------------------

/**
 * 折りたたみ範囲を返す。行番号は 0-based、end は含む。必ず start < end（1行のものは範囲にしない）。
 *   kind: 'slide' | 'style' | 'svg' | 'notes' | 'frontmatter-style' | 'frontmatter-style-all'   slide: スライド index（frontmatter は -1）
 *   frontmatter-style は自動で畳む範囲（先頭の :root＝調整つまみ を除いた残り）、frontmatter-style-all は style: 全体（手で畳む用）
 * スライドの範囲は「区切り --- の行」から「次の --- の前の行」まで。末尾の空行も範囲に入れるので、
 * 畳むと区切り行だけが隙間なく並ぶ。opts.trimTrailingBlank=true なら末尾の空行を範囲から外す
 * （VS Code 標準の Markdown 見出しと同じ流儀。畳んだとき空行が1つ残る）。
 * 1枚目は区切りが無いので、本文の最初の空でない行から。
 * VS Code は同じ開始行の範囲を1つしか採らず、交差する範囲は親子関係が壊れるので、
 * 最後に「同じ開始行」「部分的な重なり」を落として入れ子だけにする。
 */
/**
 * frontmatter の style: ブロックが :root { … } で始まるとき、その閉じ } の行番号を返す（無ければ -1）。
 * from〜to は style: の中身の行範囲（to は含む）。
 * 波括弧として数えないもの：CSS コメントの中・引用符の中（"…}…"）・引用符なしの url( … ) の中（http://x/*y をコメントと誤認しない）。
 * 最初のルールのセレクタは :root（大文字小文字は問わない。`:root, section` のような並記も可。`{` が次の行でもよい）。
 * :root が先頭（空行と CSS コメントだけを挟んでよい）に無い・閉じていないデックは、従来どおり丸ごと畳む。
 */
function knobBlockEnd(lines, from, to) {
  let depth = 0, opened = false, inComment = false, sel = '';
  const isRoot = (s) => s.split(',').some(x => /^:root$/i.test(x.trim()));
  for (let j = from; j <= to; j++) {
    const raw = lines[j];
    let quote = '', inUrl = false;                 // 文字列と url( ) は行をまたがない（閉じ忘れを次の行へ持ち越さない）
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (inComment) { if (raw.startsWith('*/', i)) { inComment = false; i++; } continue; }
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
      if (inUrl) { if (ch === ')') inUrl = false; else if (ch === '"' || ch === "'") { inUrl = false; quote = ch; } continue; }
      if (raw.startsWith('/*', i)) { inComment = true; i++; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '(' && /url$/i.test(raw.slice(Math.max(0, i - 3), i))) { inUrl = true; continue; }
      if (!opened) {                               // 最初のルールのセレクタを { まで集める
        if (ch === '{') { if (!isRoot(sel)) return -1; opened = true; depth = 1; }
        else if (ch === '}' || ch === ';' || sel.length > 200) return -1; // @import …; など。つまみ扱いしない
        else sel += ch;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return j;
    }
    if (!opened) sel += ' ';
  }
  return -1;                                       // 閉じていない（書きかけ）→ つまみ扱いしない
}

function foldingRanges(text, opts) {
  const trim = !!(opts && opts.trimTrailingBlank);
  const { deck, blocks } = scan(text);
  const { lines, slides, frontmatter } = deck;
  const out = [];

  // frontmatter の style: | ブロック。キーより深い字下げが続く間（空行は挟んでよい）
  if (frontmatter) {
    for (let k = 1; k < frontmatter.end; k++) {
      const m = lines[k].match(/^(\s*)style\s*:\s*[|>][+-]?\d*\s*$/);
      if (!m) continue;
      const base = m[1].length;
      let end = k;
      for (let j = k + 1; j < frontmatter.end; j++) {
        if (lines[j].trim() === '') continue;
        if (lines[j].length - lines[j].trimStart().length <= base) break;
        end = j;
      }
      if (end > k) {
        // style: の先頭にある :root { … }（ヘッダー幅・行長の「調整つまみ」）はよく触るので、畳まずに見せる。
        // 自動で畳むのは、つまみの後ろに続くデック固有 CSS だけ（kind:'frontmatter-style'）。
        // 丸ごと畳みたいとき用に、外側の範囲（kind:'frontmatter-style-all'。自動では畳まない）も出す。
        const knobEnd = knobBlockEnd(lines, k + 1, end);
        if (knobEnd < 0) out.push({ start: k, end, kind: 'frontmatter-style', slide: -1 });
        else {
          out.push({ start: k, end, kind: 'frontmatter-style-all', slide: -1 });
          let rest = knobEnd + 1;
          while (rest <= end && lines[rest].trim() === '') rest++;
          if (rest < end) out.push({ start: rest, end, kind: 'frontmatter-style', slide: -1 });
        }
      }
      break;
    }
  }

  for (const s of slides) {
    let start = s.sepLine >= 0 ? s.sepLine : s.startLine;
    let end = Math.min(s.endLine, lines.length) - 1;
    if (s.sepLine < 0) while (start < end && lines[start].trim() === '') start++;
    // 最後のスライドは、ファイル末尾の改行でできる空行を含めない（VS Code の行数と合わせやすい）
    if (trim || s.index === slides.length - 1) while (end > start && lines[end].trim() === '') end--;
    if (end > start) out.push({ start, end, kind: 'slide', slide: s.index });
  }

  for (const b of blocks) {
    if (b.kind === 'notes' && b.directive) continue; // ディレクティブだけのコメントは畳まない（_class が隠れると困る）
    out.push({ start: b.start, end: b.end, kind: b.kind, slide: b.slide });
  }
  return sanitize(out);
}

/** 開始行順に並べ、同じ開始行（外側＝長い方を残す）と部分的な重なり（後から始まる方）を落とす */
function sanitize(ranges) {
  const sorted = ranges.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  const stack = []; // いま開いている外側の範囲
  for (const r of sorted) {
    while (stack.length && stack[stack.length - 1].end < r.start) stack.pop();
    const top = stack[stack.length - 1];
    if (top && (r.start === top.start || r.end > top.end)) continue;
    out.push(r); stack.push(r);
  }
  return out;
}

/** 各スライドの「頭の行」（区切り --- の行。1枚目は 0）。slideIndexAt と組で、原稿を毎回分割し直さずに済ませる */
function slideHeads(text) {
  return splitDeck(text).slides.map(s => (s.sepLine >= 0 ? s.sepLine : 0));
}
function slideIndexAt(heads, line) {
  let idx = 0;
  for (let n = 0; n < heads.length; n++) { if (heads[n] <= line) idx = n; else break; }
  return idx;
}

/** 行 → スライド index。区切り --- の行は、その行が頭に付くスライドに数える（畳んだ行をクリックしたらそのスライドが開くように） */
function slideAtLine(text, line) {
  const { slides } = splitDeck(text);
  let idx = 0;
  for (const s of slides) {
    const from = s.sepLine >= 0 ? s.sepLine : 0;
    if (from <= line) idx = s.index; else break;
  }
  return idx;
}

// ---------------------------------------------------------------------------
// スライドのラベル
// ---------------------------------------------------------------------------

const cut = (s, n) => { const a = Array.from(String(s)); return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };

/**
 * 各スライドの見出し行に出すラベル。line は区切り --- の行（1枚目は本文の最初の空でない行＝折りたたみ範囲の開始行と同じ）。
 *   text 例: '12 ｜ summary ｜ 今回の構成 ★'（★ は「完成スライド」の印つき）
 */
function slideLabels(text) {
  const { lines, slides } = splitDeck(text);
  return slides.map(s => {
    let line = s.sepLine;
    if (line < 0) {
      line = s.startLine;
      const last = Math.min(s.endLine, lines.length) - 1;
      while (line < last && lines[line].trim() === '') line++;
      if (line >= lines.length) line = Math.max(0, lines.length - 1);
    }
    const meta = slideMeta(lines, s.startLine, s.endLine);
    const parts = [String(s.index + 1)];
    if (meta.classes.length) parts.push(meta.classes.join(' '));
    if (meta.title) parts.push(cut(meta.title, 30));
    return { line, index: s.index, text: parts.join(' ｜ ') + (meta.marked ? ' ★' : '') };
  });
}

// ---------------------------------------------------------------------------
// パネルのラベル
// ---------------------------------------------------------------------------

// クラス名 → 日本語。上から順に最初に当たったものを使う（1つの div に複数クラスがあるとき）。
// 実デックの「行頭の <div class>」の出現数（2026-09 時点・148デック）と theme/*.css で決めた：
//   page-title 3379 / box-accent 1173 / box-info 1048 / takeaway 1011 / stepbox 741 / cite 697 / box-warn 618 /
//   pcard 439 / subhead 330 / split-body 302 / left・right 296 / sec-box 295 / goal-box 255 / fig-area 223 /
//   caption 193 / body 184 / fbox 177 / title-hero 169 / tcols 163 / cardrow 128 / sections 121 / flowrow 74
// ppt-*（pptx 変換の座標箱）と pip-safe（余白の指定だけ）は、数は多いが意味のある区画ではないので載せない。
//   withHead … 中の最初の見出し（h1〜h6・### ・pc-h・st・太字）を添える
const PANEL_DICT = [
  ['left', '◀ 左パネル'], ['right', '▶ 右パネル'],
  ['split-body', '左右2分割'],
  ['sections', 'まとめ枠の並び'], ['sec-box', 'まとめ枠', true],
  ['cols', '横並びの列'], ['tcols', '横並びの列'], ['grid2', '2列'], ['grid3', '3列'],
  ['cardrow', 'カードの並び'], ['pcard', 'カード', true],
  ['qa-grid', '質問と回答'],
  ['takeaway', '要点の帯'], ['page-title', 'ページタイトル'],
  ['fig-area', '図の領域'], ['caption', '図の説明'], ['attr', '出典（図）'], ['cite', '出典'],
  ['box-accent', '強調の枠', true], ['box-info', '補足の枠', true], ['box-warn', '注意の枠', true],
  ['callout-gray', '帯つき枠（灰）', true], ['callout-green', '帯つき枠（緑）', true], ['callout-pink', '帯つき枠（桃）', true],
  ['callout-orange', '帯つき枠（橙）', true], ['callout-yellow', '帯つき枠（黄）', true], ['callout-blue', '帯つき枠（青）', true],
  ['stepbox', '手順の枠', true], ['flowrow', '矢印フロー'], ['fbox', 'フローの箱', true],
  ['goal-box', '達成目標', true], ['subhead', 'サブ見出し'], ['body', '本文ゾーン'],
  ['title-hero', '表紙：タイトル'], ['title-event', '表紙：イベント名'], ['title-big', '表紙：大見出し'],
  ['title-small', '表紙：小見出し'], ['title-meta', '表紙：発表者・日付'], ['title-photo', '表紙：写真'], ['title-foot', '表紙：下段'],
  ['indent-sm', '字下げ（小）'], ['indent-md', '字下げ（中）'], ['indent-lg', '字下げ（大）'], ['indent-xl', '字下げ（特大）'],
];
const HEAD_CLASSES = /\b(?:pc-h|sec-h|st|gc-h|c3-h|cmp-h|fb-h)\b/;
const HEAD_MAX = 20;

/** 開始行 k の要素の中から、最初の見出しらしい文字を探す（同じ行の残りと、続く数行だけを見る） */
function findHeadText(lines, k, restOfLine) {
  const tryLine = (s) => {
    let m = s.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);
    if (m) return stripTags(m[1]);
    m = s.match(/^\s*#{1,6}\s+(.*)$/);
    if (m) return stripTags(m[1]).replace(/\*\*|__|`/g, '');
    m = s.match(/<(\w+)\b[^>]*class\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/\1>/);
    if (m && HEAD_CLASSES.test(m[2])) return stripTags(m[3]);
    m = s.match(/^\s*(?:<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>|\*\*(.+?)\*\*)/);
    if (m) return stripTags(m[1] || m[2]);
    return '';
  };
  let got = tryLine(restOfLine);
  if (got) return got;
  if (/<\/div>/.test(restOfLine)) return ''; // 1行で閉じている
  let seen = 0;
  for (let j = k + 1; j < lines.length && seen < 4; j++) {
    const s = lines[j];
    if (s.trim() === '') continue;
    if (/^\s*<\/div>/.test(s) || /^---+\s*$/.test(s)) break;
    seen++;
    got = tryLine(s);
    if (got) return got;
  }
  return '';
}

// 開始タグ・終了タグを1つずつ拾う（属性値の中の > で切れないよう、引用符の中は読み飛ばす）
const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const classList = (attrs) => {
  const cm = attrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  return cm ? (cm[1] || cm[2] || '').split(/\s+/).filter(Boolean) : [];
};

/**
 * パネルのラベル。行頭がタグの行で、その行の開始タグのクラスが辞書にあるものだけ。
 *   [{ line, text, multiline, safe }]
 *     multiline … 同じ行で閉じていない（＝中身が下に続く区画）
 *     safe      … この行の行末にコメントを書いても発表者ノートに入らない（html_block の中）
 * 1行に開始タグが複数あるとき（実デックに多い `<div class="split-body"><div class="left">`）は、
 * その行で開いたままの区画を外側から順に ' › ' でつなぐ。全部その行で閉じていれば先頭の1つだけ。
 * split-body の直下の div は、クラスが left/right でなくても 1つ目を左・2つ目を右とする。
 * 同じ行にすでにコメントがあれば出さない（原稿に書いたラベルと二重にしない）。
 */
function panelLabels(text) {
  const { deck, ctx } = scan(text);
  const { lines } = deck;
  const out = [];
  let stack = [];       // 開いている div：{ cls:[…], kids }（split-body の子を数えるためだけ。厳密な HTML 解析はしない）
  let curSlide = -2;
  for (let k = 0; k < lines.length; k++) {
    const c = ctx[k];
    if (!c || c.slide < 0) continue;
    if (c.slide !== curSlide) { curSlide = c.slide; stack = []; } // 閉じ忘れを次のスライドへ持ち越さない
    if (c.fence || c.fenceOpen || c.comment || c.style || c.svg) continue;
    const line = lines[k];
    const indent = line.length - line.trimStart().length;
    const opened = [];  // この行で開いた要素：{ tag, label, closed, first }
    let firstTag = null;
    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(line))) {
      const tag = m[2].toLowerCase();
      if (firstTag === null && m.index === indent) firstTag = tag; // 行頭のタグ（`</div><div class="right">` のように終了タグでもよい）
      if (m[1]) { // 終了タグ
        for (let j = opened.length - 1; j >= 0; j--) if (opened[j].tag === tag && !opened[j].closed) { opened[j].closed = true; break; }
        if (tag === 'div') stack.pop();
        continue;
      }
      const first = m.index === indent;
      if (VOID_TAGS.has(tag) || /\/\s*$/.test(m[3])) continue;
      const cls = classList(m[3]);
      let side = '';
      if (tag === 'div') {
        const parent = stack[stack.length - 1];
        if (parent && parent.cls.includes('split-body')) {
          parent.kids++;
          if (!cls.includes('left') && !cls.includes('right')) side = parent.kids === 1 ? '◀ 左パネル' : parent.kids === 2 ? '▶ 右パネル' : '';
        }
        stack.push({ cls, kids: 0 });
      }
      const hit = PANEL_DICT.find(([name]) => cls.includes(name));
      let label = '';
      if (hit || side) {
        label = side && hit ? side + '・' + hit[1] : side || hit[1];
        if (hit && hit[2]) {
          const head = findHeadText(lines, k, line.slice(m.index + m[0].length));
          if (head) label += '：' + cut(head, HEAD_MAX);
        }
      }
      opened.push({ tag, label, closed: false, first });
    }
    // 行頭がタグの行だけ（文の途中の <span class="…"> などは区画ではない）。svg は図の中身なので出さない
    if (!firstTag || firstTag === 'svg' || /<!--/.test(line)) continue;
    const cands = opened.filter(o => o.label);
    let chosen = cands.filter(o => !o.closed);
    if (!chosen.length) chosen = cands.filter(o => o.first);
    if (!chosen.length) continue;
    out.push({
      line: k, text: chosen.map(o => o.label).join(' › '),
      multiline: chosen.some(o => !o.closed),
      // 種別6の開始行（字下げ3つまで）か、前から続く html_block の中なら、行末のコメントはノートにならない
      safe: (BLOCK_TAGS.has(firstTag) && indentCols(line) < 4) || c.html,
    });
  }
  return out;
}

/**
 * パネルのラベルを原稿に書く編集を返す。slideRange = [startLine, endLine)（行番号。省略でデック全体）。
 * 開始タグと同じ行の行末に ` <!-- ラベル -->` を足すだけ。単独行には決して書かない。
 * 書くのは「中身が下に続く区画」で、かつノートに混入しないと言い切れる行（safe）だけ。
 * ラベルの中の `--` はコメントを壊すので全角に直す。
 *   → [{ start, end, text }]（UTF-16 オフセット。start===end の挿入）
 */
function planWritePanelLabels(text, slideRange) {
  const from = slideRange ? slideRange[0] : 0;
  const to = slideRange ? slideRange[1] : Infinity;
  const labels = panelLabels(text).filter(l => l.line >= from && l.line < to && l.multiline && l.safe);
  if (!labels.length) return [];
  // 行末のオフセット（改行の手前。CRLF なら \r の手前）
  const ends = [];
  const re = /\r?\n/g;
  let m;
  while ((m = re.exec(text))) ends.push(m.index);
  ends.push(text.length);
  return labels.map(l => {
    const lineStart = l.line === 0 ? 0 : ends[l.line - 1] + (text[ends[l.line - 1]] === '\r' ? 2 : 1);
    const raw = text.slice(lineStart, ends[l.line]);
    const at = lineStart + raw.replace(/\s+$/, '').length; // 行末の空白の手前に入れる
    const body = l.text.replace(/--+/g, '―').replace(/[<>]/g, '');
    return { start: at, end: at, text: ' <!-- ' + body + ' -->' };
  });
}

// ---------------------------------------------------------------------------
// 診断：ノートに混入するラベル風コメント
// ---------------------------------------------------------------------------

const PUNCT = /[。、，．,.!?！？]/;

/**
 * 発表者ノートに混入する位置（＝単独行で、html_block の外）にある
 *   ・ラベル風の短いコメント（1行・20字以内・句読点なし・ディレクティブでない）
 *   ・#region / #endregion
 * を返す。 [{ line, text }]
 */
function leakyLabelComments(text) {
  const { deck, ctx } = scan(text);
  const { lines } = deck;
  const out = [];
  for (let k = 0; k < lines.length; k++) {
    const c = ctx[k];
    if (!c || c.slide < 0 || c.fence || c.fenceOpen || c.comment || c.style || c.svg || c.html) continue;
    const line = lines[k];
    if (indentCols(line) >= 4) continue; // 字下げ4桁以上はコードか段落の続き
    const m = line.match(/^\s*<!--([\s\S]*?)-->\s*$/);
    if (!m || /<!--/.test(m[1])) continue;
    const inner = m[1].trim();
    if (!inner) continue;
    if (/^#(?:end)?region\b/.test(inner)) { out.push({ line: k, text: inner }); continue; }
    if (isDirectiveComment(inner)) continue;
    if (Array.from(inner).length > 20 || PUNCT.test(inner)) continue;
    out.push({ line: k, text: inner });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 自動折りたたみ：スライドが切り替わったときに畳む行・開く行
// ---------------------------------------------------------------------------

/** kinds の指定に、この範囲の種類が入っているか。'style' は frontmatter の style ブロックも指す */
function kindMatches(kind, kinds) {
  if (kind === 'slide') return false;
  if (kinds.includes(kind)) return true;
  return kind === 'frontmatter-style' && kinds.includes('style');
}

/**
 * editor.fold / editor.unfold の selectionLines に渡す行（範囲の開始行）を返す。
 *   初回（prevSlide == null）：cur 以外の全スライドと、kinds に当たる全範囲を畳む。
 *   切り替え：前のスライドを畳み、今のスライドを開く。今のスライドの中の kinds は畳む
 *             （levels:1 で開くので、畳んであったものは畳んだまま。新しく増えた分だけがここで畳まれる）。
 * 範囲を持たないスライド（1行だけ）の行は返さない。その行で fold を呼ぶと、VS Code は
 * その行を含む別の範囲（Markdown 標準の見出し範囲など）を畳んでしまうため。
 */
function nextFoldActions({ ranges, prevSlide, curSlide, kinds }) {
  const ks = Array.isArray(kinds) ? kinds : [];
  const slideStart = new Map();
  for (const r of ranges) if (r.kind === 'slide') slideStart.set(r.slide, r.start);
  const fold = [], unfold = [];
  if (prevSlide === null || prevSlide === undefined) {
    for (const r of ranges) {
      if (r.kind === 'slide') { if (r.slide !== curSlide) fold.push(r.start); }
      else if (kindMatches(r.kind, ks)) fold.push(r.start);
    }
  } else if (prevSlide !== curSlide) {
    if (slideStart.has(prevSlide)) fold.push(slideStart.get(prevSlide));
    for (const r of ranges) if (r.slide === curSlide && kindMatches(r.kind, ks)) fold.push(r.start);
  }
  if (slideStart.has(curSlide) && prevSlide !== curSlide) unfold.push(slideStart.get(curSlide));
  return { fold, unfold };
}

/**
 * 畳んだ表示の模擬：foldedStarts（畳んだ範囲の開始行）を畳んだときに見える行番号を返す。
 * 検証と報告用（1デックが何行に縮むか）。
 */
function visibleLines(lineCount, ranges, foldedStarts) {
  const hidden = new Uint8Array(lineCount);
  const set = new Set(foldedStarts);
  for (const r of ranges) if (set.has(r.start)) for (let k = r.start + 1; k <= r.end && k < lineCount; k++) hidden[k] = 1;
  const out = [];
  for (let k = 0; k < lineCount; k++) if (!hidden[k]) out.push(k);
  return out;
}

module.exports = {
  foldingRanges, slideLabels, panelLabels, planWritePanelLabels, leakyLabelComments,
  nextFoldActions, slideAtLine, slideHeads, slideIndexAt, visibleLines, isDirectiveComment, PANEL_DICT,
};
