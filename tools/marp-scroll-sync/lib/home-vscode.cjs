// ホーム画面（DESIGN.md 10章）：PowerPoint や Google スライドを立ち上げた直後の「ホーム」に当たる Webview。
//   ・最近開いたデック／棚／手を入れた順（直した回数）／デック一覧／検索 を並べ、カードを押すとその md を開いて
//     該当スライドの行にカーソルを置き、同期プレビューも開く（設定で切れる）。
//   ・索引・棚・検索は corpus-core（CLI と同じ実装）。サムネイルは extension.js の Marp で描き、このパネルの webview URI に直す。
//   ・原稿は書かない（読むだけ）。速さの予算（8.0）：開いてから一覧が出るまで 0.4 秒。サムネイルは見えているカードから順に後から埋める。
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('./corpus-core.cjs');
const home = require('./home-core.cjs');
const { slideStartLines } = require('./slide-split.cjs');

const RECENT_KEY = 'marpScrollSync.home.recent';
const THUMB_DECKS = 40;        // サムネイル用に描いたデックを覚えておく数（LRU）
const THUMB_BATCH_MS = 60;     // 1 回の応答でサムネイル描画に使ってよい時間。残りは次の便

/**
 * api = {
 *   isMarpDoc(doc), repoRootFor(doc), repoRoots() → string[]（theme/academic.css のある候補。先頭が本命）,
 *   corpusFor?(repoRoot) → corpus（corpus-vscode のメモリ上の索引。無ければこちらで読む）,
 *   shelfFor?(repoRoot) → shelf,
 *   renderThumb(webview, mdAbs, text) → { html, css },
 *   openPreview() → void（同期プレビューを開くコマンド）,
 *   rebuildCorpus?() → void,
 *   nonce: string, mediaDir: string
 * }
 * @returns {{ open, noteOpened, isOpen, panelFor, dispose }}
 */
