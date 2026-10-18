// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// ブラウザ側：Alt で箱を動かす・大きさを変える（DESIGN.md 9.1 / 9.2 / 9.4）。
//   Alt を押している間、ポインタの下の要素に枠と札（タグ名.クラス 幅×高さ）を出す。Alt+クリックで選択（8 つのハンドル）。
//   ドラッグ＝移動（style.translate）、ハンドル＝大きさ（style.width / height）。ドラッグ中は Webview の中だけで
//   要素の style を直接書き換え（1 フレーム 1 回）、離したときに 1 回だけ boxCommit { index, version, target, style } を送る。
//   値は 1280×720（スライドの viewBox）の座標系の整数 px。
//   トリミング（画像だけ）：選んで C キーか札の右の「✂ 切る」。ハンドルは見える範囲の縁を動かす（clip-path: inset と、
//   切った分だけ詰める margin-*）。Enter・外側クリックで確定（boxCommit 1 回）、Esc で取り消し、0 でトリミングを外す。
//
// 頼るもの：
//   window.ssPreview … preview.js の公開 API { slides, sectionOf, current, post, version, toast, isEditing, onRender, closePopups }。
//                      無ければ何もしない（同期プレビュー本体は動く）。
// 排他の仕組み：preview.js の click / dblclick / mouseover / mousemove は document、layouts.js の contextmenu と
//   preview.js の keydown は window の泡の段で聞いている。ここは全部 window の capture で先に受け、
//   箱の操作に使った分だけ stopImmediatePropagation する（preview.js 側には手を入れない）。
// 公開：window.ssBoxEdit = { select(el), deselect(), selected(), targetOf(el), flush(), cropState(), stats }
(function () {
  'use strict';
  var P = window.ssPreview;
  if (!P || typeof P.slides !== 'function' || typeof P.sectionOf !== 'function' || typeof P.post !== 'function') return;

  var SNAP_PX = 6;          // 吸着する距離（画面の px）
  var KEY_IDLE_MS = 400;    // キー操作はこの時間の無操作で 1 回にまとめて送る
  var MIN_SIZE = 8;         // これより小さくはしない
  var KEEP_RATIO = { img: 1, svg: 1, video: 1, canvas: 1 };
  var DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  var MSG_MD = 'この箱は原稿で直してください（Markdown の要素）';
  var MSG_SVG = 'この箱は原稿で直してください（SVG の中の図形）';
  var MSG_MDIMG = 'Markdown の画像は大きさだけ変えられます';
  var MSG_CROP_IMG = 'トリミングできるのは画像（<img>）だけです';
  var MSG_CROP_INLINE = '文と同じ段落にある Markdown の画像はトリミングできません（画像だけの段落にしてください）';
  var MSG_CROP_FILTER = 'フィルタ（sepia など）の付いた Markdown の画像はトリミングできません。原稿で <img> に書き換えてください';
  var MSG_CROP_EDGE = '矢印で動かす縁は、先にハンドルをつかんで選んでください';
  var MSG_CONVERTED = 'Markdown の画像を <img> に書き換えました';
  var MSG_AUTO = '左右の中央寄せ（margin: auto）を、今の位置の数値にしました';

  var stats = { hoverMs: 0, frameMs: 0, frameMaxMs: 0, commitMs: 0, frames: 0 };

  // ───────── 重ねる UI（.ss-ui＝preview.js の逆引き・編集の対象外） ─────────
  function h(tag, cls) { var e = document.createElement(tag); e.className = cls; return e; }
  var layer = h('div', 'ss-ui ss-box-layer');
  var hoverBox = h('div', 'ss-box-hover');
  var hoverTag = h('div', 'ss-box-tag');
  var selBox = h('div', 'ss-box-sel');
  var selTag = h('div', 'ss-box-tag ss-box-tag-sel');
  var guideV = h('div', 'ss-box-guide ss-box-guide-v');
  var guideH = h('div', 'ss-box-guide ss-box-guide-h');
  var ghost = h('img', 'ss-box-ghost');          // トリミング中：切られる部分に元の画像を暗く重ねる
  var cropBtn = h('div', 'ss-box-cropbtn');      // 札の右の「✂ 切る」／トリミング中は「✓ 確定」
  ghost.alt = '';
  DIRS.forEach(function (d) { var k = h('div', 'ss-box-handle ss-box-h-' + d); k.setAttribute('data-dir', d); selBox.appendChild(k); });
  [hoverBox, hoverTag, guideV, guideH, ghost, selBox, selTag, cropBtn].forEach(function (e) { e.style.display = 'none'; layer.appendChild(e); });
  document.body.appendChild(layer);

  // ───────── 状態 ─────────
  var altDown = false;
  var lastXY = null;        // 直近のポインタ位置（Alt を押した瞬間に枠を出すため）
  var hoverEl = null;
  var sel = null;           // { el, target, index, refused, downStack:[] }
  var drag = null;          // 進行中のドラッグ
  var keyBatch = null;      // { before, timer }
  var lastCommit = null;    // { el, before } editResult ok:false で戻す相手
  var swallow = 0;          // この時刻までの mouseup / click / dblclick を握りつぶす
  var rafId = 0;
  var altAt = 0;
  var crop = null;          // トリミング中 { el, before, prev, cut:[上,右,下,左], base, fall, autoX, last, important, full }
  var pendingConvert = null; // Markdown の画像を <img> へ書き換える確定を送った { index }

  // ───────── 要素の判定 ─────────
  function tagOf(el) { return el && el.tagName ? String(el.tagName).toLowerCase() : ''; }
  function inLayer(t) { return !!(t && t.closest && t.closest('.ss-box-layer')); }
  function inUi(t) { return !!(t && t.closest && t.closest('.ss-ui')); }
  function slideSvgOf(el) { return el && el.closest ? el.closest('div.marpit > svg[data-marpit-svg]') : null; }
  function sectionOfEl(el) { var svg = slideSvgOf(el); return svg ? P.sectionOf(svg) : null; }
  function isSvgInner(el) {   // インライン SVG の中の図形（外側の <svg> 自身は箱として扱う）
    return !!(el && el.namespaceURI === 'http://www.w3.org/2000/svg' && tagOf(el) !== 'svg')
      || !!(el && tagOf(el) === 'svg' && el.parentNode && el.parentNode.namespaceURI === 'http://www.w3.org/2000/svg' && tagOf(el.parentNode) !== 'foreignobject');
  }
  /** ポインタの下から、箱として扱える要素を返す（section 自身・header・footer・style・背景は除く） */
  function pickable(t) {
    if (!t || t.nodeType !== 1) t = t && t.parentElement;
    if (!t || inUi(t)) return null;
    var sec = sectionOfEl(t);
    if (!sec || t === sec || !sec.contains(t)) return null;
    if (t.closest('style, script, [data-marpit-advanced-background-container]')) return null;
    var hf = t.closest('header, footer');
    if (hf && hf.parentNode === sec) return null;   // Marp のヘッダー・フッター（デックの frontmatter 由来。原稿の位置が無い）
    return t;
  }
  function elementAt(x, y) {
    var list = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (var i = 0; i < list.length; i++) { if (!inLayer(list[i])) return pickable(list[i]); }
    return null;
  }
  function basenameOf(src) {
    var s = String(src || '').split(/[?#]/)[0];
    s = s.slice(s.lastIndexOf('/') + 1);
    try { return decodeURIComponent(s); } catch (_) { return s; }
  }
  /** 書き戻しの宛先。書けない要素は { refuse: 理由 } */
  function targetOf(el) {
    var sec = sectionOfEl(el);
    if (!sec) return { refuse: MSG_MD };
    if (isSvgInner(el)) return { refuse: MSG_SVG };
    var tag = tagOf(el);
    if (el.hasAttribute('data-hline')) {
      var hline = parseInt(el.getAttribute('data-hline'), 10);
      if (!isFinite(hline)) return { refuse: MSG_MD };
      var same = sec.querySelectorAll('[data-hline="' + hline + '"]');
      var nth = Array.prototype.indexOf.call(same, el);
      if (nth < 0) return { refuse: MSG_MD };
      return { kind: 'html', hline: hline, nth: nth, tag: tag };
    }
    if (tag === 'img') {
      var p = el.closest('[data-line]');
      if (p && sec.contains(p)) {
        var line = parseInt(p.getAttribute('data-line'), 10);
        var imgs = p.querySelectorAll('img');
        var n = Array.prototype.indexOf.call(imgs, el);
        var src = el.getAttribute('src') || '';
        // src は描画後の URI（webview の URI）なので、原稿側はファイル名の末尾一致で照合する
        if (isFinite(line) && n >= 0) return { kind: 'mdimg', line: line, nth: n, src: src, basename: basenameOf(src) };
      }
    }
    return { refuse: MSG_MD };
  }
  function findByTarget(sec, t) {
    if (!sec || !t) return null;
    if (t.kind === 'html') {
      var e = sec.querySelectorAll('[data-hline="' + t.hline + '"]')[t.nth];
      return e && tagOf(e) === t.tag ? e : null;
    }
    if (t.kind === 'mdimg') {
      var ps = sec.querySelectorAll('[data-line="' + t.line + '"]');
      for (var i = 0; i < ps.length; i++) {
        var im = ps[i].querySelectorAll('img')[t.nth];
        if (im && basenameOf(im.getAttribute('src')) === t.basename) return im;
      }
    }
    return null;
  }
  function findConverted(sec, t) {
    var list = sec ? sec.querySelectorAll('img[data-hline="' + t.line + '"]') : [];
    for (var i = 0; i < list.length; i++) if (basenameOf(list[i].getAttribute('src')) === t.basename) return list[i];
    return null;
  }
  function writableAncestor(el) {
    var sec = sectionOfEl(el);
    for (var p = el && el.parentElement; p && sec && p !== sec && sec.contains(p); p = p.parentElement) {
      if (pickable(p) && !targetOf(p).refuse) return p;
    }
    return null;
  }

  // ───────── 座標 ─────────
  /** 表示の縮小率 k（画面 px ÷ スライド px）と section の画面上の枠 */
  function metrics(el) {
    var svg = slideSvgOf(el), sec = svg && P.sectionOf(svg);
    if (!sec) return null;
    var r = sec.getBoundingClientRect();
    var vb = svg.viewBox && svg.viewBox.baseVal;
    var W = vb && vb.width ? vb.width : 1280, H = vb && vb.height ? vb.height : 720;
    var k = r.width / W;
    return k > 0 ? { k: k, sec: sec, rect: r, W: W, H: H } : null;
  }
  /** 要素の枠を、スライドの座標系（section の左上が原点）で返す */
  function slideRect(el, m) {
    var r = el.getBoundingClientRect();
    return { l: (r.left - m.rect.left) / m.k, t: (r.top - m.rect.top) / m.k, w: r.width / m.k, h: r.height / m.k };
  }
  function parseTranslate(v) {
    v = String(v || '').trim();
    if (!v || v === 'none') return [0, 0];
    var a = v.split(/\s+/), x = parseFloat(a[0]), y = a.length > 1 ? parseFloat(a[1]) : 0;
    if (/%/.test(a[0])) x = 0;
    if (a[1] && /%/.test(a[1])) y = 0;
    return [isFinite(x) ? x : 0, isFinite(y) ? y : 0];
  }

  // ───────── style の読み書き（translate / width / height の 3 つだけ触る） ─────────
  var PROPS = ['translate', 'width', 'height'];
  var CROP_PROPS = ['clip-path', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
  var SIDES = ['top', 'right', 'bottom', 'left'];
  function snapshot(el, props) {
    var s = {};
    (props || PROPS).forEach(function (p) { s[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]; });
    return s;
  }
  function restore(el, s, props) {
    (props || PROPS).forEach(function (p) { if (s[p][0]) el.style.setProperty(p, s[p][0], s[p][1]); else el.style.removeProperty(p); });
    if (el.getAttribute('style') === '') el.removeAttribute('style');
  }
  function sameSnap(a, b, props) { return (props || PROPS).every(function (p) { return a[p][0] === b[p][0] && a[p][1] === b[p][1]; }); }
  /** inset(上 右 下 左) を [上,右,下,左]（px）に。px と 0 以外（% や round）は読まない＝null */
  function parseInset(v) {
    var m = /^\s*inset\(\s*([^)]*?)\s*\)\s*$/.exec(String(v || ''));
    if (!m || /round/.test(m[1])) return null;
    var a = m[1].split(/\s+/).map(function (x) { return /^-?[\d.]+(px)?$/.test(x) ? parseFloat(x) : NaN; });
    if (!a.length || a.length > 4 || a.some(function (x) { return !isFinite(x); })) return null;
    var t = a[0], r = a.length > 1 ? a[1] : t, b = a.length > 2 ? a[2] : t, l = a.length > 3 ? a[3] : r;
    return [t, r, b, l];
  }
  /** いま見えている範囲の切り量（トリミング中はその値。画像だけ） */
  function insetOf(el) {
    if (crop && crop.el === el) return crop.cut;
    return tagOf(el) === 'img' ? parseInset(el.style.getPropertyValue('clip-path')) : null;
  }
  function anyCut(c) { return !!(c && (c[0] || c[1] || c[2] || c[3])); }
  /** 画面上の枠。切ってある画像は見えている範囲（枠と札は見た目に合わせる） */
  function visRect(el) {
    var r = el.getBoundingClientRect(), c = insetOf(el);
    if (!anyCut(c)) return r;
    var m = metrics(el), k = m ? m.k : 1;
    var l = r.left + c[3] * k, t = r.top + c[0] * k;
    var w = Math.max(0, r.width - (c[1] + c[3]) * k), hh = Math.max(0, r.height - (c[0] + c[2]) * k);
    return { left: l, top: t, width: w, height: hh, right: l + w, bottom: t + hh };
  }
  function setPx(el, prop, v, imp) { el.style.setProperty(prop, v, imp ? 'important' : ''); }
  function writeTranslate(el, x, y, imp) {
    if (!x && !y) el.style.removeProperty('translate'); else setPx(el, 'translate', x + 'px ' + y + 'px', imp);
  }
  /** いまの inline style から、送る値を読む（無ければ null） */
  function readStyle(el) {
    var tr = el.style.getPropertyValue('translate'), w = el.style.getPropertyValue('width'), hh = el.style.getPropertyValue('height');
    var t = tr ? parseTranslate(tr) : null;
    return {
      translate: t && (t[0] || t[1]) ? [Math.round(t[0]), Math.round(t[1])] : null,
      width: /px$/.test(w) ? Math.round(parseFloat(w)) : null,
      height: /px$/.test(hh) ? Math.round(parseFloat(hh)) : null,
    };
  }
  /** 書いた値が computed に出ていなければ、デック側の !important に負けている → !important つきで書き直す */
  function checkImportant(el, g) {
    var cs = getComputedStyle(el), need = false;
    var st = readStyle(el);
    if (st.width != null && !el.style.getPropertyPriority('width')) {
      var cw = parseFloat(cs.width);
      if (isFinite(cw) && Math.abs(cw - st.width) > 0.75 && cssBeats(el, 'width', st.width)) need = true;
    }
    if (!need && st.height != null && !el.style.getPropertyPriority('height')) {
      var ch = parseFloat(cs.height);
      if (isFinite(ch) && Math.abs(ch - st.height) > 0.75 && cssBeats(el, 'height', st.height)) need = true;
    }
    if (!need && st.translate && !el.style.getPropertyPriority('translate')) {
      var ct = parseTranslate(cs.translate);
      if (Math.abs(ct[0] - st.translate[0]) > 0.75 || Math.abs(ct[1] - st.translate[1]) > 0.75) need = true;
    }
    if (need) g.important = true;
    return need;
  }
  /** !important を付けたら値が通るか（max-width などで頭打ちのときは付けても変わらないので付けない） */
  function cssBeats(el, prop, v) {
    var old = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
    el.style.setProperty(prop, v + 'px', 'important');
    var got = parseFloat(getComputedStyle(el)[prop]);
    el.style.setProperty(prop, old[0], old[1]);
    return isFinite(got) && Math.abs(got - v) <= 0.75;
  }

  // ───────── 枠と札 ─────────
  function labelOf(el, m, extra) {
    var cls = '';
    var cn = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
    cn.split(/\s+/).forEach(function (c) { if (c && !/^ss-/.test(c)) cls += '.' + c; });
    var r = slideRect(el, m);
    return tagOf(el) + cls + '  ' + Math.round(r.w) + '×' + Math.round(r.h) + (extra || '');
  }
  function place(box, tag, el, text) {
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    tag.textContent = text;
    tag.style.display = 'block';
    var ty = r.top - 22;
    if (ty < 2) ty = Math.min(r.bottom + 4, window.innerHeight - 22);
    tag.style.left = Math.max(2, Math.min(r.left, window.innerWidth - 40)) + 'px';
    tag.style.top = ty + 'px';
  }
  function hideHover() {
    hoverEl = null;
    hoverBox.style.display = 'none'; hoverTag.style.display = 'none';
  }
  function showHover(el) {
    if (el === hoverEl && el) { return; }
    if (!el || (sel && sel.el === el && !sel.refused)) { hideHover(); return; }
    var m = metrics(el);
    if (!m) { hideHover(); return; }
    hoverEl = el;
    place(hoverBox, hoverTag, el, labelOf(el, m));
  }
  function refreshSel(extra) {
    if (!sel || !sel.el.isConnected) { selBox.style.display = 'none'; selTag.style.display = 'none'; return; }
    var m = metrics(sel.el);
    if (!m) return;
    place(selBox, selTag, sel.el, labelOf(sel.el, m, extra));
    selBox.classList.toggle('ss-box-refused', !!sel.refused);
    selBox.classList.toggle('ss-box-mdimg', !!(sel.target && sel.target.kind === 'mdimg'));
  }
  function hideGuides() { guideV.style.display = 'none'; guideH.style.display = 'none'; }
  function showGuides(m, gx, gy) {
    if (gx == null) guideV.style.display = 'none';
    else { guideV.style.display = 'block'; guideV.style.left = (m.rect.left + gx * m.k) + 'px'; guideV.style.top = m.rect.top + 'px'; guideV.style.height = m.rect.height + 'px'; }
    if (gy == null) guideH.style.display = 'none';
    else { guideH.style.display = 'block'; guideH.style.top = (m.rect.top + gy * m.k) + 'px'; guideH.style.left = m.rect.left + 'px'; guideH.style.width = m.rect.width + 'px'; }
  }

  // ───────── 選択 ─────────
  function setRoot() {
    var c = document.documentElement.classList;
    c.toggle('ss-box-alt', altDown);
    c.toggle('ss-box-on', !!sel);
    c.toggle('ss-box-drag', !!drag);
  }
  function select(el, keepStack) {
    flushKeys();
    if (!el) { deselect(); return false; }
    var t = targetOf(el);
    var svg = slideSvgOf(el);
    var index = P.slides().indexOf(svg);
    if (index < 0) { deselect(); return false; }
    try { if (typeof P.closePopups === 'function') P.closePopups(); } catch (_) { /* 無くても動く */ }
    var stack = keepStack && sel ? sel.downStack : [];
    sel = { el: el, target: t.refuse ? null : t, index: index, refused: t.refuse || null, downStack: stack };
    hideHover();
    refreshSel();
    setRoot();
    if (t.refuse) {
      // 選択はしない（ハンドルなしの点線だけ残し、Alt+↑ で書き戻せる親へ上がれるようにする）
      var up = writableAncestor(el);
      try { P.toast(t.refuse + (up ? '。Alt+↑ で外側の箱を選べます' : ''), true); } catch (_) { /* 無視 */ }
      return false;
    }
    return true;
  }
  function deselect() {
    flushKeys();
    if (drag) cancelDrag();
    sel = null;
    selBox.style.display = 'none'; selTag.style.display = 'none';
    hideGuides();
    setRoot();
  }
  function goParent() {
    if (!sel) return;
    var up = writableAncestor(sel.el);
    if (!up) { try { P.toast('これより外側に、動かせる箱はありません'); } catch (_) {} return; }
    var stack = sel.downStack.concat([sel.el]);
    select(up, true);
    if (sel) sel.downStack = stack;
  }
  function goChild() {
    if (!sel || !sel.downStack.length) return;
    var stack = sel.downStack.slice(), child = stack.pop();
    if (!child.isConnected) { sel.downStack = []; return; }
    select(child, true);
    if (sel) sel.downStack = stack;
  }

  // ───────── 確定（boxCommit を 1 回） ─────────
  function commit(el, before, important) {
    var t0 = performance.now();
    if (!sel || sel.el !== el || !sel.target) return false;
    var after = snapshot(el);
    if (sameSnap(before, after)) return false;   // 変化が無ければ送らない
    var st = readStyle(el), b = { el: el, s: before };
    var style = {};
    // 触っていない宣言は送らない（undefined＝触らない）。消えた宣言は null
    if (before.translate[0] !== after.translate[0] || before.translate[1] !== after.translate[1]) style.translate = st.translate;
    if (before.width[0] !== after.width[0] || before.width[1] !== after.width[1]) style.width = st.width;
    if (before.height[0] !== after.height[0] || before.height[1] !== after.height[1]) style.height = st.height;
    style.important = !!important;
    lastCommit = { el: b.el, before: b.s };
    P.post({ type: 'boxCommit', index: sel.index, version: P.version(), target: sel.target, style: style });
    stats.commitMs = performance.now() - t0;
    return true;
  }
  function resetBox() {
    if (!sel || !sel.target) return;
    flushKeys();
    var el = sel.el, before = snapshot(el);
    if (!before.translate[0] && !before.width[0] && !before.height[0]) return;   // 元のまま
    PROPS.forEach(function (p) { el.style.removeProperty(p); });
    if (el.getAttribute('style') === '') el.removeAttribute('style');
    lastCommit = { el: el, before: before };
    P.post({ type: 'boxCommit', index: sel.index, version: P.version(), target: sel.target,
      style: { translate: null, width: null, height: null, important: false } });
    refreshSel();
  }

  // ───────── ドラッグ ─────────
  function startGesture(el) {
    var m = metrics(el);
    if (!m) return null;
    var cs = getComputedStyle(el);
    var r = slideRect(el, m);
    var cw = parseFloat(cs.width), ch = parseFloat(cs.height);
    var inlineLike = !isFinite(cw) || !isFinite(ch);
    return {
      el: el, m: m, before: snapshot(el), important: false, checked: false,
      t0: parseTranslate(cs.translate), r0: r,
      w0: isFinite(cw) ? cw : r.w, h0: isFinite(ch) ? ch : r.h, inlineLike: inlineLike,
      snaps: null,
    };
  }
  /** 吸着の相手：section の中央線・兄弟の端・元の位置（translate 0） */
  function snapLines(g) {
    if (g.snaps) return g.snaps;
    var xs = [g.m.W / 2], ys = [g.m.H / 2];
    var par = g.el.parentElement;
    if (par) {
      var kids = par.children;
      for (var i = 0; i < kids.length && i < 40; i++) {
        var c = kids[i];
        if (c === g.el || /^(style|script)$/.test(tagOf(c))) continue;
        var r = slideRect(c, g.m);
        if (!r.w && !r.h) continue;
        xs.push(r.l, r.l + r.w); ys.push(r.t, r.t + r.h);
      }
    }
    // 元の位置＝translate を外した場所
    var ox = g.r0.l - g.t0[0], oy = g.r0.t - g.t0[1];
    g.snaps = { xs: xs, ys: ys, ox: ox, oy: oy };
    return g.snaps;
  }
  function nearest(cands, edges, tol) {
    var best = null;
    for (var i = 0; i < edges.length; i++) for (var j = 0; j < cands.length; j++) {
      var d = cands[j] - edges[i];
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d, at: cands[j] };
    }
    return best;
  }
  function applyMove(g, dx, dy, noSnap) {
    var gx = null, gy = null;
    if (!noSnap) {
      var s = snapLines(g), tol = SNAP_PX / g.m.k;
      var l = g.r0.l + dx, t = g.r0.t + dy;
      // 中央線は要素の中央と、兄弟の端は要素の端と、元の位置は要素の左上と合わせる。いちばん近いものを採る
      var pick = function (a, b) { return !a ? b : !b ? a : Math.abs(b.d) < Math.abs(a.d) ? b : a; };
      var bx = pick(pick(nearest([s.xs[0]], [l + g.r0.w / 2], tol), nearest(s.xs.slice(1), [l, l + g.r0.w], tol)), nearest([s.ox], [l], tol));
      var by = pick(pick(nearest([s.ys[0]], [t + g.r0.h / 2], tol), nearest(s.ys.slice(1), [t, t + g.r0.h], tol)), nearest([s.oy], [t], tol));
      if (bx) { dx += bx.d; gx = bx.at; }
      if (by) { dy += by.d; gy = by.at; }
    }
    var x = Math.round(g.t0[0] + dx), y = Math.round(g.t0[1] + dy);
    writeTranslate(g.el, x, y, g.important);
    showGuides(g.m, gx, gy);
    return [x, y];
  }
  function applyResize(g, dir, dx, dy, keep) {
    var sx = /e/.test(dir) ? 1 : /w/.test(dir) ? -1 : 0;
    var sy = /s/.test(dir) ? 1 : /n/.test(dir) ? -1 : 0;
    var w = g.w0 + sx * dx, hh = g.h0 + sy * dy;
    var setW = sx !== 0, setH = sy !== 0;
    if (keep && g.w0 > 0 && g.h0 > 0) {
      var f;
      if (sx && sy) f = Math.max(w / g.w0, hh / g.h0);
      else f = sx ? w / g.w0 : hh / g.h0;
      f = Math.max(f, MIN_SIZE / Math.min(g.w0, g.h0));
      w = g.w0 * f; hh = g.h0 * f;
      setW = setH = true;
    }
    w = Math.max(MIN_SIZE, Math.round(w)); hh = Math.max(MIN_SIZE, Math.round(hh));
    if (setW) setPx(g.el, 'width', w + 'px', g.important);
    if (setH) setPx(g.el, 'height', hh + 'px', g.important);
    // 左・上のハンドル：右下が動かないよう translate も合わせる（Markdown の画像は位置を書けないのでやらない）
    if ((sx < 0 || sy < 0) && !(sel && sel.target && sel.target.kind === 'mdimg')) {
      var r = slideRect(g.el, g.m);
      var cur = parseTranslate(g.el.style.getPropertyValue('translate') || getComputedStyle(g.el).translate);
      var nx = cur[0], ny = cur[1];
      if (sx < 0) nx += (g.r0.l + g.r0.w) - (r.l + r.w);
      if (sy < 0) ny += (g.r0.t + g.r0.h) - (r.t + r.h);
      writeTranslate(g.el, Math.round(nx), Math.round(ny), g.important);
    }
    return [w, hh];
  }
  function frame() {
    rafId = 0;
    if (!drag || !drag.pending) return;
    var t0 = performance.now();
    var g = drag.g, ev = drag.pending;
    drag.pending = null;
    var dx = (ev.x - drag.x0) / g.m.k, dy = (ev.y - drag.y0) / g.m.k;
    var extra = '';
    if (drag.mode === 'move') {
      if (drag.noMove) { /* Markdown の画像は動かさない */ }
      else { var p = applyMove(g, dx, dy, ev.noSnap); extra = '  x' + (p[0] >= 0 ? '+' : '') + p[0] + ' y' + (p[1] >= 0 ? '+' : '') + p[1]; }
    } else {
      var keep = !!KEEP_RATIO[tagOf(g.el)] !== !!ev.shift;
      applyResize(g, drag.mode, dx, dy, keep);
    }
    if (!g.checked) { g.checked = true; if (checkImportant(g.el, g)) { drag.pending = ev; } }
    refreshSel(extra);
    var ms = performance.now() - t0;
    stats.frameMs = ms; stats.frames++;
    if (ms > stats.frameMaxMs) stats.frameMaxMs = ms;
    if (drag.pending && !rafId) rafId = requestAnimationFrame(frame);
  }
  function beginDrag(ev, mode) {
    flushKeys();
    var g = startGesture(sel.el);
    if (!g) return;
    drag = { g: g, mode: mode, x0: ev.clientX, y0: ev.clientY, moved: false, pending: null, pid: ev.pointerId,
      noMove: mode === 'move' && sel.target.kind === 'mdimg' };
    try { selBox.setPointerCapture(ev.pointerId); } catch (_) { /* 無くても window で拾う */ }
    setRoot();
  }
  function cancelDrag() {
    if (!drag) return;
    restore(drag.g.el, drag.g.before);
    endDrag();
  }
  function endDrag() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    try { selBox.releasePointerCapture(drag.pid); } catch (_) { /* 無視 */ }
    drag = null;
    hideGuides();
    setRoot();
    refreshSel();
  }
  function finishDrag() {
    if (!drag) return;
    if (drag.pending) { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } frame(); }
    var g = drag.g, moved = drag.moved, noMove = drag.noMove;
    endDrag();
    swallow = Date.now() + 120;   // 離した直後に来る click を原稿の逆引きへ流さない
    if (moved && noMove) { try { P.toast(MSG_MDIMG); } catch (_) {} return; }
    if (moved) commit(g.el, g.before, g.important);
  }

  // ───────── キー操作（矢印は 400ms の無操作で 1 回にまとめる） ─────────
  function flushKeys() {
    if (!keyBatch) return;
    var b = keyBatch;
    keyBatch = null;
    clearTimeout(b.timer);
    if (sel && sel.el === b.el) commit(b.el, b.before, b.important);
  }
  function nudge(dx, dy) {
    if (!sel || !sel.target) return;
    if (sel.target.kind === 'mdimg') { try { P.toast(MSG_MDIMG); } catch (_) {} return; }
    var el = sel.el;
    if (!keyBatch || keyBatch.el !== el) { flushKeys(); keyBatch = { el: el, before: snapshot(el), important: false, checked: false, timer: 0 }; }
    var cur = parseTranslate(el.style.getPropertyValue('translate') || getComputedStyle(el).translate);
    writeTranslate(el, Math.round(cur[0] + dx), Math.round(cur[1] + dy), keyBatch.important);
    if (!keyBatch.checked) { keyBatch.checked = true; if (checkImportant(el, keyBatch)) writeTranslate(el, Math.round(cur[0] + dx), Math.round(cur[1] + dy), true); }
    clearTimeout(keyBatch.timer);
    keyBatch.timer = setTimeout(flushKeys, KEY_IDLE_MS);
    var t = parseTranslate(el.style.getPropertyValue('translate'));
    refreshSel('  x' + (t[0] >= 0 ? '+' : '') + t[0] + ' y' + (t[1] >= 0 ? '+' : '') + t[1]);
  }

  // ───────── イベント（window の capture。使った分だけ止める） ─────────
  function stop(ev, prevent) { if (prevent) ev.preventDefault(); ev.stopImmediatePropagation(); }
  function editing() { try { return !!P.isEditing(); } catch (_) { return false; } }
  function typingTarget(t) { return !!(t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName || ''))); }
  function setAlt(on) {
    on = !!on && !editing();
    if (on === altDown) return;
    altDown = on;
    if (on) altAt = performance.now();
    setRoot();
    if (!on) { hideHover(); return; }
    if (lastXY && !drag) { showHover(elementAt(lastXY[0], lastXY[1])); stats.hoverMs = performance.now() - altAt; }
  }

  window.addEventListener('keydown', function (ev) {
    if (ev.key === 'Alt') { if (!typingTarget(ev.target)) setAlt(true); return; }
    if (!sel || editing() || typingTarget(ev.target)) return;
    var k = ev.key;
    if (k === 'Escape') {
      stop(ev, true);
      if (drag) cancelDrag(); else deselect();
      return;
    }
    if (ev.metaKey || ev.ctrlKey) return;   // Cmd+Z などは preview.js（原稿の取り消し）へ流す
    if (ev.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) { stop(ev, true); if (!drag) { if (k === 'ArrowUp') goParent(); else goChild(); } return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      stop(ev, true);
      if (drag || sel.refused) return;
      var d = ev.shiftKey ? 10 : 1;
      nudge(k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0);
      return;
    }
    if (k === '0' && !ev.altKey) { stop(ev, true); if (!drag) resetBox(); return; }
    // 選択中は、スライド送り（j/k・PageUp/Down）や ＋ポップアップ（+ / i）・配置案（L）に流さない
    if (k.length === 1 || k === 'PageUp' || k === 'PageDown' || k === 'Home' || k === 'End') stop(ev, false);
  }, true);
  window.addEventListener('keyup', function (ev) { if (ev.key === 'Alt') setAlt(false); }, true);
  window.addEventListener('blur', function () { setAlt(false); if (drag) finishDrag(); });

  window.addEventListener('pointermove', function (ev) {
    lastXY = [ev.clientX, ev.clientY];
    if (drag) {
      if (!drag.moved && Math.abs(ev.clientX - drag.x0) + Math.abs(ev.clientY - drag.y0) < 3) return;
      drag.moved = true;
      drag.pending = { x: ev.clientX, y: ev.clientY, shift: ev.shiftKey, noSnap: ev.metaKey || ev.ctrlKey };
      if (!rafId) rafId = requestAnimationFrame(frame);
      stop(ev, true);
      return;
    }
    if (ev.altKey !== altDown) setAlt(ev.altKey);   // フォーカスが外にあって keydown を取りこぼしたとき
    if (altDown) showHover(elementAt(ev.clientX, ev.clientY));
  }, true);
  // Alt を押している間・ドラッグ中は、preview.js の ＋ボタン（スライドの間に出る）とホバーの枠を動かさない
  ['mousemove', 'mouseover'].forEach(function (ty) {
    window.addEventListener(ty, function (ev) { if (altDown || drag) stop(ev, false); }, true);
  });

  window.addEventListener('pointerdown', function (ev) {
    if (ev.button !== 0 || editing()) return;
    var t = ev.target;
    var onHandle = t && t.classList && t.classList.contains('ss-box-handle');
    if (sel && !sel.refused && onHandle) {
      stop(ev, true); swallow = Date.now() + 600;
      beginDrag(ev, t.getAttribute('data-dir'));
      return;
    }
    if (ev.altKey) {
      if (typingTarget(t) || (inUi(t) && !inLayer(t))) return;
      var el = elementAt(ev.clientX, ev.clientY);
      if (!el) { if (sel) { deselect(); stop(ev, true); swallow = Date.now() + 600; } return; }
      stop(ev, true); swallow = Date.now() + 600;
      if (!(sel && sel.el === el && !sel.refused)) { if (!select(el, false)) return; }
      beginDrag(ev, 'move');   // 選んだその手で動かせる
      return;
    }
    if (!sel) return;
    if (t === selBox && !sel.refused) { stop(ev, true); swallow = Date.now() + 600; beginDrag(ev, 'move'); return; }
    // 外側のクリック＝終了。スライドの上なら、そのクリックで原稿へ飛ばさない
    var ui = inUi(t) && !inLayer(t);
    deselect();
    if (!ui) { stop(ev, true); swallow = Date.now() + 600; }
  }, true);
  window.addEventListener('pointerup', function (ev) {
    if (!drag) return;
    stop(ev, true);
    var t0 = performance.now();
    finishDrag();
    stats.upToCommitMs = performance.now() - t0;
  }, true);
  window.addEventListener('pointercancel', function () { if (drag) cancelDrag(); }, true);
  ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick'].forEach(function (ty) {
    window.addEventListener(ty, function (ev) {
      if (ev.button === 2 && ty !== 'auxclick') return;
      var mine = drag || Date.now() < swallow || inLayer(ev.target) || (altDown && !inUi(ev.target) && !editing());
      if (!mine) return;
      stop(ev, true);
      if (ty === 'click' || ty === 'dblclick') swallow = 0;
    }, true);
  });
  // 右クリックの配置案（layouts.js）：選択中・Alt の間は止める
  window.addEventListener('contextmenu', function (ev) {
    if (!(sel || altDown || drag) || editing() || typingTarget(ev.target)) return;
    if (inUi(ev.target) && !inLayer(ev.target)) return;
    stop(ev, true);
  }, true);
  // Alt+ドラッグで文字選択が始まらないように
  window.addEventListener('selectstart', function (ev) { if (altDown || drag) ev.preventDefault(); }, true);

  window.addEventListener('scroll', function () { if (sel) refreshSel(); if (hoverEl) { var e = hoverEl; hoverEl = null; showHover(e); } }, true);
  window.addEventListener('resize', function () { if (sel) refreshSel(); hideHover(); });
  // 画像の読み込みで枠の位置が変わる（load は泡立たないので capture）
  document.addEventListener('load', function () { if (sel && !drag) refreshSel(); }, true);

  // ───────── 描き直し・書き戻しの結果 ─────────
  if (typeof P.onRender === 'function') P.onRender(function () {
    lastCommit = null;   // 戻す相手（古い DOM）はもう無いかもしれない
    hideHover();
    if (!sel) return;
    if (sel.el.isConnected) { refreshSel(); return; }
    if (drag) { drag = null; hideGuides(); }
    if (keyBatch) { clearTimeout(keyBatch.timer); keyBatch = null; }
    var svg = P.slides()[sel.index], sec = svg && P.sectionOf(svg);
    var el = sel.target ? findByTarget(sec, sel.target) : null;
    if (!el) { sel = null; selBox.style.display = 'none'; selTag.style.display = 'none'; setRoot(); return; }
    sel.el = el; sel.downStack = [];
    setRoot();
    refreshSel();
    // 画像がまだ読み込まれていないと枠がずれる。次のフレームでもう一度合わせる
    requestAnimationFrame(function () { if (sel && sel.el === el) refreshSel(); });
  });
  window.addEventListener('message', function (ev) {
    var m = ev.data || {};
    if (m.type !== 'editResult' || m.ok || !lastCommit) return;
    // 書き戻せなかった：原稿は変わらず再描画も来ない。見た目だけ残らないよう直前の確定を元へ戻す
    var c = lastCommit;
    lastCommit = null;
    if (c.el.isConnected) { restore(c.el, c.before); refreshSel(); }
  });

  window.ssBoxEdit = {
    select: function (el) { return select(el, false); },
    deselect: deselect,
    selected: function () { return sel ? { el: sel.el, target: sel.target, index: sel.index, refused: sel.refused } : null; },
    targetOf: targetOf,
    flush: flushKeys,
    stats: stats,
  };
})();
