// プレビューのテキストノード → 原稿（.md）のオフセットの特定と、書き戻し編集の計算（vscode 非依存・純粋関数）。
// ブラウザ側の対は media/textnodes.js（ssCollectTextNodes）。取り決めは DESIGN.md 2.1。
//
// 方針：「誤った場所へ書く」のが最悪で、「書かない」のは許容。
//   - 位置は「DOM 順＝原稿順」を前提にした順序つきカーソル探索で決める。同じ語が何度出ても、前から順に消費する。
//   - タグ・コメント・<style>・リンク先・画像・数式など「テキストノードにならない部分」は同じ長さの \0 で潰してから探す
//     （属性値や発表者ノートの中の同じ文に誤ヒットしない）。
//   - 原稿と表示が食い違う書き方（実体参照 &amp; / バックスラッシュ \* / CRLF）は、1文字ずつ対応を取る照合で吸収する。
//   - 少しでも怪しければ { ok:false, reason, line } を返し、呼び出し側は原稿の該当行へ案内する。
'use strict';

// ---------------------------------------------------------------------------
// 1. 位置情報の付与（プレビュー専用。marp-cli の出力には関係しない）
// ---------------------------------------------------------------------------

const RAW_TEXT_TAGS = new Set(['style', 'script', 'textarea', 'title']);

/**
 * s[i] === '<' から始まるタグ（開始・終了どちらも）を読み、情報を返す。タグでなければ null。
 *   { end, name, nameEnd, closing, selfClosing }  end は '>' の次（exclusive）
 * 引用符の中の > < は無視する（属性値に比較演算子や矢印を書いたタグを壊さない）。
 * 空行をまたぐタグは認めない（markdown-it の html_block もインライン HTML も空行で切れるため、
 * 閉じていない < を見つけたときに後ろの本文まで巻き込んで潰さないように）。
 */
function scanTag(s, i) {
  const n = s.length;
  let j = i + 1;
  let closing = false;
  if (s[j] === '/') { closing = true; j++; }
  if (j >= n || !/[A-Za-z]/.test(s[j])) return null;
  const nameStart = j;
  while (j < n && /[A-Za-z0-9-]/.test(s[j])) j++;
  const nameEnd = j;
  // タグ名の直後は 空白 / '/' / '>' のどれか。<https://…>（オートリンク）や <a@b.c> はここで外れる
  if (j >= n || !/[\s/>]/.test(s[j])) return null;
  let lastNonSpace = '';
  while (j < n) {
    const c = s[j];
    if (c === '>') {
      return { end: j + 1, name: s.slice(nameStart, nameEnd), nameEnd, closing, selfClosing: lastNonSpace === '/' };
    }
    if (c === '"' || c === "'") {
      const q = s.indexOf(c, j + 1);
      if (q === -1) return null;
      if (/\n[ \t]*\r?\n/.test(s.slice(j, q))) return null;
      j = q + 1; lastNonSpace = c; continue;
    }
    if (c === '<') return null; // 引用符の外の < … タグではなく本文の不等号とみなす
    if (c === '\n') {
      // 空行（改行→空白だけ→改行）でタグは終わらない
      let k = j + 1;
      while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\r')) k++;
      if (k < n && s[k] === '\n') return null;
    }
    if (!/\s/.test(c)) lastNonSpace = c;
    j++;
  }
  return null;
}

/** <style> … </style> のような「中身が生テキスト」の要素の終わり（閉じタグの '>' の次）を返す。無ければ s.length */
function rawTextEnd(s, from, name) {
  const re = new RegExp('</' + name + '(?=[\\s/>])', 'ig');
  re.lastIndex = from;
  const m = re.exec(s);
  if (!m) return s.length;
  const gt = s.indexOf('>', m.index);
  return gt === -1 ? s.length : gt + 1;
}

/**
 * s の from 以降にある開始タグを前から順に visit(tag, lt) へ渡す（tag は scanTag の戻り値、lt は '<' の位置）。
 * injectHlines と lib/style-edit.cjs（Alt で箱を動かす書き戻し）が、同じ数え方をするための共通のトークナイザ。
 * コメント・<!DOCTYPE>・CDATA・<style>/<script> などの生テキスト要素の中・引用符の中の < は数えない。
 * 生テキスト要素そのものの開始タグ（<style> など）も渡さない（data-hline が付かない＝プレビューで選べない）。
 * visit が false を返したらそこで止める。
 */
function eachOpenTag(s, from, visit) {
  const n = s.length;
  let i = from > 0 ? from : 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt === -1) break;
    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt + 4);
      i = e === -1 ? n : e + 3; continue;
    }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') { // <!DOCTYPE …> <![CDATA[…]]> <?xml …?>
      const e = s.startsWith('<![CDATA[', lt) ? s.indexOf(']]>', lt) : s.indexOf('>', lt);
      i = e === -1 ? n : e + (s.startsWith('<![CDATA[', lt) ? 3 : 1); continue;
    }
    const tag = scanTag(s, lt);
    if (!tag) { i = lt + 1; continue; }
    const lower = tag.name.toLowerCase();
    if (!tag.closing) {
      if (RAW_TEXT_TAGS.has(lower)) {
        // style / script には付けない（付けても害は無いが、中身をタグとして読まないことが大事）
        i = tag.selfClosing ? tag.end : rawTextEnd(s, tag.end, lower); continue;
      }
      if (visit(tag, lt) === false) return;
    }
    i = tag.end;
  }
}

/**
 * html_block の中身のすべての開始タグに data-hline / data-hline-end を足す。
 * 正規表現の一括置換ではなく小さなトークナイザ（eachOpenTag）で読む：コメント・<style>/<script> の中・引用符の中は触らない。
 * 挿入位置は「タグ名の直後」なので、自己終了タグ・改行をまたぐ開始タグ・大文字タグ・SVG でも壊れない。
 *
 * data-hline は「そのタグが書かれている行」、data-hline-end は html_block の終わりの行（exclusive）。
 * near は探索窓の下限と上限にだけ使うので、下限はタグ自身の行まで詰めたほうが強い
 * （前のノードが見つからずカーソルが進まなかったとき、ブロック冒頭の同じ語へ誤ヒットしない）。
 */
function injectHlines(content, startLine, endLine) {
  const s = String(content);
  let out = '';
  let last = 0;   // まだ out に写していない先頭
  let line = startLine;
  let counted = 0; // ここまでの改行を数え終えた位置
  const lineAt = (pos) => {
    for (let k = counted; k < pos; k++) if (s.charCodeAt(k) === 10) line++;
    counted = pos;
    return line;
  };
  eachOpenTag(s, 0, (tag, lt) => {
    out += s.slice(last, tag.nameEnd)
      + ' data-hline="' + lineAt(lt) + '" data-hline-end="' + endLine + '"';
    last = tag.nameEnd;
  });
  return out + s.slice(last);
}

