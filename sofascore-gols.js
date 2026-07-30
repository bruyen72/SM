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
  // cor + icone + texto juntos (nunca só cor, nunca só texto)
  if (selo === "MUITO FORTE") return { cor: "#c0392b", fundo: "#fdecea", icone: "🔥🔥🔥", texto: "MUITO FORTE" };
  if (selo === "FORTE") return { cor: "#d35400", fundo: "#fdf1e3", icone: "🔥🔥", texto: "FORTE" };
  return { cor: "#b7950b", fundo: "#fef9e7", icone: "🔥", texto: "PROVÁVEL" };
}

function gerarHtml(resultados, data, minCombinado) {
  const linhas = resultados
    .map((r) => {
      const s = infoSelo(r.selo);
      const logoMandante = `${BASE}/team/${r.mandanteId}/image`;
      const logoVisitante = `${BASE}/team/${r.visitanteId}/image`;

      const aoVivo = r.statusTipo === "inprogress";
      const encerrado = r.statusTipo === "finished";
      const temPlacar = r.golsAoVivoMandante != null && r.golsAoVivoVisitante != null;

      let faixaStatus = "";
      if (aoVivo) {
        faixaStatus = `<div class="faixa faixa-vivo">🔴 AO VIVO — ${escapeHtml(r.statusTexto)}${
          temPlacar ? ` — placar: <b>${r.golsAoVivoMandante} x ${r.golsAoVivoVisitante}</b>` : ""
        }</div>`;
      } else if (encerrado) {
        faixaStatus = `<div class="faixa faixa-encerrado">⚫ ENCERRADO${
          temPlacar ? ` — placar final: <b>${r.golsAoVivoMandante} x ${r.golsAoVivoVisitante}</b>` : ""
        }</div>`;
      }

      return `
      <div class="jogo">
        ${faixaStatus}
        <div class="topo">
          <span class="hora">🕒 ${escapeHtml(r.hora)}</span>
          <span class="campeonato">${escapeHtml(r.campeonato)}</span>
        </div>
        <div class="confronto">
          <div class="time">
            <img class="escudo" src="${logoMandante}" alt="${escapeHtml(r.mandanteNome)}"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="escudo-fallback" style="display:none;">⚽</div>
            <div class="time-nome">${escapeHtml(r.mandanteNome)}</div>
            <div class="media">Média: <b>${r.mediaMandante.toFixed(2)}</b> gols</div>
          </div>
          <div class="x">✕</div>
          <div class="time">
            <img class="escudo" src="${logoVisitante}" alt="${escapeHtml(r.visitanteNome)}"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="escudo-fallback" style="display:none;">⚽</div>
            <div class="time-nome">${escapeHtml(r.visitanteNome)}</div>
            <div class="media">Média: <b>${r.mediaVisitante.toFixed(2)}</b> gols</div>
          </div>
        </div>
        <div class="rodape">
          <span class="combinado">⚽ Total esperado: <b>${r.combinado.toFixed(2)} gols</b></span>
          <span class="selo" style="color:${s.cor}; background:${s.fundo}; border:2px solid ${s.cor};">
            ${s.icone} ${s.texto}
          </span>
        </div>
      </div>`;
    })
    .join("\n");

  const listaOuVazio =
    resultados.length > 0
      ? linhas
      : `<div class="vazio">😕 Nenhum jogo com chance forte de gol encontrado agora.<br>Isso é normal em dias com poucos jogos grandes. Tente mais tarde ou outra data.</div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Jogos com mais de 2,5 gols - ${escapeHtml(data)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; background:#f4f6f8; margin:0; padding:24px; color:#222; }
  h1 { font-size:26px; margin-bottom:4px; }
  .subtitulo { color:#555; margin-bottom:24px; font-size:15px; }
  .lista { display:flex; flex-direction:column; gap:16px; max-width:720px; margin:0 auto; }
  .jogo { background:#fff; border-radius:12px; padding:16px 20px; box-shadow:0 2px 6px rgba(0,0,0,0.08); }
  .topo { display:flex; justify-content:space-between; font-size:14px; color:#666; margin-bottom:12px; }
  .hora { font-weight:bold; }
  .confronto { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .time { flex:1; display:flex; flex-direction:column; align-items:center; text-align:center; gap:4px; }
  .escudo { width:56px; height:56px; object-fit:contain; }
  .escudo-fallback { width:56px; height:56px; font-size:32px; align-items:center; justify-content:center; }
  .time-nome { font-weight:bold; font-size:15px; }
  .media { font-size:13px; color:#555; }
  .x { font-size:18px; color:#999; font-weight:bold; padding:0 6px; }
  .rodape { display:flex; justify-content:space-between; align-items:center; margin-top:14px; padding-top:12px; border-top:1px solid #eee; flex-wrap:wrap; gap:8px; }
  .combinado { font-size:15px; }
  .selo { padding:6px 12px; border-radius:20px; font-weight:bold; font-size:14px; white-space:nowrap; }
  .aviso { max-width:720px; margin:24px auto 0; background:#fff3cd; border:1px solid #ffe08a; color:#7a5c00; padding:12px 16px; border-radius:8px; font-size:14px; }
  .faixa { text-align:center; font-weight:bold; font-size:13px; padding:6px 10px; border-radius:8px; margin-bottom:12px; }
  .faixa-vivo { background:#fdecea; color:#c0392b; animation: pisca 1.4s infinite; }
  .faixa-encerrado { background:#eee; color:#555; }
  @keyframes pisca { 0%, 100% { opacity:1; } 50% { opacity:0.55; } }
  .vazio { background:#fff; border-radius:12px; padding:32px 20px; text-align:center; color:#555; font-size:15px; box-shadow:0 2px 6px rgba(0,0,0,0.08); }
</style>
</head>
<body>
  <h1>⚽ Jogos com chance de mais de 2,5 gols</h1>
  <div class="subtitulo">Data: ${escapeHtml(data)} • Mínimo analisado: ${minCombinado} gols combinados • ${resultados.length} jogo(s) encontrado(s)</div>
  <div class="lista">
    ${listaOuVazio}
  </div>
  <div class="aviso">
    ⚠️ Isso é estatística baseada nos últimos jogos de cada time. Não é garantia de resultado. Aposte com responsabilidade.
  </div>
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
