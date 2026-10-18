// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// Alt で箱を動かす・大きさを変える（DESIGN.md 9.2 / 9.3）の原稿側：書き戻す編集の計算（vscode 非依存・純粋関数）。
//
// 方針は source-map.cjs と同じ：「誤った場所へ書く」のが最悪で、「書かない」のは許容。
//   - HTML のタグは data-hline（そのタグが書かれた行）と、同じ行の開始タグの中で何番目か（nth）とタグ名で決める。
//     数え方は source-map.cjs の injectHlines と同じトークナイザ（eachOpenTag）。
//     html_block の途中の行からは数え始めない（手前のコメントや <style> の中かもしれない）。スライドの先頭からと、
//     直前の空行からの 2 通りで数え、同じタグに行き着いたときだけ書く。
//   - 書くのは style 属性の translate / width / height と、トリミングの clip-path / margin-*（辺ごと）だけ。
//     ほかの宣言は字句も順序も保つ。
//   - Markdown の画像は alt の Marp キーワード（w: / h:）だけ。位置は書けない。
//     トリミングは alt では書けないので、段落ごと <p><img …></p> に書き換えてから書く（1 回の編集）。
//   - 例外は投げない。少しでも怪しければ { ok:false, reason, line }。
'use strict';

const { eachOpenTag, lineOffsets } = require('./source-map.cjs');

