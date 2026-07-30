@echo off
cd /d "%~dp0"
echo ==== %date% %time% ==== >> execucao.log
node sofascore-gols.js >> execucao.log 2>&1
git add docs
git commit -m "atualiza jogos automatico" >> execucao.log 2>&1
git push origin main >> execucao.log 2>&1
