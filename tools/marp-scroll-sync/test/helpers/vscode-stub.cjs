// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 'vscode' モジュールの最小スタブ（node --test 用）。folding-vscode / library-vscode のテストで共用する。
// require('vscode') は VS Code の拡張ホストの中でしか解決できないので、Module._load を差し替えて
// この偽物を返す。目的は「register() が例外なく走る」「登録した provider / コマンドを呼べる」ことの確認で、
// VS Code の挙動の再現ではない（折りたたみの実際の効き方などは実機でしか確かめられない）。
//
// 使い方：
//   const stub = require('./helpers/vscode-stub.cjs');   // 読み込んだ時点で差し替わる
//   stub.reset();                                          // テストごとに状態を捨てる
//   const doc = stub.makeDocument(text, { fsPath: '/x/deck.md' });
//   const ed  = stub.makeEditor(doc, { active: true });
//   const mod = require('../lib/folding-vscode.cjs');      // ここで require('vscode') がスタブに当たる
//   mod.register(stub.makeContext(), { isMarpDoc });
//   stub.state.foldingProviders[0].provider.provideFoldingRanges(doc)
//   await stub.vscode.commands.executeCommand('marpScrollSync.foldOtherSlides')
//   stub.state.executed  … 実行されたコマンドの記録 [{ command, args }]
//   stub.fire.selection({ textEditor: ed, selections: [ed.selection], kind: 1 })
// 足りない API は、既存のものを壊さずにここへ足す。
'use strict';

const Module = require('module');
const path = require('path');

