// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 通し試験（E2E）のハーネス。
//   仮想の VS Code（vscode-stub.cjs）の上で本物の extension.js を activate し、
//   本物の buildHtml が作った HTML を手元の Chrome（puppeteer-core）に読み込み、両者を実際につなぐ。
//     拡張 → Webview：webview.html の setter でページを読み込み直す／webview.postMessage は window.postMessage で届ける
//     Webview → 拡張：acquireVsCodeApi().postMessage を page.exposeFunction 経由で onDidReceiveMessage のハンドラへ渡す
//   原稿（TextDocument）は workspace.applyEdit で中身が変わり、version が上がり、onDidChangeTextDocument が発火する。
//   undo / redo は「applyEdit 1回＝1単位」の履歴で実装する（＝Cmd+Z 1回で戻る単位を数えられる）。
// vscode-stub.cjs 自体は書き換えない（folding / library の単体テストと共用）。足りない API はここで上から被せる。
// 実機の VS Code との違い（ここでは確かめられないこと）：フォーカスの移動、IME、折りたたみの実際の効き方、
// applyEdit 後の選択範囲の自動調整、Webview の本物の CSP（vscode-resource スキーム）。
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { pathToFileURL } = require('url');

const stub = require('./vscode-stub.cjs');
const PH = require('./preview-harness.cjs');
const { vscode, state } = stub;

const EXT_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(EXT_ROOT, '..', '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- 試験用のリポジトリ（scratchpad などに作る。slides/ の原本は読むだけ） ----------

function copyDir(from, to, filter) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, ent.name), b = path.join(to, ent.name);
    if (filter && !filter(a, ent)) continue;
    if (ent.isDirectory()) copyDir(a, b, filter);
    else if (ent.isFile()) fs.copyFileSync(a, b);
  }
}

/**
 * root に「theme/ ＋ slides/assets ＋ 指定デック（md と src/ だけ）」のコピーを作る。毎回作り直す。
 * decks: ['sample-lecture', …]。戻り値 { root, md: { [deck]: mdの絶対パス } }
 */
function makeRepo(root, decks) {
  const abs = path.resolve(root);
  if (abs === REPO_ROOT || abs.startsWith(REPO_ROOT + path.sep) || REPO_ROOT.startsWith(abs + path.sep) || abs.split(path.sep).length < 4) {
    throw new Error('試験用リポジトリはリポジトリの外（scratchpad / 一時フォルダ）に作る: ' + root);
  }
  fs.rmSync(root, { recursive: true, force: true });
  copyDir(path.join(REPO_ROOT, 'theme'), path.join(root, 'theme'));
  const assets = path.join(REPO_ROOT, 'slides', 'assets');
  if (fs.existsSync(assets)) copyDir(assets, path.join(root, 'slides', 'assets'), (p, ent) => ent.isDirectory() || /\.(png|jpe?g|svg|gif|webp)$/i.test(p));
  const md = {};
  for (const d of decks) {
    const from = path.join(REPO_ROOT, 'slides', d), to = path.join(root, 'slides', d);
    fs.mkdirSync(to, { recursive: true });
    fs.copyFileSync(path.join(from, d + '.md'), path.join(to, d + '.md'));
    if (fs.existsSync(path.join(from, 'src'))) copyDir(path.join(from, 'src'), path.join(to, 'src'), (p, ent) => ent.isDirectory() || /\.(png|jpe?g|svg|gif|webp)$/i.test(p));
    md[d] = path.join(to, d + '.md');
  }
  return { root, md };
}

// ---------- 仮想 VS Code の補強（履歴つきの原稿・選択イベント・Webview） ----------

const history = new Map();   // doc → { undo:[{before,after}], redo:[…] }
function hist(doc) { if (!history.has(doc)) history.set(doc, { undo: [], redo: [] }); return history.get(doc); }

/** 原稿を差し替え、version を上げ、onDidChangeTextDocument を発火する */
function setDocText(doc, text, reason) {
  doc.setText(text);
  stub.fire.changeDoc(doc, [{ reason }]);
}

function applyWorkspaceEdit(we) {
  state.appliedEdits.push(we);
  const byDoc = new Map();
  for (const op of we.ops) if (op.kind === 'replace') { const k = op.uri.toString(); if (!byDoc.has(k)) byDoc.set(k, []); byDoc.get(k).push(op); }
  for (const [k, ops] of byDoc) {
    const doc = state.documents.find(d => d.uri.toString() === k);
    if (!doc) return false;
    const before = doc.getText();
    const sorted = ops.map(o => ({ s: doc.offsetAt(o.range.start), e: doc.offsetAt(o.range.end), text: o.text })).sort((a, b) => b.s - a.s);
    let t = before;
    for (const o of sorted) t = t.slice(0, o.s) + o.text + t.slice(o.e);
    if (t === before) continue;
    const h = hist(doc); h.undo.push({ before, after: t }); h.redo.length = 0;
    setDocText(doc, t, 'edit');
  }
  return true;
}

