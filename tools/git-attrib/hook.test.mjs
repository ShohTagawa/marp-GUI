// tools/git-attrib/hook.mjs の通し試験：一時の git リポジトリで pre（先生名義の自動スナップショット）と post（Claude 名義のコミット）を確かめる。
// 実行: node --test tools/git-attrib/hook.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'hook.mjs');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-attrib-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Shoh Tagawa']);
  git(root, ['config', 'user.email', 'tagawa@example.ac.jp']);
  fs.mkdirSync(path.join(root, 'slides', 'd'), { recursive: true });
  fs.writeFileSync(path.join(root, 'slides', 'd', 'd.md'), '# one\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'readme\n');
  git(root, ['add', '-A']); git(root, ['commit', '-q', '-m', 'init']);
  return root;
}
function run(mode, input, env) {
  const r = spawnSync(process.execPath, [HOOK, mode], { input: JSON.stringify(input), encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const last = (root, fmt) => git(root, ['log', '-1', `--format=${fmt}`]);
const count = (root) => Number(git(root, ['rev-list', '--count', 'HEAD']));
const input = (root, tool, rel, sid) => ({ session_id: sid || 'sess-1234567890abc', tool_name: tool, tool_input: { file_path: path.join(root, rel) } });

test('pre：Claude が書く前に、その file の未コミットの手直しを先生名義でコミットする。他の file には触れない', () => {
  const root = mkRepo();
  fs.writeFileSync(path.join(root, 'slides', 'd', 'd.md'), '# one\n\n手直し\n');     // 先生の手直し（未コミット）
  fs.writeFileSync(path.join(root, 'README.md'), 'readme 2\n');                       // 別 file の未コミット（触らない）
  const r = run('pre', input(root, 'Edit', 'slides/d/d.md'));
  assert.equal(r.code, 0, r.err);
  assert.equal(count(root), 2);
  assert.match(last(root, '%s'), /^手直し: slides\/d\/d\.md/);
  assert.equal(last(root, '%ae'), 'tagawa@example.ac.jp');
  assert.match(git(root, ['status', '--porcelain']), /^ ?M README\.md$/m, '別 file はそのまま（未コミット）');
  fs.rmSync(root, { recursive: true, force: true });
});

test('pre：変更が無ければ何もしない。未追跡の新規 file にも触れない', () => {
  const root = mkRepo();
  const r1 = run('pre', input(root, 'Edit', 'slides/d/d.md'));
  assert.equal(r1.code, 0); assert.equal(count(root), 1);
  fs.writeFileSync(path.join(root, 'slides', 'd', 'new.md'), 'x\n');
  const r2 = run('pre', input(root, 'Write', 'slides/d/new.md'));
  assert.equal(r2.code, 0); assert.equal(count(root), 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('post：Claude が書いた file を Claude 名義でコミットし、トレーラーにセッションと tool を残す。新規 file も add して入れる', () => {
  const root = mkRepo();
  fs.writeFileSync(path.join(root, 'slides', 'd', 'd.md'), '# one\n\nby claude\n');
  const r = run('post', input(root, 'Edit', 'slides/d/d.md', 'abcdef123456XYZ'));
  assert.equal(r.code, 0, r.err);
  assert.equal(count(root), 2);
  assert.equal(last(root, '%an'), 'Claude Code');
  assert.equal(last(root, '%ae'), 'noreply@anthropic.com');
  assert.equal(last(root, '%ce'), 'tagawa@example.ac.jp', 'committer は先生のまま（author だけ Claude）');
  assert.match(last(root, '%s'), /^\[claude\] Edit slides\/d\/d\.md$/);
  assert.match(last(root, '%b'), /Claude-Session: abcdef123456/);
  assert.match(last(root, '%b'), /Claude-Tool: Edit/);
  fs.writeFileSync(path.join(root, 'slides', 'd', 'fresh.md'), 'new deck\n');
  const r2 = run('post', input(root, 'Write', 'slides/d/fresh.md'));
  assert.equal(r2.code, 0, r2.err);
  assert.equal(count(root), 3);
  assert.equal(last(root, '%ae'), 'noreply@anthropic.com');
  assert.equal(git(root, ['status', '--porcelain']).trim(), '', '全部コミット済み');
  fs.rmSync(root, { recursive: true, force: true });
});

test('pre → post の流れ：先生の手直しと Claude の書き込みが別のコミットに分かれる', () => {
  const root = mkRepo();
  const f = path.join(root, 'slides', 'd', 'd.md');
  fs.writeFileSync(f, '# one\n\n先生の行\n');
  run('pre', input(root, 'Edit', 'slides/d/d.md'));
  fs.writeFileSync(f, '# one\n\n先生の行\n\nClaude の行\n');
  run('post', input(root, 'Edit', 'slides/d/d.md'));
  const log = git(root, ['log', '--format=%ae|%s']).split('\n');
  assert.equal(log.length, 3);
  assert.match(log[0], /^noreply@anthropic\.com\|\[claude\] Edit/);
  assert.match(log[1], /^tagawa@example\.ac\.jp\|手直し:/);
  const claudeDiff = git(root, ['show', '--format=', 'HEAD']);
  assert.ok(/\+Claude の行/.test(claudeDiff) && !/\+先生の行/.test(claudeDiff), 'Claude のコミットには Claude の行だけ');
  fs.rmSync(root, { recursive: true, force: true });
});

test('対象外：編集以外の tool、除外パターン（out/・png）、停止スイッチ、リポジトリの外', () => {
  const root = mkRepo();
  fs.writeFileSync(path.join(root, 'slides', 'd', 'd.md'), '# one\n\nx\n');
  assert.equal(count(root), 1);
  run('post', input(root, 'Read', 'slides/d/d.md')); assert.equal(count(root), 1, 'Read では何もしない');
  fs.mkdirSync(path.join(root, 'slides', 'd', 'out'), { recursive: true });
  fs.writeFileSync(path.join(root, 'slides', 'd', 'out', 'x.png'), 'png');
  run('post', input(root, 'Write', 'slides/d/out/x.png')); assert.equal(count(root), 1, 'out/ の生成物は除外');
  run('post', input(root, 'Edit', 'slides/d/d.md'), { MARP_GIT_ATTRIB: '0' }); assert.equal(count(root), 1, '環境変数で停止');
  fs.writeFileSync(path.join(root, '.git-attrib-off'), '');
  run('post', input(root, 'Edit', 'slides/d/d.md')); assert.equal(count(root), 1, '.git-attrib-off で停止');
  fs.unlinkSync(path.join(root, '.git-attrib-off'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
  fs.writeFileSync(path.join(outside, 'a.md'), 'a');
  const r = run('post', input(outside, 'Edit', 'a.md'));
  assert.equal(r.code, 0, 'リポジトリの外でも落ちない');
  run('post', input(root, 'Edit', 'slides/d/d.md')); assert.equal(count(root), 2, '条件が揃えばコミットする');
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
});

test('MultiEdit：edits[] の file_path も拾う。壊れた入力でも落ちない', () => {
  const root = mkRepo();
  fs.writeFileSync(path.join(root, 'slides', 'd', 'd.md'), '# one\n\nm\n');
  const r = run('post', { session_id: 's', tool_name: 'MultiEdit', tool_input: { file_path: path.join(root, 'slides/d/d.md'), edits: [{ file_path: path.join(root, 'slides/d/d.md') }] } });
  assert.equal(r.code, 0); assert.equal(count(root), 2);
  const bad = spawnSync(process.execPath, [HOOK, 'post'], { input: 'not json', encoding: 'utf8' });
  assert.equal(bad.status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Bash：実行前後の作業木を比べ、変わった file だけ Claude 名義でまとめてコミット。元から未コミットの file（先生）は残す', () => {
  const root = mkRepo();
  fs.writeFileSync(path.join(root, 'README.md'), 'readme by teacher\n');                 // 先生の未コミット（Bash は触らない）
  const bash = (cmd) => ({ session_id: 'sess-bash-1', tool_name: 'Bash', cwd: root, tool_input: { command: cmd } });
  let r = run('pre', bash('echo'));
  assert.equal(r.code, 0, r.err);
  assert.ok(fs.existsSync(path.join(root, '.git', 'git-attrib', 'sess-bash-1.json')), '前の控えができる');
  // Bash が 2 file を変える（1 つは既存・1 つは新規）。生成物（out/）は対象外
  fs.writeFileSync(path.join(root, 'slides', 'd', 'd.md'), '# one\n\nby bash\n');
  fs.writeFileSync(path.join(root, 'slides', 'd', 'new.md'), 'new by bash\n');
  fs.mkdirSync(path.join(root, 'slides', 'd', 'out'), { recursive: true }); fs.writeFileSync(path.join(root, 'slides', 'd', 'out', 'x.png'), 'png');
  r = run('post', bash('cat > x'));
  assert.equal(r.code, 0, r.err);
  assert.equal(count(root), 2);
  assert.equal(last(root, '%ae'), 'noreply@anthropic.com');
  assert.match(last(root, '%s'), /^\[claude\] Bash \(2 files\)$/);
  assert.match(last(root, '%b'), /Claude-Tool: Bash/);
  const files = git(root, ['show', '--format=', '--name-only', 'HEAD']).split('\n').sort();
  assert.deepEqual(files, ['slides/d/d.md', 'slides/d/new.md']);
  assert.match(git(root, ['status', '--porcelain']), /^ ?M README\.md$/m, '先生の未コミットはそのまま');
  assert.ok(!fs.existsSync(path.join(root, '.git', 'git-attrib', 'sess-bash-1.json')), '控えは消える');
  // 何も変えない Bash → コミットしない。pre 無しの post → 触らない
  run('pre', bash('ls')); r = run('post', bash('ls')); assert.equal(count(root), 2);
  fs.writeFileSync(path.join(root, 'slides', 'd', 'd.md'), '# one\n\nby bash 2\n');
  r = run('post', bash('x')); assert.equal(count(root), 2, 'pre の控えが無ければ誰の変更か判らないので触らない');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Argon（Antigravity）：toolCall 入力で pre は {"decision":"allow"}、post は Argon 名義でコミットして {} を返す', () => {
  const root = mkRepo();
  const f = path.join(root, 'slides', 'd', 'd.md');
  const agInput = (tool, rel) => ({
    conversationId: 'd7088738-cbc3-4426-a84c-ee26707f3e1e',
    workspacePaths: [root],
    toolCall: { name: tool, args: { Path: path.join(root, rel) } },
  });
  fs.writeFileSync(f, '# one\n\n先生の行\n');
  const preRes = run('pre', agInput('edit_file', 'slides/d/d.md'));
  assert.equal(preRes.code, 0, preRes.err);
  assert.deepEqual(JSON.parse(preRes.out.trim()), { decision: 'allow' });
  assert.match(last(root, '%s'), /^手直し: slides\/d\/d\.md（Argon が書く前の自動スナップショット）$/);
  assert.equal(last(root, '%ae'), 'tagawa@example.ac.jp');

  fs.writeFileSync(f, '# one\n\n先生の行\n\nArgon の行\n');
  const postRes = run('post', agInput('edit_file', 'slides/d/d.md'));
  assert.equal(postRes.code, 0, postRes.err);
  assert.deepEqual(JSON.parse(postRes.out.trim()), {});
  assert.equal(last(root, '%an'), 'Argon');
  assert.equal(last(root, '%ae'), '200291788+gemini-code-assist@users.noreply.github.com');
  assert.match(last(root, '%s'), /^\[argon\] edit_file slides\/d\/d\.md$/);
  assert.match(last(root, '%b'), /Argon-Session: d7088738-cbc/);
  assert.match(last(root, '%b'), /Argon-Tool: edit_file/);
  fs.rmSync(root, { recursive: true, force: true });
});
