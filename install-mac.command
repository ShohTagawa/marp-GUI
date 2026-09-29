#!/bin/bash
# marp-GUI インストーラー（mac）。Finder でダブルクリック（初回は右クリック →「開く」）。
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。開いたページから LTS 版を入れてから、もう一度ダブルクリックしてください。"
  open "https://nodejs.org/ja/download"
  read -r -p "Enter で閉じます" _; exit 1
fi
if ! node tools/setup.mjs; then read -r -p "エラーがありました。Enter で閉じます" _; exit 1; fi
DECK="$PWD/slides/sample-layouts/sample-layouts.md"
if command -v code >/dev/null 2>&1; then
  code "$PWD" "$DECK"
elif [ -d "/Applications/Visual Studio Code.app" ]; then
  open -a "Visual Studio Code" "$PWD"
else
  echo "VS Code が見つかりません。https://code.visualstudio.com/ から入れて、このフォルダを開いてください。"
fi
read -r -p "Enter で閉じます" _
