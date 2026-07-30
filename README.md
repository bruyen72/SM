# SM

Script que busca os jogos de futebol do dia no Sofascore e aponta os que tem
mais chance de terminar com mais de 2,5 gols, com base na media de gols
marcados por cada time nos ultimos jogos.

## Arquivos

- `sofascore-gols.js` - script principal (Node.js 18+)
- `rodar.bat` - roda o script e publica o resultado no GitHub Pages
- `docs/index.html` - relatorio visual mais recente (publicado pelo GitHub Pages)

## Uso

```
node sofascore-gols.js
```

Gera um `.csv`, um `.html` com o relatorio visual (escudo dos times, media de
gols, selo de forca) e atualiza `docs/index.html`.
