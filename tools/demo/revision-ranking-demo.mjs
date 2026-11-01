#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// Revision-ranking demo (npm run demo:ranking).
//
// The library ranks slides by how often they were revised in git. A ZIP download has no history,
// so this script builds one: it copies the sample deck into a temporary git repository, commits
// synthetic revisions (slide A three times, slide B once; the deck's two library marks are removed
// in the copy so that only revisions count), rebuilds the slide index with
// `tools/marp-library.mjs corpus` and lists the most revised slides with `search` (no query =
// "most revised first"). Expected order: A (3 revisions), then B (1), then unrevised slides.
// Nothing in this repository is written; the temporary repository is removed at the end
// (pass --keep to keep it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DECK = 'sample-hydrogen';
const keep = process.argv.includes('--keep');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name === 'out' || e.name.startsWith('.')) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else if (e.isFile()) fs.copyFileSync(a, b);
  }
}
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const lib = (repo, args) => execFileSync(process.execPath, [path.join(ROOT, 'tools', 'marp-library.mjs'), '--root', repo, ...args],
  { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Slide i (1-based) of a deck: [start, end) offsets of its body, split on lines that are exactly '---' outside the front matter */
function slideBounds(text) {
  const lines = text.split('\n'); const starts = []; let off = 0, inFront = false, seps = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    if (i === 0 && l === '---') { inFront = true; } else if (inFront && l === '---') { inFront = false; starts.push(off + lines[i].length + 1); }
    else if (!inFront && l === '---') { seps++; starts.push(off + lines[i].length + 1); }
    off += lines[i].length + 1;
  }
  return starts;
}
/** Append one line to the last bullet of slide n (1-based); returns the slide title */
function reviseSlide(file, n, line) {
  const text = fs.readFileSync(file, 'utf8');
  const starts = slideBounds(text);
  const s = starts[n - 1], e = n < starts.length ? starts[n] : text.length;
  const body = text.slice(s, e);
  const title = (/^##?\s+(.+)$/m.exec(body) || [, '(untitled)'])[1];
  const lines = body.split('\n');
  let last = -1; lines.forEach((l, i) => { if (/^- /.test(l)) last = i; });
  if (last < 0) throw new Error(`slide ${n} has no bullet to revise`);
  lines.splice(last + 1, 0, line);
  fs.writeFileSync(file, text.slice(0, s) + lines.join('\n') + text.slice(e));
  return title;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-gui-ranking-'));
const repo = path.join(tmp, 'repo');
let ok = false;
try {
  console.log(`Temporary repository: ${repo}`);
  copyDir(path.join(ROOT, 'theme'), path.join(repo, 'theme'));
  copyDir(path.join(ROOT, 'slides', 'assets'), path.join(repo, 'slides', 'assets'));
  copyDir(path.join(ROOT, 'slides', DECK), path.join(repo, 'slides', DECK));
  const md = path.join(repo, 'slides', DECK, DECK + '.md');
  // The sample deck carries two library marks (_lib, "finished"), which the ranking puts first.
  // Remove them in the copy so that only the revision count orders the slides.
  fs.writeFileSync(md, fs.readFileSync(md, 'utf8').replace(/^_lib:.*\r?\n/gm, ''));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Demo Author']);
  git(repo, ['config', 'user.email', 'demo@example.org']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['add', '-A']); git(repo, ['commit', '-q', '-m', 'Add the sample deck']);

  const A = 2, B = 7;   // slide numbers (1-based) that get revised
  let titleA, titleB;
  for (let k = 1; k <= 3; k++) {
    titleA = reviseSlide(md, A, `- Revision ${k} of this slide`);
    git(repo, ['commit', '-q', '-am', `Revise slide ${A} (${k}/3)`]);
  }
  titleB = reviseSlide(md, B, '- One revision of this slide');
  git(repo, ['commit', '-q', '-am', `Revise slide ${B}`]);
  console.log(`Committed 3 revisions of slide ${A} ("${titleA}") and 1 revision of slide ${B} ("${titleB}").\n`);
  console.log(git(repo, ['log', '--oneline']).split('\n').map(l => '  ' + l).join('\n') + '\n');

  console.log('$ node tools/marp-library.mjs corpus');
  lib(repo, ['corpus']);
  console.log('$ node tools/marp-library.mjs search --top 5 --json   (no query: most revised first)\n');
  const items = JSON.parse(lib(repo, ['search', '--top', '5', '--json']));
  console.log('| Rank | Slide | Title | Revisions (versions in which the slide changed) |');
  console.log('|---|---|---|---|');
  items.forEach((e, i) => console.log(`| ${i + 1} | ${e.slide} | ${e.title} | ${e.churn ? e.churn.touched : 0} |`));
  const t = items.map(e => (e.churn ? e.churn.touched : 0));
  ok = items.length >= 3 && items[0].slide === A && items[1].slide === B && t[0] > t[1] && t[1] > (t[2] || 0) && t.slice(2).every(x => x === 0);
  console.log('\n' + (ok
    ? `OK: slide ${A} (revised ${t[0]} times) is listed before slide ${B} (revised ${t[1]} time), which is listed before unrevised slides.`
    : 'UNEXPECTED ORDER: see the table above.'));
} finally {
  if (keep) console.log(`(kept ${tmp})`); else fs.rmSync(tmp, { recursive: true, force: true });
}
process.exitCode = ok ? 0 : 1;
