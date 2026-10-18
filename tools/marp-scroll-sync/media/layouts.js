// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// ブラウザ側：配置案のポップアップ（DESIGN.md 8.3）。
//   スライドを右クリック（またはキー L）→ いまのスライドの svg を複製して section の class だけ差し替えた
//   小さなサムネイルを並べる。再描画も拡張との往復もしないので一瞬で出る（予算 0.4 秒・8.0）。
//   ホバーで現在のスライド本体に一時反映（離すと戻す）、クリックで layoutApply { index, version, cls } を送る。
//
// 頼るもの：
//   window.ssPreview      … preview.js の公開 API { slides, sectionOf, current, post, version, toast, isEditing, onRender, closePopups }。
//                           無ければ何もしない（同期プレビュー本体は動く）。
//   window.__SS_LAYOUTS__ … 判定の表（lib/layout-variants.cjs の browserTable() を拡張が buildHtml で埋め込む）。無ければ何もしない。
//   window.ssDetectOverflow（任意）… はみ出す案に ⚠ を付ける。
// 公開：window.ssLayouts = { open(index, x, y), close(), analyze(section), variants(section), lastMs }
//   （操作ボタン列の「配置」ボタンやコマンドから open(index) を呼べる）
//
// 条件の解き方 matches() は lib/layout-variants.cjs と同じ物。片方を変えたら、もう片方も直して
// test/layouts.test.cjs（原稿からの判定とブラウザでの判定の突き合わせ）を回すこと。
(function () {
  'use strict';
  var P = window.ssPreview;
  var T = window.__SS_LAYOUTS__;
  if (!P || !T || !Array.isArray(T.layouts) || typeof P.slides !== 'function') return;

  var LAY_RE = /^lay-[a-z0-9][a-z0-9-]*$/;
  var ORDER_HEAD = null;
  try { ORDER_HEAD = new RegExp(T.orderHead, 'i'); } catch (_) { ORDER_HEAD = /^[①-⑳]/; }
  var PATTERN = {};
  (T.patternClasses || []).forEach(function (c) { PATTERN[c] = 1; });
  // 判定で数えない行（出典・注記・位置の決まった物）と、透過する包み（.body）。lib/layout-variants.cjs の SIDE_CLASSES / WRAP_*
  var SIDE = T.sideClasses || ['page-title', 'takeaway', 'note'];
  var WRAP = T.wrapClass || null;
  var WRAP_OK = {};
  (T.wrapExtra || []).concat(WRAP ? [WRAP] : []).forEach(function (c) { WRAP_OK[c] = 1; });
  /** 透過する包みか：<div class="body">（縦配分の語は可）。style・id が付いていない。中に地の文が無い（＝中が Markdown として読まれた） */
  function isWrap(el) {
    if (!WRAP || el.tagName.toLowerCase() !== 'div' || !el.classList.contains(WRAP)) return false;
    if (el.hasAttribute('style') || el.hasAttribute('id')) return false;
    if (!Array.prototype.every.call(el.classList, function (c) { return WRAP_OK[c]; })) return false;
    return Array.prototype.every.call(el.childNodes, function (n) { return n.nodeType !== 3 || norm(n.nodeValue) === ''; });
  }
  var NOT_PLAIN = T.notPlainText || 'このスライドは div で組んであるので、配置の切り替えは使えません';
  var THUMB_W = 184;

  var pop = null;        // { el, index, section, original, cards, hoverCls, applied }
  var seq = 0;
  var restoreTimer = null;

  // ───────── 判定（DOM から） ─────────
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function charLen(s) { return Array.from(String(s)).length; }
  function isFigureP(el) {
    if (el.children.length !== 1) return false;
    var c = el.children[0], t = c.tagName.toLowerCase();
    if (t !== 'img' && t !== 'svg') return false;
    return norm(el.textContent) === '' || t === 'svg' && norm(el.textContent) === norm(c.textContent);
  }
  /** section の直下を読み、lib/layout-variants.cjs の analyzeSlide と同じ形の事実を返す */
  function analyze(section) {
    var a = { plain: true, reason: null, lists: 0, items: 0, ordered: false, hasStrongHead: false, headBreak: false, nested: false,
      figures: 0, hasFigure: false, hasTable: false, paragraphs: 0, textChars: 0, maxItemChars: 0, hasTakeaway: false, wrapped: false, layout: null };
    if (!section) { a.plain = false; a.reason = 'empty'; return a; }
    var cl = Array.prototype.slice.call(section.classList || []);
    cl.forEach(function (c) { if (LAY_RE.test(c)) a.layout = c; });
    if (cl.some(function (c) { return PATTERN[c]; })) { a.plain = false; a.reason = 'pattern'; }
    var lists = [];
    var notPlain = function (why) { if (a.plain) { a.plain = false; a.reason = why; } };
    Array.prototype.forEach.call(section.children, function (el) {
      var t = el.tagName.toLowerCase();
      var c = el.classList;
      if (t === 'header' || t === 'footer' || t === 'style' || t === 'script') return;
      if (c.contains('page-title') || c.contains('note')) return;
      if (c.contains('takeaway')) { a.hasTakeaway = true; return; }
      if (/^(marp-)?h[1-6]$/.test(t)) return;
      if (t === 'ul' || t === 'ol') { lists.push(el); return; }
      if (t === 'figure' || t === 'svg' || t === 'img') { a.figures++; return; }
      if (t === 'table') { a.hasTable = true; return; }
      if (t === 'p') {
        if (isFigureP(el)) { a.figures++; return; }
        var s = norm(el.textContent);
        if (s) { a.paragraphs++; a.textChars += charLen(s); }
        return;
      }
      if (t === 'blockquote') { var q = norm(el.textContent); if (q) { a.paragraphs++; a.textChars += charLen(q); } return; }
      if (t === 'pre' || t === 'marp-pre') { notPlain('code'); return; }
      notPlain('div');
    });
    a.lists = lists.length;
    a.hasFigure = a.figures > 0;
    if (lists.length === 1) {
      var L = lists[0];
      var lis = Array.prototype.filter.call(L.children, function (x) { return x.tagName.toLowerCase() === 'li'; });
      a.items = lis.length;
      a.nested = lis.some(function (li) { return !!li.querySelector('ul, ol'); });
      var texts = lis.map(function (li) { return norm(li.textContent); });
      a.ordered = L.tagName.toLowerCase() === 'ol' || (texts.length > 0 && texts.every(function (s) { return ORDER_HEAD.test(s); }));
      a.hasStrongHead = lis.length > 0 && lis.every(function (li) { var f = li.firstElementChild; return !!f && /^(strong|b)$/i.test(f.tagName) && li.firstChild === f; });
      a.headBreak = lis.some(function (li) { return !!li.querySelector(':scope > strong:first-child + br'); });
      a.maxItemChars = texts.reduce(function (mx, s) { return Math.max(mx, charLen(s)); }, 0);
    } else if (lists.some(function (L) { return !!L.querySelector('li ul, li ol'); })) a.nested = true;
    if (a.plain && !a.lists && !a.figures && !a.paragraphs && !a.hasTable) { a.plain = false; a.reason = 'empty'; }
    return a;
  }
  /** lib/layout-variants.cjs の matches と同じ */
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
  function variantsOf(a) {
    if (!a || !a.plain) return [];
    var base = T.base || { cls: null, label: '標準', why: '' };
    var out = [{ cls: null, label: base.label, why: base.why, current: !a.layout, fits: true }];
    T.layouts.forEach(function (v) {
      var ok = matches(a, v.when || {});
      if (!ok && a.layout !== v.cls) return;
      out.push({ cls: v.cls, label: v.label, why: v.why, current: a.layout === v.cls, fits: ok });
    });
    return out;
  }

  // ───────── class の差し替え ─────────
  function withLayout(className, cls) {
    var keep = String(className || '').split(/\s+/).filter(function (c) { return c && !LAY_RE.test(c); });
    if (cls) keep.push(cls);
    return keep.join(' ');
  }

  // ───────── サムネイル（いまの svg を複製） ─────────
  /** 複製の中の id に接尾辞を付け、url(#…)・href="#…" も付け替える（同じ id が並ぶとグラデーションや矢じりが化ける） */
  function suffixIds(root, sfx) {
    var withId = root.querySelectorAll('[id]');
    if (!withId.length) return;
    var map = Object.create(null);
    var n = 0;
    Array.prototype.forEach.call(withId, function (el) { map[el.id] = el.id + sfx; el.id = el.id + sfx; n++; });
    if (!n) return;
    var urlRe = /url\(\s*(["']?)#([^)"'\s]+)\1\s*\)/g;
    var fixUrl = function (v) { return v.replace(urlRe, function (m, q, id) { return map[id] ? 'url(' + q + '#' + map[id] + q + ')' : m; }); };
    var REF = { href: 1, 'xlink:href': 1 };
    var LIST = { 'aria-labelledby': 1, 'aria-describedby': 1, 'for': 1, headers: 1 };
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i], at = el.attributes;
      if (el.tagName.toLowerCase() === 'style') { if (el.textContent.indexOf('#') >= 0) el.textContent = fixUrl(el.textContent); continue; }
      for (var j = 0; j < at.length; j++) {
        var name = at[j].name, v = at[j].value;
        if (name === 'id' || !v || v.indexOf('#') < 0 && !LIST[name]) continue;
        if (REF[name]) { if (v.charAt(0) === '#' && map[v.slice(1)]) at[j].value = '#' + map[v.slice(1)]; }
        else if (LIST[name]) at[j].value = v.split(/\s+/).map(function (x) { return map[x] || x; }).join(' ');
        else if (v.indexOf('url(') >= 0) at[j].value = fixUrl(v);
      }
    }
  }
  function makeThumb(svg, cls, sfx) {
    var c = svg.cloneNode(true);
    c.removeAttribute('data-marpit-svg');      // preview.js の slides() に数えさせない
    c.removeAttribute('id');
    c.removeAttribute('style');
    c.setAttribute('class', 'ss-lay-svg');
    c.setAttribute('aria-hidden', 'true');
    // 編集の印・重い物を落とす
    Array.prototype.forEach.call(c.querySelectorAll('[contenteditable]'), function (e) { e.removeAttribute('contenteditable'); });
    Array.prototype.forEach.call(c.querySelectorAll('.ss-hover, .ss-editing, .ss-svg-hidden'), function (e) { e.classList.remove('ss-hover', 'ss-editing', 'ss-svg-hidden'); });
    Array.prototype.forEach.call(c.querySelectorAll('video, audio, iframe, object, embed'), function (e) {
      var ph = document.createElement('div');
      ph.className = 'ss-lay-media';
      var st = e.getAttribute('style'); if (st) ph.setAttribute('style', st);
      e.parentNode.replaceChild(ph, e);
    });
    var sec = P.sectionOf(c) || c.querySelector('section');
    if (sec) sec.className = withLayout(sec.className, cls);
    suffixIds(c, sfx);
    return { svg: c, section: sec };
  }

  // ───────── ポップアップ ─────────
  function restore() {
    if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }
    if (pop && pop.section && pop.section.isConnected && pop.section.className !== pop.original) pop.section.className = pop.original;
  }
  function close(keepPreview) {
    if (!pop) return;
    var p = pop;
    if (!keepPreview) restore();
    pop = null;
    try { p.el.remove(); } catch (_) { /* 無視 */ }
    if (keepPreview) {
      // 書き戻しの再描画が来れば DOM ごと入れ替わる。来なかったとき（断られた）は元の配置へ戻す
      restoreTimer = setTimeout(function () {
        restoreTimer = null;
        if (p.section && p.section.isConnected) p.section.className = p.original;
      }, 1500);
    }
  }
  function preview(cls, on) {
    if (!pop || !pop.section || !pop.section.isConnected) return;
    pop.section.className = on ? withLayout(pop.original, cls) : pop.original;
  }
  function apply(v) {
    if (!pop) return;
    var index = pop.index;
    if (v.current) { close(false); return; }
    preview(v.cls, true);
    P.post({ type: 'layoutApply', index: index, version: P.version(), cls: v.cls });
    close(true);
  }
  function place(el, x, y) {
    var r = el.getBoundingClientRect();
    var W = window.innerWidth, H = window.innerHeight, M = 8;
    var left = Math.max(M, Math.min(x, W - r.width - M));
    var top = Math.max(M, Math.min(y, H - r.height - M));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
  function open(index, x, y) {
    var t0 = performance.now();
    var list = P.slides();
    if (!Number.isInteger(index)) index = P.current();
    var svg = list[index];
    if (!svg) return false;
    if (typeof P.closePopups === 'function') { try { P.closePopups(); } catch (_) { /* 無視 */ } }
    close(false);
    if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }
    var section = P.sectionOf(svg);
    var a = analyze(section);
    var vs = variantsOf(a);

    var el = document.createElement('div');
    el.className = 'ss-lay-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', '配置案');
    var head = document.createElement('div');
    head.className = 'ss-lay-head';
    head.textContent = '配置案（スライド ' + (index + 1) + '）';
    el.appendChild(head);
    pop = { el: el, index: index, section: section, original: section ? section.className : '', cards: [] };

    if (!vs.length || vs.length === 1 && !a.layout) {
      var msg = document.createElement('div');
      msg.className = 'ss-lay-msg';
      msg.textContent = vs.length ? 'このスライドの内容に合う配置案は、いまのところありません' : NOT_PLAIN;
      el.appendChild(msg);
    } else {
      var grid = document.createElement('div');
      grid.className = 'ss-lay-grid';
      var why = document.createElement('div');
      why.className = 'ss-lay-why';
      var mySeq = ++seq;
      var cur = vs.filter(function (v) { return v.current; })[0] || vs[0];
      var showWhy = function (v) { why.textContent = v.label + '：' + v.why + (v.over ? '　⚠ この配置では本文がはみ出します' : '') + (v.fits === false ? '　（いまの内容には向きません）' : ''); };
      vs.forEach(function (v, i) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'ss-lay-card' + (v.current ? ' ss-lay-current' : '');
        card.setAttribute('data-cls', v.cls || '');
        card.title = v.why;
        var box = document.createElement('div');
        box.className = 'marpit ss-lay-thumb';     // デックの CSS は div.marpit > svg > foreignObject > section に当たる
        var th = makeThumb(svg, v.cls, '-ssl' + mySeq + '-' + i);
        box.appendChild(th.svg);
        var name = document.createElement('div');
        name.className = 'ss-lay-name';
        name.textContent = v.label + (v.current ? '（いま）' : '');
        card.appendChild(box); card.appendChild(name);
        card.addEventListener('mouseenter', function () { showWhy(v); if (!P.isEditing()) preview(v.cls, true); });
        card.addEventListener('mouseleave', function () { showWhy(cur); preview(null, false); });
        card.addEventListener('focus', function () { showWhy(v); });
        card.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); apply(v); });
        grid.appendChild(card);
        pop.cards.push({ v: v, card: card, section: th.section, name: name });
      });
      showWhy(cur);
      el.appendChild(grid);
      el.appendChild(why);
      var hint = document.createElement('div');
      hint.className = 'ss-lay-hint';
      hint.textContent = '乗せると本体で確かめられます。クリックで決定、Esc で閉じます';
      el.appendChild(hint);
    }
    document.body.appendChild(el);
    if (typeof x !== 'number' || typeof y !== 'number') {
      var sr = svg.getBoundingClientRect();
      x = sr.left + 24; y = Math.max(8, sr.top + 24);
    }
    place(el, x, y);
    api.lastMs = performance.now() - t0;

    // はみ出しの判定は、出したあとで（表示を待たせない）
    var mine = pop;
    var check = function () {
      if (pop !== mine || typeof window.ssDetectOverflow !== 'function') return;
      var t1 = performance.now();
      mine.cards.forEach(function (c) {
        var r = null;
        try { r = window.ssDetectOverflow(c.section); } catch (_) { /* その案は「分からない」 */ }
        if (r && r.overflow && !r.pending) {
          c.v.over = true;
          c.card.classList.add('ss-lay-over');
          c.card.setAttribute('data-over', '1');
          if (!c.name.querySelector('.ss-lay-warn')) {
            var w = document.createElement('span');
            w.className = 'ss-lay-warn'; w.textContent = '⚠'; w.title = 'この配置では本文がはみ出します';
            c.name.insertBefore(w, c.name.firstChild);
          }
        }
      });
      mine.el.setAttribute('data-checked', '1');
      api.lastCheckMs = performance.now() - t1;
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(function () { setTimeout(check, 0); }); else setTimeout(check, 0);
    return true;
  }

  // ───────── 入口 ─────────
  function slideIndexOf(target) {
    if (!target || !target.closest) return -1;
    if (target.closest('.ss-lay-pop')) return -1;
    var svg = target.closest('svg[data-marpit-svg]');
    if (!svg) return -1;
    return P.slides().indexOf(svg);
  }
  window.addEventListener('contextmenu', function (ev) {
    var t = ev.target;
    if (t && t.closest && t.closest('.ss-lay-pop')) { ev.preventDefault(); return; }
    if (P.isEditing()) return;                                    // 編集中は既定のメニュー（貼り付け・スペルチェック）
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName || ''))) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim() !== '') return; // 文字を選択中は既定のメニュー（コピー）
    var i = slideIndexOf(t);
    if (i < 0) return;
    ev.preventDefault();
    open(i, ev.clientX, ev.clientY);
  });
  // capture：ポップアップが開いている間のキーを preview.js（j/k でスライド送り）へ流さない
  window.addEventListener('keydown', function (ev) {
    if (pop) {
      var k = ev.key;
      if (k === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); close(false); return; }
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      var cards = pop.cards.map(function (c) { return c.card; });
      var at = cards.indexOf(document.activeElement);
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowUp') {
        ev.preventDefault(); ev.stopImmediatePropagation();
        if (!cards.length) return;
        var d = (k === 'ArrowRight' || k === 'ArrowDown') ? 1 : -1;
        var nx = at < 0 ? Math.max(0, pop.cards.findIndex(function (c) { return c.v.current; })) : (at + d + cards.length) % cards.length;
        cards[nx].focus();
        preview(pop.cards[nx].v.cls, true);
        return;
      }
      if (k === 'Enter' || k === ' ') {
        if (at >= 0) { ev.preventDefault(); ev.stopImmediatePropagation(); apply(pop.cards[at].v); }
        return;
      }
      ev.stopImmediatePropagation();   // そのほかのキーも下へ流さない
      return;
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key !== 'l' && ev.key !== 'L') return;
    var t = ev.target;
    if (P.isEditing() || (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName || '')))) return;
    if (document.querySelector('.ss-gallery.ss-open, .ss-pop.ss-open')) return;   // ほかのポップアップの検索欄などを邪魔しない
    ev.preventDefault(); ev.stopImmediatePropagation();
    open(P.current());
  }, true);
  window.addEventListener('mousedown', function (ev) {
    if (pop && !(ev.target && ev.target.closest && ev.target.closest('.ss-lay-pop'))) close(false);
  }, true);
  window.addEventListener('ss-close-popups', function () { close(false); });
  window.addEventListener('blur', function () { close(false); });
  window.addEventListener('scroll', function (ev) { if (pop && !(ev.target && ev.target.closest && ev.target.closest('.ss-lay-pop'))) close(false); }, true);
  // 描き直されたら、複製元の DOM はもう無い
  try {
    P.onRender(function () {
      if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }
      if (pop) { pop.section = null; close(false); }
    });
  } catch (_) { /* 無くても動く */ }

  var api = { open: open, close: function () { close(false); }, analyze: analyze, variants: function (section) { return variantsOf(analyze(section)); }, lastMs: null, lastCheckMs: null };
  window.ssLayouts = api;
})();
