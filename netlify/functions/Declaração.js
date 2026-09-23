// ---------------------------------------------------------------------------
// declaracao.js — serve o módulo de Declaração de Conteúdo para a página de
// etiquetas. É uma function que devolve JAVASCRIPT (não HTML): a página de
// etiquetas carrega este arquivo com <script src="/.netlify/functions/declaracao">.
//
// Por que um arquivo separado: etiquetas-pagina.js está em produção e funciona.
// Todo o código novo mora aqui, e o que muda lá são 4 encaixes pequenos e
// marcados com "DECLARAÇÃO". Se algo der errado, basta remover o <script> e a
// ferramenta volta exatamente ao que era.
//
// O PDF não é desenhado do zero: o modelo oficial dos Correios usado pela JL é
// carregado de /modelo-declaracao.pdf e os dados são CARIMBADOS por cima. O
// desenho do formulário nunca muda.
// ---------------------------------------------------------------------------

const MODULO = `
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Coordenadas, medidas no próprio modelo com um extrator de PDF.
  // Origem do PDF é o canto inferior esquerdo; o "top" abaixo é medido a partir
  // do topo (como se lê o papel) e convertido por y().
  // -------------------------------------------------------------------------
  var URL_MODELO   = '/modelo-declaracao.pdf';
  var ALTURA       = 841.92;   // A4 em pontos
  var OFFSET_VIA2  = 403.8;    // distância entre a declaração de cima e a de baixo
  var INCLUIR_DOC  = false;    // CPF/CNPJ: desligado por sigilo do cliente

  function y(top, bottom) { return ALTURA - bottom + 1.6; }

  var POS = {
    nome:   { x: 326, y: y(65.0, 73.1) },
    end1:   { x: 343, y: y(79.9, 88.0) },
    end2:   { x: 299, y: y(94.8, 102.9) },
    cidade: { x: 332, y: y(109.9, 118.0) },
    uf:     { x: 538, y: y(109.9, 118.0) },
    cep:    { x: 317, y: y(124.8, 132.9) },
    doc:    { x: 454, y: y(124.8, 132.9) }
  };

  var LINHAS_ITEM = [163.1, 177.3, 191.4, 205.6, 219.7];
  var ALT_LINHA   = 14.2;
  var X_ITEM      = 35.5;    // centro da coluna ITEM
  var X_CONTEUDO  = 58.9;    // início da coluna CONTEÚDO
  var X_QUANT     = 432.6;   // centro da coluna QUANT.
  var LARG_CONT   = 326;     // espaço útil da coluna CONTEÚDO

  // A linha 1 do modelo vem com "1  Colágeno Tipo II" impresso. Cobrimos só o
  // MIOLO das duas células, sem encostar nas bordas verticais da tabela —
  // senão a moldura da tabela sumiria junto.
  var COBERTURA = [
    { x: 15.6, larg: 40.4 },   // célula ITEM      (bordas em 14.8 e 56.3)
    { x: 57.0, larg: 328.0 }   // célula CONTEÚDO  (bordas em 56.5 e 385.1)
  ];

  var DATA_Y   = y(352.3, 365.3);
  var X_DIA    = 150;   // centralizado na lacuna do dia
  var X_MES    = 235;   // centralizado na lacuna do mês
  var ANO_MODELO = 2026;  // ano IMPRESSO no papel — ver alertaDoAno()

  var MESES = ['janeiro','fevereiro','março','abril','maio','junho',
               'julho','agosto','setembro','outubro','novembro','dezembro'];

  // -------------------------------------------------------------------------
  // estado
  // -------------------------------------------------------------------------
  var modeloBytes = null;      // cache do PDF em branco
  var semDeclaracao = {};      // { '#1842': true } = declaração desmarcada nesse pedido
  var urlAtual = null;         // object URL da prévia em exibição
  var abaAtiva = 'etiquetas';

  // -------------------------------------------------------------------------
  // utilidades
  // -------------------------------------------------------------------------
  function selecionados() {
    var lista = [].slice.call(document.querySelectorAll('#grade .celula'));
    return lista.filter(function (c) {
      return c.classList.contains('selecionada') && !c.classList.contains('filtrada');
    });
  }

  function pedidosParaDeclaracao() {
    return selecionados()
      .map(function (c) { return c.getAttribute('data-pedido'); })
      .filter(function (n) { return !semDeclaracao[n]; })
      .map(dadosDoPedido)
      .filter(Boolean);
  }

  function dadosDoPedido(numero) {
    if (!window.pedidosCarregados) return null;
    for (var i = 0; i < window.pedidosCarregados.length; i++) {
      if (window.pedidosCarregados[i].pedido === numero) return window.pedidosCarregados[i];
    }
    return null;
  }

  function encurtar(texto, fonte, tamanho, largura) {
    var t = String(texto || '');
    if (fonte.widthOfTextAtSize(t, tamanho) <= largura) return t;
    while (t.length > 3 && fonte.widthOfTextAtSize(t + '...', tamanho) > largura) {
      t = t.slice(0, -1);
    }
    return t + '...';
  }

  // Acentuação: a fonte Helvetica embutida do PDF usa WinAnsi e engasga com
  // alguns caracteres. Trocamos só o que não existe nessa tabela.
  function limpar(texto) {
    return String(texto == null ? '' : texto)
      .replace(/[\\u2018\\u2019]/g, "'")
      .replace(/[\\u201C\\u201D]/g, '"')
      .replace(/[\\u2013\\u2014]/g, '-')
      .replace(/\\u00A0/g, ' ');
  }

  function formatarDoc(bruto) {
    var d = String(bruto || '').replace(/\\D/g, '');
    if (d.length === 11) return d.slice(0,3)+'.'+d.slice(3,6)+'.'+d.slice(6,9)+'-'+d.slice(9);
    if (d.length === 14) return d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5,8)+'/'+d.slice(8,12)+'-'+d.slice(12);
    return String(bruto || '');
  }

  // -------------------------------------------------------------------------
  // geração do PDF
  // -------------------------------------------------------------------------
  function carregarModelo() {
    if (modeloBytes) return Promise.resolve(modeloBytes);
    return fetch(URL_MODELO).then(function (r) {
      if (!r.ok) {
        throw new Error('Não encontrei o modelo em ' + URL_MODELO +
          ' (HTTP ' + r.status + '). O arquivo modelo-declaracao.pdf precisa estar na raiz do repositório.');
      }
      return r.arrayBuffer();
    }).then(function (buf) {
      modeloBytes = buf;
      return buf;
    });
  }

  function desenharVia(pagina, fonte, negrito, pedido, dy) {
    var rgb = PDFLib.rgb;
    var hoje = new Date();

    function texto(str, x, yy, tam, bold) {
      pagina.drawText(limpar(str), {
        x: x, y: yy - dy, size: tam || 10,
        font: bold ? negrito : fonte, color: rgb(0, 0, 0)
      });
    }
    function centrado(str, cx, yy, tam) {
      var s = limpar(str);
      texto(s, cx - fonte.widthOfTextAtSize(s, tam || 10) / 2, yy, tam);
    }

    // --- destinatário ---
    texto(pedido.nome.toUpperCase(), POS.nome.x, POS.nome.y);
    texto(pedido.endereco1.toUpperCase(), POS.end1.x, POS.end1.y);
    if (pedido.endereco2) texto(pedido.endereco2.toUpperCase(), POS.end2.x, POS.end2.y);
    texto(pedido.cidade.toUpperCase(), POS.cidade.x, POS.cidade.y);
    texto(pedido.estado, POS.uf.x, POS.uf.y);
    texto(pedido.cep, POS.cep.x, POS.cep.y);
    if (INCLUIR_DOC && pedido.documento) {
      texto(formatarDoc(pedido.documento), POS.doc.x, POS.doc.y);
    }

    // --- itens ---
    // Tapa o "1  Colágeno Tipo II" impresso na linha 1 e escreve os itens reais.
    // QUANT. é a quantidade de UNIDADES COMPRADAS daquele produto, não de potes:
    // a contagem de potes já está no nome do produto ("... - 3 POTES").
    var itens = pedido.itens || [];
    if (itens.length) {
      COBERTURA.forEach(function (c) {
        pagina.drawRectangle({
          x: c.x, y: ALTURA - (LINHAS_ITEM[0] + ALT_LINHA) + 0.8 - dy,
          width: c.larg, height: ALT_LINHA - 1.6,
          color: rgb(1, 1, 1)
        });
      });
    }

    itens.slice(0, LINHAS_ITEM.length).forEach(function (item, i) {
      var base = ALTURA - LINHAS_ITEM[i] - ALT_LINHA + 0.1;
      centrado(String(i + 1), X_ITEM, base, 10);
      texto(encurtar(limpar(item.titulo), fonte, 10, LARG_CONT), X_CONTEUDO, base);
      centrado(String(item.quantidade), X_QUANT, base, 10);
    });

    // VALOR, TOTAIS e PESO TOTAL ficam em branco de propósito — são preenchidos
    // à mão pela equipe da JL.

    // --- data (dia e mês; o ano vem impresso no modelo) ---
    centrado(String(hoje.getDate()), X_DIA, DATA_Y, 10);
    centrado(MESES[hoje.getMonth()], X_MES, DATA_Y, 10);

    // --- carimbo do pedido, para casar com a etiqueta na bancada ---
    // Vai na faixa do título, à direita: é o único espaço livre do formulário
    // que não encosta em nenhum campo nem na linha da assinatura.
    var carimbo = 'PEDIDO ' + pedido.pedido;
    texto(carimbo, 572 - negrito.widthOfTextAtSize(carimbo, 8), ALTURA - 42.5 + 1.2, 8, true);
  }

  // Monta o PDF final. Cada FOLHA leva DOIS pedidos diferentes (de cima e de
  // baixo), que são separados no corte.
  function gerarPdf(pedidos) {
    if (typeof PDFLib === 'undefined') {
      return Promise.reject(new Error('A biblioteca pdf-lib não carregou. Confira a conexão e recarregue a página.'));
    }
    return carregarModelo().then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes);
    }).then(function (modelo) {
      return PDFLib.PDFDocument.create().then(function (saida) {
        return saida.embedFont(PDFLib.StandardFonts.Helvetica).then(function (fonte) {
          return saida.embedFont(PDFLib.StandardFonts.HelveticaBold).then(function (negrito) {
            var total = Math.ceil(pedidos.length / 2);
            var passos = Promise.resolve();
            for (var f = 0; f < total; f++) {
              (function (indiceFolha) {
                passos = passos.then(function () {
                  return saida.copyPages(modelo, [0]).then(function (copias) {
                    var pagina = copias[0];
                    saida.addPage(pagina);
                    var cima  = pedidos[indiceFolha * 2];
                    var baixo = pedidos[indiceFolha * 2 + 1];
                    if (cima)  desenharVia(pagina, fonte, negrito, cima, 0);
                    if (baixo) desenharVia(pagina, fonte, negrito, baixo, OFFSET_VIA2);
                  });
                });
              })(f);
            }
            return passos.then(function () { return saida.save(); });
          });
        });
      });
    }).then(function (bytes) {
      return new Blob([bytes], { type: 'application/pdf' });
    });
  }

  // -------------------------------------------------------------------------
  // interface
  // -------------------------------------------------------------------------
  function alertaDoAno() {
    var anoAgora = new Date().getFullYear();
    if (anoAgora === ANO_MODELO) return '';
    return '<div class="aviso-ano">' +
      '<span class="ico-ano">!</span>' +
      '<div><b>O modelo ainda é de ' + ANO_MODELO + ' e estamos em ' + anoAgora + '.</b> ' +
      'O ano vem impresso no papel, não é preenchido pelo sistema. ' +
      'Gere um modelo novo com ' + anoAgora + ', suba como modelo-declaracao.pdf e ' +
      'atualize ANO_MODELO em declaracao.js.</div></div>';
  }

  function montarPainel() {
    if (document.getElementById('painelDeclaracao')) return;
    var alvo = document.getElementById('area-declaracao');
    if (!alvo) return;

    alvo.innerHTML =
      '<div id="painelDeclaracao">' +
        '<div class="titulo-caixa">O que vai na caixa' +
          '<span class="dica-caixa">clique para ligar ou desligar em todos os pedidos</span>' +
        '</div>' +
        '<div class="opcoes-envio">' +
          '<button type="button" class="opcao-envio op-etiqueta" id="opEtiqueta" aria-pressed="true">' +
            '<span class="check-envio">&#10003;</span>' +
            '<span><span class="nome-envio">Etiquetas</span>' +
            '<span class="det-envio" id="detEtiqueta">—</span></span>' +
          '</button>' +
          '<button type="button" class="opcao-envio op-declaracao" id="opDeclaracao" aria-pressed="true">' +
            '<span class="check-envio">&#10003;</span>' +
            '<span><span class="nome-envio">Declarações de conteúdo</span>' +
            '<span class="det-envio" id="detDeclaracao">—</span></span>' +
          '</button>' +
        '</div>' +
        '<div class="total-envio"><span id="totalFolhas">—</span>' +
          '<span class="aviso-janelas">Saem duas impressões seguidas: primeiro as etiquetas, depois as declarações.</span>' +
        '</div>' +
        alertaDoAno() +
        '<div class="acoes-envio">' +
          '<button type="button" id="btnImprimirTudo">Imprimir etiquetas e declarações</button>' +
          '<button type="button" class="botao-secundario" id="btnVerDeclaracoes">Ver prévia das declarações</button>' +
          '<span id="statusDeclaracao" class="status-decl"></span>' +
        '</div>' +
      '</div>' +
      '<div id="visorDeclaracao" style="display:none;">' +
        '<div class="barra-visor">' +
          '<span id="tituloVisor">Prévia</span>' +
          '<button type="button" class="botao-secundario" id="btnFecharVisor">Voltar para as etiquetas</button>' +
        '</div>' +
        '<iframe id="quadroDeclaracao" title="Prévia da declaração de conteúdo"></iframe>' +
      '</div>';

    document.getElementById('opEtiqueta').addEventListener('click', function () {
      var ligar = this.getAttribute('aria-pressed') !== 'true';
      document.querySelectorAll('#grade .celula:not(.filtrada) .selecionar').forEach(function (chk) {
        if (chk.checked !== ligar) { chk.checked = ligar; window.alternarSelecao(chk); }
      });
      atualizar();
    });

    document.getElementById('opDeclaracao').addEventListener('click', function () {
      var ligar = this.getAttribute('aria-pressed') !== 'true';
      selecionados().forEach(function (c) {
        var n = c.getAttribute('data-pedido');
        if (ligar) delete semDeclaracao[n]; else semDeclaracao[n] = true;
      });
      aoRenderizar();
    });

    document.getElementById('btnImprimirTudo').addEventListener('click', imprimirTudo);
    document.getElementById('btnVerDeclaracoes').addEventListener('click', function () {
      verPrevia(pedidosParaDeclaracao(), 'Prévia de todas as declarações');
    });
    document.getElementById('btnFecharVisor').addEventListener('click', mostrarEtiquetas);
  }

  // Injeta o par de botões (declaração / prévia) na barra de cada célula.
  function aoRenderizar() {
    montarPainel();
    document.querySelectorAll('#grade .celula').forEach(function (celula) {
      var numero = celula.getAttribute('data-pedido');
      var barra = celula.querySelector('.barra-celula');
      if (!barra || barra.querySelector('.alt-declaracao')) { atualizarCelula(celula); return; }

      var bDecl = document.createElement('button');
      bDecl.type = 'button';
      bDecl.className = 'alt-declaracao';
      bDecl.textContent = 'Declaração';
      bDecl.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (semDeclaracao[numero]) delete semDeclaracao[numero];
        else semDeclaracao[numero] = true;
        aoRenderizar();
      });

      var bPrev = document.createElement('button');
      bPrev.type = 'button';
      bPrev.className = 'alt-previa';
      bPrev.textContent = 'Prévia';
      bPrev.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var p = dadosDoPedido(numero);
        if (p) verPrevia([p], 'Prévia do pedido ' + numero);
      });

      barra.appendChild(bDecl);
      barra.appendChild(bPrev);
      atualizarCelula(celula);
    });
    atualizar();
  }

  function atualizarCelula(celula) {
    var numero = celula.getAttribute('data-pedido');
    var botao = celula.querySelector('.alt-declaracao');
    if (!botao) return;
    var ligada = !semDeclaracao[numero];
    botao.setAttribute('aria-pressed', ligada ? 'true' : 'false');
    var etiquetaLigada = celula.classList.contains('selecionada');
    celula.classList.toggle('parcial', etiquetaLigada !== ligada);
  }

  function atualizar() {
    var sel = selecionados();
    var qtdEtiquetas = sel.length;
    var qtdDeclaracoes = sel.filter(function (c) {
      return !semDeclaracao[c.getAttribute('data-pedido')];
    }).length;

    var folhasEtiqueta = Math.ceil(qtdEtiquetas / (window.POSICOES_FOLHA || 12));
    var folhasDecl = Math.ceil(qtdDeclaracoes / 2);

    var detE = document.getElementById('detEtiqueta');
    var detD = document.getElementById('detDeclaracao');
    if (!detE) return;

    detE.textContent = qtdEtiquetas + ' etiqueta(s) · ' + folhasEtiqueta + ' folha(s)';
    detD.textContent = qtdDeclaracoes + ' de ' + qtdEtiquetas + ' · ' + folhasDecl + ' folha(s), 2 pedidos por folha';

    document.getElementById('opEtiqueta').setAttribute('aria-pressed', qtdEtiquetas ? 'true' : 'false');
    document.getElementById('opDeclaracao').setAttribute('aria-pressed', qtdDeclaracoes ? 'true' : 'false');

    var parciais = sel.filter(function (c) { return c.classList.contains('parcial'); }).length;
    document.getElementById('totalFolhas').innerHTML =
      'Total: <b>' + (folhasEtiqueta + folhasDecl) + ' folha(s)</b> para ' + qtdEtiquetas + ' pedido(s)' +
      (parciais ? ' · ' + parciais + ' com impressão parcial' : '');

    document.getElementById('btnImprimirTudo').disabled = qtdEtiquetas === 0 && qtdDeclaracoes === 0;
  }

  // -------------------------------------------------------------------------
  // prévia e impressão
  // -------------------------------------------------------------------------
  function mostrarEtiquetas() {
    abaAtiva = 'etiquetas';
    document.getElementById('area-grade').style.display = '';
    document.getElementById('visorDeclaracao').style.display = 'none';
  }

  function verPrevia(pedidos, titulo) {
    var status = document.getElementById('statusDeclaracao');
    if (!pedidos.length) {
      status.textContent = 'Nenhum pedido com declaração marcada.';
      return;
    }
    status.textContent = 'Montando o PDF...';
    return gerarPdf(pedidos).then(function (blob) {
      if (urlAtual) URL.revokeObjectURL(urlAtual);
      urlAtual = URL.createObjectURL(blob);
      document.getElementById('tituloVisor').textContent =
        titulo + ' — ' + Math.ceil(pedidos.length / 2) + ' folha(s)';
      document.getElementById('quadroDeclaracao').src = urlAtual;
      document.getElementById('area-grade').style.display = 'none';
      document.getElementById('visorDeclaracao').style.display = 'block';
      abaAtiva = 'declaracoes';
      status.textContent = '';
      return blob;
    }).catch(function (e) {
      status.textContent = 'Erro: ' + e.message;
      throw e;
    });
  }

  function imprimirDeclaracoes() {
    var quadro = document.getElementById('quadroDeclaracao');
    try {
      quadro.contentWindow.focus();
      quadro.contentWindow.print();
    } catch (e) {
      // Alguns navegadores não deixam imprimir um PDF dentro de iframe.
      document.getElementById('statusDeclaracao').innerHTML =
        'Não consegui abrir a impressão daqui. <a href="' + urlAtual + '" target="_blank">Abra o PDF numa aba</a> e imprima por lá.';
    }
  }

  function imprimirTudo() {
    var status = document.getElementById('statusDeclaracao');
    var pedidos = pedidosParaDeclaracao();
    var temEtiqueta = selecionados().length > 0;

    if (!temEtiqueta) { verPrevia(pedidos, 'Prévia de todas as declarações').then(imprimirDeclaracoes); return; }

    // Gera o PDF ANTES de imprimir as etiquetas: assim, quando o diálogo das
    // etiquetas fechar, a declaração já está pronta e a segunda impressão sai
    // sem espera.
    status.textContent = 'Montando as declarações...';
    var preparado = pedidos.length ? verPrevia(pedidos, 'Prévia de todas as declarações') : Promise.resolve(null);

    preparado.then(function () {
      mostrarEtiquetas();
      if (pedidos.length) {
        window.addEventListener('afterprint', function () {
          setTimeout(function () {
            document.getElementById('area-grade').style.display = 'none';
            document.getElementById('visorDeclaracao').style.display = 'block';
            imprimirDeclaracoes();
          }, 400);
        }, { once: true });
      }
      window.imprimirSelecionadas();
    }).catch(function () { /* mensagem já apareceu no status */ });
  }

  window.Declaracao = { aoRenderizar: aoRenderizar, atualizar: atualizar };
})();
`;

const CSS_INFO = '/* o CSS do módulo mora em etiquetas-pagina.js, junto do resto do estilo */';

exports.handler = async () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store'
  },
  body: CSS_INFO + '\n' + MODULO
});
