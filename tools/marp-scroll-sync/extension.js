// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// Marp Scroll Sync (marp-GUI)
// - ステータスバーに「編集中のカーソル行が Marp の何枚目か」を表示
// - サイドの Webview プレビューをカーソル位置のスライドへ自動スクロール
// - スライドをクリックすると本文の該当行へジャンプ（双方向同期）
// - エディタで選択した文字を、プレビュー下部のツールバー／キーで font-size 1px 刻み・色変更
//   （テーマ CSS は別ファイルなので、その箇所だけインライン <span style="… !important"> で上書きする）
// v0.2（設計は DESIGN.md）：
// - プレビュー上の文字をダブルクリックして直接編集 → 位置が一意に確定したときだけ原稿へ書き戻す（lib/source-map.cjs）
// - スライドの新規・複製・移動・削除、箇条書きの追加/削除（lib/slide-ops.cjs）
// - 完成スライドの印と、貼り付け先に馴染む再利用（lib/library-*.cjs）
// - スライド単位の折りたたみ・ラベル表示（lib/folding-*.cjs）
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');   // cp.spawn は呼ぶ時に引く（試験が差し替えられるように）
const { Marp } = require('@marp-team/marp-core');
const { slideStartLines, slideIndexForLine, lineRangeForSlide, splitDeck, slideMeta } = require('./lib/slide-split.cjs');

/**
 * 追加機能のモジュールは、読み込みに失敗しても同期プレビュー本体を止めない。
 * （トップレベルの require が落ちると拡張ごと起動しなくなるため。失敗した機能だけ無効にする）
 */
function safeRequire(rel) {
  try { return require(rel); }
  catch (e) { console.error('[marp-scroll-sync] ' + rel + ' を読み込めません: ' + (e && e.message)); return null; }
}
const sourceMap = safeRequire('./lib/source-map.cjs');
const slideOps = safeRequire('./lib/slide-ops.cjs');
const foldingVs = safeRequire('./lib/folding-vscode.cjs');
const libraryVs = safeRequire('./lib/library-vscode.cjs');
const corpusVs = safeRequire('./lib/corpus-vscode.cjs');   // 既存スライドの検索と挿入（DESIGN 7〜8章）
const layoutVariants = safeRequire('./lib/layout-variants.cjs'); // 配置案（DESIGN 8.3）
const styleEdit = safeRequire('./lib/style-edit.cjs');           // Alt で箱を動かす・大きさを変える（DESIGN 9章）
const homeVs = safeRequire('./lib/home-vscode.cjs');             // ホーム画面：最近・棚・手を入れた順・検索 → 開く（DESIGN 10章）
let folding = null;        // foldingVs.register() の戻り値 { onPreviewNavigate, refresh }
let corpusSvc = null;      // corpusVs.register() の戻り値 { search, prefetch, insert, openSource, shelfEdit, onOverflow, openPopup, rebuild, warm }
let homeSvc = null;        // homeVs.register() の戻り値 { open, noteOpened, maybeOpenOnStartup, isOpen }
let homeItem = null;       // ステータスバーの「🏠 Marp」
// Marp とテーマは使い回す（DESIGN 8.0）。theme/*.css の mtime が変わったら作り直す。
//   deck … プレビュー本体用（行番号つき）／ thumb … サムネイル用（行番号なし。html が小さい）
const marpCache = { deck: null, thumb: null };
let lastSent = null;       // 直前に Webview へ送った描画 { uri, css, head, tail, slides:[html] }。次の描画と比べて patch か render を選ぶ（8.4）
const forceSlides = new Set(); // 次の patch に必ず含めるスライド（プレビューで打った文字が DOM に残っているので、html が同じでも差し替える）
const RENDER_DEBOUNCE_MS = 150; // 原稿側の入力から再描画まで（patch が軽いので 700 → 150）
let library = null;        // libraryVs.register() の戻り値 { toggleMark, openGallery, insert, marksFor }
let pendingExpect = null;  // 次の render に添える検算 { index, k, text, minVersion }（書き戻した文字が表示でも同じか）
let pendingStartEdit = null; // 次の render の直後に編集を始める { line, minVersion }（新しい箇条書き）。minVersion 未満の描画（編集前の原稿）には付けない
let editChain = Promise.resolve(); // プレビューからの編集を直列化する（連打で原稿の版がずれないように）

let statusItem;
let panel = null;          // 現在のプレビュー WebviewPanel
let panelDocUri = null;    // プレビュー対象ドキュメントの uri.toString()
let slideStarts = [];      // プレビュー対象の各スライド開始行(0-based)
let renderTimer = null;
let revealDeco = null;     // クリック逆引き時の一時ハイライト用デコレーション
let revealDecoTimer = null;
let presentOut = null;      // ▶ プレゼンの出力チャンネル「Marp Present」
/** ▶ が動かすスクリプト：この拡張と同じリポジトリに同梱の物に固定する（原稿のフォルダ側の tools/ は使わない。docs/security-review.md SEC-02） */
const PRESENT_SCRIPT = path.resolve(__dirname, '..', 'marp-present', 'present.mjs');

// --- サイズ/色 微調整（tune）用の状態 ---
const TUNE_CLASS = 'ss-tune';
const DEFAULT_PX = 23;       // 種サイズ（テーマ既定 section=23px）。実寸はプレビュークリックで上書きされる
let lastClickedPx = null;    // 直近にプレビューでクリックした要素の実寸(px)。サイズ増減の起点に使う
let renderImmediate = false; // tune 由来の編集はデバウンスを待たず即時に再描画する
let lastScrollIndex = -1;    // 同一スライド内の微調整でプレビューを揺らさないための直近スクロール先
let tuneChain = Promise.resolve(); // 連打しても編集が競合しないよう直列化する

/** frontmatter に marp: true を持つ markdown か */
function isMarpDoc(doc) {
  if (!doc || doc.languageId !== 'markdown') return false;
  const head = doc.getText(new vscode.Range(0, 0, Math.min(doc.lineCount, 30), 0));
  return /^---[\s\S]*?\n\s*marp\s*:\s*true/m.test(head);
}

