// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// ブラウザ側：スライド 1 枚の「本文のはみ出し」を測る（DESIGN.md 7.2）。
// Webview（preview.js のはみ出しバッジ）とテスト（puppeteer）で同じ物を使う。ここを変えたら test/overflow.test.cjs を回すこと。
//
//   window.ssDetectOverflow(section) →
//     { overflow, bottomPx, hitsTakeaway, hitsHeader, hitsSibling, padPx, pending, unknown }
//       bottomPx     … 本文の最下端が「本文の床」を何 px 超えたか（スライドの座標系＝1280×720 での px。0 以下なら収まっている）
//       hitsTakeaway … 下端固定の .takeaway 帯に本文が重なっている
//       hitsHeader   … ヘッダー帯（section 直下の header の下端）より上に本文が食い込んでいる（vcenter で溢れると上にも出る）
//       padPx        … 本文の最下端が section の内側の下端（padding-bottom を除く）を何 px 超えたか（参考値。判定には使わない）
//       hitsSibling  … 本文のブロックが、後ろに続く隣のブロックへ食い込んでいる（高さの決まった入れ物から中身があふれて
//                       次のブロックの下に潜る／見出しが潰れて本文が見出しに乗る、など。section の下端には届かないので bottomPx では分からない）
//       pending      … 読み込みが終わっていない img がある（高さ 0 で測っているので、呼び出し側は load 後に測り直す）
//       unknown      … 測れなかった（display:none の祖先の中・畳まれている・文書から外れている）。このとき overflow は必ず false
//       overflow     … bottomPx > 0・hitsTakeaway・hitsHeader・hitsSibling のどれかが真（誤差 TOL px は見逃す）
//
// 速さ：読むだけで何も書かないので、レイアウトの強制は最初の 1 回だけ（80 枚のデックで 1 枚あたり 0.1ms 前後＝実測）。
// ここで style や class を書き換えないこと（書くと 1 要素ごとにレイアウトが走る）。
//
// 何を「本文」と数えるか：
//   - position が static / relative / sticky の子孫だけ。absolute / fixed は、その中身ごと数えない
//     （header・page-title・takeaway・ロゴ・tune で動かした飾りは、作者が場所を決めて置いた物で、流し込みの結果ではない）。
//   - section 直下の header / footer、.takeaway、.page-title、style / script は数えない。ページ番号は擬似要素なので元から出てこない。
//   - 測るのは「目に見える物」の箱だけ：テキストノード（Range の矩形）、画像・動画・インライン SVG などの置換要素、
//     背景か枠線を持つ要素。余白だけの入れ物（.body や .split-body は flex で床まで伸びる）や、行送りの下半分
//     （line-height 1.7 だと文字の下に 8px の空きが付く）で誤検知しないため。
//   - overflow が visible でない要素と svg は中へ入らず、その箱で測る（中身は切り取られて見えないので）。
//
// 本文の床＝「section の下端から EDGE px 上（padding-bottom がそれより小さければ padding-bottom）」と
// 「下端固定の .takeaway の上端」の高い方。
//   padding-bottom をまるごと除いた内側を床にすると、添削済みの完成スライドが引っかかる（実測：作者の手元のデック（配布しない）の 1 枚は
//   下の余白へ 22px、別のデックの自己紹介は 57px 入り込んでいるが、どちらも見切れも重なりも無い）。余白へ入っただけでは
//   はみ出しと呼ばず、スライドの縁に EDGE px より近づいたら（＝ページ番号の高さに掛かる・切れる寸前）はみ出しとする。
//   余白へ入り込んだ量そのものは padPx で返す（0 以下なら余白にも入っていない）。
(function (global) {
  'use strict';
  var EDGE = 24; // スライドの下の縁から、本文が入ってはいけない幅（px）
  var TOL = 1.5; // 端数の丸めと、文字の箱の上下の遊びを見逃す幅（px）
  var SIB_TOL = 4; // 隣のブロックへの食い込みで見逃す幅（px）。行の箱どうしは詰めた行送りで 1〜3px 重なることがある
  // 子どうしの重なりを見る入れ物（表の中・行内の並びは見ない）
  var CONTAINER = { block: 1, flex: 1, grid: 1, 'list-item': 1, 'flow-root': 1 };
  var REPLACED = { img: 1, svg: 1, video: 1, canvas: 1, iframe: 1, object: 1, embed: 1, picture: 0, hr: 1, input: 1, textarea: 1, select: 1, button: 1 };

  /** 背景画像つきスライドは svg の中に section が 2〜3 枚ある（background / content / pseudo）。本文の section を返す */
  function contentSection(section) {
    if (!section || !section.getAttribute) return section;
    var role = section.getAttribute('data-marpit-advanced-background');
    if (role !== 'background' && role !== 'pseudo') return section;
    var svg = section.closest ? section.closest('svg[data-marpit-svg]') : null;
    if (!svg) return section;
    var c = svg.querySelector('section[data-marpit-advanced-background="content"]');
    return c || section;
  }

  function transparent(c) {
    return !c || c === 'transparent' || /^rgba\([^)]*,\s*0\s*\)$/.test(c);
  }
  /** 背景か枠線で「箱として見える」要素か */
  function paintsBox(cs) {
    if (!transparent(cs.backgroundColor)) return true;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    var sides = ['Top', 'Right', 'Bottom', 'Left'];
    for (var i = 0; i < 4; i++) {
      if (parseFloat(cs['border' + sides[i] + 'Width']) > 0 && cs['border' + sides[i] + 'Style'] !== 'none'
        && !transparent(cs['border' + sides[i] + 'Color'])) return true;
    }
    return false;
  }

  function ssDetectOverflow(sectionIn) {
    var out = { overflow: false, bottomPx: 0, padPx: 0, hitsTakeaway: false, hitsHeader: false, hitsSibling: false, pending: false, unknown: false };
    var section = contentSection(sectionIn);
    if (!section || !section.getBoundingClientRect) { out.unknown = true; return out; }
    var win = (section.ownerDocument && section.ownerDocument.defaultView) || global;
    var doc = section.ownerDocument;
    var sr = section.getBoundingClientRect();
    // 表示は svg の幅に合わせて縮んでいる。レイアウト上の幅（16:9 なら 1280）との比で、スライドの座標系に直す
    var baseW = section.offsetWidth || 1280;
    var scale = sr.width / baseW;
    if (!(scale > 0) || !(sr.height > 0)) { out.unknown = true; return out; } // 畳まれている・display:none の中など。測れない
    var toY = function (y) { return (y - sr.top) / scale; };
    var toX = function (x) { return (x - sr.left) / scale; };
    var H = sr.height / scale;

    var scs = win.getComputedStyle(section);
    var padFloor = H - (parseFloat(scs.paddingBottom) || 0) - (parseFloat(scs.borderBottomWidth) || 0);
    var floor = Math.max(padFloor, H - EDGE);
    var innerFloor = floor;

    // 下端固定の takeaway（absolute のもの）は床を決める。流し込みの takeaway（summary 型など）は床を決めないが、
    // 高さの決まった入れ物（flex で伸びる .sections など）から本文があふれると帯の下へ潜るので、重なりだけ見る
    // （実測：作者の手元のデックで QR を大きくすると、注意書きが帯に隠れる）
    var takeaways = [], flowTakeaways = [];
    var tks = section.querySelectorAll('.takeaway');
    for (var i = 0; i < tks.length; i++) {
      var tcs = win.getComputedStyle(tks[i]);
      if (tcs.display === 'none' || tcs.visibility === 'hidden') continue;
      var tr = tks[i].getBoundingClientRect();
      if (!tr.height) continue;
      var t = { top: toY(tr.top), bottom: toY(tr.bottom), left: toX(tr.left), right: toX(tr.right) };
      if (tcs.position !== 'absolute' && tcs.position !== 'fixed') { flowTakeaways.push(t); continue; }
      takeaways.push(t);
      if (t.top < floor) floor = t.top;
    }

    // ヘッダー帯の下端（section 直下の header）。無ければ 0（＝上には食い込みようがない）
    var headerBottom = 0;
    for (var h = section.firstElementChild; h; h = h.nextElementSibling) {
      if (h.tagName && h.tagName.toLowerCase() === 'header') {
        var hr = h.getBoundingClientRect();
        if (hr.height) headerBottom = Math.max(headerBottom, toY(hr.bottom));
      }
    }

    var maxBottom = -Infinity, minTop = Infinity;
    var boxes = [];
    var acc = null; // いま中を歩いているブロックの「見える物の外接箱」。親へ鎖でつながる
    function add(r, noSib) {
      if (!r || (!r.width && !r.height) || !r.height) return;
      var b = { top: toY(r.top), bottom: toY(r.bottom), left: toX(r.left), right: toX(r.right), svg: !!noSib };
      boxes.push(b);
      if (b.bottom > maxBottom) maxBottom = b.bottom;
      if (b.top < minTop) minTop = b.top;
      // インライン SVG の箱は絵のまわりの余白を含む（入れ物からあふれても見た目は重ならない＝実測：作者の手元のデックの数枚）。
      // 隣のブロックとの重なりには数えない（下端・takeaway の判定には数える）
      if (noSib) return;
      for (var a = acc; a; a = a.parent) {
        if (b.top < a.top) a.top = b.top;
        if (b.bottom > a.bottom) a.bottom = b.bottom;
        if (b.left < a.left) a.left = b.left;
        if (b.right > a.right) a.right = b.right;
      }
    }
    /** 先に始まったブロックの見える物が、後ろのブロックの上端より下まで来ていて、横にも重なっているか */
    function collide(kids) {
      for (var j = 1; j < kids.length && !out.hitsSibling; j++) {
        var q = kids[j];
        for (var i = 0; i < j; i++) {
          var p = kids[i];
          if (p.top < q.top - SIB_TOL && p.bottom > q.top + SIB_TOL && p.right > q.left + SIB_TOL && p.left < q.right - SIB_TOL) { out.hitsSibling = true; break; }
        }
      }
    }

    function walk(el, checkKids) {
      var kids = checkKids ? [] : null;
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) {
          if (!/\S/.test(n.nodeValue)) continue;
          var range = doc.createRange();
          range.selectNodeContents(n);
          add(range.getBoundingClientRect());
          continue;
        }
        if (n.nodeType !== 1) continue;
        var tag = n.tagName.toLowerCase();
        if (tag === 'style' || tag === 'script' || tag === 'template' || tag === 'br') continue;
        if ((tag === 'header' || tag === 'footer') && n.parentElement === section) continue;
        if (n.classList && (n.classList.contains('takeaway') || n.classList.contains('page-title'))) continue;
        var cs = win.getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (cs.position === 'absolute' || cs.position === 'fixed') continue;
        if (tag === 'img' && !n.complete) out.pending = true;
        var blockish = kids && !out.hitsSibling && cs.display.indexOf('inline') !== 0 && cs.display !== 'contents' && cs.float === 'none';
        var mine = null;
        if (blockish) { mine = { top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity, parent: acc }; acc = mine; }
        if (REPLACED[tag]) add(n.getBoundingClientRect(), tag === 'svg');
        else {
          var painted = paintsBox(cs);
          if (painted) add(n.getBoundingClientRect());
          // 中身を切り取る要素は、その箱がすべて（はみ出た中身は見えない）
          if (cs.overflowY !== 'visible' && cs.display !== 'inline' && cs.display !== 'contents') {
            if (!painted) add(n.getBoundingClientRect());
          } else walk(n, !!CONTAINER[cs.display]);
        }
        if (mine) { acc = mine.parent; if (mine.bottom > -Infinity) kids.push(mine); }
      }
      if (kids && kids.length > 1) collide(kids);
    }
    walk(section, true);

    if (maxBottom === -Infinity) { out.bottomPx = Math.round((0 - floor) * 10) / 10; return out; } // 本文なし
    out.bottomPx = Math.round((maxBottom - floor) * 10) / 10;
    out.padPx = Math.round((maxBottom - padFloor) * 10) / 10;
    out.hitsHeader = headerBottom > 0 && minTop < headerBottom - TOL;
    for (var k = 0; k < takeaways.length && !out.hitsTakeaway; k++) {
      var tk = takeaways[k];
      for (var j = 0; j < boxes.length; j++) {
        var b = boxes[j];
        if (b.bottom > tk.top + TOL && b.top < tk.bottom - TOL && b.right > tk.left + TOL && b.left < tk.right - TOL) { out.hitsTakeaway = true; break; }
      }
    }
    for (var k2 = 0; k2 < flowTakeaways.length && !out.hitsTakeaway; k2++) {
      var ft = flowTakeaways[k2];
      for (var j2 = 0; j2 < boxes.length; j2++) {
        var b2 = boxes[j2];
        if (b2.svg) continue;   // インライン SVG の箱は絵のまわりの余白を含む（隣のブロックと同じ扱い。実測：実デックの数枚）
        if (b2.bottom > ft.top + SIB_TOL && b2.top < ft.bottom - SIB_TOL && b2.right > ft.left + SIB_TOL && b2.left < ft.right - SIB_TOL) { out.hitsTakeaway = true; break; }
      }
    }
    // takeaway が床を決めているとき、横に外れていて帯には重ならない本文（右下の PiP 域など）は、section の内側の床で測り直す
    if (takeaways.length && !out.hitsTakeaway && floor < innerFloor) {
      out.bottomPx = Math.round((maxBottom - innerFloor) * 10) / 10;
    }
    out.overflow = out.bottomPx > TOL || out.hitsTakeaway || out.hitsHeader || out.hitsSibling;
    return out;
  }

  global.ssDetectOverflow = ssDetectOverflow;
  if (typeof module !== 'undefined' && module.exports) module.exports = { ssDetectOverflow: ssDetectOverflow };
})(typeof window !== 'undefined' ? window : globalThis);
