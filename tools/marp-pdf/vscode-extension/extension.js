// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// Marp GUI PDF — エディタ右上ツールバー／ステータスバーに「▶ プレゼン」「📄 PDF出力」ボタンを足す最小ローカル拡張。
// 実体は tools/marp-pdf/build-pdf.mjs（全スライドを1HTMLに描画 → ページ範囲ごとに分割印刷
// → pdf-lib で結合）と tools/marp-present/present.mjs。Node スクリプトなので mac / Windows / Linux 共通。
// Chrome の printToPDF を一括で呼ばないので落ちず、ベクター品質を維持する。
// 依存パッケージなし・マーケット非経由・全コードここに見えている。
const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const IS_WIN = process.platform === 'win32';

// GUI(Dock/Finder/スタートメニュー)から起動した VS Code の拡張ホストはシェルの rc を読まず PATH が
// 最小になり、node / npm を見失うことがある。既知の場所を明示的に足して回避。
function buildPath(existing) {
  const extra = IS_WIN
    ? [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
        path.join(process.env.APPDATA || '', 'npm'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
      ]
    : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const cur = (existing || '').split(path.delimiter).filter(Boolean);
  const seen = new Set();
  return [...extra, ...cur].filter((p) => (seen.has(p) ? false : (seen.add(p), true))).join(path.delimiter);
}

// node 実行ファイルを決める：設定 marpGui.nodePath → PATH 上の node → OS 標準の場所。
function resolveNode(env) {
  const cfg = vscode.workspace.getConfiguration('marpGui').get('nodePath', '');
  if (cfg && fs.existsSync(cfg)) { return cfg; }
  const exe = IS_WIN ? 'node.exe' : 'node';
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    const cand = path.join(dir, exe);
    if (dir && fs.existsSync(cand)) { return cand; }
  }
  return 'node'; // 最後の手段：spawn に任せる
}

const TIMEOUT_MS = 5 * 60 * 1000;

