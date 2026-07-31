// Proxy serverless (Netlify Functions) — busca os pedidos pendentes de envio direto da
// Shopify (pagos, ainda não despachados) e devolve só os dados necessários pra montar
// a etiqueta: nome do destinatário, endereço, CEP e serviço de frete escolhido.
//
// Usa o MESMO app custom "Frete Correios" já criado (Client Credentials Grant), só que
// agora com o escopo read_orders também liberado.
//
// Variáveis de ambiente necessárias (reaproveita as já configuradas):
//   SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
//
// Suposição de negócio (ajustável): "pendente de envio" = pedido pago (financial_status
// PAID) e ainda não despachado (displayFulfillmentStatus UNFULFILLED ou PARTIALLY_FULFILLED).

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

  try {
    const token = await obterTokenShopify();

    // Limita a 6 por vez (1 página de recortes) — pra pegar o próximo lote, é só
    // despachar (fulfill) esses 6 na Shopify e buscar de novo.
    const query = `
      query pedidosPendentes {
        orders(first: 6, query: "financial_status:paid fulfillment_status:unfulfilled", sortKey: CREATED_AT, reverse: false) {
          edges {
            node {
              name
              createdAt
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
        servico: /sedex/i.test(servico) ? 'SEDEX' : /pac/i.test(servico) ? 'PAC' : servico || '—',
        nome: endereco.name || '',
        endereco1: endereco.address1 || '',
        endereco2: endereco.address2 || '',
        cidade: endereco.city || '',
        estado: endereco.province || '',
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
