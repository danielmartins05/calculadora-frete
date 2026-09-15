// Proxy serverless (Netlify Functions) — busca os pedidos pendentes de envio direto da
// Shopify (pagos, ainda não despachados) e devolve só os dados necessários pra montar
// a etiqueta: nome do destinatário, endereço, CEP e serviço de frete escolhido.
//
// Usa o MESMO app custom "Frete Correios" já criado (Client Credentials Grant), só que
// agora com o escopo read_orders também liberado.
//
// Variáveis de ambiente necessárias (reaproveita as já configuradas):
//   SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
//   ETIQUETAS_SESSAO_SEGREDO -> MESMO valor configurado em etiquetas-pagina.js, usado
//   pra validar o cookie de sessão criado no login (formulário próprio, não é mais o
//   popup nativo do navegador). Esta função devolve nome/endereço de clientes, por isso
//   continua protegida.
//
// Suposição de negócio (ajustável): "pendente de envio" = pedido pago (financial_status
// PAID) e ainda não despachado (displayFulfillmentStatus UNFULFILLED ou PARTIALLY_FULFILLED).
//
// MARCAÇÃO DA ETIQUETA (decidido com o Ney em 15/09/2026): a letra do cabeçalho representa o
// MEIO DE ENVIO, não a forma de pagamento. P = PAC, S = SEDEX, prefixadas por W quando o pedido
// veio do WhatsApp (pedido manual com a tag 'canal-whatsapp'):
//     P = site + PAC        S = site + SEDEX
//    WP = WhatsApp + PAC   WS = WhatsApp + SEDEX
// A palavra do serviço saiu do cabeçalho (era redundante com a letra) e a forma de pagamento
// deixou de ser impressa — na bancada o que importa é em qual remessa o pacote vai.

const crypto = require('crypto');
const NOME_COOKIE = 'jl_etq_sessao';

function assinar(valor, segredo) {
  return crypto.createHmac('sha256', segredo).update(valor).digest('hex');
}

