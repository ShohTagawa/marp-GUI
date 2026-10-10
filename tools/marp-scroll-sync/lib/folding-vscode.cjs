// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 折りたたみ・スライドラベル・パネルラベルの VS Code 側（DESIGN.md 4）。
// 計算は全部 lib/folding.cjs（純粋関数）。ここは provider・装飾・コマンドへの配線だけを持つ。
// 原稿には何も書かない（書くのは writePanelLabels コマンドを明示的に実行したときだけ）。
'use strict';

const vscode = require('vscode');
const F = require('./folding.cjs');
const { splitDeck } = require('./slide-split.cjs');

const SECTION = 'marpScrollSync';
const DECO_DEBOUNCE_MS = 300;   // テキスト変更 → ラベル・診断の更新
const FIRST_FOLD_DELAY_MS = 350; // 開いた直後は折りたたみ範囲がまだエディタに届いていない（届く前の fold は空振りする）
const FOLD_RETRY_MS = [500, 900]; // 空振りだったときの再試行（合計3回まで）
const EDIT_GRACE_MS = 150;      // 「編集に伴うカーソル移動」とみなす時間

/**
 * @param {vscode.ExtensionContext} context
 * @param {{ isMarpDoc(doc): boolean }} api  Marp の md かどうかの判定は拡張本体と同じ物を使う
 * @returns {{ onPreviewNavigate(editor, slideIndex): Promise<void>, refresh(editor): void }}
 */
function register(context, api) {
  // ここで例外を外へ出すと、拡張本体の activate ごと落ちて同期プレビューまで使えなくなる。
  // 折りたたみは「あれば便利」な機能なので、失敗したらこの機能だけ黙って無効にする。
  try { return registerImpl(context, api); } catch (e) {
    console.error('[marp-scroll-sync] folding: register に失敗（折りたたみ・ラベルだけ無効）', e);
    return { async onPreviewNavigate() {}, refresh() {} };
  }
}

