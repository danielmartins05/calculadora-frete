// Serve a página do gerador de etiquetas, atrás de um login PRÓPRIO (formulário estilizado,
// não o popup feio do navegador). A sessão fica guardada num cookie assinado por 7 dias.
//
// Variáveis de ambiente necessárias:
//   ETIQUETAS_USUARIO, ETIQUETAS_SENHA        -> login que você escolhe
//   ETIQUETAS_SESSAO_SEGREDO                  -> qualquer texto longo e aleatório, só pra
//                                                 assinar o cookie (invente uma string única,
//                                                 tipo 32 caracteres soltos, e reaproveita o
//                                                 MESMO valor em listar-pedidos-etiquetas.js)
//
// Endereço: https://calculadorajl-frete.netlify.app/.netlify/functions/etiquetas-pagina

const crypto = require('crypto');

const NOME_COOKIE = 'jl_etq_sessao';
const DURACAO_SESSAO_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

function assinar(valor, segredo) {
  return crypto.createHmac('sha256', segredo).update(valor).digest('hex');
}

function criarCookie(segredo) {
  const expiraEm = Date.now() + DURACAO_SESSAO_MS;
  const assinatura = assinar(String(expiraEm), segredo);
  const valor = `${expiraEm}.${assinatura}`;
  const expiraData = new Date(expiraEm).toUTCString();
  return `${NOME_COOKIE}=${valor}; Path=/; Expires=${expiraData}; HttpOnly; Secure; SameSite=Lax`;
}

function sessaoValida(event, segredo) {
  const cabecalhoCookie = event.headers.cookie || event.headers.Cookie || '';
  const partes = cabecalhoCookie.split(';').map((p) => p.trim());
  const cookie = partes.find((p) => p.startsWith(NOME_COOKIE + '='));
  if (!cookie) return false;

  const valor = cookie.slice((NOME_COOKIE + '=').length);
  const [expiraEm, assinatura] = valor.split('.');
  if (!expiraEm || !assinatura) return false;
  if (Date.now() > Number(expiraEm)) return false;

  return assinar(expiraEm, segredo) === assinatura;
}

function paginaLogin(erro) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Login — Gerador de etiquetas JL</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --verde: #74BE33;
    --verde-escuro: #4C8A1E;
    --preto: #161616;
    --cinza-texto: #5C5C5C;
    --cinza-borda: #E1E5DC;
    --fundo: #F7F9F4;

    /* semânticos — de propósito fora da paleta de marca, pra alerta não virar enfeite */
    --ambar: #B87406;
    --ambar-fundo: #FDF4E3;
    --ambar-borda: #E8B45F;
    --vermelho: #B3261E;
    --vermelho-fundo: #FBEBEA;
    --azul: #1B6A78;
    --azul-fundo: #E6F2F4;
    --azul-borda: #8FC2CB;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Inter', Arial, Helvetica, sans-serif;
    margin: 0;
    background: var(--fundo);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cartao {
    background: #fff;
    border: 1px solid var(--cinza-borda);
    border-radius: 16px;
    padding: 36px 32px;
    width: 100%;
    max-width: 340px;
    box-shadow: 0 2px 10px rgba(20, 30, 20, 0.06);
  }
  .logo-bolha {
    width: 48px; height: 48px;
    border-radius: 12px;
    background: var(--verde);
    color: var(--preto);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 19px;
    margin: 0 auto 18px;
  }
  h1 {
    font-size: 17px;
    font-weight: 600;
    color: var(--preto);
    text-align: center;
    margin: 0 0 4px;
  }
  p.sub {
    font-size: 13px;
    color: var(--cinza-texto);
    text-align: center;
    margin: 0 0 24px;
  }
  label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--preto);
    margin-bottom: 6px;
  }
  input {
    width: 100%;
    font-family: inherit;
    font-size: 14.5px;
    padding: 10px 12px;
    border: 1px solid var(--cinza-borda);
    border-radius: 8px;
    margin-bottom: 16px;
    outline: none;
  }
  input:focus { border-color: var(--verde); }
  button {
    width: 100%;
    background: var(--verde);
    color: #fff;
    font-family: inherit;
    font-size: 14.5px;
    font-weight: 600;
    border: none;
    border-radius: 9px;
    padding: 11px;
    cursor: pointer;
  }
  button:hover { background: var(--verde-escuro); }
  .erro {
    background: #FBE9E7;
    color: #8A2E20;
    font-size: 13px;
    padding: 10px 12px;
    border-radius: 8px;
    margin-bottom: 16px;
  }