/**
 * marp（Marp インスタンス）の markdown-it に、位置情報を付ける core ルールを足す。
 *   - map を持つ開始トークン … data-line / data-line-end
 *   - fence / code_block … 同上（nesting 0 だが attrs が <code>/<pre> に出る。コードの中は探索窓を絞りたい）
 *   - html_block … 中の全開始タグに data-hline / data-hline-end
 * 同じ marp に二度呼んでも二重には足さない。
 */
function attachLineInfo(marp) {
  const md = marp && marp.markdown;
  if (!md || md.__ssLineInfo) return marp;
  md.__ssLineInfo = true;
  md.core.ruler.push('ss_line_info', (state) => {
    for (const t of state.tokens) {
      if (!t.map) continue;
      if (t.nesting === 1 || t.type === 'fence' || t.type === 'code_block') {
        t.attrSet('data-line', String(t.map[0]));
        t.attrSet('data-line-end', String(t.map[1]));
      } else if (t.type === 'html_block' && typeof t.content === 'string') {
        t.content = injectHlines(t.content, t.map[0], t.map[1]);
      }
    }
  });
  return marp;
}

// ---------------------------------------------------------------------------
// 2. マスク済み原稿（スライドの範囲だけ作る）
// ---------------------------------------------------------------------------

/** 各行の先頭オフセット。lineOff[i] は i 行目(0-based)の先頭、lineOff[行数] は text.length */
function lineOffsets(text) {
  const off = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) off.push(i + 1);
  off.push(text.length);
  return off;
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

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;

/** 次の空行（段落の終わり）の位置。無ければ s.length。コードスパンや数式が段落をまたがないようにするため */
function paragraphEndOf(s, from) {
  const re = /\n[ \t]*\r?\n/g;
  re.lastIndex = from;
  const m = re.exec(s);
  return m ? m.index : s.length;
}

/** s[open] === '(' から、対応する ')' の次を返す。同じ行で閉じなければ -1（Markdown のリンク先） */
function linkDestEnd(s, open) {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    const c = s[j];
    if (c === '\n') return -1;
    if (c === '\\') { j++; continue; }
    if (c === '<' && j === open + 1) { // <…> 形式のリンク先
      const gt = s.indexOf('>', j);
      if (gt !== -1 && s.slice(j, gt).indexOf('\n') === -1) { j = gt; continue; }
    }
    if ((c === '"' || c === "'") && /\s/.test(s[j - 1])) { // title
      const q = s.indexOf(c, j + 1);
      if (q !== -1 && s.slice(j, q).indexOf('\n') === -1) { j = q; continue; }
    }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return j + 1; }
  }
  return -1;
}

/**
 * 原稿の [from, to) をマスクする。戻り値 { masked, code }。
 *   masked … 同じ長さの文字列。テキストノードにならない部分を \0 にしたもの
 *   code   … コードの範囲 [{ s, e, fence, lang }]（from からの相対）。中は Markdown もタグも解釈されないので潰さない。
 *            lang は「言語名つきのフェンス」（highlight.js が字句ごとに <span> へ割るので、書き戻しは断る）
 *   auto   … オートリンク <https://…> の範囲 [{ s, e }]。表示される文字がそのままリンク先でもあるので、書き戻しは断る
 * 潰すもの：HTMLコメント／タグ／<style>・<script> の中身／コードフェンスの ``` 行（言語名）／
 *           リンクの (url "title")／画像 ![alt](src) 全体（alt は属性でテキストノードにならない）／数式 $…$ $$…$$
 * スライドの先頭はコメントやフェンスの外（slide-split の分割がそう保証する）なので、状態は持ち越さない。
 */
