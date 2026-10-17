# Contributing to marp-GUI

[日本語は下にあります](#日本語)

Thank you for your interest. marp-GUI is maintained by one person at a university, so the process is kept simple.

## Reporting a problem

Open a GitHub issue with:

- your OS and versions (`node -v`, VS Code → About, Chrome or Edge version),
- the smallest deck (`.md`) that shows the problem, or the slide number in one of the sample decks in `slides/`,
- what you did, what you expected, and what happened (a screenshot of the preview helps).

Do not attach decks that contain confidential material.

## Running the checks

```bash
npm ci
npm ci --prefix tools/marp-scroll-sync
npm run lint -- slides      # design-rule lint on the sample decks
npm test                    # 324 tests; Chrome-driven tests are skipped when Chrome is not found
```

GitHub Actions runs the same commands on Ubuntu, macOS and Windows with Node 20 and 22 (`.github/workflows/test.yml`).

## Changing code

- Keep the source of a deck the only state: every preview gesture must become one small edit of the Markdown, applied only when its position is uniquely determined, and undoable in one step. `tools/marp-scroll-sync/DESIGN.md` (Japanese) and `docs/DESIGN.en.md` (English summary) describe these invariants.
- Logic that does not need the VS Code API belongs in `tools/marp-scroll-sync/lib/*.cjs` (pure modules with tests); VS Code-specific code stays in `extension.js` and `lib/*-vscode.cjs`.
- Add or update a test in `tools/marp-scroll-sync/test/` for every behaviour you change, and run `npm test` before opening a pull request.
- New source files start with `SPDX-License-Identifier: Apache-2.0` and the copyright line used in the existing files.
- By contributing you agree that your contribution is licensed under the Apache License 2.0.

## 日本語

不具合の報告は GitHub の issue へ。OS と各ソフトの版、問題が出る最小のデック（または `slides/` の見本デックのスライド番号）、操作・期待・結果を書いてください。機密を含むデックは添付しないでください。

コードを変えるときは、原稿（Markdown）だけが状態であること（プレビューの操作は、位置が一意に決まるときだけ、取り消し 1 回で戻る小さな編集として原稿に書く）を守り、変えた振る舞いのテストを `tools/marp-scroll-sync/test/` に足して `npm test` を通してください。新しいソースの先頭には SPDX 行と著作権行を書きます。貢献は Apache License 2.0 で提供されるものとします。