/** レンダリング後テキストと比較できるよう、原稿行から HTML タグ・Markdown 記号・実体参照を落として正規化 */
function normalizeForMatch(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')                 // HTML タグ
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/`+/g, '')                        // インラインコード
    .replace(/\*\*|\*|__|~~/g, '')             // 強調
    .replace(/^[\s>#*\-+|]+/, '')              // 行頭の箇条書き/見出し/引用/表記号
    .replace(/\s+/g, ' ')
    .trim();
}

/** 2 文字列の最長共通部分文字列の長さ（短い行同士なので素朴な DP で十分） */
function lcsLen(a, b) {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/**
 * クリックされたテキスト(query)に最も一致する原稿行を、スライドの行範囲内だけで探す。
 * 戻り値: 行番号(0-based) / 見つからなければ -1。
 */
function findLineForText(lines, startLn, endLn, query) {
  const q = normalizeForMatch(query);
  if (q.length < 1) return -1;
  let best = -1, bestScore = 0;
  for (let ln = startLn; ln < endLn && ln < lines.length; ln++) {
    const nl = normalizeForMatch(lines[ln]);
    if (!nl) continue;
    let score;
    if (nl.includes(q)) score = q.length + 1000;        // 行が clicked run を丸ごと含む(最強)
    else if (q.includes(nl)) score = nl.length + 500;   // 行テキストが clicked run の一部
    else score = lcsLen(nl, q);                          // 部分一致
    if (score > bestScore) { bestScore = score; best = ln; }
  }
  return bestScore >= 2 ? best : -1;
}

function updateStatus(editor) {
  if (!statusItem) return;
  const isMarp = !!(editor && isMarpDoc(editor.document));
  vscode.commands.executeCommand('setContext', 'marpScrollSync.isMarp', isMarp);
  if (!isMarp) { statusItem.hide(); return; }
  const starts = slideStartLines(editor.document.getText());
  const line = editor.selection.active.line;
  const idx = slideIndexForLine(starts, line);
  statusItem.text = `$(layout) Slide ${idx + 1}/${starts.length}`;
  statusItem.tooltip = 'Marp: クリックで同期プレビューを開く / 何枚目を編集中か';
  statusItem.show();
  // プレビュー追従（スライドが変わったときだけ。微調整中に揺らさない）
  if (panel && panelDocUri === editor.document.uri.toString()) {
    if (idx !== lastScrollIndex) {
      lastScrollIndex = idx;
      panel.webview.postMessage({ type: 'scrollToSlide', index: idx });
    }
    postTuneState(editor); // 選択に応じてツールバーの表示(px/色/活性)を更新
  }
}

/**
 * 相対ローカル画像・動画参照を webview uri に書き換える。
 * poster も対象にすること：<video poster="./src/…png"> を書き換えないと、
 * 動画の1枚目が出ずに黒い箱になる（CSP の media-src も合わせて必要）。
 */
function rewriteAssets(html, webview, docDir) {
  return html.replace(/(\bsrc\s*=\s*|\bposter\s*=\s*|\bxlink:href\s*=\s*|\bhref\s*=\s*)(["'])([^"']+)\2/g, (full, attr, q, val) => {
    if (/^(https?:|data:|#|\/\/)/.test(val)) return full;       // 外部 / data / アンカーは触らない
    if (/^[a-zA-Z]+:/.test(val)) return full;                   // スキーム付きは触らない
    const abs = path.resolve(docDir, val);
    try {
      const uri = webview.asWebviewUri(vscode.Uri.file(abs));
      return `${attr}${q}${uri.toString()}${q}`;
    } catch (_) { return full; }
  });
}

/**
 * repoRoot/theme/*.css を全部拾って絶対パスで返す。
 * 部品テーマ（非同梱） / tsutawaru-academic は `@import "academic"` するので academic.css を先頭に置く。
 * （テーマを増やしてもここを書き換えなくていいように、固定リストにはしない）
 */
function themeFiles(repoRoot) {
  const dir = path.join(repoRoot, 'theme');
  let names;
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.css')); } catch (_) { return []; }
  names.sort((a, b) => (a === 'academic.css' ? -1 : b === 'academic.css' ? 1 : a.localeCompare(b)));
  return names.map(n => path.join(dir, n));
}

/**
 * リポジトリのルート（theme/academic.css がある場所）。デックの場所から上へ辿って探す。
 * ワークスペースをデックのフォルダや tools/ で開いていても、テーマとライブラリを見つけられるようにする。
 */
function repoRootFor(doc) {
  const docDir = path.dirname(doc.uri.fsPath);
  // 原稿の入ったワークスペースフォルダより上へはたどらない（docs/security-review.md SEC-01）。
  // ワークスペースの外の原稿（フォルダを開かずにファイルだけ開いた）では、従来どおり 8 階層まで上へたどる
  const wf = vscode.workspace.getWorkspaceFolder ? vscode.workspace.getWorkspaceFolder(doc.uri) : undefined;
  const limit = wf && wf.uri && wf.uri.fsPath ? path.resolve(wf.uri.fsPath) : null;
  const inside = (d) => { const r = path.relative(limit, d); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  for (let d = docDir, i = 0; i < 8; i++) {
    if (limit && !inside(d)) break;
    if (fs.existsSync(path.join(d, 'theme', 'academic.css'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return limit || docDir;
}

/**
 * プレビューでスクリプトを動かしてよい印（CSP の nonce）。拡張を読み込むたびに乱数で作る。
 * 【なぜ要るか】デックは html: true で描くので、他人から受け取ったデックに <script> や onerror= が
 *   入っていると、以前（script-src 'unsafe-inline'）はそれがプレビューの中で動いてしまった。
 *   動いたスクリプトは acquireVsCodeApi() を先に取り、拡張になりすまして原稿の書き換えなどを頼めた。
 * 【どう防ぐか】CSP を script-src 'nonce-…' だけにし、この印は拡張自身の <script> と
 *   Marp が出す補助スクリプト（見出しの自動縮小など）にだけ付ける。デックの中の <script>・イベント属性
 *   （onclick= など）・javascript: の URL には印が無いので、ブラウザが実行を拒む。
 *   デックの側から印を読む手段は無い（スクリプトは動かず、CSS からも nonce 属性は見えない）。
 *
 * Nonce that marks which scripts may run in the preview (CSP nonce). Regenerated randomly on each load.
 * [Why] Decks are rendered with html: true. With the old CSP (script-src 'unsafe-inline'), a <script>
 *   or onerror= inside a deck received from someone else ran inside the preview, could grab
 *   acquireVsCodeApi() first, and impersonate the extension (e.g. ask it to rewrite the source).
 * [How] The CSP allows only script-src 'nonce-…', and the nonce is given only to the extension's own
 *   <script> tags and to Marp's helper script (heading auto-scaling etc.). Deck <script>, event
 *   attributes (onclick= etc.) and javascript: URLs carry no nonce, so the browser refuses to run them.
 *   A deck cannot read the nonce (its scripts do not run, and CSS cannot see the nonce attribute).
 */
const SCRIPT_NONCE = crypto.randomBytes(18).toString('base64');

/** テーマ込みの Marp を返す（kind＝'deck'|'thumb'）。theme/*.css の場所と mtime が同じ間は同じ物を使い回す */
function marpFor(kind, repoRoot) {
  const files = themeFiles(repoRoot);
  let key = repoRoot + '|';
  for (const f of files) { try { key += f + ':' + fs.statSync(f).mtimeMs + ';'; } catch (_) { /* 無いテーマは飛ばす */ } }
  const hit = marpCache[kind];
  if (hit && hit.key === key) return hit.marp;
  // script.nonce：Marp が html の末尾に入れる自前の補助スクリプトに、上の印を付けてもらう（無いと CSP で止まる）
  // script.nonce: have Marp put the nonce on the helper script it appends to the html (otherwise CSP blocks it)
  const marp = new Marp({ html: true, script: { nonce: SCRIPT_NONCE } });
  if (kind === 'deck') {
    // 各ブロックに元の行番号(0-based)を data-line / data-line-end として付与 → クリック逆引きと、直接編集の書き戻し位置の特定に使う。
    // html_block の中のタグには data-hline を付ける（プレビュー専用。marp-cli の出力には影響しない）
    if (sourceMap) sourceMap.attachLineInfo(marp);
    else {
      marp.markdown.core.ruler.push('ss_line_numbers', (state) => {
        for (const t of state.tokens) {
          if (t.map && t.nesting === 1) t.attrSet('data-line', String(t.map[0]));
        }
      });
    }
  }
  for (const abs of files) {
    try { marp.themeSet.add(fs.readFileSync(abs, 'utf8')); } catch (_) { /* 任意 */ }
  }
  marpCache[kind] = { key, marp };
  return marp;
}

/**
 * サムネイル用に、別のデック（mdAbs）を同じテーマで描く。素材の参照はプレビューの webview URI に直す。
 */
function renderForThumb(mdAbs, text, webview) {
  const wv = webview || (panel && panel.webview);
  if (!wv) throw new Error('プレビューが開かれていません');
  const repoRoot = repoRootFor({ uri: vscode.Uri.file(mdAbs) });
  const { html, css } = marpFor('thumb', repoRoot).render(text);
  return { html: rewriteAssets(html, wv, path.dirname(mdAbs)), css };
}

/**
 * ホーム画面のためのリポジトリ候補（原稿が開いていなくても探せる）。
 * 先頭が本命：アクティブな原稿 → 表示中の原稿 → ワークスペースの各フォルダ（theme/academic.css を上へ辿って探す）
 */
function repoRoots() {
  const out = [];
  const add = (r) => { if (r && !out.includes(r)) out.push(r); };
  const eds = [vscode.window.activeTextEditor].concat(vscode.window.visibleTextEditors || []).filter(Boolean);
  for (const ed of eds) { try { if (ed.document.uri.scheme === 'file' && /\.md$/i.test(ed.document.uri.fsPath)) add(repoRootFor(ed.document)); } catch (_) { /* 次へ */ } }
  for (const f of (vscode.workspace.workspaceFolders || [])) { try { add(repoRootFor({ uri: vscode.Uri.file(path.join(f.uri.fsPath, 'x.md')) })); } catch (_) { /* 次へ */ } }
  return out;
}

/** marp-core でデッキを描画し {html, css} を返す（テーマも読み込む） */
function renderDeck(webview, doc) {
  const docDir = path.dirname(doc.uri.fsPath);
  let out;
  try { out = marpFor('deck', repoRootFor(doc)).render(doc.getText()); }
  catch (e) { marpCache.deck = null; throw e; }   // 使い回しの Marp が壊れた状態で残らないように
  const st = stableScopes(out.html, out.css);
  return { html: rewriteAssets(st.html, webview, docDir), css: st.css };
}

/**
 * <style scoped> の目印（data-marpit-scope-XXXXXXXX）は描くたびに乱数で変わる（実測）。そのままだと毎回 css も該当スライドも
 * 「変わった」ことになり patch にならないので、出てきた順の連番に付け替える（html と css の両方。プレビュー専用）。
 */
function stableScopes(html, css) {
  if (html.indexOf('data-marpit-scope-') < 0) return { html, css };
  const ids = new Map();
  const re = /data-marpit-scope-([A-Za-z0-9_-]+)/g;
  const to = (full, id) => { if (!ids.has(id)) ids.set(id, 'ss' + ids.size); return 'data-marpit-scope-' + ids.get(id); };
  html = html.replace(re, to);
  css = css.replace(re, (full, id) => (ids.has(id) ? 'data-marpit-scope-' + ids.get(id) : full));
  return { html, css };
}

/**
 * 描いた html をスライド（<svg data-marpit-svg …>…</svg>）単位に切る。本文のインライン svg を巻き込まないよう、開始位置だけで切る。
 * 戻り値 { head, slides, tail }。切れなければ null（そのときは必ず render）。
 */
function cutSlides(html) {
  const re = /<svg\b[^>]*\bdata-marpit-svg\b/g;
  const at = [];
  for (let m; (m = re.exec(html));) at.push(m.index);
  if (!at.length) return null;
  const end = html.lastIndexOf('</svg>') + 6;
  if (end < 6 || end <= at[at.length - 1]) return null;
  return { head: html.slice(0, at[0]), tail: html.slice(end), slides: at.map((s, i) => html.slice(s, i + 1 < at.length ? at[i + 1] : end)) };
}
function noteSent(doc, html, css) {
  const cut = cutSlides(html);
  lastSent = cut ? { uri: doc.uri.toString(), css, head: cut.head, tail: cut.tail, slides: cut.slides } : null;
}

function buildHtml(webview, doc, initialIndex) {
  let html, css;
  try { ({ html, css } = renderDeck(webview, doc)); noteSent(doc, html, css); }
  catch (e) { lastSent = null; return `<body style="font-family:sans-serif;padding:20px;color:#b00">レンダリングエラー: ${String(e.message || e)}</body>`; }

  // プレビューの UI（バッジ・ツールバー・直接編集・スライド操作・ギャラリー）は media/preview.js が自分で作る。
  // スクリプトは外部ファイルを読まず、中身をその場に埋め込む。CSP は nonce で許す（上の SCRIPT_NONCE を参照）。
  // Scripts are inlined rather than loaded from files; CSP allows them by nonce (see SCRIPT_NONCE above).
  const media = (name) => {
    try { return fs.readFileSync(path.join(__dirname, 'media', name), 'utf8'); }
    catch (e) { console.error('[marp-scroll-sync] media/' + name + ' を読めません: ' + (e && e.message)); return ''; }
  };
  // 任意の部品（はみ出し検知・配置案）。読めなければ黙って外す（同期プレビュー本体は動く）
  const optional = (name) => {
    try { return fs.readFileSync(path.join(__dirname, 'media', name), 'utf8').replace(/<\/(script|style)/gi, '<\\/$1'); }
    catch (_) { return ''; }
  };
  let layoutsTable = '';
  try { if (layoutVariants) layoutsTable = JSON.stringify(layoutVariants.browserTable()).replace(/</g, '\\u003c'); } catch (_) { layoutsTable = ''; }
  const layoutsJs = layoutsTable ? optional('layouts.js') : '';
  // 箱の編集（DESIGN 9章）。書き戻しの部品（style-edit.cjs）が無ければ、動かせても書けないので載せない
  const boxeditJs = styleEdit ? optional('boxedit.js') : '';
  const init = { index: Number.isInteger(initialIndex) ? initialIndex : 0, version: doc.version, marks: marksFor(doc) };
  const cspSource = webview.cspSource;
  // CSP の script-src は nonce だけ（'unsafe-inline' は付けない）。下の <script> にはすべて nonce="${nonce}" を付ける。
  // 付け忘れたスクリプトは黙って動かなくなるので、<script> を足すときは必ず nonce も付けること。
  // CSP script-src is nonce-only (no 'unsafe-inline'); every <script> below carries nonce="${nonce}".
  // A script without the nonce silently fails to run, so always add the nonce when adding a <script>.
  const nonce = SCRIPT_NONCE;
  return /* html */ `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource} https: data:; media-src ${cspSource} https: data: blob:; style-src ${cspSource} https: 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource} https: data:;">
