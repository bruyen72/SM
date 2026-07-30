@echo off
cd /d "%~dp0"
node sofascore-gols.js
git add docs
git commit -m "atualiza jogos automatico"
git push origin main
