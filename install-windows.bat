@echo off
REM SPDX-License-Identifier: Apache-2.0
REM Copyright (c) 2026 Shoh Tagawa
rem marp-GUI インストーラー（Windows）。エクスプローラーでダブルクリック。
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。開いたページから LTS 版を入れてから、もう一度ダブルクリックしてください。
  start "" "https://nodejs.org/ja/download"
  pause
  exit /b 1
)
node tools\setup.mjs
if errorlevel 1 (
  echo エラーがありました。
  pause
  exit /b 1
)
where code >nul 2>nul
if errorlevel 1 (
  echo VS Code を起動して、このフォルダ（%CD%）を開いてください。
) else (
  call code "%CD%" "%CD%\slides\sample-layouts\sample-layouts.md"
)
pause