</style>
</head>
<body>
  <div class="cartao">
    <div class="logo-bolha">JL</div>
    <h1>Gerador de etiquetas</h1>
    <p class="sub">Acesso restrito — faça login pra continuar</p>
    ${erro ? '<div class="erro">Usuário ou senha incorretos.</div>' : ''}
    <form method="POST" action="">
      <label for="usuario">Usuário</label>
      <input type="text" id="usuario" name="usuario" autocomplete="username" autofocus>
      <label for="senha">Senha</label>
      <input type="password" id="senha" name="senha" autocomplete="current-password">
      <button type="submit">Entrar</button>
    </form>
  </div>
</body>
</html>`;
}

const HTML_FERRAMENTA = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gerador de etiquetas — JL Produtos Naturais</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --verde: #74BE33;
    --verde-escuro: #4C8A1E;
    --verde-claro: #EEF7E2;
    --preto: #161616;
    --cinza-texto: #5C5C5C;
    --cinza-borda: #E1E5DC;
    --fundo: #F7F9F4;
  }

  * { box-sizing: border-box; }

  body {
    font-family: 'Inter', Arial, Helvetica, sans-serif;
    margin: 0;
    background: var(--fundo);
    color: #1C231E;
  }

  .pagina {
    max-width: 900px;
    margin: 0 auto;
    padding: 32px 24px 60px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 28px;
  }

  .logo-bolha {
    width: 44px; height: 44px;
    border-radius: 12px;
    background: var(--verde);
    color: var(--preto);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 18px;
    flex-shrink: 0;
  }

  header h1 {
    font-size: 19px;
    font-weight: 600;
    margin: 0;
    color: var(--preto);
  }

  header p {
    margin: 2px 0 0;
    font-size: 13px;
    color: var(--cinza-texto);
  }

  .painel {
    background: #fff;
    border: 1px solid var(--cinza-borda);
    border-radius: 14px;
    padding: 20px 24px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    box-shadow: 0 1px 3px rgba(30, 58, 40, 0.04);
  }

  button {
    font-family: inherit;
    font-size: 14.5px;
    font-weight: 600;
    border: none;
    border-radius: 9px;
    padding: 11px 20px;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
  }

  button:active { transform: scale(0.98); }

  #btnBuscar {
    background: var(--verde);
    color: #fff;
  }
  #btnBuscar:hover:not(:disabled) { background: var(--verde-escuro); }
  #btnBuscar:disabled { background: #A7B4AC; cursor: default; }

  #btnImprimir {
    background: #fff;
    color: var(--verde-escuro);
    border: 1.5px solid var(--verde);
  }
  #btnImprimir:hover { background: var(--verde-claro); }

  .botao-secundario {
    background: #fff;
    color: var(--cinza-texto);
    border: 1.5px solid var(--cinza-borda);
    font-size: 13px;
    padding: 8px 14px;
  }
  .botao-secundario:hover { background: var(--fundo); }

  .barra-selecao {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--cinza-borda);
  }

  #contador {
    font-size: 13px;
    color: var(--cinza-texto);
    margin-right: auto;
  }

  .link-discreto {
    background: none;
    border: none;
    color: var(--cinza-texto);
    font-size: 12.5px;
    text-decoration: underline;
    padding: 4px;
    cursor: pointer;
  }

  #status {
    font-size: 13.5px;
    color: var(--cinza-texto);
  }

  /* resumo do que a impressão vai consumir — fica do lado do botão de imprimir */
  #resumoImpressao {
    font-size: 12.5px;
    color: var(--cinza-texto);
    font-variant-numeric: tabular-nums;
    padding: 6px 11px;
    background: var(--fundo);
    border: 1px solid var(--cinza-borda);
    border-radius: 8px;
    line-height: 1.35;
  }
  #resumoImpressao b { color: #1C231E; font-weight: 600; }
  #resumoImpressao .sobra { color: #8A9384; }

  .ponto-carregando {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--verde);
    display: inline-block;
    animation: pulsar 1s infinite ease-in-out;
  }
  @keyframes pulsar {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .vazio {
    grid-column: 1 / -1;
    padding: 28px;
    text-align: center;
    color: var(--cinza-texto);
    font-size: 14px;
    background: #fff;
    border: 1px dashed var(--cinza-borda);
    border-radius: 14px;
  }

  #area-grade {
    margin-top: 24px;
  }

  #area-grade:not(:empty) {
    background: #fff;
    border: 1px solid var(--cinza-borda);
    border-radius: 14px;
    padding: 20px;
    box-shadow: 0 1px 3px rgba(30, 58, 40, 0.04);
  }

  /* Tela: acompanha a largura (bancada usa tablet). Impressão: 4 colunas fixas — é folha de
     recorte, o layout do papel não pode depender do tamanho da janela. */
  #grade {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 8px;
  }

  .celula {
    position: relative;
    border: 1px solid #000;
    padding: 5px 6px 5px 20px;
    font-family: "Arial Narrow", Arial, sans-serif;
    font-size: 8pt;
    line-height: 1.3;
    border-radius: 2px;
    transition: opacity 0.15s ease;
  }

  .celula.ja-impresso { background: #F5F6F3; opacity: 0.55; }

  .celula .selecionar {
    position: absolute;
    top: 6px;
    left: 5px;
    width: 12px;
    height: 12px;
    margin: 0;
    cursor: pointer;
  }

  /* Faixa de tela da célula: tudo que é informação de OPERAÇÃO, não de etiqueta. Sai inteira na
     impressão — por isso o papel ficou com menos coisa do que antes, e o cabeçalho do SEDEX
     parou de quebrar em duas linhas. Nada aqui dentro precisa de regra própria no @media print. */
  .barra-celula {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    margin-bottom: 3px;
    font-family: 'Inter', Arial, sans-serif;
  }

  .badge-novo, .badge-impresso, .selo-assumido, .selo-junto, .idade {
    display: inline-block;
    font-family: 'Inter', Arial, sans-serif;
    font-size: 6.5pt;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    vertical-align: middle;
  }

  .badge-novo { background: var(--verde); color: #fff; }
  .badge-impresso { background: #B9BDB4; color: #fff; }

  /* frete que o back-end não conseguiu ler e assumiu como PAC */
  .selo-assumido {
    background: var(--ambar-fundo);
    color: var(--ambar);
    box-shadow: inset 0 0 0 1px var(--ambar-borda);
  }

  /* dois pedidos pro mesmo endereço podem ir num pacote só */
  .selo-junto {
    background: var(--azul-fundo);
    color: var(--azul);
    box-shadow: inset 0 0 0 1px var(--azul-borda);
    cursor: help;
  }

  .idade { background: #EDF0EA; color: #6B7566; font-variant-numeric: tabular-nums; }
  .idade.atencao { background: var(--ambar-fundo); color: var(--ambar); box-shadow: inset 0 0 0 1px var(--ambar-borda); }
  .idade.critico { background: var(--vermelho-fundo); color: var(--vermelho); box-shadow: inset 0 0 0 1px #E4A9A5; }

  .celula.assumido { border-left: 3px dotted var(--ambar-borda); }
  .celula.filtrada { display: none; }

  /* ---------- filtros por meio de envio + busca ---------- */

  .barra-filtros {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--cinza-borda);
  }

  .rotulo-filtro {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: #8A9384;
    margin-right: 2px;
  }

  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    color: var(--cinza-texto);
    background: #fff;
    border: 1.5px solid var(--cinza-borda);
    border-radius: 999px;
    padding: 7px 13px;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .chip:hover:not(:disabled) { background: var(--fundo); }
  .chip .n {
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #9AA394;
  }
  .chip[aria-pressed="true"] {
    background: var(--verde-escuro);
    border-color: var(--verde-escuro);
    color: #fff;
  }
  .chip[aria-pressed="true"] .n { color: #C7E3A8; }
  .chip:disabled { opacity: 0.4; cursor: default; }
  .chip:focus-visible { outline: 2px solid var(--verde-escuro); outline-offset: 2px; }

  .chip.chip-alerta { border-color: var(--ambar-borda); color: var(--ambar); background: var(--ambar-fundo); }
  .chip.chip-alerta .n { color: var(--ambar); }
  .chip.chip-alerta[aria-pressed="true"] { background: var(--ambar); border-color: var(--ambar); color: #fff; }
  .chip.chip-alerta[aria-pressed="true"] .n { color: #FBE6C2; }

  .caixa-busca {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    background: #fff;
    border: 1.5px solid var(--cinza-borda);
    border-radius: 999px;
    padding: 0 6px 0 12px;
  }
  .caixa-busca:focus-within { border-color: var(--verde); }

  #busca {
    font-family: inherit;
    font-size: 13px;
    border: none;
    outline: none;
    padding: 7px 0;
    width: 120px;
    background: transparent;
    color: #1C231E;
  }
  #busca::placeholder { color: #A3AC9D; }

  #btnLimparBusca {
    background: var(--fundo);
    border: none;
    color: var(--cinza-texto);
    font-size: 15px;
    line-height: 1;
    font-weight: 500;
    border-radius: 50%;
    width: 22px; height: 22px;
    padding: 0;
    display: flex; align-items: center; justify-content: center;
  }
  #btnLimparBusca:hover { background: var(--cinza-borda); }

  @media (max-width: 560px) {
    .pagina { padding: 20px 16px 40px; }
    .painel { padding: 16px; gap: 12px; }
    #btnBuscar, #btnImprimir { width: 100%; }
    .caixa-busca { margin-left: 0; width: 100%; }
    #busca { width: 100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; }
  }

  .cabecalho { font-weight: bold; margin-bottom: 1px; }
  .divisor { border-top: 1px dashed #999; margin: 3px 0; }
  .rotulo-declaracao { font-size: 7pt; color: #777; margin-bottom: 1px; }
  .itens { margin-top: 2px; }

  @media print {
    body { background: #fff; margin: 0; }
    .pagina { max-width: none; padding: 0; }
    header, .painel, #status { display: none; }
    #area-grade { border: none; box-shadow: none; padding: 0; border-radius: 0; }
    /* Na tela a grade acompanha a largura da janela; no papel são SEMPRE 4 colunas —
       a folha é pré-recortada, o layout impresso não pode depender do tamanho da janela. */
    #grade { gap: 0; grid-template-columns: repeat(4, 1fr); }
    .celula {
      border: 1px solid #000 !important;
      border-radius: 0;
      padding: 5px 6px;
      opacity: 1 !important;
      background: #fff !important;
      box-shadow: none !important;
    }
    .celula:not(.selecionada) { display: none; }
    .celula.filtrada { display: none; }
    .celula .selecionar, .barra-celula, .vazio { display: none; }
  }
</style>
</head>
<body>

<div class="pagina">

  <header>
    <div class="logo-bolha">JL</div>
    <div>
      <h1>Gerador de etiquetas</h1>
      <p>Pedidos pagos e ainda não despachados, prontos pra imprimir e recortar</p>
    </div>
  </header>

  <div class="painel">
    <button id="btnBuscar" onclick="buscarPedidos()">Buscar pedidos pendentes</button>
    <button id="btnImprimir" onclick="imprimirSelecionadas()" style="display:none;">Imprimir selecionadas</button>
    <span id="status"></span>

    <span id="resumoImpressao" style="display:none;"></span>

    <div class="barra-filtros" id="barraFiltros" style="display:none;">
      <span class="rotulo-filtro">Meio de envio</span>
      <button type="button" class="chip" data-filtro="TODOS" aria-pressed="true">Todos <span class="n">0</span></button>
      <button type="button" class="chip" data-filtro="PAC" aria-pressed="false">PAC <span class="n">0</span></button>
      <button type="button" class="chip" data-filtro="SEDEX" aria-pressed="false">SEDEX <span class="n">0</span></button>
      <button type="button" class="chip" data-filtro="WHATSAPP" aria-pressed="false">WhatsApp <span class="n">0</span></button>
      <button type="button" class="chip chip-alerta" data-filtro="ASSUMIDO" aria-pressed="false" style="display:none;">Frete assumido <span class="n">0</span></button>

      <div class="caixa-busca">
        <label for="busca" class="rotulo-filtro" style="margin:0">Pedido</label>
        <input type="search" id="busca" placeholder="1848" autocomplete="off" aria-label="Buscar por número de pedido">
        <button type="button" id="btnLimparBusca" aria-label="Limpar busca" style="display:none;">&times;</button>
      </div>
    </div>

    <div id="barraSelecao" class="barra-selecao" style="display:none;">
      <span id="contador"></span>
      <button type="button" class="botao-secundario" onclick="marcarSoNovos()">Marcar só novos</button>
      <button type="button" class="botao-secundario" onclick="marcarTodos(true)">Marcar todos</button>
      <button type="button" class="botao-secundario" onclick="marcarTodos(false)">Desmarcar todos</button>
      <button type="button" class="link-discreto" onclick="limparHistorico()">Limpar histórico de impressos</button>
    </div>
  </div>

  <div id="area-grade">
    <div id="grade"></div>
  </div>

</div>

<script>
  var FUNCTION_URL = 'https://calculadorajl-frete.netlify.app/.netlify/functions/listar-pedidos-etiquetas';
  var CHAVE_IMPRESSOS = 'jl_etq_impressos';
  var POSICOES_FOLHA = 20;   // 4 colunas x 5 linhas por folha de recorte

  var pedidosCarregados = [];
  var filtroAtual = 'TODOS';
  var buscaAtual = '';
  var mapaJuntos = {};

  // ---------------------------------------------------------------------------
  // histórico de impressos (por navegador — localStorage)
  // ---------------------------------------------------------------------------

  function obterImpressos() {
    try { return JSON.parse(localStorage.getItem(CHAVE_IMPRESSOS) || '[]'); }
    catch (e) { return []; }
  }

  function salvarImpressos(lista) {
    try { localStorage.setItem(CHAVE_IMPRESSOS, JSON.stringify(lista)); }
    catch (e) { /* navegador sem storage: segue funcionando, só sem histórico */ }
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  // Dias de CALENDÁRIO, não 24h corridas: quem está na bancada pensa em "entrou ontem",
  // não em "entrou há 19 horas".
  function diasDesde(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var hoje = new Date();
    var a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    var b = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    return Math.max(0, Math.round((b - a) / 86400000));
  }

  function textoIdade(dias) {
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'há 1 dia';
    return 'há ' + dias + ' dias';
  }

  function classeIdade(dias) {
    if (dias >= 4) return 'critico';
    if (dias >= 2) return 'atencao';
    return '';
  }

  // Comparação deliberadamente conservadora: nome + rua + CEP. Comparar só CEP pegaria mais
  // casos, mas marcaria vizinho de prédio como se fosse o mesmo cliente. Erra pra menos.
  function chaveEndereco(p) {
    return ((p.nome || '') + '|' + (p.endereco1 || '') + '|' + (p.cep || ''))
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function calcularJuntos(pedidos) {
    var grupos = {};
    pedidos.forEach(function (p) {
      var k = chaveEndereco(p);
      (grupos[k] = grupos[k] || []).push(p.pedido);
    });
    var mapa = {};
    pedidos.forEach(function (p) {
      var irmaos = grupos[chaveEndereco(p)].filter(function (n) { return n !== p.pedido; });
      if (irmaos.length) mapa[p.pedido] = irmaos;
    });
    return mapa;
  }

  function totalItens(pedidos) {
    return pedidos.reduce(function (soma, p) {
      return soma + (p.itens || []).reduce(function (sub, it) { return sub + it.quantidade; }, 0);
    }, 0);
  }

  function textoFolhas(n) {
    var folhas = Math.ceil(n / POSICOES_FOLHA);
    if (folhas <= 1) {
      var sobra = POSICOES_FOLHA - n;
      return sobra > 0
        ? '1 folha <span class="sobra">· sobram ' + sobra + ' posições</span>'
        : '1 folha <span class="sobra">· folha cheia</span>';
    }
    var ultima = n % POSICOES_FOLHA || POSICOES_FOLHA;
    return folhas + ' folhas <span class="sobra">· a última com ' + ultima + '</span>';
  }

  function pedidoPorNumero(numero) {
    for (var i = 0; i < pedidosCarregados.length; i++) {
      if (pedidosCarregados[i].pedido === numero) return pedidosCarregados[i];
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------

  function celulaHtml(pedido, jaImpresso) {
    var linha2 = pedido.endereco2 ? (pedido.endereco2 + '<br>') : '';
    var itensHtml = (pedido.itens || [])
      .map(function (it) { return it.quantidade + 'x ' + it.titulo; })
      .join('<br>');

    var classes = ['celula'];
    classes.push(jaImpresso ? 'ja-impresso' : 'selecionada');
    if (pedido.assumido) classes.push('assumido');

    var selos = jaImpresso
      ? '<span class="badge-impresso">JÁ IMPRESSO</span>'
      : '<span class="badge-novo">NOVO</span>';

    var dias = diasDesde(pedido.criadoEm);
    if (dias !== null) {
      selos += '<span class="idade ' + classeIdade(dias) + '">' + textoIdade(dias) + '</span>';
    }

    var juntos = mapaJuntos[pedido.pedido];
    if (juntos) {
      selos += '<span class="selo-junto" title="Mesmo destinatário e endereço — dá pra despachar num pacote só.">'
        + 'JUNTO COM ' + juntos.join(' ') + '</span>';
    }

    if (pedido.assumido) {
      selos += '<span class="selo-assumido" title="O nome do frete não foi reconhecido; a letra foi assumida como PAC. Confira na Shopify antes de postar.">'
        + 'FRETE ASSUMIDO</span>';
    }

    // pedido.marcacao vem pronta do back-end: P (site+PAC), S (site+SEDEX),
    // WP (WhatsApp+PAC), WS (WhatsApp+SEDEX).
    var destinatario =
      pedido.nome + '<br>' +
      pedido.endereco1 + '<br>' +
      linha2 +
      pedido.cidade + ' - ' + pedido.estado + '<br>' +
      'CEP: ' + pedido.cep;

    return '' +
      '<div class="' + classes.join(' ') + '" data-pedido="' + pedido.pedido + '"'
        + ' data-servico="' + pedido.servico + '"'
        + ' data-canal="' + pedido.canal + '"'
        + ' data-assumido="' + (pedido.assumido ? 'true' : 'false') + '">' +
        '<input type="checkbox" class="selecionar" ' + (jaImpresso ? '' : 'checked')
          + ' onchange="alternarSelecao(this)"'
          + ' aria-label="Imprimir etiqueta do pedido ' + pedido.pedido + '">' +
        '<div class="barra-celula">' + selos + '</div>' +
        '<div class="cabecalho">DESTINATÁRIO ' + pedido.pedido + ' ' + pedido.marcacao + '</div>' +
        destinatario +
        '<div class="itens">' + itensHtml + '</div>' +
        '<div class="divisor"></div>' +
        '<div class="rotulo-declaracao">Declaração de conteúdo</div>' +
        destinatario +
      '</div>';
  }

  function contar(pedidos) {
    return {
      TODOS: pedidos.length,
      PAC: pedidos.filter(function (p) { return p.servico === 'PAC'; }).length,
      SEDEX: pedidos.filter(function (p) { return p.servico === 'SEDEX'; }).length,
      WHATSAPP: pedidos.filter(function (p) { return p.canal === 'WHATSAPP'; }).length,
      ASSUMIDO: pedidos.filter(function (p) { return p.assumido === true; }).length
    };
  }

  function renderizarGrade() {
    var grade = document.getElementById('grade');
    var impressos = obterImpressos();
    mapaJuntos = calcularJuntos(pedidosCarregados);

    grade.innerHTML = pedidosCarregados.map(function (p) {
      return celulaHtml(p, impressos.indexOf(p.pedido) !== -1);
    }).join('');

    var contagens = contar(pedidosCarregados);
    document.querySelectorAll('.chip').forEach(function (chip) {
      var chave = chip.getAttribute('data-filtro');
      chip.querySelector('.n').textContent = contagens[chave];
      if (chave === 'ASSUMIDO') {
        // só aparece no dia em que acontece — em operação normal não existe
        chip.style.display = contagens[chave] === 0 ? 'none' : 'inline-flex';
      } else {
        chip.disabled = contagens[chave] === 0 && chave !== 'TODOS';
      }
    });

    var novos = pedidosCarregados.filter(function (p) {
      return impressos.indexOf(p.pedido) === -1;
    }).length;
    document.getElementById('status').textContent = pedidosCarregados.length
      + ' pedido(s) encontrado(s) — ' + novos + ' novo(s), '
      + (pedidosCarregados.length - novos) + ' já impresso(s) antes.';

    document.getElementById('barraFiltros').style.display = 'flex';
    document.getElementById('barraSelecao').style.display = 'flex';
    aplicarFiltro();
  }

  // ---------------------------------------------------------------------------
  // filtro + busca
  // ---------------------------------------------------------------------------

  function passaFiltro(celula) {
    if (buscaAtual && celula.getAttribute('data-pedido').toLowerCase().indexOf(buscaAtual) === -1) return false;
    if (filtroAtual === 'PAC') return celula.getAttribute('data-servico') === 'PAC';
    if (filtroAtual === 'SEDEX') return celula.getAttribute('data-servico') === 'SEDEX';
    if (filtroAtual === 'WHATSAPP') return celula.getAttribute('data-canal') === 'WHATSAPP';
    if (filtroAtual === 'ASSUMIDO') return celula.getAttribute('data-assumido') === 'true';
    return true;
  }

  function visiveis() {
    return Array.prototype.filter.call(
      document.querySelectorAll('#grade .celula'),
      function (c) { return !c.classList.contains('filtrada'); }
    );
  }

  function aplicarFiltro() {
    document.querySelectorAll('.chip').forEach(function (chip) {
      chip.setAttribute('aria-pressed', chip.getAttribute('data-filtro') === filtroAtual ? 'true' : 'false');
    });
    document.querySelectorAll('#grade .celula').forEach(function (celula) {
      celula.classList.toggle('filtrada', !passaFiltro(celula));
    });

    var antiga = document.querySelector('#grade .vazio');
    if (antiga) antiga.parentNode.removeChild(antiga);
    if (visiveis().length === 0 && pedidosCarregados.length > 0) {
      document.getElementById('grade').insertAdjacentHTML('beforeend',
        '<div class="vazio">Nenhum pedido bate com esse filtro.</div>');
    }

    atualizarContador();
  }

  function trocarFiltro(chip) {
    filtroAtual = chip.getAttribute('data-filtro');
    aplicarFiltro();
  }

  // ---------------------------------------------------------------------------
  // contador + resumo da impressão
  // ---------------------------------------------------------------------------

  function atualizarContador() {
    var lista = visiveis();
    var selecionadas = lista.filter(function (c) { return c.classList.contains('selecionada'); });
    var n = selecionadas.length;

    var recorte = [];
    if (filtroAtual !== 'TODOS') recorte.push('filtro ' + filtroAtual.toLowerCase());
    if (buscaAtual) recorte.push('busca "' + buscaAtual + '"');
    var sufixo = recorte.length ? ' (dentro de ' + recorte.join(' + ') + ')' : '';

    var contador = document.getElementById('contador');
    if (contador) {
      contador.textContent = n + ' de ' + lista.length + ' selecionada(s) para impressão' + sufixo;
    }

    var btn = document.getElementById('btnImprimir');
    var resumo = document.getElementById('resumoImpressao');

    if (n === 0) {
      btn.style.display = 'none';
      resumo.style.display = 'none';
      return;
    }

    btn.style.display = 'inline-block';
    btn.textContent = 'Imprimir ' + n + (n === 1 ? ' etiqueta' : ' etiquetas');

    var pedidosSel = [];
    selecionadas.forEach(function (c) {
      var p = pedidoPorNumero(c.getAttribute('data-pedido'));
      if (p) pedidosSel.push(p);
    });
    var itens = totalItens(pedidosSel);

    resumo.style.display = 'inline-block';
    resumo.innerHTML = '<b>' + itens + (itens === 1 ? ' item' : ' itens')
      + '</b> para separar &nbsp;·&nbsp; ' + textoFolhas(n);
  }

  // ---------------------------------------------------------------------------
  // seleção
  // ---------------------------------------------------------------------------

  function alternarSelecao(chk) {
    chk.closest('.celula').classList.toggle('selecionada', chk.checked);
    atualizarContador();
  }

  // As ações de marcar respeitam o filtro/busca ativos: quem filtrou por SEDEX e clicou
  // "marcar todos" quer os SEDEX, não os 20 da fila.
  function marcarTodos(valor) {
    visiveis().forEach(function (celula) {
      var chk = celula.querySelector('input.selecionar');
      chk.checked = valor;
      celula.classList.toggle('selecionada', valor);
    });
    atualizarContador();
  }

  function marcarSoNovos() {
    visiveis().forEach(function (celula) {
      var novo = !celula.classList.contains('ja-impresso');
      var chk = celula.querySelector('input.selecionar');
      chk.checked = novo;
      celula.classList.toggle('selecionada', novo);
    });
    atualizarContador();
  }

  function limparHistorico() {
    if (confirm('Isso vai esquecer quais etiquetas já foram impressas antes, e todas voltam a aparecer como "novo". Continuar?')) {
      try { localStorage.removeItem(CHAVE_IMPRESSOS); } catch (e) {}
      if (pedidosCarregados.length) renderizarGrade();
      else buscarPedidos();
    }
  }

  // ---------------------------------------------------------------------------
  // impressão
  // ---------------------------------------------------------------------------

  function imprimirSelecionadas() {
    var numeros = visiveis()
      .filter(function (c) { return c.classList.contains('selecionada'); })
      .map(function (c) { return c.getAttribute('data-pedido'); });

    if (numeros.length === 0) {
      alert('Selecione ao menos uma etiqueta pra imprimir.');
      return;
    }

    // A tela só pode ser redesenhada DEPOIS que o navegador terminou de imprimir. Redesenhar
    // antes tiraria a classe .selecionada das células — e é ela que decide o que sai no papel;
    // a folha sairia em branco.
    var finalizar = function () {
      var impressos = obterImpressos();
      numeros.forEach(function (n) {
        if (impressos.indexOf(n) === -1) impressos.push(n);
      });
      salvarImpressos(impressos);
      renderizarGrade();
      document.getElementById('status').textContent =
        numeros.length + ' etiqueta(s) marcada(s) como impressa(s): ' + numeros.join(' ') + '.';
    };

    if ('onafterprint' in window) {
      window.addEventListener('afterprint', finalizar, { once: true });
    } else {
      setTimeout(finalizar, 800);
    }

    window.print();
  }

  // ---------------------------------------------------------------------------
  // busca dos pedidos na Shopify
  // ---------------------------------------------------------------------------

  function buscarPedidos() {
    var status = document.getElementById('status');
    var btn = document.getElementById('btnBuscar');
    var grade = document.getElementById('grade');

    btn.disabled = true;
    document.getElementById('btnImprimir').style.display = 'none';
    document.getElementById('resumoImpressao').style.display = 'none';
    document.getElementById('barraSelecao').style.display = 'none';
    document.getElementById('barraFiltros').style.display = 'none';
    status.innerHTML = '<span class="ponto-carregando"></span> Buscando pedidos...';
    grade.innerHTML = '';

    fetch(FUNCTION_URL)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        btn.disabled = false;
        if (data.error) {
          status.textContent = 'Erro: ' + data.error;
          return;
        }
        pedidosCarregados = data.pedidos || [];
        if (pedidosCarregados.length === 0) {
          status.textContent = '';
          grade.innerHTML = '<div class="vazio">Nenhuma etiqueta a ser impressa no momento.</div>';
          return;
        }
        filtroAtual = 'TODOS';
        renderizarGrade();
      })
      .catch(function (err) {
        btn.disabled = false;
        status.textContent = 'Erro ao buscar: ' + err.message;
      });
  }

  // ---------------------------------------------------------------------------
  // controles novos (chips e busca) — ligados por listener, não por onclick no HTML
  // ---------------------------------------------------------------------------

  document.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () { trocarFiltro(chip); });
  });

  (function () {
    var campo = document.getElementById('busca');
    var limpar = document.getElementById('btnLimparBusca');

    campo.addEventListener('input', function () {
      buscaAtual = campo.value.trim().replace('#', '').toLowerCase();
      limpar.style.display = buscaAtual === '' ? 'none' : 'flex';
      if (pedidosCarregados.length) aplicarFiltro();
    });

    limpar.addEventListener('click', function () {
      campo.value = '';
      buscaAtual = '';
      limpar.style.display = 'none';
      if (pedidosCarregados.length) aplicarFiltro();
      campo.focus();
    });
  })();
</script>

</body>
</html>
`;

