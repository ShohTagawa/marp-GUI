// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// Marp Scroll Sync：プレビュー（Webview のブラウザ側）の全 UI。
//   - スライド強調・スクロール同期・クリック逆引き・キーでのスライド送り・tune ツールバー（従来どおり）
//   - 直接編集（ダブルクリック → その場で文字を直す → 原稿へ書き戻し）
//   - プレビューで選んだ文字へのサイズ/色（tuneSelect）
//   - スライド操作ボタン・完成スライドの ★・トースト
//   - スライドの間の ＋ボタン（間にマウスを乗せたときだけ現れる）→ 挿入ポップアップ（棚・手を入れた順・検索）→「もっと探す」で
//     全面の検索ギャラリー（サムネイルは Shadow DOM。DESIGN.md 7.3 / 7.4 / 8.1 / 8.2）
//   - 変わったスライドだけの差し替え（patch。DESIGN.md 8.4）
//   - ほかの部品（media/layouts.js）向けの公開 API：window.ssPreview（DESIGN.md 8.3）
//   - はみ出しバッジ（media/overflow.js の window.ssDetectOverflow があるときだけ）
// 前提（extension.js の buildHtml が用意するもの）：
//   <style id="deck-css">、<div id="wrap">（marp の html）、window.__SS_INIT__ = { index, version, marks }、
//   先に読み込まれた media/textnodes.js（window.ssCollectTextNodes）。media/overflow.js（window.ssDetectOverflow）は任意。
//   それ以外の UI 要素（バッジ・ツールバー・ボタン・トースト・ギャラリー）は全部ここで作る。
// CSP は script-src 'nonce-…' だけ（extension.js の SCRIPT_NONCE）。拡張が nonce を付けた <script> しか動かず、
// デックの中の <script>・onclick= などのイベント属性は動かない。外部スクリプト・eval・new Function も使わない。
// CSP is script-src 'nonce-…' only (SCRIPT_NONCE in extension.js): only <script> tags given the nonce by the
// extension run; deck <script> and event attributes such as onclick= do not. No external scripts, eval or new Function.
// メッセージの取り決めは DESIGN.md 2.3・7.4・8.2・8.4。変えるときは DESIGN.md も直すこと。
// 速さの予算（DESIGN.md 8.0）：操作から表示まで 0.4 秒以内。ポップアップは骨組みを同期的に出し、サムネイルは後から埋める。
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();   // 1回しか呼べない
  const INIT = window.__SS_INIT__ || {};
  const post = (m) => vscode.postMessage(m);

  const wrap = document.getElementById('wrap');
  let deckCss = document.getElementById('deck-css');
  if (!deckCss) { deckCss = document.createElement('style'); deckCss.id = 'deck-css'; document.head.appendChild(deckCss); }

  let cur = Number.isInteger(INIT.index) ? INIT.index : 0;   // いま選ばれているスライド（キー送りの起点）
  let version = Number.isInteger(INIT.version) ? INIT.version : null; // いま表示している DOM を描いた doc.version
  let marks = Array.isArray(INIT.marks) ? INIT.marks : [];   // 完成スライドの印（スライドごとの bool）
  let navMode = false;      // キーでスライドを送っている最中か（true の間は ↑↓ を必ずページ送りに使う）
  let tActive = false;      // 原稿側で文字が選ばれていて tune が効く状態か
  let edit = null;          // 直接編集の状態（null = 編集していない）
  let pendingRender = null; // 編集中に届いた render（最新の1件だけ保留し、確定/破棄の直後に適用する）
  let pendingPatch = null;  // 編集中に届いた patch（1件にまとめて保留する。あとから render が来たら render が勝つ）
  let revealTimer = null;   // 単クリック逆引きの遅延送信（ダブルクリックが来たら取り消す）
  let lastCommit = null;    // 直前に送った editCommit の戻し方。拡張が断ったら（editResult ok:false）表示を元へ戻す
  let lastFinishAt = 0;     // 直前に編集を終えた時刻。編集を終わらせたクリックで逆引きしないため

  // ---------- 小物 ----------
  /** 要素を作る。文字は必ず textContent で入れる（台帳の題名などを innerHTML に流さない） */
  function h(tag, props, kids) {
    const el = document.createElement(tag);
    if (props) for (const k of Object.keys(props)) {
      if (k === 'text') el.textContent = props[k];
      else if (k === 'class') el.className = props[k];
      else el.setAttribute(k, props[k]);
    }
    if (kids) for (const c of kids) if (c) el.appendChild(c);
    return el;
  }
  function slides() { return Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]')); }
  /** スライド枠 svg → 本文の section。背景画像つき（advanced background）では section が複数あるので content を選ぶ */
  function sectionOf(svg) {
    if (!svg) return null;
    return svg.querySelector('section[data-marpit-advanced-background="content"]') || svg.querySelector('section');
  }
  function collect(section) { return (window.ssCollectTextNodes ? window.ssCollectTextNodes(section) : []); }
  /** 拡張へ送る形。node（DOM 参照）は postMessage で複製できないので外す */
  function wireNodes(all) { return all.map(n => ({ t: n.t, near: n.near, svg: n.svg })); }
  function numAttr(el, name) {
    if (!el || !el.hasAttribute || !el.hasAttribute(name)) return null;
    const n = parseInt(el.getAttribute(name), 10);
    return Number.isFinite(n) ? n : null;
  }

  /** デックの要素に一時的に付けたクラスを外す。空の class="" を残さない（DOM を開始前と同じに戻す） */
  function dropClass(el, name) {
    el.classList.remove(name);
    if (el.getAttribute('class') === '') el.removeAttribute('class');
  }

  // ---------- UI 要素の生成（#wrap 以外は拡張側に期待しない） ----------
  // 右下の「Slide 3/20」。押す（または G）と番号の入力欄になり、Enter でそのスライドへ送る
  const badge = h('div', { class: 'ss-badge ss-ui', role: 'button', tabindex: '0', title: 'クリック（または G キー）でページ番号を入れて移動' });
  const badgeText = h('span', { class: 'ss-badge-text' });
  const jumpInput = h('input', { class: 'ss-jump', type: 'text', inputmode: 'numeric', spellcheck: 'false', 'aria-label': '移動先のページ番号' });
  badge.appendChild(badgeText);
  badge.appendChild(jumpInput);
  const layer = h('div', { id: 'ss-layer', class: 'ss-ui' });
  const toastEl = h('div', { class: 'ss-toast ss-ui', role: 'status' });

  const OPS = [
    ['new', '＋', '新しいスライドをこの次に作る'],
    ['duplicate', '⧉', 'このスライドを複製する'],
    ['moveUp', '↑', 'このスライドを前へ移す'],
    ['moveDown', '↓', 'このスライドを後ろへ移す'],
    ['delete', '🗑', 'このスライドを削除する'],
    null,
    ['mark', '★', '完成スライドの印を付ける／外す'],
    ['library', '📚', 'ライブラリから選んで、この次に挿入する'],
  ];
  const ops = h('div', { class: 'ss-ops ss-ui' });
  let markBtn = null;
  for (const o of OPS) {
    if (!o) { ops.appendChild(h('span', { class: 'ss-gap' })); continue; }
    const b = h('button', { type: 'button', 'data-op': o[0], title: o[2], 'aria-label': o[2], text: o[1] });
    // 確認ダイアログや入力は拡張側。ここは送るだけ
    b.addEventListener('click', () => post({ type: 'slideOp', op: o[0], index: cur, version }));
    if (o[0] === 'mark') markBtn = b;
    ops.appendChild(b);
  }
  layer.appendChild(ops);

  // tune のスウォッチ。赤（テーマ）と濃赤は hex でなく var() を書く（貼り付け先の色に追従させる。DESIGN.md 5）
  const SWATCHES = [
    { c: 'var(--accent)', v: '--accent', fb: '#A6192E', title: '赤(テーマ)' },
    { c: 'var(--accent-dark)', v: '--accent-dark', fb: '#7d1322', title: '濃赤' },
    { c: '#1f6fb2', title: '青' },
    { c: '#2e7d32', title: '緑' },
    { c: '#1a1a1a', title: '黒(標準)' },
  ];
  const tDec = h('button', { type: 'button', title: '−1px (↓)', text: 'A−' });
  const tSize = h('span', { class: 'ss-sz', text: '–' });
  const tInc = h('button', { type: 'button', title: '+1px (↑)', text: 'A+' });
  const tColor = h('input', { type: 'color', value: '#A6192E', title: '色を選ぶ' });
  const tClear = h('button', { type: 'button', title: 'サイズ/色をリセット', text: '✕' });
  const tuner = h('div', { id: 'ss-tuner', class: 'ss-ui', 'data-active': '0', title: '文字を選択してから操作（↑↓でも±1px）' },
    [tDec, tSize, tInc, h('span', { class: 'ss-sep' }), tColor]);
  for (const s of SWATCHES) {
    const b = h('button', { type: 'button', class: 'ss-sw', 'data-c': s.c, title: s.title });
    b.style.background = s.fb || s.c;
    b.addEventListener('click', () => post({ type: 'tune', op: 'color', value: s.c }));
    s.el = b;
    tuner.appendChild(b);
  }
  tuner.appendChild(h('span', { class: 'ss-sep' }));
  tuner.appendChild(tClear);
  tInc.addEventListener('click', () => post({ type: 'tune', op: 'inc' }));
  tDec.addEventListener('click', () => post({ type: 'tune', op: 'dec' }));
  tClear.addEventListener('click', () => post({ type: 'tune', op: 'clear' }));
  tColor.addEventListener('input', () => post({ type: 'tune', op: 'color', value: tColor.value }));

  // ギャラリー（検索ギャラリーと、旧形式＝台帳の entries を受ける簡易ギャラリーで同じ器を使う）
  const galTitle = h('span', { class: 'ss-gal-title', text: 'スライドを探す' });
  const galFilter = h('input', { class: 'ss-gal-filter', type: 'text', placeholder: '例：自己紹介　生成AI 重み（空白区切りで絞り込み）', spellcheck: 'false' });
  const galMarked = h('input', { type: 'checkbox' });
  const galMarkedLabel = h('label', { class: 'ss-gal-check ss-gal-corpus', title: '完成スライドの印（★）が付いたものだけ' }, [galMarked, h('span', { text: '★ 完成だけ' })]);
  const galSort = h('select', { class: 'ss-gal-sort ss-gal-corpus', title: '並び順', 'aria-label': '並び順' }, [
    h('option', { value: 'relevance', text: '関連順' }),
    h('option', { value: 'score', text: '手を入れた順' }),
    h('option', { value: 'recent', text: '新しい順' }),
  ]);
  const galCount = h('span', { class: 'ss-gal-count' });
  const galClose = h('button', { class: 'ss-gal-close', type: 'button', text: '閉じる (Esc)' });
  const galGrid = h('div', { class: 'ss-gal-grid' });
  const galSelCount = h('span', { class: 'ss-gal-selcount', text: '0 枚を選択中' });
  const galSelClear = h('button', { class: 'ss-gal-clear', type: 'button', text: '選択を解除' });
  const galKeepColors = h('input', { type: 'checkbox' });
  const galKeepTypo = h('input', { type: 'checkbox' });
  const galInsert = h('button', { class: 'ss-gal-insert', type: 'button', text: 'ここに挿入', disabled: '' });
  const galFoot = h('div', { class: 'ss-gal-foot ss-gal-corpus' }, [
    galSelCount, galSelClear, h('span', { class: 'ss-gal-spacer' }),
    h('label', { class: 'ss-gal-check', title: '貼り付け先の配色に合わせず、元のデックの色を持ち込む' }, [galKeepColors, h('span', { text: '元の色のまま' })]),
    h('label', { class: 'ss-gal-check', title: 'テーマが違うとき、元の本文サイズ・行間などをそのスライドに持ち込む（はみ出しを防ぐ）' }, [galKeepTypo, h('span', { text: '元の組版を保つ' })]),
    galInsert,
  ]);
  const galPanel = h('div', { class: 'ss-gal-panel' }, [
    h('div', { class: 'ss-gal-head' }, [galTitle, galFilter, galMarkedLabel, galSort, galCount, galClose]),
    galGrid,
    galFoot,
  ]);
  const gallery = h('div', { class: 'ss-gallery ss-ui' }, [galPanel]);
  let galEntries = [];

  // 挿入ポップアップ（＋ の近くに出す小さな窓。DESIGN.md 8.1）
  const popFilter = h('input', { class: 'ss-pop-filter', type: 'text', placeholder: '探す（例：自己紹介　生成AI 重み）', spellcheck: 'false', 'aria-label': '既存のスライドを探す' });
  const popMore = h('button', { class: 'ss-pop-more', type: 'button', title: '全面のギャラリーで、絞り込み・並べ替えをして探す', text: 'もっと探す' });
  const popBody = h('div', { class: 'ss-pop-body' });
  const popKeepColors = h('input', { type: 'checkbox' });
  const popKeepTypo = h('input', { type: 'checkbox' });
  const popSelCount = h('span', { class: 'ss-pop-selcount' });
  const popInsert = h('button', { class: 'ss-pop-insert', type: 'button', text: 'ここに挿入' });
  const popHint = h('span', { class: 'ss-pop-hint', text: 'クリックで挿入／Shift+クリックで複数' });
  const popEl = h('div', { class: 'ss-pop ss-ui', role: 'dialog', 'aria-label': '既存のスライドを挿入' }, [
    h('div', { class: 'ss-pop-head' }, [popFilter, popMore]),
    popBody,
    h('div', { class: 'ss-pop-foot' }, [
      h('label', { class: 'ss-pop-check', title: '貼り付け先の配色に合わせず、元のデックの色を持ち込む' }, [popKeepColors, h('span', { text: '元の色のまま' })]),
      h('label', { class: 'ss-pop-check', title: 'テーマが違うとき、元の本文サイズ・行間などをそのスライドに持ち込む（はみ出しを防ぐ）' }, [popKeepTypo, h('span', { text: '元の組版を保つ' })]),
      h('span', { class: 'ss-gal-spacer' }), popHint, popSelCount, popInsert,
    ]),
  ]);

  for (const el of [badge, layer, tuner, toastEl, popEl, gallery]) document.body.appendChild(el);

  // ---------- トースト ----------
  let toastTimer = null;
  function toast(message, isError) {
    toastEl.textContent = String(message || '');
    toastEl.classList.toggle('ss-err', !!isError);
    toastEl.classList.add('ss-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('ss-show'), 3000);
  }

  // ---------- スライドの強調・スクロール・重ねる UI の配置 ----------
  /** 操作ボタンと ★ を、現在のスライドのすぐ上に置き直す（文書座標。スクロールでは動かさなくてよい） */
  function layout() {
    const ss = slides();
    Array.from(layer.querySelectorAll('.ss-mark')).forEach(e => e.remove());
    ss.forEach((s, i) => {
      if (!marks[i]) return;
      const r = s.getBoundingClientRect();
      const m = h('div', { class: 'ss-mark', title: '完成スライド（ライブラリに登録済み）', text: '★' });
      m.style.left = (r.left + window.scrollX + 4) + 'px';
      m.style.top = (r.top + window.scrollY - 23) + 'px';
      layer.appendChild(m);
    });
    layoutInserts(ss);
    layoutOverflow(ss);
    const s = ss[cur];
    if (!s) { ops.style.display = 'none'; return; }
    const r = s.getBoundingClientRect();
    ops.style.display = 'flex';
    ops.style.left = (r.right + window.scrollX) + 'px';   // translateX(-100%) で右端をスライドの右端に合わせる
    ops.style.top = (r.top + window.scrollY - 24) + 'px';
    if (markBtn) markBtn.classList.toggle('ss-on', !!marks[cur]);
    setBadge(ss);
    if (edit && edit.kind === 'svg') placeSvgInput(edit);
  }
  // ---------- スライドの間の ＋（既存のスライドを探して、その位置に入れる。DESIGN.md 8.1） ----------
  // 置き場所はスライドの間の余白（30px）の中央。右寄せの操作ボタン列・左寄せの ★ / ⚠ と重ならない。
  // ふだんは見せない。スライドの間（余白より上下 8px ずつ広い帯）にマウスが乗ったときだけ .ss-near を付けて出す。
  // layout() は強調やリサイズのたびに呼ばれる。押している最中にボタンを作り直すとクリックが落ちるので、要素は使い回す。
  const inserts = [];
  let insertBlocked = false;   // 編集中に押された（mousedown の時点で編集中だった）
  function makeInsert() {
    const b = h('button', { type: 'button', class: 'ss-insert', text: '＋' });
    // ボタンを押すと編集要素が blur して、click より先に編集が確定する。click の時点では edit が空なので、ここで覚えておく
    b.addEventListener('mousedown', () => { insertBlocked = !!edit; });
    b.addEventListener('click', () => {
      if (insertBlocked || edit) {
        // 編集中は開かない（書き戻しで原稿の版が変わる途中に、挿入位置を決めさせない）。確定だけして、もう一度押してもらう
        insertBlocked = false;
        if (edit) finishEdit(true, 'none');
        const errShown = toastEl.classList.contains('ss-show') && toastEl.classList.contains('ss-err');
        if (!errShown) toast('編集を確定しました。もう一度 ＋ を押してください');
        return;
      }
      openPop(parseInt(b.getAttribute('data-index'), 10));
    });
    return b;
  }
  let gaps = [];        // ＋ が現れる帯（文書座標）。layoutInserts が作り直す
  let nearInsert = -1;  // いま出している ＋（inserts の添字）
  function setNear(j) {
    if (j === nearInsert) return;
    if (inserts[nearInsert]) inserts[nearInsert].classList.remove('ss-near');
    nearInsert = j;
    if (inserts[j]) inserts[j].classList.add('ss-near');
  }
  // mousemove のたびに帯を線形に探す（80 枚でも 81 回の比較）。DOM は読まないのでレイアウトを起こさない
  document.addEventListener('mousemove', (ev) => {
    const t = ev.target;
    let hit = -1;
    if (!galOpen() && !(t && t.closest && t.closest('.ss-ops, .ss-pop, #ss-tuner'))) {
      const x = ev.pageX, y = ev.pageY;
      for (let j = 0; j < gaps.length; j++) {
        const g = gaps[j];
        if (y >= g.top && y <= g.bottom && x >= g.left && x <= g.right) { hit = j; break; }
      }
    }
    setNear(hit);
  }, { passive: true });
  document.addEventListener('mouseleave', () => setNear(-1));
  function layoutInserts(ss) {
    const n = ss.length ? ss.length + 1 : 0;   // 1枚目の上（index −1）＋各スライドの下
    while (inserts.length > n) inserts.pop().remove();
    while (inserts.length < n) { const b = makeInsert(); inserts.push(b); layer.appendChild(b); }
    gaps = [];
    if (!n) { nearInsert = -1; return; }
    const rects = ss.map(s => s.getBoundingClientRect());
    for (let j = 0; j < n; j++) {
      const idx = j - 1;
      const r = rects[Math.max(0, idx)];
      let y;
      if (idx < 0) y = r.top - 15;
      else if (idx === ss.length - 1) y = r.bottom + 15;
      else y = (r.bottom + rects[idx + 1].top) / 2;
      const b = inserts[j];
      const label = idx < 0 ? '既存のスライドを探して、先頭に挿入する' : '既存のスライドを探して、' + (idx + 1) + ' 枚目の次に挿入する';
      b.setAttribute('data-index', String(idx));
      b.setAttribute('title', label);
      b.setAttribute('aria-label', label);
      const left = (r.left + r.width / 2 + window.scrollX) + 'px', top = (y + window.scrollY) + 'px';
      if (b.style.left !== left) b.style.left = left;
      if (b.style.top !== top) b.style.top = top;
      // 当たり判定は余白（30px）より上下 8px ずつ広い帯。スライドの横幅の内側だけ
      gaps.push({ top: y + window.scrollY - 23, bottom: y + window.scrollY + 23, left: r.left + window.scrollX, right: r.right + window.scrollX });
    }
    if (nearInsert >= n) nearInsert = -1;
    if (pop) placePop();
  }
  /** 編集中の合図。＋ボタンを「いまは押せない」見た目にする */
  function markEditing() { layer.classList.toggle('ss-editing-on', !!edit); }

  // ---------- はみ出しバッジ（DESIGN.md 7.2 / 7.3） ----------
  // 検知の本体は media/overflow.js の window.ssDetectOverflow。読み込まれていなければ何もしない（同期プレビュー本体は動く）。
  let ofResults = new Map();   // スライド index → { bottomPx, hitsTakeaway, hitsHeader }（はみ出したものだけ）
  let ofRun = 0;               // 走っている検知の番号。描き直されたら古い走りを捨てる
  let ofTimer = null;
  let ofBusy = false;          // 全体の走りが途中か
  let ofLast = '[]';           // 前回送った overflowReport の中身（変わったときだけ送る）
  const idle = window.requestIdleCallback
    // 画面に動きが無いと空き時間の通知が timeout まで来ないことがある（実測：ヘッドレス Chrome）。待ちは 200ms まで
    ? (fn) => window.requestIdleCallback(fn, { timeout: 200 })
    : (fn) => setTimeout(fn, 30);
  function scheduleOverflow(soon) {
    if (typeof window.ssDetectOverflow !== 'function') return;
    clearTimeout(ofTimer);
    ofTimer = setTimeout(() => { ofTimer = null; runOverflow(); }, soon ? 60 : 300);   // 画像の load は続けて来るので、まとめて 1 回にする
  }
  function runOverflow() {
    if (typeof window.ssDetectOverflow !== 'function') return;
    const run = ++ofRun;
    const ss = slides();
    const next = new Map();
    let i = 0;
    ofBusy = true;
    const step = () => {
      if (run !== ofRun) return;
      if (edit) { ofBusy = false; return; }   // 編集中は回さない（枠線や入力中の文字で寸法が変わる）。確定・破棄のあとにもう一度回る
      const end = Math.min(ss.length, i + 10);   // 1 回の空き時間に 10 枚ずつ。80 枚のデックでも入力を止めない
      for (; i < end; i++) {
        let r = null;
        try { r = window.ssDetectOverflow(sectionOf(ss[i])); } catch (_) { /* その 1 枚は「分からない」として飛ばす */ }
        if (r && r.overflow) next.set(i, { bottomPx: Math.round(Number(r.bottomPx) || 0), hitsTakeaway: !!r.hitsTakeaway, hitsHeader: !!r.hitsHeader });
      }
      if (i < ss.length) idle(step); else { ofBusy = false; finishOverflow(next); }
    };
    idle(step);
  }
  /** patch で差し替えた枚・画像が読み込まれた枚だけ測り直す。続けて来る分は 1 回にまとめる。全体の走りが控えていれば、そちらに任せる */
  const ofPart = new Set();
  let ofPartTimer = null;
  function overflowFor(indices) {
    if (typeof window.ssDetectOverflow !== 'function' || !indices.length) return;
    if (ofTimer || ofBusy) { scheduleOverflow(false); return; }
    for (const i of indices) ofPart.add(i);
    clearTimeout(ofPartTimer);
    ofPartTimer = setTimeout(() => idle(() => {
      if (edit || ofTimer || ofBusy) { ofPart.clear(); return; }   // 編集を終えたとき・全体の走りが、まとめて測る
      const list = Array.from(ofPart); ofPart.clear();
      const ss = slides();
      const next = new Map(ofResults);
      for (const i of list) {
        let r = null;
        try { r = ss[i] ? window.ssDetectOverflow(sectionOf(ss[i])) : null; } catch (_) { /* 分からないものは前の結果も消す */ }
        if (r && r.overflow) next.set(i, { bottomPx: Math.round(Number(r.bottomPx) || 0), hitsTakeaway: !!r.hitsTakeaway, hitsHeader: !!r.hitsHeader });
        else next.delete(i);
      }
      finishOverflow(next);
    }), 120);
  }
  function finishOverflow(next) {
    ofResults = next;
    layoutOverflow(slides());
    const list = Array.from(next.keys()).sort((a, b) => a - b).map(index => Object.assign({ index }, next.get(index)));
    const sig = JSON.stringify(list);
    if (sig === ofLast) return;
    ofLast = sig;
    post({ type: 'overflowReport', version, slides: list });
  }
  function overflowTitle(r) {
    const parts = [];
    if (r.bottomPx > 0) parts.push('本文が下へ ' + r.bottomPx + 'px はみ出しています');
    if (r.hitsTakeaway) parts.push('要点帯（takeaway）に重なっています');
    if (r.hitsHeader) parts.push('ヘッダー帯に食い込んでいます');
    return (parts.join('／') || 'はみ出しています') + '（1280×720 の座標での量）';
  }
  function layoutOverflow(ss) {
    Array.from(layer.querySelectorAll('.ss-over')).forEach(e => e.remove());
    ofResults.forEach((r, i) => {
      const s = ss[i];
      if (!s) return;
      const b = s.getBoundingClientRect();
      const el = h('div', { class: 'ss-over', 'data-index': String(i), title: overflowTitle(r), text: '⚠ はみ出し' });
      el.style.left = (b.left + window.scrollX + 4 + (marks[i] ? 22 : 0)) + 'px';   // ★ があればその右
      el.style.top = (b.top + window.scrollY - 23) + 'px';
      layer.appendChild(el);
    });
  }

  /** スウォッチの見た目を、現在のスライドの実際のテーマ色に合わせる（--accent は section に定義されている） */
  function refreshSwatches() {
    const sec = sectionOf(slides()[cur]);
    let cs = null;
    try { cs = sec ? getComputedStyle(sec) : null; } catch (_) { /* 無視 */ }
    for (const s of SWATCHES) {
      if (!s.v) continue;
      const v = cs ? cs.getPropertyValue(s.v).trim() : '';
      s.el.style.background = v || s.fb;
    }
  }
  function highlight(i) {
    const ss = slides();
    cur = Math.max(0, Math.min(ss.length - 1, i));
    ss.forEach((s, idx) => s.classList.toggle('current-slide', idx === cur));
    setBadge(ss);
    refreshSwatches();
    layout();
  }
  function scrollTo(i) {
    const s = slides()[i];
    if (s) { s.scrollIntoView({ behavior: 'smooth', block: 'start' }); highlight(i); }
  }
  // キーでのスライド送り。プレビューを動かし、原稿のカーソルも同じスライドへ（フォーカスは奪わない）
  function goTo(i) {
    const ss = slides(); if (!ss.length) return;
    const n = Math.max(0, Math.min(ss.length - 1, i));
    if (n === cur) return;
    navMode = true;
    scrollTo(n);
    post({ type: 'gotoSlide', index: n });
  }
  function go(d) { goTo(cur + d); }

  // ---------- 指定ページへ送る（右下の Slide n/N を押す、または G） ----------
  function setBadge(ss) {
    ss = ss || slides();
    badgeText.textContent = ss.length ? 'Slide ' + (cur + 1) + '/' + ss.length : 'Slide –';
  }
  function openJump() {
    if (badge.classList.contains('ss-jumping')) { jumpInput.focus(); return; }
    badge.classList.add('ss-jumping');
    jumpInput.value = '';
    jumpInput.placeholder = (cur + 1) + ' / ' + slides().length;
    jumpInput.focus();
  }
  function closeJump() { badge.classList.remove('ss-jumping'); jumpInput.blur(); }
  badge.addEventListener('click', (ev) => { if (ev.target !== jumpInput) openJump(); });
  badge.addEventListener('keydown', (ev) => {
    if (ev.target === badge && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openJump(); }
  });
  jumpInput.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return;
    ev.stopPropagation();   // 入力中の j / k / 矢印をスライド送りに使わない
    if (ev.key === 'Escape') { ev.preventDefault(); closeJump(); return; }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    // 全角数字でも通す
    const v = jumpInput.value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim();
    const n = parseInt(v, 10);
    const total = slides().length;
    if (!Number.isFinite(n) || n < 1 || n > total) { toast('1〜' + total + ' の番号を入れてください', true); jumpInput.select(); return; }
    closeJump();
    goTo(n - 1);
  });
  jumpInput.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== jumpInput) badge.classList.remove('ss-jumping'); }, 0));

  // ---------- クリック逆引き ----------
  // ポインタ直下のテキストノードを精密に取り、その文字列で原稿を照合させる。
  // 併せて要素の実寸 font-size(px) を読み、サイズ増減の起点として送る。
  function probeUnderPointer(ev) {
    let r = null;
    if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(ev.clientX, ev.clientY);
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(ev.clientX, ev.clientY); if (p) r = { startContainer: p.offsetNode }; }
    const node = r && r.startContainer;
    const el = (node && (node.nodeType === 3 ? node.parentElement : node)) || ((ev.target && ev.target.closest) ? ev.target : null);
    let px = null, line = null;
    if (el) {
      try { px = parseFloat(getComputedStyle(el).fontSize) || null; } catch (_) { /* 無視 */ }
      const le = el.closest ? el.closest('[data-line]') : null;     // 元の行番号(確実)
      if (le && le.tagName !== 'SECTION') line = numAttr(le, 'data-line');
    }
    let text = '';
    if (node && node.nodeType === 3) text = node.textContent || '';
    else if (el && el.textContent) text = el.textContent;
    return { text, px, line };
  }
  function inUi(t) { return !!(t && t.closest && t.closest('.ss-ui')); }

  document.addEventListener('click', (ev) => {
    if (inUi(ev.target)) return;              // ツールバー・操作ボタン・ギャラリーは逆引き対象外
    if (edit) return;                         // 編集中のクリックはキャレット移動。逆引きしない
    if (ev.target && ev.target.isContentEditable) return;
    navMode = false;   // クリックし直したらページ送りモードを抜ける（↑↓ がサイズ調整に戻る）
    if (ev.detail > 1) return;                // ダブルクリックの2打目
    if (Date.now() - lastFinishAt < 350) return; // 「外をクリックして確定」のクリックで原稿へ飛ばさない
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;      // ドラッグで文字を選んだ直後（tuneSelect の経路）
    const svg = ev.target && ev.target.closest ? ev.target.closest('svg[data-marpit-svg]') : null;
    if (!svg) return;
    const i = slides().indexOf(svg);
    if (i < 0) return;
    const u = probeUnderPointer(ev);
    const text = (u.text || '').replace(/\s+/g, ' ').trim();
    let msg;
    if (u.line != null) msg = { type: 'revealLine', index: i, line: u.line, px: u.px };   // data-line で確実に逆引き
    else if (text) msg = { type: 'revealText', index: i, text, px: u.px };               // 保険: テキスト照合
    else msg = { type: 'revealSlide', index: i };                                         // 余白: スライド先頭
    // 逆引きは原稿側へフォーカスを移す。ダブルクリックの1打目でそれが起きると編集に入れないので、
    // 少し待ってから送り、ダブルクリックが来たら取り消す。
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => { revealTimer = null; if (!edit) post(msg); }, 250);
  });

  // ---------- 直接編集：対象の決め方 ----------
  // 親へ遡るインライン要素。ここに無いタグ（li / p / h1〜h6 / td / th / div / blockquote / figcaption …）で止まる。
  const INLINE = new Set(['span', 'strong', 'em', 'b', 'i', 'a', 'code', 'mark', 'small', 'sub', 'sup', 'u', 's', 'del', 'ins',
    'kbd', 'abbr', 'cite', 'q', 'var', 'samp', 'time', 'label', 'font', 'ruby', 'rt', 'rb', 'rp', 'bdi', 'bdo', 'br', 'wbr']);
  const NEVER = new Set(['section', 'foreignobject', 'svg', 'body', 'html', 'header', 'footer', 'ul', 'ol', 'table', 'tbody', 'thead', 'tr',
    'img', 'video', 'audio', 'iframe', 'pre', 'style', 'script', 'input', 'textarea', 'select', 'button']);
  function tagOf(el) { return el && el.tagName ? el.tagName.toLowerCase() : ''; }
  function blank(s) { return !s || !s.trim(); }
  /** 直下、またはインライン要素越しに、文字を持っているか（子のブロックの中の文字は数えない） */
  function hasInlineText(el) {
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { if (!blank(c.nodeValue)) return true; }
      else if (c.nodeType === 1 && INLINE.has(tagOf(c)) && hasInlineText(c)) return true;
    }
    return false;
  }
  function inHeaderFooter(el, section) {
    for (let e = el; e && e !== section; e = e.parentElement) {
      const t = tagOf(e);
      if ((t === 'header' || t === 'footer') && e.parentElement === section) return true;
    }
    return false;
  }
  /**
   * ポインタ直下の要素から、編集対象を決める。
   *   { kind:'ce', el }  … 文字を直接含む最も近いブロック要素（contenteditable を付ける先）
   *   { kind:'svg', el } … インライン SVG の <text>/<tspan>（入力欄を重ねる先）
   *   null               … 編集できない（header/footer・余白・画像・文字の無い箱）
   * section 全体には絶対に付けない（全選択→1文字でスライドが全消去されるのを実測）。
   */
  function editableFrom(t, allowEmpty) {
    if (!t || t.nodeType !== 1 || inUi(t)) return null;
    const frame = t.closest('svg[data-marpit-svg]');
    const section = t.closest('section');
    if (!frame || !section || section !== sectionOf(frame)) return null;
    if (t === section || inHeaderFooter(t, section)) return null;
    const isvg = t.closest('svg:not([data-marpit-svg])');
    if (isvg && section.contains(isvg)) {
      const te = t.closest('tspan, text');
      if (!te || !isvg.contains(te)) return null;
      for (const c of te.childNodes) if (c.nodeType === 3 && !blank(c.nodeValue)) return { kind: 'svg', el: te };
      return null;
    }
    let b = t;
    while (b && INLINE.has(tagOf(b))) b = b.parentElement;
    if (!b || NEVER.has(tagOf(b)) || !section.contains(b) || b === section) return null;
    if (!hasInlineText(b) && !(allowEmpty && !b.firstElementChild)) return null;
    return { kind: 'ce', el: b };
  }

  // ホバーで「ここは直接直せる」を示す
  let hoverEl = null;
  function setHover(el) {
    if (hoverEl === el) return;
    if (hoverEl) dropClass(hoverEl, 'ss-hover');
    hoverEl = el;
    if (hoverEl) hoverEl.classList.add('ss-hover');
  }
  document.addEventListener('mouseover', (ev) => {
    if (edit) { setHover(null); return; }
    const c = editableFrom(ev.target, false);
    setHover(c ? c.el : null);
  });
  document.addEventListener('mouseleave', () => setHover(null));

  document.addEventListener('dblclick', (ev) => {
    if (edit || inUi(ev.target)) return;
    // 空の箇条書き（文字がまだ無い li）も、ダブルクリックで書き始められるようにする
    const c = editableFrom(ev.target, tagOf(ev.target) === 'li');
    if (!c) return;
    // 1打目で予約した逆引きを取り消す（送ると原稿側へフォーカスが移り、編集に入れない）
    clearTimeout(revealTimer); revealTimer = null;
    ev.preventDefault();
    if (c.kind === 'svg') beginSvgEdit(c.el, { x: ev.clientX, y: ev.clientY });
    else beginEdit(c.el, { x: ev.clientX, y: ev.clientY });
  });

  // ---------- 直接編集：contenteditable ----------
  function bulletOf(el) {
    if (tagOf(el) === 'li') return el;
    // ゆるいリスト（項目の間に空行）は li > p になる。箇条書きの操作は li の行範囲で行う
    if (tagOf(el) === 'p' && tagOf(el.parentElement) === 'li') return el.parentElement;
    return null;
  }
  /** 編集要素から見た、テキストノードの親のタグの並び（"strong" や "span>em"。直下なら ""） */
  function pathOf(n, el) {
    const tags = [];
    for (let p = n.parentNode; p && p !== el; p = p.parentNode) tags.unshift(tagOf(p));
    return tags.join('>');
  }
  function beginEdit(el, opts) {
    const frame = el.closest('svg[data-marpit-svg]');
    const section = sectionOf(frame);
    const index = slides().indexOf(frame);
    if (!section || index < 0 || !section.contains(el)) return false;
    setHover(null);
    // 開始時のスナップショット。確定時に「ノードの同一性」で照合して changes を作る
    // （beforeinput.getTargetRanges() は plaintext-only では常に空だった＝実測）。
    const all = collect(section);
    const snap = [];
    all.forEach((n, k) => { if (el.contains(n.node)) snap.push({ k, node: n.node, old: n.t, parent: n.node.parentNode, path: pathOf(n.node, el) }); });
    const known = new Map();   // 空白だけのノードも含む、開始時の全テキストノード
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) known.set(n, n.nodeValue);
    const bullet = bulletOf(el);
    const lineEl = bullet || el;
    const e = {
      kind: 'ce', el, index, version, nodes: wireNodes(all), snap, known, html0: el.innerHTML,
      bullet, line: numAttr(lineEl, 'data-line'), lineEnd: numAttr(lineEl, 'data-line-end'),
      spell0: el.getAttribute('spellcheck'), finishing: false,
    };
    // plaintext-only：Enter で <div> が入る・&nbsp; が混ざる、といった DOM の破壊を避ける
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    el.classList.add('ss-editing');
    e.onKey = (ev) => onEditKey(ev);
    e.onBlur = () => { if (edit === e) finishEdit(true, 'none'); };
    e.onPaste = (ev) => {
      // 改行を持ち込むとテキストノードが割れて旧→新の対応が取れなくなる。1行の文字として入れる
      ev.preventDefault();
      const s = ((ev.clipboardData && ev.clipboardData.getData('text/plain')) || '').replace(/\s*[\r\n]+\s*/g, ' ');
      if (s) document.execCommand('insertText', false, s);
    };
    e.onDrop = (ev) => ev.preventDefault();
    el.addEventListener('keydown', e.onKey);
    el.addEventListener('blur', e.onBlur);
    el.addEventListener('paste', e.onPaste);
    el.addEventListener('drop', e.onDrop);
    edit = e; markEditing();
    el.focus({ preventScroll: true });
    placeCaret(el, opts);
    return true;
  }
  /** キャレットをクリック位置へ。位置が無ければ末尾へ（空の li でもキャレットが入るように要素自身を指す） */
  function placeCaret(el, opts) {
    const sel = window.getSelection();
    let r = null;
    if (opts && opts.x != null && document.caretRangeFromPoint) {
      r = document.caretRangeFromPoint(opts.x, opts.y);
      if (r && !el.contains(r.startContainer)) r = null;
    }
    if (!r) { r = document.createRange(); r.selectNodeContents(el); r.collapse(false); }
    r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
  }
  function isEmptyBullet(e) {
    if (!e.bullet) return false;
    if (!blank(e.el.textContent)) return false;
    return !e.el.querySelector('img, svg, video, ul, ol');
  }
  function onEditKey(ev) {
    // 既存の window keydown（j/k/矢印でスライド送り）へ流さない。"jack" が "ac" になるのを実測
    ev.stopPropagation();
    // IME 変換中の Enter は変換の確定。編集の確定にしない
    if (ev.isComposing || ev.keyCode === 229) return;
    const e = edit; if (!e) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const more = ev.shiftKey || ev.metaKey || ev.ctrlKey;
      finishEdit(true, (more && e.bullet) ? 'newBullet' : 'none');
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      finishEdit(false, 'none');
    } else if (ev.key === 'Backspace' && isEmptyBullet(e) && e.line != null) {
      // 空の箇条書きで Backspace ＝ その箇条書きを消す
      ev.preventDefault();
      finishEdit(false, 'none');
      post({ type: 'bulletDelete', index: e.index, version: e.version, line: e.line, lineEnd: e.lineEnd });
    }
  }
  /**
   * スナップショットと今の DOM を比べて changes を作る。
   *   - 元のノードが消えていたら now:''
   *   - 新しくできたテキストノードは、要素を挟まずに隣り合う直前（無ければ直後）のノードへの追記として扱う
   *   - 隣に無ければ、同じ場所にいた消えたノードの書き換え。それも決まらなければ unsupported（書き戻さない）
   *   - 文字が1つも無かった要素（空の箇条書き）に打った文字は { k:null, old:'', now }。行は line / lineEnd で伝える
   * 「同じ場所」＝生き残ったノードの並びの中で同じ区間にいること。要素の同一性では比べない
   * （Chrome は削除のついでに隣の <strong> を中の文字ごと作り直すことがある＝実測）。
   */
  function diffEdit(e) {
    const el = e.el;
    if (!e.snap.length) {
      const text = (el.textContent || '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
      if (!text) return { changes: [] };
      if (e.line == null) return { unsupported: true };
      return { changes: [{ k: null, old: '', now: text }], emptyTarget: true };
    }
    const snap = e.snap;
    // まず「並びで対応づける」。文字のあるテキストノードの個数と、それぞれの親のタグの並びが開始時と同じなら、
    // i 番目どうしが同じ場所。ノードの同一性より確か：Chrome は削除のとき、隣の <strong> を作り直して
    // 元のテキストノードを別の場所の文字に使い回すことがある（実測：「a **b** c」の c を消して X と打つと、
    // 元の b のノードが li 直下の "X" になり、b は新しいノードになった。同一性で比べると太字の中へ X を書いてしまう）。
    const seq = [];
    const w0 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w0.nextNode(); n; n = w0.nextNode()) if (!blank(n.nodeValue)) seq.push(n);
    if (seq.length === snap.length && seq.every((n, i) => pathOf(n, el) === snap[i].path)) {
      const out = [];
      seq.forEach((n, i) => { if (n.nodeValue !== snap[i].old) out.push({ k: snap[i].k, old: snap[i].old, now: n.nodeValue }); });
      return { changes: out };
    }
    // 個数や構造が変わった（ノードが消えた・増えた）ときは、ノードの同一性で照合する
    const curOf = new Map(snap.map(s => [s, s.node]));   // 元のノード → 今それにあたるノード（作り直されたら付け替える）
    const alive = (s) => { const n = curOf.get(s); return !!n && n.isConnected && el.contains(n); };
    const owner = new Map();                             // 今のノード → 元のノード
    const rebuildOwner = () => { owner.clear(); for (const s of snap) if (alive(s)) owner.set(curOf.get(s), s); };
    rebuildOwner();
    /** 新しいノード n が、生き残ったノードの並びのどの区間にいるか → その区間にいた消えたノード */
    const deadAround = (n) => {
      let ai = -1, bi = snap.length;
      for (let i = 0; i < snap.length; i++) {
        if (!alive(snap[i])) continue;
        if (curOf.get(snap[i]).compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) ai = i; else { bi = i; break; }
      }
      return snap.slice(ai + 1, bi).filter(s => !alive(s));
    };
    const fresh = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (!owner.has(n)) fresh.push(n);
    // 1) 作り直されただけのノード（同じ区間に、同じ文字の消えたノードがある）は、元のノードの続きとして扱う
    const rest = [];
    for (const n of fresh) {
      const v = n.nodeValue || '';
      const same = e.known.has(n) ? null : deadAround(n).find(s => s.old === v);
      if (same) { curOf.set(same, n); rebuildOwner(); } else rest.push(n);
    }
    // 元のノードが別の構造の中へ移っていたら（使い回し）、同一性は当てにならない。書き戻さない
    for (const s of snap) if (alive(s) && pathOf(curOf.get(s), el) !== s.path) return { unsupported: true };
    const now = new Map();
    for (const s of snap) now.set(s.k, alive(s) ? curOf.get(s).nodeValue : '');
    const pre = new Map(), post = new Map();   // 元のノードの前／後ろに足す文字（DOM 順に連結する）
    for (const n of rest) {
      const v = n.nodeValue || '';
      const before = e.known.get(n);
      if (before === v || !v) continue;      // 最初からあった空白だけのノードで、変わっていない
      // 空白だけだったノードに打ち込まれた場合は、元の空白を除いた分だけを追記として扱う
      let added = v;
      if (before !== undefined) {
        if (v.startsWith(before)) added = v.slice(before.length);
        else if (v.endsWith(before)) added = v.slice(0, v.length - before.length);
      }
      if (blank(added) && before !== undefined) continue;
      // 追記先は「要素を挟まずに隣り合う」元のノードだけ。<strong> などを飛び越えた先のノードへ足すと、
      // 原稿では太字の反対側に書かれてしまう（実測：「前 **太** 後」の「前 」を消して打ち直すと「後」の頭に付いた）。
      let target = null;
      for (let p = n.previousSibling; p && p.nodeType !== 1; p = p.previousSibling) {
        if (owner.has(p)) { target = owner.get(p); post.set(target.k, (post.get(target.k) || '') + added); break; }
      }
      if (!target) for (let p = n.nextSibling; p && p.nodeType !== 1; p = p.nextSibling) {
        if (owner.has(p)) { target = owner.get(p); pre.set(target.k, (pre.get(target.k) || '') + added); break; }
      }
      if (!target) {
        // 全部消して打ち直すと、元のノードが捨てられて新しいノードになる。同じ区間・同じ親にいた消えたノードの
        // 書き換えとして扱う。候補が1つに決まるときだけ
        const cands = deadAround(n).filter(s => s.parent === n.parentNode);
        if (cands.length === 1) { target = cands[0]; now.set(target.k, now.get(target.k) + added); }
      }
      if (!target) return { unsupported: true };
    }
    const changes = [];
    for (const s of snap) {
      const v = (pre.get(s.k) || '') + now.get(s.k) + (post.get(s.k) || '');
      if (v !== s.old) changes.push({ k: s.k, old: s.old, now: v });
    }
    return { changes };
  }
  function finishEdit(commit, then) {
    const e = edit;
    if (!e || e.finishing) return;
    e.finishing = true;     // 属性を外すと blur が来る。二重に確定しない
    if (e.kind === 'svg') { finishSvgEdit(e, commit); return; }
    const el = e.el;
    el.removeEventListener('keydown', e.onKey);
    el.removeEventListener('blur', e.onBlur);
    el.removeEventListener('paste', e.onPaste);
    el.removeEventListener('drop', e.onDrop);
    let res = { changes: [] };
    if (commit) res = diffEdit(e);
    el.removeAttribute('contenteditable');
    if (e.spell0 == null) el.removeAttribute('spellcheck'); else el.setAttribute('spellcheck', e.spell0);
    dropClass(el, 'ss-editing');
    if (!commit || res.unsupported) el.innerHTML = e.html0;   // 破棄：開始時の中身へ戻す
    edit = null; markEditing();
    lastFinishAt = Date.now();
    try { if (document.activeElement === el) el.blur(); } catch (_) { /* 無視 */ }
    if (res.unsupported) {
      // 位置を確定できない編集は書き戻さない。原稿の該当行へ案内する
      toast('この編集はプレビューから書き戻せません。原稿の該当行で直してください。', true);
      if (e.line != null) post({ type: 'revealLine', index: e.index, line: e.line });
    } else if (commit && (res.changes.length || then === 'newBullet')) {
      const msg = { type: 'editCommit', index: e.index, version: e.version, nodes: e.nodes, changes: res.changes,
        then: then || 'none', line: e.line, lineEnd: e.lineEnd };
      if (res.emptyTarget) msg.emptyTarget = true;
      lastCommit = { undo: () => { if (el.isConnected) el.innerHTML = e.html0; } };
      post(msg);
    }
    flushPending();
  }
  function flushPending() {
    const m = pendingRender, pm = pendingPatch;
    pendingRender = null; pendingPatch = null;
    if (!m && !pm) { scheduleOverflow(false); return; }   // 編集中に止めていた検知を回し直す（render があれば applyRender が回す）
    if (m) applyRender(m);
    if (pm) applyPatch(pm);   // render のあとに届いた patch は、その render の上に当てる
  }

  // ---------- 直接編集：インライン SVG の文字（入力欄を重ねる） ----------
  function beginSvgEdit(te, pt) {
    const frame = te.closest('svg[data-marpit-svg]');
    const section = sectionOf(frame);
    const index = slides().indexOf(frame);
    if (!section || index < 0) return false;
    // <text>前<tspan>中</tspan>後</text> のように直下の文字が複数あるときは、ポインタの下にあるものを選ぶ
    // （先頭に決め打ちすると、「後」を押したのに「前」の入力欄が開く）。見つからなければ先頭
    let node = null;
    const direct = Array.from(te.childNodes).filter(c => c.nodeType === 3 && !blank(c.nodeValue));
    if (pt && direct.length > 1) {
      for (const c of direct) {
        const rg = document.createRange(); rg.selectNodeContents(c);
        const hit = Array.from(rg.getClientRects()).some(b => pt.x >= b.left - 1 && pt.x <= b.right + 1 && pt.y >= b.top - 1 && pt.y <= b.bottom + 1);
        if (hit) { node = c; break; }
      }
    }
    if (!node) node = direct[0] || null;
    if (!node) return false;
    const all = collect(section);
    const k = all.findIndex(n => n.node === node);
    if (k < 0) return false;
    setHover(null);
    const old = node.nodeValue;
    const input = h('input', { class: 'ss-svg-input', type: 'text', spellcheck: 'false' });
    input.value = old.trim();
    // input は改行を受け付けない。改行入りのラベルは代入した時点で値が変わるので、「変えたか」は代入後の値と比べる
    // （比べないと、開いて Enter しただけで原稿の改行が消える＝実測）
    const e = { kind: 'svg', el: te, node, k, old, input, value0: input.value, index, version, nodes: wireNodes(all), finishing: false,
      lead: old.match(/^\s*/)[0], trail: old.match(/\s*$/)[0] };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === 'Enter') { ev.preventDefault(); finishEdit(true, 'none'); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finishEdit(false, 'none'); }
    });
    input.addEventListener('blur', () => { if (edit === e) finishEdit(true, 'none'); });
    input.addEventListener('input', () => placeSvgInput(e));
    layer.appendChild(input);
    edit = e; markEditing();
    placeSvgInput(e);
    te.classList.add('ss-svg-hidden');
    input.focus({ preventScroll: true });
    input.select();
    return true;
  }
  /** 入力欄を SVG の文字と同じ位置・同じ大きさに合わせる */
  function placeSvgInput(e) {
    const te = e.el, input = e.input;
    const hidden = te.classList.contains('ss-svg-hidden');
    if (hidden) dropClass(te, 'ss-svg-hidden');   // visibility:hidden でも矩形は取れるが、念のため実寸で測る
    let r = te.getBoundingClientRect();
    let cs = null; try { cs = getComputedStyle(te); } catch (_) { /* 無視 */ }
    // 縮小率：スライド枠の縮小（section 幅 / 1280）に、図の viewBox の拡縮が掛かる。
    // 画面上の高さ ÷ ユーザー単位の高さで両方まとめて求め、取れなければスライド枠の縮小率だけを使う。
    const section = te.closest('section');
    let scale = section ? section.getBoundingClientRect().width / 1280 : 1;
    try { const bb = te.getBBox(); if (bb && bb.height > 0 && r.height > 0) scale = r.height / bb.height; } catch (_) { /* 無視 */ }
    // 直下の文字が複数ある <text> では、編集するノードだけの矩形に合わせる
    try {
      const rg = document.createRange(); rg.selectNodeContents(e.node);
      const nb = rg.getBoundingClientRect();
      if (nb.width > 0 && nb.height > 0) r = nb;
    } catch (_) { /* 無視 */ }
    if (hidden) te.classList.add('ss-svg-hidden');
    const fs = Math.max(9, (cs ? parseFloat(cs.fontSize) || 16 : 16) * scale);
    input.style.fontSize = fs + 'px';
    input.style.fontFamily = cs ? cs.fontFamily : 'sans-serif';
    input.style.fontWeight = cs ? cs.fontWeight : '400';
    input.style.lineHeight = '1.25';
    const fill = cs ? cs.fill : '';
    input.style.color = (fill && fill !== 'none' && !/^url/.test(fill)) ? fill : '#111';
    // 白っぽい文字（色付きの箱の中の白抜き）は白地の入力欄で読めないので地を暗くする
    const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(input.style.color || '');
    const light = rgb && (0.299 * rgb[1] + 0.587 * rgb[2] + 0.114 * rgb[3]) > 200;
    input.style.background = light ? '#333' : '#fff';
    const anchor = cs ? cs.textAnchor : 'start';
    input.style.textAlign = anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left';
    // 幅は打った文字に合わせて伸ばす（元の幅より狭くはしない）
    const chars = Math.max(2, (input.value || '').length + 1);
    const wpx = Math.max(r.width + fs, chars * fs * 1.05, 60);
    input.style.width = wpx + 'px';
    const pad = 4 + 2;  // padding + border
    let left = r.left;
    if (anchor === 'middle') left = r.left + r.width / 2 - wpx / 2;
    else if (anchor === 'end') left = r.right - wpx;
    input.style.left = (left + window.scrollX - pad) + 'px';
    input.style.top = (r.top + window.scrollY - 3 - (fs * 1.25 - r.height) / 2) + 'px';
  }
  function finishSvgEdit(e, commit) {
    const v = e.input.value.replace(/\s*[\r\n]+\s*/g, ' ');
    e.input.remove();
    dropClass(e.el, 'ss-svg-hidden');
    edit = null; markEditing();
    lastFinishAt = Date.now();
    const now = e.lead + v.trim() + e.trail;   // 前後の空白は元のまま（原稿の空白を1バイトも変えない）
    if (commit && e.input.value !== e.value0 && now !== e.old) {
      if (e.node.isConnected) e.node.nodeValue = now;   // 再描画が届くまでの見た目
      lastCommit = { undo: () => { if (e.node.isConnected) e.node.nodeValue = e.old; } };
      post({ type: 'editCommit', index: e.index, version: e.version, nodes: e.nodes,
        changes: [{ k: e.k, old: e.old, now }], then: 'none', line: null, lineEnd: null });
    }
    flushPending();
  }

  // ---------- プレビューで選んだ文字へのサイズ/色（tuneSelect） ----------
  document.addEventListener('mouseup', (ev) => {
    if (edit || inUi(ev.target) || ev.detail > 1) return;   // ダブルクリックの単語選択は編集の入口なので送らない
    if (!(ev.target && ev.target.closest && ev.target.closest('svg[data-marpit-svg]'))) return;
    setTimeout(() => {   // 選択範囲が確定してから読む
      if (edit) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount < 1) return;
      const a = sel.anchorNode;
      // 1つのテキストノードの中で完結した選択だけ（またいだ選択は原稿の範囲に写せない）
      if (!a || a.nodeType !== 3 || a !== sel.focusNode) return;
      const pe = a.parentElement;
      const frame = pe && pe.closest('svg[data-marpit-svg]');
      const section = sectionOf(frame);
      if (!section || !section.contains(a)) return;
      const all = collect(section);
      const k = all.findIndex(n => n.node === a);
      if (k < 0) return;
      const start = Math.min(sel.anchorOffset, sel.focusOffset);
      const end = Math.max(sel.anchorOffset, sel.focusOffset);
      if (end <= start) return;
      let px = null; try { px = parseFloat(getComputedStyle(pe).fontSize) || null; } catch (_) { /* 無視 */ }
      clearTimeout(revealTimer); revealTimer = null;   // 行全体の選択で上書きされないように
      navMode = false;
      post({ type: 'tuneSelect', index: slides().indexOf(frame), version, nodes: wireNodes(all), k, start, end, px });
    }, 0);
  });

  // ---------- tune ツールバーの状態 ----------
  function hex6(c) {
    const s = String(c || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return null;
  }
  function setTuneState(s) {
    tActive = !!s.active;
    tuner.setAttribute('data-active', tActive ? '1' : '0');
    tSize.textContent = (s.size != null) ? (s.size + 'px') : '–';
    // input[type=color] は #rrggbb しか受け付けない。var(--accent) や rgb() は入れない
    const c = hex6(s.color);
    if (c) tColor.value = c;
  }

  // ---------- ギャラリー ----------
  // 2 つの使い方がある。
  //   検索ギャラリー（gallery メッセージ・＋ボタン）：拡張に corpusSearch を送り、corpusResults のカードを並べる。複数選んで corpusInsert。
  //   旧形式（library メッセージ）：受け取った台帳の entries をこの場で絞り込み、クリックで libraryInsert。互換のため当面残す。
  const PAGE = 24;
  const cssStore = new Map();   // cssKey → デックの css。重いので 1 回受け取ったら持ち続け、haveCss で「もう要らない」と伝える
  let gal = null;               // 検索ギャラリーの状態（旧形式・閉じているときは null）
  let reqSeq = 0;
  let searchTimer = null;
  let thumbObserver = null;

  function galOpen() { return gallery.classList.contains('ss-open'); }
  function closeGallery() {
    gallery.classList.remove('ss-open');
    clearTimeout(searchTimer); searchTimer = null;
    unwatch(galGrid);
    closeNameForm();
    if (gal) galGrid.textContent = '';   // Shadow DOM のサムネイル（デックの css を 1 枚ずつ抱える）を手放す
    gal = null;
  }
  function renderGallery() {
    const q = galFilter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    galGrid.textContent = '';
    let shown = 0;
    for (const en of galEntries) {
      const tags = Array.isArray(en.tags) ? en.tags : [];
      const hay = [en.title, en.pattern, en.deck, en.id].concat(tags).join(' ').toLowerCase();
      if (!q.every(w => hay.includes(w))) continue;
      shown++;
      const title = en.title || en.id || '(無題)';
      let thumb;
      if (en.thumb) {
        thumb = h('img', { class: 'ss-gal-thumb', src: en.thumb, alt: '', loading: 'lazy' });
        // 画像が読めなければ題名のカードへ替える
        thumb.addEventListener('error', () => thumb.replaceWith(h('div', { class: 'ss-gal-nothumb', text: title })));
      } else thumb = h('div', { class: 'ss-gal-nothumb', text: title });
      const deckName = String(en.deck || '').split('/').pop().replace(/\.md$/, '');
      const card = h('button', { class: 'ss-gal-card', type: 'button', 'data-id': en.id, title: title + '\n' + (en.deck || '') }, [
        thumb,
        h('div', { class: 'ss-gal-meta' }, [
          h('div', { class: 'ss-gal-name', text: title }),
          h('div', { class: 'ss-gal-sub' }, [en.pattern ? h('span', { class: 'ss-gal-pattern', text: en.pattern }) : null, h('span', { text: deckName })]),
          tags.length ? h('div', { class: 'ss-gal-tags' }, tags.map(t => h('span', { class: 'ss-gal-tag', text: t }))) : null,
        ]),
      ]);
      card.addEventListener('click', () => { post({ type: 'libraryInsert', id: en.id, index: cur, version }); closeGallery(); });
      galGrid.appendChild(card);
    }
    if (!shown) galGrid.appendChild(h('div', { class: 'ss-gal-empty',
      text: galEntries.length ? '該当するスライドがありません' : '印（★）の付いたスライドがまだありません' }));
    galCount.textContent = shown + ' / ' + galEntries.length;
  }
  function openGallery(entries) {
    if (edit) finishEdit(true, 'none');
    closePopups();
    galEntries = (Array.isArray(entries) ? entries : []).filter(en => en && typeof en === 'object' && en.id != null);
    gallery.classList.remove('ss-corpus');
    galTitle.textContent = '完成スライドのライブラリ';
    galFilter.setAttribute('placeholder', '絞り込み（題名・パターン・デック・タグ）');
    galFilter.value = '';
    renderGallery();
    gallery.classList.add('ss-open');
    galFilter.focus();
  }

  // ----- 検索ギャラリー -----
  /** index ＝「この次に入れる」スライド（−1 は先頭）。数でなければ現在のスライドの次 */
  function openCorpusGallery(index, query, onlyMarked) {
    if (edit) finishEdit(true, 'none');
    closePopups();
    const n = slides().length;
    let idx = Number.isInteger(index) ? index : cur;
    idx = Math.max(-1, Math.min(n - 1, idx));
    gal = { index: idx, reqId: 0, items: [], total: 0, building: false, waiting: false, sel: [] };
    gallery.classList.add('ss-corpus');
    galTitle.textContent = idx < 0 ? 'スライドを探して、先頭に挿入' : 'スライドを探して、' + (idx + 1) + ' 枚目の次に挿入';
    galFilter.setAttribute('placeholder', '例：自己紹介　生成AI 重み（空白で区切ると絞り込み）');
    galFilter.value = typeof query === 'string' ? query : '';
    galMarked.checked = onlyMarked === true;   // 開くたびに決め直す（前回の絞り込みが残って「見つからない」にならないように）
    galGrid.textContent = '';
    updateSelection();
    gallery.classList.add('ss-open');
    galFilter.focus();
    sendSearch(0);   // 語が空なら「手を入れた順」。開いた時点で使える資産が並ぶ
  }
  function sendSearch(offset) {
    if (!gal) return;
    clearTimeout(searchTimer); searchTimer = null;
    const query = galFilter.value.trim();
    let sort = galSort.value;
    if (!query && sort === 'relevance') sort = 'score';   // 語が無ければ関連度は付かない。手を入れた順と同じ
    gal.reqId = ++reqSeq;   // これより前に送った検索の応答は、届いても捨てる
    gal.waiting = true;
    post({ type: 'corpusSearch', reqId: gal.reqId, query, onlyMarked: !!galMarked.checked, sort,
      offset, limit: PAGE, haveCss: Array.from(cssStore.keys()) });
    updateStatus();
  }
  function searchSoon() {
    if (!gal) { renderGallery(); return; }
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => sendSearch(0), 250);
  }
  function validItem(it) { return !!it && typeof it === 'object' && typeof it.deck === 'string' && Number.isInteger(it.slide); }
  function keyOf(it) { return typeof it.key === 'string' ? it.key : it.deck + '#' + it.slide; }
  function onCorpusResults(m) {
    // css は古い応答のものでも取っておく（次の haveCss に載り、送り直させずに済む）
    putCss(m.css);
    // 棚つきの応答＝shelf.json が外で変わった（拡張が気づいて載せ直した）。結果が前と同じでも棚は描き直す
    const shelvesCame = Array.isArray(m.shelves);
    if (shelvesCame) setShelves(m.shelves);
    const offset = Number.isInteger(m.offset) ? m.offset : 0;
    const items = (Array.isArray(m.items) ? m.items : []).filter(validItem);
    if (prefetchReq && m.reqId === prefetchReq) {   // 先読みの応答：「手を入れた順」の上位として覚えておく
      prefetchReq = 0;
      if (items.length) topCache = items;
      if (pop && !pop.query && !pop.items) renderPop();
      warmThumbs();
      return;
    }
    if (pop && m.reqId === pop.reqId) { onPopResults(m, items); if (shelvesCame) { rerenderShelves(); warmThumbs(); } return; }
    if (!gal || m.reqId !== gal.reqId) return;
    if (offset === 0) { gal.items = []; galGrid.textContent = ''; galGrid.scrollTop = 0; }
    else if (offset !== gal.items.length) return;   // 「もっと見る」の続きとしてつながらない
    gal.waiting = false;
    gal.total = Number.isInteger(m.total) ? m.total : gal.items.length + items.length;
    gal.building = !!m.building;
    Array.from(galGrid.querySelectorAll('.ss-gal-more, .ss-gal-empty')).forEach(e => e.remove());
    for (const it of items) { gal.items.push(it); galGrid.appendChild(cardOf(it)); }
    if (offset === 0) refreshGalShelf();
    if (!gal.items.length) {
      const filtered = !!galFilter.value.trim() || galMarked.checked;
      galGrid.appendChild(h('div', { class: 'ss-gal-empty', text:
        gal.building ? '索引を作成中です。少し待ってから、もう一度検索してください。'
          : filtered ? '該当するスライドがありません。語を減らすか、「★ 完成だけ」を外してください。'
            : 'スライドの索引が空です。npm run library で作り直してください。' }));
    } else if (gal.items.length < gal.total) {
      const more = h('button', { class: 'ss-gal-more', type: 'button', text: 'もっと見る（残り ' + (gal.total - gal.items.length) + ' 件）' });
      more.addEventListener('click', () => { more.disabled = true; sendSearch(gal.items.length); });
      galGrid.appendChild(more);
    }
    updateSelection();
    updateStatus();
  }
  function updateStatus() {
    if (!gal) return;
    galCount.textContent = (gal.waiting ? '検索中…' : gal.items.length + ' / ' + gal.total + ' 件') + (gal.building ? '（索引を作成中）' : '');
    galCount.title = gal.building ? '変更履歴の集計がまだ終わっていません。「手を入れた順」は集計が済むと正確になります。' : '';
  }

  // ----- サムネイル（DESIGN.md 8.0） -----
  // Shadow DOM の中に <div class="marpit">＋スライドの svg を入れる（プレビュー本体の css と互いに混ざらない）。
  // デックの css（1 本 約 100KB）は CSSStyleSheet に 1 回だけ解析させ、同じデックのカードで共有する（adoptedStyleSheets）。
  // カードごとに <style> を作ると、その回数だけ解析が走って遅い（実測）。使えない環境では <style> に退避する。
  // 中の文字はクリックも選択もさせない（カードのクリック＝選択を邪魔しない）
  const FIX_CSS = ':host{display:block}div.marpit{pointer-events:none;user-select:none;-webkit-user-select:none}'
    + 'div.marpit>svg[data-marpit-svg]{display:block;width:100%;height:auto}';
  // @import は replaceSync が受け付けないので外して、要るものだけ小さな <style> で足す。url('…') や "…" の中の ; で切らないよう、
  // 引用符と url(…) を丸ごと読む。旧 /@import\s[^;]+;/ は Google Fonts の wght@400;700 の ; で切れ、残った 700&display=swap'); の
  // 引用符が次の規則（section の 1280×720・overflow:hidden）まで文字列として呑み込み、サムネイルの右側が切れていた（実測 2026-10-17）
  const IMPORT_RE = /@import\s+(?:url\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^)]*)\s*\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')[^;]*;/g;
  const sheetStore = new Map();   // cssKey → { sheet, imports }
  let fixSheet = null;
  let canAdopt = false;
  try {
    canAdopt = typeof CSSStyleSheet === 'function' && typeof CSSStyleSheet.prototype.replaceSync === 'function' && 'adoptedStyleSheets' in document;
    if (canAdopt) { fixSheet = new CSSStyleSheet(); fixSheet.replaceSync(FIX_CSS); }
  } catch (_) { canAdopt = false; }
  /** 受け取った css を覚える。同じ cssKey で中身が変わっていたら、解析済みのシートを捨てる */
  function putCss(map) {
    if (!map || typeof map !== 'object') return;
    for (const k of Object.keys(map)) {
      if (typeof map[k] !== 'string') continue;
      if (cssStore.get(k) !== map[k]) { cssStore.set(k, map[k]); sheetStore.delete(k); }
    }
  }
  function sheetFor(key) {
    if (!canAdopt) return null;
    let e = sheetStore.get(key);
    if (e) return e;
    const css = cssStore.get(key);
    if (css == null) return null;
    try {
      // replaceSync は @import を受け付けない（無視して警告を出す）。IMPORT_RE で外して、要るものだけ小さな <style> で足す
      const imports = css.match(IMPORT_RE) || [];
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(imports.length ? css.replace(IMPORT_RE, '') : css);
      e = { sheet, imports: imports.join('') };
    } catch (_) { return null; }
    sheetStore.set(key, e);
    return e;
  }
  function labelOf(it) { return it.label || it.title || '(無題)'; }
  function fillShadow(host) {
    const it = host.__ssItem;
    if (!it || host.shadowRoot) return;
    host.classList.remove('ss-wait');
    if (typeof it.html !== 'string' || !it.html || !cssStore.has(it.cssKey)) {
      host.classList.add('ss-gal-nothumb');
      host.textContent = labelOf(it);
      return;
    }
    const root = host.attachShadow({ mode: 'open' });
    // template の中身は不活性（画像や動画を読みに行かない）。ここで危ない物・重い物を外してから入れる
    const tpl = document.createElement('template');
    tpl.innerHTML = it.html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
    tpl.content.querySelectorAll('script, iframe, object, embed').forEach(e => e.remove());
    // イベント属性（onerror= など）は CSP（nonce 方式）でも動かないが、念のための二重の守りとして全部外す。
    // javascript: の URL も同じ（クリックされても動かないよう、ここで消しておく）
    // Event attributes (onerror= etc.) are already blocked by the nonce CSP; strip them anyway as a second
    // line of defense. Same for javascript: URLs (removed so they do nothing even if clicked).
    tpl.content.querySelectorAll('*').forEach((e) => {
      for (const a of Array.from(e.attributes)) {
        if (/^on/i.test(a.name) || (/^(href|xlink:href|src|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) e.removeAttribute(a.name);
      }
    });
    tpl.content.querySelectorAll('video, audio').forEach(v => {
      v.removeAttribute('controls'); v.removeAttribute('autoplay'); v.setAttribute('preload', 'none');
    });
    const sh = sheetFor(it.cssKey);
    if (sh) {
      root.adoptedStyleSheets = [sh.sheet, fixSheet];
      if (sh.imports) { const im = document.createElement('style'); im.textContent = sh.imports; root.appendChild(im); }
    } else {
      const st = document.createElement('style');
      st.textContent = cssStore.get(it.cssKey);
      const fix = document.createElement('style');
      fix.textContent = FIX_CSS;
      root.appendChild(st); root.appendChild(fix);
    }
    const box = document.createElement('div');
    box.className = 'marpit';
    box.appendChild(tpl.content);
    root.appendChild(box);
    host.textContent = '';   // 骨組みの題名（shadow を付けたら見えなくなるが、読み上げに残さない）
  }
  // 作り済みのサムネイル（host）。ポップアップは開くたびに同じカードを出すので、作り直さずに使い回す
  const hostCache = new Map();
  /** サムネイルの入れ物。埋まるまでは題名だけの骨組み（.ss-wait）。reuse（'s'＝棚・'t'＝上位や検索結果）のときは作り済みの物を返す。
   *  同じスライドが棚と上位の両方に出るので、置き場ごとに別の物を持つ（1 つの要素は 1 か所にしか置けない） */
  function hostFor(it, reuse) {
    const ck = (reuse || '') + '|' + keyOf(it) + '|' + it.cssKey;
    if (reuse) {
      const c = hostCache.get(ck);
      if (c && !c.isConnected && c.__ssItem && c.__ssItem.html === it.html) { c.__ssItem = it; return c; }
    }
    const host = h('div', { class: 'ss-gal-shadow ss-wait', text: labelOf(it) });
    host.__ssItem = it;
    if (reuse && !(hostCache.get(ck) && hostCache.get(ck).isConnected)) {
      hostCache.delete(ck); hostCache.set(ck, host);
      if (hostCache.size > 80) hostCache.delete(hostCache.keys().next().value);   // 古い順に手放す
    }
    return host;
  }
  // 見えているカード（と、その少し先）から順に埋める。スクロールする器（root）ごとに observer を 1 つ
  const observers = new Map();
  function watchThumb(host, rootEl) {
    if (host.shadowRoot || !host.classList.contains('ss-wait')) return;
    if (!window.IntersectionObserver) { fillShadow(host); return; }
    let ob = observers.get(rootEl);
    if (!ob) {
      ob = new IntersectionObserver((list) => {
        for (const en of list) if (en.isIntersecting) { ob.unobserve(en.target); fillShadow(en.target); }
      }, { root: rootEl, rootMargin: '300px 0px' });
      observers.set(rootEl, ob);
    }
    ob.observe(host);
  }
  function unwatch(rootEl) {
    const ob = observers.get(rootEl);
    if (ob) { ob.disconnect(); observers.delete(rootEl); }
  }
  /** アイドル時間に、棚と上位のサムネイルを作っておく（ポップアップを開いた瞬間に絵が出る） */
  let warmRun = 0;
  function warmThumbs() {
    const run = ++warmRun;
    const list = [];
    for (const sh of shelves) for (const it of sh.items.slice(0, 9)) if (!it.missing) list.push([it, 's']);
    for (const it of topCache.slice(0, 9)) list.push([it, 't']);
    let i = 0;
    const step = () => {
      if (run !== warmRun) return;
      const end = Math.min(list.length, i + 3);
      for (; i < end; i++) { try { fillShadow(hostFor(list[i][0], list[i][1])); } catch (_) { /* その 1 枚は開いたときに作る */ } }
      if (i < list.length) idle(step);
    };
    if (list.length) idle(step);
  }

  function cardOf(it) {
    const title = it.title || '(無題)';
    const host = hostFor(it, false);
    const badges = [];
    if (it.marked) badges.push(h('span', { class: 'ss-gal-badge ss-b-mark', title: '完成スライドの印が付いている', text: '★ 完成' }));
    if (it.touched > 0) badges.push(h('span', { class: 'ss-gal-badge ss-b-touch', title: 'git の履歴で、このスライドの内容が変わった版の数', text: '添削 ' + it.touched + ' 回' }));
    if (it.dupCount > 1) badges.push(h('span', { class: 'ss-gal-badge', title: '同じ題名・ほぼ同じ本文のスライドが、ほかのデックにもある（代表だけを出している）', text: '他 ' + (it.dupCount - 1) + ' 件' }));
    if (it.sameTheme === false) badges.push(h('span', { class: 'ss-gal-badge ss-b-theme', title: '貼り付け先とテーマが違う（' + (it.theme || '?') + '）。挿入後にはみ出しを確かめる', text: 'テーマ違い' }));
    const open = h('button', { class: 'ss-gal-open', type: 'button', title: (it.deck || '') + ' の ' + it.slide + ' 枚目をエディタで開く', text: '原稿を開く' });
    const naming = h('button', { class: 'ss-gal-naming', type: 'button', title: '呼び名を付けて棚に置く（元のデックは書き換えない）', text: '名前を付ける…' });
    const card = h('div', { class: 'ss-gal-card ss-gal-pick', role: 'option', tabindex: '0', 'aria-selected': 'false', 'data-key': keyOf(it),
      title: title + '\n' + (it.deck || '') + ' #' + it.slide }, [
      h('div', { class: 'ss-gal-thumbbox' }, [host, h('span', { class: 'ss-gal-order' })]),
      h('div', { class: 'ss-gal-meta' }, [
        h('div', { class: 'ss-gal-name', text: title }),
        h('div', { class: 'ss-gal-sub' }, [it.pattern ? h('span', { class: 'ss-gal-pattern', text: String(it.pattern) }) : null,
          h('span', { text: (it.date ? it.date + '　' : '') + (it.deckName || '') + ' #' + it.slide })]),
        it.snippet ? h('div', { class: 'ss-gal-snippet', text: String(it.snippet) }) : null,
        h('div', { class: 'ss-gal-row' }, [h('div', { class: 'ss-gal-tags' }, badges), naming, open]),
      ]),
    ]);
    card.__ssItem = it;
    // クリック＝選択の切り替え。ダブルクリックは 2 回の切り替えで元に戻ったあと、その 1 枚だけをすぐ入れる
    card.addEventListener('click', (ev) => { if (!(ev.target.closest && ev.target.closest('.ss-gal-open, .ss-gal-naming, .ss-nameform'))) toggleSel(it); });
    card.addEventListener('dblclick', (ev) => { if (!(ev.target.closest && ev.target.closest('.ss-gal-open, .ss-gal-naming, .ss-nameform'))) { ev.preventDefault(); insertItems([it]); } });
    open.addEventListener('click', (ev) => { ev.stopPropagation(); post({ type: 'openSource', deck: it.deck, slide: it.slide }); });
    naming.addEventListener('click', (ev) => { ev.stopPropagation(); openNameForm(card, it); });
    watchThumb(host, galGrid);
    return card;
  }
  // 選択は「選んだ順」を保ち、検索し直しても消さない（「自己紹介」で 1 枚、「重み」で 2 枚、と集めてまとめて入れられる）
  function toggleSel(it) {
    if (!gal) return;
    const k = keyOf(it);
    const at = gal.sel.findIndex(x => x.key === k);
    if (at >= 0) gal.sel.splice(at, 1); else gal.sel.push({ key: k, deck: it.deck, slide: it.slide });
    updateSelection();
  }
  function paintSel(rootEl, sel) {
    for (const card of rootEl.querySelectorAll('.ss-gal-pick')) {
      const at = sel.findIndex(x => x.key === card.getAttribute('data-key'));
      card.classList.toggle('ss-sel', at >= 0);
      card.setAttribute('aria-selected', at >= 0 ? 'true' : 'false');
      const o = card.querySelector('.ss-gal-order');
      if (o) o.textContent = at >= 0 ? String(at + 1) : '';
    }
  }
  function updateSelection() {
    const sel = gal ? gal.sel : [];
    paintSel(galGrid, sel);
    galSelCount.textContent = sel.length + ' 枚を選択中';
    galInsert.disabled = !sel.length;
    galSelClear.disabled = !sel.length;
  }
  function insertItems(list) {
    if (!gal || !list.length) return;
    post({ type: 'corpusInsert', items: list.map(x => ({ deck: x.deck, slide: x.slide })), index: gal.index, version,
      keepColors: !!galKeepColors.checked, keepTypo: !!galKeepTypo.checked });
    closeGallery();
  }
  /** ギャラリー／ポップアップが開いている間のキー（window の keydown から呼ぶ）。Esc は呼び出し側で処理済み。
   *  o = { root, filter, pending(), searchNow(), sel(), insert(list), toggle(it) } */
  const GAL_KEYS = { root: galGrid, filter: galFilter, pending: () => !!searchTimer, searchNow: () => sendSearch(0),
    sel: () => gal.sel, insert: (l) => insertItems(l), toggle: (it) => toggleSel(it) };
  function galKey(ev, o) {
    o = o || GAL_KEYS;
    if (ev.isComposing || ev.keyCode === 229) return;   // IME の確定の Enter で挿入しない
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const t = ev.target;
    if (t && t.closest && t.closest('.ss-nameform, .ss-inline')) return;   // 呼び名の入力中
    const card = t && t.closest ? t.closest('.ss-gal-pick') : null;
    const inFilter = t === o.filter;
    const tag = tagOf(t);
    const k = ev.key;
    if (k === 'Enter') {
      if (!inFilter && !(card && t === card) && (tag === 'button' || tag === 'select' || tag === 'input')) return;   // ボタン自身の Enter
      ev.preventDefault();
      if (inFilter && o.pending()) { o.searchNow(); return; }   // 打ち終えてすぐの Enter は「検索」
      if (o.sel().length) o.insert(o.sel());
      else if (card && card.__ssItem) o.insert([card.__ssItem]);
      return;
    }
    if (k === ' ' && card && t === card) { ev.preventDefault(); if (card.__ssItem) o.toggle(card.__ssItem); return; }
    if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'ArrowLeft' && k !== 'ArrowRight') return;
    if (tag === 'select' || (tag === 'input' && !inFilter)) return;
    const cards = Array.from(o.root.querySelectorAll('.ss-gal-pick'));
    if (!cards.length) return;
    if (!card) {
      // 検索欄の ←→ はキャレット移動。↓ だけカードへ降りる
      if (k === 'ArrowDown') { ev.preventDefault(); cards[0].focus(); }
      return;
    }
    ev.preventDefault();
    const at = cards.indexOf(card);
    let to = null;
    if (k === 'ArrowLeft') to = cards[at - 1] || null;
    else if (k === 'ArrowRight') to = cards[at + 1] || null;
    else {
      // 上下は、隣の行でいちばん横位置の近いカード
      const me = card.getBoundingClientRect();
      const dir = k === 'ArrowDown' ? 1 : -1;
      const cand = [];
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        const dy = (r.top - me.top) * dir;
        if (dy >= 4) cand.push({ c, dy, dx: Math.abs(r.left - me.left) });
      }
      const row = cand.reduce((m, x) => Math.min(m, x.dy), Infinity);
      const best = cand.filter(x => x.dy <= row + 4).sort((x, y) => x.dx - y.dx)[0] || null;
      to = best ? best.c : null;
      if (!to && k === 'ArrowUp') { o.filter.focus(); return; }   // いちばん上の行からは検索欄へ戻る
    }
    if (to) { to.focus(); to.scrollIntoView({ block: 'nearest' }); }
  }
  galFilter.addEventListener('input', searchSoon);
  galMarked.addEventListener('change', () => sendSearch(0));
  galSort.addEventListener('change', () => sendSearch(0));
  galInsert.addEventListener('click', () => { if (gal) insertItems(gal.sel); });
  galSelClear.addEventListener('click', () => { if (gal) { gal.sel = []; updateSelection(); } });
  galClose.addEventListener('click', closeGallery);
  gallery.addEventListener('mousedown', (ev) => { if (ev.target === gallery) closeGallery(); });   // 背景クリック


  // ---------- 棚（名前と並び順を自分で決める。DESIGN.md 8.2） ----------
  // shelves = [{ name, items:[{ label, missing, deck, slide, title, cssKey, html, … }] }]。正本は拡張側（slides/_library/shelf.json）。
  // 操作は shelfEdit を送り、応答（shelfState）を待たずに見た目を先に変える。失敗の shelfState が来たら戻す。
  let shelves = [];
  let shelfBackup = null;   // 直前の操作の前の姿（失敗したら戻す）
  let shelfTab = 0;         // 開いている棚（ポップアップを閉じても覚えておく）
  let topCache = [];        // 直前に受け取った「手を入れた順」の上位（ポップアップを開いた瞬間に出す）
  let prefetchReq = 0;
  let nameForm = null;
  let dragInfo = null;

  function normShelves(raw) {
    const out = [];
    for (const sh of (Array.isArray(raw) ? raw : [])) {
      if (!sh || typeof sh !== 'object' || typeof sh.name !== 'string') continue;
      const items = [];
      for (const it of (Array.isArray(sh.items) ? sh.items : [])) {
        if (!it || typeof it !== 'object') continue;
        const o = Object.assign({}, it);
        o.label = typeof it.label === 'string' && it.label ? it.label : (it.title || '(無題)');
        o.missing = it.missing === true || !validItem(it);   // 行方不明（元のスライドが見つからない）でも棚には残す
        items.push(o);
      }
      out.push({ name: sh.name, items });
    }
    return out;
  }
  function setShelves(raw) {
    shelves = normShelves(raw);
    if (shelfTab >= shelves.length) shelfTab = 0;
  }
  function onShelfState(m) {
    putCss(m.css);
    if (m.ok === false) {
      if (Array.isArray(m.shelves)) setShelves(m.shelves);
      else if (shelfBackup) { shelves = shelfBackup; if (shelfTab >= shelves.length) shelfTab = 0; }
      toast(m.message || '棚を更新できませんでした', true);
    } else if (Array.isArray(m.shelves)) setShelves(m.shelves);
    shelfBackup = null;
    rerenderShelves();
    warmThumbs();
  }
  function shelfEdit(op, payload, mutate) {
    const backup = shelves.map(sh => ({ name: sh.name, items: sh.items.slice() }));
    try { mutate(); } catch (_) { shelves = backup; return; }
    shelfBackup = backup;
    post(Object.assign({ type: 'shelfEdit', op }, payload));
    rerenderShelves();
  }
  function rerenderShelves(focusKey) {
    closeNameForm();
    if (pop && !pop.query) renderPop();
    if (gal) refreshGalShelf();
    if (focusKey) {
      const rootEl = pop ? popBody : galGrid;
      const c = Array.from(rootEl.querySelectorAll('.ss-pc-shelf')).find(e => e.getAttribute('data-key') === focusKey);
      if (c) c.focus();
    }
  }
  function refreshGalShelf() {
    Array.from(galGrid.querySelectorAll(':scope > .ss-shelf')).forEach(e => e.remove());
    if (!gal || galFilter.value.trim() || galMarked.checked) return;   // 語を打ったら結果だけを見せる
    const b = shelfBlock(GAL_CTX);
    if (b) galGrid.insertBefore(b, galGrid.firstChild);
    updateSelection();
  }
  /** 入力欄をその場に出す（プロンプトダイアログは使わない）。Enter・フォーカス外れで確定、Esc で破棄 */
  function inlineEdit(target, value, commit) {
    const inp = h('input', { class: 'ss-inline', type: 'text', value: value, spellcheck: 'false' });
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      const v = inp.value.trim();
      if (inp.parentNode) inp.replaceWith(target);
      if (ok && v && v !== value) commit(v);
    };
    inp.addEventListener('keydown', (ev) => {
      ev.stopPropagation();   // j/k や Esc（ポップアップを閉じる）に使わせない
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));
    for (const ty of ['click', 'dblclick', 'mousedown']) inp.addEventListener(ty, (ev) => ev.stopPropagation());
    target.replaceWith(inp);
    inp.focus(); inp.select();
  }
  function moveIn(arr, from, to) {
    if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return false;
    arr.splice(to, 0, arr.splice(from, 1)[0]);
    return true;
  }
  function moveItem(si, from, to) {
    const sh = shelves[si];
    if (!sh || from === to || to < 0 || to >= sh.items.length || !sh.items[from]) return;
    const key = sh.items[from].missing ? null : keyOf(sh.items[from]);
    shelfEdit('move', { shelf: sh.name, from, to }, () => { moveIn(sh.items, from, to); });
    if (key) rerenderShelves(key);
  }
  /** 棚の 1 区画（棚名のタブ＋名前つきサムネイル）。ctx = { max, pick(it, ev) } */
  function shelfBlock(ctx) {
    if (!shelves.length) return null;
    if (shelfTab >= shelves.length) shelfTab = 0;
    const tabs = h('div', { class: 'ss-shelf-tabs', role: 'tablist' });
    shelves.forEach((sh, i) => {
      const b = h('button', { class: 'ss-shelf-tab' + (i === shelfTab ? ' ss-on' : ''), type: 'button', role: 'tab', 'data-shelf': String(i),
        'aria-selected': i === shelfTab ? 'true' : 'false', title: 'ダブルクリックで棚の名前を直す／Alt+←→ で棚を並べ替える', text: sh.name });
      b.addEventListener('click', () => { if (shelfTab !== i) { shelfTab = i; rerenderShelves(); } });
      b.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        inlineEdit(b, sh.name, (v) => {
          if (shelves.some(x => x !== sh && x.name === v)) { toast('同じ名前の棚があります', true); return; }
          const old = sh.name;
          shelfEdit('renameShelf', { shelf: old, name: v }, () => { sh.name = v; });
        });
      });
      b.addEventListener('keydown', (ev) => {
        if (!ev.altKey || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
        ev.preventDefault(); ev.stopPropagation();
        const to = i + (ev.key === 'ArrowRight' ? 1 : -1);
        if (to < 0 || to >= shelves.length) return;
        shelfEdit('moveShelf', { from: i, to }, () => { moveIn(shelves, i, to); shelfTab = to; });
      });
      tabs.appendChild(b);
    });
    const sh = shelves[shelfTab];
    const grid = h('div', { class: 'ss-pc-grid', role: 'listbox', 'aria-label': '棚：' + sh.name });
    sh.items.slice(0, ctx.max).forEach((it, i) => grid.appendChild(pickCard(it, ctx, { si: shelfTab, at: i })));
    if (!sh.items.length) grid.appendChild(h('div', { class: 'ss-pop-note', text: 'この棚はまだ空です。カードの「名前を付ける…」で置けます。' }));
    const rest = sh.items.length - ctx.max;
    return h('div', { class: 'ss-shelf' }, [
      h('div', { class: 'ss-pop-h' }, [h('span', { text: '棚' }), tabs]),
      grid,
      rest > 0 ? h('div', { class: 'ss-pop-note', text: 'ほか ' + rest + ' 枚は「もっと探す」の棚にあります。' }) : null,
    ]);
  }
  /** 小さなカード（ポップアップと、ギャラリーの棚）。shelfAt = { si, at } なら棚のカード（改名・並べ替え・外す） */
  function pickCard(it, ctx, shelfAt) {
    const label = shelfAt ? it.label : (it.title || '(無題)');
    const where = it.missing ? '元のスライドが見つかりません（行方不明）。棚には残してあります' : (it.deck || '') + ' #' + it.slide;
    const name = h('div', { class: 'ss-pc-name', text: label, title: label + '\n' + where + (shelfAt ? '\nダブルクリックで呼び名を直す' : '') });
    const act = shelfAt
      ? h('button', { class: 'ss-pc-act ss-pc-x', type: 'button', title: '棚から外す（元のスライドは消えない）', 'aria-label': '棚から外す', text: '×' })
      : h('button', { class: 'ss-pc-act ss-pc-add', type: 'button', title: '呼び名を付けて棚に置く（元のデックは書き換えない）', text: '名前を付ける…' });
    let host;
    if (it.missing) host = h('div', { class: 'ss-gal-shadow ss-gal-nothumb ss-pc-lost', text: '行方不明' });
    else host = hostFor(it, shelfAt ? 's' : 't');
    const card = h('div', { class: 'ss-gal-card ss-pc' + (it.missing ? '' : ' ss-gal-pick') + (shelfAt ? ' ss-pc-shelf' : ''), role: 'option', tabindex: '0',
      'aria-selected': 'false', 'data-key': it.missing ? '' : keyOf(it) }, [
      h('div', { class: 'ss-gal-thumbbox' }, [host, h('span', { class: 'ss-gal-order' })]),
      h('div', { class: 'ss-pc-meta' }, [name, act]),
    ]);
    if (!it.missing) card.__ssItem = it;
    card.addEventListener('click', (ev) => {
      const t = ev.target;
      if (it.missing || (t.closest && t.closest('.ss-pc-act, .ss-inline'))) return;
      if (shelfAt && t === name) return;   // 呼び名はダブルクリックで直す。1 回目のクリックで挿入しない
      ctx.pick(it, ev);
    });
    act.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!shelfAt) { openNameForm(card, it); return; }
      const sh = shelves[shelfAt.si];
      if (sh) shelfEdit('remove', { shelf: sh.name, at: shelfAt.at, label: it.label }, () => { sh.items.splice(shelfAt.at, 1); });
    });
    if (shelfAt) {
      name.addEventListener('dblclick', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const sh = shelves[shelfAt.si];
        inlineEdit(name, it.label, (v) => { if (sh) shelfEdit('rename', { shelf: sh.name, at: shelfAt.at, label: v }, () => { it.label = v; }); });
      });
      // 並べ替え：ドラッグか Alt+←→
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (ev) => {
        dragInfo = { si: shelfAt.si, at: shelfAt.at };
        try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', label); } catch (_) { /* 無くても動く */ }
      });
      card.addEventListener('dragend', () => { dragInfo = null; });
      card.addEventListener('dragover', (ev) => { if (dragInfo && dragInfo.si === shelfAt.si) { ev.preventDefault(); card.classList.add('ss-drop'); } });
      card.addEventListener('dragleave', () => card.classList.remove('ss-drop'));
      card.addEventListener('drop', (ev) => {
        card.classList.remove('ss-drop');
        if (!dragInfo || dragInfo.si !== shelfAt.si) return;
        ev.preventDefault();
        const from = dragInfo.at; dragInfo = null;
        moveItem(shelfAt.si, from, shelfAt.at);
      });
      card.addEventListener('keydown', (ev) => {
        if (ev.target !== card || !ev.altKey || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
        ev.preventDefault(); ev.stopPropagation();
        moveItem(shelfAt.si, shelfAt.at, shelfAt.at + (ev.key === 'ArrowRight' ? 1 : -1));
      });
    }
    if (!it.missing) watchThumb(host, ctx.root);
    return card;
  }
  /** 「名前を付ける…」：カードのすぐ下に、呼び名と棚を決める小さな入力を出す */
  function closeNameForm() { if (nameForm) { nameForm.remove(); nameForm = null; } }
  function openNameForm(card, it) {
    closeNameForm();
    const label = h('input', { class: 'ss-nf-label', type: 'text', value: it.title || '', placeholder: '呼び名（例：自己紹介 学外用）', 'aria-label': '呼び名', spellcheck: 'false' });
    const sel = h('select', { class: 'ss-nf-shelf', 'aria-label': '置く棚' },
      shelves.map((sh, i) => h('option', { value: String(i), text: sh.name })).concat([h('option', { value: '+', text: '＋ 新しい棚…' })]));
    const fresh = h('input', { class: 'ss-nf-new', type: 'text', placeholder: '新しい棚の名前', 'aria-label': '新しい棚の名前', spellcheck: 'false' });
    const ok = h('button', { class: 'ss-nf-ok', type: 'button', text: '棚に置く' });
    const cancel = h('button', { class: 'ss-nf-cancel', type: 'button', text: 'やめる' });
    const form = h('div', { class: 'ss-nameform' }, [label, sel, fresh, ok, cancel]);
    sel.value = shelves.length ? String(Math.min(shelfTab, shelves.length - 1)) : '+';
    const sync = () => { fresh.style.display = sel.value === '+' ? '' : 'none'; };
    sync();
    sel.addEventListener('change', () => { sync(); if (sel.value === '+') fresh.focus(); });
    const submit = () => {
      const lab = label.value.trim();
      const shelfName = sel.value === '+' ? fresh.value.trim() : (shelves[Number(sel.value)] || {}).name;
      if (!lab) { label.focus(); return; }
      if (!shelfName) { fresh.focus(); return; }
      closeNameForm();
      shelfEdit('add', { shelf: shelfName, label: lab, deck: it.deck, slide: it.slide, title: it.title || '', id: typeof it.id === 'string' ? it.id : null }, () => {
        let sh = shelves.find(x => x.name === shelfName);
        if (!sh) { sh = { name: shelfName, items: [] }; shelves.push(sh); }
        sh.items.push(Object.assign({}, it, { label: lab, missing: false }));
        shelfTab = shelves.indexOf(sh);
      });
      toast('棚「' + shelfName + '」に「' + lab + '」を置きました');
    };
    form.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === 'Enter' && ev.target !== cancel) { ev.preventDefault(); submit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); closeNameForm(); card.focus(); }
    });
    for (const ty of ['click', 'dblclick']) form.addEventListener(ty, (ev) => ev.stopPropagation());
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => { closeNameForm(); card.focus(); });
    nameForm = form;
    // 格子の途中に挟むと行が割れるので、そのカードと同じ行のいちばん右のカードの後ろへ置く
    let last = card;
    for (let n = card.nextElementSibling; n && n.offsetTop === card.offsetTop; n = n.nextElementSibling) last = n;
    last.after(form);
    label.focus(); label.select();
    form.scrollIntoView({ block: 'nearest' });
  }
  const GAL_CTX = { root: galGrid, max: 60, pick: (it) => toggleSel(it) };

  // ---------- 挿入ポップアップ（DESIGN.md 8.0 / 8.1） ----------
  // 開いた瞬間に、覚えている棚と「手を入れた順」の上位を骨組み（題名だけのカード）で同期的に出す。
  // 拡張への問い合わせは並行して投げ、届いたら差し替える。サムネイルは作り済みなら即、無ければ見えている順に埋める。
  let pop = null;        // { index, reqId, query, items|null, total, sel:[], waiting, building, up }
  let popTimer = null;
  const POP_CTX = { root: popBody, max: 9, pick: (it, ev) => {
    if (!pop) return;
    if ((ev && ev.shiftKey) || pop.sel.length) togglePopSel(it);   // 選び始めたら、ふつうのクリックも選択の切り替え
    else insertFromPop([it]);
  } };
  const POP_KEYS = { root: popBody, filter: popFilter, pending: () => !!popTimer, searchNow: () => { sendPopSearch(); renderPop(); },
    sel: () => pop.sel, insert: (l) => insertFromPop(l), toggle: (it) => togglePopSel(it) };

  function closePop() {
    if (!pop) return;
    pop = null;
    clearTimeout(popTimer); popTimer = null;
    closeNameForm();
    unwatch(popBody);
    if (popEl.contains(document.activeElement)) { try { document.activeElement.blur(); } catch (_) { /* 無視 */ } }
    popEl.classList.remove('ss-open');
    popBody.textContent = '';   // サムネイル（host）は hostCache に残る。次に開いたときに使い回す
    inserts.forEach(b => b.classList.remove('ss-active'));
  }
  /** 開いているポップアップを全部閉じる。ほかの部品（layouts.js）は ss-close-popups を聞いて自分の分を閉じる */
  function closePopups() {
    closePop();
    closeGallery();
    try { window.dispatchEvent(new CustomEvent('ss-close-popups')); } catch (_) { /* 無くても動く */ }
  }
  /** index ＝「この次に入れる」スライド（−1 は先頭）。数でなければ現在のスライドの次 */
  function openPop(index) {
    if (edit) finishEdit(true, 'none');
    closePopups();
    const n = slides().length;
    let idx = Number.isInteger(index) ? index : cur;
    idx = Math.max(-1, Math.min(n - 1, idx));
    pop = { index: idx, reqId: 0, query: '', items: null, total: 0, sel: [], waiting: false, building: false, up: null };
    popFilter.value = '';
    popEl.setAttribute('aria-label', idx < 0 ? '既存のスライドを先頭に挿入' : '既存のスライドを ' + (idx + 1) + ' 枚目の次に挿入');
    renderPop();
    popEl.classList.add('ss-open');
    placePop(true);
    popFilter.focus({ preventScroll: true });
    sendPopSearch();
  }
  /** ＋ の近くに置く。下に入りきらなければ上へ出す（開いたあとは上下を変えない） */
  function placePop(reveal) {
    if (!pop) return;
    const b = inserts[pop.index + 1] || null;
    inserts.forEach(x => x.classList.toggle('ss-active', x === b));
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let r = b ? b.getBoundingClientRect() : { left: vw / 2, right: vw / 2, top: 40, bottom: 40 };
    if (reveal && b && (r.top < 40 || r.bottom > vh - 40)) {   // キーボードから開いたとき：＋ が画面の外なら見える所へ
      window.scrollBy(0, r.top - vh * 0.35);
      r = b.getBoundingClientRect();
    }
    const w = Math.min(440, vw - 16);
    const left = Math.max(8, Math.min(vw - w - 8, (r.left + r.right) / 2 - w / 2));
    const below = vh - r.bottom - 22, above = r.top - 22;
    if (pop.up == null || reveal) pop.up = below < 400 && above > below;
    const room = Math.max(200, Math.min(640, pop.up ? above : below));
    popEl.style.width = w + 'px';
    popEl.style.maxHeight = room + 'px';
    popEl.style.left = (left + window.scrollX) + 'px';
    popEl.style.top = ((pop.up ? r.top - 14 : r.bottom + 14) + window.scrollY) + 'px';
    popEl.classList.toggle('ss-up', !!pop.up);
  }
  function popGrid(items) {
    const grid = h('div', { class: 'ss-pc-grid', role: 'listbox' });
    for (const it of items) grid.appendChild(pickCard(it, POP_CTX, null));
    return grid;
  }
  function renderPop() {
    if (!pop) return;
    closeNameForm();
    unwatch(popBody);
    popBody.textContent = '';
    if (pop.query) {
      const n = pop.items ? pop.items.length : 0;
      popBody.appendChild(h('div', { class: 'ss-pop-h', text: !pop.items ? '検索中…' : '検索結果（' + pop.total + ' 件' + (pop.total > n ? '。先頭 ' + n + ' 件' : '') + '）' }));
      if (n) popBody.appendChild(popGrid(pop.items));
      else if (pop.items) popBody.appendChild(h('div', { class: 'ss-pop-note', text:
        pop.building ? '索引を作成中です。少し待ってから、もう一度検索してください。' : '該当するスライドがありません。語を減らすか、「もっと探す」で探してください。' }));
    } else {
      const sb = shelfBlock(POP_CTX);
      if (sb) popBody.appendChild(sb);
      const hasShelf = shelves.some(sh => sh.items.length);
      const top = (pop.items || topCache).slice(0, hasShelf ? 6 : 9);
      popBody.appendChild(h('div', { class: 'ss-pop-h', text: '手を入れた順' + (pop.building ? '（索引を作成中）' : '') }));
      if (top.length) popBody.appendChild(popGrid(top));
      else popBody.appendChild(h('div', { class: 'ss-pop-note', text: pop.waiting || !pop.items ? '読み込み中…' : 'スライドの索引が空です。npm run library で作り直してください。' }));
      if (!sb) popBody.appendChild(h('div', { class: 'ss-pop-note', text: 'よく使うスライドは、カードの「名前を付ける…」で棚に置けます。' }));
    }
    updatePopSel();
  }
  function sameItems(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (keyOf(a[i]) !== keyOf(b[i]) || a[i].html !== b[i].html || a[i].cssKey !== b[i].cssKey) return false;
    return true;
  }
  function onPopResults(m, items) {
    const shown = pop.items || (pop.query ? null : topCache);
    pop.waiting = false;
    pop.items = items;
    pop.total = Number.isInteger(m.total) ? m.total : items.length;
    const wasBuilding = pop.building;
    pop.building = !!m.building;
    if (!pop.query && items.length) topCache = items;
    // 覚えていた上位と同じ並びなら描き直さない（開いた直後にカードがちらつかない）
    if (!pop.query && wasBuilding === pop.building && shown && shown.length && sameItems(shown, items)) return;
    renderPop();
  }
  function sendPopSearch() {
    if (!pop) return;
    clearTimeout(popTimer); popTimer = null;
    const query = popFilter.value.trim();
    if (query !== pop.query) { if (!query || !pop.query) pop.items = null; pop.query = query; }
    pop.reqId = ++reqSeq;   // これより前に送った検索の応答は、届いても捨てる
    pop.waiting = true;
    post({ type: 'corpusSearch', reqId: pop.reqId, query, onlyMarked: false, sort: query ? 'relevance' : 'score',
      offset: 0, limit: 9, haveCss: Array.from(cssStore.keys()) });
  }
  function togglePopSel(it) {
    if (!pop) return;
    const k = keyOf(it);
    const at = pop.sel.findIndex(x => x.key === k);
    if (at >= 0) pop.sel.splice(at, 1); else pop.sel.push({ key: k, deck: it.deck, slide: it.slide });
    updatePopSel();
  }
  function updatePopSel() {
    const sel = pop ? pop.sel : [];
    paintSel(popBody, sel);
    popSelCount.textContent = sel.length ? sel.length + ' 枚を選択中' : '';
    popInsert.style.display = sel.length ? '' : 'none';
    popHint.style.display = sel.length ? 'none' : '';
  }
  function insertFromPop(list) {
    if (!pop || !list.length) return;
    post({ type: 'corpusInsert', items: list.map(x => ({ deck: x.deck, slide: x.slide })), index: pop.index, version,
      keepColors: !!popKeepColors.checked, keepTypo: !!popKeepTypo.checked });
    closePop();
  }
  popFilter.addEventListener('input', () => {
    if (!pop) return;
    clearTimeout(popTimer);
    popTimer = setTimeout(() => { sendPopSearch(); renderPop(); }, 150);
  });
  popInsert.addEventListener('click', () => { if (pop) insertFromPop(pop.sel); });
  popMore.addEventListener('click', () => {
    if (!pop) return;
    const idx = pop.index, q = popFilter.value.trim(), sel = pop.sel.slice();
    galKeepColors.checked = popKeepColors.checked; galKeepTypo.checked = popKeepTypo.checked;
    openCorpusGallery(idx, q);
    if (gal && sel.length) { gal.sel = sel; updateSelection(); }   // 選びかけは持ち越す
  });
  // 外側を押したら閉じる。そのクリックで原稿へ飛ばない（閉じるだけ）
  document.addEventListener('mousedown', (ev) => {
    if (!pop) return;
    const t = ev.target;
    if (popEl.contains(t) || (t && t.closest && t.closest('.ss-insert'))) return;
    closePop();
    lastFinishAt = Date.now();
  }, true);
  /** プレビューを開いた直後の空き時間に、棚と上位を先読みしておく（DESIGN.md 8.0） */
  function prefetchShelf() {
    prefetchReq = ++reqSeq;
    post({ type: 'corpusPrefetch', kind: 'shelf', reqId: prefetchReq, limit: 9, haveCss: Array.from(cssStore.keys()) });
  }

  // ---------- キー操作 ----------
  //   ↑ / ↓        … スライドを1枚送る（原稿側で文字を選んでいる間は従来どおり ±1px）
  //   PageUp/Down・j/k・Shift+↑↓ … 文字を選んでいても必ずスライド送り
  //   Home / End   … 先頭 / 末尾のスライドへ
  //   + / i        … 現在のスライドの次に、既存のスライドを挿入するポップアップを開く
  window.addEventListener('keydown', (ev) => {
    if (pop) {
      if (ev.key === 'Escape') { ev.preventDefault(); closePop(); }
      else galKey(ev, POP_KEYS);
      return;
    }
    if (galOpen()) {   // ギャラリーの絞り込み入力中に j/k でスライドが動かないように
      if (ev.key === 'Escape') { ev.preventDefault(); closeGallery(); }
      else if (gal) galKey(ev);
      return;   // スライド送り・Cmd+Z の転送はしない（検索欄の Cmd+Z は入力の取り消しに使う）
    }
    const t = ev.target;
    if (edit || (t && t.isContentEditable)) return;   // 編集中は文字入力・キャレット移動に使う
    if (t && (t === tColor || /^(input|textarea|select)$/i.test(t.tagName || ''))) return;
    // 取り消し／やり直し：プレビューにフォーカスがあると Cmd+Z が原稿に届かない。
    // 「プレビューだけで直す」使い方では戻せなくなるので、拡張へ転送して原稿側で undo / redo する
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey) {
      const z = ev.key === 'z' || ev.key === 'Z';
      if (z || ev.key === 'y' || ev.key === 'Y') {
        ev.preventDefault();
        post({ type: (z && !ev.shiftKey) ? 'undo' : 'redo' });
        return;
      }
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key;
    if (k === '+' || k === 'i') { ev.preventDefault(); openPop(cur); return; }
    if (k === 'PageDown' || k === 'j') { ev.preventDefault(); go(+1); return; }
    if (k === 'PageUp' || k === 'k') { ev.preventDefault(); go(-1); return; }
    if (k === 'Home') { ev.preventDefault(); goTo(0); return; }
    if (k === 'End') { ev.preventDefault(); goTo(slides().length - 1); return; }
    if (k === 'g' || k === 'G') { ev.preventDefault(); openJump(); return; }
    if (k !== 'ArrowUp' && k !== 'ArrowDown') return;
    ev.preventDefault();
    const tuning = tActive && !navMode && !ev.shiftKey;   // 文字を選んでいて、かつページ送り中でなければサイズ調整
    if (tuning) post({ type: 'tune', op: k === 'ArrowUp' ? 'inc' : 'dec' });
    else go(k === 'ArrowDown' ? +1 : -1);
  });

  // ---------- 拡張からのメッセージ ----------
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  /** 書き戻し後の検算：再描画したノード k の文字が、拡張の期待（expect.text）と同じか */
  function verify(expect) {
    if (!expect || !Number.isInteger(expect.index) || !Number.isInteger(expect.k)) return;
    // 全部消した編集ではノード k 自体が無くなり、番号が1つずつ前へずれる。比べる相手がいないので検算しない
    if (!norm(expect.text)) return;
    const all = collect(sectionOf(slides()[expect.index]));
    const got = all[expect.k] ? all[expect.k].t : null;
    if (got == null || norm(got) !== norm(expect.text)) toast('表示と原稿がずれました（Cmd+Z で戻せます）', true);
  }
  function applyRender(m) {
    deckCss.textContent = m.css || '';
    wrap.innerHTML = m.html || '';
    hoverEl = null;
    lastCommit = null;   // 描き直したので、戻す相手（古い DOM）はもう無い
    if (Number.isInteger(m.version)) version = m.version;
    if (Array.isArray(m.marks)) marks = m.marks;
    highlight(Number.isInteger(m.index) ? m.index : 0); // 差し替え時はスクロールせず強調のみ（揺らさない）
    if (m.expect) verify(m.expect);
    scheduleOverflow(true);
    notifyRender('render', null);
  }

  // ----- 変わったスライドだけ差し替える（DESIGN.md 8.4） -----
  const renderSubs = [];   // ssPreview.onRender で登録された関数
  function notifyRender(kind, indices) {
    for (const fn of renderSubs.slice()) { try { fn({ kind, indices }); } catch (_) { /* ほかの部品の失敗で本体を止めない */ } }
  }
  /** 重ねる UI の位置が変わったかを見る署名。同じなら layout() を呼ばない */
  function posSig(ss) {
    if (!ss.length) return '0';
    const a = ss[0].getBoundingClientRect(), z = ss[ss.length - 1].getBoundingClientRect();
    return [ss.length, cur, Math.round(a.left), Math.round(a.top + window.scrollY), Math.round(a.width), Math.round(z.bottom + window.scrollY), marks.map(x => x ? 1 : 0).join('')].join('|');
  }
  /** 編集中に届いた patch を 1 件にまとめる（同じスライドは新しい方。版・印・検算は新しい方） */
  function mergePatch(a, b) {
    if (!a) return b;
    const by = new Map();
    for (const p of (Array.isArray(a.slides) ? a.slides : [])) if (p) by.set(p.index, p);
    for (const p of (Array.isArray(b.slides) ? b.slides : [])) if (p) by.set(p.index, p);
    return Object.assign({}, a, b, { slides: Array.from(by.values()) });
  }
  function applyPatch(m) {
    // いま表示している版より古い patch は当てない（順序が入れ替わって届いても、新しい表示を古い内容で上書きしない）
    if (Number.isInteger(m.version) && Number.isInteger(version) && m.version < version) return;
    const ss = slides();
    const fresh = [];
    for (const p of (Array.isArray(m.slides) ? m.slides : [])) {
      let svg = null;
      if (p && Number.isInteger(p.index) && p.index >= 0 && p.index < ss.length && typeof p.html === 'string') {
        const tpl = document.createElement('template');
        tpl.innerHTML = p.html;
        if (tpl.content.childElementCount === 1 && tpl.content.firstElementChild.matches('svg[data-marpit-svg]')) svg = tpl.content.firstElementChild;
      }
      // 当てられない patch（枚数が合わない・svg が 1 つに読めない）は 1 枚も当てず、全体の描き直しを頼む
      if (!svg) { post({ type: 'needRender', version: Number.isInteger(m.version) ? m.version : version }); return; }
      fresh.push([p.index, svg]);
    }
    const before = posSig(ss);
    const x0 = window.scrollX, y0 = window.scrollY;
    const indices = [];
    for (const pair of fresh) {
      const i = pair[0], svg = pair[1], old = ss[i];
      if (hoverEl && old.contains(hoverEl)) hoverEl = null;
      if (i === cur) svg.classList.add('current-slide');
      old.replaceWith(svg);   // ほかのスライドの要素には触らない（画像・動画の状態がそのまま残る）
      indices.push(i);
    }
    lastCommit = null;   // 戻す相手（古い DOM）はもう無いかもしれない
    if (Number.isInteger(m.version)) version = m.version;
    if (Array.isArray(m.marks)) marks = m.marks;
    if (window.scrollX !== x0 || window.scrollY !== y0) window.scrollTo(x0, y0);
    if (indices.indexOf(cur) >= 0) refreshSwatches();
    if (posSig(slides()) !== before) layout();   // 位置も印も変わらなければ、＋ や操作ボタンは置き直さない
    else if (markBtn) markBtn.classList.toggle('ss-on', !!marks[cur]);
    if (m.expect) verify(m.expect);
    overflowFor(indices);
    notifyRender('patch', indices);
  }
  function startEditAtLine(line) {
    if (edit || !Number.isInteger(line)) return;
    // ul と先頭の li は同じ data-line を持つ。現在のスライドの中で、li を優先し、無ければいちばん内側の要素
    const secs = [sectionOf(slides()[cur])].concat(slides().map(sectionOf));
    for (const sec of secs) {
      if (!sec) continue;
      const found = Array.from(sec.querySelectorAll('[data-line="' + line + '"]')).filter(e => !NEVER.has(tagOf(e)) || tagOf(e) === 'li');
      if (!found.length) continue;
      let el = found.find(e => tagOf(e) === 'li') || found[found.length - 1];
      const inner = el.querySelector(':scope > p[data-line="' + line + '"]');
      if (inner) el = inner;
      const c = editableFrom(el, true);
      if (c && c.kind === 'ce') { c.el.scrollIntoView({ block: 'nearest' }); beginEdit(c.el, null); }
      return;
    }
  }
  window.addEventListener('message', (ev) => {
    const m = ev.data || {};
    if (m.type === 'scrollToSlide') scrollTo(m.index);
    else if (m.type === 'render') {
      // 編集中に差し替えると入力が消えてフォーカスも失う（実測）。最新の1件だけ保留する
      if (edit) { pendingRender = m; pendingPatch = null; }   // 全体の描き直しが勝つ。前の patch は要らない
      else applyRender(m);
    }
    else if (m.type === 'patch') {
      if (edit) pendingPatch = mergePatch(pendingPatch, m); else applyPatch(m);
    }
    else if (m.type === 'tuneState') setTuneState(m);
    else if (m.type === 'editResult') {
      // 書き戻せなかったときは原稿が変わらず再描画も来ない。打った文字が表示にだけ残らないよう元へ戻す
      if (!m.ok && lastCommit && !edit) { try { lastCommit.undo(); } catch (_) { /* 無視 */ } }
      if (!m.ok) lastCommit = null;
      toast(m.message || (m.ok ? '反映しました' : '反映できませんでした'), !m.ok);
    }
    else if (m.type === 'startEdit') startEditAtLine(m.line);
    else if (m.type === 'library') openGallery(m.entries);   // 旧形式（台帳の entries）。互換のため残す
    else if (m.type === 'gallery') openCorpusGallery(m.index, m.query, m.onlyMarked);
    else if (m.type === 'corpusResults') onCorpusResults(m);
    else if (m.type === 'shelfState') onShelfState(m);
    else if (m.type === 'insertPopup') openPop(m.index);   // コマンドから開く口（index 省略＝現在のスライドの次）
  });

  // ---------- ほかの部品（media/layouts.js）向けの公開 API（DESIGN.md 8.3） ----------
  // current / version / isEditing は「いまの値」を返す関数。右クリック（contextmenu）はここでは扱わない。
  window.ssPreview = {
    slides, sectionOf, post, toast, closePopups,
    current: () => cur,
    version: () => version,
    isEditing: () => !!edit,
    /** 描き直し（render / patch）のたびに fn({ kind, indices }) を呼ぶ。戻り値は登録を外す関数 */
    onRender(fn) {
      if (typeof fn !== 'function') return () => {};
      renderSubs.push(fn);
      return () => { const i = renderSubs.indexOf(fn); if (i >= 0) renderSubs.splice(i, 1); };
    },
  };

  // 幅が変わる・画像が読み込まれてスライドの位置が変わる、のどちらでもボタンと ★ を置き直す
  window.addEventListener('resize', layout);
  if (window.ResizeObserver && wrap) new ResizeObserver(layout).observe(wrap);

  // 画像が読み込まれると高さが変わり、はみ出しの判定も変わる。load は泡立たないのでキャプチャで拾う
  if (wrap) wrap.addEventListener('load', (ev) => {
    const svg = ev.target && ev.target.closest ? ev.target.closest('div.marpit > svg[data-marpit-svg]') : null;
    const i = svg ? slides().indexOf(svg) : -1;
    if (i >= 0) overflowFor([i]); else scheduleOverflow(false);
  }, true);

  // 初期表示
  highlight(cur);
  scheduleOverflow(true);
  window.requestAnimationFrame(() => scrollTo(cur));
  idle(prefetchShelf);   // 棚と上位の先読み（応答が無くても、ポップアップは開いた時点で問い合わせる）
})();
