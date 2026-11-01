# Security review

This page summarises a security review of marp-GUI 1.1.0 (root `package.json` 1.1.0; synchronized-preview extension `marp-scroll-sync` 0.4.0; PDF/present extension `marp-gui-pdf` 1.4.0). How to report a problem, the trust boundary and the dependency advisories are in [SECURITY.md](../SECURITY.md).

- **How it was done.** The review was carried out on 18 October 2026 from the stance of an external reviewer, with an LLM coding agent (Claude Code) reading the code and running harmless probes against a scratch copy of the extension under the VS Code stub used by the tests. No attacker-supplied code was executed. The status column below was re-checked against the code on 31 October 2026, after SEC-01, SEC-02 and SEC-04 were fixed that day.
- **Scope.** Everything in this repository: the themes, the synchronized-preview extension (direct editing, slide operations, box editing, layout variants, folding, library and slide index, insert popup, home screen, overflow marks), the PDF/present extension, the command-line tools (`marp-png.mjs`, `marp-pdf/`, `marp-present/`, `marp-library.mjs`, `tsutawaru-lint.mjs`, `tools/lib/marp-env.mjs`), the installers and `tools/setup.mjs`, the npm dependencies and the git history.

## Threat model

1. A hostile deck (`.md`), or a deck received as a folder, opened in VS Code with the extensions active. Decks are rendered with HTML enabled, and a deck's folder name, file name and sibling files are chosen by whoever sent it.
2. The PDF, PNG and present commands, which start Chrome or Edge.
3. The command-line tools: path handling, child processes, `git`.
4. The installers: what they write and link.
5. The supply chain: dependencies and install scripts.
6. Secrets and personal data in the repository and its history.
7. The extension manifests: activation, workspace trust, setting scopes.

## Findings

| ID | Severity | Finding (as found on 18 Oct 2026) | Status (31 Oct 2026) |
|---|---|---|---|
| SEC-01 | Critical | The slide index is rebuilt in the background by running `tools/marp-library.mjs` with Node. The script is taken from the folder that the extension treats as the repository root, and that root is found by walking up from the deck's own folder to the first folder containing `theme/academic.css`. A deck received as a folder that bundles `theme/academic.css` and its own `tools/marp-library.mjs` therefore gets its own script run when its synchronized preview is opened (`lib/corpus-vscode.cjs` `spawnBuild`, `extension.js` `repoRootFor`). | **Fixed (31 Oct 2026).** The index build (`lib/corpus-vscode.cjs`) and "rebuild library" (`lib/library-vscode.cjs`) run only the `tools/marp-library.mjs` that ships next to the extension (`path.resolve(__dirname, '..', '..', 'marp-library.mjs')`), with an argument array and no shell; the deck's repository is passed as `--root` data, and a `tools/marp-library.mjs` in the deck's folder is only checked for existence, never run. `repoRootFor` no longer walks above the workspace folder that contains the deck (a deck opened without a folder is still looked up to eight levels above it; only data is read there). Regression tests: `wiring.test.cjs` (index build), `library-core.test.cjs` (rebuild library), `cli-tools.test.cjs`. |
| SEC-02 | High | "Present" (`marpScrollSync.present`) writes a command line into an integrated terminal (`sendText`). The deck path is quoted with double quotes only, so `$(…)` or back-ticks in a folder or file name are expanded by the shell. | **Fixed (31 Oct 2026).** "Present" starts the `tools/marp-present/present.mjs` that ships next to the extension with `child_process.spawn(process.execPath, [script, deck, '--page', N])` (no shell, no terminal; output goes to the "Marp Present" output channel), so `$(…)`, back-ticks or `%` in a path are passed through literally; on Windows no `.cmd` is involved. The `npx --yes @marp-team/marp-cli@latest` fallback was removed. Regression test: `wiring.test.cjs` (a deck folder named ``a$(touch PWNED)`id` ``). |
| SEC-03 | High | `marpGui.nodePath` / `marpGui.chromePath` of the PDF/present extension could be set by a workspace's `.vscode/settings.json` and would then be executed. | **Fixed:** both settings have `"scope": "machine"`. Regression test: `cli-tools.test.cjs`. |
| SEC-04 | High | Neither extension declared its workspace-trust and virtual-workspace support. | **Fixed (31 Oct 2026):** both extensions declare `untrustedWorkspaces` and `virtualWorkspaces` as not supported (`capabilities` in each `package.json`, with localised descriptions). Regression tests: `cli-tools.test.cjs` (both manifests). |
| SEC-05 | Medium (Windows only) | When no Chrome, Chromium or Edge is found on Windows, `openInBrowser` hands a `file://` URL to `cmd /c start`; only `&` was escaped. | **Fixed:** cmd metacharacters and stray `%` are percent-encoded before the URL reaches `cmd` (`cmdSafeUrl` in `tools/lib/marp-env.mjs`). Not tested on Windows. |
| SEC-06 | Low | The Webview's Content Security Policy allows only scripts with a per-load nonce (deck `<script>`, event attributes and `javascript:` URLs do not run), but it allows `'unsafe-inline'` styles and `https:`/`data:` images, media and fonts. A deck's CSS can therefore make network requests when previewed. Leaking the nonce does not give code execution, because the deck's HTML is fixed before the nonce exists. | **Open** (documented). |
| SEC-07 | Medium (documented) | Dependency advisories, all transitive through `@marp-team/marp-cli` 4.5.1 / `@marp-team/marp-core` 4.4.0 and not fixable within their version ranges. No package has an install script; every lockfile entry comes from the npm registry with an integrity hash. | **Documented** in [SECURITY.md](../SECURITY.md). |
| SEC-08 | Low | The installers link `tools/marp-scroll-sync` and `tools/marp-pdf/vscode-extension` into `~/.vscode/extensions`, so anyone who can write to this folder can change code that VS Code runs. `setup.mjs` refuses to replace a real folder with a link. | **Documented** (README, section "Contents"). Keep the folder where only you can write. |
| SEC-09 | Info | `shellSync` (used by `setup.mjs` for `npm install`) runs through a shell on Windows. | **Fixed:** it refuses any argument that is not a plain word (`[\w.=:/-]+`). |