function parseCorpoForm(body, isBase64Encoded) {
  const texto = isBase64Encoded ? Buffer.from(body || '', 'base64').toString('utf8') : (body || '');
  const params = new URLSearchParams(texto);
  return { usuario: params.get('usuario') || '', senha: params.get('senha') || '' };
}

exports.handler = async function (event) {
  const segredo = process.env.ETIQUETAS_SESSAO_SEGREDO;
  const usuarioEsperado = process.env.ETIQUETAS_USUARIO;
  const senhaEsperada = process.env.ETIQUETAS_SENHA;

  if (!segredo || !usuarioEsperado || !senhaEsperada) {
    return { statusCode: 500, body: 'Configuração incompleta: faltam variáveis de ambiente (ETIQUETAS_USUARIO, ETIQUETAS_SENHA, ETIQUETAS_SESSAO_SEGREDO).' };
  }

  if (event.httpMethod === 'POST') {
    const { usuario, senha } = parseCorpoForm(event.body, event.isBase64Encoded);
    if (usuario === usuarioEsperado && senha === senhaEsperada) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': criarCookie(segredo) },
        body: HTML_FERRAMENTA
      };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: paginaLogin(true)
    };
  }

  if (!sessaoValida(event, segredo)) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: paginaLogin(false)
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: HTML_FERRAMENTA
  };
};