function activate(context) {
  const out = vscode.window.createOutputChannel('Marp GUI');

  const cmd = vscode.commands.registerCommand('marpGui.exportPdf', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
      vscode.window.showErrorMessage('Marp PDF: Markdown(.md) を開いた状態で実行してください。');
      return;
    }
    const doc = editor.document;
    if (doc.isDirty) { await doc.save(); }      // 最新内容で書き出す
    const mdPath = doc.uri.fsPath;

    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!folder) {
      vscode.window.showErrorMessage('Marp PDF: このファイルはワークスペース内にありません。フォルダを開いて実行してください。');
      return;
    }
    const root = folder.uri.fsPath;
    const script = path.join(root, 'tools', 'marp-pdf', 'build-pdf.mjs');
    if (!fs.existsSync(script)) {
      vscode.window.showErrorMessage('Marp PDF: tools/marp-pdf/build-pdf.mjs が見つかりません（' + root + '）。');
      return;
    }

    const chunk = vscode.workspace.getConfiguration('marpGui').get('chunkSize', 0);
    const env = Object.assign({}, process.env);
    env.PATH = buildPath(env.PATH);
    // Chrome の場所はスクリプト側が OS ごとに自動検出する。固定したいときだけ設定 marpGui.chromePath。
    const chromeCfg = vscode.workspace.getConfiguration('marpGui').get('chromePath', '');
    if (chromeCfg) { env.CHROME_PATH = chromeCfg; }
    if (chunk && chunk > 0) { env.CHUNK = String(chunk); }
    const nodeBin = resolveNode(env);

    out.clear();
    out.show(true); // 進捗が見えるよう出力パネルを前面に
    out.appendLine('=== Marp PDF build (v3, node) ===');
    out.appendLine('node   : ' + nodeBin);
    out.appendLine('script : ' + script);
    out.appendLine('md     : ' + mdPath);
    out.appendLine('PATH   : ' + env.PATH);
    out.appendLine('---');

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Marp: ベクターPDFを書き出し中…', cancellable: true },
      (progress, token) => new Promise((resolve) => {
        // stdin は 'ignore'：何かが入力待ちになっても EOF を受けて固まらない。
        const child = cp.spawn(nodeBin, [script, mdPath], {
          cwd: root,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        let lastPdf = null;
        let done = false;
        const finish = (fn) => { if (!done) { done = true; clearTimeout(timer); fn(); } };

        const onData = (buf) => {
          const s = buf.toString();
          out.append(s);
          const m = s.match(/=>\s*(.+\.pdf)\s*$/m);
          if (m) { lastPdf = m[1].trim(); }
          const step = s.match(/\[(\d)\/4\]/);
          if (step) { progress.report({ message: 'ステップ ' + step[1] + '/4' }); }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);

        const timer = setTimeout(() => {
          out.appendLine('\n[TIMEOUT] 5分を超えたため中断します。');
          try { child.kill('SIGKILL'); } catch (e) {}
        }, TIMEOUT_MS);

        token.onCancellationRequested(() => {
          out.appendLine('\n[CANCELLED] ユーザー操作で中断。');
          try { child.kill('SIGKILL'); } catch (e) {}
        });

        child.on('error', (e) => {
          finish(() => {
            out.appendLine('\n[SPAWN ERROR] ' + (e && e.message ? e.message : e));
            out.show(true);
            vscode.window.showErrorMessage('Marp PDF: 起動に失敗（' + (e && e.message) + '）。出力パネルを確認してください。');
            resolve();
          });
        });

        child.on('close', (code, signal) => {
          finish(() => {
            out.appendLine('\n=== DONE (exit=' + code + (signal ? ', signal=' + signal : '') + ') ===');
            if (code === 0) {
              const OPEN = 'PDFを開く';
              const REVEAL = 'フォルダで表示';
              vscode.window.showInformationMessage('Marp PDF: 書き出し完了 🎉', OPEN, REVEAL).then((sel) => {
                if (!lastPdf) { return; }
                const uri = vscode.Uri.file(lastPdf);
                if (sel === OPEN) { vscode.env.openExternal(uri); }
                else if (sel === REVEAL) { vscode.commands.executeCommand('revealFileInOS', uri); }
              });
            } else {
              out.show(true);
              vscode.window.showErrorMessage(
                'Marp PDF: 失敗（exit=' + code + '）。出力パネル「Marp GUI」の最後の行を確認してください。'
              );
            }
            resolve();
          });
        });
      })
    );
  });

  // ── ▶ プレゼン：開いている .md を bespoke HTML に描画して Chrome で全画面表示する ──
  // 実体は tools/marp-present/present.sh（HTML描画 → Chrome を新規ウィンドウで起動）。
  // PDFのような分割は不要なので軽量。発表中のキー: F=全画面 / P=発表者ビュー / ←→=ページ送り。
  const presentCmd = vscode.commands.registerCommand('marpGui.present', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
      vscode.window.showErrorMessage('Marp プレゼン: Markdown(.md) を開いた状態で実行してください。');
      return;
    }
    const doc = editor.document;
    if (doc.isDirty) { await doc.save(); }      // 最新内容で発表する
    const mdPath = doc.uri.fsPath;

    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!folder) {
      vscode.window.showErrorMessage('Marp プレゼン: このファイルはワークスペース内にありません。フォルダを開いて実行してください。');
      return;
    }
    const root = folder.uri.fsPath;
    const script = path.join(root, 'tools', 'marp-present', 'present.mjs');
    if (!fs.existsSync(script)) {
      vscode.window.showErrorMessage('Marp プレゼン: tools/marp-present/present.mjs が見つかりません（' + root + '）。');
      return;
    }

    const env = Object.assign({}, process.env);
    env.PATH = buildPath(env.PATH);
    const chromeCfg = vscode.workspace.getConfiguration('marpGui').get('chromePath', '');
    if (chromeCfg) { env.CHROME_PATH = chromeCfg; }
    const nodeBin = resolveNode(env);

    out.clear();
    out.appendLine('=== Marp Present ===');
    out.appendLine('node   : ' + nodeBin);
    out.appendLine('script : ' + script);
    out.appendLine('md     : ' + mdPath);
    out.appendLine('---');

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Marp: 発表用HTMLを描画して Chrome を起動中…', cancellable: false },
      () => new Promise((resolve) => {
        const child = cp.spawn(nodeBin, [script, mdPath], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        const onData = (buf) => out.append(buf.toString());
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('error', (e) => {
          out.appendLine('\n[SPAWN ERROR] ' + (e && e.message ? e.message : e));
          out.show(true);
          vscode.window.showErrorMessage('Marp プレゼン: 起動に失敗（' + (e && e.message) + '）。出力パネルを確認してください。');
          resolve();
        });
        child.on('close', (code) => {
          out.appendLine('\n=== DONE (exit=' + code + ') ===');
          if (code === 0) {
            vscode.window.showInformationMessage('▶ プレゼンを開きました。F=全画面 / P=発表者ビュー / ←→=ページ送り');
          } else {
            out.show(true);
            vscode.window.showErrorMessage('Marp プレゼン: 失敗（exit=' + code + '）。出力パネル「Marp GUI」を確認してください。');
          }
          resolve();
        });
      })
    );
  });

  // ── ステータスバー常設ボタン ─────────────────────────────────────────────
  // エディタ右上のツールバーは他拡張（Claude Code 等）のアイコンで幅があふれ、
  // 当拡張の 📄/▶ が「…」に押し出されて見えなくなる。最下部のステータスバーなら
  // あふれの影響を受けず常に見える。marp: true の Markdown を開いている時だけ表示。
  const sbPresent = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
  sbPresent.command = 'marpGui.present';
  sbPresent.text = '$(play) プレゼン';
  sbPresent.tooltip = 'Marp: このスライドを Chrome で全画面プレゼン';

  const sbPdf = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  sbPdf.command = 'marpGui.exportPdf';
  sbPdf.text = '$(file-pdf) PDF';
  sbPdf.tooltip = 'Marp: このスライドをベクターPDFに書き出し';

  const updateStatusBar = () => {
    const ed = vscode.window.activeTextEditor;
    const show = !!ed && ed.document.languageId === 'markdown' && /^---\r?\n[\s\S]*?\bmarp:\s*true\b/.test(ed.document.getText().slice(0, 2048));
    if (show) { sbPresent.show(); sbPdf.show(); } else { sbPresent.hide(); sbPdf.hide(); }
  };
  updateStatusBar();

  context.subscriptions.push(
    cmd, presentCmd, out, sbPresent, sbPdf,
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar)
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
