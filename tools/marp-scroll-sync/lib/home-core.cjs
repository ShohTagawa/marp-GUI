// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// ホーム画面（DESIGN.md 10章）の純粋な部分。vscode に依存しない（test/home-core.test.cjs で試す）。
//   ・手を入れた順（直した回数）／点数順／新しい順の並べ替え
//   ・デック一覧（索引の entries からデック単位に畳む）
//   ・最近開いたデックの記録（上限つき・同じデックは先頭へ）
//   ・Webview へ渡すカードの形（toItem）
'use strict';

const core = require('./corpus-core.cjs');

const RECENT_MAX = 12;

/** entry → Webview のカード 1 枚分（html・css はサムネイル要求で後から別便） */
function toItem(e, extra) {
  const ch = e.churn || {};
  return Object.assign({
    key: e.key, deck: e.deck, deckName: e.deckName, slide: e.slide, title: e.title || '', pattern: e.pattern || '', theme: e.theme || '',
    date: e.date || '', marked: !!e.mark, id: e.mark ? e.mark.id : null, touched: ch.touched || 0, lines: ch.lines || 0, last: ch.last || '',
    human: ch.human ? (ch.human.touched || 0) : null,   // 人の版だけの回数（AI 名義のコミットを分けている場合）。無ければ null（＝全部が人）
    group: e.group || null, converted: !!e.converted, score: typeof e.score === 'number' ? e.score : 0, dupCount: e.dupCount || 1,
  }, extra || {});
}

/**
 * 同点のときの最後の順：デックのパス順、同じデックの中はスライド番号の順（数として比べる：#2 が #10 より先。
 * key の文字列で比べると #1, #10, #2 になる）。最後に key で順序を必ず決める（corpus-core の byScore と同じ）
 */
const byPlace = (a, b) => String(a.deck || '').localeCompare(String(b.deck || ''))
  || (Number(a.slide) || 0) - (Number(b.slide) || 0)
  || String(a.key || '').localeCompare(String(b.key || ''));
const byTouched = (a, b) => (b.churn && b.churn.touched || 0) - (a.churn && a.churn.touched || 0)
  || (b.churn && b.churn.lines || 0) - (a.churn && a.churn.lines || 0)
  || String(b.churn && b.churn.last || '').localeCompare(String(a.churn && a.churn.last || ''))
  || byPlace(a, b);
const byScore = (a, b) => (b.score || 0) - (a.score || 0) || String(b.date || '').localeCompare(String(a.date || '')) || byPlace(a, b);
const hT = (e) => (e.churn && e.churn.human ? e.churn.human.touched || 0 : (e.churn && e.churn.touched || 0));
const byHuman = (a, b) => hT(b) - hT(a) || byTouched(a, b);
const byRecent = (a, b) => String(b.churn && b.churn.last || b.date || '').localeCompare(String(a.churn && a.churn.last || a.date || ''))
  || (b.churn && b.churn.touched || 0) - (a.churn && a.churn.touched || 0) || byPlace(a, b);

/**
 * 手を入れたスライド。sort：'touched'（直した回数。既定）／'human'（人の版の回数）／'score'（★と添削量の点数）／'recent'（最後に直した日）。
 * pptx 変換のまま（converted）で 1 度も直していない物と、同じ内容の重複（dupOf）は出さない。
 */
function mostEdited(corpus, opts) {
  const o = opts || {};
  const limit = Number.isInteger(o.limit) ? Math.max(1, o.limit) : 48;
  const offset = Number.isInteger(o.offset) ? Math.max(0, o.offset) : 0;
  const sort = o.sort === 'score' ? byScore : o.sort === 'recent' ? byRecent : o.sort === 'human' ? byHuman : byTouched;
  const all = (corpus && corpus.entries || []).filter((e) => {
    if (e.dupOf) return false;
    const t = e.churn && e.churn.touched || 0;
    if (o.sort === 'score') return !!e.mark || t > 0;
    if (o.sort === 'human') return hT(e) > 0;
    return t > 0;
  }).sort(sort);
  return { total: all.length, items: all.slice(offset, offset + limit).map((e) => toItem(e)) };
}

