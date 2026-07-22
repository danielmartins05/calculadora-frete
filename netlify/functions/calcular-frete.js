// Versão do proxy para Netlify Functions (alternativa à Vercel).
// Salve este arquivo no repositório como: netlify/functions/calcular-frete.js
//
// Variáveis de ambiente (configurar no painel da Netlify):
//   MELHOR_ENVIO_TOKEN    -> token gerado no painel do Melhor Envio (sandbox ou produção)
//   MELHOR_ENVIO_BASE_URL -> https://sandbox.melhorenvio.com.br (testes)
//                            https://melhorenvio.com.br (produção)
//   CEP_ORIGEM            -> CEP de onde os produtos saem (só números)
//   USER_AGENT            -> "Nome da Loja (email@contato.com)"
//   SERVICOS_MELHOR_ENVIO -> opcional, ex: "1,2,17"
//   LOJA_ORIGEM_PERMITIDA -> opcional, ex: "https://sualoja.myshopify.com"

exports.handler = async function (event) {
  const origemPermitida = process.env.LOJA_ORIGEM_PERMITIDA || '*';
  const headers = {
    'Access-Control-Allow-Origin': origemPermitida,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  try {
    const { cepDestino, produtos } = JSON.parse(event.body || '{}');

    if (!cepDestino || !produtos || !Array.isArray(produtos) || produtos.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Envie cepDestino e um array de produtos.' })
      };
    }

    const cepLimpo = String(cepDestino).replace(/\D/g, '');
    if (cepLimpo.length !== 8) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'CEP de destino inválido.' }) };
    }

    const payload = {
      from: { postal_code: process.env.CEP_ORIGEM },
      to: { postal_code: cepLimpo },
      products: produtos,
      options: { receipt: false, own_hand: false },
      services: process.env.SERVICOS_MELHOR_ENVIO || undefined
    };

    const resposta = await fetch(
      `${process.env.MELHOR_ENVIO_BASE_URL}/api/v2/me/shipment/calculate`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.MELHOR_ENVIO_TOKEN}`,
          'User-Agent': process.env.USER_AGENT || 'Minha Loja (contato@minhaloja.com.br)'
        },
        body: JSON.stringify(payload)
      }
    );

    const dados = await resposta.json();

    if (!resposta.ok) {
      return {
        statusCode: resposta.status,
        headers,
        body: JSON.stringify({ error: 'Erro ao consultar Melhor Envio', detalhes: dados })
      };
    }

    const opcoes = (Array.isArray(dados) ? dados : [])
      .filter((opt) => !opt.error)
      .map((opt) => ({
        transportadora: opt.company?.name,
        servico: opt.name,
        preco: opt.custom_price ?? opt.price,
        prazoDias: opt.custom_delivery_time ?? opt.delivery_time,
        icone: opt.company?.picture
      }));

    return { statusCode: 200, headers, body: JSON.stringify({ opcoes }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro interno', detalhes: err.message }) };
  }
};

