// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 配置案（DESIGN.md 8.3）。同じ Markdown のまま、_class の 1 語（lay-*）で配置を変える。
//   - 配置クラスの CSS は theme/tsutawaru-academic.css の §14。ここは「どの案を出すか」と「原稿のどこを書き換えるか」だけ。
//   - 純粋関数だけ（vscode 非依存・fs も使わない）。planSetLayout だけが library-core.cjs を遅延 require する。
//   - 判定の表（LAYOUTS）はここ 1 か所。ブラウザ側（media/layouts.js）へは browserTable() の JSON を
//     window.__SS_LAYOUTS__ として渡す。条件の解き方（matches）だけは同じ物を layouts.js にも書いてある
//     （ここを変えたら layouts.js の matches も直し、test/layouts.test.cjs の突き合わせを回すこと）。
//   - why に書くページ番号は docs/design-rules.md（英語・日本語の両方）に在るものだけ（test/layout-variants.test.cjs が確かめる）。
'use strict';

const LAY_RE = /^lay-[a-z0-9][a-z0-9-]*$/;

/** 配置を切り替えない型（本文を div で組む・全画面）。library-core の PATTERN_CLASSES ＋ tsutawaru の全画面型 */
const PATTERN_CLASSES = ['cover-hero', 'cover', 'cover-left', 'intro', 'fig', 'summary', 'split', 'message', 'divider',
  'wrap', 'refs', 'qa', 'sec-open', 'slido', 'handson', 'handson-2', 'work'];

/**
 * 判定の表。when の意味（どれも「書いてあれば課す」）：
 *   list:true        … 直下の箇条書きがちょうど 1 つ（入れ子なし）
 *   items:[min,max]  … その項目数
 *   ordered:true     … 順序がある（番号つきの箇条書き、または項目が ①②…／Step 1… で始まる）
 *   figure:true      … 図（段落の中の画像だけ・figure・インライン svg）がちょうど 1 つ ／ false … 図が無い
 *   text:true        … 図のほかに文（箇条書きか段落）がある ／ false … 図のほかに文が無い
 *   headBreak:false  … 項目が「太字の見出し＋改行＋説明」の形でない（1行1要点の短い項目だけ）
 *   lead:true        … 本文が段落 1 つだけ（箇条書き・図・表なし）
 *   maxItemChars     … 1 項目の文字数の上限（カードや箱に長文を入れない）
 *   maxTextChars     … 段落の文字数の上限
 *   table:false      … 表が無い（全案に共通で課している）
 */
const LAYOUTS = [
  { cls: 'lay-boxed', label: '塗りで囲む', group: 'list',
    why: '目標・ねらいの1枚だけ。枠線ではなく塗りで囲みます（p.174 囲みすぎない）',
    when: { list: true, items: [2, 3], figure: false, maxItemChars: 90 } },
  { cls: 'lay-cards3', label: '3列のカード', group: 'list',
    why: '3つを同じ重さで横に並べます。枠は位置と大きさを揃えます（p.175）。見比べるのは3つまで',
    when: { list: true, items: [3, 3], figure: false, maxItemChars: 60 } },
  { cls: 'lay-keyrow', label: '上罫だけの列', group: 'list',
    why: '囲まずに、上の罫1本と余白でグループを作ります（p.174）。見比べるのは3つまで',
    when: { list: true, items: [2, 3], figure: false, maxItemChars: 45 } },
  { cls: 'lay-cards2', label: '2列のカード', group: 'list',
    why: '4つは 2×2 のまとまりに分けます（p.205 箇条書きは項目ごとにグループ化）',
    when: { list: true, itemsIn: [2, 4], figure: false, maxItemChars: 70 } },
  { cls: 'lay-flow', label: '左→右の流れ', group: 'order',
    why: '順序を左から右へ一方向に流します。箱は大きさを揃え、矢印は目立たせません（p.206）',
    when: { list: true, items: [2, 4], ordered: true, figure: false, maxItemChars: 45 } },
  { cls: 'lay-steps', label: '番号つきの手順', group: 'order',
    why: '上から下へ、番号で順序を示します（p.167 囲み・矢印・番号で順序を示す）',
    when: { list: true, items: [2, 5], ordered: true, figure: false } },
  { cls: 'lay-fig-right', label: '文を左・図を右', group: 'fig',
    why: 'ワイド画面は行長が伸びすぎるので、横に図を置いて行長を抑えます（p.179）',
    when: { figure: true, text: true } },
  { cls: 'lay-fig-left', label: '図を左・文を右', group: 'fig',
    why: '図を先に見せてから文で説明します。視線は左上から右下へ（p.166）。行長も抑えます（p.179）',
    when: { figure: true, text: true } },
  { cls: 'lay-fig-top', label: '図を上に大きく', group: 'fig',
    why: '図が主役の1枚。関連する図と文を近づけてグループにします（p.154）',
    when: { figure: true } },
  { cls: 'lay-fig-only', label: '図だけを中央に', group: 'fig',
    why: '要素を減らして図だけを見せます（p.110）。文は置かず、下の要点の帯で締めます',
    when: { figure: true, text: false } },
  { cls: 'lay-lead', label: '1文を大きく', group: 'lead',
    why: '重要度に応じて大きさと太さを変えます（p.60）。1枚に1文だけのとき',
    when: { lead: true, maxTextChars: 70 } },
  { cls: 'lay-points', label: '要点だけを大きく', group: 'lead',
    why: '文字を減らし、要点だけを見出しと同じ大きさで縦の中央に置きます（p.60）。1行1要点・5行まで',
    when: { list: true, items: [2, 5], figure: false, headBreak: false, maxItemChars: 40 } },
];

