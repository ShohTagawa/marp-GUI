// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 完成スライドの印・台帳・貼り付け先への適応（vscode 非依存。fs / path / crypto だけ）。
// DESIGN.md 3 の正本実装。拡張（lib/library-vscode.cjs）と CLI（tools/marp-library.mjs）の両方がここを使う。
//
// 原稿に書き込むのは「_class と同居する _lib / _from の1行」だけ。
//   Marpit は、コメント内に既知キーが1つでもあればコメント全体をディレクティブとして扱い、
//   発表者ノートにも HTML にも残さない（marp-core と標準 marp-cli の両方で実測）。
//   逆に、単独の <!-- _lib: … --> や、値に「: 」を含んで YAML として壊れたコメントは、丸ごとノートに出る。
//   → 値はクォートが要るときだけ writeMark が自動で付け、混入する形は findLeakyMarks が見つける。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { splitDeck, slideMeta, slideStartLines, LIB_KEY } = require('./slide-split.cjs');

/** 貼り付けたコピーに残す出自のキー（_lib の代わり。同じ id が2つにならないように） */
const FROM_KEY = '_from';

/** Marpit / marp-core が知っているディレクティブ名（先頭の _ を除いた形）。これと同居していれば _lib はノートに出ない */
const KNOWN_DIRECTIVES = new Set([
  'theme', 'style', 'headingDivider', 'lang',
  'paginate', 'header', 'footer', 'class', 'backgroundColor', 'backgroundImage',
  'backgroundPosition', 'backgroundRepeat', 'backgroundSize', 'color',
  'size', 'math', 'title', 'description', 'author', 'image', 'keywords', 'url', 'marp',
]);

const PALETTE_VARS = [
  ['accent', '--accent'], ['accentDark', '--accent-dark'],
  ['accentSoft', '--accent-soft'], ['sectionBg', '--section-bg'],
];

/** スライドパターンとして台帳に出すクラス（_class の中でこれに当たる最初のものを pattern にする） */
const PATTERN_CLASSES = ['cover-hero', 'cover', 'intro', 'fig', 'summary', 'split', 'message', 'divider',
  'wrap', 'refs', 'qa', 'sec-open'];

// ───────────────────────── 文字列の小道具 ─────────────────────────

/** 各行の先頭オフセット（UTF-16）。CRLF でも実際の位置を返す */
function lineOffsets(text) {
  const offs = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) offs.push(i + 1);
  return offs;
}