// --- 値クラス -------------------------------------------------------------

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isEqual(o) { return o && o.line === this.line && o.character === this.character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isAfter(o) { return o.isBefore(this); }
  translate(dl = 0, dc = 0) { return new Position(this.line + dl, this.character + dc); }
  with(line = this.line, character = this.character) { return new Position(line, character); }
}
class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position || (a && typeof a === 'object')) { this.start = a; this.end = b; }
    else { this.start = new Position(a, b); this.end = new Position(c, d); }
    if (this.end.isBefore(this.start)) { const t = this.start; this.start = this.end; this.end = t; }
  }
  get isEmpty() { return this.start.isEqual(this.end); }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(p) { const q = p.start ? p.start : p; return !q.isBefore(this.start) && !q.isAfter(this.end); }
}
class Selection extends Range {
  constructor(a, b, c, d) {
    super(a, b, c, d);
    if (a instanceof Position || (a && typeof a === 'object')) { this.anchor = a; this.active = b; }
    else { this.anchor = new Position(a, b); this.active = new Position(c, d); }
  }
}
class Uri {
  constructor(scheme, fsPath) { this.scheme = scheme; this.fsPath = fsPath; this.path = fsPath; }
  static file(p) { return new Uri('file', p); }
  static parse(s) { return new Uri(String(s).split(':')[0], String(s).replace(/^[a-z-]+:\/\//, '')); }
  static joinPath(base, ...segs) { return new Uri(base.scheme, path.join(base.fsPath, ...segs)); }
  toString() { return this.scheme + '://' + this.fsPath; }
  with(o) { const u = new Uri(o.scheme || this.scheme, o.path || this.fsPath); return u; }
}
class ThemeColor { constructor(id) { this.id = id; } }
class ThemeIcon { constructor(id) { this.id = id; } }
class FoldingRange { constructor(start, end, kind) { this.start = start; this.end = end; this.kind = kind; } }
class Diagnostic {
  constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; }
}
class MarkdownString { constructor(v = '') { this.value = v; } appendMarkdown(s) { this.value += s; return this; } }
class Disposable { constructor(fn) { this._fn = fn; } dispose() { if (this._fn) { this._fn(); this._fn = null; } } }
class EventEmitter {
  constructor() { this._ls = new Set(); this.event = (fn, thisArg, subs) => { const f = thisArg ? fn.bind(thisArg) : fn; this._ls.add(f); const d = new Disposable(() => this._ls.delete(f)); if (Array.isArray(subs)) subs.push(d); return d; }; }
  fire(v) { for (const f of Array.from(this._ls)) f(v); }
  dispose() { this._ls.clear(); }
}
class WorkspaceEdit {
  constructor() { this.ops = []; }
  replace(uri, range, text) { this.ops.push({ kind: 'replace', uri, range, text }); }
  insert(uri, pos, text) { this.ops.push({ kind: 'replace', uri, range: new Range(pos, pos), text }); }
  delete(uri, range) { this.ops.push({ kind: 'replace', uri, range, text: '' }); }
  createFile(uri, o) { this.ops.push({ kind: 'createFile', uri, options: o }); }
  get size() { return this.ops.length; }
}
class DocumentPasteEdit { constructor(insertText, title, kind) { this.insertText = insertText; this.title = title; this.kind = kind; } }
class DocumentDropOrPasteEditKind {
  constructor(value) { this.value = value; }
  append(...p) { return new DocumentDropOrPasteEditKind([this.value, ...p].filter(Boolean).join('.')); }
}
DocumentDropOrPasteEditKind.Empty = new DocumentDropOrPasteEditKind('');
DocumentDropOrPasteEditKind.Text = new DocumentDropOrPasteEditKind('text');

// 貼り付け適応（library-vscode）用。本物と同じく MIME → item の対応だけを持つ
class DataTransferItem { constructor(value) { this.value = value; } async asString() { return typeof this.value === 'string' ? this.value : JSON.stringify(this.value); } asFile() { return undefined; } }
class DataTransfer {
  constructor() { this._m = new Map(); }
  get(mime) { return this._m.get(String(mime).toLowerCase()); }
  set(mime, item) { this._m.set(String(mime).toLowerCase(), item); }
  forEach(fn, thisArg) { for (const [k, v] of this._m) fn.call(thisArg, v, k, this); }
  [Symbol.iterator]() { return this._m[Symbol.iterator](); }
}

// --- 文書・エディタ -------------------------------------------------------

/** 偽の TextDocument。setText で中身を差し替えると version が上がる */
function makeDocument(text, opts = {}) {
  const doc = {
    uri: Uri.file(opts.fsPath || '/tmp/deck.md'),
    languageId: opts.languageId || 'markdown',
    version: 1,
    isClosed: false,
    _text: String(text),
    get fileName() { return this.uri.fsPath; },
    get lineCount() { return this._lines().length; },
    _lines() { if (!this._cache || this._cacheV !== this.version) { this._cache = this._text.split(/\r?\n/); this._cacheV = this.version; } return this._cache; },
    getText(range) {
      if (!range) return this._text;
      return this._text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
    },
    lineAt(n) {
      const line = typeof n === 'number' ? n : n.line;
      const t = this._lines()[line] || '';
      return { lineNumber: line, text: t, range: new Range(line, 0, line, t.length), isEmptyOrWhitespace: t.trim() === '', firstNonWhitespaceCharacterIndex: t.length - t.trimStart().length };
    },
    offsetAt(pos) {
      const re = /\r?\n/g; let off = 0, line = 0, m;
      while (line < pos.line && (m = re.exec(this._text))) { off = m.index + m[0].length; line++; }
      if (line < pos.line) return this._text.length;
      const nl = this._text.slice(off).search(/\r?\n/);
      const len = nl < 0 ? this._text.length - off : nl;
      return off + Math.min(pos.character, len);
    },
    positionAt(offset) {
      const o = Math.max(0, Math.min(offset, this._text.length));
      const re = /\r?\n/g; let line = 0, lineStart = 0, m;
      while ((m = re.exec(this._text)) && m.index + m[0].length <= o) { line++; lineStart = m.index + m[0].length; }
      return new Position(line, o - lineStart);
    },
    getWordRangeAtPosition(pos) {
      const t = this.lineAt(pos.line).text; let a = pos.character, b = pos.character;
      while (a > 0 && /\w/.test(t[a - 1])) a--;
      while (b < t.length && /\w/.test(t[b])) b++;
      return b > a ? new Range(pos.line, a, pos.line, b) : undefined;
    },
    setText(t) { this._text = String(t); this.version++; },
  };
  state.documents.push(doc);
  return doc;
}

/** 偽の TextEditor。opts.active なら window.activeTextEditor にもする */
function makeEditor(doc, opts = {}) {
  const ed = {
    document: doc,
    viewColumn: opts.viewColumn || 1,
    selections: [new Selection(opts.line || 0, 0, opts.line || 0, 0)],
    get selection() { return this.selections[0]; },
    set selection(s) { this.selections = [s]; },
    visibleRanges: [new Range(0, 0, Math.min(doc.lineCount - 1, 40), 0)],
    decorations: new Map(),   // decorationType → 最後に setDecorations された配列
    revealed: [],
    setDecorations(type, ranges) { this.decorations.set(type, ranges); },
    revealRange(r, t) { this.revealed.push({ range: r, type: t }); },
    async edit(cb) {
      const ops = [];
      cb({ replace: (r, t) => ops.push({ range: r, text: t }), insert: (p, t) => ops.push({ range: new Range(p, p), text: t }), delete: (r) => ops.push({ range: r, text: '' }) });
      applyOps(doc, ops);
      return true;
    },
  };
  state.editors.push(ed);
  if (opts.active) vscode.window.activeTextEditor = ed;
  return ed;
}

/** 編集を後ろから適用する（重なりは無い前提） */
function applyOps(doc, ops) {
  const sorted = ops.map(o => ({ s: doc.offsetAt(o.range.start), e: doc.offsetAt(o.range.end), text: o.text })).sort((a, b) => b.s - a.s);
  let t = doc._text;
  for (const o of sorted) t = t.slice(0, o.s) + o.text + t.slice(o.e);
  doc.setText(t);
}

function makeContext(extensionPath) {
  const root = extensionPath || path.resolve(__dirname, '..', '..');
  const mem = new Map();
  const memento = { get: (k, d) => (mem.has(k) ? mem.get(k) : d), update: async (k, v) => { mem.set(k, v); }, keys: () => Array.from(mem.keys()) };
  return { subscriptions: [], extensionPath: root, extensionUri: Uri.file(root), globalState: memento, workspaceState: memento, asAbsolutePath: (p) => path.join(root, p) };
}

// --- 状態と記録 -----------------------------------------------------------

const state = {
  documents: [], editors: [],
  commands: new Map(),          // 登録されたコマンド id → 関数
  executed: [],                 // executeCommand の記録 { command, args }
  foldingProviders: [],         // { selector, provider }
  pasteProviders: [],           // { selector, provider, metadata }
  codeActionProviders: [],
  decorationTypes: [],          // createTextEditorDecorationType に渡された options
  diagnostics: new Map(),       // コレクション名 → Map(uri文字列 → Diagnostic[])
  statusItems: [],
  messages: [],                 // showInformationMessage など { level, message }
  config: {},                   // 'marpScrollSync.autoFold' → 値（テストから直接書く）
  configUpdates: [],            // update() の記録
  appliedEdits: [],             // workspace.applyEdit に渡された WorkspaceEdit
  quickPickAnswer: undefined, inputBoxAnswer: undefined, messageAnswer: undefined,
};

const emitters = {
  selection: new EventEmitter(), activeEditor: new EventEmitter(), visibleEditors: new EventEmitter(),
  visibleRanges: new EventEmitter(), changeDoc: new EventEmitter(), openDoc: new EventEmitter(),
  closeDoc: new EventEmitter(), saveDoc: new EventEmitter(), config: new EventEmitter(),
};

function makeStatusItem() {
  const it = { text: '', tooltip: '', command: undefined, visible: false, show() { this.visible = true; }, hide() { this.visible = false; }, dispose() { this.visible = false; } };
  state.statusItems.push(it);
  return it;
}

function makeDiagnosticCollection(name) {
  const map = new Map();
  state.diagnostics.set(name || 'default', map);
  return {
    name, set: (uri, list) => { map.set(uri.toString(), list || []); }, delete: (uri) => { map.delete(uri.toString()); },
    get: (uri) => map.get(uri.toString()), clear: () => map.clear(), dispose: () => map.clear(),
  };
}

function getConfiguration(section) {
  const key = (k) => (section ? section + '.' + k : k);
  return {
    get: (k, d) => (Object.prototype.hasOwnProperty.call(state.config, key(k)) ? state.config[key(k)] : d),
    has: (k) => Object.prototype.hasOwnProperty.call(state.config, key(k)),
    inspect: (k) => ({ key: key(k), globalValue: state.config[key(k)] }),
    update: async (k, v, target) => {
      state.config[key(k)] = v; state.configUpdates.push({ key: key(k), value: v, target });
      emitters.config.fire({ affectsConfiguration: (s) => key(k) === s || key(k).startsWith(s + '.') });
    },
  };
}

const vscode = {
  Position, Range, Selection, Uri, ThemeColor, ThemeIcon, FoldingRange, Diagnostic, MarkdownString, Disposable,
  EventEmitter, WorkspaceEdit, DocumentPasteEdit, DocumentDropOrPasteEditKind,
  DataTransfer, DataTransferItem,
  FoldingRangeKind: { Comment: 1, Imports: 2, Region: 3 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  DecorationRangeBehavior: { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
  QuickPickItemKind: { Separator: -1, Default: 0 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  CodeActionKind: { QuickFix: { value: 'quickfix' }, Empty: { value: '' } },
  window: {
    activeTextEditor: undefined,
    get visibleTextEditors() { return state.editors.slice(); },
    createTextEditorDecorationType(options) { const t = { options, disposed: false, dispose() { this.disposed = true; } }; state.decorationTypes.push(t); return t; },
    createStatusBarItem() { return makeStatusItem(); },
    // 統合ターミナル。送られたコマンドは state.terminals[n].sent に残る（実行はしない）
    createTerminal(options) { const t = { options, name: options && options.name, sent: [], shown: false, show() { this.shown = true; }, sendText(x) { this.sent.push(x); }, dispose() {} }; (state.terminals = state.terminals || []).push(t); return t; },
    createOutputChannel() { return { appendLine() {}, append() {}, show() {}, dispose() {} }; },
    showInformationMessage: async (message) => { state.messages.push({ level: 'info', message }); return state.messageAnswer; },
    showWarningMessage: async (message) => { state.messages.push({ level: 'warn', message }); return state.messageAnswer; },
    showErrorMessage: async (message) => { state.messages.push({ level: 'error', message }); return state.messageAnswer; },
    showQuickPick: async (items) => (typeof state.quickPickAnswer === 'function' ? state.quickPickAnswer(await items) : state.quickPickAnswer),
    showInputBox: async (o) => (typeof state.inputBoxAnswer === 'function' ? state.inputBoxAnswer(o) : state.inputBoxAnswer),
    showTextDocument: async (doc) => state.editors.find(e => e.document === doc) || makeEditor(doc, { active: true }),
    withProgress: async (_o, task) => task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => new Disposable() }),
    setStatusBarMessage: () => new Disposable(),
    onDidChangeTextEditorSelection: emitters.selection.event,
    onDidChangeActiveTextEditor: emitters.activeEditor.event,
    onDidChangeVisibleTextEditors: emitters.visibleEditors.event,
    onDidChangeTextEditorVisibleRanges: emitters.visibleRanges.event,
  },
  workspace: {
    get textDocuments() { return state.documents.slice(); },
    workspaceFolders: undefined,
    getConfiguration,
    getWorkspaceFolder: () => undefined,
    asRelativePath: (p) => (typeof p === 'string' ? p : p.fsPath),
    openTextDocument: async (u) => state.documents.find(d => d.uri.fsPath === (u.fsPath || u)) || makeDocument(require('fs').readFileSync(u.fsPath || u, 'utf8'), { fsPath: u.fsPath || u }),
    applyEdit: async (we) => {
      state.appliedEdits.push(we);
      const byDoc = new Map();
      for (const op of we.ops) if (op.kind === 'replace') { const k = op.uri.toString(); if (!byDoc.has(k)) byDoc.set(k, []); byDoc.get(k).push(op); }
      for (const [k, ops] of byDoc) { const doc = state.documents.find(d => d.uri.toString() === k); if (doc) applyOps(doc, ops); }
      return true;
    },
    onDidChangeTextDocument: emitters.changeDoc.event,
    onDidOpenTextDocument: emitters.openDoc.event,
    onDidCloseTextDocument: emitters.closeDoc.event,
    onDidSaveTextDocument: emitters.saveDoc.event,
    onDidChangeConfiguration: emitters.config.event,
    fs: { stat: async (u) => require('fs').promises.stat(u.fsPath), readFile: async (u) => require('fs').promises.readFile(u.fsPath) },
  },
  commands: {
    registerCommand(id, fn) { state.commands.set(id, fn); return new Disposable(() => state.commands.delete(id)); },
    registerTextEditorCommand(id, fn) { state.commands.set(id, (...a) => fn(vscode.window.activeTextEditor, null, ...a)); return new Disposable(() => state.commands.delete(id)); },
    // 登録済みならそれを呼ぶ。editor.fold など VS Code 本体のコマンドは記録するだけ
    async executeCommand(command, ...args) {
      state.executed.push({ command, args });
      const fn = state.commands.get(command);
      return fn ? fn(...args) : undefined;
    },
    getCommands: async () => Array.from(state.commands.keys()),
  },
  languages: {
    registerFoldingRangeProvider(selector, provider) { const e = { selector, provider }; state.foldingProviders.push(e); return new Disposable(() => { state.foldingProviders = state.foldingProviders.filter(x => x !== e); }); },
    registerCodeActionsProvider(selector, provider, metadata) { state.codeActionProviders.push({ selector, provider, metadata }); return new Disposable(); },
    // 新しめの API。「無ければ黙って無効」の分岐を試すときは delete stub.vscode.languages.registerDocumentPasteEditProvider
    registerDocumentPasteEditProvider(selector, provider, metadata) { state.pasteProviders.push({ selector, provider, metadata }); return new Disposable(); },
    createDiagnosticCollection: makeDiagnosticCollection,
  },
  env: { clipboard: { _t: '', readText: async () => vscode.env.clipboard._t, writeText: async (t) => { vscode.env.clipboard._t = String(t); } }, openExternal: async () => true },
  extensions: { getExtension: () => undefined },
  version: '1.80.0-stub',
};

/** テストごとに呼ぶ：記録・登録・設定を捨てる（差し替え自体は残す） */
function reset() {
  state.documents = []; state.editors = []; state.commands = new Map(); state.executed = [];
  state.foldingProviders = []; state.pasteProviders = []; state.codeActionProviders = [];
  state.decorationTypes = []; state.diagnostics = new Map(); state.statusItems = []; state.messages = [];
  state.config = {}; state.configUpdates = []; state.appliedEdits = [];
  state.terminals = [];
  state.quickPickAnswer = undefined; state.inputBoxAnswer = undefined; state.messageAnswer = undefined;
  vscode.window.activeTextEditor = undefined;
  for (const e of Object.values(emitters)) e._ls.clear();
}

/** context.subscriptions を全部 dispose する（タイマーを持つモジュールの後始末用） */
function disposeContext(context) {
  for (const d of context.subscriptions.splice(0)) { try { d && d.dispose && d.dispose(); } catch (_) { /* 後始末の失敗は無視 */ } }
}

// --- 差し替え -------------------------------------------------------------
// 1回だけ。すでに別のテストが差し替えていても、同じスタブを返す（require キャッシュで同一モジュール）。
if (!Module._load.__ssVscodeStub) {
  const orig = Module._load;
  const patched = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return orig.call(this, request, parent, isMain);
  };
  patched.__ssVscodeStub = true;
  Module._load = patched;
}

const fire = {
  selection: (e) => emitters.selection.fire(e),
  activeEditor: (ed) => { vscode.window.activeTextEditor = ed; emitters.activeEditor.fire(ed); },
  visibleEditors: () => emitters.visibleEditors.fire(state.editors.slice()),
  visibleRanges: (e) => emitters.visibleRanges.fire(e),
  changeDoc: (doc, contentChanges = []) => emitters.changeDoc.fire({ document: doc, contentChanges }),
  openDoc: (doc) => emitters.openDoc.fire(doc),
  closeDoc: (doc) => { doc.isClosed = true; emitters.closeDoc.fire(doc); },
  saveDoc: (doc) => emitters.saveDoc.fire(doc),
  config: (keys) => emitters.config.fire({ affectsConfiguration: (s) => [].concat(keys).some(k => k === s || k.startsWith(s + '.')) }),
};

module.exports = { vscode, state, fire, reset, makeDocument, makeEditor, makeContext, disposeContext };