const BASE = { cls: null, label: '標準', group: 'base', why: '配置クラスなし。原稿の順に上から並べます。箇条書きは小見出しを目立たせ、項目ごとにグループ化します（p.205）' };

const ORDER_HEAD = /^(?:[①-⑳]|(?:step|ステップ|手順)\s*[0-90-9]+|[0-90-9]+\s*[.．)）:：])/i;

/**
 * 配置を変えても、そのまま下（または図の下）に残るだけの行。判定では数えない（.note と同じ扱い）。
 * page-title・takeaway は位置が決まっている物、attr・cite・src-row は出典・注記の行。
 */
const SIDE_CLASSES = ['page-title', 'takeaway', 'note', 'attr', 'cite', 'src-row'];
/**
 * 透過する包み：<div class="body">（academic の本文ゾーン）。中身の素の Markdown で判定する。
 * lay-* を付けると CSS（§14）がこの包みを display:contents にして、中身を section の直下と同じに並べる。
 * 縦配分の語（vtop/vcenter/vspread）は付いていてもよい。ほかのクラスや style="" が付いた包みは透過しない。
 */
const WRAP_CLASS = 'body';
const WRAP_EXTRA = ['vtop', 'vcenter', 'vspread'];

// ───────────────────────── 原稿（Markdown）を読む ─────────────────────────