<style>${media('preview.css')}</style>
${layoutsJs ? `<style>${optional('layouts.css')}</style>` : ''}
${boxeditJs ? `<style>${optional('boxedit.css')}</style>` : ''}
<style id="deck-css">${css}</style>
</head>
<body>
<div id="wrap">${html}</div>
<script nonce="${nonce}">window.__SS_INIT__ = ${JSON.stringify(init).replace(/</g, '\\u003c')};</script>
<script nonce="${nonce}">${media('textnodes.js')}</script>
<script nonce="${nonce}">${optional('overflow.js')}</script>
<script nonce="${nonce}">${media('preview.js')}</script>
${layoutsJs ? `<script nonce="${nonce}">window.__SS_LAYOUTS__ = ${layoutsTable};</script>\n<script nonce="${nonce}">${layoutsJs}</script>` : ''}
${boxeditJs ? `<script nonce="${nonce}">${boxeditJs}</script>` : ''}
</body></html>`;
}

/** 各スライドに「完成」の印（_lib）があるか。プレビューの ★ 表示に使う */
function marksFor(doc) {
  try { if (library) return library.marksFor(doc); } catch (_) { /* 下の簡易判定へ */ }
  try {
    const deck = splitDeck(doc.getText());
    return deck.slides.map(sl => slideMeta(deck.lines, sl.startLine, sl.endLine).marked);
  } catch (_) { return []; }
}

function renderInto(panelRef, doc, initialIndex) {
  panelRef.webview.html = buildHtml(panelRef.webview, doc, initialIndex);
}

/** 既存 webview の中身(#wrap と deck-css)だけ差し替える。ツールバー・スクロール位置を保つ。 */
function renderUpdate(doc, idx, forceFull) {
  if (!panel) return;
  try {
    const { html, css } = renderDeck(panel.webview, doc);
    // 検算と「次の編集の開始」は、書き戻した後の原稿の描画にだけ添える（保留中だった古い描画に付けると誤警告になる）
    let expect = null;
    if (pendingExpect && doc.version >= pendingExpect.minVersion) { expect = { index: pendingExpect.index, k: pendingExpect.k, text: pendingExpect.text }; pendingExpect = null; }
    // 変わったスライドだけ送る（8.4）。枚数・css・スライドの外側が前回と同じときだけ。違えば従来どおり全体を送る
    const prev = lastSent;
    const cut = cutSlides(html);
    const uri = doc.uri.toString();
    const patchable = !forceFull && prev && cut && prev.uri === uri && prev.css === css && prev.head === cut.head && prev.tail === cut.tail && prev.slides.length === cut.slides.length;
    if (patchable) {
      const changed = [];
      for (let i = 0; i < cut.slides.length; i++) if (cut.slides[i] !== prev.slides[i] || forceSlides.has(i)) changed.push({ index: i, html: cut.slides[i] });
      panel.webview.postMessage({ type: 'patch', version: doc.version, slides: changed, marks: marksFor(doc), expect: expect || undefined });
    } else {
      panel.webview.postMessage({ type: 'render', html, css, index: idx, version: doc.version, marks: marksFor(doc), expect: expect || undefined });
    }
    forceSlides.clear();
    lastSent = cut ? { uri, css, head: cut.head, tail: cut.tail, slides: cut.slides } : null;
    if (pendingStartEdit && doc.version >= pendingStartEdit.minVersion) {   // 新しい箇条書きを作った直後：描き直した DOM でその行の編集を始める
      const line = pendingStartEdit.line; pendingStartEdit = null;
      panel.webview.postMessage({ type: 'startEdit', line });
    }
  } catch (e) {
    lastSent = null;
    panel.webview.postMessage({ type: 'render', index: 0, css: '',
      html: '<pre style="color:#f88;padding:16px;white-space:pre-wrap">レンダリングエラー: ' + String(e.message || e) + '</pre>' });
  }
}

function openPreview(context) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMarpDoc(editor.document)) {
    vscode.window.showInformationMessage('Marp (marp: true) の markdown を開いてから実行してください。');
    return;
  }
  const doc = editor.document;
  slideStarts = slideStartLines(doc.getText());
  const idx = slideIndexForLine(slideStarts, editor.selection.active.line);
  lastScrollIndex = idx;

  if (panel) { panel.reveal(vscode.ViewColumn.Beside, true); }
  else {
    const repoRoot = repoRootFor(doc);
    const roots = [vscode.Uri.file(path.dirname(doc.uri.fsPath))];
    if (repoRoot) roots.push(vscode.Uri.file(repoRoot));
    panel = vscode.window.createWebviewPanel(
      'marpScrollSync', 'Marp Sync Preview', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: roots }
    );
    panel.onDidDispose(() => { panel = null; panelDocUri = null; lastSent = null; }, null, context.subscriptions);
    panel.webview.onDidReceiveMessage((m) => {
      if (!m) return;

      // 直接編集・スライド操作・取り消し（プレビューだけで直す経路）。原稿の版がずれないよう1件ずつ順に処理する
      // 既存スライドの検索（DESIGN 7.4）。読むだけなので編集の列には並べず、すぐ応える
      if (m.type === 'corpusSearch') {
        const d = panelDoc();
        if (corpusSvc && d) corpusSvc.search(d, m);
        else panel.webview.postMessage({ type: 'corpusResults', reqId: m.reqId, total: 0, offset: 0, building: false, items: [], css: {}, error: 'スライド検索の部品を読み込めませんでした' });
        return;
      }
      if (m.type === 'openSource') { const d = panelDoc(); if (corpusSvc && d) corpusSvc.openSource(d, m).catch(() => {}); return; }
      // 棚と上位の先読み（8.0）。応答が無くても Webview は動くので、部品が無ければ黙って捨てる
      if (m.type === 'corpusPrefetch') { const d = panelDoc(); if (corpusSvc && d) { try { corpusSvc.prefetch(d, m); } catch (e) { console.error('[marp-scroll-sync] corpusPrefetch: ' + (e && e.message || e)); } } return; }
      if (m.type === 'shelfEdit') {
        const d = panelDoc();
        if (corpusSvc && d) corpusSvc.shelfEdit(d, m);
        else panel.webview.postMessage({ type: 'shelfState', ok: false, message: 'スライド検索の部品を読み込めませんでした' });
        return;
      }
      if (m.type === 'overflowReport') { const d = panelDoc(); if (corpusSvc && d) { try { corpusSvc.onOverflow(d, m); } catch (_) { /* 通知は飾り */ } } return; }
      // 当てられない patch を受けた Webview からの頼み：全体を描き直す
      if (m.type === 'needRender') { const d = panelDoc(); lastSent = null; if (d) { clearTimeout(renderTimer); doRender(d, true); } return; }

      if (PREVIEW_EDIT_TYPES.has(m.type)) {
        editChain = editChain.then(() => handlePreviewEdit(m)).catch((e) => {
          console.error('[marp-scroll-sync] ' + m.type + ': ' + (e && e.stack || e));
          postEditResult(false, '処理中にエラーが起きました（原稿は変えていません）');
        });
        return;
      }

      if (m.type === 'clipboard') {   // 保留した入力を入れられなかったとき、文字を失わないよう渡す
        Promise.resolve().then(() => vscode.env && vscode.env.clipboard ? vscode.env.clipboard.writeText(String(m.text || '')) : null).catch(() => {});
        return;
      }

      if (m.type === 'tune') {
        const ed = panelEditor();
        if (!ed) { vscode.window.showInformationMessage('プレビュー対象の Markdown エディタを表示してから操作してください。'); return; }
        if (m.op === 'inc') applyTune(ed, { dPx: +1, fromPreview: true });
        else if (m.op === 'dec') applyTune(ed, { dPx: -1, fromPreview: true });
        else if (m.op === 'color') applyTune(ed, { color: m.value, fromPreview: true });
        else if (m.op === 'clear') applyTune(ed, { clear: true, fromPreview: true });
        return;
      }

      const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === panelDocUri)
        || vscode.window.activeTextEditor;
      if (!ed) return;

      if (m.type === 'revealLine' && typeof m.line === 'number') {
        if (typeof m.px === 'number' && m.px > 0) lastClickedPx = Math.round(m.px); // サイズ増減の起点
        const ln = Math.max(0, Math.min(m.line, ed.document.lineCount - 1));
        const text = ed.document.lineAt(ln).text;
        const startCol = text.length - text.replace(/^\s+/, '').length;
        const range = new vscode.Range(ln, startCol, ln, Math.max(startCol, text.length));
        ed.selection = new vscode.Selection(range.start, range.end);
        ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        flashReveal(ed, range);
        vscode.window.showTextDocument(ed.document, { viewColumn: ed.viewColumn, preserveFocus: false })
          .then(() => { postTuneState(ed); followFold(ed, slideIndexForLine(slideStarts, ln)); });
        return;
      }

      if (m.type === 'revealText' && typeof m.text === 'string' && slideStarts[m.index] !== undefined) {
        if (typeof m.px === 'number' && m.px > 0) lastClickedPx = Math.round(m.px); // サイズ増減の起点
        // クリックした文字列を、そのスライドの行範囲内だけで照合 → 該当行を選択＆一時ハイライト
        const lines = ed.document.getText().split(/\r?\n/);
        const [s, e] = lineRangeForSlide(slideStarts, m.index, lines.length);
        let ln = findLineForText(lines, s, e, m.text);
        if (ln < 0) ln = s;                              // 一致行なし → スライド先頭行を必ずハイライト
        const text = lines[ln] || '';
        const startCol = text.length - text.replace(/^\s+/, '').length; // 行頭インデントを除いた先頭
        const range = new vscode.Range(ln, startCol, ln, Math.max(startCol, text.length));
        ed.selection = new vscode.Selection(range.start, range.end);
        ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        flashReveal(ed, range);
        vscode.window.showTextDocument(ed.document, { viewColumn: ed.viewColumn, preserveFocus: false })
          .then(() => { postTuneState(ed); followFold(ed, m.index); });
        return;
      }

      if (m.type === 'revealSlide' && slideStarts[m.index] !== undefined) {
        const ln = slideStarts[m.index];
        const pos = new vscode.Position(ln, 0);
        ed.selection = new vscode.Selection(pos, pos);
        ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
        // 余白クリック＝「スライドを選ぶ」操作。フォーカスはプレビューに残し、続けて ↑↓ で送れるようにする
        vscode.window.showTextDocument(ed.document, { viewColumn: ed.viewColumn, preserveFocus: true });
        followFold(ed, m.index);
        return;
      }

      // ↑↓ 等でのスライド送り。原稿のカーソルだけ動かし、プレビューのフォーカスは奪わない
      if (m.type === 'gotoSlide' && slideStarts[m.index] !== undefined) {
        const ln = slideStarts[m.index];
        const pos = new vscode.Position(ln, 0);
        ed.selection = new vscode.Selection(pos, pos);
        ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
        lastScrollIndex = m.index;      // プレビューは既に動いているので押し戻さない
        updateStatus(ed);               // ステータスバーの Slide n/N を更新
        followFold(ed, m.index);
        return;
      }
    }, null, context.subscriptions);
  }
  panelDocUri = doc.uri.toString();
  renderInto(panel, doc, idx);
  if (corpusSvc) { try { corpusSvc.warm(doc); } catch (_) { /* 先読みは任意 */ } }
  postTuneState(editor);
}

// ===== プレビューからの編集（直接編集・箇条書き・スライド操作・取り消し） =====

const PREVIEW_EDIT_TYPES = new Set(['editCommit', 'bulletDelete', 'tuneSelect', 'slideOp', 'libraryInsert', 'corpusInsert', 'layoutApply', 'boxCommit', 'undo', 'redo']);

/** 書き戻せなかった理由（lib/source-map.cjs の reason）→ プレビューに出す文言 */
const REASON_TEXT = {
  stale: '原稿が先に変わりました。もう一度お試しください',
  newline: '改行は入れられません（行の中で折り返すなら Alt+Enter＝<br>。段落は原稿で分けてください）',
  autolink: 'リンクの中です。原稿の該当行で直してください',
  'code-highlight': 'コードの中です。原稿の該当行で直してください',
  'code-delimiter': 'コードの区切り記号に触れる編集です。原稿の該当行で直してください',
  'maybe-code': 'コードの中かもしれません。原稿の該当行で直してください',
  'emphasis-boundary': '太字などの記号の境目です。原稿の該当行で直してください',
  'emoji-shortcode': '「:名前:」は絵文字に変わります。原稿の該当行で直してください',
  'line-head': '行頭の記号として解釈される文字です。原稿の該当行で直してください',
  'html-empty': 'HTML の空要素です。原稿の該当行で直してください',
  'space-boundary': '空白の境目に打った文字は、原稿の位置を確定できません。原稿の該当行で直してください',
};
const REASON_DEFAULT = 'この文字は原稿の位置を確定できませんでした。原稿の該当行で直してください（原稿は変えていません）';

function postEditResult(ok, message, extra) {
  if (panel) panel.webview.postMessage(Object.assign({ type: 'editResult', ok, message }, extra || {}));
}

/** プレビュー由来の移動に折りたたみを追従させる（今のスライドを開き、前のスライドを畳む） */
function followFold(ed, index) {
  try { if (folding && ed && Number.isInteger(index)) folding.onPreviewNavigate(ed, index); } catch (_) { /* 折りたたみは補助機能 */ }
}

function panelDoc() {
  return vscode.workspace.textDocuments.find(d => d.uri.toString() === panelDocUri) || null;
}

/** 対象の原稿を表示しているエディタ。閉じられていたら左の列に開き直す（フォーカスはプレビューに残す） */
async function ensureEditor(doc) {
  const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
  if (ed) return ed;
  // プレビューが左端の列にいるとき（原稿のタブを閉じて列が詰まった後など）は、その上に重ねず隣に開く
  const col = (panel && panel.viewColumn === vscode.ViewColumn.One) ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
  return vscode.window.showTextDocument(doc, { viewColumn: col, preserveFocus: true, preview: false });
}

/** プレビュー対象の原稿か（即時再描画のフラグは、変更イベントがプレビュー対象から来るときだけ立てる。他の原稿では下りずに残る） */
function isPanelDoc(doc) {
  return !!(panel && panelDocUri && doc && doc.uri.toString() === panelDocUri);
}

/** 書けなかった行へ案内する（行を選択して一時ハイライト。ここから先は原稿で直すのでフォーカスも渡す） */
async function guideToLine(doc, line) {
  if (!Number.isInteger(line)) return;
  const ed = await ensureEditor(doc);
  const ln = Math.max(0, Math.min(line, doc.lineCount - 1));
  const text = doc.lineAt(ln).text;
  const startCol = text.length - text.replace(/^\s+/, '').length;
  const range = new vscode.Range(ln, startCol, ln, Math.max(startCol, text.length));
  ed.selection = new vscode.Selection(range.start, range.end);
  ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  flashReveal(ed, range);
  followFold(ed, slideIndexForLine(slideStartLines(doc.getText()), ln));
  await vscode.window.showTextDocument(doc, { viewColumn: ed.viewColumn, preserveFocus: false });
}

/** 重ならない編集を後ろから当てる。重なっていたら null（書かない） */
function applyEditsChecked(text, edits) {
  const sorted = edits.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (!Number.isInteger(e.start) || !Number.isInteger(e.end) || e.start > e.end || e.start < 0 || e.end > text.length) return null;
    if (i > 0 && sorted[i - 1].end > e.start) return null;
  }
  let out = text;
  for (let i = sorted.length - 1; i >= 0; i--) out = out.slice(0, sorted[i].start) + sorted[i].text + out.slice(sorted[i].end);
  return out;
}

/**
 * 原稿を oldText → newText にする。1操作＝1 WorkspaceEdit（Cmd+Z 1回で戻る）にするため、
 * 前後の共通部分を除いた最小の1置換にまとめる。サロゲートペアと CRLF の途中では切らない。
 */
async function replaceMinimal(doc, oldText, newText) {
  if (oldText === newText) return true;
  if (doc.getText() !== oldText) return false;             // 計算の元にした原稿と今の原稿が違う → 書かない
  let p = 0;
  const max = Math.min(oldText.length, newText.length);
  while (p < max && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && oldText.charCodeAt(oldText.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)) s++;
  const isHigh = (c) => c >= 0xD800 && c <= 0xDBFF, isLow = (c) => c >= 0xDC00 && c <= 0xDFFF;
  if (p > 0 && (isHigh(oldText.charCodeAt(p - 1)) || (oldText[p - 1] === '\r'))) p--;
  if (s > 0) {
    const c = oldText.charCodeAt(oldText.length - s);
    if (isLow(c) || (oldText[oldText.length - s] === '\n' && oldText[oldText.length - s - 1] === '\r')) s--;
  }
  const we = new vscode.WorkspaceEdit();
  we.replace(doc.uri, new vscode.Range(doc.positionAt(p), doc.positionAt(oldText.length - s)), newText.slice(p, newText.length - s));
  const mine = isPanelDoc(doc);
  if (mine) {
    renderImmediate = true;                                 // プレビューからの編集はデバウンスを待たず即時に描き直す
    clearTimeout(renderTimer);                              // 保留中の再描画が applyEdit の待ちの間に走らないように（直後に即時の再描画が来る）
  }
  const ok = await vscode.workspace.applyEdit(we);
  if (!ok && mine) { renderImmediate = false; scheduleReRender(); }
  if (ok) await saveAfterWrite(doc);
  return ok;
}

/**
 * この拡張が原稿に書いたあと、すぐファイルに保存する（設定 marpScrollSync.saveAfterEdit。既定 on）。
 * 未保存のまま置くと、外で同じ原稿を書き換える道具（Claude Code など）とぶつかり、VS Code が「ディスクの内容の方が新しい」と保存を断る。
 * 書けなかった・書くものが無かったときは呼ばない（呼び手が ok を見て呼ぶ）。無題の文書はダイアログが出るので触らない。
 */
async function saveAfterWrite(doc) {
  try {
    if (!doc || doc.isUntitled || doc.isClosed || typeof doc.save !== 'function') return false;
    if (vscode.workspace.getConfiguration('marpScrollSync').get('saveAfterEdit', true) === false) return false;
    if (doc.isDirty === false) return true;                 // 既に保存済み（stub など isDirty が無い環境では save に任せる）
    return !!(await doc.save());
  } catch (e) {
    console.error('[marp-scroll-sync] saveAfterWrite: ' + (e && e.stack || e));
    return false;
  }
}

function staleVersion(m, doc) {
  return Number.isInteger(m.version) && m.version !== doc.version;
}

// 直前にプレビューから書き戻した文字の編集 { uri, from, to, count }。編集中に操作ボタンを押すと、
// 「確定（editCommit）→ スライド操作（slideOp）」が同じ版番号で続けて届く。文字の編集は枚数も並びも変えないので、
// その直後のスライド操作（index だけで決まるもの）に限り、1つ前の版のままでも受ける。
let lastTextEdit = null;
function noteTextEdit(doc, fromVersion, countBefore) {
  const count = slideStartLines(doc.getText()).length;
  lastTextEdit = (count === countBefore) ? { uri: doc.uri.toString(), from: fromVersion, to: doc.version, count } : null;
}
function staleForSlideOp(m, doc) {
  if (!staleVersion(m, doc)) return false;
  const e = lastTextEdit;
  return !(e && e.uri === doc.uri.toString() && m.version === e.from && doc.version === e.to
    && slideStartLines(doc.getText()).length === e.count);
}

async function handlePreviewEdit(m) {
  const doc = panelDoc();
  if (!doc) { postEditResult(false, '原稿が開かれていません'); return; }
  if (m.type === 'undo' || m.type === 'redo') return handleUndoRedo(doc, m.type);
  // プレビューが送る index や行番号は「表示している描画」のもの。原稿が先に変わっていたら別のスライドに当たるので、全部ここで断る
  const indexOnly = m.type === 'slideOp' || m.type === 'libraryInsert' || m.type === 'corpusInsert' || m.type === 'layoutApply';
  if (indexOnly ? staleForSlideOp(m, doc) : staleVersion(m, doc)) {
    // 文字の編集（editCommit）は捨てない：プレビュー側が保留し、描き直しのあとで同じ文字のノードへ入れ直す（retry）。それ以外は断る
    postEditResult(false, REASON_TEXT.stale, m.type === 'editCommit' ? { retry: true } : undefined);
    return;
  }
  if (m.type === 'slideOp') return runSlideOp(doc, m.op, m.index);
  if (m.type === 'libraryInsert') {
    if (!library) { postEditResult(false, 'ライブラリの部品を読み込めませんでした'); return; }
    const ed = await ensureEditor(doc);
    renderImmediate = isPanelDoc(doc);
    const ok = await library.insert(ed, m.id, m.index);
    renderImmediate = false;
    if (ok) afterSlideChange(doc, ed, m.index + 1);
    return;
  }
  if (m.type === 'corpusInsert') {
    if (!corpusSvc) { postEditResult(false, 'スライド検索の部品を読み込めませんでした'); return; }
    const r = await corpusSvc.insert(doc, m);
    postEditResult(!!r.ok, r.message);
    return;
  }
  if (m.type === 'layoutApply') return applyLayout(doc, m.index, m.cls == null ? null : String(m.cls));
  if (m.type === 'editCommit') return handleEditCommit(doc, m);
  if (m.type === 'boxCommit') return handleBoxCommit(doc, m);
  if (m.type === 'bulletDelete') return handleBulletDelete(doc, m);
  if (m.type === 'tuneSelect') return handleTuneSelect(doc, m);
}

/** プレビューで直した文字を原稿へ書き戻す。位置が一意に確定しなければ何も書かず、該当行へ案内する */
async function handleEditCommit(doc, m) {
  if (Number.isInteger(m.index) && isPanelDoc(doc)) forceSlides.add(m.index);   // 表示には打った文字が残っている。次の描画でこの 1 枚は必ず差し替える
  if (!sourceMap) { postEditResult(false, '直接編集の部品を読み込めませんでした'); return; }
  const text = doc.getText();
  const starts = slideStartLines(text);
  if (starts[m.index] === undefined) { postEditResult(false, REASON_DEFAULT); return; }
  const range = lineRangeForSlide(starts, m.index, doc.lineCount);
  const nodes = Array.isArray(m.nodes) ? m.nodes : [];
  const edits = [];
  let expect = null;
  for (const c of (Array.isArray(m.changes) ? m.changes : [])) {
    const plan = (m.emptyTarget && c.k == null)
      ? sourceMap.planEmptyFill(text, range, { line: m.line, lineEnd: m.lineEnd }, c.now)
      : sourceMap.planTextEdit(text, range, nodes, c);
    if (!plan || !plan.ok) {   // 1件でも確定できなければ全体を書かない（半端に書くと表示と原稿が食い違う）
      postEditResult(false, (plan && REASON_TEXT[plan.reason]) || REASON_DEFAULT);
      await guideToLine(doc, plan && plan.line != null ? plan.line : m.line);
      return;
    }
    for (const e of (plan.edits && plan.edits.length ? plan.edits : (plan.edit ? [plan.edit] : []))) edits.push(e);
    if (!expect && Number.isInteger(c.k) && String(c.now || '').trim()) {
      // Alt+Enter の <br> が入ると、描き直した後は <br> の前までがノード k になる。検算はその前半と比べる（前半が空なら検算しない）
      const head = String(c.now).split(sourceMap.BR_MARK || '\uE000')[0];
      if (head.trim()) expect = { index: m.index, k: c.k, text: head };
    }
  }
  // ノードを空にする変更が混じると、描き直した後のノード番号が前へずれる。比べる相手が決まらないので検算しない
  if ((m.changes || []).some(c => c && Number.isInteger(c.k) && !String(c.now || '').trim())) expect = null;
  let finalText = applyEditsChecked(text, edits);
  if (finalText == null) { postEditResult(false, REASON_DEFAULT); return; }

  // Shift+Enter：確定して、すぐ下に同じ記号の箇条書きを作り、その編集を始める。
  // 文字の編集は1行の中で完結する（改行は断っている）ので、行番号は編集後も同じ。
  let newLine = null, bulletNote = null;
  if (m.then === 'newBullet') {
    const r = (slideOps && Number.isInteger(m.line)) ? slideOps.addBulletAfter(finalText, m.line, m.lineEnd) : null;
    if (r && r.ok) {
      const t2 = applyEditsChecked(finalText, r.edits);
      if (t2 != null) { finalText = t2; newLine = r.newLine; }
    } else bulletNote = (r && r.reason) || 'ここには箇条書きを足せません';
  }
  if (finalText === text) {
    // 原稿に書くものが無い（前後の空白だけ変えた等）。再描画が来ないので、表示を原稿どおりに描き直して打った空白を残さない
    if (bulletNote) postEditResult(false, bulletNote);
    else { clearTimeout(renderTimer); doRender(doc); }
    return;
  }

  pendingExpect = expect ? Object.assign({ minVersion: doc.version + 1 }, expect) : null;
  pendingStartEdit = newLine != null ? { line: newLine, minVersion: doc.version + 1 } : null;
  const v0 = doc.version;
  const ok = await replaceMinimal(doc, text, finalText);
  if (!ok) { pendingExpect = null; pendingStartEdit = null; postEditResult(false, REASON_TEXT.stale); return; }
  noteTextEdit(doc, v0, starts.length);
  if (bulletNote) postEditResult(true, '文字は反映しました。' + bulletNote);
}

/** 箱の編集で書けなかった理由（lib/style-edit.cjs の reason）→ プレビューに出す文言 */
const BOX_REASON_TEXT = {
  'mdimg-move': 'Markdown の画像は大きさだけ変えられます（動かすには <img> で書いてください）',
  'mdimg-ref': '参照形式の画像です。原稿の該当行で直してください',
  // トリミング（DESIGN 9.6）：Markdown の画像を <p><img> に書き換えられないとき。プレビュー側（boxedit.js）も先に断る
  'mdimg-inline': '文と同じ段落にある Markdown の画像はトリミングできません（画像だけの段落にしてください）',
  'mdimg-keywords': 'フィルタ（sepia など）の付いた Markdown の画像はトリミングできません。原稿で <img> に書き換えてください',
  'quote': 'style の値に引用符が混じっています。原稿の該当行で直してください',
};
const BOX_REASON_DEFAULT = 'この箱は原稿の位置を確定できませんでした。原稿の該当行で直してください（原稿は変えていません）';

/** Alt で動かした・大きさを変えた・切った箱を、原稿の style 属性（Markdown の画像は alt の w: / h:。
 *  トリミングは <p><img style> に書き換えてから）へ書き戻す（DESIGN 9章） */
async function handleBoxCommit(doc, m) {
  if (Number.isInteger(m.index) && isPanelDoc(doc)) forceSlides.add(m.index);   // 表示には動かした後の style が残っている。次の描画でこの 1 枚は必ず差し替える
  if (!styleEdit) { postEditResult(false, '箱の編集の部品を読み込めませんでした'); return; }
  const text = doc.getText();
  const starts = slideStartLines(text);
  if (starts[m.index] === undefined || !m.target || typeof m.target !== 'object') { postEditResult(false, BOX_REASON_DEFAULT); return; }
  const range = lineRangeForSlide(starts, m.index, doc.lineCount);
  // Markdown の画像は「その行の段落の n 番目」で決まる。プレビューの src は Webview 用の URI なので、
  // 検算にはファイル名だけを使う（原稿の src の末尾と合わなければ書かない）
  const target = m.target.kind === 'mdimg'
    ? { kind: 'mdimg', line: m.target.line, nth: m.target.nth, src: m.target.basename || m.target.src }
    : m.target;
  const plan = styleEdit.planStyleEdit(text, range, target, m.style || {});
  if (!plan || !plan.ok) {
    postEditResult(false, (plan && BOX_REASON_TEXT[plan.reason]) || BOX_REASON_DEFAULT);
    if (plan && plan.reason !== 'mdimg-move') await guideToLine(doc, plan.line);
    return;
  }
  const finalText = applyEditsChecked(text, plan.edits || []);
  if (finalText == null) { postEditResult(false, BOX_REASON_DEFAULT); return; }
  if (finalText === text) { clearTimeout(renderTimer); doRender(doc); return; }   // 書くものが無い。表示を原稿どおりに戻す
  // 箱の編集はスライドの枚数も並びも変えない（開始タグの style か画像の alt、トリミングでは画像の段落を <p><img> に）。変わるなら書かない
  if (slideStartLines(finalText).length !== starts.length) { postEditResult(false, BOX_REASON_DEFAULT); return; }
  const v0 = doc.version;
  if (!(await replaceMinimal(doc, text, finalText))) { postEditResult(false, REASON_TEXT.stale); return; }
  noteTextEdit(doc, v0, starts.length);
}

/** 空の箇条書きで Backspace → その項目を消す */
async function handleBulletDelete(doc, m) {
  if (!slideOps) { postEditResult(false, 'スライド操作の部品を読み込めませんでした'); return; }
  const text = doc.getText();
  const r = slideOps.removeBullet(text, m.line, m.lineEnd);
  if (!r.ok) { postEditResult(false, r.reason || 'この項目は消せません'); return; }
  const next = applyEditsChecked(text, r.edits);
  if (next == null || !(await replaceMinimal(doc, text, next))) postEditResult(false, REASON_TEXT.stale);
}

/** プレビューで選択した文字を、原稿側でも選択する。以後は既存のサイズ/色（tune）の経路がそのまま使える */
async function handleTuneSelect(doc, m) {
  if (!sourceMap) return;
  // 写せない選択のときは、原稿側に残っている古い選択（単クリックの行全体など）へ色が付かないよう、選択を畳んでおく
  const giveUp = (message) => {
    const ed0 = panelEditor();
    if (ed0) { ed0.selection = new vscode.Selection(ed0.selection.start, ed0.selection.start); postTuneState(ed0); }
    postEditResult(false, message);
  };
  if (m.unsupported) { giveUp(m.message || 'この選択には色やサイズを付けられません'); return; }
  const text = doc.getText();
  const starts = slideStartLines(text);
  if (starts[m.index] === undefined) return;
  const r = sourceMap.planRangeSelect(text, lineRangeForSlide(starts, m.index, doc.lineCount),
    Array.isArray(m.nodes) ? m.nodes : [], { k: m.k, start: m.start, k2: m.k2, end: m.end });
  if (!r || !r.ok) {
    giveUp('この選択は原稿の位置を確定できません。原稿側で文字を選んでからサイズ/色を変えてください');
    return;
  }
  const ed = await ensureEditor(doc);
  if (typeof m.px === 'number' && m.px > 0) lastClickedPx = Math.round(m.px);
  const range = new vscode.Range(r.line, r.startCol, r.line, r.endCol);
  ed.selection = new vscode.Selection(range.start, range.end);
  ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  postTuneState(ed);
}

/** プレビューにフォーカスがあると Cmd+Z が原稿に届かないので、原稿側で undo / redo してフォーカスを戻す */
async function handleUndoRedo(doc, cmd) {
  const ed = await ensureEditor(doc);
  await vscode.window.showTextDocument(doc, { viewColumn: ed.viewColumn, preserveFocus: false });
  renderImmediate = isPanelDoc(doc);
  await vscode.commands.executeCommand(cmd);
  renderImmediate = false;
  await saveAfterWrite(doc);                                // 戻した後の原稿もディスクと揃えておく
  if (panel) panel.reveal(panel.viewColumn, false);
}

/** スライドの枚数や並びが変わった後：カーソル・プレビュー・折りたたみを新しい位置へ */
function afterSlideChange(doc, ed, index, line) {
  const starts = slideStartLines(doc.getText());
  const idx = Math.max(0, Math.min(starts.length - 1, Number.isInteger(line) ? slideIndexForLine(starts, line) : index));
  const ln = Number.isInteger(line) ? Math.min(line, doc.lineCount - 1) : starts[idx];
  const pos = new vscode.Position(ln, 0);
  ed.selection = new vscode.Selection(pos, pos);
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
  lastScrollIndex = -1;          // 同じ番号でも中身が変わっているので、必ずプレビューを合わせ直す
  updateStatus(ed);
  followFold(ed, idx);
}

/** スライド操作（新規・複製・移動・削除・印・ライブラリ）。プレビューのボタンとコマンドの両方から呼ぶ */
async function runSlideOp(doc, op, index) {
  const viaPanel = !!(panel && panelDocUri === doc.uri.toString());
  const say = (ok, msg) => { if (viaPanel) postEditResult(ok, msg); else if (!ok) vscode.window.showWarningMessage(msg); };
  const ed = await ensureEditor(doc);
  if (!Number.isInteger(index)) index = slideIndexForLine(slideStartLines(doc.getText()), ed.selection.active.line);

  if (op === 'mark' || op === 'library') {
    if (op === 'library' && !library && corpusSvc && viaPanel) { corpusSvc.openPopup(index, { full: true }); return; }
    if (!library) { say(false, 'ライブラリの部品を読み込めませんでした'); return; }
    if (op === 'library') {
      // 📚：検索つきの全面ギャラリー（7.3）。検索の部品が無ければ、従来の ★ ギャラリー
      if (corpusSvc && viaPanel) { corpusSvc.openPopup(index, { full: true }); return; }
      await library.openGallery(ed, index); return;
    }
    renderImmediate = isPanelDoc(doc);         // 印を付けたらすぐ ★ を点ける
    await library.toggleMark(ed, index);
    renderImmediate = false;
    if (folding) folding.refresh(ed);
    return;
  }
  if (!slideOps) { say(false, 'スライド操作の部品を読み込めませんでした'); return; }

  const text = doc.getText();
  let r;
  if (op === 'new') {
    const items = slideOps.newSlideTemplates().map(t => ({ label: t.label, description: t.description, tpl: t }));
    const pick = await vscode.window.showQuickPick(items, { placeHolder: `スライド ${index + 1} の次に入れる型を選ぶ` });
    if (!pick) return;
    r = slideOps.insertSlideAfter(text, index, pick.tpl.text);
  } else if (op === 'duplicate') r = slideOps.duplicateSlide(text, index);
  else if (op === 'moveUp') r = slideOps.moveSlide(text, index, -1);
  else if (op === 'moveDown') r = slideOps.moveSlide(text, index, +1);
  else if (op === 'delete') {
    const yes = await vscode.window.showWarningMessage(`スライド ${index + 1} を削除しますか？`, { modal: true, detail: 'Cmd+Z（Ctrl+Z）で戻せます。' }, '削除');
    if (yes !== '削除') return;
    r = slideOps.deleteSlide(text, index);
  } else return;

  if (!r || !r.ok) {
    say(false, (r && r.reason) || 'この操作はできません');
    if (r && Number.isInteger(r.revealLine)) await guideToLine(doc, r.revealLine);
    return;
  }
  const next = applyEditsChecked(text, r.edits);
  if (next == null || !(await replaceMinimal(doc, text, next))) { say(false, REASON_TEXT.stale); return; }
  afterSlideChange(doc, ed, index, r.revealLine);
}

/** 配置案（8.3）：_class の lay-* を差し替える。cls＝null で外す。1 操作＝1 WorkspaceEdit */
async function applyLayout(doc, index, cls) {
  const viaPanel = isPanelDoc(doc);
  const say = (ok, msg) => { if (viaPanel) postEditResult(ok, msg); else if (!ok) vscode.window.showWarningMessage(msg); };
  if (!layoutVariants) { say(false, '配置案の部品を読み込めませんでした'); return false; }
  if (!Number.isInteger(index)) { say(false, 'どのスライドか分かりません'); return false; }
  if (cls != null && !/^lay-[a-z0-9-]+$/.test(cls)) { say(false, '配置の名前が正しくありません: ' + cls); return false; }
  const text = doc.getText();
  let r;
  try { r = layoutVariants.planSetLayout(text, index, cls); }
  catch (e) { say(false, '配置を変えられません: ' + String(e && e.message || e)); return false; }
  if (!r || !r.ok) {
    say(false, (r && r.reason) || 'この配置にはできません');
    if (r && Number.isInteger(r.revealLine)) await guideToLine(doc, r.revealLine);
    return false;
  }
  if (!r.edits || !r.edits.length) { say(true, 'すでにその配置です'); return true; }
  const next = applyEditsChecked(text, r.edits);
  if (next == null || slideStartLines(next).length !== slideStartLines(text).length || !(await replaceMinimal(doc, text, next))) { say(false, REASON_TEXT.stale); return false; }
  return true;
}

/** コマンド「スライドの配置を変える…」：カーソルのあるスライドに合う配置を一覧から選ぶ（サムネイルで見比べるのはプレビューの右クリック） */
async function cmdChangeLayout() {
  const ed = activeMarpEditor() || panelEditor();
  if (!ed) { vscode.window.showInformationMessage('Marp (marp: true) の markdown を開いてから実行してください。'); return; }
  if (!layoutVariants) { vscode.window.showWarningMessage('配置案の部品を読み込めませんでした'); return; }
  const doc = ed.document;
  const index = slideIndexForLine(slideStartLines(doc.getText()), ed.selection.active.line);
  let variants = [];
  try {
    const deck = splitDeck(doc.getText());
    const sl = deck.slides[index];
    const body = sl ? deck.lines.slice(sl.startLine, sl.endLine).join('\n') : '';
    variants = layoutVariants.variantsFor(layoutVariants.analyzeSlide(body));
  } catch (_) { variants = []; }
  if (!variants.length) { vscode.window.showInformationMessage('このスライドは div などで組んであるので、配置案を出せません（素の見出し・箇条書き・図のスライドが対象です）'); return; }
  const pick = await vscode.window.showQuickPick(
    variants.map(v => ({ label: (v.current ? '$(check) ' : '') + v.label, description: v.cls || '標準', detail: v.why + (v.fits === false ? '（いまの内容には合いません）' : ''), v })),
    { placeHolder: `スライド ${index + 1} の配置を選ぶ` });
  if (!pick) return;
  editChain = editChain.then(() => applyLayout(doc, index, pick.v.cls)).catch((e) => console.error('[marp-scroll-sync] changeLayout: ' + (e && e.stack || e)));
}

/** コマンド「既存のスライドを検索して挿入…」：プレビューの ＋ポップアップを、カーソルのあるスライドの次に開く */
function cmdSearchSlides(context) {
  return async () => {
    if (!corpusSvc) { vscode.window.showWarningMessage('スライド検索の部品を読み込めませんでした'); return; }
    const ed = activeMarpEditor();
    if (!panel || (ed && !isPanelDoc(ed.document))) {
      if (!ed) { vscode.window.showInformationMessage('Marp (marp: true) の markdown を開いてから実行してください。'); return; }
      openPreview(context);
    }
    const target = panelEditor();
    const index = target ? slideIndexForLine(slideStartLines(target.document.getText()), target.selection.active.line) : undefined;
    try { panel.reveal(undefined, false); } catch (_) { /* 表示は飾り */ }
    corpusSvc.openPopup(index, { full: false });
  };
}

function cmdRebuildCorpus() {
  if (!corpusSvc) { vscode.window.showWarningMessage('スライド検索の部品を読み込めませんでした'); return; }
  const ed = activeMarpEditor() || panelEditor();
  const doc = ed ? ed.document : panelDoc();
  if (!doc) { vscode.window.showInformationMessage('Marp (marp: true) の markdown を開いてから実行してください。'); return; }
  try {
    const r = corpusSvc.rebuild(doc);
    vscode.window.showInformationMessage(`スライドの索引を作り直しました（${r.entries} 枚）。` + (r.running ? '変更履歴の集計は裏で続けています。' : ''));
  } catch (e) { vscode.window.showWarningMessage('索引を作り直せませんでした: ' + String(e && e.message || e)); }
}

/** コマンドパレット／キーボードからのスライド操作（アクティブな Marp 原稿の、カーソルのあるスライドが対象） */
function cmdSlideOp(op) {
  return () => {
    const ed = activeMarpEditor();
    if (!ed) { vscode.window.showInformationMessage('Marp (marp: true) の markdown を開いてから実行してください。'); return; }
    editChain = editChain.then(() => runSlideOp(ed.document, op, undefined)).catch((e) => console.error('[marp-scroll-sync] ' + op + ': ' + (e && e.stack || e)));
  };
}

/** 逆引きで当てた行を一時的に色付けして見つけやすくする（選択ハイライトに加えての強調） */
function flashReveal(editor, range) {
  if (!revealDeco) return;
  clearTimeout(revealDecoTimer);
  editor.setDecorations(revealDeco, [range]);
  revealDecoTimer = setTimeout(() => {
    try { editor.setDecorations(revealDeco, []); } catch (_) { /* エディタが閉じた等 */ }
  }, 2500);
}

function doRender(doc, forceFull) {
  slideStarts = slideStartLines(doc.getText());
  const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === panelDocUri);
  const idx = ed ? slideIndexForLine(slideStarts, ed.selection.active.line) : 0;
  renderUpdate(doc, idx, forceFull);
}

function scheduleReRender() {
  if (!panel || !panelDocUri) return;
  const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === panelDocUri);
  if (!doc) return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => doRender(doc), RENDER_DEBOUNCE_MS);
}

// ===== サイズ/色 微調整（tune） =====

function panelEditor() {
  return vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === panelDocUri)
    || (isMarpDoc(vscode.window.activeTextEditor && vscode.window.activeTextEditor.document) ? vscode.window.activeTextEditor : null);
}

function activeMarpEditor() {
  const a = vscode.window.activeTextEditor;
  if (a && isMarpDoc(a.document)) return a;
  return panelEditor();
}

function clampPx(n) { return Math.max(6, Math.min(200, Math.round(n))); }

function buildTuneStyle({ fontPx, color }) {
  const parts = [];
  if (fontPx != null) parts.push('font-size:' + fontPx + 'px !important');
  if (color) parts.push('color:' + color + ' !important');
  return parts.join('; ');
}

/** 行テキスト内で [s,e) を内側に含む ss-tune span を返す（なければ null） */
function findEnclosingTuneSpan(lineText, s, e) {
  const re = new RegExp('<span class="' + TUNE_CLASS + '"([^>]*)>([\\s\\S]*?)<\\/span>', 'g');
  let m;
  while ((m = re.exec(lineText))) {
    const open = m[0].slice(0, m[0].indexOf('>') + 1);
    const innerStart = m.index + open.length;
    const inner = m[2];
    const innerEnd = innerStart + inner.length;
    const tagEnd = m.index + m[0].length;
    if (s >= innerStart && e <= innerEnd) {
      const attrs = m[1] || '';
      const sm = attrs.match(/style\s*=\s*"([^"]*)"/i);
      const style = sm ? sm[1] : '';
      const fm = style.match(/font-size\s*:\s*([\d.]+)px/i);
      const cm = style.match(/color\s*:\s*([^;"]+)/i);
      return {
        tagStart: m.index, tagEnd, inner, innerStart, innerEnd,
        fontPx: fm ? Math.round(parseFloat(fm[1])) : null,
        color: cm ? cm[1].replace(/!important/i, '').trim() : null,
      };
    }
  }
  return null;
}

/** 行頭のブロック記号(- * + / # / 1. / >)と前後の空白を除き、装飾対象の本文範囲に詰める */
function trimToContent(lineText, s, e) {
  while (s < e && /\s/.test(lineText[s])) s++;
  if (lineText.slice(0, s).trim() === '') { // 選択が行頭から始まっている → マーカーを除く
    const mk = lineText.slice(s).match(/^(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+)/);
    if (mk) s += mk[0].length;
  }
  while (e > s && /\s/.test(lineText[e - 1])) e--;
  return [s, e];
}

const EMPH_TAG = { '**': 'b', '__': 'b', '*': 'i', '_': 'i', '~~': 's' };
/** 行の中の強調記号（* _ ~ の並び）を、同じ並びどうしで内側から対にする（CommonMark の近似） */
function emphasisPairs(lineText) {
  const runs = []; const re = /[*_~]+/g; let m;
  while ((m = re.exec(lineText))) runs.push({ s: m.index, e: m.index + m[0].length, run: m[0] });
  const stack = [], pairs = [];
  for (const r of runs) {
    const top = stack[stack.length - 1];
    if (top && top.run === r.run) { stack.pop(); pairs.push({ open: top, close: r, run: r.run }); } else stack.push(r);
  }
  return pairs;
}
/**
 * 強調の記号の内側に span を入れると、記号の隣が < > になって強調が外れる（CommonMark の flanking。「前**太字**後」のように
 * 日本語が隣だと必ず外れる＝実測。「- **見出し**：」のように記号の外が空白・句読点なら外れない）。
 * 記号ちょうどの内側を選んだときは記号ごと包む（<span>**太字**</span>）。強調の途中（記号に片側だけ接する）は、
 * その対の記号を <b>/<i>/<s> に替えてから選んだ所だけ包む。戻り値 { line, s, e }（line は記号を替えたときだけ変わる）
 */
function fitEmphasis(lineText, s, e) {
  for (const p of emphasisPairs(lineText)) {
    const atOpen = p.open.e === s, atClose = p.close.s === e;
    if (atOpen && atClose) return { line: lineText, s: p.open.s, e: p.close.e };
    if ((atOpen && e <= p.close.s) || (atClose && s >= p.open.e)) {
      const tag = EMPH_TAG[p.run];
      if (!tag) break;   // *** など混ざった並びは触らない（従来どおり包む）
      const line = lineText.slice(0, p.open.s) + '<' + tag + '>' + lineText.slice(p.open.e, p.close.s) + '</' + tag + '>' + lineText.slice(p.close.e);
      const d = tag.length + 2 - p.run.length;
      return { line, s: s + d, e: e + d };
    }
  }
  return { line: lineText, s, e };
}

/** 選択範囲に font-size/color を適用（連打が競合しないよう直列化） */
function applyTune(editor, opts) {
  tuneChain = tuneChain.then(() => applyTuneInner(editor, opts)).catch(() => {});
  return tuneChain;
}

async function applyTuneInner(editor, opts) {
  if (!editor) return;
  const sel = editor.selection;
  if (sel.start.line !== sel.end.line) {
    vscode.window.showInformationMessage('サイズ/色は 1 行内で選択した文字に適用できます。');
    return;
  }
  const lineNo = sel.start.line;
  const lineText = editor.document.lineAt(lineNo).text;
  let sCol = sel.start.character, eCol = sel.end.character;
  if (sCol === eCol) { // 空選択 → カーソル位置の単語に広げる
    // プレビューのツールバーから：選択が無い（写せなかった・畳んだ）ときに、カーソルの単語や行末へ空の span を書かない
    if (opts.fromPreview) { postEditResult(false, 'プレビューで文字を選んでから色やサイズを変えてください'); return; }
    const wr = editor.document.getWordRangeAtPosition(sel.start);
    if (wr) { sCol = wr.start.character; eCol = wr.end.character; }
    else { vscode.window.showInformationMessage('変更したい文字を選択してください。'); return; }
  }

  const span = findEnclosingTuneSpan(lineText, sCol, eCol);
  let editStart, editEnd, newText, reInner;

  if (span) { // 既存 span を更新（数値/色だけ書き換え、入れ子にしない）
    let fontPx = span.fontPx, color = span.color;
    if (opts.clear) { fontPx = null; color = null; }
    if (opts.dPx != null) {
      const base = (span.fontPx != null ? span.fontPx : (lastClickedPx != null ? lastClickedPx : DEFAULT_PX));
      fontPx = clampPx(base + opts.dPx);
    }
    if (opts.color !== undefined) color = opts.color || null;
    const style = buildTuneStyle({ fontPx, color });
    editStart = span.tagStart; editEnd = span.tagEnd;
    if (!style) { // 完全リセット → span を外して中身だけに
      newText = span.inner;
      reInner = [editStart, editStart + span.inner.length];
    } else {
      const open = '<span class="' + TUNE_CLASS + '" style="' + style + '">';
      newText = open + span.inner + '</span>';
      reInner = [editStart + open.length, editStart + open.length + span.inner.length];
    }
  } else { // 新規に span で包む
    if (opts.clear) { vscode.window.showInformationMessage('この箇所にはサイズ/色は設定されていません。'); return; }
    [sCol, eCol] = trimToContent(lineText, sCol, eCol);
    if (sCol >= eCol) { vscode.window.showInformationMessage('装飾できる文字がありません。'); return; }
    const fit = fitEmphasis(lineText, sCol, eCol);
    sCol = fit.s; eCol = fit.e;
    const inner = fit.line.slice(sCol, eCol);
    let fontPx = null, color = null;
    if (opts.dPx != null) fontPx = clampPx((lastClickedPx != null ? lastClickedPx : DEFAULT_PX) + opts.dPx);
    if (opts.color !== undefined && opts.color) color = opts.color;
    const style = buildTuneStyle({ fontPx, color });
    if (!style) return;
    const open = '<span class="' + TUNE_CLASS + '" style="' + style + '">';
    if (fit.line !== lineText) {   // 強調の記号を <b> などに替えた：行ごと書き換える
      editStart = 0; editEnd = lineText.length;
      newText = fit.line.slice(0, sCol) + open + inner + '</span>' + fit.line.slice(eCol);
    } else {
      newText = open + inner + '</span>';
      editStart = sCol; editEnd = eCol;
    }
    reInner = [sCol + open.length, sCol + open.length + inner.length];
  }

  const we = new vscode.WorkspaceEdit();
  we.replace(editor.document.uri, new vscode.Range(lineNo, editStart, lineNo, editEnd), newText);
  renderImmediate = true; // この編集は即時反映
  const ok = await vscode.workspace.applyEdit(we);
  if (!ok) { renderImmediate = false; return; }
  await saveAfterWrite(editor.document);
  // 包んだ中身を選び直して、連続で ±1px や色変更ができるようにする
  editor.selection = new vscode.Selection(lineNo, reInner[0], lineNo, reInner[1]);
  postTuneState(editor);
}

/** 現在の選択に応じてツールバーの表示(px/色/活性)を更新する */
function postTuneState(editor) {
  if (!panel) return;
  let size = null, color = null, active = false;
  if (editor && isMarpDoc(editor.document) && editor.document.uri.toString() === panelDocUri) {
    const sel = editor.selection;
    if (sel.start.line === sel.end.line) {
      const lineText = editor.document.lineAt(sel.start.line).text;
      let sCol = sel.start.character, eCol = sel.end.character;
      if (sCol === eCol) {
        const wr = editor.document.getWordRangeAtPosition(sel.start);
        if (wr) { sCol = wr.start.character; eCol = wr.end.character; }
      }
      active = eCol > sCol;
      const span = findEnclosingTuneSpan(lineText, sCol, eCol);
      if (span) { size = span.fontPx != null ? span.fontPx : (lastClickedPx != null ? lastClickedPx : DEFAULT_PX); color = span.color; }
      else size = lastClickedPx != null ? lastClickedPx : DEFAULT_PX;
    }
  }
  panel.webview.postMessage({ type: 'tuneState', size, color, active });
}

async function pickColor() {
  const presets = [
    { label: '$(circle-filled) 赤（テーマ）', value: '#A6192E' },
    { label: '$(circle-filled) 濃赤', value: '#7d1322' },
    { label: '$(circle-filled) 青', value: '#1f6fb2' },
    { label: '$(circle-filled) 緑', value: '#2e7d32' },
    { label: '$(circle-filled) 橙', value: '#e07b00' },
    { label: '$(circle-filled) 黒（標準）', value: '#1a1a1a' },
    { label: '$(paintcan) カスタム (hex)…', value: '__custom__' },
    { label: '$(clear-all) 色を消す', value: '__none__' },
  ];
  const pick = await vscode.window.showQuickPick(presets, { placeHolder: '文字色を選ぶ' });
  if (!pick) return undefined;
  if (pick.value === '__none__') return null;
  if (pick.value === '__custom__') {
    const v = await vscode.window.showInputBox({ prompt: '色 (例 #c8102e / rgb(200,16,46))', value: '#' });
    if (v == null) return undefined;
    return v.trim() || undefined;
  }
  return pick.value;
}

function cmdInc() { applyTune(activeMarpEditor(), { dPx: +1 }); }
function cmdDec() { applyTune(activeMarpEditor(), { dPx: -1 }); }
async function cmdColor() {
  const ed = activeMarpEditor();
  if (!ed) { vscode.window.showInformationMessage('Marp の Markdown で文字を選択してください。'); return; }
  const c = await pickColor();
  if (c !== undefined) applyTune(ed, { color: c });
}
function cmdClear() { applyTune(activeMarpEditor(), { clear: true }); }

/** marp-cli(--html)でプレゼン用HTMLを生成し、現在のスライドからブラウザで開く */
async function present() {
  // 対象 md と現在ページ(1-based)を解決：アクティブが Marp md ならそれ、なければプレビュー対象
  let doc = null, page = 1;
  const active = vscode.window.activeTextEditor;
  if (active && isMarpDoc(active.document)) {
    doc = active.document;
    page = slideIndexForLine(slideStartLines(doc.getText()), active.selection.active.line) + 1;
  } else if (panelDocUri) {
    doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === panelDocUri);
    if (doc) {
      const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === panelDocUri);
      page = (ed ? slideIndexForLine(slideStartLines(doc.getText()), ed.selection.active.line) : 0) + 1;
    }
  }
  if (!doc) {
    vscode.window.showInformationMessage('marp: true の markdown を開いてから実行してください。');
    return;
  }
  await doc.save(); // marp-cli はディスクから読むので未保存分を反映

  const mdPath = doc.uri.fsPath;
  const repoRoot = repoRootFor(doc);
  if (!fs.existsSync(PRESENT_SCRIPT)) {
    vscode.window.showErrorMessage('tools/marp-present/present.mjs が見つかりません（marp-GUI の tools/ ごと置いてください）。');
    return;
  }
  // 描画→ブラウザ起動は tools/marp-present/present.mjs に任せる（theme/*.css を全部渡し、Chrome の場所を OS ごとに自動検出）。
  // シェルを通さず、引数の配列で渡す：原稿のパスに $( ) や ` や % があっても展開されない（docs/security-review.md SEC-02）。
  // 拡張ホストの execPath は Electron。ELECTRON_RUN_AS_NODE=1 で node として動く（素の node では無視される）。
  // node.exe を直接起動するので、Windows の .cmd（npx など）を経由しない
  const args = [PRESENT_SCRIPT, mdPath, '--page', String(page)];
  if (!presentOut) presentOut = vscode.window.createOutputChannel('Marp Present');
  if (presentOut.clear) presentOut.clear();
  presentOut.appendLine('$ node ' + args.map(a => JSON.stringify(a)).join(' '));
  let child;
  try {
    child = cp.spawn(process.execPath, args, {
      cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
    });
  } catch (e) {
    presentOut.appendLine('[起動できません] ' + (e && e.message || e));
    vscode.window.showErrorMessage('Marp: プレゼンを起動できませんでした（出力「Marp Present」を見てください）。');
    return;
  }
  const onData = (b) => presentOut.append(String(b));
  if (child.stdout) child.stdout.on('data', onData);
  if (child.stderr) child.stderr.on('data', onData);
  child.on('error', (e) => {
    presentOut.appendLine('[起動できません] ' + (e && e.message || e));
    if (presentOut.show) presentOut.show(true);
    vscode.window.showErrorMessage('Marp: プレゼンを起動できませんでした（出力「Marp Present」を見てください）。');
  });
  child.on('close', (code) => {
    if (code === 0) return;
    if (presentOut.show) presentOut.show(true);
    vscode.window.showErrorMessage('Marp: プレゼンの描画に失敗しました（exit=' + code + '。出力「Marp Present」を見てください）。');
  });
}