/** 試験から「利用者が原稿を打った」を再現する（1回＝undo 1単位） */
function typeInDoc(doc, newText) {
  const before = doc.getText();
  if (before === newText) return;
  const h = hist(doc); h.undo.push({ before, after: newText }); h.redo.length = 0;
  setDocText(doc, newText, 'type');
}

function undoRedo(cmd) {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return false;
  const doc = ed.document, h = hist(doc);
  const step = cmd === 'undo' ? h.undo.pop() : h.redo.pop();
  if (!step) return false;
  (cmd === 'undo' ? h.redo : h.undo).push(step);
  setDocText(doc, cmd === 'undo' ? step.before : step.after, cmd);
  return true;
}

function openDocument(fsPath) {
  const doc = stub.makeDocument(fs.readFileSync(fsPath, 'utf8'), { fsPath });
  doc.getWordRangeAtPosition = function (pos) {
    const t = this.lineAt(pos.line).text;
    const isW = (c) => !!c && /[^\s`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?]/.test(c);
    let s = pos.character, e = pos.character;
    while (s > 0 && isW(t[s - 1])) s--;
    while (e < t.length && isW(t[e])) e++;
    return e > s ? new vscode.Range(pos.line, s, pos.line, e) : undefined;
  };
  doc.save = async function () { fs.writeFileSync(fsPath, this.getText()); return true; };
  doc.isDirty = false;
  return doc;
}

/** 選択を代入すると onDidChangeTextEditorSelection が（非同期に）発火するエディタ */
function openEditor(doc, opts) {
  const ed = stub.makeEditor(doc, Object.assign({ active: true }, opts || {}));
  let sels = ed.selections;
  Object.defineProperty(ed, 'selections', {
    get() { return sels; },
    set(v) { sels = v; setImmediate(() => stub.fire.selection({ textEditor: ed, selections: sels, kind: vscode.TextEditorSelectionChangeKind.Command })); },
  });
  Object.defineProperty(ed, 'selection', { get() { return sels[0]; }, set(s) { this.selections = [s]; } });
  return ed;
}

// ---------- 本物の extension.js を読み込む ----------

function purgeExtensionCache() {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(EXT_ROOT + path.sep) && !k.includes(path.sep + 'node_modules' + path.sep) && !k.includes(path.sep + 'test' + path.sep)) delete require.cache[k];
  }
}

/** failRequire: 正規表現。当たった require を例外にする（故障注入）。戻り値は外す関数 */
function injectRequireFailure(re) {
  const orig = Module._load;
  const patched = function (request, parent, isMain) {
    if (re.test(String(request))) throw new Error('E2E 故障注入: ' + request + ' を読み込めない');
    return orig.call(this, request, parent, isMain);
  };
  patched.__ssVscodeStub = orig.__ssVscodeStub;
  Module._load = patched;
  return () => { Module._load = orig; };
}

/**
 * セッションを開く：仮想 VS Code を初期化 → 原稿を開く → extension.js を activate → openPreview → Chrome に読み込む。
 *   opts.browser   puppeteer の Browser（必須）
 *   opts.mdPath    開く原稿（試験用リポジトリの中）
 *   opts.line      カーソルの初期行
 *   opts.outDir    Webview の HTML を書き出す場所
 *   opts.failRequire  故障注入する require の正規表現
 */
async function openSession(opts) {
  stub.reset();
  history.clear();
  purgeExtensionCache();

  const toWebview = [];   // 拡張 → Webview の記録
  const toExt = [];       // Webview → 拡張 の記録
  const consoleErrors = [];
  const extErrors = [];   // 拡張側の console.error（[marp-scroll-sync] …）
  let recvHandlers = [];
  let queue = Promise.resolve();   // html の読み込みと postMessage を順番どおりに届ける
  let pending = 0;
  let loads = 0;

  const page = await opts.browser.newPage();
  await page.setViewport({ width: opts.width || 1100, height: opts.height || 800, deviceScaleFactor: 1 });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  await page.exposeFunction('__ssToExt', (json) => {
    const m = JSON.parse(json);
    toExt.push(m);
    for (const h of recvHandlers.slice()) { try { h(m); } catch (e) { extErrors.push('onDidReceiveMessage: ' + (e && e.stack || e)); } }
  });
  await page.evaluateOnNewDocument(() => {
    let acquired = 0;
    window.acquireVsCodeApi = function () {
      if (++acquired > 1) throw new Error('acquireVsCodeApi は1回しか呼べない');
      return { postMessage(m) { window.__ssToExt(JSON.stringify(m)); }, getState() {}, setState() {} };
    };
    // 本物の Webview はリンクを押してもページを移動しない（VS Code が外部ブラウザへ渡す）。試験でも移動させない
    document.addEventListener('click', (ev) => { const a = ev.target && ev.target.closest && ev.target.closest('a[href]'); if (a) ev.preventDefault(); });
  });

  const outDir = opts.outDir || path.join(path.dirname(opts.mdPath), '.e2e');
  fs.mkdirSync(outDir, { recursive: true });
  const htmlFile = path.join(outDir, 'webview-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.html');

  const enqueue = (fn) => { pending++; queue = queue.then(fn).catch(e => extErrors.push('webview: ' + (e && e.stack || e))).finally(() => { pending--; }); return queue; };

  let disposeHandlers = [];
  const webview = {
    cspSource: 'file:',
    options: null,
    _html: '',
    get html() { return this._html; },
    set html(v) {
      this._html = String(v);
      enqueue(async () => {
        loads++;
        fs.writeFileSync(htmlFile, webview._html);
        await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      });
    },
    asWebviewUri(uri) { return { toString: () => pathToFileURL(uri.fsPath).href, fsPath: uri.fsPath }; },
    postMessage(m) {
      const copy = JSON.parse(JSON.stringify(m));   // 本物と同じく、複製できる物だけが届く
      toWebview.push(copy);
      enqueue(() => page.evaluate((x) => { window.postMessage(x, '*'); return new Promise(r => setTimeout(r, 0)); }, copy));
      return Promise.resolve(true);
    },
    onDidReceiveMessage(fn, thisArg, subs) {
      const f = thisArg ? fn.bind(thisArg) : fn; recvHandlers.push(f);
      const d = new vscode.Disposable(() => { recvHandlers = recvHandlers.filter(x => x !== f); });
      if (Array.isArray(subs)) subs.push(d);
      return d;
    },
  };
  const panels = [];
  vscode.window.createWebviewPanel = (viewType, title, showOptions, options) => {
    webview.options = options;
    const panel = {
      viewType, title, webview, viewColumn: 2, visible: true, active: false, revealed: [],
      reveal(col, preserveFocus) { this.revealed.push({ col, preserveFocus }); },
      onDidDispose(fn, thisArg, subs) { disposeHandlers.push(fn); const d = new vscode.Disposable(() => {}); if (Array.isArray(subs)) subs.push(d); return d; },
      dispose() { for (const f of disposeHandlers.splice(0)) f(); },
    };
    panels.push(panel);
    return panel;
  };
  vscode.workspace.applyEdit = async (we) => applyWorkspaceEdit(we);
  const focus = [];   // showTextDocument の記録（フォーカスをどちらへ渡したか）
  vscode.window.showTextDocument = async (doc, o) => {
    let ed = state.editors.find(e => e.document === doc);
    if (!ed) ed = openEditor(doc);
    focus.push({ fsPath: doc.uri.fsPath, preserveFocus: !!(o && o.preserveFocus) });
    if (!(o && o.preserveFocus)) vscode.window.activeTextEditor = ed;
    return ed;
  };
  // 応答の差し込み：配列なら先頭から順に使う。関数ならそれを呼ぶ
  const answers = { quickPick: [], inputBox: [], message: [] };
  const asked = { quickPick: [], inputBox: [], message: [] };
  const next = (q, arg) => { const a = q.shift(); return typeof a === 'function' ? a(arg) : a; };
  vscode.window.showQuickPick = async (items, o) => { const list = await items; asked.quickPick.push({ items: list, options: o }); return next(answers.quickPick, list); };
  vscode.window.showInputBox = async (o) => {
    asked.inputBox.push(o);
    const v = next(answers.inputBox, o);
    if (v !== undefined && o && typeof o.validateInput === 'function') {
      const err = await o.validateInput(v);
      if (err) throw new Error('E2E: showInputBox の応答「' + v + '」が validateInput に弾かれた: ' + err);
    }
    return v;
  };
  for (const level of ['showInformationMessage', 'showWarningMessage', 'showErrorMessage']) {
    vscode.window[level] = async (message, ...rest) => {
      const items = rest.filter(x => typeof x === 'string');
      state.messages.push({ level: level.replace(/^show|Message$/g, '').toLowerCase(), message, items });
      asked.message.push({ level, message, items });
      return items.length ? next(answers.message, { message, items }) : undefined;
    };
  }
  const origExec = vscode.commands.executeCommand;
  vscode.commands.executeCommand = async function (command, ...args) {
    if (command === 'undo' || command === 'redo') { state.executed.push({ command, args }); return undoRedo(command); }
    return origExec.call(this, command, ...args);
  };

  // 拡張側の console.error を拾う（配線の例外は console.error に出る約束）
  const origConsoleError = console.error;
  console.error = (...a) => { extErrors.push(a.map(String).join(' ')); };

  const doc = openDocument(opts.mdPath);
  const editor = openEditor(doc, { line: opts.line || 0 });
  const context = stub.makeContext(EXT_ROOT);

  let unfail = null;
  if (opts.failRequire) unfail = injectRequireFailure(opts.failRequire);
  let ext, activateError = null;
  try {
    ext = require(path.join(EXT_ROOT, 'extension.js'));
    ext.activate(context);
  } catch (e) { activateError = e; }
  finally { if (unfail) unfail(); }

  const S = {
    page, doc, editor, context, webview, panels, toWebview, toExt, consoleErrors, extErrors, answers, asked, focus, state, vscode,
    activateError, htmlFile,
    get loads() { return loads; },
    typeInDoc: (t) => typeInDoc(doc, t),
    undoDepth: () => hist(doc).undo.length,
    async exec(command, ...args) { return vscode.commands.executeCommand(command, ...args); },
    /** 両方向のメッセージが ms の間来なくなり、Webview への配送も終わるまで待つ */
    async settle(ms) {
      ms = ms || 250;
      let last = -1, lastV = -1, quietSince = Date.now();
      for (let i = 0; i < 400; i++) {
        const n = toWebview.length + toExt.length;
        if (n !== last || pending > 0 || doc.version !== lastV) { last = n; lastV = doc.version; quietSince = Date.now(); }
        else if (Date.now() - quietSince >= ms) return;
        await sleep(25);
      }
      throw new Error('settle: 静かにならない');
    },
    async waitFor(fn, label, timeout) {
      const t0 = Date.now();
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() - t0 > (timeout || 5000)) throw new Error('waitFor 時間切れ: ' + (label || ''));
        await sleep(25);
      }
    },
    /** 記録の目印。以後に届いたメッセージだけを見る */
    mark() { return { w: toWebview.length, e: toExt.length, m: state.messages.length }; },
    sinceW(mk, type) { return toWebview.slice(mk.w).filter(m => !type || m.type === type); },
    sinceE(mk, type) { return toExt.slice(mk.e).filter(m => !type || m.type === type); },
    async close() {
      console.error = origConsoleError;
      try { for (const p of panels) p.dispose(); } catch (_) { /* 無視 */ }
      stub.disposeContext(context);
      try { await queue; } catch (_) { /* 無視 */ }
      try { await page.close(); } catch (_) { /* 無視 */ }
      try { fs.unlinkSync(htmlFile); } catch (_) { /* 無視 */ }
    },
  };
  if (!activateError && opts.open !== false) {
    await vscode.commands.executeCommand('marpScrollSync.openPreview');
    await S.settle(300);
  }
  return S;
}

// ---------- ページの中を見る・操作する ----------

/** スライド index の中で sub を含むテキストノードの画面上の点。occurrence は同じ語の何個目か（0 始まり） */
async function textPoint(page, index, sub, o) {
  o = o || {};
  const r = await page.evaluate((index, sub, occ, where, exact) => {
    const frame = document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[index];
    if (!frame) return null;
    const sec = frame.querySelector('section[data-marpit-advanced-background="content"]') || frame.querySelector('section');
    const all = window.ssCollectTextNodes(sec);
    const hits = []; all.forEach((n, k) => { if (exact ? n.t.trim() === sub : n.t.includes(sub)) hits.push(k); });
    const k = hits[occ];
    if (k == null) return null;
    const node = all[k].node;
    node.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' });
    const at = node.nodeValue.indexOf(sub);
    const rg = document.createRange(); rg.setStart(node, at); rg.setEnd(node, at + sub.length);
    const b = rg.getBoundingClientRect();
    const x = where === 'start' ? b.left + 1 : where === 'end' ? b.right - 1 : b.left + b.width / 2;
    return { k, x, y: b.top + b.height / 2, left: b.left, right: b.right, t: all[k].t, near: all[k].near, count: hits.length };
  }, index, sub, o.occurrence || 0, o.where || 'center', !!o.exact);
  if (!r) throw new Error(`「${sub}」がスライド ${index} に見つからない`);
  return r;
}
async function dbl(page, pt) { await page.mouse.click(pt.x, pt.y, { clickCount: 2, delay: 30 }); await sleep(80); }

/** 編集中の要素（contenteditable）の中で、sub の直後（'after'）か直前（'before'）へキャレットを置く */
function caretAt(page, sub, side) {
  return page.evaluate((sub, side) => {
    const el = document.querySelector('.ss-editing');
    if (!el) return false;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const at = n.nodeValue.indexOf(sub);
      if (at < 0) continue;
      const r = document.createRange(); r.setStart(n, side === 'before' ? at : at + sub.length); r.collapse(true);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); return true;
    }
    return false;
  }, sub, side || 'after');
}

const pageInfo = (page) => page.evaluate(() => {
  const ss = Array.from(document.querySelectorAll('div.marpit > svg[data-marpit-svg]'));
  const el = document.querySelector('.ss-editing');
  const input = document.querySelector('.ss-svg-input');
  const toast = document.querySelector('.ss-toast');
  return {
    slides: ss.length, current: ss.findIndex(s => s.classList.contains('current-slide')),
    badge: (document.querySelector('.ss-badge') || {}).textContent || '',
    stars: document.querySelectorAll('#ss-layer .ss-mark').length,
    markOn: !!document.querySelector('.ss-ops button[data-op="mark"].ss-on'),
    ops: Array.from(document.querySelectorAll('.ss-ops button')).map(b => b.getAttribute('data-op')),
    editingTag: el ? el.tagName.toLowerCase() : null, editingText: el ? el.textContent : null,
    svgInput: input ? input.value : null,
    toast: toast && toast.classList.contains('ss-show') ? toast.textContent : '', toastErr: !!(toast && toast.classList.contains('ss-show') && toast.classList.contains('ss-err')),
    galleryOpen: !!document.querySelector('.ss-gallery.ss-open'),
    galleryIds: Array.from(document.querySelectorAll('.ss-gal-card')).map(c => c.getAttribute('data-id')),
  };
});

/** スライド index の本文の文字（header/footer を除く。検算用） */
const slideText = (page, index) => page.evaluate((index) => {
  const frame = document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[index];
  const sec = frame && (frame.querySelector('section[data-marpit-advanced-background="content"]') || frame.querySelector('section'));
  return sec ? window.ssCollectTextNodes(sec).map(n => n.t).join('') : null;
}, index);

/** 行単位の差分（変わった行だけ）。[{ line, before, after }]。行数が変わったら前後の共通部分を除いた塊を返す */
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  let p = 0; while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let s = 0; while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
  return { start: p, removed: A.slice(p, A.length - s), added: B.slice(p, B.length - s) };
}

/** marp-core（素の設定＝marp-cli と同じ）で描画して、枚数と発表者ノートを返す */
function marpRender(md) {
  const { Marp } = require(path.join(EXT_ROOT, 'node_modules', '@marp-team', 'marp-core'));
  const marp = new Marp({ html: true });
  for (const n of fs.readdirSync(path.join(REPO_ROOT, 'theme')).filter(n => n.endsWith('.css')).sort((a, b) => (a === 'academic.css' ? -1 : b === 'academic.css' ? 1 : a.localeCompare(b)))) {
    try { marp.themeSet.add(fs.readFileSync(path.join(REPO_ROOT, 'theme', n), 'utf8')); } catch (_) { /* 任意 */ }
  }
  const r = marp.render(md);
  // <style scoped> の目印（data-marpit-scope-XXXX）は描画のたびに乱数で変わる。比較できるようにならす
  const norm = (x) => x.replace(/data-marpit-scope-[A-Za-z0-9_-]+/g, 'data-marpit-scope-X');
  r.html = norm(r.html); r.css = norm(r.css);
  return { html: r.html, css: r.css, comments: r.comments, slides: (r.html.match(/<svg[^>]*data-marpit-svg/g) || []).length };
}

module.exports = {
  EXT_ROOT, REPO_ROOT, stub, sleep, launch: PH.launch, findChrome: PH.findChrome,
  makeRepo, openSession, injectRequireFailure, purgeExtensionCache,
  textPoint, dbl, caretAt, pageInfo, slideText, lineDiff, marpRender,
};