const stripInline = (s) => String(s)
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/(\*\*|__|\*|_|~~|`)/g, '')
  .replace(/\s+/g, ' ').trim();

/** 文字数（サロゲートペアは 1 字） */
const charLen = (s) => Array.from(String(s)).length;

/** そのスライドの _class（コメントの中の 1 行）を読む。無ければ null */
function readClassDirective(slideText) {
  const re = /<!--([\s\S]*?)-->/g;
  let m;
  let found = null;
  while ((m = re.exec(slideText))) {
    const lines = m[1].split(/\r?\n/);
    for (const ln of lines) {
      const d = ln.match(/^\s*_class\s*:(?:\s+(.*?))?\s*$/);
      if (d) found = (d[1] || '').replace(/^["'](.*)["']$/, '$1');   // 後ろのものが勝つ（Marp と同じ）
    }
  }
  return found;
}

/**
 * スライド 1 枚分の原稿を読み、配置案の判定に要る事実だけを返す。
 *   plain      … section の直下が 見出し・箇条書き・段落・図・page-title・takeaway・note だけ（div で組んでいない）
 *   reason     … plain でない理由：'div'（レイアウト用のタグがある）／'pattern'（split・fig などの型）／'code'／'empty'
 *   lists      … 直下の箇条書きの数 ／ items … 箇条書きが 1 つのときの項目数（それ以外は 0）
 *   ordered / hasStrongHead / headBreak（太字の見出し＋改行＋説明の形）／ nested
 *   figures / hasFigure / hasTable / paragraphs / textChars / maxItemChars / hasTakeaway
 *   classes    … いまの _class の語 ／ layout … そのうちの lay-*（無ければ null）
 */
function analyzeSlide(slideText) {
  const src = String(slideText || '').replace(/\r\n?/g, '\n');
  const clsValue = readClassDirective(src);
  const classes = clsValue ? clsValue.split(/\s+/).filter(Boolean) : [];
  const layout = classes.filter((c) => LAY_RE.test(c)).pop() || null;
  const a = {
    plain: true, reason: null, title: '', headings: 0,
    lists: 0, items: 0, ordered: false, hasStrongHead: false, headBreak: false, nested: false,
    figures: 0, hasFigure: false, hasTable: false, hasCode: false,
    paragraphs: 0, textChars: 0, maxItemChars: 0, hasTakeaway: false,
    classes, layout,
  };
  if (classes.some((c) => PATTERN_CLASSES.includes(c))) { a.plain = false; a.reason = 'pattern'; }

  const lines = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, '')).split('\n');
  const lists = [];        // [{ ordered, items:[{ first, rest:[] }] }]
  let cur = null;          // いまの箇条書き
  let para = null;         // いまの段落（行の配列）
  const paras = [];
  const closePara = () => { if (para) { paras.push(para.join(' ')); para = null; } };
  const notPlain = (why) => { if (a.plain) { a.plain = false; a.reason = why; } };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line === '') { closePara(); continue; }
    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;

    // コードの柵
    const fence = line.match(/^(`{3,}|~{3,})/);
    if (fence && indent < 4) {
      closePara(); cur = null; a.hasCode = true; notPlain('code');
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) { /* 中は読まない */ }
      continue;
    }
    // 箇条書きの続き（字下げした行）
    if (cur && indent >= 2) {
      const item = cur.items[cur.items.length - 1];
      if (/^([-*+]|\d+[.)])\s+/.test(line)) a.nested = true;
      item.rest.push(line);
      continue;
    }
    // 直下の HTML
    if (indent < 4 && line[0] === '<') {
      const tag = (line.match(/^<\/?([A-Za-z][\w-]*)/) || [])[1];
      const t = tag ? tag.toLowerCase() : '';
      const clsAttr = (line.match(/^<[^>]*\bclass\s*=\s*["']([^"']*)["']/) || [])[1] || '';
      const has = (name) => clsAttr.split(/\s+/).includes(name);
      const skipTo = (close) => { while (i < lines.length && !new RegExp(close, 'i').test(lines[i])) i++; };
      if (t === 'svg') { closePara(); cur = null; a.figures++; skipTo('</svg>'); continue; }
      if (t === 'figure') { closePara(); cur = null; a.figures++; skipTo('</figure>'); continue; }
      if (t === 'img' && /^<img\b[^>]*>$/i.test(line)) { closePara(); cur = null; a.figures++; continue; }
      if ((t === 'div' || t === 'p') && (has('page-title') || has('takeaway') || has('note'))) {
        closePara(); cur = null;
        if (has('takeaway')) a.hasTakeaway = true;
        skipTo('</' + t + '>');
        continue;
      }
      if (t === 'table') { closePara(); cur = null; a.hasTable = true; skipTo('</table>'); continue; }
      if (/^(b|strong|span|em|i|a|code|mark|u|br|small|sub|sup|kbd)$/.test(t)) { /* 文中のタグ＝段落として下で数える */ }
      else { closePara(); cur = null; notPlain('div'); continue; }
    }
    // 見出し
    const h = indent < 4 && line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closePara(); cur = null; a.headings++;
      if (!a.title && h[1].length <= 2) a.title = stripInline(h[2]);
      continue;
    }
    // 箇条書きの項目
    const li = indent < 2 && line.match(/^([-*+]|\d+[.)])(?:\s+(.*))?$/);
    if (li) {
      closePara();
      const ordered = /\d/.test(li[1]);
      if (!cur || cur.ordered !== ordered) { cur = { ordered, items: [] }; lists.push(cur); }
      cur.items.push({ first: li[2] || '', rest: [] });
      continue;
    }
    cur = null;
    // 表
    if (/^\|.*\|\s*$/.test(line)) { closePara(); a.hasTable = true; continue; }
    // 画像だけの行＝図
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(line) && !para) {
      const next = (lines[i + 1] || '').trim();
      if (next === '') { a.figures++; continue; }
    }
    if (/^>/.test(line)) { closePara(); paras.push(stripInline(line.replace(/^>\s?/, ''))); continue; }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) { closePara(); continue; }
    (para || (para = [])).push(line);
  }
  closePara();

  a.lists = lists.length;
  a.hasFigure = a.figures > 0;
  const textParas = paras.map(stripInline).filter(Boolean);
  a.paragraphs = textParas.length;
  a.textChars = textParas.reduce((n, p) => n + charLen(p), 0);
  if (lists.length === 1) {
    const L = lists[0];
    a.items = L.items.length;
    const firsts = L.items.map((it) => it.first.trim());
    a.hasStrongHead = firsts.length > 0 && firsts.every((f) => /^(\*\*|__|<b>|<strong>)/.test(f));
    a.headBreak = L.items.some((it) => /^(\*\*[^*]+\*\*|__[^_]+__)\s*$/.test(it.first.trim()) && it.rest.length > 0);
    a.ordered = L.ordered || firsts.every((f) => ORDER_HEAD.test(stripInline(f)));
    a.maxItemChars = L.items.reduce((mx, it) => Math.max(mx, charLen(stripInline([it.first].concat(it.rest).join(' ')))), 0);
  }
  if (a.plain && !a.lists && !a.figures && !a.paragraphs && !a.hasTable) { a.plain = false; a.reason = 'empty'; }
  return a;
}