// Confere se existe um cookie de sessão válido (criado pelo login em etiquetas-pagina.js).
// Se ETIQUETAS_SESSAO_SEGREDO não estiver configurado, bloqueia por segurança (em vez de
// deixar aberto por engano).
function autenticado(event) {
  const segredo = process.env.ETIQUETAS_SESSAO_SEGREDO;
  if (!segredo) return false;

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

function respostaNaoAutorizado() {
  return {
    statusCode: 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Sessão inválida ou expirada. Faça login novamente.' })
  };
}

// Mapa nome do estado (sem acento, minúsculo) -> sigla. A Shopify às vezes devolve o
// nome completo do estado em "province" em vez da sigla, então normalizamos aqui.
const UF_POR_NOME = {
  'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM', 'bahia': 'BA',
  'ceara': 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', 'goias': 'GO',
  'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG',
  'para': 'PA', 'paraiba': 'PB', 'parana': 'PR', 'pernambuco': 'PE', 'piaui': 'PI',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS',
  'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP',
  'sergipe': 'SE', 'tocantins': 'TO'
};

function normalizarTexto(texto) {
  return (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function siglaEstado(provincia) {
  if (!provincia) return '';
  if (provincia.trim().length <= 2) return provincia.trim().toUpperCase();
  return UF_POR_NOME[normalizarTexto(provincia)] || provincia;
}

// Deduz se o pagamento foi via Pix, boleto ou cartão a partir do(s) gateway(s) usados no
// pedido. Isso depende de como a Yampi/AppMax nomeia os gateways — se a letra vier errada
// em algum caso real, é só ajustar essas palavras-chave.
//
// ATENÇÃO: desde 15/09/2026 esta letra NÃO é mais impressa na etiqueta (o cabeçalho passou a
// mostrar o meio de envio). A função segue aqui e o valor continua no JSON de resposta, para
// conferência e para o caso de a informação voltar a ser útil. Não é lida pelo front-end.
function letraPagamento(gateways) {
  const texto = normalizarTexto((gateways || []).join(' '));
  if (texto.indexOf('pix') !== -1) return 'P';
  if (texto.indexOf('boleto') !== -1) return 'B';
  return 'C';
}

// Converte o frete escolhido no pedido na LETRA que vai no cabeçalho da etiqueta.
// A loja trabalha com dois serviços dos Correios: PAC (P) e SEDEX (S).
//
// O nome do frete não vem sempre literal: a Shopify já mandou "Padrão" em vez de "PAC" (bug real
// em produção), e no pedido manual o nome é o que a pessoa selecionar/digitar no admin. Por isso
// a lista de palavras-chave é ampla.
//
// Quando não reconhece, devolve '?' de propósito, em vez de assumir PAC calado. Com a letra sendo
// agora a ÚNICA informação de envio na etiqueta, chutar PAC mandaria o pacote para a remessa
// errada sem ninguém perceber; um '?' impresso faz alguém conferir antes de postar.
// Cai aqui também "Entrega local" e "Retirada na loja" da Shopify — as letras desses dois casos
// ainda não foram definidas com o Ney; quando forem, é só acrescentar antes do return final.
function letraEnvio(tituloFrete, codigoFrete, numeroPedido) {
  const texto = normalizarTexto([tituloFrete, codigoFrete].filter(Boolean).join(' '));

  if (!texto) {
    console.warn(`[listar-pedidos-etiquetas] pedido ${numeroPedido} sem nome de frete — marcado com "?"`);
    return '?';
  }

  if (/(sedex|expresso|expressa|rapido|rapida|urgente)/.test(texto)) return 'S';
  if (/(pac|padrao|normal|convencional|economico|economica|standard)/.test(texto)) return 'P';

  console.warn(`[listar-pedidos-etiquetas] serviço de frete não reconhecido no pedido ${numeroPedido}: "${tituloFrete}" (código: "${codigoFrete}") — marcado com "?" para conferência manual`);
  return '?';
}

// Nome completo do serviço, só para o JSON de resposta (não é impresso na etiqueta).
// Útil para conferência e log; a etiqueta usa apenas a letra.
function nomeServico(letra) {
  if (letra === 'S') return 'SEDEX';
  if (letra === 'P') return 'PAC';
  return 'NÃO IDENTIFICADO';
}

// Diferencia pedido do site de pedido fechado por WhatsApp/atendimento. O pedido manual criado na
// Shopify recebe a tag 'canal-whatsapp'; o pedido do site chega sem ela.
//
// Por que tag e não o canal de vendas nativo: o campo channelInformation da Shopify está marcado
// como deprecado e o displayName passou a voltar nulo para canais de terceiros (o Yampi é um) a
// partir da API 2026-01, sem substituto oficial definido. A tag é um campo que a JL controla.
// O canal de vendas da Shopify continua servindo de auditoria: filtrar por "Rascunhos de pedido"
// na lista de pedidos e comparar com a contagem de pedidos marcados com a tag.
//
// Padrão SITE quando não acha marcação — é o caso de 94% dos pedidos. Consequência a conhecer:
// esquecer a tag faz o pedido de WhatsApp sair impresso como se fosse do site, sem erro visível.
function identificarCanal(tags, numeroPedido) {
  const texto = normalizarTexto((tags || []).join(' '));
  if (/(canal-whatsapp|canal_whatsapp|whatsapp|wpp)/.test(texto)) return 'WHATSAPP';
  if (/(canal-site|canal_site)/.test(texto)) return 'SITE';
  if (texto !== '') {
    console.warn(`[listar-pedidos-etiquetas] pedido ${numeroPedido} tem tag sem marcação de canal: "${(tags || []).join(', ')}" — assumindo SITE`);
  }
  return 'SITE';
}

// Junta canal + envio na marcação final que sai no cabeçalho: P, S, WP, WS (ou ?/W? quando o
// serviço não foi reconhecido). Pedido do site não recebe prefixo nenhum.
function marcacaoEtiqueta(canal, letra) {
  return (canal === 'WHATSAPP' ? 'W' : '') + letra;
}

async function lerResposta(resposta) {
  const texto = await resposta.text();
  try {
    return { dados: texto ? JSON.parse(texto) : {}, ok: resposta.ok, status: resposta.status };
  } catch (e) {
    throw new Error(`Resposta inesperada (status ${resposta.status}): ${texto.slice(0, 300)}`);
  }
}

let shopifyTokenCache = { token: null, expiraEm: 0 };

async function obterTokenShopify() {
  if (shopifyTokenCache.token && Date.now() < shopifyTokenCache.expiraEm) {
    return shopifyTokenCache.token;
  }
  const resposta = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });
  const { dados, ok } = await lerResposta(resposta);
  if (!ok || !dados.access_token) {
    throw new Error(`Falha ao autenticar na Shopify: ${JSON.stringify(dados)}`);
  }
  shopifyTokenCache = {
    token: dados.access_token,
    expiraEm: Date.now() + (Number(dados.expires_in || 86399) - 300) * 1000
  };
  return shopifyTokenCache.token;
}

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (!autenticado(event)) return respostaNaoAutorizado();

  try {
    const token = await obterTokenShopify();

    // Limita a 20 por vez (1 página de recortes, 4 colunas x 5 linhas) — pra pegar o
    // próximo lote, é só despachar (fulfill) esses 20 na Shopify e buscar de novo.
    const query = `
      query pedidosPendentes {
        orders(first: 20, query: "financial_status:paid fulfillment_status:unfulfilled", sortKey: CREATED_AT, reverse: false) {
          edges {
            node {
              name
              createdAt
              tags
              paymentGatewayNames
              shippingAddress {
                name
                address1
                address2
                city
                province
                zip
              }
              shippingLine {
                title
                code
              }
              lineItems(first: 20) {
                edges {
                  node {
                    title
                    quantity
                  }
                }
              }
            }
          }
        }
      }
    `;

    const resposta = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2026-07/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query })
    });

    const { dados, ok } = await lerResposta(resposta);
    if (!ok || dados.errors) {
      throw new Error(`Erro ao buscar pedidos: ${JSON.stringify(dados.errors || dados)}`);
    }

    const pedidos = (dados.data.orders.edges || []).map(({ node }) => {
      const endereco = node.shippingAddress || {};
      const tituloFrete = (node.shippingLine && node.shippingLine.title) || '';
      const codigoFrete = (node.shippingLine && node.shippingLine.code) || '';
      const itens = (node.lineItems.edges || []).map(({ node: item }) => ({
        titulo: item.title,
        quantidade: item.quantity
      }));
      const canal = identificarCanal(node.tags, node.name);
      const letra = letraEnvio(tituloFrete, codigoFrete, node.name);
      return {
        pedido: node.name,
        criadoEm: node.createdAt,
        canal: canal,
        marcacao: marcacaoEtiqueta(canal, letra),
        servico: nomeServico(letra),
        pagamento: letraPagamento(node.paymentGatewayNames),
        nome: endereco.name || '',
        endereco1: endereco.address1 || '',
        endereco2: endereco.address2 || '',
        cidade: endereco.city || '',
        estado: siglaEstado(endereco.province),
        cep: endereco.zip || '',
        itens
      };
    });

    return { statusCode: 200, headers, body: JSON.stringify({ pedidos }) };
  } catch (err) {
    console.error('Erro listar-pedidos-etiquetas:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