function maskRegion(text, from, to) {
  const s = text.slice(from, to);
  const n = s.length;
  const holes = []; // [start, end) を \0 にする
  const code = [];
  const auto = [];
  // 段落の終わりは同じ段落の中なら同じ。$ や ` が大量に並ぶ原稿で毎回探し直すと O(n²) になるので覚えておく
  let paraFrom = -1, paraTo = -1;
  const paragraphEnd = (str, from) => {
    if (from >= paraFrom && from <= paraTo) return paraTo;
    paraFrom = from; paraTo = paragraphEndOf(str, from);
    return paraTo;
  };
  let i = 0;
  while (i < n) {
    // --- 行頭：コードフェンス ---
    if (i === 0 || s[i - 1] === '\n') {
      let eol = s.indexOf('\n', i); if (eol === -1) eol = n;
      const m = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(s.slice(i, eol).replace(/\r$/, ''));
      if (m && !(m[1][0] === '`' && m[2].indexOf('`') !== -1)) {
        const ch = m[1][0], len = m[1].length;
        const closeRe = new RegExp('^[ \\t]*' + (ch === '`' ? '`' : '~') + '{' + len + ',}[ \\t]*\\r?$');
        let p = Math.min(eol + 1, n), bodyStart = p, closeStart = n, closeEnd = n;
        while (p < n) {
          let e2 = s.indexOf('\n', p); if (e2 === -1) e2 = n;
          if (closeRe.test(s.slice(p, e2))) { closeStart = p; closeEnd = e2; break; }
          p = e2 + 1;
        }
        holes.push([i, eol]);
        if (bodyStart < closeStart) code.push({ s: bodyStart, e: closeStart, fence: true, lang: m[2].trim() !== '' });
        if (closeStart < n) holes.push([closeStart, closeEnd]);
        i = Math.min(closeEnd + 1, n);
        if (closeStart >= n) i = n;
        continue;
      }
    }
    const c = s[i];
    if (c === '\\' && i + 1 < n && ASCII_PUNCT.test(s[i + 1])) { i += 2; continue; } // \< \` \$ は記号として始まらない
    if (c === '`') {
      let r = i; while (r < n && s[r] === '`') r++;
      const run = r - i;
      const lim = paragraphEnd(s, r);
      let q = r, close = -1;
      while (q < lim) {
        const b = s.indexOf('`', q);
        if (b === -1 || b >= lim) break;
        let b2 = b; while (b2 < n && s[b2] === '`') b2++;
        if (b2 - b === run) { close = b; break; }
        q = b2;
      }
      if (close !== -1) { code.push({ s: r, e: close, fence: false, lang: false }); i = close + run; }
      else i = r;
      continue;
    }
    if (c === '<') {
      if (s.startsWith('<!--', i)) {
        const e = s.indexOf('-->', i + 4);
        const end = e === -1 ? n : e + 3;
        holes.push([i, end]); i = end; continue;
      }
      const tag = scanTag(s, i);
      if (tag) {
        const lower = tag.name.toLowerCase();
        let end = tag.end;
        if (!tag.closing && !tag.selfClosing && (lower === 'style' || lower === 'script')) end = rawTextEnd(s, tag.end, lower);
        holes.push([i, end]); i = end; continue;
      }
      // オートリンク <https://…> <a@b.c>：中の文字はそのまま表示されるので潰さない。範囲だけ覚える
      const am = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/.exec(s.slice(i, i + 2100));
      if (am) { auto.push({ s: i, e: i + am[0].length }); i += am[0].length; continue; }
      i++; continue;
    }
    if (c === '!' && s[i + 1] === '[') { // 画像：![alt](src "title") を丸ごと
      let depth = 0, close = -1;
      for (let j = i + 1; j < n && s[j] !== '\n'; j++) {
        if (s[j] === '\\') { j++; continue; }
        if (s[j] === '[') depth++;
        else if (s[j] === ']') { depth--; if (depth === 0) { close = j; break; } }
      }
      if (close !== -1 && s[close + 1] === '(') {
        const end = linkDestEnd(s, close + 1);
        if (end !== -1) { holes.push([i, end]); i = end; continue; }
      }
      i++; continue;
    }
    if (c === ']' && s[i + 1] === '(') { // リンク：[文字](url "title") の (…) だけ
      const end = linkDestEnd(s, i + 1);
      if (end !== -1) { holes.push([i + 1, end]); i = end; continue; }
      i++; continue;
    }
    if (c === '$') { // 数式（MathJax/KaTeX の出力は原稿の文字と対応しない）
      if (s[i + 1] === '$') {
        // $$ … $$ が数式になるのは行頭に書いたブロックだけ。文中の $$E=mc^2$$ は marp-core では文字のまま出る（実測）
        let ls = i; while (ls > 0 && (s[ls - 1] === ' ' || s[ls - 1] === '\t')) ls--;
        const e = ls === 0 || s[ls - 1] === '\n' ? s.indexOf('$$', i + 2) : -1;
        if (e !== -1) { holes.push([i, e + 2]); i = e + 2; continue; }
        i += 2; continue;
      }
      if (i + 1 < n && !/\s/.test(s[i + 1])) {
        const lim = paragraphEnd(s, i + 1);
        let q = i + 1, e = -1;
        while (q < lim) {
          const d = s.indexOf('$', q);
          if (d === -1 || d >= lim) break;
          if (s[d - 1] === '\\') { q = d + 1; continue; }
          e = d; break;
        }
        // 閉じ $ の直前が空白でなく、直後が数字でない（「$5 と $6」を数式にしない。markdown-it の数式プラグインと同じ規則）
        if (e !== -1 && !/\s/.test(s[e - 1]) && !/[0-9]/.test(s[e + 1] || '')) { holes.push([i, e + 1]); i = e + 1; continue; }
      }
      i++; continue;
    }
    i++;
  }
  let masked = '';
  let pos = 0;
  for (const [a, b] of holes) {
    if (b <= pos) continue;
    const a2 = Math.max(a, pos);
    masked += s.slice(pos, a2) + '\0'.repeat(b - a2);
    pos = b;
  }
  masked += s.slice(pos);
  return { masked, code, auto };
}

// ---------------------------------------------------------------------------
// 3. 表示文字列と原稿の 1 文字ずつの照合
// ---------------------------------------------------------------------------

// よく使う名前つき実体参照だけ持つ（markdown-it は全種を解くが、表に無い名前は「特定できない」に倒れるだけで安全）
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', times: '×', divide: '÷', plusmn: '±', deg: '°',
  rarr: '→', larr: '←', uarr: '↑', darr: '↓', harr: '↔', rArr: '⇒', lArr: '⇐', hArr: '⇔',
  yen: '¥', middot: '·', bull: '•', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍',
  le: '≤', ge: '≥', ne: '≠', infin: '∞', micro: 'µ', para: '¶', sect: '§', check: '✓',
};
const ENTITY_RE = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/y;

function decodeEntityAt(src, p) {
  ENTITY_RE.lastIndex = p;
  const m = ENTITY_RE.exec(src);
  if (!m) return null;
  const body = m[1];
  let str = null;
  if (body[0] === '#') {
    const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) str = String.fromCodePoint(cp);
  } else if (Object.prototype.hasOwnProperty.call(NAMED, body)) str = NAMED[body];
  return str === null ? null : { str, len: m[0].length };
}

/**
 * src の pos から、表示文字列 t が（実体参照・バックスラッシュ・CRLF を挟んで）書かれているか調べる。
 * 書かれていれば境界の配列 bounds（長さ t.length+1。bounds[i] は表示 i 文字目が原稿で始まる位置）を返す。無ければ null。
 * 候補は「そのまま → \記号 → 実体参照」の順に試し、行き詰まったら戻る
 * （コードの中の &amp; は文字どおり、本文の &amp; は & …のように同じ原稿でも読みが分かれるため）。
 */
function matchAt(src, pos, t, allowEsc, allowEnt, limit) {
  const L = t.length;
  const bounds = new Array(L + 1);
  const stack = [];
  let i = 0, p = pos, alt = 0;
  for (;;) {
    if (i === L) { bounds[L] = p; return bounds; }
    let adv = 0, step = 1, used = -1;
    if (p < limit) {
      const sc = src[p], tc = t[i];
      for (let o = alt; o < 3 && used === -1; o++) {
        if (o === 0) {
          if (sc === tc) { adv = 1; used = 0; }
          else if (tc === '\n' && sc === '\r' && src[p + 1] === '\n') { adv = 2; used = 0; }
        } else if (o === 1) {
          if (allowEsc && sc === '\\' && src[p + 1] === tc && ASCII_PUNCT.test(tc)) { adv = 2; used = 1; }
        } else if (allowEnt && sc === '&') {
          const d = decodeEntityAt(src, p);
          if (d && t.startsWith(d.str, i)) { adv = d.len; step = d.str.length; used = 2; }
        }
      }
    }
    if (used === -1) {
      if (!stack.length) return null;
      const f = stack.pop(); i = f.i; p = f.p; alt = f.alt; continue;
    }
    // 別の読みがあり得るのは原稿側が \ か & のときだけ。そこにだけ戻り先を積む
    if (used < 2 && (src[p] === '\\' || src[p] === '&')) stack.push({ i, p, alt: used + 1 });
    for (let k = 0; k < step; k++) bounds[i + k] = k === 0 ? p : p + adv;
    p += adv; i += step; alt = 0;
  }
}

function inCode(code, pos) {
  for (const c of code) if (pos >= c.s && pos < c.e) return c;
  return null;
}

