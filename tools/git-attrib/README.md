# git-attrib — Claude / Argon（AI）の編集と先生の編集を git で分ける

Claude Code や Argon（Antigravity IDE / CLI）と先生が同じ作業木を触ると、git の履歴では区別がつかない（コミットするのは先生なので author は全部先生）。
このフックは **AI が原稿に書いた単位でコミットを分け、author を Claude 名義または Argon 名義にする**。先生の手直し（エディタ・同期プレビュー・CLI）は、AI が同じ file を書く直前に先生名義で自動スナップショットされるので、AI の差分に混ざらない。

## 仕組み（Claude Code: `.claude/settings.json` ／ Antigravity: `.agents/hooks.json`）

| いつ | 何をする | 名義 |
|---|---|---|
| **PreToolUse**（Edit／Write／MultiEdit／NotebookEdit／`edit_file`／`write_file` の直前） | これから書く file に未コミットの変更があれば、その file だけ `git commit --only -- <file>` | 先生（git の既定の user） |
| **PostToolUse**（同・直後） | 書いた file だけ `git commit --only -- <file>`。新規 file は add してから | **Claude Code \<noreply@anthropic.com\>** ／ **Argon \<200291788+gemini-code-assist@users.noreply.github.com\>** |

- コミット文：`[claude] Edit slides/…/x.md`（トレーラー `Claude-Session: <id>`／`Claude-Tool: Edit`）または `[argon] edit_file slides/…/x.md`（トレーラー `Argon-Session: <id>`／`Argon-Tool: edit_file`）。先生側は `手直し: slides/…/x.md（Claude / Argon が書く前の自動スナップショット）`。
- committer は先生のまま（author だけ AI）。GitHub 上では Claude のコミットに `@claude` のロゴ、Argon のコミットに `@gemini-code-assist`（Gemini スパークルロゴ）が表示され、Contributors にも自動で並ぶ。`git log --author=noreply@anthropic.com` で Claude の分、`git log --author=gemini-code-assist` で Argon の分、`git log --perl-regexp --author='^(?!.*(?:anthropic|gemini-code-assist|google\.com))'` で先生の分。
- **他の file には触れない**（`--only`）。先生が別の file を未コミットのまま置いていても巻き込まない。
- 未追跡の新規 file は pre では触らない（誰の物か分からない）。post では Claude が作った物なので add して Claude 名義で入れる。
- merge／rebase／cherry-pick の途中は何もしない。リポジトリの外・`.git/` 配下も対象外。
- 失敗しても Claude の作業は止めない（stderr に `[git-attrib] …` と理由を出すだけ）。

## 対象外（`tools/git-attrib/config.json`）

```json
{ "exclude": ["slides/_library/corpus.json", "**/out/**", "**/*.png", "**/*.pdf", "**/*.bak", "**/*.mp4", "node_modules/**", "package-lock.json"], "include": [] }
```

生成物（PNG・PDF・索引）はコミットしない。`include` を書くと、それに合う path だけが対象になる（例：`["slides/**", "docs/**"]`）。グロブは `**`・`*`・`?`。

## 止める・確かめる

```bash
MARP_GIT_ATTRIB=0 claude          # この起動の間だけ止める
touch .git-attrib-off             # リポジトリ単位で止める（消せば戻る）
node tools/git-attrib/hook.mjs status   # 有効か・直近 30 日の Claude／先生のコミット数
npm run test:attrib               # 通し試験（一時リポジトリで pre→post を流す）
```

## 索引・集計との関係

- `tools/marp-scroll-sync/lib/corpus-core.cjs` の `churnOf` は版の author を読み、Claude 名義の版を除いた **`human`**（先生の回数・行数）を別に数える（`entry.churn.human`）。未コミットの手直しは先生の分。
- `npm run revision-stats` の表に「先生の手直し(枚/行)」列が出る。ホーム画面の「手を入れた順」にも「先生が直した回数」の並べ替えと、カードの「n回（先生 m）」が出る。
- **導入前の履歴は全部「先生」に入る**（区別する情報が無い）。分かれるのは導入後のコミットから。

## 注意

- コミットが細かく増える。歴史をまとめたいときは、push 前に `git rebase -i` で `[claude]` を squash してよい（author は残らないので、まとめるなら「先生の手直し」と混ぜない単位で）。
- Claude が書いた直後に先生がすぐ同じ file を直し、その後 Claude がまた書く、という往復はそのまま交互のコミットになる。これが狙い（添削の 1 往復が 1 対のコミットで残る）。
- `saveAfterEdit`（同期プレビューの即保存）とは独立。GUI の編集は保存されるだけで、コミットは次に Claude が触るときか、先生が自分でコミットするときに先生名義で入る。
