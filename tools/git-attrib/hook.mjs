#!/usr/bin/env node
// Claude Code / Argon（Antigravity）の編集と、先生ご自身の編集を git で分ける（Claude Code の .claude/settings.json と Antigravity の .agents/hooks.json から呼ぶ）。
//
//   使い方（標準入力にフック JSON が来る）：
//     node tools/git-attrib/hook.mjs pre     … PreToolUse（Edit/Write/MultiEdit/NotebookEdit / edit_file/write_file）
//     node tools/git-attrib/hook.mjs post    … PostToolUse（同上）
//     node tools/git-attrib/hook.mjs status  … 手で確かめる（直近の自分／Claude／Argon のコミット数）
//
//   仕組み：
//     pre  … AI がこれから書く file に、未コミットの変更（＝先生の手直し。エディタ・同期プレビュー・CLI）があれば、
//            その file だけを **先生名義**（git の既定の user）で先にコミットする（自動スナップショット）。
//            → 先生の手直しが AI の差分に混ざらない。
//     post … AI が書いた file を **Claude 名義**（Claude Code <noreply@anthropic.com>）または **Argon 名義**（Argon <noreply@google.com>）で即コミットする。
//            コミット文に tool 名と、トレーラー Claude-Session / Argon-Session（セッション id）を付ける。
//     どちらも「その file だけ」（git commit -- <file>）。他の未コミットの変更には触れない。
//     Bash / run_command … AI が heredoc・sed・python などで書いた分も漏らさないため、実行前に作業木の「未コミットの file と中身のハッシュ」を
//            控え（.git/git-attrib/<session>.json）、実行後に中身が変わった file・新しくできた file だけを AI 名義でまとめてコミットする。
//            実行前から未コミットだった file（先生の手直し）は、コマンドが触っていなければそのまま残す。
//
//   止め方：環境変数 MARP_GIT_ATTRIB=0、またはリポジトリ直下に .git-attrib-off を置く。
//   対象外：tools/git-attrib/config.json の exclude に合う path（生成物など）、リポジトリの外、git で追跡しないディレクトリ。
//
//   なぜ hook で commit するか：git の author は「誰がコミットしたか」しか記録しないので、AI と先生が同じ作業木を
//   触ると区別が消える。AI の書き込み単位で author を分けておけば、`git log --author=Claude` / `git log --author=Argon` と
//   `git log --author=Tagawa` で分かれ、索引（corpus-core の churnOf）も author 別に添削量を数えられる。
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CLAUDE_AUTHOR = 'Claude Code <noreply@anthropic.com>';
const ARGON_AUTHOR = process.env.MARP_GIT_ATTRIB_ARGON_AUTHOR || 'Argon <200291788+gemini-code-assist@users.noreply.github.com>';
const CLAUDE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CLAUDE_BASH_TOOLS = new Set(['Bash']);
const ARGON_TOOLS = new Set(['edit_file', 'write_file', 'replace_file_content', 'multi_replace_file_content', 'write_to_file']);
const ARGON_BASH_TOOLS = new Set(['run_command']);
const mode = process.argv[2] || '';