/** masked の [a, b) から t を探す。最も手前の一致 { start, bounds, code } か null */
function findIn(M, a, b, t, kind) {
  const src = M.masked;
  if (!t || a >= b) return null;
  let fast = src.indexOf(t, a);
  if (fast !== -1 && fast + t.length > b) fast = -1;
  const lim = fast === -1 ? b : fast;
  // そのままの一致より手前に、\ & CR を含む書き方の一致が無いかだけ調べる（無ければ indexOf の結果で確定）
  const has = (ch) => { const x = src.indexOf(ch, a); return x !== -1 && x < lim + t.length && x < b; };
  if (has('\\') || has('&') || has('\r')) {
    const t0 = t[0];
    for (let p = a; p < lim; p++) {
      const sc = src[p];
      if (sc !== t0 && sc !== '\\' && sc !== '&') continue;
      const c = inCode(M.code, p);
      const bounds = matchAt(src, p, t, !c && kind !== 'html', !c, b);
      if (bounds) return { start: p, bounds, code: c };
    }
  }
  if (fast === -1) return null;
  const c = inCode(M.code, fast);
  const bounds = matchAt(src, fast, t, !c && kind !== 'html', !c, b) || plainBounds(fast, t.length);
  return { start: fast, bounds, code: c };
}

function plainBounds(start, len) {
  const b = new Array(len + 1);
  for (let i = 0; i <= len; i++) b[i] = start + i;
  return b;
}

// ---------------------------------------------------------------------------
// 4. locateNodes（順序つきカーソル探索）
// ---------------------------------------------------------------------------

function locateDetailed(sourceText, slideRange, nodes) {
  const text = String(sourceText);
  const lineOff = lineOffsets(text);
  const lineCount = lineOff.length - 1;
  const [sLine, eLine] = normRange(slideRange, lineCount);
  const base = lineOff[sLine];
  const M = maskRegion(text, base, lineOff[eLine]);
  const slideLen = M.masked.length;
  const relLine = (ln) => lineOff[Math.max(sLine, Math.min(ln, eLine))] - base;
  let cursor = 0;
  const out = [];
  for (const nd of nodes || []) {
    const raw = nd && typeof nd.t === 'string' ? nd.t : '';
    const t = raw.trim();
    const near = nd && nd.near && Number.isFinite(nd.near.start) ? nd.near : null;
    const kind = near ? near.kind : null;
    let hit = null;
    if (t) {
      const lo = near ? Math.max(cursor, relLine(near.start)) : cursor;
      const hi = near && near.end > near.start ? relLine(near.end) : slideLen;
      hit = findIn(M, lo, hi, t, kind);
      // html_block は空行で終わるが、DOM 上の要素はその先まで続く（<div> の中に空行を挟んで HTML を続ける書き方）。
      // 後続の html_block の「タグに包まれていない文字」は、先に開いた要素が near になり、窓の上限（先のブロックの終わり）
      // より後ろにある。html 由来の文字は原稿に必ずそのまま書かれているので、窓の上限だけスライド末尾まで広げて探し直す。
      // Markdown 由来（kind:'md'）は map が正確で、見つからないのは数式・絵文字など原稿に無い文字なので広げない
      // （広げると後ろの同じ語に誤ヒットしてカーソルが飛ぶ）。
      // 実測：推敲済み3デック 4,890 ノードでは広げる必要は 0 件（data-hline をタグ自身の行にしたので、下限が効いて窓の中で見つかる）。
      // 要るのは「<div>↵空行↵<div class="in">…</div> 裸の文字↵</div>」のような、後続ブロックの包まれていない文字だけ（合成ケースで確認）。
      if (!hit && kind === 'html' && hi < slideLen) hit = findIn(M, lo, slideLen, t, kind);
    }
    if (!hit) { out.push(null); continue; }
    const end = hit.bounds[t.length];
    cursor = end;
    const seg = M.masked.slice(hit.start, end);
    out.push({
      start: base + hit.start, end: base + end, encoded: seg !== t,
      // 以下は planTextEdit 用の内部情報（locateNodes は落として返す）
      bounds: hit.bounds, base, code: hit.code, kind, lead: raw.length - raw.trimStart().length, t,
      auto: M.auto.some(r => hit.start >= r.s && hit.start < r.e),
    });
  }
  return { locs: out, M, base, lineOff, sLine, eLine };
}

/**
 * nodes（ssCollectTextNodes の戻り値から node を除いた [{t, near, svg}]）を原稿の位置に写す。
 * 戻り値：各ノードの { start, end, encoded } | null。start/end は trim 済み文字列の範囲（UTF-16 オフセット）。
 * encoded は「原稿の書き方が表示と違う」（実体参照・バックスラッシュ・CRLF を含む）。
 */
function locateNodes(sourceText, slideRange, nodes) {
  return locateDetailed(sourceText, slideRange, nodes).locs
    .map(l => (l ? { start: l.start, end: l.end, encoded: l.encoded } : null));
}

// ---------------------------------------------------------------------------
// 5. 書き戻し
// ---------------------------------------------------------------------------

function lineOfOffset(lineOff, off) {
  let lo = 0, hi = lineOff.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOff[mid] <= off) lo = mid; else hi = mid - 1;
  }
  return lo;
}

const encEntities = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Markdown の本文に入れる文字列のエスケープ。入力どおりに表示されるよう、記法として働く記号だけを \ で止める。
 *   following … 挿入位置の直後に続く原稿（& が実体参照に化けるかの判定用）
 */
