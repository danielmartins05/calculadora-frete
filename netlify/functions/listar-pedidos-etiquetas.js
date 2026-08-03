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
function letraPagamento(gateways) {
  const texto = normalizarTexto((gateways || []).join(' '));
  if (texto.indexOf('pix') !== -1) return 'P';
  if (texto.indexOf('boleto') !== -1) return 'B';
  return 'C';
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
      const servico = (node.shippingLine && node.shippingLine.title) || '';
      const itens = (node.lineItems.edges || []).map(({ node: item }) => ({
        titulo: item.title,
        quantidade: item.quantity
      }));
      return {
        pedido: node.name,
        criadoEm: node.createdAt,
        pagamento: letraPagamento(node.paymentGatewayNames),
        servico: /sedex/i.test(servico) ? 'SEDEX' : /pac/i.test(servico) ? 'PAC' : servico || '—',
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