function register(context, api) {
  let panel = null;
  let repoRoot = null;
  let thumbs = new Map();           // deckRel → { sig, cssKey, css, slides:[html] }
  let fallbackCorpus = null, fallbackAt = 0;
  const nonce = api.nonce || crypto.randomBytes(18).toString('base64');

  const post = (msg) => { if (panel) { try { panel.webview.postMessage(msg); } catch (_) { /* 閉じた */ } } };
  const cfg = () => vscode.workspace.getConfiguration('marpScrollSync');

  // ---------- 索引と棚 ----------
  function corpusOf(root) {
    if (typeof api.corpusFor === 'function') { try { const c = api.corpusFor(root); if (c) return c; } catch (e) { console.error('[marp-scroll-sync] home corpusFor: ' + (e && e.message || e)); } }
    if (fallbackCorpus && fallbackCorpus.root === root && Date.now() - fallbackAt < 60 * 1000) return fallbackCorpus.c;
    let disk = null;
    try { disk = core.readCorpus(root); } catch (_) { disk = null; }
    const c = core.buildCorpus(root, { withChurn: false, cache: disk });
    fallbackCorpus = { root, c }; fallbackAt = Date.now();
    return c;
  }
  function shelfOf(root) {
    if (typeof api.shelfFor === 'function') { try { const s = api.shelfFor(root); if (s) return s; } catch (_) { /* 下へ */ } }
    try { return core.readShelf(root); } catch (_) { return { shelves: [] }; }
  }

  // ---------- 最近開いたデック ----------
  function recentList() { const v = context.workspaceState.get(RECENT_KEY, []); return Array.isArray(v) ? v : []; }
  function noteOpened(doc) {
    try {
      if (!doc || !doc.uri || doc.uri.scheme !== 'file' || !api.isMarpDoc(doc)) return;
      const root = api.repoRootFor(doc);
      const rel = path.relative(root, doc.uri.fsPath).split(path.sep).join('/');
      if (rel.startsWith('..') || !/^slides\//.test(rel)) return;      // slides/ 配下のデックだけ（試験用の一時ファイルは覚えない）
      const next = home.recentPush(recentList(), rel, Date.now());
      context.workspaceState.update(RECENT_KEY, next);
      if (panel && repoRoot === root) post({ type: 'homeRecent', recent: home.recentItems(next, corpusOf(root)) });
    } catch (_) { /* 記録は飾り */ }
  }

  // ---------- サムネイル ----------
  function sigOf(abs) {
    const d = vscode.workspace.textDocuments.find((x) => x.uri.scheme === 'file' && x.uri.fsPath === abs);
    if (d) return 'v' + d.version;
    try { return 'm' + fs.statSync(abs).mtimeMs; } catch (_) { return null; }
  }
  function thumbOf(deckRel) {
    const abs = path.join(repoRoot, deckRel);
    const sig = sigOf(abs);
    if (!sig) return null;
    const hit = thumbs.get(deckRel);
    if (hit && hit.sig === sig) { thumbs.delete(deckRel); thumbs.set(deckRel, hit); return hit; }
    let out;
    try {
      const d = vscode.workspace.textDocuments.find((x) => x.uri.scheme === 'file' && x.uri.fsPath === abs);
      out = api.renderThumb(panel.webview, abs, d ? d.getText() : fs.readFileSync(abs, 'utf8'));
    } catch (_) { return null; }
    const rec = { sig, cssKey: deckRel + '@' + sig, css: out.css, slides: home.splitSlides(out.html) };
    thumbs.set(deckRel, rec);
    while (thumbs.size > THUMB_DECKS) thumbs.delete(thumbs.keys().next().value);
    return rec;
  }
  /** homeThumbs：見えているカードの分だけ描いて返す。時間を越えたら残りは次の便（同じ reqId で続けて送る） */
  function sendThumbs(m) {
    const keys = Array.isArray(m && m.keys) ? m.keys.filter((k) => k && typeof k.deck === 'string' && Number.isInteger(k.slide)) : [];
    const have = new Set(Array.isArray(m && m.haveCss) ? m.haveCss : []);
    const step = (rest) => {
      if (!panel || !rest.length) return;
      const t0 = Date.now();
      const items = [], css = {};
      let i = 0;
      for (; i < rest.length; i++) {
        if (i > 0 && Date.now() - t0 > THUMB_BATCH_MS) break;
        const k = rest[i];
        const t = thumbOf(k.deck);
        const html = t && t.slides[k.slide - 1] ? t.slides[k.slide - 1] : '';
        if (t && html && !have.has(t.cssKey)) { css[t.cssKey] = t.css; have.add(t.cssKey); }
        items.push({ key: k.deck + '#' + k.slide, cssKey: t && html ? t.cssKey : null, html });
      }
      post({ type: 'homeThumbData', reqId: m.reqId, items, css });
      if (i < rest.length) setTimeout(() => step(rest.slice(i)), 0);
    };
    step(keys);
  }

  // ---------- 一覧 ----------
  function sendData() {
    if (!panel) return;
    const t0 = Date.now();
    try {
      const c = corpusOf(repoRoot);
      const shelf = core.resolveShelf(shelfOf(repoRoot), c);
      const top = home.mostEdited(c, { limit: 48, sort: 'touched' });
      post({
        type: 'homeData', repoRoot, generatedAt: c.generatedAt || null, withChurn: !!c.withChurn || (c.entries || []).some((e) => e.churn && e.churn.touched > 0),
        recent: home.recentItems(recentList(), c), shelves: home.shelfItems(shelf), top: top.items, topTotal: top.total,
        decks: home.decksOf(c), ms: Date.now() - t0,
        split: (c.entries || []).some((e) => e.churn && e.churn.human && e.churn.human.touched !== e.churn.touched),   // Claude 名義のコミットがあり、人と分かれているか
        openPreview: cfg().get('home.openPreview', true),
      });
    } catch (e) {
      console.error('[marp-scroll-sync] home data: ' + (e && e.stack || e));
      post({ type: 'homeData', repoRoot, error: String(e && e.message || e), recent: [], shelves: [], top: [], decks: [] });
    }
  }
  function sendSearch(m) {
    const reqId = m && m.reqId;
    try {
      const c = corpusOf(repoRoot);
      const q = String(m && m.query || '');
      const sort = ['relevance', 'score', 'recent', 'touched', 'human'].includes(m && m.sort) ? m.sort : (q ? 'relevance' : 'touched');
      const r = (sort === 'touched' || sort === 'human') && !q ? home.mostEdited(c, { limit: 48, sort })
        : home.search(c, q, { sort: sort === 'touched' ? 'score' : sort, limit: 48, shelf: core.resolveShelf(shelfOf(repoRoot), c) });
      post({ type: 'homeResults', reqId, query: q, total: r.total, items: r.items });
    } catch (e) {
      post({ type: 'homeResults', reqId, query: String(m && m.query || ''), total: 0, items: [], error: String(e && e.message || e) });
    }
  }

  // ---------- 開く ----------
  async function openSlide(m) {
    if (!m || typeof m.deck !== 'string') return;
    const abs = path.resolve(repoRoot, m.deck);
    if (path.relative(repoRoot, abs).startsWith('..') || !fs.existsSync(abs)) { post({ type: 'homeToast', warn: true, message: 'その原稿が見つかりません: ' + m.deck }); return; }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
    const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: false });
    try {
      const starts = slideStartLines(doc.getText());
      const idx = Math.max(0, Math.min(starts.length - 1, (Number.isInteger(m.slide) ? m.slide : 1) - 1));
      const ln = starts[idx] != null ? starts[idx] : 0;
      const pos = new vscode.Position(ln, 0);
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
    } catch (_) { /* 位置合わせは飾り */ }
    noteOpened(doc);
    const wantPreview = typeof m.preview === 'boolean' ? m.preview : cfg().get('home.openPreview', true);
    if (wantPreview && typeof api.openPreview === 'function') { try { await api.openPreview(); } catch (_) { /* プレビューは任意 */ } }
  }

  // ---------- パネル ----------
  function media(name) {
    try { return fs.readFileSync(path.join(api.mediaDir, name), 'utf8').replace(/<\/(script|style)/gi, '<\\/$1'); }
    catch (e) { console.error('[marp-scroll-sync] media/' + name + ' を読めません: ' + (e && e.message)); return ''; }
  }
  function buildHtml(webview) {
    const cspSource = webview.cspSource;
    const init = { repoRoot, openPreview: cfg().get('home.openPreview', true) };
    return /* html */ `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource} https: data:; media-src ${cspSource} https: data: blob:; style-src ${cspSource} https: 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource} https: data:;">
<title>Marp ホーム</title>
<style>${media('home.css')}</style>
</head>
<body>
<div id="home"></div>
<script nonce="${nonce}">window.__SS_HOME__ = ${JSON.stringify(init).replace(/</g, '\\u003c')};</script>
<script nonce="${nonce}">${media('home.js')}</script>
</body></html>`;
  }
  function pickRoot() {
    const roots = typeof api.repoRoots === 'function' ? api.repoRoots() : [];
    return roots.find((r) => r && fs.existsSync(path.join(r, 'theme', 'academic.css'))) || roots[0] || null;
  }
  function open(opts) {
    const o = opts || {};
    const root = o.repoRoot || pickRoot();
    if (!root) { vscode.window.showInformationMessage('Marp ホーム：theme/academic.css のあるフォルダ（marp-GUI）を開いてから実行してください。'); return null; }
    if (panel && repoRoot === root) { panel.reveal(undefined, false); if (o.query) post({ type: 'homeQuery', query: o.query }); return panel; }
    if (panel) { panel.dispose(); }
    repoRoot = root;
    thumbs = new Map();
    panel = vscode.window.createWebviewPanel(
      'marpHome', 'Marp ホーム', { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.file(root)] }
    );
    try { panel.iconPath = new vscode.ThemeIcon('home'); } catch (_) { /* 古い API */ }
    panel.onDidDispose(() => { panel = null; thumbs = new Map(); }, null, context.subscriptions);
    panel.webview.onDidReceiveMessage((m) => {
      if (!m || typeof m.type !== 'string') return;
      try {
        if (m.type === 'homeReady' || m.type === 'homeRefresh') sendData();
        else if (m.type === 'homeSearch') sendSearch(m);
        else if (m.type === 'homeThumbs') sendThumbs(m);
        else if (m.type === 'homeOpen') openSlide(m).catch((e) => post({ type: 'homeToast', warn: true, message: '開けませんでした: ' + String(e && e.message || e) }));
        else if (m.type === 'homeSetPreview') { cfg().update('home.openPreview', !!m.value, vscode.ConfigurationTarget.Global).then(undefined, () => {}); }
        else if (m.type === 'homeRebuild') { if (typeof api.rebuildCorpus === 'function') api.rebuildCorpus(); fallbackCorpus = null; setTimeout(sendData, 300); }
      } catch (e) { console.error('[marp-scroll-sync] home ' + m.type + ': ' + (e && e.stack || e)); }
    }, null, context.subscriptions);
    panel.webview.html = buildHtml(panel.webview);
    if (o.query) setTimeout(() => post({ type: 'homeQuery', query: o.query }), 50);
    return panel;
  }

  /** 起動直後：設定 home.onStartup が真で、Marp の原稿がまだ表示されていなければホームを出す（このリポジトリを開いたときだけ） */
  function maybeOpenOnStartup() {
    try {
      if (!cfg().get('home.onStartup', true)) return;
      const folders = vscode.workspace.workspaceFolders || [];
      if (!folders.some((f) => fs.existsSync(path.join(f.uri.fsPath, 'theme', 'academic.css')))) return;
      if (vscode.window.visibleTextEditors.some((e) => { try { return api.isMarpDoc(e.document); } catch (_) { return false; } })) return;
      if (context.workspaceState.get('marpScrollSync.home.shownAt', 0) > Date.now() - 60 * 1000) return;   // 再読み込みの連打で何度も出さない
      context.workspaceState.update('marpScrollSync.home.shownAt', Date.now());
      open();
    } catch (e) { console.error('[marp-scroll-sync] home startup: ' + (e && e.message || e)); }
  }

  if (context && context.subscriptions) {
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((ed) => { if (ed) noteOpened(ed.document); }));
    context.subscriptions.push({ dispose() { if (panel) { try { panel.dispose(); } catch (_) { /* 既に無い */ } } } });
    // 索引が外で変わったら（保存・CLI の corpus）、開いているホームの一覧を描き直す
    let t = null;
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((d) => {
      if (!panel || !d || !/\.md$/i.test(d.uri.fsPath)) return;
      clearTimeout(t); t = setTimeout(sendData, 1500);
    }));
  }

  return { open, noteOpened, maybeOpenOnStartup, isOpen: () => !!panel, panelFor: () => panel, repoRoot: () => repoRoot };
}

module.exports = { register, RECENT_KEY };
