// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 完成スライドの印・ライブラリからの挿入・貼り付け適応の VS Code 側（DESIGN.md 3.4）。
// 計算は全部 lib/library-core.cjs（vscode 非依存）。ここは入力欄・QuickPick・WorkspaceEdit・診断への配線だけを持つ。
// 原稿に書くのは「_class と同居する _lib / _from の 1 行」と、挿入したスライド本文・運んだ CSS だけ。
// どれも 1 操作 = 1 WorkspaceEdit（Cmd+Z 1 回で戻る）。素材のコピーだけはファイル操作なので元に戻らない（消しもしない）。
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
/** 台帳とサムネイルを作る CLI。拡張のフォルダ（tools/marp-scroll-sync）の隣の tools/marp-library.mjs に固定する */
const BUNDLED_CLI = path.resolve(__dirname, '..', '..', 'marp-library.mjs');
const core = require('./library-core.cjs');

const SECTION = 'marpScrollSync';
const DIAG_DEBOUNCE_MS = 400;
/** コピー時に「どのデックのどこから」を運ぶ独自 MIME（貼り付け適応用。他のアプリからは見えないだけで害はない） */
const PASTE_MIME = 'application/vnd.marp-scroll-sync.source+json';
const PASTE_TITLE = '貼り付け先に合わせて貼り付け';

/**
 * @param {vscode.ExtensionContext} context
 * @param {{ isMarpDoc(doc): boolean, repoRootFor(doc): string, postToPreview(msg): void, webviewUriFor(absPath): string|null }} api
 * @returns {{ toggleMark(editor, slideIndex): Promise<boolean>, openGallery(editor, slideIndex): Promise<void>,
 *            insert(editor, id, afterIndex, opts): Promise<boolean>, marksFor(doc): boolean[] }}
 */