function escapeMarkdown(ins, opts) {
  const o = opts || {};
  let out = '';
  for (let i = 0; i < ins.length; i++) {
    const ch = ins[i];
    if (ch === '<' || ch === '>') {
      if (o.entities) out += ch === '<' ? '&lt;' : '&gt;';
      else out += ch === '<' ? '\\<' : '>';
    } else if (ch === '&') {
      const rest = ins.slice(i + 1) + (o.following || '');
      out += o.entities || /^(#[0-9]|#[xX][0-9a-fA-F]|[A-Za-z])/.test(rest) ? '&amp;' : '&';
    } else if ('\\*_`[]~$'.indexOf(ch) !== -1) out += '\\' + ch; // ] はリンク [文字](url) の中で入力されるとリンクが切れる
    else if (ch === '|' && o.table) out += '\\|';
    else out += ch;
  }
  return out;
}

/**
 * 行頭（箇条書き・引用の記号の直後を含む）に来ると見出し・箇条書き・引用・区切り線に化ける書き出しを \ で止める。
 * 「---」「- - -」「--」「===」のように - = と空白だけの行は、区切り線（＝Marp のページ分割。frontmatter の無い原稿の
 * 1 行目なら frontmatter の開始）か、前の行を見出しにする setext の下線になる。原稿を壊す側の失敗なので必ず止める。
 */
function guardLineHead(textAtHead) {
  if (/^(?:#{1,6}|[-+])(?:[ \t]|$)/.test(textAtHead) || textAtHead[0] === '>' || /^[-=][-= \t]*$/.test(textAtHead)) return '\\' + textAtHead;
  const d = /^(\d{1,9})([.)])([ \t]|$)/.exec(textAtHead);
  if (d) return d[1] + '\\' + textAtHead.slice(d[1].length);
  return textAtHead;
}

const SHORTCODE = /:(?:[A-Za-z0-9_+-]*[A-Za-z][A-Za-z0-9_+-]*|100|1234|\+1|-1):/;
const HEAD_MARKERS = /^[ \t]*(?:(?:>[ \t]?)|(?:[-+*]|\d{1,9}[.)])[ \t]+|#{1,6}[ \t]+)*$/;

function charClass(ch) {
  if (!ch || /\s/.test(ch)) return 2;                // 空白・行端
  if (/[\p{P}\p{S}]/u.test(ch)) return 1;            // 記号・句読点
  return 0;
}

/** 記号の並びの前の文字 b・後の文字 a から、CommonMark の left/right-flanking を 'LR' 'L' 'R' '' で返す */
function flanking(b, a) {
  const cb = charClass(b), ca = charClass(a);
  const left = ca !== 2 && (ca !== 1 || cb !== 0);
  const right = cb !== 2 && (cb !== 1 || ca !== 0);
  return (left ? 'L' : '') + (right ? 'R' : '');
}

/**
 * 原稿の runStart から始まる強調記号の並びが「開き」か「閉じ」か。同じ段落の中で、それより前にある同じ記号の
 * 並び（強調になり得るもの＝前後どちらかが空白でないもの。箇条書きの「* 」は数えない）が偶数個なら開き。
 * ノードの情報だけでは「強調の内側か外側か」が分からないための近似（外れても、断り過ぎるか実害の無い側に倒れる）。
 */
function delimiterRole(D, runStart, ch) {
  const src = D.M.masked, end = runStart - D.base;
  let from = 0;
  const re = /\n[ \t]*\r?\n/g;
  for (let m = re.exec(src); m && m.index < end; m = re.exec(src)) from = m.index + m[0].length;
  let count = 0;
  for (let i = from; i < end; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] !== ch) continue;
    const c = inCode(D.M.code, i);
    if (c) { i = c.e - 1; continue; }
    let j = i; while (j < end && src[j] === ch) j++;
    if (flanking(src[i - 1], src[j]) !== '') count++;
    i = j - 1;
  }
  return count % 2 === 0 ? 'open' : 'close';
}

/**
 * ノード k の位置が「順序だけ」で決まっていて、その順序が信用できない場合に true。
 * カーソル探索は「前のノードが原稿の文字を前から順に消費する」ことで同じ語を区別する。k より前に特定できなかった
 * ノード（原稿に無い文字を出すプラグインの出力・表に無い実体参照など）が同じ探索窓にあると、そのノードが消費する
 * はずだった語が残り、k が手前の同じ語に当たることがある（実測：KaTeX の出力「x」の後ろの「x」）。
 * そのときは、k の文字列が窓の中で見つけた位置より後ろにもう一度出るなら書かない。1 回しか出ないなら順序に頼っていない。
 */
function ambiguous(D, nodes, k) {
  const L = D.locs[k];
  const nk = nodes[k] && nodes[k].near && Number.isFinite(nodes[k].near.start) ? nodes[k].near : null;
  let suspect = false;
  for (let j = 0; j < k && !suspect; j++) {
    if (D.locs[j] || !nodes[j] || typeof nodes[j].t !== 'string' || !nodes[j].t.trim()) continue;
    const nj = nodes[j].near && Number.isFinite(nodes[j].near.start) ? nodes[j].near : null;
    suspect = !nj || !nk || !(nj.end > nj.start) || nj.end > nk.start;
  }
  if (!suspect) return false;
  const hi = nk && nk.end > nk.start
    ? D.lineOff[Math.max(D.sLine, Math.min(nk.end, D.eLine))] - D.base : D.M.masked.length;
  const from = L.end - D.base;
  return !!findIn(D.M, from, Math.max(hi, from), L.t, L.kind)
    || (L.kind === 'html' && !!findIn(D.M, from, D.M.masked.length, L.t, L.kind));
}

function fail(reason, line, extra) {
  return Object.assign({ ok: false, reason, line: Number.isFinite(line) ? line : null }, extra || {});
}

/**
 * 元の前後の空白（原稿での書かれ方が分からない部分）を外して、trim 済み同士で比べられる形にする。
 * もともと端に空白が無かったノードで、編集の結果として端が空白になったとき（「abc d」の d を消した等）は、
 * 同じ行に続きがある場合に限り空白を 1 つ残す（<b> などが続くと、消すと語がくっついて見える）。
 * 行末・行頭では残さない（行末の空白 2 つは改行 <br>、行頭の空白 4 つはコードブロックになる）。
 */
function coreOf(old, now, prevCh, nextCh) {
  const lead = old.slice(0, old.length - old.trimStart().length);
  const trail = old.slice(old.trimEnd().length);
  const inline = (ch) => !!ch && ch !== '\n' && ch !== '\r';
  let core = now;
  if (lead && core.startsWith(lead)) core = core.slice(lead.length);
  else { const t = core.trimStart(); core = (!lead && t && t.length < core.length && inline(prevCh) ? ' ' : '') + t; }
  if (trail && core.endsWith(trail) && core.length >= trail.length) core = core.slice(0, core.length - trail.length);
  else { const t = core.trimEnd(); core = t + (!trail && t && t.length < core.length && inline(nextCh) ? ' ' : ''); }
  return core;
}

/**
 * old の先頭・末尾の空白の並びが now で変わっているとき（＝空白の外側で打った／空白を消した）の扱い。
 * 関係なければ null（通常の経路へ）。関係あれば planTextEdit の戻り値（成功または失敗）を返す。
 * 受けるのは「空白の並びの中への、1 か所の挿入」で、原稿の同じ位置に同じ空白（半角空白・タブだけ）が確かめられるときだけ。
 * 文字を消した・置き換えた編集は null（通常の経路）。コードの中・行頭/行末・強調記号や URL の隣は 'space-boundary' などで断る。
 */
