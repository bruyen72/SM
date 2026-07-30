#!/usr/bin/env node
/**
 * sofascore-gols.js
 * ------------------------------------------------------------
 * Busca os jogos de futebol do dia no Sofascore (API não oficial)
 * e calcula, com base nos últimos jogos de cada time, quais
 * partidas têm maior chance de terminar com MAIS de 2,5 gols.
 *
 * Foco: só times que fazem MUITO gol. Times "fracos no ataque"
 * são simplesmente ignorados (não entram na lista final).
 *
 * Requisitos: Node.js 18 ou mais novo (usa fetch nativo).
 *
 * USO:
 *   node sofascore-gols.js                  -> jogos de hoje
 *   node sofascore-gols.js 2026-07-31       -> jogos de uma data
 *   node sofascore-gols.js --min 3          -> só media combinada >= 3
 *   node sofascore-gols.js --jogos 8        -> usa os ultimos 8 jogos de cada time
 * ------------------------------------------------------------
 */

const BASE = "https://api.sofascore.com/api/v1";

const HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://www.sofascore.com/",
  "Origin": "https://www.sofascore.com",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

// ---------- helpers ----------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, tentativas = 2) {
  for (let i = 0; i <= tentativas; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 403) {
        throw new Error("BLOQUEADO_403");
      }
      if (!res.ok) {
        throw new Error(`HTTP_${res.status}`);
      }
      return await res.json();
    } catch (err) {
      if (err.message === "BLOQUEADO_403") throw err;
      if (i === tentativas) throw err;
      await sleep(500);
    }
  }
}

function hojeYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function horaLocal(timestampSeg) {
  const d = new Date(timestampSeg * 1000);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// traduz o status do jogo (que a Sofascore manda em ingles) pro portugues
const STATUS_PT = {
  "Not started": "Ainda não começou",
  "1st half": "1º tempo",
  "Halftime": "Intervalo",
  "2nd half": "2º tempo",
  "Extra time": "Prorrogação",
  "1st half extra time": "1º tempo (prorrogação)",
  "2nd half extra time": "2º tempo (prorrogação)",
  "Penalties": "Pênaltis",
  "Ended": "Encerrado",
  "Finished": "Encerrado",
  "Postponed": "Adiado",
  "Cancelled": "Cancelado",
  "Interrupted": "Interrompido",
  "Abandoned": "Abandonado",
  "Walkover": "W.O.",
};

function statusEmPortugues(jogo) {
  const desc = jogo.status?.description || "";
  return STATUS_PT[desc] || desc || "-";
}

// ---------- Sofascore calls ----------

async function getJogosDoDia(data) {
  const json = await fetchJson(`${BASE}/sport/football/scheduled-events/${data}`);
  return json.events || [];
}

// Média de gols MARCADOS pelo time nos últimos N jogos já finalizados
async function getMediaGolsTime(teamId, quantidade) {
  const jogos = [];
  let page = 0;

  while (jogos.length < quantidade && page < 3) {
    let json;
    try {
      json = await fetchJson(`${BASE}/team/${teamId}/events/last/${page}`);
    } catch {
      break;
    }
    const eventos = (json.events || []).filter(
      (e) => e.status && e.status.type === "finished"
    );
    jogos.push(...eventos);
    if (!json.hasNextPage) break;
    page++;
    await sleep(200);
  }

  const usados = jogos.slice(0, quantidade);
  if (usados.length === 0) return { media: null, jogosUsados: 0 };

  let totalGols = 0;
  for (const jogo of usados) {
    const éMandante = jogo.homeTeam && jogo.homeTeam.id === teamId;
    const golsTime = éMandante
      ? jogo.homeScore?.current ?? 0
      : jogo.awayScore?.current ?? 0;
    totalGols += golsTime;
  }

  return { media: totalGols / usados.length, jogosUsados: usados.length };
}

// ---------- relatório visual em HTML (com escudo dos times) ----------

function escapeHtml(texto) {
  return String(texto)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function infoSelo(selo) {
  if (selo === "MUITO FORTE") return { cor: "#ff5c5c", texto: "MUITO FORTE", nivel: 3 };
  if (selo === "FORTE") return { cor: "#ff9d42", texto: "FORTE", nivel: 2 };
  return { cor: "#ffd166", texto: "PROVÁVEL", nivel: 1 };
}

function cartaoJogo(r) {
  const s = infoSelo(r.selo);
  const logoMandante = `${BASE}/team/${r.mandanteId}/image`;
  const logoVisitante = `${BASE}/team/${r.visitanteId}/image`;

  const aoVivo = r.statusTipo === "inprogress";
  const encerrado = r.statusTipo === "finished";
  const temPlacar = r.golsAoVivoMandante != null && r.golsAoVivoVisitante != null;

  let statusChip;
  if (aoVivo) {
    statusChip = `<span class="status status-vivo"><span class="dot dot-vivo"></span>${escapeHtml(r.statusTexto)}</span>`;
  } else if (encerrado) {
    statusChip = `<span class="status status-fim"><span class="dot dot-fim"></span>Encerrado</span>`;
  } else {
    statusChip = `<span class="status status-agenda"><span class="dot dot-agenda"></span>${escapeHtml(r.hora)}</span>`;
  }

  const placarHtml = temPlacar
    ? `<div class="placar${aoVivo ? " placar-vivo" : ""}">${r.golsAoVivoMandante}<span class="sep">–</span>${r.golsAoVivoVisitante}</div>`
    : `<div class="placar placar-vs">vs</div>`;

  const pct = Math.max(6, Math.min(100, Math.round((r.combinado / 6) * 100)));
  const chamas = "🔥".repeat(s.nivel);

  return `
      <article class="jogo${aoVivo ? " jogo-vivo" : ""}">
        <div class="jogo-topo">
          ${statusChip}
          <span class="campeonato">${escapeHtml(r.campeonato)}</span>
        </div>
        <div class="confronto">
          <div class="time">
            <img class="escudo" src="${logoMandante}" alt="${escapeHtml(r.mandanteNome)}" loading="lazy"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="escudo-fallback" style="display:none;">⚽</div>
            <div class="time-nome">${escapeHtml(r.mandanteNome)}</div>
            <div class="media">${r.mediaMandante.toFixed(2)} gols/jogo</div>
          </div>
          ${placarHtml}
          <div class="time">
            <img class="escudo" src="${logoVisitante}" alt="${escapeHtml(r.visitanteNome)}" loading="lazy"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="escudo-fallback" style="display:none;">⚽</div>
            <div class="time-nome">${escapeHtml(r.visitanteNome)}</div>
            <div class="media">${r.mediaVisitante.toFixed(2)} gols/jogo</div>
          </div>
        </div>
        <div class="medidor" role="img" aria-label="Expectativa de ${r.combinado.toFixed(2)} gols">
          <div class="medidor-barra" style="width:${pct}%; background:${s.cor};"></div>
        </div>
        <div class="rodape">
          <span class="expectativa">Expectativa <b>${r.combinado.toFixed(2)}</b> gols</span>
          <span class="selo" style="color:${s.cor}; border-color:${s.cor};">${chamas} ${s.texto}</span>
        </div>
      </article>`;
}

function gerarHtml(resultados, data, minCombinado) {
  const aoVivo = resultados.filter((r) => r.statusTipo === "inprogress");
  const emBreve = resultados.filter((r) => r.statusTipo !== "inprogress" && r.statusTipo !== "finished");
  const encerrados = resultados.filter((r) => r.statusTipo === "finished");

  function secao(titulo, classeDot, lista) {
    if (lista.length === 0) return "";
    return `
    <section class="secao">
      <h2><span class="dot ${classeDot}"></span>${titulo}<span class="contador">${lista.length}</span></h2>
      <div class="grid">
        ${lista.map(cartaoJogo).join("\n")}
      </div>
    </section>`;
  }

  const conteudo =
    resultados.length > 0
      ? `${secao("Ao vivo agora", "dot-vivo", aoVivo)}${secao("A começar", "dot-agenda", emBreve)}${secao("Encerrados", "dot-fim", encerrados)}`
      : `<div class="vazio">Nenhum jogo com chance forte de gol agora.<br>Isso é normal em dias com poucos jogos grandes — tente mais tarde ou outra data.</div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gols Ao Vivo — ${escapeHtml(data)}</title>
<style>
  :root {
    --bg: #0a1613;
    --bg-glow: #123024;
    --surface: #10201a;
    --surface-2: #16281f;
    --border: rgba(223,255,238,0.08);
    --ink: #f2f7f2;
    --ink-dim: #8fa89a;
    --flood: #7fd4ff;
    --flood-dim: rgba(127,212,255,0.16);
    --live: #ff4d4d;
    --font-display: "Archivo Narrow", "Roboto Condensed", "Arial Narrow", sans-serif;
    --font-body: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --font-mono: "SFMono-Regular", "Cascadia Code", Consolas, "Liberation Mono", monospace;
  }
  * { box-sizing: border-box; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .001ms !important; } }

  body {
    font-family: var(--font-body);
    background: radial-gradient(ellipse 900px 500px at 20% -10%, var(--bg-glow), transparent 60%), var(--bg);
    background-attachment: fixed;
    margin: 0; padding: 0 16px 48px; color: var(--ink);
  }

  header { max-width: 1180px; margin: 0 auto; padding: 40px 4px 24px; border-bottom: 1px solid var(--border); }
  .marca { display: flex; align-items: baseline; gap: 14px; }
  .marca .bola { font-size: 26px; line-height: 1; }
  h1 {
    font-family: var(--font-display); font-weight: 800; text-transform: uppercase;
    font-size: clamp(28px, 4vw, 40px); letter-spacing: .01em; margin: 0; color: var(--ink);
    text-wrap: balance;
  }
  .ticker {
    display: flex; align-items: center; gap: 8px; margin-top: 10px;
    font-family: var(--font-mono); font-size: 12.5px; color: var(--ink-dim); letter-spacing: .02em;
  }

  .secao { max-width: 1180px; margin: 0 auto; padding: 0 4px; }
  .secao h2 {
    font-family: var(--font-display); font-weight: 700; text-transform: uppercase;
    font-size: 15px; letter-spacing: .1em; color: var(--ink);
    display: flex; align-items: center; gap: 9px; margin: 32px 0 16px;
  }
  .contador {
    font-family: var(--font-mono); background: var(--surface-2); color: var(--ink-dim);
    font-size: 11.5px; padding: 2px 8px; border-radius: 4px; font-weight: 600;
  }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }

  .jogo {
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    padding: 16px 18px 14px; transition: transform .15s ease, border-color .15s ease;
  }
  .jogo:hover { transform: translateY(-2px); border-color: rgba(127,212,255,.3); }
  .jogo-vivo { border-color: rgba(255,77,77,.35); box-shadow: 0 0 0 1px rgba(255,77,77,.12); }

  .jogo-topo { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 8px; flex-wrap: wrap; }
  .campeonato {
    font-family: var(--font-mono); font-size: 11px; color: var(--ink-dim); text-transform: uppercase;
    letter-spacing: .04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 55%;
  }

  .status { font-family: var(--font-mono); font-size: 11.5px; font-weight: 600; letter-spacing: .03em; display: inline-flex; align-items: center; color: var(--ink-dim); }
  .status-vivo { color: #ff8080; }
  .dot { width: 7px; height: 7px; border-radius: 50%; margin-right: 7px; flex-shrink: 0; }
  .dot-vivo { background: var(--live); box-shadow: 0 0 7px var(--live); animation: pisca 1.3s infinite; }
  .dot-agenda { background: var(--flood); box-shadow: 0 0 6px var(--flood); }
  .dot-fim { background: var(--ink-dim); }
  @keyframes pisca { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }

  .confronto { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .time { flex: 1; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; min-width: 0; }
  .escudo { width: 48px; height: 48px; object-fit: contain; filter: drop-shadow(0 2px 5px rgba(0,0,0,.5)); }
  .escudo-fallback { width: 48px; height: 48px; font-size: 28px; align-items: center; justify-content: center; }
  .time-nome {
    font-weight: 600; font-size: 13px; line-height: 1.25; overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .media { font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-dim); font-variant-numeric: tabular-nums; }

  .placar { min-width: 58px; text-align: center; font-family: var(--font-mono); font-weight: 700; font-size: 20px; color: var(--ink); font-variant-numeric: tabular-nums; }
  .placar-vs { font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-dim); }
  .placar-vivo { color: #ff8080; text-shadow: 0 0 12px rgba(255,77,77,.35); }
  .placar .sep { color: var(--ink-dim); margin: 0 3px; font-weight: 400; }

  .medidor { height: 4px; border-radius: 3px; background: var(--surface-2); margin: 16px 0 12px; overflow: hidden; }
  .medidor-barra { height: 100%; }

  .rodape { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
  .expectativa { font-family: var(--font-mono); font-size: 12px; color: var(--ink-dim); font-variant-numeric: tabular-nums; }
  .expectativa b { color: var(--ink); }
  .selo {
    font-size: 12px; font-weight: 700; white-space: nowrap; padding: 4px 10px 4px 8px; background: var(--surface-2);
    border: 1px solid; clip-path: polygon(6px 0, 100% 0, 100% 100%, 0 100%, 0 6px);
  }

  .vazio {
    max-width: 620px; margin: 64px auto; background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 40px 24px; text-align: center; color: var(--ink-dim); font-size: 15px;
  }

  .aviso { max-width: 1180px; margin: 40px auto 0; padding: 0 4px; }
  .aviso-caixa {
    background: rgba(255,209,102,0.07); border: 1px solid rgba(255,209,102,.22); color: #ffd166;
    padding: 12px 16px; border-radius: 8px; font-size: 12.5px; font-family: var(--font-mono);
  }

  footer { max-width: 1180px; margin: 20px auto 0; padding: 0 4px; color: var(--ink-dim); font-size: 11px; font-family: var(--font-mono); text-align: center; }
</style>
</head>
<body>
  <header>
    <div class="marca"><span class="bola">⚽</span><h1>Gols Ao Vivo</h1></div>
    <div class="ticker"><span class="dot dot-vivo"></span>ATUALIZADO AUTOMATICAMENTE · ${escapeHtml(data)} · ${resultados.length} JOGO(S) ≥ ${minCombinado} GOLS COMBINADOS</div>
  </header>

  ${conteudo}

  <div class="aviso">
    <div class="aviso-caixa">Estatística baseada nos últimos jogos de cada time. Não é garantia de resultado. Aposte com responsabilidade.</div>
  </div>
  <footer>DADOS VIA SOFASCORE · PÁGINA GERADA AUTOMATICAMENTE</footer>
</body>
</html>`;
}

// ---------- programa principal ----------

async function main() {
  const args = process.argv.slice(2);
  let data = hojeYYYYMMDD();
  let minCombinado = 2.5;
  let qtdJogosAnalise = 6;

  for (let i = 0; i < args.length; i++) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(args[i])) data = args[i];
    if (args[i] === "--min") minCombinado = parseFloat(args[i + 1]);
    if (args[i] === "--jogos") qtdJogosAnalise = parseInt(args[i + 1], 10);
  }

  console.log(`\nBuscando jogos de futebol em ${data}...\n`);

  let jogos;
  try {
    jogos = await getJogosDoDia(data);
  } catch (err) {
    if (err.message === "BLOQUEADO_403") {
      console.log(
        "ERRO: o Sofascore bloqueou essa conexao (403 Forbidden).\n" +
        "Isso acontece quando o pedido vem de um servidor/nuvem (IP de datacenter).\n" +
        "Solucao: rode este script no seu computador (Windows) ou celular (Termux),\n" +
        "usando internet residencial ou dados moveis normais, NAO uma VPS/servidor.\n"
      );
      process.exit(1);
    }
    console.log("Erro ao buscar jogos do dia:", err.message);
    process.exit(1);
  }

  if (jogos.length === 0) {
    console.log("Nenhum jogo encontrado para essa data.");
  } else {
    console.log(`${jogos.length} jogos encontrados. Analisando ataque dos times (isso demora um pouco)...\n`);
  }

  const resultados = [];

  for (const jogo of jogos) {
    if (!jogo.homeTeam || !jogo.awayTeam) continue;

    let mandante, visitante;
    try {
      mandante = await getMediaGolsTime(jogo.homeTeam.id, qtdJogosAnalise);
      await sleep(250);
      visitante = await getMediaGolsTime(jogo.awayTeam.id, qtdJogosAnalise);
      await sleep(250);
    } catch (err) {
      if (err.message === "BLOQUEADO_403") {
        console.log("\nBloqueado pelo Sofascore no meio da analise (403). Rode de uma rede residencial/mobile.\n");
        process.exit(1);
      }
      continue;
    }

    if (mandante.media == null || visitante.media == null) continue;

    const combinado = mandante.media + visitante.media;
    if (combinado < minCombinado) continue; // só nos interessa time que faz gol

    let selo = "";
    if (combinado >= 3.5 && mandante.media >= 1.3 && visitante.media >= 1.3) {
      selo = "MUITO FORTE";
    } else if (combinado >= 3) {
      selo = "FORTE";
    } else {
      selo = "OK";
    }

    resultados.push({
      hora: horaLocal(jogo.startTimestamp),
      campeonato: jogo.tournament?.name || "-",
      mandanteNome: jogo.homeTeam.name,
      mandanteId: jogo.homeTeam.id,
      visitanteNome: jogo.awayTeam.name,
      visitanteId: jogo.awayTeam.id,
      mediaMandante: mandante.media,
      mediaVisitante: visitante.media,
      combinado,
      selo,
      statusTipo: jogo.status?.type || "notstarted", // notstarted | inprogress | finished
      statusTexto: statusEmPortugues(jogo),
      golsAoVivoMandante: jogo.homeScore?.current,
      golsAoVivoVisitante: jogo.awayScore?.current,
    });
  }

  resultados.sort((a, b) => b.combinado - a.combinado);

  if (resultados.length === 0) {
    console.log(`Nenhum jogo com média combinada >= ${minCombinado} gols encontrado hoje.`);
    console.log("(mesmo assim, os arquivos vao ser salvos/atualizados, so que vazios)\n");
  } else {
    console.log(`\n=== JOGOS COM CHANCE DE MAIS DE 2,5 GOLS (${data}) ===\n`);
    console.log(
      "Hora  | Campeonato".padEnd(28) +
        "| Confronto".padEnd(38) +
        "| Média Mand. | Média Vis. | Combinado | Sinal".padEnd(20) +
        "| Status"
    );
    console.log("-".repeat(135));

    for (const r of resultados) {
      const confronto = `${r.mandanteNome} x ${r.visitanteNome}`;
      const statusStr =
        r.statusTipo === "inprogress"
          ? `AO VIVO ${r.golsAoVivoMandante ?? "-"}x${r.golsAoVivoVisitante ?? "-"} (${r.statusTexto})`
          : r.statusTipo === "finished"
          ? `Encerrado ${r.golsAoVivoMandante ?? "-"}x${r.golsAoVivoVisitante ?? "-"}`
          : "Ainda nao comecou";
      console.log(
        `${r.hora}  | ${r.campeonato}`.padEnd(28).slice(0, 28) +
          `| ${confronto}`.padEnd(38).slice(0, 38) +
          `| ${r.mediaMandante.toFixed(2)}`.padEnd(14) +
          `| ${r.mediaVisitante.toFixed(2)}`.padEnd(13) +
          `| ${r.combinado.toFixed(2)}`.padEnd(11) +
          `| ${r.selo}`.padEnd(20) +
          `| ${statusStr}`
      );
    }
  }

  // salva também em CSV
  const fs = require("fs");
  const linhasCsv = [
    "hora,campeonato,mandante,visitante,media_mandante,media_visitante,combinado,sinal",
    ...resultados.map(
      (r) =>
        `${r.hora},"${r.campeonato}","${r.mandanteNome}","${r.visitanteNome}",${r.mediaMandante.toFixed(
          2
        )},${r.mediaVisitante.toFixed(2)},${r.combinado.toFixed(2)},${r.selo}`
    ),
  ];
  const nomeArquivo = `jogos-over-2.5_${data}.csv`;
  fs.writeFileSync(nomeArquivo, linhasCsv.join("\n"), "utf8");

  // salva relatório visual em HTML (com escudo dos times)
  const html = gerarHtml(resultados, data, minCombinado);
  const nomeHtml = `jogos-over-2.5_${data}.html`;
  fs.writeFileSync(nomeHtml, html, "utf8");

  console.log(`\nSalvo tambem em:`);
  console.log(`  - ${nomeArquivo} (planilha)`);
  console.log(`  - ${nomeHtml}  (relatorio visual com escudo dos times - ABRA ESSE ARQUIVO)\n`);

  // copia sempre para docs/index.html (usado pelo GitHub Pages, se voce configurar)
  try {
    if (!fs.existsSync("docs")) fs.mkdirSync("docs");
    fs.writeFileSync("docs/index.html", html, "utf8");
    console.log(`  - docs/index.html (copia fixa, para publicar no GitHub Pages)\n`);
  } catch {
    // se nao conseguir criar/gravar em docs, ignora - nao afeta o resto
  }

  // tenta abrir o HTML automaticamente no navegador
  try {
    const { exec } = require("child_process");
    const path = require("path");
    const caminho = path.resolve(nomeHtml);
    const comando =
      process.platform === "win32"
        ? `start "" "${caminho}"`
        : process.platform === "darwin"
        ? `open "${caminho}"`
        : `xdg-open "${caminho}"`;
    exec(comando, () => {});
  } catch {
    // se não conseguir abrir sozinho, sem problema: o usuário abre manualmente
  }

  console.log(
    "Lembrete: isso e uma estatistica baseada nos ultimos jogos de cada time.\n" +
    "Nao e garantia de resultado. Aposte com responsabilidade.\n"
  );
}

main();