function registerImpl(context, api) {
  const isMarp = (doc) => { try { return !!(doc && api && api.isMarpDoc(doc)); } catch (_) { return false; } };
  const subs = context.subscriptions;
  // イベントハンドラ・タイマー・コマンドの中の例外は、この機能の中で止める（他の機能を巻き込まない）
  const guard = (fn) => function guarded(...args) {
    try {
      const r = fn.apply(this, args);
      return r && typeof r.then === 'function' ? r.catch((e) => { console.error('[marp-scroll-sync] folding', e); }) : r;
    } catch (e) { console.error('[marp-scroll-sync] folding', e); return undefined; }
  };

  // ---- 設定 ---------------------------------------------------------------
  // package.json に設定が未登録だと config.update が失敗する。そのときはこのセッションの間だけ覚えておく。
  let autoFoldOverride = null;
  const cfg = () => vscode.workspace.getConfiguration(SECTION);
  const autoFoldOn = () => (autoFoldOverride !== null ? autoFoldOverride : cfg().get('autoFold', true) !== false);
  const foldKinds = () => {
    const v = cfg().get('autoFoldKinds', ['style', 'svg']);
    return Array.isArray(v) ? v.filter(k => k === 'style' || k === 'svg' || k === 'notes') : ['style', 'svg'];
  };

  // ---- 原稿の解析（doc.version ごとに1回） -----------------------------------
  const cache = new Map(); // uri → { version, ranges, heads, slideLabels, panelLabels, leaky }
  function analyze(doc) {
    const key = doc.uri.toString();
    const hit = cache.get(key);
    if (hit && hit.version === doc.version) return hit;
    const text = doc.getText();
    const a = { version: doc.version, text, ranges: F.foldingRanges(text), heads: F.slideHeads(text), _sl: null, _pl: null, _lk: null };
    cache.set(key, a);
    return a;
  }
  // ラベルと診断は装飾の更新時にしか要らないので遅延させる（カーソル移動のたびに計算しない）
  const slideLabelsOf = (a) => a._sl || (a._sl = F.slideLabels(a.text));
  const panelLabelsOf = (a) => a._pl || (a._pl = F.panelLabels(a.text));
  const leakyOf = (a) => a._lk || (a._lk = F.leakyLabelComments(a.text));

  // ---- 折りたたみ範囲 -----------------------------------------------------
  subs.push(vscode.languages.registerFoldingRangeProvider({ language: 'markdown' }, {
    provideFoldingRanges(doc) {
      if (!isMarp(doc)) return [];
      // kind は発表者ノートだけ Comment にする（「すべてのブロックコメントを折りたたむ」で畳める）。
      // Region を付けると「すべての領域を折りたたむ」でスライドが全部畳まれてしまうので、他は無指定。
      try {
        return analyze(doc).ranges.map(r => new vscode.FoldingRange(r.start, r.end, r.kind === 'notes' ? vscode.FoldingRangeKind.Comment : undefined));
      } catch (e) { console.error('[marp-scroll-sync] folding', e); return []; }
    },
  }));

  // ---- 装飾（スライドラベル・パネルラベル） --------------------------------------
  // 色は ThemeColor にして明暗どちらのテーマでも読めるようにする。文字は after（行末の後ろ）に出すので、
  // 原稿の文字・桁位置・選択範囲には一切影響しない。
  const slideDeco = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('editorLineNumber.activeForeground'), fontWeight: 'bold', margin: '0 0 0 1.5em' },
    rangeBehavior: vscode.DecorationRangeBehavior ? vscode.DecorationRangeBehavior.ClosedClosed : undefined,
  });
  const panelDeco = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), fontStyle: 'italic', margin: '0 0 0 1.5em' },
    rangeBehavior: vscode.DecorationRangeBehavior ? vscode.DecorationRangeBehavior.ClosedClosed : undefined,
  });
  subs.push(slideDeco, panelDeco);

  const diagnostics = vscode.languages.createDiagnosticCollection('marpScrollSync.labels');
  subs.push(diagnostics);

  const endOfLine = (doc, line) => {
    const n = Math.max(0, Math.min(line, doc.lineCount - 1));
    const len = doc.lineAt(n).text.length;
    return new vscode.Range(n, len, n, len);
  };
  const decoOptions = (doc, labels) => labels
    .filter(l => l.line < doc.lineCount)
    .map(l => ({ range: endOfLine(doc, l.line), renderOptions: { after: { contentText: l.text } } }));

  function updateDecorations(editor) {
    if (!editor) return;
    const doc = editor.document;
    if (!isMarp(doc)) {
      editor.setDecorations(slideDeco, []); editor.setDecorations(panelDeco, []);
      diagnostics.delete(doc.uri);
      return;
    }
    const a = analyze(doc);
    const c = cfg();
    editor.setDecorations(slideDeco, c.get('slideLabels', true) !== false ? decoOptions(doc, slideLabelsOf(a)) : []);
    editor.setDecorations(panelDeco, c.get('panelLabels', true) !== false ? decoOptions(doc, panelLabelsOf(a)) : []);
    diagnostics.set(doc.uri, leakyOf(a).filter(l => l.line < doc.lineCount).map(l => {
      const t = doc.lineAt(l.line).text;
      const from = t.length - t.trimStart().length;
      const d = new vscode.Diagnostic(
        new vscode.Range(l.line, from, l.line, Math.max(from, t.trimEnd().length)),
        /^#(?:end)?region\b/.test(l.text)
          ? `「${l.text}」は発表者ノートに入ります。折りたたみは Marp Scroll Sync が自動で行うので、#region は不要です。`
          : `このコメント「${l.text}」は発表者ノートに入ります。区画の目印にしたいときは、開始タグと同じ行の行末に書いてください（例：<div class="left"> <!-- 左パネル -->）。`,
        vscode.DiagnosticSeverity.Information);
      d.source = 'Marp Scroll Sync';
      return d;
    }));
  }
  const updateAllDecorations = () => { for (const ed of vscode.window.visibleTextEditors) updateDecorations(ed); };

  let decoTimer = null;
  function scheduleDecorations() {
    clearTimeout(decoTimer);
    decoTimer = setTimeout(guard(updateAllDecorations), DECO_DEBOUNCE_MS);
  }
  subs.push({ dispose: () => clearTimeout(decoTimer) });

  // ---- ステータスバー -----------------------------------------------------
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 199);
  status.command = 'marpScrollSync.toggleAutoFold';
  subs.push(status);
  function updateStatus() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !isMarp(ed.document)) { status.hide(); return; }
    const on = autoFoldOn();
    status.text = on ? '$(fold) 自動たたみ' : '$(unfold) 自動たたみ切';
    status.tooltip = on
      ? 'Marp: 編集中のスライド以外を自動で折りたたんでいます（クリックで切る）'
      : 'Marp: 自動折りたたみは切ってあります（クリックで入れる）';
    status.show();
  }

  // ---- 自動折りたたみ -----------------------------------------------------
  // fold / unfold コマンドは「アクティブなエディタ」にしか効かない。対象がアクティブでないとき
  // （プレビューにフォーカスがある間など）は畳む予定だけ覚えておき、次にアクティブになったときに実行する。
  // 開く方は VS Code 自身がやってくれる（畳んだ範囲の中へカーソルが入ると自動で開く）。
  const states = new Map(); // uri → { cur, initialized, pending:Set<slide>, deferred:Set<slide>, editedAt, timers:[] }
  const stateOf = (doc) => {
    const key = doc.uri.toString();
    if (!states.has(key)) states.set(key, { cur: 0, initialized: false, pending: new Set(), deferred: new Set(), editedAt: 0, timers: [] });
    return states.get(key);
  };
  const isActive = (editor) => !!editor && vscode.window.activeTextEditor === editor;
  const cursorSlide = (editor) => F.slideIndexAt(analyze(editor.document).heads, editor.selection.active.line);

  async function runFold(editor, actions) {
    if (!isActive(editor)) return false;
    // 開くのが先。畳むのを先にすると、前のスライドが縮んだ分だけ画面が跳ねてから開くことになる
    if (actions.unfold.length) await vscode.commands.executeCommand('editor.unfold', { selectionLines: actions.unfold, levels: 1 });
    if (actions.fold.length) await vscode.commands.executeCommand('editor.fold', { selectionLines: actions.fold, levels: 1 });
    return true;
  }

  /** 画面内に畳まれた行があるか（visibleRanges が分かれている＝間の行が隠れている） */
  const hasHiddenLines = (editor) => Array.isArray(editor.visibleRanges) && editor.visibleRanges.length > 1;

  function clearTimers(st) { for (const t of st.timers) clearTimeout(t); st.timers = []; }

  /** Marp の md がアクティブになった初回：今のスライド以外と style / svg を畳む */
  function scheduleInitialFold(editor) {
    if (!autoFoldOn() || !editor || !isMarp(editor.document)) return;
    const st = stateOf(editor.document);
    if (st.initialized || st.timers.length) return;
    let attempt = 0;
    const tryOnce = async () => {
      st.timers = [];
      if (!autoFoldOn() || editor.document.isClosed) return;
      if (!isActive(editor)) return; // 次にアクティブになったときにやり直す（initialized は立てない）
      let actions, cur;
      try {
        cur = cursorSlide(editor);
        actions = F.nextFoldActions({ ranges: analyze(editor.document).ranges, prevSlide: null, curSlide: cur, kinds: foldKinds() });
      } catch (_) { st.initialized = true; return; } // 解析できない原稿では何もしない（やり直しもしない）
      st.cur = cur; st.initialized = true; st.pending.clear(); st.deferred.clear();
      // 初回は、復元された畳み状態を基本いじらない（畳むだけ）。例外は frontmatter の style: 全体：
      // 以前の版は style: を丸ごと畳んでいたので、VS Code がその状態を復元すると、よく触る「調整つまみ」
      // （先頭の :root）が隠れたままになる。style を畳む設定のときは、外側を開いてから内側（つまみの後ろ）だけを畳む。
      let knobUnfold = [];
      try {
        if (foldKinds().includes('style')) knobUnfold = analyze(editor.document).ranges.filter(r => r.kind === 'frontmatter-style-all').map(r => r.start);
      } catch (_) { knobUnfold = []; }
      if (!actions.fold.length && !knobUnfold.length) return;
      try { await runFold(editor, { fold: actions.fold, unfold: knobUnfold }); } catch (_) { return; }
      if (!actions.fold.length) return;
      attempt++;
      // 畳めたかは visibleRanges でしか分からない。fold は何度呼んでも同じ結果なので、
      // 画面内に隠れた行が見当たらなければ（範囲がまだ届いていなかった可能性）少し待ってもう一度。
      if (attempt <= FOLD_RETRY_MS.length) {
        const wait = FOLD_RETRY_MS[attempt - 1];
        st.timers.push(setTimeout(guard(() => { if (hasHiddenLines(editor)) { st.timers = []; return undefined; } return tryOnce(); }), wait));
      }
    };
    st.timers.push(setTimeout(guard(tryOnce), FIRST_FOLD_DELAY_MS));
  }

  /**
   * スライドが prev → cur に変わったときの畳み直し。
   * deferPrev=true のときは、今のスライドを開くだけで、前のスライドを畳むのは後回しにする（st.deferred）。
   * キーボードの ↓ で次のスライドの区切り行に乗った瞬間に前を畳むと、そこから ↑ で戻ったとき
   * 「前のスライドの末尾」ではなく「畳まれた前のスライドの先頭行」に飛ばされてしまう。
   * 区切り行から本文へ入った時点（＝戻る気が無いと分かった時点）で畳む。
   */
  async function moveTo(editor, cur, deferPrev) {
    const st = stateOf(editor.document);
    const prev = st.cur;
    if (prev === cur) return;
    st.cur = cur;
    st.pending.delete(cur);
    st.deferred.delete(cur);
    if (!isActive(editor)) { st.pending.add(prev); for (const n of st.deferred) st.pending.add(n); st.deferred.clear(); return; }
    try {
      const a = analyze(editor.document);
      const actions = F.nextFoldActions({ ranges: a.ranges, prevSlide: deferPrev ? -1 : prev, curSlide: cur, kinds: foldKinds() });
      if (deferPrev) st.deferred.add(prev);
      else actions.fold.push(...takeDeferred(st, a, cur));
      await runFold(editor, actions);
      // 上のスライドが縮むと表示がずれる。カーソルが画面の外へ出たときだけ戻す
      editor.revealRange(new vscode.Range(editor.selection.active, editor.selection.active), vscode.TextEditorRevealType.Default);
    } catch (_) { /* fold コマンドが無い・失敗しても原稿には影響しない */ }
  }

  /** 後回しにしていたスライドの開始行を取り出す（今のスライドは除く） */
  function takeDeferred(st, a, cur) {
    const lines = [];
    for (const r of a.ranges) if (r.kind === 'slide' && r.slide !== cur && st.deferred.has(r.slide)) lines.push(r.start);
    st.deferred.clear();
    return lines;
  }

  /** 区切り行から本文へ入った：後回しにしていた分を畳む */
  async function foldDeferred(editor) {
    const st = stateOf(editor.document);
    if (!st.deferred.size || !isActive(editor)) return;
    try {
      const fold = takeDeferred(st, analyze(editor.document), st.cur);
      if (!fold.length) return;
      await runFold(editor, { fold, unfold: [] });
      editor.revealRange(new vscode.Range(editor.selection.active, editor.selection.active), vscode.TextEditorRevealType.Default);
    } catch (_) { /* 同上 */ }
  }

  /** 持ち越した分を畳む（エディタがアクティブに戻ったとき） */
  async function flushPending(editor) {
    const st = stateOf(editor.document);
    if (!isActive(editor)) return;
    for (const n of st.deferred) st.pending.add(n);
    st.deferred.clear();
    if (!st.pending.size) return;
    let a, cur;
    try { a = analyze(editor.document); cur = cursorSlide(editor); } catch (_) { st.pending.clear(); return; }
    st.cur = cur;
    const fold = [];
    for (const r of a.ranges) {
      if (r.kind === 'slide' && r.slide !== cur && st.pending.has(r.slide)) fold.push(r.start);
    }
    // 今のスライドの style / svg も（VS Code がスライドごと開いたとき、中まで開いていることがある）
    fold.push(...F.nextFoldActions({ ranges: a.ranges, prevSlide: -1, curSlide: cur, kinds: foldKinds() }).fold);
    st.pending.clear();
    try { await runFold(editor, { fold, unfold: [] }); } catch (_) { /* 同上 */ }
  }

  function onSelection(e) {
    const editor = e.textEditor;
    if (!autoFoldOn() || !isActive(editor) || !isMarp(editor.document)) return;
    // 拡張や検索・置換からの移動では動かさない。プレビューからの移動は Command 扱いになるので、
    // 拡張本体が onPreviewNavigate を明示的に呼ぶ。
    if (e.kind === vscode.TextEditorSelectionChangeKind.Command) return;
    if (e.selections.length !== 1 || !e.selections[0].isEmpty) return;
    const st = stateOf(editor.document);
    if (!st.initialized) return;
    const a = analyze(editor.document);
    const line = editor.selection.active.line;
    const idx = F.slideIndexAt(a.heads, line);
    // 編集（--- を打った・スライドを消した等）で番号がずれただけのときは、畳まずに現在地だけ合わせる。
    // 書いている最中に、書き終えた側が勝手に畳まれるのを防ぐ。
    if (Date.now() - st.editedAt < EDIT_GRACE_MS) { st.cur = idx; st.deferred.clear(); return; }
    const onHead = idx > 0 && a.heads[idx] === line; // 区切り --- の行に乗っている
    if (idx !== st.cur) return moveTo(editor, idx, onHead && e.kind === vscode.TextEditorSelectionChangeKind.Keyboard);
    if (!onHead && st.deferred.size) return foldDeferred(editor);
    return undefined;
  }

  // ---- コマンド -----------------------------------------------------------
  const activeMarpEditor = () => {
    const ed = vscode.window.activeTextEditor;
    return ed && isMarp(ed.document) ? ed : null;
  };
  const needEditor = () => {
    const ed = activeMarpEditor();
    if (!ed) vscode.window.showInformationMessage('Marp の Markdown（frontmatter に marp: true）をアクティブにしてから実行してください。');
    return ed;
  };

  async function foldOtherSlides() {
    const ed = needEditor();
    if (!ed) return;
    const a = analyze(ed.document);
    const cur = cursorSlide(ed);
    const st = stateOf(ed.document);
    const actions = F.nextFoldActions({ ranges: a.ranges, prevSlide: null, curSlide: cur, kinds: foldKinds() });
    const curStart = a.ranges.find(r => r.kind === 'slide' && r.slide === cur);
    st.cur = cur; st.initialized = true; st.pending.clear(); st.deferred.clear();
    await runFold(ed, { fold: actions.fold, unfold: curStart ? [curStart.start] : [] });
  }

  async function unfoldAllSlides() {
    const ed = needEditor();
    if (!ed) return;
    const lines = analyze(ed.document).ranges.filter(r => r.kind === 'slide').map(r => r.start);
    if (lines.length) await vscode.commands.executeCommand('editor.unfold', { selectionLines: lines, levels: 1 });
  }

  async function toggleAutoFold() {
    const next = !autoFoldOn();
    try { await cfg().update('autoFold', next, vscode.ConfigurationTarget.Global); autoFoldOverride = null; }
    catch (_) { autoFoldOverride = next; } // 設定が未登録の環境。このセッションの間だけ覚える
    const ed = activeMarpEditor();
    if (next) {
      for (const st of states.values()) { clearTimers(st); st.initialized = false; st.deferred.clear(); }
      if (ed) scheduleInitialFold(ed);
    } else {
      for (const st of states.values()) { clearTimers(st); st.pending.clear(); st.deferred.clear(); }
      if (ed) await vscode.commands.executeCommand('editor.unfoldAll');
    }
    updateStatus();
  }

  async function writePanelLabels() {
    const ed = needEditor();
    if (!ed) return;
    const doc = ed.document;
    const text = doc.getText();
    const { slides, lines } = splitDeck(text);
    const s = slides[cursorSlide(ed)];
    if (!s) return;
    const from = s.sepLine >= 0 ? s.sepLine : s.startLine;
    const edits = F.planWritePanelLabels(text, [from, Math.min(s.endLine, lines.length)]);
    if (!edits.length) {
      vscode.window.showInformationMessage('このスライドには、ラベルを書ける区画（複数行の div など）がありません。');
      return;
    }
    // 1操作＝1 WorkspaceEdit（Cmd+Z 1回で戻る）
    const we = new vscode.WorkspaceEdit();
    for (const e of edits) we.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
    const ok = await vscode.workspace.applyEdit(we);
    if (ok) {
      try { if (api && api.saveAfterWrite) await api.saveAfterWrite(doc); } catch (_) { /* 保存の失敗は本体側でログに出す */ }
      vscode.window.showInformationMessage(`区画のラベルを ${edits.length} か所に書きました（開始タグと同じ行の行末。発表者ノートには入りません）。`);
    }
  }

  subs.push(
    vscode.commands.registerCommand('marpScrollSync.toggleAutoFold', guard(toggleAutoFold)),
    vscode.commands.registerCommand('marpScrollSync.foldOtherSlides', guard(foldOtherSlides)),
    vscode.commands.registerCommand('marpScrollSync.unfoldAllSlides', guard(unfoldAllSlides)),
    vscode.commands.registerCommand('marpScrollSync.writePanelLabels', guard(writePanelLabels)),
  );

  // ---- イベント -----------------------------------------------------------
  subs.push(
    vscode.window.onDidChangeTextEditorSelection(guard(onSelection)),
    vscode.window.onDidChangeActiveTextEditor(guard((ed) => {
      updateStatus();
      if (!ed || !isMarp(ed.document)) return;
      updateDecorations(ed);
      if (!autoFoldOn()) return;
      if (!stateOf(ed.document).initialized) scheduleInitialFold(ed);
      else return flushPending(ed);
      return undefined;
    })),
    vscode.window.onDidChangeVisibleTextEditors(guard(() => updateAllDecorations())),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const key = e.document.uri.toString();
      if (states.has(key)) states.get(key).editedAt = Date.now();
      if (vscode.window.visibleTextEditors.some(ed => ed.document === e.document)) scheduleDecorations();
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const st = states.get(key);
      if (st) clearTimers(st);
      states.delete(key); cache.delete(key);
      diagnostics.delete(doc.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(SECTION)) return;
      guard(() => { updateAllDecorations(); updateStatus(); })();
    }),
    { dispose: () => { for (const st of states.values()) clearTimers(st); states.clear(); cache.clear(); } },
  );

  // 起動時にすでに開いている分
  guard(() => {
    updateAllDecorations();
    updateStatus();
    if (vscode.window.activeTextEditor) scheduleInitialFold(vscode.window.activeTextEditor);
  })();

  return {
    /** プレビューからスライド index へ移動したとき、拡張本体が呼ぶ（選択変更が Command 扱いで onSelection を通らないため） */
    onPreviewNavigate: guard(async (editor, slideIndex) => {
      if (!autoFoldOn() || !editor || !isMarp(editor.document) || typeof slideIndex !== 'number') return;
      const st = stateOf(editor.document);
      if (!st.initialized) { if (isActive(editor)) scheduleInitialFold(editor); return; }
      // 範囲外の番号（描画と原稿の枚数がずれた瞬間など）は端に寄せる
      const last = Math.max(0, analyze(editor.document).heads.length - 1);
      await moveTo(editor, Math.min(last, Math.max(0, Math.floor(slideIndex) || 0)));
    }),
    /** ラベル・診断を今すぐ更新する（editor 省略で表示中の全エディタ） */
    refresh: guard((editor) => {
      if (editor) updateDecorations(editor); else updateAllDecorations();
      updateStatus();
    }),
  };
}

module.exports = { register };