// ───────────────────────── どの案を出すか ─────────────────────────

/** 条件の解き方。media/layouts.js の matches と同じ（片方を変えたら、もう片方も） */
function matches(a, w) {
  if (!a || !a.plain || a.hasTable) return false;
  if (w.list && !(a.lists === 1 && !a.nested)) return false;
  if (w.items && !(a.items >= w.items[0] && a.items <= w.items[1])) return false;
  if (w.itemsIn && w.itemsIn.indexOf(a.items) < 0) return false;
  if (w.ordered && !a.ordered) return false;
  if (w.figure === true && a.figures !== 1) return false;
  if (w.figure === false && a.figures !== 0) return false;
  if (w.text && !(a.lists > 0 || a.paragraphs > 0)) return false;
  if (w.text === false && (a.lists > 0 || a.paragraphs > 0)) return false;
  if (w.headBreak === false && a.headBreak) return false;
  if (w.lead && !(a.paragraphs === 1 && a.lists === 0 && a.figures === 0)) return false;
  if (w.maxItemChars && a.maxItemChars > w.maxItemChars) return false;
  if (w.maxTextChars && a.textChars > w.maxTextChars) return false;
  return true;
}

/**
 * そのスライドに出す配置案。先頭は必ず「標準（配置クラスなし）」。素の構造でなければ空の配列。
 * いま付いている lay-* が条件に合わなくなっていても、一覧には残す（current:true。外せるように）。
 */
function variantsFor(analysis) {
  const a = analysis;
  if (!a || !a.plain) return [];
  const out = [Object.assign({}, BASE, { current: !a.layout })];
  for (const v of LAYOUTS) {
    const ok = matches(a, v.when);
    if (!ok && a.layout !== v.cls) continue;
    out.push({ cls: v.cls, label: v.label, why: v.why, group: v.group, current: a.layout === v.cls, fits: ok });
  }
  out[0].fits = true;
  return out;
}

/** ブラウザへ渡す表（buildHtml が window.__SS_LAYOUTS__ として埋め込む JSON） */
function browserTable() {
  return {
    version: 1,
    base: BASE,
    layouts: LAYOUTS.map((v) => ({ cls: v.cls, label: v.label, why: v.why, group: v.group, when: v.when })),
    patternClasses: PATTERN_CLASSES.slice(),
    orderHead: ORDER_HEAD.source,
    notPlainText: NOT_PLAIN_TEXT,
  };
}

const NOT_PLAIN_TEXT = 'このスライドは div で組んであるので、配置の切り替えは使えません';

// ───────────────────────── 原稿の書き換え ─────────────────────────

function fail(reason, line) { return { ok: false, edits: [], revealLine: line === undefined ? null : line, reason }; }

/**
 * index 枚目（0 始まり）の _class の lay-* を cls に差し替える（cls が null なら外す）。
 * ほかのクラス・_lib の印・ほかのディレクティブは保つ。_class が無ければ 1 行形式で足す
 * （グローバル class があれば、その値を写してから足す。_class はグローバル class を置き換えるため）。
 * 戻り値：{ ok, edits:[{start,end,text}], revealLine, reason? }。edits は 0〜1 件（最小差分）。
 */