/** デック一覧（新しい順）。枚数・直した枚数・変更行数・最後に直した日・テーマ・群 */
function decksOf(corpus) {
  const m = new Map();
  for (const e of (corpus && corpus.entries || [])) {
    let d = m.get(e.deck);
    if (!d) m.set(e.deck, (d = { deck: e.deck, deckName: e.deckName, theme: e.theme || '', date: e.date || '', group: e.group || null, converted: !!e.converted, slides: 0, touched: 0, lines: 0, last: '', marked: 0, title: '' }));
    d.slides++;
    if (e.mark) d.marked++;
    const ch = e.churn;
    if (ch && ch.touched) { d.touched++; d.lines += ch.lines || 0; if (String(ch.last || '') > d.last && !/未コミット|uncommitted/.test(String(ch.last))) d.last = ch.last; }
    if (!d.title && e.slide === 1 && e.title) d.title = e.title;
    if (!d.title && e.slide === 1 && e.text) d.title = String(e.text).slice(0, 40);
  }
  return Array.from(m.values()).sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.deckName.localeCompare(b.deckName));
}

/** 最近開いたデックの一覧に deck を先頭で入れる（同じ物は 1 つ・上限 RECENT_MAX）。list は壊さず新しい配列を返す */
function recentPush(list, deck, at, max) {
  const lim = Number.isInteger(max) && max > 0 ? max : RECENT_MAX;
  const now = Number.isFinite(at) ? at : Date.now();
  const rest = (Array.isArray(list) ? list : []).filter((x) => x && typeof x.deck === 'string' && x.deck !== deck);
  return [{ deck, at: now }].concat(rest).slice(0, lim);
}

/** 最近開いたデックに、索引の情報（題・枚数・最終更新）を付ける。索引に無いデック（消した・動かした）は外す */
function recentItems(list, corpus) {
  const decks = decksOf(corpus);
  const by = new Map(decks.map((d) => [d.deck, d]));
  const out = [];
  for (const r of (Array.isArray(list) ? list : [])) {
    const d = r && by.get(r.deck);
    if (d) out.push(Object.assign({ at: r.at || 0 }, d));
  }
  return out;
}

/** 検索（corpus-core の searchCorpus の薄い包み）。棚の呼び名にも当たる */
function search(corpus, query, opts) {
  const o = opts || {};
  const r = core.searchCorpus(corpus, String(query || ''), {
    onlyMarked: !!o.onlyMarked, sort: o.sort, offset: o.offset || 0, limit: o.limit || 48, dedupe: true,
    theme: o.theme || undefined, shelf: o.shelf || undefined,
  });
  return { total: r.total, items: r.items.map((x) => toItem(x.entry, { snippet: x.snippet || '', shelf: x.shelf || null })) };
}

/** 棚（resolveShelf の結果）→ Webview 用。行方不明の項目はそのまま印を付けて残す */
function shelfItems(resolved) {
  return (resolved || []).map((sv) => ({
    name: sv.name,
    items: (sv.items || []).map((it) => {
      if (!it.entry) { const r = it.ref || {}; return { label: it.label, missing: true, deck: r.deck || null, slide: Number.isInteger(r.slide) ? r.slide : null, title: r.title || '' }; }
      return toItem(it.entry, { label: it.label });
    }),
  }));
}

/** marp の html を、スライド（svg[data-marpit-svg]）単位に切る。本文のインライン svg を巻き込まないよう、開始位置だけで切る */
function splitSlides(html) {
  const re = /<svg\b[^>]*\bdata-marpit-svg\b/g;
  const at = [];
  for (let m; (m = re.exec(html));) at.push(m.index);
  if (!at.length) return [];
  const end = html.lastIndexOf('</svg>') + 6;
  return at.map((s, i) => safeThumb(html.slice(s, i + 1 < at.length ? at[i + 1] : end)));
}
/** サムネイルは見るだけの物。script・イベント属性（onerror= など）・javascript: の URL を外す（Webview 側でも DOM で外す。二重の守り） */
function safeThumb(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<[a-zA-Z][^<>]*>/g, (tag) => (/\son|javascript:/i.test(tag)
      ? tag.replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, '')
        .replace(/(\s(?:href|xlink:href|src|action|formaction)\s*=\s*)(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '$1"#"')
      : tag));
}

module.exports = { RECENT_MAX, toItem, mostEdited, decksOf, recentPush, recentItems, search, shelfItems, splitSlides, safeThumb };
