// 既存スライドの検索と挿入・棚（vscode 依存の配線）。DESIGN.md 7章・8章。
//
// 速さの方針（8.0）：
//   ・索引はメモリに持つ。検索のたびに作り直さない。古くなったら「応答した後で」作り直す（cache が効くので約 0.1 秒）。
//   ・churn（git 履歴の点数）つきの索引づくりは数秒かかるので、子プロセスに任せる（拡張ホストを塞がない。多重起動しない）。
//   ・サムネイルはデックごとに 1 回だけ描き、スライドの svg 単位で覚える（LRU 40 デック）。
//     初めてのデックが多くて時間が掛かるときは、先に題名だけ返し、描けたら同じ reqId でもう一度返す。
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const core = require('./corpus-core.cjs');
const lib = require('./library-core.cjs');

const STALE_MS = 60 * 1000;     // 索引がこれより古ければ、応答の後で作り直す（外で変わった md を拾う）
const DIRTY_MS = 1500;          // 原稿を触ってから索引を作り直すまでの待ち
const THUMB_DECKS = 40;         // サムネイル用に描いたデックを覚えておく数（LRU）
const THUMB_BUDGET_MS = 90;     // 1 回の応答でサムネイルの描画に使ってよい時間。超えた分は後から送る

/**
 * api = {
 *   isMarpDoc(doc), repoRootFor(doc), postToPreview(msg), panelDoc() → doc|null,
 *   renderForThumb(mdAbs, text) → { html, css }   // extension.js と同じテーマで描き、素材を webview URI に直したもの
 *   replaceMinimal(doc, oldText, newText) → Promise<boolean>, afterSlideChange(doc, editor, index, line), ensureEditor(doc),
 *   spawn?(cmd, args, opts)   // テスト用の差し替え口。既定は child_process.spawn
 * }
 * @returns {{ search, prefetch, insert, openSource, shelfEdit, onOverflow, openPopup, rebuild, invalidate, warm, stats }}
 */