function planSetLayout(text, index, cls) {
  text = String(text);
  if (cls !== null && cls !== undefined && !LAY_RE.test(String(cls))) return fail('配置クラスの名前が正しくありません：' + cls);
  if (cls === undefined) cls = null;
  let lc, ss;
  try { lc = require('./library-core.cjs'); ss = require('./slide-split.cjs'); }
  catch (e) { return fail('配置の書き換えに要る部品を読み込めませんでした'); }
  let deck;
  try { deck = lc.parseDeck(text); } catch (e) { return fail('原稿を読み取れませんでした'); }
  const s = deck.slides[index];
  if (!s) return fail(`スライド ${index + 1} がありません`);
  const start = deck.offsets[s.startLine] !== undefined ? deck.offsets[s.startLine] : text.length;
  const end = deck.offsets[s.endLine] !== undefined ? deck.offsets[s.endLine] : text.length;
  const old = text.slice(start, end);
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const gc = String(lc.globalClassAt(deck, index) || '').split(/\s+/).filter(Boolean);

  // そのスライドの _class（複数あれば最後＝Marp で効いているもの）
  let target = null;
  for (const c of lc.findComments(old)) {
    const ds = lc.directiveLines(c.inner);
    const d = ds.filter((x) => x.key === '_class').pop();
    if (d) target = { c, ds, d };
  }
  let neu;
  let revealLine = s.startLine;
  if (target) {
    const innerLines = target.c.inner.split(/(\r?\n)/);          // 改行も要素として残す（CRLF を保つ）
    const li = target.d.lineIdx * 2;
    const lineText = innerLines[li];
    const m = lineText.match(/^(\s*_class\s*:)(\s*)(.*?)(\s*)$/);
    const rawVal = m[3];
    if (/^[\[{|>]/.test(rawVal)) return fail('この _class は書き方が特殊なので、配置を自動では書き換えられません', s.startLine + target.d.lineIdx);
    const q = (rawVal.match(/^(["'])[\s\S]*\1$/) || [])[1] || '';
    const val = q ? rawVal.slice(1, -1) : rawVal;
    const keep = val.split(/\s+/).filter(Boolean).filter((c) => !LAY_RE.test(c));
    const next = cls ? keep.concat([cls]) : keep;
    const others = target.ds.filter((x) => x !== target.d);
    const sameAsGlobal = next.join(' ') === gc.join(' ');
    if (!cls && others.length === 0 && (next.length === 0 || sameAsGlobal)) {
      // 配置のために足した _class だけが残る → コメントごと消す（直後の空行 1 つも）
      let e = target.c.end;
      const tail = old.slice(e).match(/^[ \t]*\r?\n(?:[ \t]*\r?\n)?/);
      if (tail) e += tail[0].length;
      neu = old.slice(0, target.c.start) + old.slice(e);
    } else {
      // 空にするとグローバル class が外れて見た目が変わるので、空になるときはグローバル class を書く
      const out = next.length ? next : gc;
      const v = out.join(' ');
      innerLines[li] = v ? m[1] + (m[2] || ' ') + q + v + q + m[4] : m[1] + m[4];
      neu = old.slice(0, target.c.start) + '<!--' + innerLines.join('') + '-->' + old.slice(target.c.end);
    }
    const before = old.slice(0, target.c.start + 4) + target.c.inner.split(/\r?\n/).slice(0, target.d.lineIdx).join('\n');
    revealLine = s.startLine + (before.match(/\n/g) || []).length;
  } else {
    if (!cls) return { ok: true, edits: [], revealLine };
    const v = gc.filter((c) => !LAY_RE.test(c)).concat([cls]).join(' ');
    const block = `<!-- _class: ${v} -->`;
    const lead = old.match(/^(?:[ \t]*\r?\n)*/)[0];
    const rest = old.slice(lead.length);
    neu = lead + block + eol + (rest === '' || /^\r?\n/.test(rest) ? '' : eol) + rest;
    // frontmatter の閉じ --- で原稿が終わっている（改行なし）ときは、改行を先に足す
    if (start >= text.length && text !== '' && !/\n$/.test(text)) neu = eol + neu;
    revealLine = s.startLine + (lead.match(/\n/g) || []).length;
  }
  const edit = lc.diffEdit(old, neu, start);
  if (!edit) return { ok: true, edits: [], revealLine };
  // 検算：枚数が変わらない・ほかのスライドに触れていない
  const after = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  let nBefore, nAfter;
  try { nBefore = ss.slideStartLines(text).length; nAfter = ss.slideStartLines(after).length; }
  catch (e) { return fail('原稿を数え直せませんでした'); }
  if (nBefore !== nAfter) return fail('書き換えるとスライドの枚数が変わるので、やめました', revealLine);
  if (edit.start < start || edit.end > end) return fail('書き換えが、そのスライドの外に出るので、やめました', revealLine);
  return { ok: true, edits: [edit], revealLine };
}

module.exports = {
  LAYOUTS, BASE, PATTERN_CLASSES, LAY_RE, NOT_PLAIN_TEXT,
  analyzeSlide, variantsFor, matches, planSetLayout, browserTable, readClassDirective,
};