function planEdgeEdit(text, D, L, change, line) {
  const old = change.old, now = change.now;
  const lead = old.slice(0, old.length - old.trimStart().length);
  const trail = old.trim() ? old.slice(old.trimEnd().length) : '';
  const leadKept = !lead || now.startsWith(lead);
  const trailKept = !trail || (now.endsWith(trail) && now.length >= lead.length + trail.length);
  if (leadKept && trailKept) return null;
  if (!now.trim()) return null;                         // 全部消した編集は通常の経路（対の記号ごと消す）
  // old → now の差分（共通の前後を除く）
  let p = 0; const max = Math.min(old.length, now.length);
  while (p < max && old[p] === now[p]) p++;
  let s = 0;
  while (s < max - p && old[old.length - 1 - s] === now[now.length - 1 - s]) s++;
  const removed = old.slice(p, old.length - s);
  const ins = now.slice(p, now.length - s);
  if (removed) return null;                             // 消した・置き換えた編集は通常の経路（trim 済みどうしで比べる）
  if (!ins.trim()) return { ok: true, edit: null, edits: [], line }; // 空白を足しただけ → 原稿は変えない
  if (/[\r\n\0]/.test(ins)) return fail('newline', line);
  let at;
  if (p <= lead.length) {
    if (!/^[ \t]+$/.test(lead) || text.slice(L.start - lead.length, L.start) !== lead) return fail('space-boundary', line);
    at = L.start - lead.length + p;
  } else if (p >= old.length - trail.length) {
    if (!/^[ \t]+$/.test(trail) || text.slice(L.end, L.end + trail.length) !== trail) return fail('space-boundary', line);
    at = L.end + (p - (old.length - trail.length));
  } else return null;
  if (L.code) return fail('space-boundary', line);
  const ls = D.lineOff[lineOfOffset(D.lineOff, at)];
  const le = (() => { const x = text.indexOf('\n', at); return x === -1 ? text.length : x; })();
  const before = text.slice(ls, at), following = text.slice(at, le).replace(/\r$/, '');
  const bc = before.slice(-1), ac = following[0] || '';
  if (!before.trim() || !following.trim()) return fail('space-boundary', line); // 行頭・行末（字下げや改行の意味が変わりうる）
  if (bc === '\\') return fail('space-boundary', line);
  let out;
  if (L.kind === 'html') out = encEntities(ins);
  else if (L.kind === 'md') {
    // 強調記号の隣は left/right-flanking の判定が変わりうる。URL（linkify）の隣はリンク先が変わる
    if (/[*_~]/.test(bc) || /[*_~]/.test(ac)) return fail('emphasis-boundary', line);
    const runBefore = /\S*$/.exec(before)[0], runAfter = /^\S*/.exec(following)[0];
    const URLISH = /(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\/|www\.|[^\s@<>]+@[^\s@<>]+\.)/;
    if ((URLISH.test(runBefore) && !/[>)]$/.test(runBefore)) || (URLISH.test(runAfter) && !/^[<\[(]/.test(runAfter))) return fail('autolink', line);
    const rawLine = text.slice(ls, le);
    const table = /^\s*\|/.test(rawLine) || /\|\s*$/.test(rawLine.replace(/\r$/, ''));
    out = escapeMarkdown(ins, { entities: /&(?:amp|lt|gt);/.test(text.slice(L.start, L.end)), following, table });
    const SHORT = new RegExp(SHORTCODE.source, 'g');
    if (((before + out + following).match(SHORT) || []).length > ((before + following).match(SHORT) || []).length) return fail('emoji-shortcode', line);
    const mk = /^[ \t]*(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+|#{1,6}[ \t]+)*/.exec(before)[0].length;
    const was = before.slice(mk) + following, will = before.slice(mk) + out + following;
    if (guardLineHead(will) !== will && guardLineHead(was) === was) return fail('line-head', line);
  } else {
    if (/[\\*_`[~$|]/.test(ins)) return fail('unknown-context', line);
    out = encEntities(ins);
  }
  // 直前の & と合わせて実体参照の形になるなら書かない（& はこのノードの外にある）
  if (/&[#A-Za-z0-9]{0,32}$/.test(before) && /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/.test(/&[#A-Za-z0-9]{0,32}$/.exec(before)[0] + out + following)) return fail('entity-boundary', line);
  const edit = { start: at, end: at, text: out };
  return { ok: true, edit, edits: [edit], line: lineOfOffset(D.lineOff, at) };
}

/**
 * ノード k の文字列を old → now に変える編集を計算する。change = { k, old, now }（どちらも nodeValue そのまま）。
 * 成功：{ ok:true, edit:{start,end,text}|null, edits:[…], line }（変化なしは edit:null）
 * 失敗：{ ok:false, reason, line }
 * 変えるのは old と now の差分にあたる部分だけ。共通の前後（既存の実体参照・エスケープ・空白）は 1 バイトも触らない。
 */
function planTextEdit(sourceText, slideRange, nodes, change) {
  const text = String(sourceText);
  const D = locateDetailed(text, slideRange, nodes);
  const k = change && change.k;
  const nd = nodes && nodes[k];
  if (!nd) return fail('no-node', D.sLine);
  const nearLine = nd.near && Number.isFinite(nd.near.start) ? nd.near.start : D.sLine;
  const L = D.locs[k];
  if (!L) return fail('not-located', nearLine);
  if (typeof change.old !== 'string' || typeof change.now !== 'string') return fail('bad-change', nearLine);
  if (change.old !== nd.t) return fail('stale', nearLine);
  const line = lineOfOffset(D.lineOff, L.start);
  if (ambiguous(D, nodes, k)) return fail('ambiguous', line);
  const tt = L.t;
  // 端の空白の「外側」に打った文字（リンクや太字の直後にキャレットを置いて打つと、次のノードの先頭の空白より前に入る）。
  // trim 済みの文字列どうしで比べると空白の内側に書いてしまうので、先に別扱いにする
  const edge = planEdgeEdit(text, D, L, change, line);
  if (edge) return edge;
  const core = coreOf(change.old, change.now, text[L.start - 1], text[L.end]);
  if (core === tt) return { ok: true, edit: null, edits: [], line };

  // 差分（共通の前後を除いた真ん中）。サロゲートペアの途中では切らない
  let p = 0;
  const maxP = Math.min(tt.length, core.length);
  while (p < maxP && tt[p] === core[p]) p++;
  if (p > 0 && /[\ud800-\udbff]/.test(tt[p - 1])) p--;
  let s = 0;
  while (s < tt.length - p && s < core.length - p && tt[tt.length - 1 - s] === core[core.length - 1 - s]) s++;
  if (s > 0 && /[\udc00-\udfff]/.test(tt[tt.length - s])) s--;
  let ins = core.slice(p, core.length - s);
  if (/[\r\n\0]/.test(ins)) return fail('newline', line); // 改行は段落や <br> を生む。1 行の編集だけ受ける

  const rel = (i) => L.bounds[i];
  let es = D.base + rel(p), ee = D.base + rel(tt.length - s);
  const srcBefore = text.slice(D.lineOff[lineOfOffset(D.lineOff, es)], es);
  const lineEndOff = (() => { const x = text.indexOf('\n', ee); return x === -1 ? text.length : x; })();
  const following = text.slice(ee, lineEndOff).replace(/\r$/, '');
  let out;

  if (L.kind !== 'html' && !L.code && (L.auto || /^(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\/|www\.)\S+$/.test(tt))) {
    // <https://…> や裸の URL（linkify）は、表示の文字がそのままリンク先。書き換えるとリンクごと変わる・切れる（実測）
    return fail('autolink', line);
  }
  if (L.code) {
    // 言語名つきのフェンスは highlight.js が字句ごとに <span> へ割る。1 文字足すだけで割り方が変わり、
    // 「どのノードが変わるか」を保証できない（実測：const★検 でキーワードでなくなり隣と合体）ので断る
    if (L.code.lang) return fail('code-highlight', line);
    // コードの中：そのまま書く。区切りの ` や ``` を入力されると範囲が変わるので受けない
    if (!L.code.fence) {
      const whole = tt.slice(0, p) + ins + tt.slice(tt.length - s);
      if (ins.indexOf('`') !== -1 || whole[0] === '`' || whole[whole.length - 1] === '`') return fail('code-delimiter', line);
    }
    if (L.code.fence && /`{3,}|~{3,}/.test(ins)) return fail('code-delimiter', line);
    out = ins;
  } else if (L.kind === 'html') {
    out = encEntities(ins);
  } else if (L.kind === 'md') {
    const atHead = HEAD_MARKERS.test(srcBefore);
    if (atHead) ins = ins.trimStart(); // 行頭の空白 4 つはコードブロックになる
    // :smile: の形は marp-core の絵文字プラグインが画像に変える。\: でも &#58; でも止まらない（実測）ので、
    // 編集でこの形が新しくできるときは書かない（入力した文字が消えて見える）
    // （名前の一覧は marp-core に埋め込まれていて引けない。英字を含む名前と、数字だけの :100: :1234: :+1: :-1: を疑う。「10:30:45」は通す）
    const SHORT = new RegExp(SHORTCODE.source, 'g');
    if ((((tt.slice(0, p) + ins + tt.slice(tt.length - s)).match(SHORT) || []).length) > ((tt.match(SHORT) || []).length)) return fail('emoji-shortcode', line);
    const rawLine = text.slice(D.lineOff[line], lineEndOff);
    const table = /^\s*\|/.test(rawLine) || /\|\s*$/.test(rawLine.replace(/\r$/, ''));
    const usesEntities = /&(?:amp|lt|gt);/.test(text.slice(L.start, L.end));
    out = escapeMarkdown(ins, { entities: usesEntities, following, table });
    if (atHead) {
      const guarded = guardLineHead(out + following);
      out = guarded.slice(0, guarded.length - following.length);
    } else {
      // 差分は行の途中から始まるが、編集の結果として行全体が「-」「--」「1.」などに化ける場合
      // （「-x」の x を消す、「--」に - を足して「---」＝ページ分割、など）。\ を入れる場所が差分の外なので書かない
      const mk = /^[ \t]*(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+|#{1,6}[ \t]+)*/.exec(srcBefore)[0].length;
      const was = srcBefore.slice(mk) + text.slice(es, ee) + following;
      const will = srcBefore.slice(mk) + out + following;
      if (guardLineHead(will) !== will && guardLineHead(was) === was) return fail('line-head', line);
    }
    // 直前が「文字としての \」（C:\dir など。奇数個の並び）のとき、その直後に ASCII 記号が来ると \ がエスケープとして
    // 食われて消える（「C:\」に「!」を足すと「C:!」と表示される）。\ をもう 1 つ足して文字のままにする
    {
      let bs = 0; while (es - 1 - bs >= 0 && text[es - 1 - bs] === '\\') bs++;
      const nxt = (out + following)[0];
      if (bs % 2 === 1 && nxt && ASCII_PUNCT.test(nxt)) out = '\\' + out;
    }
    // 行頭が空白 4 つ以上（またはタブ）で記号が無い行は、インデントのコードブロックか、箇条書きの続きの段落か、
    // ノードの情報だけでは見分けられない。前者ならエスケープは文字として出てしまい、後者なら必要。
    // どちらでも同じ結果になる入力（エスケープ不要の文字だけ）のときだけ受ける
    const lineHead = text.slice(D.lineOff[line], L.start);
    if (/^(?: {4,}| {0,3}\t)[ \t]*$/.test(lineHead) && out !== ins) return fail('maybe-code', line);
    // 強調記号（* _ ~）の隣の文字が変わると、CommonMark の left/right-flanking の判定が変わって強調が外れ、
    // 記号が丸見えになることがある（「と**強調**」の 強調 の頭に「 を足す、が典型。日本語の文字は「文字」扱い）。
    // 記号の並びが「開き」なら left、「閉じ」なら right が要る。編集でそれを失うなら書かない（もともと外れているなら関知しない）。
    const afterCh = text[ee] || '', beforeCh = es > 0 ? text[es - 1] : '';
    if (core && /[*_~]/.test(afterCh) && s === 0) {
      let q = ee; while (text[q] === afterCh) q++;
      const need = delimiterRole(D, ee, afterCh) === 'open' ? 'L' : 'R';
      if (flanking(tt[tt.length - 1], text[q]).includes(need) && !flanking(core[core.length - 1], text[q]).includes(need)) return fail('emphasis-boundary', line);
    }
    if (core && /[*_~]/.test(beforeCh) && p === 0) {
      let q = es - 1; while (q >= 0 && text[q] === beforeCh) q--;
      const need = delimiterRole(D, q + 1, beforeCh) === 'open' ? 'L' : 'R';
      if (flanking(text[q], tt[0]).includes(need) && !flanking(text[q], core[0]).includes(need)) return fail('emphasis-boundary', line);
    }
  } else {
    // 位置情報の無いノード（near:null）：Markdown か HTML か分からない。どちらでも同じ意味になる文字だけ受ける
    if (/[\\*_`[~$|]/.test(ins)) return fail('unknown-context', line);
    out = encEntities(ins);
  }

  // 直前に「文字としての &」があり、足した文字（または消した結果くっついた続き）と合わせて実体参照の形になる場合
  // （「A &」に「amp;」を足す → 原稿は A &amp; → 表示は A &）。& がこのノードの中なら、& から書き直して &amp; にする。
  // ノードの外の & は触れないので書かない。名前は markdown-it / ブラウザが全種を解くので、形だけで判定する（安全側）
  if (!L.code) {
    const ls = D.lineOff[lineOfOffset(D.lineOff, es)];
    const pre = /&[#A-Za-z0-9]{0,32}$/.exec(text.slice(ls, es));
    if (pre) {
      const ENT = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;
      const will = ENT.exec(pre[0] + out + following);
      const was = ENT.exec(pre[0] + text.slice(es, ee) + following);
      if (will && will[0].length > pre[0].length && !(was && was[0] === will[0])) {
        const ampAt = ls + pre.index;
        if (ampAt < L.start) return fail('entity-boundary', line);
        out = '&amp;' + pre[0].slice(1) + out;
        es = ampAt;
      }
    }
  }

  // 全部消したとき：**太字** の中身だけ消すと **** が文字として出る。対になった記号ごと消す
  if (core === '' && L.kind !== 'html') {
    for (let round = 0; round < 3; round++) {
      const c = text[es - 1];
      if (!c || '*_~`'.indexOf(c) === -1 || text[ee] !== c) break;
      let a = 0; while (text[es - 1 - a] === c) a++;
      let b = 0; while (text[ee + b] === c) b++;
      const nn = Math.min(a, b);
      es -= nn; ee += nn;
    }
  }
  // 行が空になるとき、その行の意味を支えていた前後の行が別のものに化ける：
  //   次の行が setext の下線（=== / ---）… 見出しの文字を消すと、--- は区切り線＝Marp のページ分割になる
  //   前の行が \ で終わる（強制改行）… 続きを消すと \ が文字として出る
  if (L.kind !== 'html' && !L.code) {
    const ls = D.lineOff[lineOfOffset(D.lineOff, es)];
    const le = (() => { const x = text.indexOf('\n', ee); return x === -1 ? text.length : x; })();
    const left = text.slice(ls, es) + out + text.slice(ee, le);
    if (/^[ \t>]*\r?$/.test(left) && !/^[ \t>]*\r?$/.test(text.slice(ls, le))) {
      const next = text.slice(le + 1, (() => { const x = text.indexOf('\n', le + 1); return x === -1 ? text.length : x; })());
      if (le < text.length && /^ {0,3}(?:=+|-+)[ \t]*\r?$/.test(next)) return fail('setext', line);
      const prevTail = text.slice(Math.max(0, ls - 4), ls);
      if (/\\\r?\n$/.test(prevTail) && !/\\\\\r?\n$/.test(prevTail)) return fail('hard-break', line);
    }
  }
  const edit = { start: es, end: ee, text: out };
  return { ok: true, edit, edits: [edit], line };
}

/**
 * ノード k の nodeValue 上の範囲 [start, end) を原稿の範囲に写す（プレビューで選んだ文字に既存の tune を当てるため）。
 * sel = { k, start, end }。成功：{ ok:true, start, end, line, startCol, endCol }
 * tune は選択範囲を <span> で包むので、原稿の書き方が表示と違う部分（実体参照・エスケープ）・コードの中・
 * インライン SVG の中・複数行にまたがる範囲は ok:false。
 */
function planRangeSelect(sourceText, slideRange, nodes, sel) {
  const text = String(sourceText);
  const D = locateDetailed(text, slideRange, nodes);
  const nd = nodes && sel && nodes[sel.k];
  if (!nd) return fail('no-node', D.sLine);
  const nearLine = nd.near && Number.isFinite(nd.near.start) ? nd.near.start : D.sLine;
  const L = D.locs[sel.k];
  if (!L) return fail('not-located', nearLine);
  const line = lineOfOffset(D.lineOff, L.start);
  if (ambiguous(D, nodes, sel.k)) return fail('ambiguous', line);
  if (nd.svg) return fail('svg', line);
  if (L.code) return fail('code', line);
  let a = Math.max(0, Math.min(sel.start, sel.end) - L.lead);
  let b = Math.min(L.t.length, Math.max(sel.start, sel.end) - L.lead);
  if (!(b > a)) return fail('empty-range', line);
  const start = D.base + L.bounds[a], end = D.base + L.bounds[b];
  const seg = text.slice(start, end);
  if (seg !== L.t.slice(a, b)) return fail('encoded', line);
  if (/[\r\n]/.test(seg)) return fail('multiline', line);
  const ln = lineOfOffset(D.lineOff, start);
  return { ok: true, start, end, line: ln, startCol: start - D.lineOff[ln], endCol: end - D.lineOff[ln] };
}

/**
 * テキストノードを持たない要素（空の li・空の見出しなど）に初めて文字を入れる。
 * target = { line, lineEnd }（要素の data-line / data-line-end）。その行が「記号だけ」のときに限り、行末に now を足す。
 * それ以外（HTML の空要素・表の空セルなど）は書く場所を決められないので ok:false。
 */
function planEmptyFill(sourceText, slideRange, target, now) {
  const text = String(sourceText);
  const lineOff = lineOffsets(text);
  const [sLine, eLine] = normRange(slideRange, lineOff.length - 1);
  const ln = target && Number.isFinite(target.line) ? target.line : (target && Number.isFinite(target.start) ? target.start : NaN);
  if (!Number.isFinite(ln) || ln < sLine || ln >= eLine) return fail('out-of-slide', sLine);
  if (target.kind === 'html') return fail('html-empty', ln);
  const ins = String(now == null ? '' : now).trim();
  if (!ins) return { ok: true, edit: null, edits: [], line: ln };
  if (/[\r\n\0]/.test(ins)) return fail('newline', ln);
  let eol = lineOff[ln + 1] !== undefined ? lineOff[ln + 1] : text.length;
  if (text[eol - 1] === '\n') eol--;
  if (text[eol - 1] === '\r') eol--;
  const raw = text.slice(lineOff[ln], eol);
  // 空白だけの行は「記号だけの行」ではない（どの要素の行でもない。足すと新しい段落ができる）
  if (!raw.trim() || !/^[ \t]*(?:>[ \t]?)*(?:(?:[-+*]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?|#{1,6})?[ \t]*$/.test(raw)) return fail('not-empty', ln);
  if (SHORTCODE.test(ins)) return fail('emoji-shortcode', ln); // planTextEdit と同じ理由
  const body = guardLineHead(escapeMarkdown(ins, { following: '' }));
  const needSpace = raw.length > 0 && !/[ \t]$/.test(raw);
  const edit = { start: eol, end: eol, text: (needSpace ? ' ' : '') + body };
  return { ok: true, edit, edits: [edit], line: ln };
}

/** 編集（互いに重ならない）を後ろから適用した文字列を返す（テスト・CLI 用） */
function applyEdits(text, edits) {
  let out = String(text);
  for (const e of [...(edits || [])].sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

module.exports = {
  attachLineInfo, locateNodes, planTextEdit, planRangeSelect, planEmptyFill,
  // 以下はテスト・他モジュール用
  injectHlines, maskRegion, escapeMarkdown, applyEdits, lineOffsets,
  eachOpenTag, // lib/style-edit.cjs が injectHlines と同じ数え方で開始タグを数えるため
};