function register(context, api) {
  api = api || {};
  const subs = context.subscriptions;
  const isMarp = (doc) => { try { return !!(doc && api.isMarpDoc && api.isMarpDoc(doc)); } catch (_) { return false; } };

  /** リポジトリのルート（theme/ がある場所）。拡張本体に聞き、だめなら原稿から上へたどって theme/academic.css を探す */
  function repoRootFor(doc) {
    try { const r = api.repoRootFor && api.repoRootFor(doc); if (r && fs.existsSync(path.join(r, 'theme'))) return r; } catch (_) { /* 下の探索へ */ }
    let dir = path.dirname(doc.uri.fsPath);
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, 'theme', 'academic.css'))) return dir;
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    const wf = vscode.workspace.getWorkspaceFolder && vscode.workspace.getWorkspaceFolder(doc.uri);
    return wf ? wf.uri.fsPath : path.dirname(doc.uri.fsPath);
  }

  /** いまカーソルのあるスライド（0-based） */
  function slideIndexAt(editor) {
    const deck = core.parseDeck(editor.document.getText());
    const line = editor.selection.active.line;
    let idx = 0;
    for (const s of deck.slides) if (s.startLine <= line) idx = s.index;
    return idx;
  }

  /** 書いたあと、すぐ保存する（拡張本体の saveAfterWrite。設定 marpScrollSync.saveAfterEdit）。本体が無ければ何もしない */
  async function saveAfterWrite(doc) {
    try { if (api.saveAfterWrite) return await api.saveAfterWrite(doc); } catch (_) { /* 保存の失敗は本体側でログに出す */ }
    return false;
  }

  /** library-core の編集 {start,end,text} を 1 つの WorkspaceEdit に積む */
  function toWorkspaceEdit(doc, edits) {
    const we = new vscode.WorkspaceEdit();
    for (const e of edits) we.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
    return we;
  }

  /** 開いている（未保存かもしれない）文書があればその中身、無ければ undefined（＝ディスクから読む） */
  function openTextOf(fsPath) {
    const d = vscode.workspace.textDocuments.find((x) => x.uri.scheme === 'file' && x.uri.fsPath === fsPath);
    return d ? d.getText() : undefined;
  }

  /**
   * 台帳（原稿から読み直す。index.json は絵の場所を知るためだけに使う）。
   * いま編集中の文書はディスクより新しいかもしれないので、その分だけ差し替える。
   */
  /** 開いている原稿は未保存の内容で読む（印を付けた直後・保存前でも、ギャラリーと挿入の対象になる） */
  function liveIndex(repoRoot) {
    return core.buildIndex(repoRoot, { textOf: openTextOf });
  }

  function currentEntries(doc, repoRoot) {
    const idx = liveIndex(repoRoot);
    const rel = path.relative(repoRoot, doc.uri.fsPath).split(path.sep).join('/');
    const others = idx.entries.filter((e) => e.deck !== rel);
    const deck = core.parseDeck(doc.getText(), { path: doc.uri.fsPath, repoRoot });
    const mine = deck.slides.filter((s) => s.mark).map((s) => ({ id: s.mark.id, deck: rel, slide: s.index + 1 }));
    return { idx, others, mine };
  }

  // ---- 印を付ける／外す ------------------------------------------------------

  async function toggleMark(editor, slideIndex) {
    if (!editor || !isMarp(editor.document)) return false;
    const doc = editor.document;
    const text = doc.getText();
    const deck = core.parseDeck(text, { path: doc.uri.fsPath });
    const idx = Number.isInteger(slideIndex) ? slideIndex : slideIndexAt(editor);
    const s = deck.slides[idx];
    if (!s) return false;
    let mark = null;
    if (!s.mark) {
      const repoRoot = repoRootFor(doc);
      const { others, mine } = currentEntries(doc, repoRoot);
      const taken = new Map([...others, ...mine].map((e) => [e.id, e]));
      const id = await vscode.window.showInputBox({
        title: `完成スライドの印（${idx + 1} 枚目「${s.title || '無題'}」）`,
        prompt: 'id（半角英数とハイフン。リポジトリの中で一意）',
        value: core.suggestId(s.title, doc.uri.fsPath, idx + 1, [...taken.keys()]),
        validateInput: (v) => {
          if (!/^[a-z0-9][a-z0-9-]*$/.test(String(v).trim())) return '半角の英小文字・数字・ハイフンだけで書いてください';
          const hit = taken.get(String(v).trim());
          return hit ? `既に使われています: ${hit.deck} #${hit.slide}` : null;
        },
      });
      if (id === undefined) return false;
      const tagText = await vscode.window.showInputBox({
        title: `完成スライドの印（${id.trim()}）`,
        prompt: 'タグ（カンマ区切り。空でもよい）　例: 構成, アジェンダ',
        value: '',
      });
      if (tagText === undefined) return false;
      mark = { id: id.trim(), tags: String(tagText).split(/[,、]/).map((t) => t.trim()).filter(Boolean) };
    }
    // 入力を待つ間に原稿が変わっていたら、古い位置に書かない
    if (doc.getText() !== text) { vscode.window.showWarningMessage('入力中に原稿が変わりました。もう一度やり直してください。'); return false; }
    let edit;
    try { edit = core.markSlideEdit(text, idx, mark); } catch (e) { vscode.window.showErrorMessage(String(e.message || e)); return false; }
    if (!edit) return false;
    // 検算：枚数が変わらず、ノートに混入しない形であること。だめなら何も書かない
    const after = core.applyEdits(text, [edit]);
    if (core.parseDeck(after).slides.length !== deck.slides.length || (mark && core.findLeakyMarks(after).some((l) => l.id === mark.id))) {
      vscode.window.showErrorMessage('このスライドには安全に印を書けませんでした（原稿は変更していません）。');
      return false;
    }
    const ok = await vscode.workspace.applyEdit(toWorkspaceEdit(doc, [edit]));
    if (ok) {
      await saveAfterWrite(doc);
      vscode.window.setStatusBarMessage(mark ? `★ 印を付けました: ${mark.id}` : '印を外しました', 3000);
    }
    return !!ok;
  }

  // ---- ライブラリから挿入 ------------------------------------------------------

  /** id のスライドを afterIndex 枚目（0-based）の後ろに入れる。opts = { keepColors } */
  async function insert(editor, id, afterIndex, opts) {
    if (!editor || !isMarp(editor.document)) return false;
    opts = opts || {};
    const doc = editor.document;
    const repoRoot = repoRootFor(doc);
    const after = Number.isInteger(afterIndex) ? afterIndex : slideIndexAt(editor);
    let plan;
    try {
      const entry = core.findEntry(liveIndex(repoRoot), id);
      if (!entry) throw new Error(`id「${id}」の印付きスライドが見つかりません（元デックで印が外されたかもしれません）`);
      const srcMd = path.join(repoRoot, entry.deck);
      plan = core.adaptSlide({
        srcMdPath: srcMd, srcText: openTextOf(srcMd), id,
        destMdPath: doc.uri.fsPath, destText: doc.getText(),
        keepColors: !!opts.keepColors, repoRoot, afterIndex: after,
      });
    } catch (e) {
      vscode.window.showErrorMessage('ライブラリから挿入できません: ' + String(e.message || e));
      return false;
    }
    const version = doc.version;
    // 素材は先にコピーする（本文が入った瞬間にプレビューが再描画され、画像が無いと欠けて見える）。
    // 既にあるファイルは上書きしない。編集が失敗したら、今回コピーした分だけ片付ける。
    let copied = [];
    try { copied = core.copyAssets(plan); } catch (e) { plan.warnings.push('素材のコピーに失敗しました: ' + String(e.message || e)); }
    const ok = doc.version === version && await vscode.workspace.applyEdit(toWorkspaceEdit(doc, plan.destEdits));
    if (!ok) {
      for (const p of copied) { try { fs.unlinkSync(p); } catch (_) { /* 残っても害はない */ } }
      vscode.window.showWarningMessage('原稿が先に変わったので挿入をやめました。もう一度やり直してください。');
      return false;
    }
    await saveAfterWrite(doc);
    // 入れたスライドの先頭へカーソルを移す（プレビューもそこへ付いてくる）
    try {
      const deck = core.parseDeck(doc.getText());
      const s = deck.slides[after + 1];
      if (s && vscode.window.activeTextEditor === editor) {
        const pos = new vscode.Position(s.startLine, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
      }
    } catch (_) { /* カーソル移動は飾り */ }
    if (plan.warnings.length) vscode.window.showWarningMessage(`「${id}」を挿入しました。確認してください：\n` + plan.warnings.map((w) => '・' + w).join('\n'));
    else vscode.window.setStatusBarMessage(`「${id}」を挿入しました`, 3000);
    return true;
  }

  function entryItems(doc, repoRoot) {
    const idx = liveIndex(repoRoot);
    const dup = new Set(idx.entries.map((e) => e.id).filter((x, i, a) => a.indexOf(x) !== i));
    return idx.entries.filter((e) => !dup.has(e.id));
  }

  /** プレビューにサムネイル一覧を出す。選ばれたら Webview が libraryInsert {id,index} を返し、拡張本体が insert を呼ぶ */
  async function openGallery(editor, slideIndex) {
    if (!editor || !isMarp(editor.document)) return;
    const repoRoot = repoRootFor(editor.document);
    let entries = [];
    try { entries = entryItems(editor.document, repoRoot); } catch (e) { vscode.window.showErrorMessage(String(e.message || e)); return; }
    const out = entries.map((e) => {
      const abs = path.join(repoRoot, 'slides', '_library', 'thumbs', e.id + '.png');
      let thumb = null;
      try { if (fs.existsSync(abs) && api.webviewUriFor) thumb = api.webviewUriFor(abs) || null; } catch (_) { thumb = null; }
      return { id: e.id, title: e.title, pattern: e.pattern, deck: e.deck, tags: e.tags, thumb };
    });
    if (api.postToPreview) api.postToPreview({ type: 'library', entries: out, index: Number.isInteger(slideIndex) ? slideIndex : slideIndexAt(editor) });
  }

  async function cmdInsertFromLibrary() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isMarp(editor.document)) { vscode.window.showInformationMessage('Marp の原稿（marp: true の .md）を開いてから実行してください。'); return; }
    const doc = editor.document;
    const repoRoot = repoRootFor(doc);
    let entries;
    try { entries = entryItems(doc, repoRoot); } catch (e) { vscode.window.showErrorMessage(String(e.message || e)); return; }
    if (!entries.length) { vscode.window.showInformationMessage('印付きのスライドがまだありません。完成したスライドで「完成スライドの印を付ける／外す」を実行してください。'); return; }
    const after = slideIndexAt(editor);
    const pick = await vscode.window.showQuickPick(entries.map((e) => ({
      label: e.title || '(無題)', description: e.pattern || '', detail: `${path.basename(e.deck, '.md')} #${e.slide}　${e.tags.length ? '🏷 ' + e.tags.join(', ') : ''}　(${e.id})`, id: e.id, entry: e,
    })), { title: `ライブラリから挿入（${after + 1} 枚目の後ろ）`, placeHolder: '題名・パターン・タグ・デック名で絞り込み', matchOnDescription: true, matchOnDetail: true });
    if (!pick) return;
    // 配色が違うときだけ、色をどうするか聞く（同じなら聞くまでもない）
    let keepColors = false;
    const destPal = core.parseDeck(doc.getText(), { path: doc.uri.fsPath, repoRoot }).palette;
    const same = ['accent', 'accentDark', 'accentSoft', 'sectionBg'].every((k) => (core.normHex(pick.entry.palette[k]) || pick.entry.palette[k]) === (core.normHex(destPal[k]) || destPal[k]));
    if (!same) {
      const c = await vscode.window.showQuickPick([
        { label: 'このデックの色に合わせる', description: '元の配色と同じ色を var(--accent…) に置き換える', keep: false },
        { label: '元の色のまま', description: pick.entry.palette.accent || '', keep: true },
      ], { title: '配色が元デックと違います' });
      if (!c) return;
      keepColors = c.keep;
    }
    await insert(editor, pick.id, after, { keepColors });
  }

  let libOut = null;   // 出力チャンネル「Marp Library」
  function cmdRebuildLibrary() {
    const doc = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
    const wf = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    const repoRoot = doc && doc.uri.scheme === 'file' ? repoRootFor(doc) : (wf ? wf.uri.fsPath : null);
    // 動かすのは、この拡張と同じリポジトリに同梱の tools/marp-library.mjs（BUNDLED_CLI）だけ。原稿の側の tools/ は
    // 「marp-GUI の作業フォルダか」の目印に見るだけ。シェルを通さず引数の配列で起動し、リポジトリは --root で渡す
    //（docs/security-review.md SEC-01）。index → thumbs の順に 1 つずつ
    if (!repoRoot || !fs.existsSync(path.join(repoRoot, 'tools', 'marp-library.mjs')) || !fs.existsSync(BUNDLED_CLI)) { vscode.window.showErrorMessage('tools/marp-library.mjs が見つかりません。'); return; }
    const spawn = typeof api.spawn === 'function' ? api.spawn : require('child_process').spawn;
    if (!libOut) libOut = vscode.window.createOutputChannel('Marp Library');
    if (libOut.clear) libOut.clear();
    if (libOut.show) libOut.show(true);
    const steps = ['index', 'thumbs'];
    const fail = (msg) => { libOut.appendLine(msg); vscode.window.showErrorMessage('ライブラリの作り直しに失敗しました（出力「Marp Library」を見てください）。'); };
    const run = (i) => {
      if (i >= steps.length) { vscode.window.showInformationMessage('ライブラリの台帳とサムネイルを作り直しました。'); return; }
      const args = [BUNDLED_CLI, steps[i], '--root', repoRoot];
      libOut.appendLine('$ node ' + args.map(a => JSON.stringify(a)).join(' '));
      let ch;
      try {
        // 拡張ホストの execPath は Electron。ELECTRON_RUN_AS_NODE=1 で node として動く（素の node では無視される）
        ch = spawn(process.execPath, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }) });
      } catch (e) { fail('[起動できません] ' + (e && e.message || e)); return; }
      const onData = (b) => libOut.append(String(b));
      if (ch.stdout) ch.stdout.on('data', onData);
      if (ch.stderr) ch.stderr.on('data', onData);
      let done = false;
      ch.on('error', (e) => { if (done) return; done = true; fail('[起動できません] ' + (e && e.message || e)); });
      ch.on('close', (code) => { if (done) return; done = true; if (code === 0) run(i + 1); else fail('[exit=' + code + ']'); });
    };
    run(0);
  }

  // ---- marksFor（プレビューの ★ 表示用） ---------------------------------------

  const markCache = new Map(); // uri → { version, marks }
  function marksFor(doc) {
    const key = doc.uri.toString();
    const hit = markCache.get(key);
    if (hit && hit.version === doc.version) return hit.marks;
    let marks = [];
    // コードフェンスの中の見本（_lib: の書き方の説明）は印に数えない → 実際に読めた印だけを true にする
    try { marks = core.parseDeck(doc.getText()).slides.map((s) => !!s.mark); } catch (_) { marks = []; }
    markCache.set(key, { version: doc.version, marks });
    return marks;
  }

  // ---- 診断：ノートに混入する印 ---------------------------------------------------

  const diag = vscode.languages.createDiagnosticCollection('marp-library');
  subs.push(diag);
  const timers = new Map();
  function refreshDiagnostics(doc) {
    // 診断は飾り。ここで例外が出ても register（＝拡張の起動）やイベント処理を止めない
    try { refreshDiagnosticsUnsafe(doc); } catch (_) { /* 次の変更でやり直す */ }
  }
  function refreshDiagnosticsUnsafe(doc) {
    if (!isMarp(doc)) { diag.delete(doc.uri); return; }
    let leaks = [];
    try { leaks = core.findLeakyMarks(doc.getText()); } catch (_) { leaks = []; }
    diag.set(doc.uri, leaks.map((l) => {
      const line = Math.min(l.line, doc.lineCount - 1);
      const d = new vscode.Diagnostic(doc.lineAt(line).range,
        l.reason === 'alone'
          ? `この ${l.key} は発表者ノートに出ます。_class などのディレクティブと同じコメントの中に置いてください（_class の行を消すと、この印が発表者ノートに出ます）。`
          : `この ${l.key} の値は YAML として読めないため、コメント全体が発表者ノートに出て _class も効きません。値を "…" で囲んでください。`,
        vscode.DiagnosticSeverity.Warning);
      d.source = 'marp-scroll-sync';
      return d;
    }));
  }
  function scheduleDiagnostics(doc) {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); if (!doc.isClosed) refreshDiagnostics(doc); }, DIAG_DEBOUNCE_MS));
  }
  subs.push(
    vscode.workspace.onDidOpenTextDocument((d) => refreshDiagnostics(d)),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleDiagnostics(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => { diag.delete(d.uri); markCache.delete(d.uri.toString()); clearTimeout(timers.get(d.uri.toString())); timers.delete(d.uri.toString()); }),
    { dispose() { for (const t of timers.values()) clearTimeout(t); timers.clear(); } },
  );
  for (const d of vscode.workspace.textDocuments) refreshDiagnostics(d);

  // ---- コマンド ---------------------------------------------------------------

  subs.push(
    vscode.commands.registerCommand('marpScrollSync.markSlide', () => toggleMark(vscode.window.activeTextEditor)),
    vscode.commands.registerCommand('marpScrollSync.insertFromLibrary', cmdInsertFromLibrary),
    vscode.commands.registerCommand('marpScrollSync.rebuildLibrary', cmdRebuildLibrary),
  );

  // ---- 貼り付け適応（API がある VS Code でだけ。無ければこの機能だけ黙って無効） ---------
  registerPasteProvider();

  function registerPasteProvider() {
    const L = vscode.languages;
    if (!L || typeof L.registerDocumentPasteEditProvider !== 'function' || !vscode.DocumentPasteEdit || !vscode.DocumentDropOrPasteEditKind) return;
    let kind;
    try { kind = vscode.DocumentDropOrPasteEditKind.Empty.append('marpScrollSync', 'adapt'); } catch (_) { return; }
    const enabled = () => vscode.workspace.getConfiguration(SECTION).get('adaptivePaste', true) !== false;

    const provider = {
      // コピー時：どのデックの何枚目から取ったかを添える（本文そのものは text/plain に入っている）
      prepareDocumentPaste(document, ranges, dataTransfer) {
        try {
          if (!enabled() || !isMarp(document) || document.uri.scheme !== 'file' || !ranges.length) return;
          const deck = core.parseDeck(document.getText());
          const line = ranges[0].start.line;
          let idx = 0;
          for (const s of deck.slides) if (s.startLine <= line) idx = s.index;
          dataTransfer.set(PASTE_MIME, new vscode.DataTransferItem(JSON.stringify({ fsPath: document.uri.fsPath, slideIndex: idx })));
        } catch (_) { /* コピーそのものは邪魔しない */ }
      },

      // 貼り付け時：別デックからなら、適応した版を「もう1つの貼り付け方」として出す（既定の貼り付けは変えない）
      async provideDocumentPasteEdits(document, ranges, dataTransfer) {
        try {
          if (!enabled() || !isMarp(document) || document.uri.scheme !== 'file' || ranges.length !== 1) return undefined;
          const item = dataTransfer.get(PASTE_MIME);
          const plain = dataTransfer.get('text/plain');
          if (!item || !plain) return undefined;
          const meta = JSON.parse(await item.asString());
          if (!meta || !meta.fsPath || meta.fsPath === document.uri.fsPath || !fs.existsSync(meta.fsPath)) return undefined;
          const fragment = await plain.asString();
          if (!fragment || !fragment.trim()) return undefined;
          const destText = document.getText();
          const repoRoot = repoRootFor(document);
          const dest = core.parseDeck(destText, { path: document.uri.fsPath, repoRoot });
          // frontmatter の中への貼り付けには手を出さない（style の追記と重なる）
          const fmEnd = dest.frontmatter.endLine;
          if (fmEnd >= 0 && ranges[0].start.line <= fmEnd) return undefined;
          const srcText = openTextOf(meta.fsPath);
          const src = core.parseDeck(srcText !== undefined ? srcText : meta.fsPath, { path: meta.fsPath, repoRoot });
          let after = 0;
          for (const s of dest.slides) if (s.startLine <= ranges[0].start.line) after = s.index;
          const plan = core.adaptFragment(fragment, src, dest, { repoRoot, srcSlideIndex: meta.slideIndex, destSlideIndex: after });
          // 何も変わらないなら選択肢を出さない
          // （改行コードだけの違いは「変化」に数えない。VS Code が貼り付け時に揃える）
          if (!plan.info.changed && !plan.destEdits.length && !plan.assetCopies.length) return undefined;
          const edit = new vscode.DocumentPasteEdit(plan.slideText, PASTE_TITLE, kind);
          // ふつうの貼り付けを既定のままにする（こちらは貼り付け後の選択肢として出る）
          if (vscode.DocumentDropOrPasteEditKind.Text) edit.yieldTo = [vscode.DocumentDropOrPasteEditKind.Text];
          if (plan.destEdits.length) edit.additionalEdit = toWorkspaceEdit(document, plan.destEdits);
          edit._ssPlan = plan;
          return [edit];
        } catch (_) { return undefined; }
      },

      // 実際に選ばれたときだけ、素材をコピーして警告を見せる
      resolveDocumentPasteEdit(pasteEdit) {
        const plan = pasteEdit && pasteEdit._ssPlan;
        if (plan) {
          try { core.copyAssets(plan); } catch (e) { plan.warnings.push('素材のコピーに失敗しました: ' + String(e.message || e)); }
          if (plan.warnings.length) vscode.window.showWarningMessage('貼り付け先に合わせました。確認してください：\n' + plan.warnings.map((w) => '・' + w).join('\n'));
        }
        return pasteEdit;
      },
    };

    try {
      subs.push(L.registerDocumentPasteEditProvider({ language: 'markdown' }, provider, {
        providedPasteEditKinds: [kind], copyMimeTypes: [PASTE_MIME], pasteMimeTypes: [PASTE_MIME],
      }));
    } catch (_) { /* 形の違う古い提案版 API。貼り付け適応だけ諦める */ }
  }

  return { toggleMark, openGallery, insert, marksFor };
}

module.exports = { register, PASTE_MIME };