const SIDES = ['top', 'right', 'bottom', 'left'];
const CROP_PROPS = ['clip-path', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
const PROPS = ['translate', 'width', 'height'].concat(CROP_PROPS);

function fail(reason, line) {
  return { ok: false, edits: [], line: Number.isFinite(line) ? line : 0, reason };
}

function normRange(slideRange, lineCount) {
  let s, e;
  if (Array.isArray(slideRange)) [s, e] = slideRange;
  else if (slideRange && typeof slideRange === 'object') {
    s = slideRange.startLine !== undefined ? slideRange.startLine : slideRange.start;
    e = slideRange.endLine !== undefined ? slideRange.endLine : slideRange.end;
  }
  s = Math.max(0, Math.min(Number.isFinite(s) ? s : 0, lineCount));
  e = Math.max(s, Math.min(Number.isFinite(e) ? e : lineCount, lineCount));
  return [s, e];
}

/** 整数 px にならす。-0 は 0。数でなければ NaN */
function px(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return NaN;
  const r = Math.round(v);
  return r === 0 ? 0 : r;
}

/**
 * style 引数を検算して { translate, width, height, 'clip-path', 'margin-top', … } にならす。
 * 値は 文字列（書く値）| null（消す）| undefined（触らない）。
 * 0,0 の translate と 全部 0 の clipPath は「消す」。おかしな値は null を返す（呼び出し側で ok:false）。
 *   clipPath = [上, 右, 下, 左]（切る量。0 以上）→ clip-path: inset(…)
 *   margin   = { top, right, bottom, left }（各 数 | null | 無し）→ margin-top など辺ごとの宣言。
 *              shorthand にしないのは、元の margin（テーマの 0 auto や原稿の margin 宣言）を残し、外せば元へ戻すため。
 */
function normStyle(style) {
  if (!style || typeof style !== 'object') return null;
  const out = {};
  for (const p of PROPS) out[p] = undefined;
  if (style.translate === null) out.translate = null;
  else if (style.translate !== undefined) {
    if (!Array.isArray(style.translate) || style.translate.length !== 2) return null;
    const x = px(style.translate[0]), y = px(style.translate[1]);
    if (Number.isNaN(x) || Number.isNaN(y)) return null;
    out.translate = (x === 0 && y === 0) ? null : x + 'px ' + y + 'px';
  }
  for (const k of ['width', 'height']) {
    if (style[k] === null) out[k] = null;
    else if (style[k] !== undefined) {
      const v = px(style[k]);
      if (Number.isNaN(v) || v < 0) return null;
      out[k] = v + 'px';
    }
  }
  if (style.clipPath === null) out['clip-path'] = null;
  else if (style.clipPath !== undefined) {
    if (!Array.isArray(style.clipPath) || style.clipPath.length !== 4) return null;
    const v = style.clipPath.map(px);
    if (v.some(x => Number.isNaN(x) || x < 0)) return null;
    out['clip-path'] = v.every(x => x === 0) ? null : 'inset(' + v.map(x => (x ? x + 'px' : '0')).join(' ') + ')';
  }
  if (style.margin === null) for (const s of SIDES) out['margin-' + s] = null;
  else if (style.margin !== undefined) {
    if (typeof style.margin !== 'object' || Array.isArray(style.margin)) return null;
    for (const s of SIDES) {
      const m = style.margin[s];
      if (m === null) out['margin-' + s] = null;
      else if (m !== undefined) {
        const v = px(m);
        if (Number.isNaN(v)) return null;
        out['margin-' + s] = v + 'px';
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. 開始タグの特定
// ---------------------------------------------------------------------------

/** from から数えて、line 行目（0-based）に '<' がある開始タグの nth 番目。無ければ null */
function nthOpenTagOnLine(text, lineOff, from, line, nth) {
  const lo = lineOff[line], hi = lineOff[line + 1];
  let k = 0, hit = null;
  eachOpenTag(text, from, (tag, lt) => {
    if (lt >= hi) return false;
    if (lt >= lo) {
      if (k === nth) { hit = { tag, lt }; return false; }
      k++;
    }
    return true;
  });
  return hit;
}

/** line より前（スライドの中）の最後の空行の次の行。無ければスライドの先頭行 */
function blockStartLine(text, lineOff, s, line) {
  for (let l = line - 1; l >= s; l--) {
    if (/^[ \t\r\n]*$/.test(text.slice(lineOff[l], lineOff[l + 1]))) return l + 1;
  }
  return s;
}

/**
 * 開始タグ（text[lt] === '<'、tag.end は '>' の次）の属性を HTML の規則で読む。
 *   { attrs:[{ name, start, end, valStart, valEnd, quote }], insertAt }  insertAt＝最後の属性（無ければタグ名）の直後
 * 引用符なしの値は空白か > まで（src=x/ の / は値の一部。自己終了の / と取り違えない）。読み切れなければ null。
 */
function parseAttrs(text, tag) {
  const stop = tag.end - 1; // '>' の位置
  let j = tag.nameEnd;
  const attrs = [];
  let insertAt = tag.nameEnd;
  while (j < stop) {
    const c = text[j];
    if (/\s/.test(c) || c === '/') { j++; continue; }
    const start = j;
    j++; // 属性名の 1 文字目は = でもよい（HTML の規則）
    while (j < stop && !/[\s/>=]/.test(text[j])) j++;
    const name = text.slice(start, j);
    let k = j;
    while (k < stop && /\s/.test(text[k])) k++;
    let valStart = -1, valEnd = -1, quote = '';
    if (k < stop && text[k] === '=') {
      k++;
      while (k < stop && /\s/.test(text[k])) k++;
      if (k < stop && (text[k] === '"' || text[k] === "'")) {
        quote = text[k];
        const q = text.indexOf(quote, k + 1);
        if (q === -1 || q >= stop) return null;
        valStart = k + 1; valEnd = q; j = q + 1;
      } else {
        valStart = k;
        while (k < stop && !/\s/.test(text[k])) k++;
        valEnd = k; j = k;
      }
    }
    attrs.push({ name, start, end: j, valStart, valEnd, quote });
    insertAt = j;
  }
  return { attrs, insertAt };
}

// ---------------------------------------------------------------------------
// 2. style 属性の値のマージ
// ---------------------------------------------------------------------------

/** 宣言の区切りの ; で割る。コメント・引用符・( ) の中・実体参照（&quot; など）の ; では割らない */
function splitDecls(v) {
  const segs = [];
  let depth = 0, from = 0, i = 0;
  const n = v.length;
  while (i < n) {
    const c = v[i];
    if (c === '/' && v[i + 1] === '*') { const e = v.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      let q = i + 1;
      while (q < n && v[q] !== c) q += v[q] === '\\' ? 2 : 1;
      i = Math.min(n, q + 1); continue;
    }
    if (c === '\\') { i += 2; continue; }
    if (c === '&') {
      const m = /^&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.exec(v.slice(i, i + 40));
      if (m) {
        i += m[0].length;
        // &quot; / &#39; などは CSS から見れば引用符。同じ書き方の閉じまで飛ばす
        if (/^&(?:quot|apos|#0*34|#0*39|#[xX]0*2[27]);$/.test(m[0])) {
          const close = v.indexOf(m[0], i);
          i = close === -1 ? n : close + m[0].length;
        }
        continue;
      }
    }
    if (c === '(') depth++;
    else if (c === ')') { if (depth > 0) depth--; }
    else if (c === ';' && depth === 0) { segs.push(v.slice(from, i)); from = i + 1; }
    i++;
  }
  segs.push(v.slice(from));
  return segs;
}

/** 宣言 1 つ分の字句からプロパティ名（小文字）。宣言でなければ '' */
function propOf(seg) {
  const m = /^\s*([-A-Za-z_][-\w]*)\s*:/.exec(seg.replace(/\/\*[\s\S]*?\*\//g, ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * style 属性の値 v に st（normStyle の結果）を当てた新しい値を返す。中身が無くなったら ''（＝属性ごと消す）。
 * 既にある宣言は最初の 1 つを差し替え、重複は消す（2 回当てても二重にならない）。足すときは末尾（末尾の ; の前）。
 */
function mergeStyleValue(v, st, important) {
  const segs = splitDecls(v);
  const props = segs.map(propOf);
  const declared = segs.filter((_, i) => props[i]);
  // 書き方をそろえる：既存の宣言がどれも「prop:値」と詰めて書かれていれば詰める
  const compact = declared.length > 0 && declared.every(d => /:\S/.test(d.replace(/\/\*[\s\S]*?\*\//g, '')));
  const bang = important ? ' !important' : '';
  const decl = (p, val) => p + (compact ? ':' : ': ') + val + bang;
  const added = [];
  for (const p of PROPS) {
    const val = st[p];
    if (val === undefined) continue;
    let first = -1;
    for (let i = 0; i < segs.length; i++) {
      if (props[i] !== p) continue;
      if (val !== null && first === -1) { first = i; continue; }
      segs.splice(i, 1); props.splice(i, 1); i--;
    }
    if (val === null) continue;
    if (first !== -1) segs[first] = /^\s*/.exec(segs[first])[0] + decl(p, val);
    else added.push(decl(p, val));
  }
  if (added.length) {
    // 足す宣言の前の空白：最後の宣言のもの（改行で並べた style も崩さない）。宣言が 1 つ以下なら書き方から決める
    let lastDecl = -1;
    for (let i = 0; i < segs.length; i++) if (props[i]) lastDecl = i;
    let lead = (compact && !/;\s/.test(v)) ? '' : ' ';
    if (lastDecl > 0) lead = /^\s*/.exec(segs[lastDecl])[0];
    const hasContent = segs.some(sg => /\S/.test(sg));
    if (!hasContent) { segs.length = 0; props.length = 0; segs.push(added.join(';' + lead)); }
    else {
      const tailEmpty = !/\S/.test(segs[segs.length - 1]);
      const at = tailEmpty ? segs.length - 1 : segs.length;
      segs.splice(at, 0, ...added.map(a => lead + a));
    }
  }
  if (!segs.some(sg => /\S/.test(sg))) return '';
  return segs.join(';');
}

function planHtml(text, lineOff, s, e, target, st, important) {
  const line = target.hline;
  if (!Number.isInteger(line) || line < 0) return fail('bad-target', 0);
  if (line < s || line >= e) return fail('out-of-slide', line);
  const nth = Number.isInteger(target.nth) && target.nth >= 0 ? target.nth : -1;
  if (nth < 0 || typeof target.tag !== 'string' || !target.tag) return fail('bad-target', line);

  const a = nthOpenTagOnLine(text, lineOff, lineOff[s], line, nth);
  if (!a) return fail('tag-not-found', line);
  const b = nthOpenTagOnLine(text, lineOff, lineOff[blockStartLine(text, lineOff, s, line)], line, nth);
  if (!b || b.lt !== a.lt || b.tag.end !== a.tag.end) return fail('ambiguous', line);
  const { tag, lt } = a;
  if (tag.name.toLowerCase() !== target.tag.toLowerCase()) return fail('tag-mismatch', line);
  if (tag.end > lineOff[e]) return fail('out-of-slide', line);

  const parsed = parseAttrs(text, tag);
  if (!parsed) return fail('tag-parse', line);
  const attr = parsed.attrs.find(x => x.name.toLowerCase() === 'style'); // 同名が複数あればブラウザは最初の 1 つを使う

  if (!attr) {
    const val = mergeStyleValue('', st, important);
    if (!val) return { ok: true, edits: [], line };
    return { ok: true, edits: [{ start: parsed.insertAt, end: parsed.insertAt, text: ' style="' + val + '"' }], line };
  }
  const old = attr.valStart === -1 ? '' : text.slice(attr.valStart, attr.valEnd);
  const val = mergeStyleValue(old, st, important);
  if (val === old) return { ok: true, edits: [], line };
  if (!val) {
    // 属性ごと消す（前の空白も 1 つ）。属性がその行の先頭なら、前の行末の改行と字下げごと消す
    // （空白だけの行を残すと、Markdown の空行になって html_block がそこで切れる）
    let start = attr.start;
    let w = start;
    while (w > tag.nameEnd && (text[w - 1] === ' ' || text[w - 1] === '\t')) w--;
    if (w > tag.nameEnd && text[w - 1] === '\n') {
      start = w - 1;
      if (start > tag.nameEnd && text[start - 1] === '\r') start--;
    } else if (start > tag.nameEnd && /\s/.test(text[start - 1])) start--;
    return { ok: true, edits: [{ start, end: attr.end, text: '' }], line };
  }
  if (attr.quote) {
    if (val.includes(attr.quote) && !old.includes(attr.quote)) return fail('quote', line); // 起きないはず（書く値に引用符は無い）
    return { ok: true, edits: [{ start: attr.valStart, end: attr.valEnd, text: val }], line };
  }
  // 引用符なし（style=width:10px）や値なし（style）は、引用符つきで書き直す
  if (val.includes('"')) return fail('quote', line);
  return { ok: true, edits: [{ start: attr.start, end: attr.end, text: text.slice(attr.start, attr.start + attr.name.length) + '="' + val + '"' }], line };
}

// ---------------------------------------------------------------------------
// 3. Markdown の画像（alt の Marp キーワード）
// ---------------------------------------------------------------------------

const KW_VALUE = '(?:(?:\\d*\\.)?\\d+(?:%|ch|cm|em|ex|in|mm|pc|pt|px)?|auto)'; // Marpit の w: / h: と同じ
const KW = { width: new RegExp('^(w|width):' + KW_VALUE + '$'), height: new RegExp('^(h|height):' + KW_VALUE + '$') };

/** 直前のバックスラッシュが奇数個なら、その文字はエスケープされている */
function escaped(s, i) {
  let k = 0;
  while (i - 1 - k >= 0 && s[i - 1 - k] === '\\') k++;
  return k % 2 === 1;
}

/** s[open] === '(' からインラインのリンク先を読む。{ src, end }（end は ')' の次）。読めなければ null */
function readDest(s, open, limit) {
  let i = open + 1;
  while (i < limit && /\s/.test(s[i])) i++;
  let src;
  if (s[i] === '<') {
    const g = s.indexOf('>', i + 1);
    if (g === -1 || g >= limit || s.slice(i, g).includes('\n')) return null;
    src = s.slice(i + 1, g); i = g + 1;
  } else {
    const from = i;
    let depth = 0;
    while (i < limit) {
      const c = s[i];
      if (c === '\\') { i += 2; continue; }
      if (/\s/.test(c)) break;
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
      i++;
    }
    src = s.slice(from, i);
  }
  while (i < limit && /\s/.test(s[i])) i++;
  let title = null;
  if (s[i] === '"' || s[i] === "'" || s[i] === '(') {
    const close = s[i] === '(' ? ')' : s[i];
    let q = i + 1;
    while (q < limit && (s[q] !== close || escaped(s, q))) q++;
    if (q >= limit) return null;
    title = s.slice(i + 1, q);
    i = q + 1;
    while (i < limit && /\s/.test(s[i])) i++;
  }
  if (i >= limit || s[i] !== ')') return null;
  return { src, title, end: i + 1 };
}

/** 段落 [from, to) の中の Markdown 画像を前から順に。{ start, end, altStart, altEnd, src|null（参照形式）, title } */
function scanImages(text, from, to, hasRefDef) {
  const out = [];
  let i = from;
  while (i < to) {
    const c = text[i];
    if (c === '`' && !escaped(text, i)) { // コードスパンの中の ![…](…) は画像ではない
      let k = i; while (k < to && text[k] === '`') k++;
      const run = text.slice(i, k);
      let p = k, close = -1;
      while (p < to) {
        const q = text.indexOf(run, p);
        if (q === -1 || q >= to) break;
        let r = q; while (r < to && text[r] === '`') r++;
        if (r - q === run.length && text[q - 1] !== '`') { close = r; break; }
        p = r;
      }
      i = close === -1 ? k : close; continue;
    }
    if (c === '!' && text[i + 1] === '[' && !escaped(text, i)) {
      let depth = 0, j = i + 2, altEnd = -1;
      while (j < to) {
        const d = text[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') depth++;
        else if (d === ']') { if (depth === 0) { altEnd = j; break; } depth--; }
        j++;
      }
      if (altEnd === -1) { i += 2; continue; }
      const next = text[altEnd + 1];
      if (next === '(') {
        const dest = readDest(text, altEnd + 1, to);
        if (dest) { out.push({ start: i, end: dest.end, altStart: i + 2, altEnd, src: dest.src, title: dest.title }); i = dest.end; continue; }
      }
      if (next === '[') {
        const r = text.indexOf(']', altEnd + 2);
        if (r !== -1 && r < to) { out.push({ altStart: i + 2, altEnd, src: null }); i = r + 1; continue; }
      }
      if (hasRefDef(text.slice(i + 2, altEnd))) { out.push({ altStart: i + 2, altEnd, src: null }); i = altEnd + 1; continue; }
      i += 2; continue;
    }
    i++;
  }
  return out;
}

function normSrc(v) {
  let s = String(v == null ? '' : v).trim();
  try { s = decodeURI(s); } catch (_) { /* そのまま比べる */ }
  return s.replace(/\\(?=[!-/:-@[-`{-~])/g, '').replace(/^\.\//, '');
}

/** プレビューの src は Webview 用に書き換わっていることがあるので、末尾一致も認める（パスの区切りで） */
function srcMatches(a, b) {
  const x = normSrc(a), y = normSrc(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [long, short] = x.length >= y.length ? [x, y] : [y, x];
  return long.endsWith('/' + short.replace(/^\/+/, ''));
}

/** alt の中のキーワード（w: width: など）を差し替える・足す・消す。ほかの語は保つ */
function editAlt(alt, re, short, val) {
  const toks = [];
  const tokRe = /\S+/g;
  let m;
  while ((m = tokRe.exec(alt))) if (re.test(m[0])) toks.push({ start: m.index, end: m.index + m[0].length, key: re.exec(m[0])[1] });
  let out = alt;
  if (val === null) {
    for (const t of toks.reverse()) {
      let a = t.start, b = t.end;
      const ws = /\s+$/.exec(out.slice(0, a));
      if (ws) a -= ws[0].length;                       // 前の空白ごと消す（足したときの逆）
      else { const w2 = /^\s+/.exec(out.slice(b)); if (w2) b += w2[0].length; }
      out = out.slice(0, a) + out.slice(b);
    }
    return out;
  }
  if (toks.length) {
    for (const t of toks.reverse()) out = out.slice(0, t.start) + t.key + ':' + val + out.slice(t.end);
    return out;
  }
  return out + (out === '' || /\s$/.test(out) ? '' : ' ') + short + ':' + val;
}

function planMdImg(text, lineOff, s, e, target, st, rawStyle) {
  const line = target.line;
  if (!Number.isInteger(line) || line < 0) return fail('bad-target', 0);
  if (line < s || line >= e) return fail('out-of-slide', line);
  if (rawStyle.translate !== undefined && rawStyle.translate !== null) return fail('mdimg-move', line);
  const nth = Number.isInteger(target.nth) && target.nth >= 0 ? target.nth : -1;
  if (nth < 0) return fail('bad-target', line);

  // 段落の終わり＝次の空行（スライドの中）
  let endLine = line + 1;
  while (endLine < e && /\S/.test(text.slice(lineOff[endLine], lineOff[endLine + 1]))) endLine++;
  const hasRefDef = (label) => {
    const l = label.trim();
    if (!l) return false;
    const esc = l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp('^ {0,3}\\[' + esc + '\\]:', 'im').test(text);
  };
  // Marp の背景画像（alt に bg）は段落の <img> にならないので数えない
  const imgs = scanImages(text, lineOff[line], lineOff[endLine], hasRefDef)
    .filter(im => !/(?:^|\s)bg(?:\s|$)/.test(text.slice(im.altStart, im.altEnd)));
  const im = imgs[nth];
  if (!im) return fail('img-not-found', line);
  if (im.src === null) return fail('mdimg-ref', line);
  if (!srcMatches(im.src, target.src)) return fail('src-mismatch', line);

  // トリミングは alt に書けない：<img> に書き換えてから書く
  if (CROP_PROPS.some(p => st[p] !== undefined && st[p] !== null)) return mdImgToHtml(text, lineOff, line, endLine, im, st, !!rawStyle.important);

  const alt = text.slice(im.altStart, im.altEnd);
  let now = alt;
  if (st.width !== undefined) now = editAlt(now, KW.width, 'w', st.width);
  if (st.height !== undefined) now = editAlt(now, KW.height, 'h', st.height);
  const imgLine = (() => { let l = line; while (l + 1 < lineOff.length - 1 && lineOff[l + 1] <= im.altStart) l++; return l; })();
  if (now === alt) return { ok: true, edits: [], line: imgLine };
  return { ok: true, edits: [{ start: im.altStart, end: im.altEnd, text: now }], line: imgLine };
}

// ---------------------------------------------------------------------------
// 4. 入口
// ---------------------------------------------------------------------------

/**
 * planStyleEdit(sourceText, slideRange, target, style) → { ok, edits:[{start,end,text}], line, reason? }
 *   target = { kind:'html', hline, nth, tag } | { kind:'mdimg', line, nth, src }
 *   style  = { translate:[x,y]|null|undefined, width:number|null|undefined, height:…, important?:boolean }
 * オフセットは UTF-16（JS の文字列の添字）。変える所が無ければ ok:true で edits は空。
 */
function planStyleEdit(sourceText, slideRange, target, style) {
  let line = 0;
  try {
    if (typeof sourceText !== 'string' || !target || typeof target !== 'object') return fail('bad-target', 0);
    line = Number.isInteger(target.hline) ? target.hline : Number.isInteger(target.line) ? target.line : 0;
    const st = normStyle(style);
    if (!st) return fail('bad-style', line);
    const lineOff = lineOffsets(sourceText);
    const [s, e] = normRange(slideRange, lineOff.length - 1);
    if (target.kind === 'html') return planHtml(sourceText, lineOff, s, e, target, st, !!style.important);
    if (target.kind === 'mdimg') return planMdImg(sourceText, lineOff, s, e, target, st, style);
    return fail('bad-target', line);
  } catch (err) {
    return fail('error:' + String(err && err.message || err).split('\n')[0], line);
  }
}

module.exports = { planStyleEdit, mergeStyleValue, splitDecls };