/** コードフェンス（``` / ~~~）の範囲 [start,end) を返す。中の <!-- や <style は原稿の見本なので触らない */
function fenceRanges(text) {
  const out = [];
  const offs = lineOffsets(text);
  let open = -1;
  for (let k = 0; k < offs.length; k++) {
    const end = k + 1 < offs.length ? offs[k + 1] : text.length;
    const t = text.slice(offs[k], end).trim();
    if (/^(```|~~~)/.test(t)) {
      if (open < 0) open = offs[k]; else { out.push([open, end]); open = -1; }
    }
  }
  if (open >= 0) out.push([open, text.length]);
  return out;
}
const inRanges = (ranges, pos) => ranges.some(([s, e]) => pos >= s && pos < e);

/** HTML コメントを列挙（コードフェンス内は除く）。inner は <!-- と --> の間 */
function findComments(text) {
  const fences = fenceRanges(text);
  const out = [];
  const re = /<!--([\s\S]*?)-->/g;
  let m;
  while ((m = re.exec(text))) {
    if (inRanges(fences, m.index)) continue;
    out.push({ start: m.index, end: m.index + m[0].length, inner: m[1], innerStart: m.index + 4 });
  }
  return out;
}

/** コメントの中身を「キー: 値」の行に分ける（YAML を真面目に解かない。1行1キーの形だけを見る） */
function directiveLines(inner) {
  const out = [];
  const lines = inner.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([_A-Za-z][\w-]*)\s*:(?:\s+(.*?))?\s*$/);
    if (m) out.push({ key: m[1], value: m[2] === undefined ? '' : m[2], lineIdx: i });
  }
  return out;
}
const isKnownKey = (key) => KNOWN_DIRECTIVES.has(key.replace(/^_/, ''));

/** YAML のスカラーを素の文字列へ（"…" と '…' を外す） */
function unquote(v) {
  const s = String(v).trim();
  if (/^".*"$/.test(s)) return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/**
 * 値をそのまま書くと YAML として壊れる（＝コメントが丸ごとノートに出て _class も効かなくなる）ときだけクォートする。
 * 実測：「: 」と行末の「:」で壊れる。「 #」は壊れないが以降が YAML コメント扱いで紛らわしいので一緒に包む。
 */
function yamlScalar(v) {
  const s = String(v);
  if (/:(\s|$)/.test(s) || /\s#/.test(s) || /["\\]/.test(s) || /^['\[\{&*!|>%@`]/.test(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** タグの中に区切り文字やコメント終端が入らないようにする（| は欄の区切り、, はタグの区切り、--> はコメントを閉じてしまう） */
function cleanTag(t) {
  return String(t).replace(/-->/g, '').replace(/[|,、\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}
function cleanId(id) {
  return String(id || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

/** 古い文字列と新しい文字列の差を、前後の共通部分を除いた1つの編集にする（エディタのカーソルが飛びにくい） */
function diffEdit(oldText, newText, base) {
  if (oldText === newText) return null;
  let a = 0;
  const max = Math.min(oldText.length, newText.length);
  while (a < max && oldText.charCodeAt(a) === newText.charCodeAt(a)) a++;
  let b = 0;
  while (b < max - a && oldText.charCodeAt(oldText.length - 1 - b) === newText.charCodeAt(newText.length - 1 - b)) b++;
  // サロゲートペア（絵文字・𠮷 など）の真ん中で切らない。上位だけが共通のときは 1 つ手前から、下位だけが共通のときは 1 つ後ろまでを編集に含める
  const isHigh = (c) => c >= 0xD800 && c <= 0xDBFF;
  const isLow = (c) => c >= 0xDC00 && c <= 0xDFFF;
  if (a > 0 && isHigh(oldText.charCodeAt(a - 1))) a--;
  if (b > 0 && isLow(oldText.charCodeAt(oldText.length - b))) b--;
  return { start: base + a, end: base + oldText.length - b, text: newText.slice(a, newText.length - b) };
}

/** 編集の列を文字列に適用する（後ろから） */
function applyEdits(text, edits) {
  const sorted = [...edits].sort((x, y) => y.start - x.start);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// ───────────────────────── 3.1 印 ─────────────────────────

function parseLibValue(raw) {
  const v = unquote(raw);
  const parts = v.split('|').map((s) => s.trim());
  const id = parts[0] || '';
  if (!id) return null;
  const tags = (parts[1] || '').split(/[,、]/).map((s) => s.trim()).filter(Boolean);
  return { id, tags, at: parts[2] || '' };
}

/** スライド（または断片）の中の最初の _lib を読む。無ければ null */
function parseMark(slideText) {
  for (const c of findComments(slideText)) {
    for (const d of directiveLines(c.inner)) {
      if (d.key === LIB_KEY) { const mk = parseLibValue(d.value); if (mk) return mk; }
    }
  }
  return null;
}

/** 貼り付けたコピーの出自（_from）。無ければ null */
function parseFrom(slideText) {
  for (const c of findComments(slideText)) {
    for (const d of directiveLines(c.inner)) if (d.key === FROM_KEY) return unquote(d.value) || null;
  }
  return null;
}

function formatMark(mark) {
  const id = cleanId(mark.id);
  if (!id) throw new Error('印の id が空です（半角英数とハイフンで指定してください）');
  const tags = (mark.tags || []).map(cleanTag).filter(Boolean);
  return yamlScalar(`${id} | ${tags.join(', ')} | ${mark.at || today()}`);
}

/** コメントの中身を行の配列にして組み直す。1行だけなら <!-- k: v -->、複数なら縦に並べる */
function renderComment(innerLines, eol) {
  const nl = eol || '\n';
  const ls = innerLines.map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
  if (!ls.length) return '';
  if (ls.length === 1) return `<!-- ${ls[0].trim()} -->`;
  return '<!--' + nl + ls.join(nl) + nl + '-->';
}

/** その文字列の改行コード。CRLF の原稿（Windows）に LF を混ぜない */
const eolOf = (text) => (/\r\n/.test(text) ? '\r\n' : '\n');

/**
 * スライド内のディレクティブコメントに「キー: 値」を1行入れる（あれば差し替え）。
 * 同居先は _class のあるコメント → 無ければ _ 付きの既知キーのあるコメント → どちらも無ければ
 * 先頭に `_class: <グローバル class か空>` のコメントを作る（単独の _lib はノートに出るため）。
 */
function setDirective(slideText, key, valueText, globalClass, eol) {
  const nl = eol || eolOf(slideText);
  const comments = findComments(slideText);
  const infos = comments.map((c) => ({ c, ds: directiveLines(c.inner) }));
  let target = infos.find((x) => x.ds.some((d) => d.key === key))
    || infos.find((x) => x.ds.some((d) => d.key === '_class'))
    || infos.find((x) => x.ds.some((d) => d.key.startsWith('_') && isKnownKey(d.key)));
  if (target) {
    const lines = target.c.inner.split(/\r?\n/);
    // `<!-- _class: x -->` の 1 行形式は前後に空白がある。縦に並べ直すときに字下げとして残さない
    if (lines.length === 1) lines[0] = lines[0].trim();
    const own = target.ds.find((d) => d.key === key);
    if (own) lines[own.lineIdx] = `${key}: ${valueText}`;
    else {
      // _class の直後（無ければ最後の既知キーの直後）に入れる
      const anchor = target.ds.find((d) => d.key === '_class') || [...target.ds].reverse().find((d) => isKnownKey(d.key));
      lines.splice(anchor.lineIdx + 1, 0, `${key}: ${valueText}`);
    }
    return slideText.slice(0, target.c.start) + renderComment(lines, nl) + slideText.slice(target.c.end);
  }
  // 新しく作る。_class を空にするとグローバル class が外れて見た目が変わる（実測）ので、グローバル class をそのまま書く
  const gc = String(globalClass || '').trim();
  const block = renderComment([`_class: ${gc}`.trimEnd(), `${key}: ${valueText}`], nl);
  const lead = slideText.match(/^(?:[ \t]*\r?\n)*/)[0];
  const rest = slideText.slice(lead.length);
  return lead + block + nl + (rest === '' || /^\r?\n/.test(rest) ? '' : nl) + rest;
}

/**
 * スライドからキーの行を消す。残りが「何もしない _class」だけになったらコメントごと消す
 * （空の _class と、グローバル class と同じ値の _class。どちらも writeMark が同居先として足したもの）。
 */
function dropDirective(slideText, key, globalClass) {
  const nl = eolOf(slideText);
  const gc = splitClasses(globalClass).join(' ');
  let out = slideText;
  // 後ろから処理して位置ずれを避ける
  for (const c of findComments(slideText).reverse()) {
    const ds = directiveLines(c.inner);
    if (!ds.some((d) => d.key === key)) continue;
    const kill = new Set(ds.filter((d) => d.key === key).map((d) => d.lineIdx));
    const lines = c.inner.split(/\r?\n/).filter((_, i) => !kill.has(i));
    const left = directiveLines(lines.join('\n'));
    const leftClass = left.length === 1 && left[0].key === '_class' ? splitClasses(unquote(left[0].value)).join(' ') : null;
    const onlyEmptyClass = leftClass !== null && (leftClass === '' || leftClass === gc)
      && lines.filter((l) => l.trim()).length === 1;
    let rep = onlyEmptyClass ? '' : renderComment(lines, nl);
    let end = c.end;
    if (rep === '') { const nl = out.slice(end).match(/^[ \t]*\r?\n(?:[ \t]*\r?\n)?/); if (nl) end += nl[0].length; }
    out = out.slice(0, c.start) + rep + out.slice(end);
  }
  return out;
}

/** 印を付ける（既にあれば書き換える）。mark = { id, tags[], at? } */
function writeMark(slideText, mark, opts) {
  return setDirective(slideText, LIB_KEY, formatMark(mark), opts && opts.globalClass, opts && opts.eol);
}
function removeMark(slideText, opts) { return dropDirective(slideText, LIB_KEY, opts && opts.globalClass); }

/**
 * 発表者ノートに混入する位置の _lib / _from を探す。
 *   reason 'alone' … 既知キー（_class 等）と同居していない
 *   reason 'yaml'  … 値に「: 」などがあり YAML として壊れている（コメント全体がノートに出て、_class も効かない）
 * 戻り値：[{ line(0-based), key, id, reason }]
 */
function findLeakyMarks(deckText) {
  const out = [];
  const offs = lineOffsets(deckText);
  const lineOf = (pos) => { let lo = 0, hi = offs.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offs[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  for (const c of findComments(deckText)) {
    const ds = directiveLines(c.inner);
    const mine = ds.filter((d) => d.key === LIB_KEY || d.key === FROM_KEY);
    if (!mine.length) continue;
    const hasKnown = ds.some((d) => isKnownKey(d.key));
    // クォート無しで「: 」や行末の「:」を含む値は、Marpit の YAML 解析が失敗する
    const broken = ds.some((d) => !/^["']/.test(d.value) && /:(\s|$)/.test(d.value));
    if (hasKnown && !broken) continue;
    const startLine = lineOf(c.start);
    for (const d of mine) {
      const pm = d.key === LIB_KEY ? parseLibValue(d.value) : null;
      out.push({ line: startLine + d.lineIdx, key: d.key, id: pm ? pm.id : unquote(d.value), reason: hasKnown ? 'yaml' : 'alone' });
    }
  }
  return out;
}

/** 題名（英数字の部分）とデック名から id の候補を作る。existing にある id は連番で避ける */
function suggestId(title, deckPath, slideNumber, existing) {
  const words = (String(title || '').match(/[A-Za-z0-9]+/g) || []).join('-');
  const deck = path.basename(String(deckPath || ''), '.md').replace(/^\d{6,8}_/, '');
  const ev = deck.split('_')[0] || 'slide';
  let base = cleanId(words && words.length >= 3 ? `${ev}-${words}` : `${ev}-${deck.split('_').slice(1).join('-') || 'slide'}-${slideNumber}`);
  base = base.slice(0, 48).replace(/-$/, '') || 'slide';
  const taken = new Set(existing || []);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

// ───────────────────────── CSS の小さなパーサ ─────────────────────────

/** コメントを同じ長さの空白に潰す（位置を保つ。文字列の中の /* は触らない） */
function blankCssComments(css) {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && css[j] !== ch) { if (css[j] === '\\') j++; j++; }
      out += css.slice(i, Math.min(j + 1, n)); i = j + 1; continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      let j = css.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      out += css.slice(i, j).replace(/[^\n]/g, ' '); i = j; continue;
    }
    out += ch; i++;
  }
  return out;
}

/** 開き波括弧の位置から、対応する閉じ波括弧の位置を返す（文字列内の波括弧は数えない）。無ければ -1 */
function matchBrace(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== ch) { if (s[j] === '\\') j++; j++; }
      i = j; continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();
/** 署名用の正規化：空白の揺れ、記号まわりの空白、末尾セミコロンの有無、hex の大文字小文字を同一視する */
function normSelector(sel) { return squash(sel).replace(/\s*([>+~,])\s*/g, '$1'); }
function normBody(body) {
  return squash(body).replace(/\s*([:;,{}])\s*/g, '$1').replace(/;+/g, ';').replace(/^;|;$/g, '').replace(/;}/g, '}')
    .replace(/#[0-9a-fA-F]{3,8}\b/g, (h) => h.toLowerCase());
}
function signatureOf(selector, body, atRule) {
  return crypto.createHash('md5').update((atRule ? squash(atRule) + '|' : '') + normSelector(selector) + '{' + normBody(body) + '}').digest('hex');
}

function classesOfSelector(sel) {
  const s = sel.replace(/\[[^\]]*\]/g, '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '');
  const out = new Set();
  const re = /\.(-?[A-Za-z_][\w-]*)/g;
  let m;
  while ((m = re.exec(s))) out.add(m[1]);
  return [...out];
}

/**
 * CSS をルールの列にする。@media / @supports / @layer / @container は中へ降りて atRule に前置きを残す。
 * @keyframes / @font-face などは 1 つのルール（selector='@keyframes 名前'、classes=[]）として返す。
 * 戻り値：[{ selector, body, classes[], signature, atRule|null, start, end }]（start/end は cssText 内の位置）
 */
function cssRules(cssText) {
  const css = blankCssComments(String(cssText || ''));
  const rules = [];
  const walk = (from, to, atRule) => {
    let pos = from;
    while (pos < to) {
      // 次の { を文字列を飛ばしながら探す
      let b = -1;
      for (let i = pos; i < to; i++) {
        const ch = css[i];
        if (ch === '"' || ch === "'") { let j = i + 1; while (j < to && css[j] !== ch) { if (css[j] === '\\') j++; j++; } i = j; continue; }
        if (ch === '{') { b = i; break; }
      }
      if (b < 0) break;
      let selStart = pos;
      // 直前までの `@import …;` などの文は読み飛ばす（最後の ; より後ろだけがセレクタ）
      const semi = css.lastIndexOf(';', b);
      if (semi >= pos) selStart = semi + 1;
      const prelude = css.slice(selStart, b);
      const e = matchBrace(css, b);
      if (e < 0 || e >= to + 1) break;
      const sel = squash(prelude);
      const lead = prelude.length - prelude.replace(/^\s+/, '').length;
      if (/^@(media|supports|layer|container)\b/i.test(sel)) walk(b + 1, e, atRule ? atRule + ' ' + sel : sel);
      else if (sel) {
        const body = squash(css.slice(b + 1, e));
        const isAt = sel.startsWith('@');
        rules.push({
          selector: sel, body, classes: isAt ? [] : classesOfSelector(sel),
          signature: signatureOf(sel, body, atRule), atRule: atRule || null, start: selStart + lead, end: e + 1,
        });
      }
      pos = e + 1;
    }
  };
  walk(0, css.length, null);
  return rules;
}

/** ルールを 1 行の CSS に戻す（frontmatter の style: | に足しやすい形。宣言の中身は変えない） */
function ruleToCss(r) {
  const body = r.body.replace(/;?\s*$/, r.body.trim() ? ';' : '');
  const one = `${r.selector} { ${body} }`.replace(/\{\s+\}/, '{ }');
  return r.atRule ? `${r.atRule} { ${one} }` : one;
}

// ───────────────────────── テーマ ─────────────────────────

const themeCache = new Map();

/** theme/*.css を読む。{ name → { name, file, css, imports[], rules } }（mtime が変われば読み直す） */
function loadThemes(repoRoot) {
  const dir = path.join(repoRoot, 'theme');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.css')).sort(); } catch (_) { return {}; }
  const key = names.map((n) => { try { return n + ':' + fs.statSync(path.join(dir, n)).mtimeMs; } catch (_) { return n; } }).join('|');
  const hit = themeCache.get(dir);
  if (hit && hit.key === key) return hit.themes;
  const themes = {};
  for (const n of names) {
    let css = '';
    try { css = fs.readFileSync(path.join(dir, n), 'utf8'); } catch (_) { continue; }
    const nm = (css.match(/\/\*\s*@theme\s+([^\s*]+)/) || [])[1] || n.replace(/\.css$/, '');
    const imports = [];
    const re = /@import\s+(?:url\()?\s*["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(blankCssComments(css)))) imports.push(m[1]);
    themes[nm] = { name: nm, file: path.join(dir, n), css, imports, rules: cssRules(css) };
  }
  themeCache.set(dir, { key, themes });
  return themes;
}

/** テーマ名 → @import をたどった順（土台が先）のテーマ列 */
function themeChain(themes, name) {
  const out = [];
  const seen = new Set();
  const visit = (n) => {
    const t = themes[n];
    if (!t || seen.has(n)) return;
    seen.add(n);
    t.imports.forEach(visit);
    out.push(t);
  };
  visit(name);
  return out;
}

/**
 * theme/*.css に出るクラス名。
 *   all      … 全テーマの和集合（Set）
 *   byTheme  … { テーマ名: Set }（@import 先も含む＝そのテーマで実際に使えるクラス）
 */
function themeClasses(repoRoot) {
  const themes = loadThemes(repoRoot);
  const all = new Set();
  const byTheme = {};
  for (const name of Object.keys(themes)) {
    const set = new Set();
    for (const t of themeChain(themes, name)) for (const r of t.rules) for (const c of r.classes) { set.add(c); all.add(c); }
    byTheme[name] = set;
  }
  return { all, byTheme };
}

// ───────────────────────── デックの解析 ─────────────────────────

/** frontmatter を YAML ライブラリ無しで読む（トップレベルのキーと、style: | のブロックだけ分かればよい） */
function parseFrontmatter(lines, offs, text) {
  const fm = { endLine: -1, theme: '', headerRaw: '', classRaw: '', style: null, styleInline: false };
  if (lines[0] === undefined || !/^---\s*$/.test(lines[0])) return fm;
  let end = 1;
  while (end < lines.length && !/^---\s*$/.test(lines[end])) end++;
  if (end >= lines.length) return fm;
  fm.endLine = end;
  for (let k = 1; k < end; k++) {
    const m = lines[k].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'theme') fm.theme = unquote(val);
    else if (key === 'header') fm.headerRaw = unquote(val);
    else if (key === 'class') {
      if (val && !/^\[/.test(val)) fm.classRaw = unquote(val);
      else if (/^\[/.test(val)) fm.classRaw = val.replace(/[\[\]"']/g, '').split(',').map((s) => s.trim()).filter(Boolean).join(' ');
      else { // 次行以降の `  - a` 形式
        const items = [];
        for (let j = k + 1; j < end; j++) { const li = lines[j].match(/^\s+-\s+(.*?)\s*$/); if (!li) break; items.push(unquote(li[1])); }
        fm.classRaw = items.join(' ');
      }
    } else if (key === 'style') {
      if (/^[|>][+-]?\d*$/.test(val)) {
        let j = k + 1;
        while (j < end && (lines[j].trim() === '' || /^\s/.test(lines[j]))) j++;
        // 末尾の空行はブロックに含めない（足すときに行が離れないように）
        let last = j;
        while (last > k + 1 && lines[last - 1].trim() === '') last--;
        const blk = lines.slice(k + 1, last);
        const indents = blk.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length);
        const indent = indents.length ? Math.min(...indents) : 2;
        fm.style = {
          keyLine: k, startLine: k + 1, endLine: last, indent,
          css: blk.map((l) => l.slice(Math.min(indent, l.length))).join('\n'),
          start: offs[k + 1] !== undefined ? offs[k + 1] : text.length,
          end: offs[last] !== undefined ? offs[last] : text.length,
        };
      } else if (val) fm.styleInline = true; // style: "…" の1行形式。追記先にはしない
    }
  }
  return fm;
}

/**
 * デックを読む。input は md のパス、または原稿の全文（opts.path で場所を教える。未保存の文書用）。
 * 戻り値：{ path, dir, text, lines, theme, headerRaw, globalClass, palette, styleBlocks, slides, frontmatter }
 *   styleBlocks[i] = { kind:'frontmatter'|'inline', scoped, css, start, end, slideIndex }
 *   slides[i]      = { index, startLine, endLine, sepLine, classes, title, marked, mark, from }
 *   palette は repoRoot を渡したときだけテーマ既定まで解決する（無ければ frontmatter の上書き分だけ）
 */
function parseDeck(input, opts) {
  opts = opts || {};
  let text, mdPath = opts.path || null;
  if (typeof input === 'string' && !/\n/.test(input) && /\.md$/i.test(input) && fs.existsSync(input)) {
    mdPath = path.resolve(input);
    text = fs.readFileSync(mdPath, 'utf8');
  } else text = String(input);
  const offs = lineOffsets(text);
  const sd = splitDeck(text);
  const lines = sd.lines;
  const fm = parseFrontmatter(lines, offs, text);

  const lineOf = (pos) => { let lo = 0, hi = offs.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offs[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const slideOfLine = (ln) => { let idx = 0; for (let n = 0; n < sd.starts.length; n++) { if (sd.starts[n] <= ln) idx = n; else break; } return idx; };

  const styleBlocks = [];
  if (fm.style) styleBlocks.push({ kind: 'frontmatter', scoped: false, css: fm.style.css, start: fm.style.start, end: fm.style.end, slideIndex: -1 });
  const bodyStart = fm.endLine >= 0 && offs[fm.endLine + 1] !== undefined ? offs[fm.endLine + 1] : 0;
  const body = text.slice(bodyStart);
  const masks = fenceRanges(body).concat(findComments(body).map((c) => [c.start, c.end]));
  const re = /<style(\s[^>]*)?>([\s\S]*?)<\/style\s*>/gi;
  let m;
  while ((m = re.exec(body))) {
    if (inRanges(masks, m.index)) continue;
    const cssStart = bodyStart + m.index + m[0].indexOf('>') + 1;
    styleBlocks.push({
      kind: 'inline', scoped: /\bscoped\b/i.test(m[1] || ''), css: m[2],
      start: cssStart, end: cssStart + m[2].length, slideIndex: slideOfLine(lineOf(bodyStart + m.index)),
    });
  }

  // 本文の <!-- class: x --> は、その位置以降のスライドのグローバル class になる（Marpit の仕様）
  const classAt = [];
  for (const c of findComments(body)) {
    const d = directiveLines(c.inner).find((x) => x.key === 'class');
    if (d) classAt.push({ slideIndex: slideOfLine(lineOf(bodyStart + c.start)), value: unquote(d.value) });
  }

  const slides = sd.slides.map((s) => {
    const meta = slideMeta(lines, s.startLine, s.endLine);
    const stext = lines.slice(s.startLine, s.endLine).join('\n');
    return { ...s, classes: meta.classes, title: meta.title, marked: meta.marked, mark: meta.marked ? parseMark(stext) : null, from: parseFrom(stext) };
  });

  const deck = {
    path: mdPath, dir: mdPath ? path.dirname(mdPath) : null, text, lines, offsets: offs,
    theme: fm.theme || 'default', headerRaw: fm.headerRaw, globalClass: fm.classRaw,
    styleBlocks, slides, frontmatter: fm, classAt,
  };
  deck.palette = effectivePalette(deck, opts.repoRoot || null, splitClasses(fm.classRaw));
  return deck;
}

const splitClasses = (s) => String(s || '').split(/\s+/).filter(Boolean);

/** そのスライドに効いているグローバル class（frontmatter の class → 本文の <!-- class: --> で上書き） */
function globalClassAt(deck, slideIndex) {
  let v = deck.globalClass || '';
  for (const c of deck.classAt) if (c.slideIndex <= slideIndex) v = c.value;
  return v;
}

function slideText(deck, slideIndex) {
  const s = deck.slides[slideIndex];
  if (!s) throw new Error(`スライド ${slideIndex + 1} がありません（全 ${deck.slides.length} 枚）`);
  return deck.lines.slice(s.startLine, s.endLine).join('\n');
}

function normHex(h) {
  let s = String(h || '').trim().toLowerCase();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(s)) return null;
  if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return s;
}

/**
 * 実効パレット 4 値。CSS の効き方の順に決める：
 *   テーマの :root ＜ デックの :root ＜ テーマの section.<class> ＜ デックの section / section.<class>
 * （section に直接書いた変数は :root からの継承より強い。部品テーマ（非同梱） の class: teal がこれ）
 * 値が hex でないとき（var() など）はそのまま文字列で返す。どこにも無ければ null。
 */
function effectivePalette(deck, repoRoot, classes) {
  const cls = new Set(classes || []);
  const sources = [];
  if (repoRoot) {
    const themes = loadThemes(repoRoot);
    for (const t of themeChain(themes, deck.theme)) sources.push(t.rules);
  }
  const deckRules = [];
  for (const b of deck.styleBlocks) if (!b.scoped) deckRules.push(...cssRules(b.css));
  sources.push(deckRules);

  const pal = {};
  for (const [name, cssVar] of PALETTE_VARS) {
    let best = null, bestLevel = -1;
    const re = new RegExp('(?:^|[;{\\s])' + cssVar.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+)');
    for (const rules of sources) {
      for (const r of rules) {
        if (r.atRule) continue;
        const mm = (';' + r.body).match(re);
        if (!mm) continue;
        let level = -1;
        for (const one of r.selector.split(',').map((s) => s.trim())) {
          if (one === ':root') level = Math.max(level, 0);
          else if (one === 'section') level = Math.max(level, 1);
          else { const sm = one.match(/^section((?:\.[\w-]+)+)$/); if (sm && sm[1].slice(1).split('.').every((c) => cls.has(c))) level = Math.max(level, 2); }
        }
        if (level >= 0 && level >= bestLevel) { bestLevel = level; best = mm[1].trim(); }
      }
    }
    pal[name] = best === null ? null : (normHex(best) ? best : best);
  }
  return pal;
}

// ───────────────────────── 素材の参照 ─────────────────────────

const REF_RES = [
  /((?:src|href|poster|data)\s*=\s*)(["'])([^"']+)\2/g,          // HTML 属性
  /(url\(\s*)(["']?)([^"')]+)\2(\s*\))/g,                        // CSS の url()
  /(!\[[^\]]*\]\()()([^)\s]+)/g,                                 // Markdown の画像（![bg](…) も）
];
// %23 は # の URL エンコード（data:image/svg+xml の中の fill='url(%23g)' など。素材ではなく SVG 内の参照）
const isLocalRef = (ref) => !/^([a-z][a-z0-9+.-]*:|\/\/|#|%23|\/)/i.test(ref) && ref.trim() !== '';

/** 相対参照を fn(ref, kind) の戻り値に置き換える（同じ値を返せばそのまま）。コメントとコードフェンスの中は触らない */
function mapRefs(text, fn) {
  const masks = fenceRanges(text).concat(findComments(text).map((c) => [c.start, c.end]));
  let out = text;
  REF_RES.forEach((re0, kind) => {
    const re = new RegExp(re0.source, 'g');
    // マスク判定は置換前の位置で行いたいので、対象を先に集めてから後ろから差し替える
    const cur = out;
    const curMasks = kind === 0 ? masks : fenceRanges(cur).concat(findComments(cur).map((c) => [c.start, c.end]));
    const hits = [];
    let m;
    while ((m = re.exec(cur))) {
      if (inRanges(curMasks, m.index)) continue;
      const ref = m[3];
      if (!isLocalRef(ref)) continue;
      const at = m.index + m[1].length + m[2].length;
      hits.push({ at, ref, attr: kind === 0 ? m[1].replace(/\s*=\s*$/, '').toLowerCase() : null });
    }
    for (const h of hits.reverse()) {
      const rep = fn(h.ref, h.attr);
      if (rep !== undefined && rep !== h.ref) out = out.slice(0, h.at) + rep + out.slice(h.at + h.ref.length);
    }
  });
  return out;
}

function listRefs(text) {
  const out = [];
  mapRefs(text, (ref, attr) => { out.push({ ref, attr }); return ref; });
  return out;
}

const stripQuery = (ref) => ref.replace(/[?#].*$/, '');
const toPosix = (p) => p.split(path.sep).join('/');
function sameFile(a, b) {
  try {
    const sa = fs.statSync(a), sb = fs.statSync(b);
    if (sa.size !== sb.size) return false;
    const h = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
    return h(a) === h(b);
  } catch (_) { return false; }
}

// ───────────────────────── スライドの依存（クラス・CSS・素材） ─────────────────────────

/** 断片が使うクラス（class 属性と _class）。コメント内の class="…" は数えない */
function classesUsed(fragment) {
  const out = new Set();
  const comments = findComments(fragment);
  for (const c of comments) for (const d of directiveLines(c.inner)) if (d.key === '_class' || d.key === 'class') splitClasses(unquote(d.value)).forEach((x) => out.add(x));
  let masked = fragment;
  for (const c of [...comments].reverse()) masked = masked.slice(0, c.start) + ' '.repeat(c.end - c.start) + masked.slice(c.end);
  const re = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(masked))) splitClasses(m[1] !== undefined ? m[1] : m[2]).forEach((x) => out.add(x));
  return out;
}

/** デック全体に効くルール（frontmatter の style と、本文の scoped でない <style>） */
function deckGlobalRules(deck) {
  const out = [];
  for (const b of deck.styleBlocks) if (!b.scoped) out.push(...cssRules(b.css));
  return out;
}

function fragmentDeps(deck, fragment, repoRoot, extraClasses) {
  const used = classesUsed(fragment);
  (extraClasses || []).forEach((c) => used.add(c));
  const tc = themeClasses(repoRoot);
  const inTheme = tc.byTheme[deck.theme] || new Set();
  const rulesAll = deckGlobalRules(deck);
  const defined = new Set();
  for (const r of rulesAll) for (const c of r.classes) defined.add(c);
  const deckClasses = [...used].filter((c) => !inTheme.has(c) && defined.has(c)).sort();
  const dcSet = new Set(deckClasses);
  let rules = rulesAll.filter((r) => r.classes.some((c) => dcSet.has(c)));
  // 運ぶルールが名前で参照している @keyframes も一緒に運ぶ
  const keyframes = rulesAll.filter((r) => /^@(-webkit-)?keyframes\s/i.test(r.selector));
  for (const kf of keyframes) {
    const nm = kf.selector.split(/\s+/)[1];
    if (nm && rules.some((r) => new RegExp('\\b' + nm.replace(/[-]/g, '\\-') + '\\b').test(r.body)) && !rules.includes(kf)) rules.push(kf);
  }
  // テーマのクラスを元デックが上書きしている分は運ばない（貼り付け先の流儀に従う）。知らせるために名前だけ拾う
  const themeOverrides = [...new Set(rulesAll.filter((r) => !rules.includes(r))
    .flatMap((r) => r.classes.filter((c) => used.has(c) && inTheme.has(c))))].sort();
  const assets = [];
  const seen = new Set();
  const push = (ref) => { const p = stripQuery(ref); if (!seen.has(p)) { seen.add(p); assets.push(p); } };
  for (const r of listRefs(fragment)) {
    // href はページへのリンクのことが多い。手元に実体があるときだけ素材として扱う
    if (r.attr === 'href' && !(deck.dir && fs.existsSync(path.resolve(deck.dir, stripQuery(r.ref))))) continue;
    push(r.ref);
  }
  for (const r of rules) for (const x of listRefs(r.body)) push(x.ref);
  const cssBytes = Buffer.byteLength(rules.map(ruleToCss).join('\n'), 'utf8');
  return { classes: [...used].sort(), deckClasses, rules, assets, cssBytes, themeOverrides };
}

/** スライド1枚の依存。{ classes, deckClasses, rules, assets, cssBytes } */
function slideDeps(deck, slideIndex, repoRoot) {
  const s = deck.slides[slideIndex];
  const extra = s && s.classes.length ? [] : splitClasses(globalClassAt(deck, slideIndex));
  return fragmentDeps(deck, slideText(deck, slideIndex), repoRoot, extra);
}

// ───────────────────────── 3.2 台帳 ─────────────────────────

const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SKIP_DIRS = new Set(['node_modules', 'out', '_library', '.git']);

function walkMd(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkMd(p, out); }
    else if (e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('_')) out.push(p);
  }
}

/**
 * slides/ を走査して台帳を作る（書き込みはしない。writeIndex が書く）。
 * 同じ id が2か所にあるときは、どちらも entries に残したうえで両方の場所を warnings に出す
 * （後勝ちで黙って片方を隠さない。findEntry は重複 id を拒否する）。
 */
function buildIndex(repoRoot, opts) {
  // opts.textOf(absPath)：ディスクより新しい内容（エディタで開いていて未保存の原稿）があれば返す。無ければ undefined
  const textOf = opts && typeof opts.textOf === 'function' ? opts.textOf : null;
  const files = [];
  for (const top of ['slides']) walkMd(path.join(repoRoot, top), files);
  files.sort();
  const entries = [];
  const warnings = [];
  for (const f of files) {
    let text;
    try {
      const live = textOf ? textOf(f) : undefined;
      text = typeof live === 'string' ? live : fs.readFileSync(f, 'utf8');
    } catch (_) { continue; }
    if (!text.includes(LIB_KEY + ':') || !/^---\r?\n[\s\S]*?\bmarp\s*:\s*true\b/.test(text.slice(0, 4096))) continue;
    const deck = parseDeck(text, { path: f, repoRoot });
    const relDeck = toPosix(path.relative(repoRoot, f));
    for (const lk of findLeakyMarks(text)) {
      warnings.push(`${relDeck}:${lk.line + 1} の ${lk.key} は発表者ノートに出ます（${lk.reason === 'alone' ? '_class などと同じコメントに入れてください' : '値をクォートしてください'}）`);
    }
    for (const s of deck.slides) {
      if (!s.mark) continue;
      // id はサムネイルのファイル名になる。手書きで ../ や空白や日本語が入った id は台帳に載せない（場所を知らせる）
      if (!VALID_ID.test(s.mark.id)) {
        warnings.push(`${relDeck} #${s.index + 1} の印の id「${s.mark.id}」は使えません（半角英数とハイフンだけにしてください）。台帳には載せません`);
        continue;
      }
      const deps = slideDeps(deck, s.index, repoRoot);
      const cls = s.classes.length ? s.classes : splitClasses(globalClassAt(deck, s.index));
      const thumbRel = `slides/_library/thumbs/${s.mark.id}.png`;
      entries.push({
        id: s.mark.id, tags: s.mark.tags, markedAt: s.mark.at,
        deck: relDeck, slide: s.index + 1, title: s.title,
        pattern: s.classes.find((c) => PATTERN_CLASSES.includes(c)) || s.classes[0] || '',
        theme: deck.theme, palette: effectivePalette(deck, repoRoot, cls),
        assets: deps.assets, deckClasses: deps.deckClasses, cssBytes: deps.cssBytes,
        thumb: fs.existsSync(path.join(repoRoot, thumbRel)) ? thumbRel : null,
      });
    }
  }
  const byId = new Map();
  for (const e of entries) { if (!byId.has(e.id)) byId.set(e.id, []); byId.get(e.id).push(e); }
  for (const [id, list] of byId) {
    if (list.length > 1) warnings.push(`id「${id}」が重複しています: ` + list.map((e) => `${e.deck} #${e.slide}`).join(' ／ '));
  }
  return { generatedAt: new Date().toISOString(), entries, warnings };
}

function indexPath(repoRoot) { return path.join(repoRoot, 'slides', '_library', 'index.json'); }

function writeIndex(repoRoot, index) {
  const p = indexPath(repoRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(index, null, 2) + '\n');
  return p;
}

function readIndex(repoRoot) {
  try { return JSON.parse(fs.readFileSync(indexPath(repoRoot), 'utf8')); } catch (_) { return null; }
}

/** id から台帳の 1 件を引く。重複 id は例外（どちらを貼るか決められない） */
function findEntry(index, id) {
  const hits = (index.entries || []).filter((e) => e.id === id);
  if (!hits.length) return null;
  if (hits.length > 1) throw new Error(`id「${id}」が ${hits.length} か所にあります: ` + hits.map((e) => `${e.deck} #${e.slide}`).join(' ／ '));
  return hits[0];
}

// ───────────────────────── 3.3 貼り付け先への適応 ─────────────────────────

/** var( … ) の範囲を集める（既に変数化されている hex を二重に包まないため） */
function varRanges(text) {
  const out = [];
  const re = /var\(/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 0, i = m.index + 3;
    for (; i < text.length; i++) { if (text[i] === '(') depth++; else if (text[i] === ')') { depth--; if (depth === 0) break; } }
    out.push([m.index, i + 1]);
  }
  return out;
}

/** HTML の開始タグの範囲と <style>…</style> の中身の範囲（色コードが「色として」効く場所） */
function markupRanges(text) {
  const out = [];
  let m;
  const tagRe = /<[A-Za-z][\w:-]*(?:"[^"]*"|'[^']*'|[^'">])*>/g;
  while ((m = tagRe.exec(text))) out.push([m.index, m.index + m[0].length]);
  const styleRe = /<style(?:\s[^>]*)?>([\s\S]*?)<\/style\s*>/gi;
  while ((m = styleRe.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * 元パレットと完全一致する hex（大文字小文字・3桁/6桁は同一視）だけを var(--x, #元) にする。
 * 触らないもの：地の文（タグの外）、var( の中、コメント、コードフェンス、&#123; の数値参照、URL の #フラグメント、:root などの変数定義そのもの。
 */
function replacePaletteColors(text, map, opts) {
  if (!map.size) return { text, count: 0 };
  const masks = varRanges(text);
  const css = !!(opts && opts.css);
  if (!css) masks.push(...fenceRanges(text), ...findComments(text).map((c) => [c.start, c.end]));
  // 本文では「タグの中（属性値）」と「<style> の中身」だけを対象にする。
  // 地の文や見出しに書かれた色コード（「既定の赤は #A6192E」）を var(…) にすると、その文字列がそのままスライドに出てしまう。
  const allowed = css ? null : markupRanges(text);
  let count = 0;
  const out = text.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F\w-])/g, (hit, _h, pos) => {
    const prev = pos > 0 ? text[pos - 1] : ' ';
    if (!/[\s:"',(=]/.test(prev)) return hit;          // &#123; や page.html#abc など
    if (inRanges(masks, pos)) return hit;
    if (allowed && !inRanges(allowed, pos)) return hit;
    const v = map.get(normHex(hit));
    if (!v) return hit;
    // `--accent: #C8611C` のような変数定義の右辺は置き換えない（自分自身を参照してしまう）
    if (/--[\w-]+\s*:\s*$/.test(text.slice(Math.max(0, pos - 40), pos))) return hit;
    count++;
    return `var(${v}, ${hit})`;
  });
  return { text: out, count };
}

/** 断片の中の _class 行の値を書き換える（fn(トークン配列) → トークン配列） */
function mapClassDirectives(fragment, fn) {
  let out = fragment;
  for (const c of findComments(fragment).reverse()) {
    const ds = directiveLines(c.inner).filter((d) => d.key === '_class');
    if (!ds.length) continue;
    const lines = c.inner.split('\n');
    let changed = false;
    for (const d of ds) {
      const before = splitClasses(unquote(d.value));
      const after = fn(before);
      if (after.join(' ') === before.join(' ')) continue;
      lines[d.lineIdx] = lines[d.lineIdx].replace(/(_class\s*:)\s*.*$/, `$1 ${after.join(' ')}`).trimEnd();
      changed = true;
    }
    if (changed) out = out.slice(0, c.start) + '<!--' + lines.join('\n') + '-->' + out.slice(c.end);
  }
  return out;
}

/** スライドを afterIndex 番目（0-based。-1 で先頭）の後ろに入れる編集。区切り --- と前後の空行を保つ */
function insertSlideEdit(destText, afterIndex, slideBody) {
  const sd = splitDeck(destText);
  const offs = lineOffsets(destText);
  const n = sd.slides.length;
  const body = slideBody.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '');
  let edit;
  if (afterIndex < -1 || afterIndex >= n) throw new Error(`--after は 0〜${n} で指定してください（全 ${n} 枚）`);
  if (afterIndex === -1) {
    const at = offs[sd.slides[0].startLine] !== undefined ? offs[sd.slides[0].startLine] : destText.length;
    edit = { start: at, end: at, text: '\n' + body + '\n\n---\n' };
  } else if (afterIndex < n - 1) {
    // 次のスライドの区切り行の頭に入れる。元の --- が区切りとして有効だった位置なので、新しい --- も有効
    const at = offs[sd.slides[afterIndex + 1].sepLine];
    edit = { start: at, end: at, text: '---\n\n' + body + '\n\n' };
  } else {
    const tail = /\n[ \t]*\n$/.test(destText) || destText === '' ? '' : (/\n$/.test(destText) ? '\n' : '\n\n');
    edit = { start: destText.length, end: destText.length, text: tail + '---\n\n' + body + '\n' };
  }
  // 検算：枚数がちょうど 1 増えること（増えなければページ分割が壊れている）
  const after = slideStartLines(applyEdits(destText, [edit])).length;
  const inner = slideStartLines('---\nmarp: true\n---\n\n' + body + '\n').length;
  if (after !== n + inner) throw new Error(`挿入後の枚数が合いません（${n} → ${after}、期待 ${n + inner}）`);
  return edit;
}

/** frontmatter の style: | の末尾に CSS を足す編集（無ければ style: | を作る）。作れない形なら null */
function styleAppendEdit(dest, cssLines) {
  const fm = dest.frontmatter;
  if (fm.endLine < 0 || fm.styleInline) return null;
  if (fm.style) {
    const pad = ' '.repeat(fm.style.indent);
    const text = cssLines.map((l) => (l ? pad + l : '')).join('\n') + '\n';
    return { start: fm.style.end, end: fm.style.end, text };
  }
  const at = dest.offsets[fm.endLine];
  return { start: at, end: at, text: 'style: |\n' + cssLines.map((l) => (l ? '  ' + l : '')).join('\n') + '\n' };
}

// ───────────────────────── 7.2 元の組版を保つ（keepTypo） ─────────────────────────
//
// テーマをまたいで入れたスライドが縦に伸びる原因は、実測（推敲済みデックほか 26 枚を派生テーマ / 部品テーマ（非同梱） の新規デックへ）で
// 次の差に絞れた：本文の行送り（1.55 → 1.7）、字間（0.01em → 0.05em。折り返しが増える）、
// p / ul / li の下の余白（12px・4px → .85em・.45em）、囲み部品（callout-* / box-* / sec-box）の行送りと上下の余白、
// h2 / h3 の大きさと余白、表の文字サイズとセルの上下の余白、行長の上限（--measure）、本文サイズ（部品テーマ（非同梱） 25px）。
// どれも「縦の寸法」なので、元テーマと貼り付け先テーマの CSS を同じセレクタどうしで見比べ、縦に効く宣言だけを
// 元の値に戻すルールを、そのスライドの <style scoped> に入れる。色・枠・横方向の余白・箇条書きの記号・
// ヘッダー・フッタ・page-title・takeaway の帯は貼り付け先のまま。ブラウザは使わない（値はテーマ CSS から静的に決める）。

/**
 * 「元の組版を保つ」の効果を実測で確かめたテーマの組み合わせ（元→先）。ここに在る組み合わせだけ、選んでいないときに勧める。
 */
const KT_PROVEN = new Set(['academic→sub-academic']);
const KT_HINT = '「元の組版を保つ」を選ぶと収まりやすい組み合わせです（行送り・字間・段落と囲みの上下の余白を、このスライドだけ元テーマの値に戻します。挿入ギャラリーの下のチェック）';

const KT_START = '/* ss-keep-typo:start';
const KT_END = '/* ss-keep-typo:end */';
/** 縦の寸法に効く宣言だけを扱う。値が無いときの戻し先：inherit＝継承する性質、それ以外は初期値 */
const KT_PROPS = {
  'font-size': 'inherit', 'line-height': 'inherit', 'letter-spacing': 'inherit',
  'margin-top': '0', 'margin-bottom': '0', 'padding-top': '0', 'padding-bottom': '0',
  'max-width': 'none', 'min-height': 'auto', // min-height の初期値は auto（flex の子を 0 にすると、あふれたとき見出しが潰れて本文が乗る＝実測）
};
/** 貼り付け先の枠に属するもの（ここには手を出さない） */
const KT_FRAME = /(^|[\s>+~,(])(header|footer)\b|\.page-title|\.takeaway|\.hdr-|::?(before|after)|:root|\.chapter-num/;

/**
 * Marp 同梱テーマのうち、縦の寸法に効く地のルール（theme/*.css が @import "default" しているときの土台）。
 * academic は見出しの行送りを書いていないので default の 1.25 が効いている（実測：.sec-box h3 22px → 27.5px）。
 * これを知らないと「元は inherit＝1.55」と見なして、見出し 1 つにつき 6〜7px 縦に伸ばしてしまう。
 */
const KT_BUILTIN = {
  default: 'section h1,section h2,section h3,section h4,section h5,section h6{line-height:1.25}section li+li{margin-top:.25em}',
};
function ktBuiltinRules(chain) {
  const out = [];
  const seen = new Set();
  for (const t of chain) for (const imp of t.imports || []) {
    if (KT_BUILTIN[imp] && !seen.has(imp)) { seen.add(imp); out.push(...cssRules(KT_BUILTIN[imp])); }
  }
  return out;
}

/** 括弧と引用符の外で区切る */
function splitOutside(s, sepRe) {
  const out = [];
  let depth = 0, q = '', cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === '\\') { cur += s[++i] || ''; } else if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (!depth && sepRe.test(ch)) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** 宣言ブロック → [{ prop, value, important }]。margin / padding は上下だけを取り出す */
function ktDecls(body) {
  const out = [];
  for (const d of splitOutside(body, /;/)) {
    const i = d.indexOf(':');
    if (i < 0) continue;
    const prop = d.slice(0, i).trim().toLowerCase();
    let value = d.slice(i + 1).trim();
    if (!prop || !value) continue;
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    if (prop.startsWith('--')) { out.push({ prop, value, important }); continue; }
    if (prop === 'margin' || prop === 'padding') {
      const v = splitOutside(value, /\s/).filter(Boolean);
      if (!v.length || v.length > 4) continue;
      out.push({ prop: prop + '-top', value: v[0], important });
      out.push({ prop: prop + '-bottom', value: v.length >= 3 ? v[2] : v[0], important });
    } else if (prop in KT_PROPS) out.push({ prop, value, important });
  }
  return out;
}

/** セレクタの中のクラス名が無い＝要素だけのセレクタか */
const ktElementOnly = (sel) => classesOfSelector(sel).length === 0 && !/[#\[]/.test(sel);
/** `section li`・`section ul > li` のような素直な形のとき、その要素名（元テーマに同じセレクタが無いときの引き当てに使う） */
function ktPlainTag(sel) {
  const m = /^(?:section\s+)?(?:(?:ul|ol)\s*>\s*)?([a-z][a-z0-9]*)$/.exec(sel);
  return m ? m[1] : null;
}
/** 末尾の要素名（`section * + h3` → h3、`section p:last-child` → p） */
function ktLastTag(sel) {
  const m = /(?:^|[\s>+~])([a-z][a-z0-9]*)(?::[a-z-]+(?:\([^)]*\))?)*$/.exec(sel);
  return m ? m[1] : null;
}

/**
 * ルールの列 → { bySel: Map<セレクタ, Map<prop,{value,important}>>, byTag: Map<要素名, Map<…>>, vars: Set<--名前> }
 * 後ろのルールが勝つ（テーマの @import 順 → デックの style の順に渡すこと）。@media などの中は見ない。
 */
function ktTable(rules) {
  const bySel = new Map(), byTag = new Map(), vars = new Set();
  for (const r of rules) {
    if (r.atRule || r.selector.startsWith('@')) continue;
    const decls = ktDecls(r.body);
    for (const d of decls) if (d.prop.startsWith('--')) vars.add(d.prop);
    const typo = decls.filter((d) => !d.prop.startsWith('--'));
    if (!typo.length) continue;
    for (const part of splitOutside(r.selector, /,/)) {
      const sel = normSelector(part);
      if (!sel) continue;
      const put = (map, key) => {
        if (!map.has(key)) map.set(key, new Map());
        for (const d of typo) { const cur = map.get(key).get(d.prop); if (!cur || !cur.important || d.important) map.get(key).set(d.prop, { value: d.value, important: d.important }); }
      };
      put(bySel, sel);
      const tag = ktPlainTag(sel);
      if (tag) put(byTag, tag === 'section' ? 'section' : tag);
    }
  }
  return { bySel, byTag, vars };
}

/** scoped に書くセレクタ。要素だけのセレクタは :where() で包み、デック固有のクラス付きルールより弱くする */
function ktScopedSelector(sel) {
  if (sel === 'section') return 'section';
  if (!ktElementOnly(sel)) return sel;
  const m = /^section((?:[.:][^\s>+~]+)*)\s*([>+~]?)\s*(.+)$/.exec(sel);
  if (m) return `section${m[1]} ${m[2] ? m[2] + ' ' : ''}:where(${m[3]})`;
  return `:where(${sel})`;
}

/**
 * 元の組版へ戻す CSS の行（無ければ []）と、できなかった理由。
 *   srcRules / destRules … テーマの連鎖（土台が先）＋デックの「要素だけのセレクタ」のルール
 *   used … そのスライドで効くクラス（class 属性・_class・グローバル class）
 *   tags … そのスライドに出てくる要素名（省けば絞らない）
 *   srcClasses … 元テーマが持つクラス（省けば絞らない）
 *   deckRules … 一緒に運ぶデック固有のルール（元の組版より強く効かせ直す）
 */
function keepTypoLines(srcRules, destRules, used, tags, srcClasses, deckRules) {
  const S = ktTable(srcRules), D = ktTable(destRules);
  const lines = [];
  const usedSet = new Set(used);
  const varOk = (v) => { const re = /var\(\s*(--[A-Za-z0-9_-]+)/g; let m; while ((m = re.exec(v))) if (!D.vars.has(m[1])) return false; return true; };
  const bySelector = new Map(); // 出力セレクタ → [宣言]
  const emit = (sel, prop, val, important) => {
    const key = ktScopedSelector(sel);
    if (!bySelector.has(key)) bySelector.set(key, new Map());
    bySelector.get(key).set(prop, val + (important ? ' !important' : ''));
  };
  // スライドの題（h1 / h2 の地のルール）は貼り付け先の枠の一部（tsutawaru は「常に同じ位置・同じ大きさ」が決まり）。
  // 型つきの題（section.message h1 など）は本文なので扱う
  const isTitle = (sel) => ktElementOnly(sel) && /^h[12]$/.test(ktLastTag(sel) || '');
  // クラスつきのセレクタは、そのクラスが元テーマの部品のときだけ（元デックが自前で定義したクラスは、元の値をテーマから決められない。
  // 例：デックの .attr 15px を、貼り付け先テーマの .attr 19px から inherit＝23px に「戻して」しまう＝実測）
  const known = (sel) => !srcClasses || classesOfSelector(sel).every((c) => srcClasses.has(c));
  const relevant = (sel) => !KT_FRAME.test(sel) && !isTitle(sel) && known(sel) && classesOfSelector(sel).every((c) => usedSet.has(c))
    && (!tags || ktTagsOfSelector(sel).every((t) => tags.has(t)));
  // 行長の上限は変数 1 つで外せる（貼り付け先のテーマだけが持っているとき）
  const measureOnly = D.vars.has('--measure') && !S.vars.has('--measure');
  if (measureOnly) emit('section', '--measure', 'none', false);

  const sels = new Set([...D.bySel.keys(), ...S.bySel.keys()]);
  for (const sel of sels) {
    if (!relevant(sel)) continue;
    const d = D.bySel.get(sel) || new Map();
    const s = S.bySel.get(sel) || new Map();
    const elementOnly = ktElementOnly(sel);
    const tag = elementOnly ? (sel === 'section' ? 'section' : ktLastTag(sel)) : null;
    for (const prop of Object.keys(KT_PROPS)) {
      // スライドの枠（section の上下の余白）は貼り付け先のもの
      if (sel === 'section' && /^padding|^margin|^min-height|^max-width/.test(prop)) continue;
      const dv = d.get(prop);
      let sv = s.get(prop);
      if (!dv && !sv) continue;
      if (dv && measureOnly && prop === 'max-width' && /var\(\s*--measure\b/.test(dv.value)) continue;
      if (!sv && dv) {
        // 元テーマに同じセレクタが無い。要素だけのセレクタなら、その要素の素直なルール（section li など）から引き当てる
        const viaTag = elementOnly && tag && S.byTag.get(tag) && S.byTag.get(tag).get(prop);
        if (viaTag) sv = viaTag;
        else if (elementOnly || KT_PROPS[prop] === 'inherit') sv = { value: KT_PROPS[prop], important: false };
        else continue; // 部品の余白で、元の値が分からない → 触らない
      }
      if (sv && !dv) {
        // 貼り付け先のテーマに同じセレクタが無い。要素の素直なルールが同じ値を出すなら何もしない
        const viaTag = elementOnly && tag && D.byTag.get(tag) && D.byTag.get(tag).get(prop);
        if (viaTag && squash(viaTag.value) === squash(sv.value)) continue;
      }
      if (dv && squash(dv.value) === squash(sv.value)) continue;
      if (!varOk(sv.value)) continue;
      emit(sel, prop, sv.value, !!(dv && dv.important));
    }
  }
  for (const [sel, decls] of bySelector) lines.push(`${sel} { ${[...decls].map(([k, v]) => `${k}: ${v};`).join(' ')} }`);
  // 運んだデック固有のルール（section.feat3 .sec-box { padding: 8px 22px } など）は、上で戻したテーマの値と詳細度が並ぶと
  // 後ろに書いた方＝こちらが勝ってしまう（実測：sec-box 3 つで 24px 縦に伸びた）。同じ部品に触るものだけ、縦の寸法を後ろで効かせ直す
  const touched = new Set();
  for (const sel of bySelector.keys()) if (!/:where\(/.test(sel)) classesOfSelector(sel).forEach((c) => touched.add(c));
  if (lines.length && touched.size) {
    for (const r of deckRules || []) {
      if (r.atRule || r.selector.startsWith('@') || !r.classes.some((c) => touched.has(c))) continue;
      const decls = ktDecls(r.body).filter((d) => !d.prop.startsWith('--'));
      if (decls.length) lines.push(`${squash(r.selector)} { ${decls.map((d) => `${d.prop}: ${d.value}${d.important ? ' !important' : ''};`).join(' ')} }`);
    }
  }
  return lines;
}

/** 断片に出てくる要素名（HTML のタグと、Markdown の記法から分かるもの）。使っていない要素のルールは持ち込まない */
function ktTagsUsed(fragment) {
  const tags = new Set(['section', 'p']);
  let masked = fragment;
  for (const c of [...findComments(fragment)].reverse()) masked = masked.slice(0, c.start) + ' '.repeat(c.end - c.start) + masked.slice(c.end);
  const re = /<([a-zA-Z][a-zA-Z0-9]*)\b/g;
  let m;
  while ((m = re.exec(masked))) tags.add(m[1].toLowerCase());
  const md = masked.replace(/<svg[\s\S]*?<\/svg\s*>/gi, '');
  for (let i = 1; i <= 6; i++) if (new RegExp(`^ {0,3}#{${i}}\\s`, 'm').test(md)) tags.add('h' + i);
  if (/^\s*[-*+]\s+\S/m.test(md)) tags.add('ul');
  if (/^\s*\d+[.)]\s+\S/m.test(md)) tags.add('ol');
  if (/^\s*\|.*\|\s*$/m.test(md)) tags.add('table');
  if (/^ {0,3}>\s?\S/m.test(md)) tags.add('blockquote');
  if (/^ {0,3}(```|~~~)/m.test(md)) { tags.add('pre'); tags.add('code'); }
  if (/`[^`\n]+`/.test(md)) tags.add('code');
  if (/!\[[^\]]*\]\(/.test(md)) { tags.add('img'); tags.add('figure'); tags.add('figcaption'); }
  if (/\*\*[^*\n]+\*\*|__[^_\n]+__/.test(md)) tags.add('strong');
  if (/(^|[^*])\*[^*\s][^*\n]*\*|(^|\W)_[^_\s][^_\n]*_/.test(md)) tags.add('em');
  if (/\[[^\]]+\]\(/.test(md)) tags.add('a');
  if (tags.has('ul') || tags.has('ol')) tags.add('li');
  if (tags.has('table')) ['thead', 'tbody', 'tr', 'th', 'td'].forEach((t) => tags.add(t));
  return tags;
}

/** セレクタに出てくる要素名 */
function ktTagsOfSelector(sel) {
  const out = [];
  const bare = sel.replace(/\[[^\]]*\]/g, ' ').replace(/::?[a-z-]+(\([^)]*\))?/gi, ' ').replace(/[.#][A-Za-z0-9_-]+/g, ' ');
  const re = /(?:^|[\s>+~,(])([a-z][a-z0-9]*)/gi;
  let m;
  while ((m = re.exec(bare))) out.push(m[1].toLowerCase());
  return out;
}

/** 横の余白だけを決める補助クラス（.pip-safe など）か。貼り付け先のテーマに無くても形は崩れない */
function ktHarmlessClass(cls, rules) {
  const mine = rules.filter((r) => r.classes.includes(cls));
  return mine.length > 0 && mine.every((r) => splitOutside(r.body, /;/).every((d) => !d.trim() || /^\s*margin-(left|right)\s*:/i.test(d)));
}

/**
 * デックの style のうち、そのデックの地の組版を決めているルール：
 *   要素だけのセレクタ（section / section h2 など）と、テーマの部品だけを指すセレクタ（.callout-gray / section.split .left など。
 *   デックがテーマの部品を調整した分。adaptFragment はこの調整を運ばないので、縦の寸法だけここで拾う）。
 */
function ktDeckBaseRules(deck, themeSet) {
  return deckGlobalRules(deck).filter((r) => !r.atRule && !r.selector.startsWith('@')
    && splitOutside(r.selector, /,/).every((p) => {
      const sel = normSelector(p);
      if (ktElementOnly(sel)) return /^section\b/.test(sel);
      return !!themeSet && !/[#\[]/.test(sel) && classesOfSelector(sel).every((c) => themeSet.has(c));
    }));
}

/** 断片に残っている keepTypo の塊（以前の挿入で入れたもの）を外し、元のテーマ名を返す */
function stripKeepTypo(text) {
  let origin = null;
  const re = /[ \t]*\/\* ss-keep-typo:start ([^\s*]+)[^*]*\*\/[\s\S]*?\/\* ss-keep-typo:end \*\/[ \t]*\n?/g;
  let out = text.replace(re, (_, o) => { origin = o; return ''; });
  // 中身が空になった <style scoped> は消す
  out = out.replace(/\n*<style\s+scoped\s*>\s*<\/style\s*>[ \t]*\n?/gi, '\n');
  return { text: out, origin };
}

/** keepTypo の行を、そのスライドの <style scoped> に入れる（既にあれば同じブロックの末尾へ） */
function mergeScopedLines(text, lines) {
  const re = /<style\s+scoped\s*>[\s\S]*?(<\/style\s*>)/gi;
  let last = null, m;
  while ((m = re.exec(text))) last = { end: m.index + m[0].length - m[1].length };
  const block = lines.join('\n') + '\n';
  if (last) {
    const head = text.slice(0, last.end);
    return head + (/\n$/.test(head) ? '' : '\n') + block + text.slice(last.end);
  }
  return text.replace(/\s+$/, '') + '\n\n<style scoped>\n' + block + '</style>\n';
}

/**
 * keepTypo の計画。{ lines, reason }（reason は「何もしなかった理由」。lines が空で reason も null なら差が無い）
 *   originTheme … 断片が以前の keepTypo で覚えている元テーマ（あれば src.theme より優先）
 */
function planKeepTypo(src, dest, used, repoRoot, originTheme, tags, deckRules) {
  const themes = loadThemes(repoRoot);
  const srcName = originTheme || src.theme;
  const srcChain = themeChain(themes, srcName), destChain = themeChain(themes, dest.theme);
  if (!srcChain.length) return { lines: [], reason: `元のテーマ（${srcName}）が theme/ に無いので、元の組版は分かりません` };
  if (!destChain.length) return { lines: [], reason: `貼り付け先のテーマ（${dest.theme}）が theme/ に無いので、組版の差は分かりません` };
  const tc = themeClasses(repoRoot);
  const srcSet = tc.byTheme[srcName] || new Set(), destSet = tc.byTheme[dest.theme] || new Set();
  const srcThemeRules = srcChain.flatMap((t) => t.rules);
  const missing = [...used].filter((c) => srcSet.has(c) && !destSet.has(c) && !ktHarmlessClass(c, srcThemeRules)).sort();
  if (missing.length) {
    return { lines: [], reason: `貼り付け先のテーマ（${dest.theme}）に部品 ${missing.map((c) => '.' + c).join(' ')} が無いので、組版だけ戻しても形は戻りません（元の組版は持ち込みません）` };
  }
  const srcRules = ktBuiltinRules(srcChain).concat(srcThemeRules, originTheme ? [] : ktDeckBaseRules(src, srcSet));
  const destRules = ktBuiltinRules(destChain).concat(destChain.flatMap((t) => t.rules), ktDeckBaseRules(dest, destSet));
  return { lines: keepTypoLines(srcRules, destRules, used, tags, srcSet, deckRules), reason: null, from: srcName };
}

/**
 * 断片（スライド1枚、または貼り付けられた任意の範囲）を貼り付け先に合わせる。DESIGN.md 3.3 の 1〜6。
 * ファイルには触らない。計画だけ返す。
 */
function adaptFragment(fragment, src, dest, opts) {
  opts = opts || {};
  const repoRoot = opts.repoRoot;
  const warnings = [];
  const srcIdx = Number.isInteger(opts.srcSlideIndex) ? opts.srcSlideIndex : 0;
  const srcGlobal = splitClasses(globalClassAt(src, srcIdx));
  // 貼り付け先で効いているグローバル class は「入る位置」で決まる（destSlideIndex は、挿入の編集は要らず位置だけ教えたいとき用）
  const destAt = Number.isInteger(opts.destSlideIndex) ? opts.destSlideIndex : opts.afterIndex;
  const destGlobal = splitClasses(Number.isInteger(destAt) && destAt >= 0 ? globalClassAt(dest, destAt) : dest.globalClass);
  // 中では LF で組み立て、最後に貼り付け先の改行コードへ揃える（CRLF の原稿に LF を混ぜない。その逆も）
  fragment = String(fragment).replace(/\r\n/g, '\n');
  const destEol = eolOf(dest.text);
  let text = fragment;

  // 6. 印：コピーに同じ id を残さない。出自だけ _from に残す
  const mark = parseMark(text);
  text = removeMark(text);
  const fromId = opts.id || (mark && mark.id) || null;
  if (fromId) text = setDirective(text, FROM_KEY, yamlScalar(fromId), destGlobal.join(' '));

  // 依存は「元の」断片から拾う（_class の書き換え前）
  const hasClassDirective = findComments(fragment).some((c) => directiveLines(c.inner).some((d) => d.key === '_class'));
  const deps = fragmentDeps(src, fragment, repoRoot, hasClassDirective ? [] : srcGlobal);

  // 1. の補足：_class はグローバル class を「置き換える」。貼り付け先が class: teal のような配色プリセットを
  //    グローバルに持つとき、_class 付きのスライドだけ既定色に戻ってしまうので、貼り付け先のグローバル class を足す。
  //    元デックのグローバル class（配色）を _class に持ち込んでいたら外す。
  if (!opts.keepColors) {
    const before = text;
    text = mapClassDirectives(text, (toks) => {
      if (!toks.length && !destGlobal.length) return toks;
      let t = toks.filter((c) => !(srcGlobal.includes(c) && !destGlobal.includes(c)));
      for (const g of destGlobal) if (!t.includes(g)) t.push(g);
      return t;
    });
    if (text !== before) warnings.push(`_class を貼り付け先のグローバル class（${destGlobal.join(' ') || 'なし'}）に合わせました`);
  }

  // 4. 色（元と先のパレットが同じなら何もしない）
  const srcCls = hasClassDirective ? [...classesUsed(fragment)] : srcGlobal;
  const srcPal = effectivePalette(src, repoRoot, srcCls);
  const destPal = effectivePalette(dest, repoRoot, destGlobal);
  const colorMap = new Map();
  const samePalette = PALETTE_VARS.every(([k]) => (normHex(srcPal[k]) || srcPal[k]) === (normHex(destPal[k]) || destPal[k]));
  if (!opts.keepColors && !samePalette) {
    for (const [k, cssVar] of PALETTE_VARS) { const h = normHex(srcPal[k]); if (h && !colorMap.has(h)) colorMap.set(h, cssVar); }
  }
  const recolor = (s, css) => replacePaletteColors(s, colorMap, { css });
  let colorCount = 0;
  { const r = recolor(text, false); text = r.text; colorCount += r.count; }

  // 3. デック固有 CSS
  // 断片が自分で持っている <style>（scoped かどうかに関わらず本文と一緒に運ばれる）と同じルール、
  // 元デックの中で重複して書かれているルールは、二重に運ばない
  const ownSigs = new Set();
  { const re = /<style(?:\s[^>]*)?>([\s\S]*?)<\/style\s*>/gi; let sm; while ((sm = re.exec(fragment))) for (const r of cssRules(sm[1])) ownSigs.add(r.signature); }
  const seenSig = new Set();
  const carryRules = deps.rules.filter((r) => {
    if (ownSigs.has(r.signature) || seenSig.has(r.signature)) return false;
    seenSig.add(r.signature);
    return true;
  });
  const carried = carryRules.map((r) => {
    const rc = recolor(r.body, true);
    colorCount += rc.count;
    return { ...r, body: rc.text, signature: signatureOf(r.selector, rc.text, r.atRule), rawSignature: r.signature };
  });

  // 2. 素材（本文と、運ぶ CSS の url() の両方）
  const assetCopies = [];
  const planned = new Map(); // to → from（同じ計画の中での同名衝突を避ける）
  const refCache = new Map();
  const sameDir = src.dir && dest.dir && path.resolve(src.dir) === path.resolve(dest.dir);
  const remap = (ref, attr) => {
    if (!src.dir || !dest.dir || sameDir) return ref;
    const clean = stripQuery(ref);
    const suffix = ref.slice(clean.length);
    if (refCache.has(clean)) return refCache.get(clean) + suffix;
    const abs = path.resolve(src.dir, clean);
    const exists = fs.existsSync(abs) && fs.statSync(abs).isFile();
    if (attr === 'href' && !exists) return ref; // ページへのリンクなど
    let outRef;
    const insideDeck = abs.startsWith(path.resolve(src.dir) + path.sep);
    if (!insideDeck) {
      // ../assets/… など共有素材：コピーせず、デックの深さの差だけ相対パスを直す
      outRef = toPosix(path.relative(dest.dir, abs));
      if (!outRef.startsWith('.')) outRef = './' + outRef;
      if (!exists) warnings.push(`素材が見つかりません: ${clean}`);
    } else if (!exists) {
      warnings.push(`素材が見つかりません（コピーしません）: ${clean}`);
      outRef = clean;
    } else {
      const srcSrc = path.join(path.resolve(src.dir), 'src') + path.sep;
      const sub = abs.startsWith(srcSrc) ? abs.slice(srcSrc.length) : path.basename(abs);
      const ext = path.extname(sub);
      const stem = sub.slice(0, sub.length - ext.length);
      let cand = sub;
      for (let n = 2; ; n++) {
        const to = path.join(dest.dir, 'src', cand);
        const plannedFrom = planned.get(to);
        if (plannedFrom === abs) break;                                   // この計画で既にコピー予定
        if (plannedFrom === undefined && !fs.existsSync(to)) { planned.set(to, abs); assetCopies.push({ from: abs, to }); break; }
        if (plannedFrom === undefined && sameFile(abs, to)) break;        // 同名・同内容 → そのまま使う
        cand = `${stem}-${n}${ext}`;                                      // 同名・別内容 → -2, -3 …
      }
      outRef = './src/' + toPosix(cand);
      if (cand !== sub) warnings.push(`同名で中身の違う素材があったので ${toPosix(cand)} として入れます（元: ${clean}）`);
    }
    refCache.set(clean, outRef);
    return outRef + suffix;
  };
  text = mapRefs(text, remap);
  for (const r of carried) {
    const nb = mapRefs(r.body, remap);
    if (nb !== r.body) { r.body = nb; r.signature = signatureOf(r.selector, nb, r.atRule); }
  }

  // 貼り付け先に同じ署名のルールがあれば省く。同名で中身が違うクラスは scoped へ
  const destRules = deckGlobalRules(dest);
  const destSigs = new Set(destRules.map((r) => r.signature));
  const srcAll = deckGlobalRules(src);
  const srcSigs = new Set(srcAll.map((r) => r.signature));
  for (const r of srcAll) { const rc = recolor(r.body, true); srcSigs.add(signatureOf(r.selector, rc.text, r.atRule)); }
  for (const r of carried) srcSigs.add(r.signature);
  const destTheme = themeClasses(repoRoot).byTheme[dest.theme] || new Set();
  const conflict = new Set();
  for (const c of deps.deckClasses) {
    if (destTheme.has(c)) { conflict.add(c); continue; }
    // 貼り付け先がそのクラスについて「元デックに無い中身」を持っていれば、同名・別物
    if (destRules.some((r) => r.classes.includes(c) && !srcSigs.has(r.signature))) conflict.add(c);
  }
  const need = carried.filter((r) => !destSigs.has(r.signature));
  let scoped = need.filter((r) => r.classes.some((c) => conflict.has(c)));
  let global = need.filter((r) => !scoped.includes(r));
  const destEdits = [];
  if (global.length) {
    const label = fromId ? `ライブラリ ${fromId}` : '貼り付けたスライド';
    const srcName = src.path ? path.basename(src.path, '.md') : '';
    const e = styleAppendEdit(dest, [`/* ── ${label} の部品${srcName ? '（元: ' + srcName + '）' : ''} ── */`, ...global.map(ruleToCss)]);
    if (e) destEdits.push(e);
    else { scoped = need; global = []; warnings.push('貼り付け先の frontmatter に style: | を足せない形だったので、CSS はスライド内の <style scoped> に入れました'); }
  }
  if (scoped.length) {
    text = text.replace(/\s+$/, '') + '\n\n<style scoped>\n' + scoped.map(ruleToCss).join('\n') + '\n</style>\n';
    const names = [...conflict].filter((c) => scoped.some((r) => r.classes.includes(c)));
    if (names.length) warnings.push(`貼り付け先に同名で中身の違うクラスがあります（${names.map((c) => '.' + c).join(' ')}）。このスライドだけに効く <style scoped> に入れました`);
  }

  // 7.2 元の組版を保つ（選んだときだけ。選ばなければ本文には 1 バイトも触らない）
  let typo = null;
  if (opts.keepTypo) {
    const st = stripKeepTypo(text);
    const usedNow = new Set([...deps.classes, ...destGlobal, ...classesUsed(st.text)]);
    typo = planKeepTypo(src, dest, usedNow, repoRoot, st.origin, ktTagsUsed(st.text), st.origin ? [] : carried);
    if (typo.lines.length) {
      text = mergeScopedLines(st.text, [`${KT_START} ${typo.from} → ${dest.theme}（元の組版を保つ。縦の寸法だけ。消せば貼り付け先の組版になる） */`, ...typo.lines, KT_END]);
    } else if (st.origin && !typo.reason) {
      text = st.text; // 以前の持ち込みが、今の貼り付け先では要らなくなった
    }
    if (typo.reason) warnings.push(typo.reason);
  }

  if (colorCount) warnings.push(`元デックの配色と一致する色を ${colorCount} か所 var(--accent…) に置き換えました。警告の赤など「意味のある色」まで変わっていないか確認してください（元の色のままにするには、CLI は --keep-colors、VS Code は「元の色のまま」を選ぶ）`);
  if (deps.themeOverrides.length) warnings.push(`元デックはテーマの部品（${deps.themeOverrides.map((c) => '.' + c).join(' ')}）を独自に調整していますが、その調整は運びません（貼り付け先の見た目に従います）`);

  // 5. テーマ違い
  if (src.theme !== dest.theme) {
    const srcTheme = themeClasses(repoRoot).byTheme[src.theme] || new Set();
    const missing = deps.classes.filter((c) => srcTheme.has(c) && !destTheme.has(c));
    warnings.push(`テーマが違います（元: ${src.theme} → 先: ${dest.theme}）。` + (missing.length
      ? `貼り付け先のテーマに無いクラス: ${missing.map((c) => '.' + c).join(' ')}（素の div に崩れます）`
      : '使っているクラスは貼り付け先のテーマにもありますが、余白や文字サイズが変わるので描画を確認してください')
      + (deps.classes.includes('takeaway') ? '。本文が縦に伸びたり takeaway が複数行になったりして、下端の takeaway 帯と本文が重なりやすいので、挿入後は PNG で takeaway と本文の重なりを確認してください（自動では直しません）' : '。挿入後は PNG で見切れ・重なりを確認してください'));
  }

  // 7.2 選んでいないとき：効果を確かめた組み合わせで、実際に持ち込む差があるときだけ勧める
  if (!opts.keepTypo && src.theme !== dest.theme && KT_PROVEN.has(`${src.theme}→${dest.theme}`)) {
    try {
      const usedNow = new Set([...deps.classes, ...destGlobal, ...classesUsed(text)]);
      const p = planKeepTypo(src, dest, usedNow, repoRoot, null, ktTagsUsed(text), carried);
      if (p.lines.length) warnings.push(KT_HINT);
    } catch (_) { /* 勧めるだけなので、分からなければ黙る */ }
  }

  // 本文の挿入（位置が渡されたときだけ）。frontmatter の編集とは重ならない
  if (Number.isInteger(opts.afterIndex)) destEdits.push(insertSlideEdit(dest.text, opts.afterIndex, text));
  const changed = text !== fragment;
  if (destEol !== '\n') {
    text = text.replace(/\n/g, destEol);
    for (const e of destEdits) e.text = e.text.replace(/\r?\n/g, destEol);
  }

  return {
    slideText: text, destEdits, assetCopies, warnings,
    info: {
      changed,
      id: fromId, srcPalette: srcPal, destPalette: destPal, colorReplacements: colorCount,
      carried: global.length, scoped: scoped.length, skipped: carried.length - need.length,
      deckClasses: deps.deckClasses, conflictClasses: [...conflict],
      keepTypo: typo ? typo.lines.length : 0,
    },
  };
}

/**
 * 元デックのスライド1枚を貼り付け先に合わせる。
 *   { srcMdPath, slideIndex | id, destMdPath, keepColors, keepTypo, repoRoot, afterIndex?, srcText?, destText? }
 *   keepTypo：元テーマの組版（縦の寸法）を、そのスライドの <style scoped> で持ち込む（DESIGN.md 7.2）。
 *   srcText / destText は未保存のエディタ内容を使いたいとき（パスは素材の解決に使う）。
 *   afterIndex を渡すと、本文を入れる編集も destEdits に含める（1 つの WorkspaceEdit にまとめられる）。
 */
function adaptSlide(o) {
  if (!o || !o.repoRoot) throw new Error('adaptSlide: repoRoot が要ります');
  const src = parseDeck(o.srcText !== undefined ? o.srcText : o.srcMdPath, { path: path.resolve(o.srcMdPath), repoRoot: o.repoRoot });
  const dest = parseDeck(o.destText !== undefined ? o.destText : o.destMdPath, { path: path.resolve(o.destMdPath), repoRoot: o.repoRoot });
  let idx = o.slideIndex;
  if (!Number.isInteger(idx)) {
    const hits = src.slides.filter((s) => s.mark && s.mark.id === o.id);
    if (!hits.length) throw new Error(`id「${o.id}」の印が ${path.basename(o.srcMdPath)} にありません`);
    if (hits.length > 1) throw new Error(`id「${o.id}」が同じデックに ${hits.length} 枚あります`);
    idx = hits[0].index;
  }
  const body = slideText(src, idx).replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '');
  const plan = adaptFragment(body, src, dest, { repoRoot: o.repoRoot, keepColors: !!o.keepColors, keepTypo: !!o.keepTypo, afterIndex: o.afterIndex, srcSlideIndex: idx, id: o.id });
  plan.destMdPath = dest.path;
  plan.srcMdPath = src.path;
  plan.slideIndex = idx;
  return plan;
}

/** 素材のコピーだけ行う（拡張は本文を WorkspaceEdit で入れるので、こちらだけ使う） */
function copyAssets(plan) {
  const done = [];
  for (const c of plan.assetCopies || []) {
    fs.mkdirSync(path.dirname(c.to), { recursive: true });
    if (!fs.existsSync(c.to)) { fs.copyFileSync(c.from, c.to); done.push(c.to); }
  }
  return done;
}

/** 計画を実行する：素材をコピーし、貼り付け先の md に destEdits を当てて保存する。戻り値は新しい全文 */
function applyAdaptPlan(plan, opts) {
  opts = opts || {};
  const destMd = opts.destMdPath || plan.destMdPath;
  if (!destMd) throw new Error('applyAdaptPlan: 貼り付け先の md が分かりません');
  const before = opts.destText !== undefined ? opts.destText : fs.readFileSync(destMd, 'utf8');
  const after = applyEdits(before, plan.destEdits || []);
  if (opts.dryRun) return after;
  copyAssets(plan);
  fs.writeFileSync(destMd, after);
  return after;
}

/** デックの全文に対して、スライド1枚の印を付ける／外す編集を返す（差分だけの 1 編集。変化なしなら null） */
function markSlideEdit(deckText, slideIndex, mark) {
  const deck = parseDeck(deckText);
  const s = deck.slides[slideIndex];
  if (!s) throw new Error(`スライド ${slideIndex + 1} がありません`);
  const start = deck.offsets[s.startLine] !== undefined ? deck.offsets[s.startLine] : deckText.length;
  const end = deck.offsets[s.endLine] !== undefined ? deck.offsets[s.endLine] : deckText.length;
  const old = deckText.slice(start, end);
  const gc = globalClassAt(deck, slideIndex);
  const eol = eolOf(deckText);
  let neu = mark ? writeMark(old, mark, { globalClass: gc, eol }) : removeMark(old, { globalClass: gc });
  // frontmatter の閉じ --- で原稿が終わっている（改行なし・本文なし）とき、そのまま足すと `---<!--` になって frontmatter が壊れる
  if (mark && start >= deckText.length && deckText !== '' && !/\n$/.test(deckText)) neu = eol + neu;
  return diffEdit(old, neu, start);
}

module.exports = {
  LIB_KEY, FROM_KEY, KNOWN_DIRECTIVES, PATTERN_CLASSES,
  parseMark, parseFrom, writeMark, removeMark, findLeakyMarks, markSlideEdit, suggestId, formatMark,
  parseDeck, globalClassAt, slideText, effectivePalette, normHex,
  cssRules, ruleToCss, signatureOf, themeClasses, loadThemes,
  slideDeps, classesUsed, listRefs, mapRefs,
  buildIndex, writeIndex, readIndex, indexPath, findEntry,
  adaptSlide, adaptFragment, applyAdaptPlan, copyAssets, insertSlideEdit, replacePaletteColors,
  applyEdits, diffEdit, findComments, directiveLines,
};
