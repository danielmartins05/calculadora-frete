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
    display: flex;
    align-items: center;
    gap: 8px;
  }

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
    margin-top: 24px;
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

  #grade {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
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

  .badge-novo, .badge-impresso {
    display: inline-block;
    font-family: 'Inter', Arial, sans-serif;
    font-size: 6.5pt;
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 3px;
    margin-left: 4px;
    vertical-align: middle;
  }
  .badge-novo { background: var(--verde); color: #fff; }
  .badge-impresso { background: #B9BDB4; color: #fff; }

  .cabecalho { font-weight: bold; margin-bottom: 1px; }
  .divisor { border-top: 1px dashed #999; margin: 3px 0; }
  .rotulo-declaracao { font-size: 7pt; color: #777; margin-bottom: 1px; }
  .itens { margin-top: 2px; }

  @media print {
    body { background: #fff; margin: 0; }
    .pagina { max-width: none; padding: 0; }
    header, .painel, #status { display: none; }
    #area-grade { border: none; box-shadow: none; padding: 0; border-radius: 0; }
    #grade { gap: 0; }
    .celula { border: 1px solid #000; border-radius: 0; padding: 5px 6px; opacity: 1 !important; }
    .celula:not(.selecionada) { display: none; }
    .celula .selecionar, .badge-novo, .badge-impresso { display: none; }
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

  function obterImpressos() {
    try { return JSON.parse(localStorage.getItem(CHAVE_IMPRESSOS) || '[]'); }
    catch (e) { return []; }
  }

  function salvarImpressos(lista) {
    localStorage.setItem(CHAVE_IMPRESSOS, JSON.stringify(lista));
  }

  function celulaHtml(pedido, jaImpresso) {
    var linha2 = pedido.endereco2 ? (pedido.endereco2 + '<br>') : '';
    var itensHtml = (pedido.itens || [])
      .map(function (it) { return it.quantidade + 'x ' + it.titulo; })
      .join('<br>');
    var classeExtra = jaImpresso ? 'ja-impresso' : 'selecionada';
    var marcado = jaImpresso ? '' : 'checked';
    var badge = jaImpresso
      ? '<span class="badge-impresso">JÁ IMPRESSO</span>'
      : '<span class="badge-novo">NOVO</span>';
    return '' +
      '<div class="celula ' + classeExtra + '" data-pedido="' + pedido.pedido + '">' +
        '<input type="checkbox" class="selecionar" ' + marcado + ' onchange="alternarSelecao(this)">' +
        '<div class="cabecalho">DESTINATÁRIO ' + pedido.pedido + ' ' + pedido.pagamento + '&nbsp;&nbsp;' + pedido.servico + badge + '</div>' +
        pedido.nome + '<br>' +
        pedido.endereco1 + '<br>' +
        linha2 +
        pedido.cidade + ' - ' + pedido.estado + '<br>' +
        'CEP: ' + pedido.cep +
        '<div class="itens">' + itensHtml + '</div>' +
        '<div class="divisor"></div>' +
        '<div class="rotulo-declaracao">Declaração de conteúdo</div>' +
        pedido.nome + '<br>' +
        pedido.endereco1 + '<br>' +
        linha2 +
        pedido.cidade + ' - ' + pedido.estado + '<br>' +
        'CEP: ' + pedido.cep +
      '</div>';
  }

  function alternarSelecao(chk) {
    var celula = chk.closest('.celula');
    celula.classList.toggle('selecionada', chk.checked);
    atualizarContador();
  }

  function atualizarContador() {
    var total = document.querySelectorAll('#grade .celula').length;
    var selecionadas = document.querySelectorAll('#grade .celula.selecionada').length;
    var contador = document.getElementById('contador');
    if (contador) contador.textContent = selecionadas + ' de ' + total + ' selecionada(s) para impressão';
  }

  function marcarTodos(valor) {
    document.querySelectorAll('#grade input.selecionar').forEach(function (chk) {
      chk.checked = valor;
      chk.closest('.celula').classList.toggle('selecionada', valor);
    });
    atualizarContador();
  }

  function marcarSoNovos() {
    document.querySelectorAll('#grade .celula').forEach(function (celula) {
      var chk = celula.querySelector('input.selecionar');
      var novo = !celula.classList.contains('ja-impresso');
      chk.checked = novo;
      celula.classList.toggle('selecionada', novo);
    });
    atualizarContador();
  }

  function limparHistorico() {
    if (confirm('Isso vai esquecer quais etiquetas já foram impressas antes, e todas voltam a aparecer como "novo". Continuar?')) {
      localStorage.removeItem(CHAVE_IMPRESSOS);
      buscarPedidos();
    }
  }

  function imprimirSelecionadas() {
    var selecionadas = document.querySelectorAll('#grade .celula.selecionada');
    if (selecionadas.length === 0) {
      alert('Selecione ao menos uma etiqueta pra imprimir.');
      return;
    }
    var impressos = obterImpressos();
    selecionadas.forEach(function (celula) {
      var pedido = celula.getAttribute('data-pedido');
      if (impressos.indexOf(pedido) === -1) impressos.push(pedido);
    });
    salvarImpressos(impressos);
    window.print();
  }

  function buscarPedidos() {
    var status = document.getElementById('status');
    var btn = document.getElementById('btnBuscar');
    var grade = document.getElementById('grade');
    btn.disabled = true;
    document.getElementById('btnImprimir').style.display = 'none';
    document.getElementById('barraSelecao').style.display = 'none';
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
        var pedidos = data.pedidos || [];
        if (pedidos.length === 0) {
          status.textContent = '';
          grade.innerHTML = '';
          document.getElementById('area-grade').innerHTML =
            '<div class="vazio">Nenhuma etiqueta a ser impressa no momento.</div>';
          return;
        }
        var impressos = obterImpressos();
        var html = pedidos.map(function (p) {
          var jaImpresso = impressos.indexOf(p.pedido) !== -1;
          return celulaHtml(p, jaImpresso);
        }).join('');
        grade.innerHTML = html;

        var novos = pedidos.filter(function (p) { return impressos.indexOf(p.pedido) === -1; }).length;
        status.textContent = pedidos.length + ' pedido(s) encontrado(s) — ' + novos + ' novo(s), ' + (pedidos.length - novos) + ' já impresso(s) antes.';
        document.getElementById('btnImprimir').style.display = 'inline-block';
        document.getElementById('barraSelecao').style.display = 'flex';
        atualizarContador();
      })
      .catch(function (err) {
        btn.disabled = false;
        status.textContent = 'Erro ao buscar: ' + err.message;
      });
  }
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