## Checked and found safe

- **Direct editing.** Text typed in the preview is escaped for Markdown or encoded as HTML entities before it is written; edits inside code, links, emphasis boundaries, entities or ambiguous positions are refused; the plan is recomputed against the current document and refused if the document changed. A deck cannot use direct editing to insert markup that it did not already contain.
- **Slide operations, layout switching and box editing.** The layout class must match `^lay-[a-z0-9-]+$`; slide operations re-count the slides before writing; box editing writes only `width`, `height` and `translate` into an existing element's `style` attribute (or `w:`/`h:` into a Markdown image) and refuses styles containing quotes.
- **Library insertion.** The source deck must lie inside the repository; copied figures always go to `<target deck>/src/` under a sanitised file name, without `..`; the text is written only if the slide count grows by exactly the number inserted, and copied files are removed again if the write fails.
- **git.** All `git` calls use argument arrays (`execFileSync`), without a shell.
- **Scripts in the preview.** Besides the nonce-only `script-src`, thumbnails in the gallery, the insert popup and the home screen strip `<script>`, `iframe`/`object`/`embed`, `on*` attributes and `javascript:` URLs and are rendered in a Shadow DOM.
- **Messages from the Webview** are dispatched by type; indices and document versions are checked; writes are serialised and re-verified.
- **Chrome flags.** PDF export and presenting start Chrome without `--allow-file-access-from-files` and with the sandbox on (it is turned off only if `MARP_PDF_NO_SANDBOX=1` is set), so a deck's script cannot read other local files through `file://`. `--allow-local-files` is passed only to Marp CLI for rendering images.
- **Command-line tools** build argument arrays and spawn Node without a shell; numeric options are validated; intermediate HTML files are removed on exit.
- **Lint** is read-only and does not follow symbolic links.
- **Secrets.** No tokens, keys or passwords in the tracked files.

## Advice for users

- When VS Code asks whether you trust a folder you received, trust it only if you know where it came from; in Restricted Mode the extensions stay off (SEC-04). A deck is still HTML: preview and export only decks you trust.
- Previewing a deck can make network requests (SEC-06); the preview is not offline-only for untrusted decks.
- Keep this folder where only you can write (SEC-08).
- On Windows, install Chrome or Edge so that the `cmd start` fallback is never used (SEC-05).