function agentOf(input) {
  if (input && input.toolCall && typeof input.toolCall === 'object') {
    const tool = String(input.toolCall.name || '');
    const args = input.toolCall.args || {};
    return {
      isArgon: true,
      tag: 'argon',
      label: 'Argon',
      author: ARGON_AUTHOR,
      session: String(input.conversationId || '').slice(0, 12),
      tool,
      command: String(args.CommandLine || args.command || ''),
      isFileTool: ARGON_TOOLS.has(tool),
      isBashTool: ARGON_BASH_TOOLS.has(tool),
    };
  }
  const tool = String(input && input.tool_name || '');
  const ti = input && input.tool_input || {};
  return {
    isArgon: false,
    tag: 'claude',
    label: 'Claude',
    author: CLAUDE_AUTHOR,
    session: String(input && input.session_id || '').slice(0, 12),
    tool,
    command: String(ti.command || ''),
    isFileTool: CLAUDE_TOOLS.has(tool),
    isBashTool: CLAUDE_BASH_TOOLS.has(tool),
  };
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}
function git(root, args, opts) {
  return execFileSync('git', args, Object.assign({ cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }, opts || {})).trim();
}
/** シンボリックリンクを解いた絶対パス（macOS の /var → /private/var など。git の toplevel は実パスで返るので合わせる） */
function realOf(file) {
  try { return fs.realpathSync(file); } catch (_) { /* 新規 file はまだ無い */ }
  try { return path.join(fs.realpathSync(path.dirname(file)), path.basename(file)); } catch (_) { return path.resolve(file); }
}
function repoRootOf(file) {
  try { return git(path.dirname(file), ['rev-parse', '--show-toplevel']); } catch (_) { return null; }
}
function loadConfig(root) {
  const def = { exclude: ['slides/_library/corpus.json', 'slides/_library/index.json', '**/out/**', '**/*.png', '**/*.pdf', '**/*.bak', 'node_modules/**'], include: [] };
  try { return Object.assign(def, JSON.parse(fs.readFileSync(path.join(root, 'tools', 'git-attrib', 'config.json'), 'utf8'))); } catch (_) { return def; }
}
/** 最小のグロブ（** と * と ?）。path はリポジトリ相対・/ 区切り */
function globToRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
      else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += /[.+^${}()|[\]\\/]/.test(ch) ? '\\' + ch : ch;
  }
  return new RegExp('^' + re + '$');
}
function excluded(rel, cfg) {
  if (cfg.include && cfg.include.length && !cfg.include.some((g) => globToRe(g).test(rel))) return true;
  return (cfg.exclude || []).some((g) => globToRe(g).test(rel));
}
function off(root) {
  if (process.env.MARP_GIT_ATTRIB === '0' || process.env.MARP_GIT_ATTRIB === 'off') return true;
  return fs.existsSync(path.join(root, '.git-attrib-off'));
}
function inProgress(root) {
  const g = path.join(root, '.git');
  return ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply'].some((n) => fs.existsSync(path.join(g, n)));
}
function tracked(root, rel) { try { git(root, ['ls-files', '--error-unmatch', '--', rel]); return true; } catch (_) { return false; } }
function dirty(root, rel) {
  // 追跡中：作業木が HEAD と違うか（インデックスに上がっている分も含む）。未追跡：存在すれば dirty
  if (!tracked(root, rel)) return fs.existsSync(path.join(root, rel));
  try { git(root, ['diff', '--quiet', 'HEAD', '--', rel]); return false; } catch (_) { return true; }
}
function commitOnly(root, rel, message, author) {
  const args = ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', message, '--only', '--', rel];
  if (author) args.splice(args.indexOf('commit') + 1, 0, `--author=${author}`);
  // 未追跡なら先に add（--only は追跡中の path にしか効かない）
  if (!tracked(root, rel)) git(root, ['add', '--', rel]);
  git(root, args);
}
function shortSha(root) { try { return git(root, ['rev-parse', '--short', 'HEAD']); } catch (_) { return '?'; } }