function register(context, api) {
  let corpus = null, corpusAt = 0, corpusRoot = null, dirty = false;
  let refreshTimer = null, warmTimer = null;
  let child = null, childChecked = null;   // 裏の索引づくり（子プロセス）。childChecked＝古さを確かめ済みの repoRoot
  let shelf = null, shelfSig = '', shelfRoot = null;
  let sentShelfSig = null;                 // Webview へ最後に送った棚の shelf.json の姿（外で書き換えられたら、次の検索の応答に棚を載せ直す）
  let lastInsert = null;                   // 直前の挿入 { uri, version, from, count }（はみ出しの通知に使う）
  const thumbs = new Map();                // deck（リポジトリ相対）→ { sig, cssKey, css, slides:[html] }
  const stats = { lastSearchMs: 0, lastThumbMs: 0, builds: 0, spawns: 0 };

  const post = (msg) => { try { api.postToPreview(msg); } catch (_) { /* プレビューが閉じた */ } };

  /** 開いている（未保存かもしれない）原稿。無ければ null＝ディスクを読む */
  function openDoc(abs) {
    return vscode.workspace.textDocuments.find(x => x.uri.scheme === 'file' && x.uri.fsPath === abs) || null;
  }
  function openTextOf(abs) { const d = openDoc(abs); return d ? d.getText() : null; }

  // ---------- 索引 ----------
  function build(repoRoot, seed) {
    const c = core.buildCorpus(repoRoot, { withChurn: false, cache: seed, textOf: openTextOf });
    try { core.searchCorpus(c, '', { limit: 1 }); } catch (_) { /* 検索用の正規化を先に済ませておく（初回だけ約 30ms） */ }
    stats.builds++;
    return c;
  }
  function getCorpus(repoRoot) {
    if (corpus && corpusRoot === repoRoot) {
      if (dirty || Date.now() - corpusAt > STALE_MS) refreshSoon(repoRoot, dirty ? DIRTY_MS : 0);
      return corpus;
    }
    // 初回：corpus.json（churn つき）があれば土台にする。無ければ churn 抜きでその場で作る（約 0.5 秒）
    let seed = null;
    try { seed = core.readCorpus(repoRoot); } catch (_) { seed = null; }
    corpus = build(repoRoot, seed);
    corpusAt = Date.now(); corpusRoot = repoRoot; dirty = false;
    thumbs.clear();
    ensureChurn(repoRoot, seed);
    return corpus;
  }
  /** 応答の後で索引を作り直す（変わっていないデックは cache から引き継ぐ） */
  function refreshSoon(repoRoot, wait) {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (corpusRoot !== repoRoot) return;
      try { corpus = build(repoRoot, corpus); corpusAt = Date.now(); dirty = false; }
      catch (e) { console.error('[marp-scroll-sync] corpus refresh: ' + (e && e.message || e)); }
    }, Math.max(0, wait || 0));
  }

  /** corpus.json が無い・churn 抜き・HEAD が違うときは、裏で作り直す（1 回の起動につき repoRoot ごとに 1 度だけ確かめる） */
  function ensureChurn(repoRoot, disk) {
    if (childChecked === repoRoot) return;
    childChecked = repoRoot;
    const fresh = disk && disk.withChurn && disk.head && corpus && disk.head === corpus.head;
    if (!fresh) spawnBuild(repoRoot);
  }
  function spawnBuild(repoRoot) {
    if (child) return false;                                  // 多重起動しない
    const cli = path.join(repoRoot, 'tools', 'marp-library.mjs');
    if (!fs.existsSync(cli)) return false;
    const spawn = typeof api.spawn === 'function' ? api.spawn : require('child_process').spawn;
    try {
      // 拡張ホストの execPath は Electron。ELECTRON_RUN_AS_NODE=1 で node として動く（素の node では無視される）
      child = spawn(process.execPath, [cli, 'corpus', '--root', repoRoot], {
        cwd: repoRoot, stdio: 'ignore', windowsHide: true, env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
      });
    } catch (e) { child = null; console.error('[marp-scroll-sync] corpus spawn: ' + (e && e.message || e)); return false; }
    stats.spawns++;
    const mine = child;
    const done = (code) => {
      if (child !== mine) return;
      child = null;
      if (code !== 0 || corpusRoot !== repoRoot) return;
      try {
        const disk = core.readCorpus(repoRoot);
        if (disk) { corpus = build(repoRoot, disk); corpusAt = Date.now(); dirty = false; }
      } catch (e) { console.error('[marp-scroll-sync] corpus reload: ' + (e && e.message || e)); }
    };
    mine.on('exit', done);
    mine.on('error', () => done(1));
    return true;
  }
  /** コマンド「索引を作り直す」 */
  function rebuild(doc) {
    const repoRoot = api.repoRootFor(doc);
    corpus = null; corpusRoot = null; childChecked = repoRoot;
    getCorpus(repoRoot);
    const started = spawnBuild(repoRoot);
    return { started, running: !!child, entries: corpus ? corpus.entries.length : 0 };
  }
  function invalidate() { dirty = true; }

  // ---------- サムネイル ----------
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
  function sigOf(abs) {
    const d = openDoc(abs);
    if (d) return 'v' + d.version;                            // 開いている原稿は版で見分ける（未保存の変更も映す）
    try { return 'm' + fs.statSync(abs).mtimeMs; } catch (_) { return null; }
  }
  /** cached＝true のときは、覚えていなければ描かずに undefined を返す */
  function thumbOf(repoRoot, deckRel, cachedOnly) {
    const abs = path.join(repoRoot, deckRel);
    const sig = sigOf(abs);
    if (!sig) return null;
    const hit = thumbs.get(deckRel);
    if (hit && hit.sig === sig) { thumbs.delete(deckRel); thumbs.set(deckRel, hit); return hit; }
    if (cachedOnly) return undefined;
    let out;
    try { const live = openTextOf(abs); out = api.renderForThumb(abs, live != null ? live : fs.readFileSync(abs, 'utf8')); }
    catch (_) { return null; }
    const rec = { sig, cssKey: deckRel + '@' + sig, css: out.css, slides: splitSlides(out.html) };
    thumbs.set(deckRel, rec);
    while (thumbs.size > THUMB_DECKS) thumbs.delete(thumbs.keys().next().value);
    return rec;
  }

  function themeOf(doc) {
    const m = doc.getText().slice(0, 4000).match(/^theme\s*:\s*([\w-]+)/m);
    return m ? m[1] : null;
  }

  /**
   * entry の並びを Webview 用の item にする。budgetMs を過ぎたら、まだ描いていないデックは後回し（pending に積む）。
   * css は cssKey ごとに 1 回だけ載せる（have＝Webview が持っている分）。
   */
  function itemsOf(repoRoot, doc, list, have, css, budgetMs, pending) {
    const destTheme = themeOf(doc);
    const t0 = Date.now();
    return list.map((x) => {
      const e = x.entry;
      let t = thumbOf(repoRoot, e.deck, true);
      if (t === undefined) {
        if (budgetMs == null || Date.now() - t0 < budgetMs) t = thumbOf(repoRoot, e.deck, false);
        else { t = null; if (pending && !pending.includes(e.deck)) pending.push(e.deck); }
      }
      const html = t && t.slides[e.slide - 1] ? t.slides[e.slide - 1] : '';
      if (t && html && !have.has(t.cssKey)) { css[t.cssKey] = t.css; have.add(t.cssKey); }
      return {
        key: e.key, deck: e.deck, deckName: e.deckName, slide: e.slide, title: e.title, pattern: e.pattern, theme: e.theme,
        date: e.date, marked: !!e.mark, id: e.mark ? e.mark.id : null, touched: e.churn ? e.churn.touched : 0, tune: e.tune || 0,
        dupCount: e.dupCount || 1, snippet: x.snippet || '', shelf: x.shelf || null,
        sameTheme: !destTheme || !e.theme || destTheme === e.theme, cssKey: t && html ? t.cssKey : null, html,
      };
    });
  }

  // ---------- 棚 ----------
  function shelfSigOf(repoRoot) {
    try { const st = fs.statSync(core.shelfPath(repoRoot)); return st.mtimeMs + ':' + st.size; } catch (_) { return 'none'; }
  }
  /** shelf.json。外で書き換えられていたら読み直す */
  function getShelf(repoRoot) {
    const sig = shelfSigOf(repoRoot);
    if (!shelf || shelfRoot !== repoRoot || sig !== shelfSig) { shelf = core.readShelf(repoRoot); shelfSig = sig; shelfRoot = repoRoot; }
    return shelf;
  }
  function shelfState(repoRoot, doc, have, css, budgetMs, pending) {
    const c = getCorpus(repoRoot);
    const resolved = core.resolveShelf(getShelf(repoRoot), c);
    return resolved.map((sv) => {
      const found = sv.items.filter(it => it.entry);
      const items = itemsOf(repoRoot, doc, found, have, css, budgetMs, pending);
      let k = 0;
      return {
        name: sv.name,
        items: sv.items.map((it) => {
          if (!it.entry) { const r = it.ref || {}; return { label: it.label, missing: true, deck: r.deck || null, slide: Number.isInteger(r.slide) ? r.slide : null, title: r.title || '' }; }
          return Object.assign({ label: it.label, how: it.how || null }, items[k++]);
        }),
      };
    });
  }

  /** shelfEdit → shelf.json を書いて shelfState を返す（8.2）。失敗したら ok:false と、いまの正しい棚を返す */
  function shelfEdit(doc, m) {
    let repoRoot;
    try {
      repoRoot = api.repoRootFor(doc);
      const cur = getShelf(repoRoot);
      if (cur.broken) throw new Error('shelf.json を読めません（JSON が壊れています）。手で直すまで棚は書き換えません');
      const c = getCorpus(repoRoot);
      const op = m && m.op;
      let r;
      if (op === 'add') {
        const entry = c.entries.find(e => e.deck === m.deck && e.slide === m.slide) || null;
        r = core.shelfAdd(cur, { shelf: m.shelf, label: m.label, entry: entry || undefined, ref: entry ? undefined : { deck: m.deck, id: m.id || undefined, slide: m.slide, title: m.title } });
      } else if (op === 'rename') r = core.shelfRename(cur, { shelf: m.shelf, index: m.at, to: m.label });
      else if (op === 'move') r = core.shelfMove(cur, { shelf: m.shelf, index: m.from, to: m.to, toShelf: m.toShelf });
      else if (op === 'remove') {
        // 位置と呼び名が食い違うとき（表示が古い）は、別の項目を消さない
        const sv = cur.shelves.find(s => s.name === m.shelf);
        const at = sv && Number.isInteger(m.at) && sv.items[m.at] && (m.label == null || sv.items[m.at].label === m.label) ? m.at : null;
        r = at != null ? core.shelfRemove(cur, { shelf: m.shelf, index: at })
          : (typeof m.label === 'string' ? core.shelfRemove(cur, { shelf: m.shelf, label: m.label }) : { ok: false, reason: 'その項目が見つかりません' });
      } else if (op === 'renameShelf') r = core.shelfRenameShelf(cur, { shelf: m.shelf, to: m.name });
      else if (op === 'moveShelf') {
        const sv = Number.isInteger(m.from) ? cur.shelves[m.from] : null;
        r = sv ? core.shelfMoveShelf(cur, { shelf: sv.name, to: m.to }) : { ok: false, reason: 'その棚が見つかりません' };
      } else r = { ok: false, reason: '分からない操作です: ' + String(op) };
      if (!r.ok) throw new Error(r.reason || '棚を更新できませんでした');
      const w = core.writeShelf(repoRoot, r.shelf);
      if (!w.ok) throw new Error(w.reason || 'shelf.json に書けませんでした');
      shelf = null;                                            // 書いた物を読み直す（warnings などを付け直す）
      const css = {};
      post({ type: 'shelfState', ok: true, shelves: shelfState(repoRoot, doc, new Set(Array.isArray(m.haveCss) ? m.haveCss : []), css, THUMB_BUDGET_MS, null), css });
      sentShelfSig = shelfSigOf(repoRoot);
      return { ok: true };
    } catch (e) {
      const message = String(e && e.message || e);
      let shelves;
      try { if (repoRoot) { shelf = null; shelves = shelfState(repoRoot, doc, new Set(), {}, 0, null); sentShelfSig = shelfSigOf(repoRoot); } } catch (_) { shelves = undefined; }
      post({ type: 'shelfState', ok: false, message, shelves });
      return { ok: false, message };
    }
  }

  // ---------- 検索 ----------
  /** 後回しにしたデックを描き、同じ reqId でもう一度応える（Webview は古い reqId なら捨てる） */
  function fillLater(pending, again) {
    if (!pending.length) return;
    const step = () => {
      const deck = pending.shift();
      if (deck === undefined) { try { again(); } catch (_) { /* 2 度目は飾り */ } return; }
      try { thumbOf(corpusRoot, deck, false); } catch (_) { /* 描けないデックは題名だけ */ }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  /** corpusSearch → corpusResults（DESIGN 7.4）。失敗しても必ず応答する（プレビューが「検索中…」で止まらないように） */
  function search(doc, m, second) {
    const t0 = Date.now();
    const reqId = m && m.reqId;
    const offset = Number.isInteger(m && m.offset) ? m.offset : 0;
    const limit = Number.isInteger(m && m.limit) ? Math.max(1, Math.min(60, m.limit)) : 24;
    try {
      const repoRoot = api.repoRootFor(doc);
      const c = getCorpus(repoRoot);
      const sort = ['relevance', 'score', 'recent'].includes(m && m.sort) ? m.sort : 'relevance';
      const r = core.searchCorpus(c, String((m && m.query) || ''), {
        onlyMarked: !!(m && m.onlyMarked), sort, offset, limit, dedupe: true,
        theme: (m && typeof m.theme === 'string' && m.theme) || undefined,
        shelf: core.resolveShelf(getShelf(repoRoot), c),
      });
      const have = new Set(Array.isArray(m && m.haveCss) ? m.haveCss : []);
      const css = {}, pending = [];
      // 続き（もっと見る）は 2 度送れない（Webview がつなげない）ので、時間を区切らず描き切る
      const items = itemsOf(repoRoot, doc, r.items, have, css, (second || offset > 0) ? null : THUMB_BUDGET_MS, pending);
      const out = { type: 'corpusResults', reqId, total: r.total, offset, building: !!child, items, css };
      // shelf.json が外で変わっていたら（CLI・手編集・git pull・壊れていたのを直した）、棚も載せ直す。ふだんは stat 1 回だけ
      if (offset === 0 && sentShelfSig !== null && shelfSigOf(repoRoot) !== sentShelfSig) {
        try { out.shelves = shelfState(repoRoot, doc, have, css, THUMB_BUDGET_MS, null); sentShelfSig = shelfSigOf(repoRoot); } catch (_) { /* 棚は次の機会に */ }
      }
      post(out);
      stats.lastSearchMs = Date.now() - t0;
      if (pending.length) fillLater(pending, () => search(doc, m, true));
    } catch (e) {
      console.error('[marp-scroll-sync] corpusSearch: ' + (e && e.stack || e));
      post({ type: 'corpusResults', reqId, total: 0, offset, building: !!child, items: [], css: {}, error: String(e && e.message || e) });
    }
  }

  /** corpusPrefetch：棚（shelfState）と「手を入れた順」の上位（同じ reqId の corpusResults）を返す。片方が落ちても、もう片方は返す */
  function prefetch(doc, m) {
    const have = new Set(Array.isArray(m && m.haveCss) ? m.haveCss : []);
    const pending = [];
    let repoRoot = null;
    try {
      repoRoot = api.repoRootFor(doc);
      const css = {};
      const shelves = shelfState(repoRoot, doc, have, css, THUMB_BUDGET_MS, pending);
      post({ type: 'shelfState', ok: true, shelves, css });
      sentShelfSig = shelfSigOf(repoRoot);
    } catch (e) { console.error('[marp-scroll-sync] corpusPrefetch(shelf): ' + (e && e.message || e)); }
    search(doc, { reqId: m && m.reqId, query: '', onlyMarked: false, sort: 'score', offset: 0, limit: Number.isInteger(m && m.limit) ? m.limit : 9, haveCss: Array.from(have) });
    if (pending.length && repoRoot) {
      fillLater(pending, () => { const css = {}; post({ type: 'shelfState', ok: true, shelves: shelfState(repoRoot, doc, new Set(), css, null, null), css }); });
    }
  }

  // ---------- 挿入 ----------
  /** corpusInsert：複数枚でも 1 つの編集（Cmd+Z 1回）。index の次に、選んだ順で入れる（−1＝先頭） */
  async function insert(doc, m) {
    const items = Array.isArray(m && m.items) ? m.items.filter(x => x && typeof x.deck === 'string' && Number.isInteger(x.slide) && x.slide >= 1) : [];
    if (!items.length) return { ok: false, message: '挿入するスライドが選ばれていません' };
    const repoRoot = api.repoRootFor(doc);
    const before = doc.getText();
    const count = lib.parseDeck(before).slides.length;
    const first = Number.isInteger(m.index) ? Math.max(-1, Math.min(count - 1, m.index)) : count - 1;
    let cur = before, after = first;
    const warnings = [], plans = [];
    for (const it of items) {
      const srcMd = path.resolve(repoRoot, it.deck);
      if (srcMd !== path.join(repoRoot, it.deck) || path.relative(repoRoot, srcMd).startsWith('..')) return { ok: false, message: 'リポジトリの外の原稿は入れられません' };
      let plan;
      try {
        // 自分自身から入れるときは「操作の前の原稿」を元にする（途中経過では番号がずれる）
        const self = srcMd === doc.uri.fsPath;
        plan = lib.adaptSlide({
          srcMdPath: srcMd, srcText: self ? before : (openTextOf(srcMd) || undefined), slideIndex: it.slide - 1,
          destMdPath: doc.uri.fsPath, destText: cur, afterIndex: after,
          keepColors: !!m.keepColors, keepTypo: !!m.keepTypo, repoRoot,
        });
        cur = lib.applyAdaptPlan(plan, { dryRun: true, destText: cur });
      } catch (e) {
        return { ok: false, message: `「${path.basename(it.deck, '.md')} #${it.slide}」を入れられません: ` + String(e && e.message || e) };
      }
      plans.push(plan);
      for (const w of (plan.warnings || [])) if (!warnings.includes(w)) warnings.push(w);
      after += 1;
    }
    // 枚数が「入れた数だけ」増えていなければ書かない（原稿を壊さない）
    let grown = -1;
    try { grown = lib.parseDeck(cur).slides.length - count; } catch (_) { grown = -1; }
    if (grown !== items.length) return { ok: false, message: '挿入後の枚数が合わないので、書くのをやめました（原稿は変えていません）' };
    // 素材は先にコピーする（本文が入った瞬間に再描画され、画像が無いと欠けて見える）。書けなかったら今回の分だけ片付ける
    let copied = [];
    for (const p of plans) { try { copied = copied.concat(lib.copyAssets(p) || []); } catch (e) { warnings.push('素材のコピーに失敗しました: ' + String(e && e.message || e)); } }
    const ok = await api.replaceMinimal(doc, before, cur);
    if (!ok) {
      for (const f of copied) { try { fs.unlinkSync(f); } catch (_) { /* 残っても害はない */ } }
      return { ok: false, message: '原稿が先に変わったので挿入をやめました。もう一度お試しください' };
    }
    lastInsert = { uri: doc.uri.toString(), version: doc.version, from: first + 1, count: items.length, keepTypo: !!m.keepTypo };
    dirty = true;
    try { const ed = await api.ensureEditor(doc); api.afterSlideChange(doc, ed, first + 1); } catch (_) { /* カーソル移動は飾り */ }
    if (warnings.length) vscode.window.showWarningMessage(`${items.length} 枚を挿入しました。確認してください：\n` + warnings.map(w => '・' + w).join('\n'));
    return { ok: true, message: `${items.length} 枚を挿入しました` };
  }

  /** overflowReport：直前に挿入したスライドがはみ出していたら、1 回だけ知らせる */
  function onOverflow(doc, m) {
    const li = lastInsert;
    if (!li || !m || !Array.isArray(m.slides) || li.uri !== doc.uri.toString()) return null;
    if (Number.isInteger(m.version) && m.version < li.version) return null;      // 挿入前の描画の結果
    if (doc.version !== li.version) { lastInsert = null; return null; }          // その後に原稿を触った。もう「直前の挿入」ではない
    const hit = m.slides.filter(s => s && Number.isInteger(s.index) && s.index >= li.from && s.index < li.from + li.count);
    lastInsert = null;
    if (!hit.length) return null;
    const msg = hit.map(s => `スライド ${s.index + 1} が ${Math.max(0, Math.round(s.bottomPx || 0))}px はみ出しています`).join('、')
      + (li.keepTypo ? '（右クリックで別の配置を試せます）' : '（元の組版を保つ で入れ直すか、右クリックで別の配置を試せます）');
    post({ type: 'editResult', ok: true, message: msg });
    return msg;
  }

  /** openSource：元のデックを開き、そのスライドへ */
  async function openSource(doc, m) {
    if (!m || typeof m.deck !== 'string') return;
    const repoRoot = api.repoRootFor(doc);
    const abs = path.resolve(repoRoot, m.deck);
    if (path.relative(repoRoot, abs).startsWith('..')) return;
    const src = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
    const ed = await vscode.window.showTextDocument(src, { viewColumn: vscode.ViewColumn.Active, preview: true });
    try {
      const deck = lib.parseDeck(src.getText());
      const s = deck.slides[(m.slide || 1) - 1];
      if (s) { const pos = new vscode.Position(s.startLine, 0); ed.selection = new vscode.Selection(pos, pos); ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop); }
    } catch (_) { /* 位置合わせは飾り */ }
  }

  /** ＋ポップアップ／全面ギャラリーを開く（コマンドと 📚 から）。full＝全面 */
  function openPopup(index, opts) {
    const o = opts || {};
    if (o.full) post({ type: 'gallery', index, query: o.query || undefined, onlyMarked: o.onlyMarked || undefined });
    else post({ type: 'insertPopup', index: Number.isInteger(index) ? index : undefined });
  }

  /**
   * プレビューを開いた直後に、裏で索引を温めておく（初回の検索が遅くならないように。DESIGN 8.0）。
   * 索引づくりは同期処理（初回 約 0.5 秒）なので、入力の邪魔にならないよう少し待ってから 1 回だけ行う。
   */
  function warm(doc) {
    if (warmTimer || corpus) return;
    warmTimer = setTimeout(() => {
      warmTimer = null;
      try {
        const repoRoot = api.repoRootFor(doc);
        const c = getCorpus(repoRoot);
        const top = core.searchCorpus(c, '', { sort: 'score', limit: 9, dedupe: true });
        const t0 = Date.now();
        for (const it of top.items) { if (Date.now() - t0 > 300) break; thumbOf(repoRoot, it.entry.deck, false); }
      } catch (e) { console.error('[marp-scroll-sync] corpus warm: ' + (e && e.message || e)); }
    }, 1200);
  }

  if (context && context.subscriptions) {
    // 原稿を触ったら索引を「古い」とする（作り直しは次の検索の後）
    // 作り直しは「最後に触ってから DIRTY_MS 後」に裏で済ませておく（次の検索を待つと、印を付けた直後の 📚 に ★ が映らない）
    const mark = (d) => {
      try {
        if (!(d && d.uri && d.uri.scheme === 'file' && /\.md$/i.test(d.uri.fsPath))) return;
        dirty = true;
        if (corpus && corpusRoot) { clearTimeout(refreshTimer); refreshTimer = null; refreshSoon(corpusRoot, DIRTY_MS); }
      } catch (_) { /* 無視 */ }
    };
    try { context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(mark)); } catch (_) { /* 古い API */ }
    try { context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => mark(e && e.document))); } catch (_) { /* 同上 */ }
    context.subscriptions.push({ dispose() {
      clearTimeout(warmTimer); clearTimeout(refreshTimer);
      if (child) { try { child.kill(); } catch (_) { /* 既に終わっている */ } child = null; }
    } });
  }

  return { search, prefetch, insert, openSource, shelfEdit, onOverflow, openPopup, rebuild, invalidate, warm, stats, isBuilding: () => !!child };
}

module.exports = { register };
