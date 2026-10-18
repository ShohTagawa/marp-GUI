// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// Marp ホーム（Webview 側）。lib/home-vscode.cjs と postMessage でやり取りする。
//   受け取る：homeData / homeResults / homeThumbData / homeRecent / homeToast / homeQuery
//   送る    ：homeReady / homeRefresh / homeSearch / homeThumbs / homeOpen / homeSetPreview / homeRebuild
// サムネイルは preview.js と同じ方式（Shadow DOM にデックの css を adoptedStyleSheets で付ける。見えているカードから順に要求する）。
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const INIT = window.__SS_HOME__ || {};
  const saved = vscode.getState() || {};
  const st = { tab: saved.tab || 'recent', sort: saved.sort || 'touched', shelfTab: saved.shelfTab || 0, openPreview: typeof saved.openPreview === 'boolean' ? saved.openPreview : INIT.openPreview !== false };
  const keep = () => vscode.setState({ tab: st.tab, sort: st.sort, shelfTab: st.shelfTab, openPreview: st.openPreview });
  const post = (m) => vscode.postMessage(m);

  let data = { recent: [], shelves: [], top: [], topTotal: 0, decks: [], withChurn: false, generatedAt: null, error: null };
  let results = null, query = '', reqSeq = 0, loaded = false;

  function h(tag, props, kids) {
    const el = document.createElement(tag);
    if (props) for (const k of Object.keys(props)) {
      if (k === 'text') el.textContent = props[k];
      else if (k === 'class') el.className = props[k];
      else if (k.startsWith('on') && typeof props[k] === 'function') el.addEventListener(k.slice(2), props[k]);
      else el.setAttribute(k, props[k]);
    }
    if (kids) for (const c of kids) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
  }
  const keyOf = (it) => (typeof it.key === 'string' ? it.key : it.deck + '#' + it.slide);
  const baseName = (deck) => String(deck || '').replace(/^slides\//, '').replace(/\/[^/]*$/, '');
  const fmtDate = (d) => (d ? String(d).slice(0, 10) : '');

  // ---------- 骨組み ----------
  const root = document.getElementById('home');
  const input = h('input', { type: 'search', placeholder: 'スライドを検索（題名・本文・棚の呼び名。例：自己紹介）', 'aria-label': 'スライドを検索', spellcheck: 'false', autocomplete: 'off' });
  const clearBtn = h('button', { class: 'hm-clear', type: 'button', title: '検索を消す（Esc）', text: '×' });
  const chk = h('input', { type: 'checkbox' });
  chk.checked = !!st.openPreview;
  const tabsEl = h('div', { class: 'hm-tabs', role: 'tablist' });
  const bodyEl = h('div', { class: 'hm-body' });
  const toastEl = h('div', { class: 'hm-toast', role: 'status' });
  root.appendChild(h('div', { class: 'hm-head' }, [
    h('h1', { class: 'hm-title' }, ['Marp ホーム', h('small', { text: INIT.repoRoot ? INIT.repoRoot.replace(/^.*[\\/]/, '') : '' })]),
    h('div', { class: 'hm-search' }, [h('span', { text: '🔎' }), input, clearBtn]),
    h('label', { class: 'hm-opt', title: 'カードを押して原稿を開いたとき、同期プレビュー（⌘K M）も横に出す' }, [chk, '開いたらプレビューも出す']),
    h('button', { class: 'hm-btn', type: 'button', title: '一覧を読み直す', text: '更新', onclick: () => post({ type: 'homeRefresh' }) }),
    h('button', { class: 'hm-btn', type: 'button', title: 'スライド検索の索引（添削量つき）を裏で作り直す。数秒かかる', text: '索引を作り直す', onclick: () => { toast('索引を作り直しています…'); post({ type: 'homeRebuild' }); } }),
  ]));
  root.appendChild(tabsEl);
  root.appendChild(bodyEl);
  root.appendChild(toastEl);

  let toastTimer = null;
  function toast(msg, warn) {
    toastEl.textContent = msg; toastEl.classList.toggle('hm-warn', !!warn); toastEl.classList.add('hm-show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('hm-show'), warn ? 4000 : 1800);
  }

  // ---------- サムネイル（preview.js と同じ方式） ----------
  const FIX_CSS = ':host{display:block}div.marpit{pointer-events:none;user-select:none;-webkit-user-select:none}div.marpit>svg[data-marpit-svg]{display:block;width:100%;height:auto}';
  // @import は replaceSync が受け付けないので外して、要るものだけ小さな <style> で足す。url('…') や "…" の中の ; で切らないよう、
  // 引用符と url(…) を丸ごと読む。旧 /@import\s[^;]+;/ は Google Fonts の wght@400;700 の ; で切れ、残った 700&display=swap'); の
  // 引用符が次の規則（section の 1280×720・overflow:hidden）まで文字列として呑み込み、サムネイルの右側が切れていた（実測 2026-10-17）
  const IMPORT_RE = /@import\s+(?:url\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^)]*)\s*\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')[^;]*;/g;
  const cssStore = new Map(), sheetStore = new Map();
  let fixSheet = null, canAdopt = false;
  try {
    canAdopt = typeof CSSStyleSheet === 'function' && typeof CSSStyleSheet.prototype.replaceSync === 'function' && 'adoptedStyleSheets' in document;
    if (canAdopt) { fixSheet = new CSSStyleSheet(); fixSheet.replaceSync(FIX_CSS); }
  } catch (_) { canAdopt = false; }
  function putCss(map) {
    if (!map || typeof map !== 'object') return;
    for (const k of Object.keys(map)) { if (typeof map[k] === 'string' && cssStore.get(k) !== map[k]) { cssStore.set(k, map[k]); sheetStore.delete(k); } }
  }
  function sheetFor(key) {
    if (!canAdopt) return null;
    let e = sheetStore.get(key);
    if (e) return e;
    const css = cssStore.get(key);
    if (css == null) return null;
    try {
      const imports = css.match(/@import\s[^;]+;/g) || [];
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(imports.length ? css.replace(/@import\s[^;]+;/g, '') : css);
      e = { sheet, imports: imports.join('') };
    } catch (_) { return null; }
    sheetStore.set(key, e);
    return e;
  }
  const thumbData = new Map();     // key → { cssKey, html }（受け取った絵）
  const hosts = new Map();         // key → Set(host)（画面に出ている入れ物）
  function fillHost(host) {
    const key = host.dataset.key;
    const t = thumbData.get(key);
    if (!t || host.shadowRoot) return;
    host.classList.remove('hm-wait');
    if (!t.html || !t.cssKey || !cssStore.has(t.cssKey)) { host.classList.add('hm-nothumb'); return; }
    const sr = host.attachShadow({ mode: 'open' });
    const tpl = document.createElement('template');
    tpl.innerHTML = t.html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
    tpl.content.querySelectorAll('script, iframe, object, embed').forEach((e) => e.remove());
    tpl.content.querySelectorAll('*').forEach((e) => {
      for (const a of Array.from(e.attributes)) {
        if (/^on/i.test(a.name) || (/^(href|xlink:href|src|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) e.removeAttribute(a.name);
      }
    });
    tpl.content.querySelectorAll('video, audio').forEach((v) => { v.removeAttribute('controls'); v.removeAttribute('autoplay'); v.setAttribute('preload', 'none'); });
    const sh = sheetFor(t.cssKey);
    if (sh) {
      sr.adoptedStyleSheets = [sh.sheet, fixSheet];
      if (sh.imports) { const im = document.createElement('style'); im.textContent = sh.imports; sr.appendChild(im); }
    } else {
      const s1 = document.createElement('style'); s1.textContent = cssStore.get(t.cssKey);
      const s2 = document.createElement('style'); s2.textContent = FIX_CSS;
      sr.appendChild(s1); sr.appendChild(s2);
    }
    const box = document.createElement('div'); box.className = 'marpit'; box.appendChild(tpl.content);
    sr.appendChild(box);
    host.textContent = '';
  }
  // 見えたカードの分だけ、まとめて頼む
  let want = new Map(), wantTimer = null, thumbReq = 0;
  function requestThumb(host) {
    const key = host.dataset.key;
    if (thumbData.has(key)) { fillHost(host); return; }
    const [deck, slide] = [host.dataset.deck, Number(host.dataset.slide)];
    want.set(key, { deck, slide });
    clearTimeout(wantTimer);
    wantTimer = setTimeout(() => {
      const keys = Array.from(want.values()); want = new Map();
      if (keys.length) post({ type: 'homeThumbs', reqId: ++thumbReq, keys, haveCss: Array.from(cssStore.keys()) });
    }, 40);
  }
  let observer = null;
  function watch(host) {
    if (!window.IntersectionObserver) { requestThumb(host); return; }
    if (!observer) observer = new IntersectionObserver((list) => { for (const en of list) if (en.isIntersecting) { observer.unobserve(en.target); requestThumb(en.target); } }, { rootMargin: '400px 0px' });
    observer.observe(host);
  }
  function onThumbData(m) {
    putCss(m.css);
    for (const it of (m.items || [])) {
      thumbData.set(it.key, { cssKey: it.cssKey, html: it.html });
      const set = hosts.get(it.key);
      if (set) for (const host of set) if (host.isConnected) fillHost(host);
    }
  }

  // ---------- カード ----------
  function badges(it) {
    const b = [];
    if (it.marked) b.push(h('span', { class: 'hm-badge hm-b-mark', title: '完成の印（_lib）', text: '★' }));
    if (it.touched > 0) b.push(h('span', { class: 'hm-badge hm-b-touch', title: '内容が変わったコミットの数（' + (it.lines || 0) + ' 行）' + (data.split && it.human != null ? '。うち人の手直し ' + it.human + ' 回' : ''), text: it.touched + '回' + (data.split && it.human != null && it.human !== it.touched ? '（人 ' + it.human + '）' : '') }));
    if (it.group === 'A') b.push(h('span', { class: 'hm-badge hm-b-group', title: '手本の群 A', text: 'A' }));
    return b.length ? h('div', { class: 'hm-badges' }, b) : null;
  }
  function card(it, label) {
    const name = label || it.title || '(無題)';
    const key = keyOf(it);
    let host;
    if (it.missing) host = h('div', { class: 'hm-shadow hm-nothumb', text: '行方不明' });
    else {
      host = h('div', { class: 'hm-shadow hm-wait', text: name, 'data-key': key, 'data-deck': it.deck, 'data-slide': String(it.slide) });
      if (!hosts.has(key)) hosts.set(key, new Set());
      hosts.get(key).add(host);
    }
    const sub = it.missing ? '元のスライドが見つかりません' : baseName(it.deck) + ' #' + it.slide + (it.last ? ' · 最終 ' + fmtDate(it.last) : it.date ? ' · ' + it.date : '');
    const el = h('div', { class: 'hm-card' + (it.missing ? ' hm-lost' : ''), role: 'button', tabindex: '0', title: name + '\n' + (it.deck || '') + ' #' + it.slide + '\nクリックで開く' }, [
      h('div', { class: 'hm-thumbbox' }, [host, badges(it)]),
      h('div', { class: 'hm-meta' }, [h('div', { class: 'hm-name', text: name }), h('div', { class: 'hm-sub', text: sub }), it.snippet ? h('div', { class: 'hm-snippet', text: it.snippet }) : null]),
    ]);
    if (!it.missing) {
      const open = () => post({ type: 'homeOpen', deck: it.deck, slide: it.slide, preview: st.openPreview });
      el.addEventListener('click', open);
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
      watch(host);
    }
    return el;
  }
  function grid(items, emptyText, label) {
    const g = h('div', { class: 'hm-grid', role: 'list' });
    if (!items.length) g.appendChild(h('div', { class: 'hm-empty', text: emptyText }));
    for (const it of items) g.appendChild(card(it, label ? label(it) : null));
    return g;
  }

  // ---------- 各タブ ----------
  function deckRow(d) {
    const open = () => post({ type: 'homeOpen', deck: d.deck, slide: 1, preview: st.openPreview });
    const tr = h('tr', { class: 'hm-row', tabindex: '0', title: d.deck + '\nクリックで 1 枚目を開く' }, [
      h('td', { class: 'hm-c', text: d.date || '' }),
      h('td', {}, [d.group ? h('span', { class: 'hm-tag hm-g-' + d.group, text: d.group }) : (d.converted ? h('span', { class: 'hm-tag hm-g-C', text: 'C' }) : null), h('span', { class: 'hm-deckname', text: d.deckName })]),
      h('td', { class: 'hm-decktitle', text: d.title || '' }),
      h('td', { class: 'hm-c', text: d.theme || '' }),
      h('td', { class: 'num', text: String(d.slides) }),
      h('td', { class: 'num', text: d.touched ? d.touched + '／' + d.lines + '行' : '' }),
      h('td', { class: 'hm-c', text: d.last ? fmtDate(d.last) : '' }),
    ]);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); open(); } });
    return tr;
  }
  function deckTable(decks) {
    if (!decks.length) return h('div', { class: 'hm-note', text: 'デックがまだありません。' });
    const t = h('table', { class: 'hm-table' }, [
      h('colgroup', {}, ['c-date', 'c-deck', 'c-title', 'c-theme', 'c-n', 'c-touch', 'c-last'].map((k) => h('col', { class: k }))),
      h('thead', {}, [h('tr', {}, ['日付', 'デック', '題', 'テーマ', '枚', '直した枚／行', '最終'].map((x) => h('th', { text: x })))]),
      h('tbody', {}, decks.map(deckRow)),
    ]);
    return t;
  }
  function recentView() {
    const frag = document.createDocumentFragment();
    frag.appendChild(h('div', { class: 'hm-h', text: '最近開いたデック' }));
    if (!data.recent.length) {
      frag.appendChild(h('div', { class: 'hm-note', text: 'まだ記録がありません。デックを開くとここに並びます。下は日付の新しいデックです。' }));
      frag.appendChild(deckTable(data.decks.slice(0, 12)));
    } else {
      frag.appendChild(deckTable(data.recent));
    }
    return frag;
  }
  function shelfView() {
    const frag = document.createDocumentFragment();
    const shelves = data.shelves || [];
    if (!shelves.length) { frag.appendChild(h('div', { class: 'hm-note' }, ['棚はまだありません。同期プレビューの ＋ポップアップでカードの「名前を付ける…」を押すか、', h('code', { text: 'node tools/marp-library.mjs shelf add' }), ' で置けます。'])); return frag; }
    if (st.shelfTab >= shelves.length) st.shelfTab = 0;
    const tabs = h('div', { class: 'hm-shelf-tabs', role: 'tablist' });
    shelves.forEach((sv, i) => {
      const b = h('button', { class: 'hm-shelf-tab' + (i === st.shelfTab ? ' hm-on' : ''), type: 'button', role: 'tab', text: sv.name + '（' + sv.items.length + '）' });
      b.addEventListener('click', () => { st.shelfTab = i; keep(); render(); });
      tabs.appendChild(b);
    });
    frag.appendChild(h('div', { class: 'hm-h' }, [h('span', { text: '棚' }), tabs]));
    frag.appendChild(grid(shelves[st.shelfTab].items, 'この棚はまだ空です。', (it) => it.label));
    return frag;
  }
  function topView() {
    const frag = document.createDocumentFragment();
    const sorts = [['touched', '直した回数']].concat(data.split ? [['human', '人が直した回数']] : []).concat([['score', '点数（★優先）'], ['recent', '最後に直した日']]);
    const sort = h('div', { class: 'hm-sort' }, sorts.map(([k, label]) => {
      const b = h('button', { type: 'button', class: k === st.sort ? 'hm-on' : '', text: label });
      b.addEventListener('click', () => { st.sort = k; keep(); render(); sendSearch(); });
      return b;
    }));
    const n = results && !query ? results.total : data.topTotal;
    frag.appendChild(h('div', { class: 'hm-h' }, [h('span', { text: '手を入れた順（' + n + ' 枚）' }), sort]));
    if (!data.withChurn) frag.appendChild(h('div', { class: 'hm-note' }, ['添削量つきの索引がまだありません。「索引を作り直す」か ', h('code', { text: 'node tools/marp-library.mjs corpus' }), ' を実行してください。']));
    const items = results && !query && st.sort !== 'touched' ? results.items : data.top;
    frag.appendChild(grid(items, '手を入れたスライドがまだありません。'));
    return frag;
  }
  function decksView() {
    const frag = document.createDocumentFragment();
    frag.appendChild(h('div', { class: 'hm-h', text: 'デック一覧（' + data.decks.length + '）' }));
    frag.appendChild(deckTable(data.decks));
    return frag;
  }
  function searchView() {
    const frag = document.createDocumentFragment();
    if (!results) { frag.appendChild(h('div', { class: 'hm-note', text: '検索中…' })); return frag; }
    frag.appendChild(h('div', { class: 'hm-h', text: '検索結果「' + query + '」（' + results.total + ' 件' + (results.total > results.items.length ? '。先頭 ' + results.items.length + ' 件' : '') + '）' }));
    if (results.error) frag.appendChild(h('div', { class: 'hm-note', text: results.error }));
    frag.appendChild(grid(results.items, '該当するスライドがありません。語を減らしてみてください。'));
    return frag;
  }

  const TABS = [['recent', '最近'], ['shelf', '棚'], ['top', '手を入れた順'], ['decks', 'デック一覧']];
  function counts() {
    return { recent: data.recent.length, shelf: (data.shelves || []).reduce((a, s) => a + s.items.length, 0), top: data.topTotal || 0, decks: data.decks.length };
  }
  function render() {
    const c = counts();
    tabsEl.textContent = '';
    for (const [k, label] of TABS) {
      const b = h('button', { class: 'hm-tab' + (!query && st.tab === k ? ' hm-on' : ''), type: 'button', role: 'tab', 'aria-selected': !query && st.tab === k ? 'true' : 'false' }, [label, h('span', { class: 'n', text: String(c[k]) })]);
      b.addEventListener('click', () => { st.tab = k; keep(); if (query) { input.value = ''; query = ''; results = null; } render(); });
      tabsEl.appendChild(b);
    }
    if (query) tabsEl.appendChild(h('button', { class: 'hm-tab hm-on', type: 'button', role: 'tab', 'aria-selected': 'true' }, ['検索結果', h('span', { class: 'n', text: results ? String(results.total) : '…' })]));
    bodyEl.textContent = '';
    if (data.error) bodyEl.appendChild(h('div', { class: 'hm-note', text: '索引を読めませんでした: ' + data.error }));
    if (!loaded) { bodyEl.appendChild(h('div', { class: 'hm-note', text: '読み込み中…' })); return; }
    if (query) bodyEl.appendChild(searchView());
    else if (st.tab === 'shelf') bodyEl.appendChild(shelfView());
    else if (st.tab === 'top') bodyEl.appendChild(topView());
    else if (st.tab === 'decks') bodyEl.appendChild(decksView());
    else bodyEl.appendChild(recentView());
  }

  // ---------- 検索 ----------
  let searchTimer = null, curReq = 0;
  function sendSearch() {
    curReq = ++reqSeq;
    post({ type: 'homeSearch', reqId: curReq, query, sort: query ? 'relevance' : st.sort });
  }
  function onInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = input.value.trim();
      if (q === query) return;
      query = q; results = null;
      render();
      if (query) sendSearch();
    }, 150);
  }
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { input.value = ''; onInput(); } });
  clearBtn.addEventListener('click', () => { input.value = ''; onInput(); input.focus(); });
  chk.addEventListener('change', () => { st.openPreview = chk.checked; keep(); post({ type: 'homeSetPreview', value: chk.checked }); });
  document.addEventListener('keydown', (ev) => { if (ev.key === '/' && document.activeElement !== input && !(ev.target && /input|textarea/i.test(ev.target.tagName))) { ev.preventDefault(); input.focus(); } });

  // ---------- 受信 ----------
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'homeData') {
      data = Object.assign({ recent: [], shelves: [], top: [], topTotal: 0, decks: [] }, m);
      loaded = true;
      if (typeof m.openPreview === 'boolean' && !('openPreview' in saved)) { st.openPreview = m.openPreview; chk.checked = m.openPreview; }
      render();
      if (!query && st.tab === 'top' && st.sort !== 'touched') sendSearch();
    } else if (m.type === 'homeResults') {
      if (m.reqId !== curReq) return;
      if (m.query !== query && query) return;
      results = { total: m.total || 0, items: m.items || [], error: m.error || null };
      render();
    } else if (m.type === 'homeThumbData') onThumbData(m);
    else if (m.type === 'homeRecent') { data.recent = m.recent || []; if (st.tab === 'recent' && !query) render(); }
    else if (m.type === 'homeToast') toast(m.message || '', !!m.warn);
    else if (m.type === 'homeQuery') { input.value = m.query || ''; onInput(); input.focus(); }
  });

  render();
  post({ type: 'homeReady' });
})();