/** 未コミットの file（追跡中の変更＋未追跡）→ { rel: blobハッシュ }。-z で日本語名も安全に */
function dirtyMap(root, cfg) {
  const out = {};
  let raw = '';
  try { raw = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], { cwd: root, encoding: 'utf8', windowsHide: true }); } catch (_) { return out; }
  for (const rec of raw.split('\0')) {
    if (!rec || rec.length < 4) continue;
    const code = rec.slice(0, 2), rel = rec.slice(3);
    if (!rel || rel.endsWith('/') || code === '!!') continue;
    if (cfg && excluded(rel, cfg)) continue;
    if (code[0] === 'D' || code[1] === 'D') { out[rel] = 'deleted'; continue; }
    try { out[rel] = git(root, ['hash-object', '--', rel]); } catch (_) { out[rel] = 'unreadable'; }
  }
  return out;
}
function stateFile(root, session) {
  const dir = path.join(root, '.git', 'git-attrib');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* .git が無ければ後で失敗する */ }
  return path.join(dir, (session || 'nosession').replace(/[^A-Za-z0-9_-]/g, '_') + '.json');
}
/** Bash / run_command の前後で作業木を比べ、変わった file だけ AI 名義でまとめてコミットする */
function bashHook(input, root, ag) {
  const cmdRaw = String(ag.command || '').trim();
  if (/^git\b/.test(cmdRaw)) return [];
  const cfg = loadConfig(root);
  const session = ag.session;
  const sf = stateFile(root, session);
  if (mode === 'pre') { try { fs.writeFileSync(sf, JSON.stringify({ at: Date.now(), dirty: dirtyMap(root, cfg) })); } catch (_) { /* 控えが取れなければ post は何もしない */ } return []; }
  let before = null;
  try { before = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch (_) { before = null; }
  try { fs.unlinkSync(sf); } catch (_) { /* 無ければよい */ }
  if (!before || !before.dirty) return [];                         // 前の控えが無い（pre が走らなかった）ときは、誰の変更か判らないので触らない
  const after = dirtyMap(root, cfg);
  const changed = Object.keys(after).filter((rel) => after[rel] !== 'deleted' && after[rel] !== 'unreadable' && before.dirty[rel] !== after[rel] && !rel.startsWith('.git/'));
  if (!changed.length) return [];
  for (const rel of changed) if (!tracked(root, rel)) git(root, ['add', '--', rel]);
  const cmd = cmdRaw.split('\n')[0].slice(0, 80);
  const msg = `[${ag.tag}] ${ag.tool} ${changed.length === 1 ? changed[0] : '(' + changed.length + ' files)'}\n\n` + changed.map((r) => '- ' + r).join('\n') + `\n\n${ag.label}-Session: ${session || '-'}\n${ag.label}-Tool: ${ag.tool}\n${ag.label}-Command: ${cmd.replace(/\s+/g, ' ')}`;
  git(root, ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', `--author=${ag.author}`, '-m', msg, '--only', '--'].concat(changed));
  return [`post ${shortSha(root)} [${ag.tag}] ${ag.tool} ${changed.join(' ')}`];
}

function bashRootsOf(input, ag) {
  const candidates = [];
  if (input && input.cwd) candidates.push(String(input.cwd));
  if (input && Array.isArray(input.workspacePaths)) for (const w of input.workspacePaths) if (typeof w === 'string' && w) candidates.push(w);
  if (ag && ag.command) {
    const m = ag.command.match(/\/Users\/[^\s"'`;|&<>]+/g) || [];
    for (const p of m) candidates.push(p);
  }
  candidates.push(process.cwd());
  const roots = new Set();
  for (const c of candidates) {
    try {
      const resolved = realOf(path.resolve(c));
      const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
      const probe = stat && stat.isDirectory() ? resolved + path.sep + 'x' : resolved;
      const r = repoRootOf(probe);
      if (r) roots.add(r);
    } catch (_) { /* ignore */ }
  }
  return Array.from(roots);
}

function filesOf(input) {
  const ti = (input && input.tool_input) || (input && input.toolCall && input.toolCall.args) || {};
  const out = [];
  if (typeof ti.file_path === 'string') out.push(ti.file_path);
  if (typeof ti.Path === 'string') out.push(ti.Path);
  if (typeof ti.TargetFile === 'string') out.push(ti.TargetFile);
  if (typeof ti.notebook_path === 'string') out.push(ti.notebook_path);
  if (Array.isArray(ti.edits)) for (const e of ti.edits) if (e && typeof e.file_path === 'string') out.push(e.file_path);
  return Array.from(new Set(out.map((f) => realOf(path.resolve(f)))));
}

function finish(ag, log) {
  if (ag && ag.isArgon) {
    process.stdout.write((mode === 'pre' ? JSON.stringify({ decision: 'allow' }) : '{}') + '\n');
    return;
  }
  if (log && log.length) process.stdout.write(log.join('\n') + '\n');
}

function main() {
  if (mode === 'status') return status();
  if (mode !== 'pre' && mode !== 'post') { console.error('usage: hook.mjs pre|post|status'); process.exit(0); }
  let input = null;
  try { input = JSON.parse(readStdin() || '{}'); } catch (_) { input = {}; }
  const ag = agentOf(input);
  if (ag.isBashTool) {
    const log = [];
    for (const root of bashRootsOf(input, ag)) {
      if (!root || off(root) || inProgress(root)) continue;
      try { log.push(...bashHook(input, root, ag)); } catch (e) { process.stderr.write(`[git-attrib] bash ${mode}: ${String(e && e.stderr || e && e.message || e).trim()}\n`); }
    }
    return finish(ag, log);
  }
  if (!ag.isFileTool) return finish(ag, []);
  const files = filesOf(input);
  if (!files.length) return finish(ag, []);
  const session = ag.session;
  const log = [];
  for (const abs of files) {
    const root = repoRootOf(abs);
    if (!root || off(root) || inProgress(root)) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (rel.startsWith('..') || rel.startsWith('.git/')) continue;
    const cfg = loadConfig(root);
    if (excluded(rel, cfg)) continue;
    try {
      if (mode === 'pre') {
        // 先生の手直しの自動スナップショット：追跡中で、HEAD と違う file だけ。未追跡の新規 file は（誰の物か分からないので）触らない
        if (tracked(root, rel) && dirty(root, rel)) {
          commitOnly(root, rel, `手直し: ${rel}（${ag.label} が書く前の自動スナップショット）`, null);
          log.push(`pre  ${shortSha(root)} 手直し ${rel}`);
        }
      } else {
        if (!dirty(root, rel)) continue;
        const msg = `[${ag.tag}] ${ag.tool} ${rel}\n\n${ag.label}-Session: ${session || '-'}\n${ag.label}-Tool: ${ag.tool}`;
        commitOnly(root, rel, msg, ag.author);
        log.push(`post ${shortSha(root)} [${ag.tag}] ${rel}`);
      }
    } catch (e) {
      // 失敗しても AI の作業は止めない（stderr に理由だけ残す）
      process.stderr.write(`[git-attrib] ${mode} ${rel}: ${String(e && e.stderr || e && e.message || e).trim()}\n`);
    }
  }
  return finish(ag, log);
}

function status() {
  const root = repoRootOf(process.cwd()) || process.cwd();
  const n = (args) => { try { return git(root, args).split('\n').filter(Boolean).length; } catch (_) { return 0; } };
  const since = process.argv[3] || '30 days ago';
  const claudeN = n(['log', '--since=' + since, '--author=noreply@anthropic.com', '--format=%h']);
  const argonN = n(['log', '--since=' + since, '--perl-regexp', '--author=(?:gemini-code-assist|argon|antigravity|noreply@(?:google|deepmind)\\.com)', '--format=%h']);
  const humanN = n(['log', '--since=' + since, '--format=%h', '--perl-regexp', '--author=^(?!.*(?:noreply@anthropic\\.com|gemini-code-assist|(?:argon|antigravity|noreply)@(?:google|deepmind)\\.com))']);
  console.log(`リポジトリ: ${root}`);
  console.log(`フック: ${off(root) ? '停止中（MARP_GIT_ATTRIB=0 か .git-attrib-off）' : '有効'}`);
  console.log(`直近（${since}〜）のコミット: Claude ${claudeN} 件 / Argon ${argonN} 件 / それ以外（先生） ${humanN} 件`);
  console.log('確かめ方: git log --author=noreply@anthropic.com --stat | head   /   git log --author=gemini-code-assist --stat | head');
}

main();