function gotoSlide() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMarpDoc(editor.document)) return;
  const starts = slideStartLines(editor.document.getText());
  vscode.window.showInputBox({ prompt: `スライド番号 (1-${starts.length})`, validateInput: v => {
    const n = Number(v); return (Number.isInteger(n) && n >= 1 && n <= starts.length) ? null : '範囲外です';
  }}).then(v => {
    if (v == null) return;
    const ln = starts[Number(v) - 1];
    const pos = new vscode.Position(ln, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
  });
}

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
  statusItem.command = 'marpScrollSync.openPreview';
  context.subscriptions.push(statusItem);

  revealDeco = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255,214,0,0.38)',         // 黄色ハイライト
    border: '1px solid rgba(245,180,0,0.9)',
    borderRadius: '2px',
    isWholeLine: true,                                // 行全体を着色して見つけやすく
    overviewRulerColor: 'rgba(245,180,0,0.95)',
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });
  context.subscriptions.push(revealDeco);

  // 追加機能の登録。どれかが失敗しても同期プレビュー本体は動かす
  if (foldingVs) {
    try { folding = foldingVs.register(context, { isMarpDoc, saveAfterWrite }); }
    catch (e) { console.error('[marp-scroll-sync] folding: ' + (e && e.stack || e)); }
  }
  if (corpusVs) {
    try {
      corpusSvc = corpusVs.register(context, {
        isMarpDoc, repoRootFor, renderForThumb, replaceMinimal, afterSlideChange, ensureEditor, panelDoc,
        postToPreview: (msg) => { if (panel) panel.webview.postMessage(msg); },
      });
    } catch (e) { console.error('[marp-scroll-sync] corpus: ' + (e && e.stack || e)); }
  }
  if (homeVs) {
    try {
      homeSvc = homeVs.register(context, {
        isMarpDoc, repoRootFor, repoRoots,
        corpusFor: (root) => (corpusSvc && typeof corpusSvc.corpusFor === 'function' ? corpusSvc.corpusFor(root) : null),
        shelfFor: (root) => (corpusSvc && typeof corpusSvc.shelfFor === 'function' ? corpusSvc.shelfFor(root) : null),
        renderThumb: (webview, mdAbs, text) => renderForThumb(mdAbs, text, webview),
        openPreview: () => openPreview(context),
        rebuildCorpus: () => { try { cmdRebuildCorpus(); } catch (_) { /* 任意 */ } },
        nonce: SCRIPT_NONCE, mediaDir: path.join(__dirname, 'media'),
      });
    } catch (e) { console.error('[marp-scroll-sync] home: ' + (e && e.stack || e)); }
  }
  if (libraryVs) {
    try {
      library = libraryVs.register(context, {
        isMarpDoc,
        repoRootFor,
        saveAfterWrite,
        postToPreview: (msg) => { if (panel) panel.webview.postMessage(msg); },
        webviewUriFor: (abs) => (panel ? panel.webview.asWebviewUri(vscode.Uri.file(abs)).toString() : null),
      });
    } catch (e) { console.error('[marp-scroll-sync] library: ' + (e && e.stack || e)); }
  }

  // ホーム：いつでも押せる入口（原稿を開いていなくても）
  homeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 201);
  homeItem.text = '$(home) Marp';
  homeItem.tooltip = 'Marp ホーム：最近開いたデック・棚・手を入れた順・検索（⌘K H / Ctrl+K H）';
  homeItem.command = 'marpScrollSync.home';
  homeItem.show();
  context.subscriptions.push(homeItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('marpScrollSync.home', (args) => {
      if (!homeSvc) { vscode.window.showWarningMessage('ホーム画面の部品を読み込めませんでした'); return; }
      homeSvc.open(args && typeof args === 'object' ? args : undefined);
    }),
    vscode.commands.registerCommand('marpScrollSync.newSlide', cmdSlideOp('new')),
    vscode.commands.registerCommand('marpScrollSync.duplicateSlide', cmdSlideOp('duplicate')),
    vscode.commands.registerCommand('marpScrollSync.moveSlideUp', cmdSlideOp('moveUp')),
    vscode.commands.registerCommand('marpScrollSync.moveSlideDown', cmdSlideOp('moveDown')),
    vscode.commands.registerCommand('marpScrollSync.deleteSlide', cmdSlideOp('delete')),
    vscode.commands.registerCommand('marpScrollSync.searchSlides', cmdSearchSlides(context)),
    vscode.commands.registerCommand('marpScrollSync.rebuildCorpus', cmdRebuildCorpus),
    vscode.commands.registerCommand('marpScrollSync.changeLayout', cmdChangeLayout),
    vscode.commands.registerCommand('marpScrollSync.openPreview', () => openPreview(context)),
    vscode.commands.registerCommand('marpScrollSync.present', () => present()),
    vscode.commands.registerCommand('marpScrollSync.gotoSlide', gotoSlide),
    vscode.commands.registerCommand('marpScrollSync.incFont', cmdInc),
    vscode.commands.registerCommand('marpScrollSync.decFont', cmdDec),
    vscode.commands.registerCommand('marpScrollSync.setColor', cmdColor),
    vscode.commands.registerCommand('marpScrollSync.clearTune', cmdClear),
    vscode.window.onDidChangeTextEditorSelection(e => updateStatus(e.textEditor)),
    vscode.window.onDidChangeActiveTextEditor(ed => updateStatus(ed)),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (panelDocUri && e.document.uri.toString() === panelDocUri) {
        if (renderImmediate) { renderImmediate = false; clearTimeout(renderTimer); doRender(e.document); }
        else scheduleReRender();
      }
    })
  );
  updateStatus(vscode.window.activeTextEditor);
  if (homeSvc) setTimeout(() => { try { homeSvc.maybeOpenOnStartup(); } catch (_) { /* 起動時のホームは任意 */ } }, 600);
}

function deactivate() {}

module.exports = { activate, deactivate };
