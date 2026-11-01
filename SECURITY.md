# Security Policy

[日本語は下にあります](#日本語)

## Supported versions

| Version | Supported |
|---|---|
| 1.1.x | Yes |
| < 1.1 | No |

The version is the one in the root `package.json`; the themes, tools and both VS Code extensions are released together from this repository.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub: on the repository page open the **Security** tab and choose **Report a vulnerability** (GitHub Security Advisories). Include the version or commit, your OS, the steps to reproduce, and, if needed, the smallest deck (`.md`) that shows the problem. marp-GUI is maintained by one person, so responses are on a best-effort basis.

## Trust boundary

Decks are rendered with HTML enabled (Marp's `--html`), so a deck's own HTML and `<script>` run as written in the presentation HTML and in the PNG/PDF exports (the VS Code preview blocks them with a nonce-only Content Security Policy): open and export only decks you trust, as you would an HTML file. The PDF export and the presentation command start Chrome without file-access flags (no `--allow-file-access-from-files`, and the sandbox stays on unless you set `MARP_PDF_NO_SANDBOX=1`), so a deck's script cannot read other local files through `file://` URLs.

The VS Code extensions run only the Node scripts that ship with this repository (`tools/marp-library.mjs`, `tools/marp-present/present.mjs`), started with an argument array and no shell; scripts inside a deck's folder are never run. Both extensions are disabled in Restricted Mode (untrusted workspaces) and on virtual file systems.

## Known advisories in dependencies

`npm audit` on `package-lock.json` (2026-10-31, after the non-breaking `npm audit fix`, which updated `markdown-it` to 14.3.3, `@xmldom/xmldom` to 0.9.12, `speech-rule-engine` to 4.1.5 and `ip-address` to 10.7.5; on 2026-10-18 it had updated `source-map-js` to 1.2.2) reports 12 entries: 2 low, 10 high, 0 critical. All of them come from two upstream chains that cannot be fixed inside the current version ranges; `@marp-team/marp-cli` 4.5.1 and `@marp-team/marp-core` 4.4.0 are the latest releases. The extension's own lockfile (`tools/marp-scroll-sync/package-lock.json`) reports 2 low entries (the `katex` chain).

| Chain | Advisories | Why it stays |
|---|---|---|
| `puppeteer-core` 24.43.1 → `@puppeteer/browsers` 2.13.2 → `extract-zip` 2.0.1; → `proxy-agent` 6.5.0 → `pac-proxy-agent` 7.2.0 → `get-uri` 6.0.5 → `basic-ftp` 5.3.1; and `puppeteer-core` → `chromium-bidi` → `zod` (high) | extract-zip [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv), [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3); basic-ftp [GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r); zod [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | npm's fix is `puppeteer-core` 25 (semver-major), but `@marp-team/marp-cli` 4.5.1 requires `puppeteer-core` ^24.43.1. marp-GUI launches the Chrome or Edge that is already installed and never asks puppeteer to download a browser. |
| `@marp-team/marp-core` 4.4.0 → `katex` 0.17.0 (low) | [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) | marp-core requires `katex` ^0.17.0; npm's only suggestion is a downgrade of marp-cli to 0.12.1. |

`@marp-team/marp-cli` (high) and `@marp-team/marp-core` (low) appear in the report only because they depend on the packages above. These will be updated when Marp releases versions that move to the fixed dependencies.

A security review of the package, with the status of each finding, is in [docs/security-review.md](docs/security-review.md).

## 日本語

- **対象の版**：1.1.x（ルートの `package.json` の版。テーマ・ツール・VS Code 拡張 2 つはこのリポジトリから一緒に出します）。
- **報告**：公開の issue には書かず、リポジトリの **Security** タブ →「**Report a vulnerability**」（GitHub Security Advisories）から非公開で送ってください。版またはコミット・OS・再現手順と、必要なら問題が出る最小のデックを添えてください。管理者は 1 人なので、対応はできる範囲で行います。
- **信頼の境界**：デックは HTML を有効にして描くので、発表用 HTML と PNG・PDF の書き出しではデック自身の HTML と `<script>` がそのまま動きます（VS Code のプレビューは nonce だけを許す CSP で止めます）。信頼できるデックだけを開き、書き出してください。PDF の書き出しとプレゼンは、ファイルを読ませる起動オプション（`--allow-file-access-from-files`）を付けずに Chrome を起動し、砂場も切らない（`MARP_PDF_NO_SANDBOX=1` のときだけ切る）ので、デックのスクリプトが `file://` 経由で手元の別のファイルを読むことはできません。VS Code の拡張が動かすのは、このリポジトリに同梱の Node スクリプト（`tools/marp-library.mjs`・`tools/marp-present/present.mjs`）だけで、シェルを通さず引数の配列で起動します。デックのフォルダの中のスクリプトは動かしません。どちらの拡張も、信頼していないフォルダ（制限モード）と仮想ファイルシステムでは動きません。
- **依存パッケージの既知の勧告**：上の表のとおり 12 件（低 2・高 10。2026-10-31、範囲の中で直せる物は `npm audit fix` で直した後）。Marp 側（marp-cli・marp-core）の範囲の中では直せないもので、Marp が新しい版を出したら更新します。拡張の lockfile は低 2 件。
- **セキュリティの点検**：項目ごとの状態（直した・まだ直していない）は [docs/security-review.md](docs/security-review.md)（英語）。
