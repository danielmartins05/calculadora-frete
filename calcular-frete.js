// Proxy serverless (Vercel / Netlify Functions / Cloudflare Worker com adaptação mínima)
// Guarda o token do Melhor Envio no servidor. NUNCA coloque o token direto no tema do Shopify.
//
// Variáveis de ambiente necessárias (configure no painel da Vercel/Netlify):
//   MELHOR_ENVIO_TOKEN   -> token gerado no painel do Melhor Envio (sandbox ou produção)
//   MELHOR_ENVIO_BASE_URL-> https://sandbox.melhorenvio.com.br  (testes)
//                           https://melhorenvio.com.br          (produção)
//   CEP_ORIGEM           -> CEP de onde os produtos saem (só números, ex: "01310930")
//   USER_AGENT           -> "Nome da Loja (email@contato.com)" — exigido pela API
//   SERVICOS_MELHOR_ENVIO-> opcional, ex: "1,2,17" para limitar transportadoras
//   LOJA_ORIGEM_PERMITIDA-> opcional, ex: "https://minhaloja.myshopify.com" para restringir CORS

export default async function handler(req, res) {
  const origemPermitida = process.env.LOJA_ORIGEM_PERMITIDA || '*';
  res.setHeader('Access-Control-Allow-Origin', origemPermitida);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const { cepDestino, produtos } = req.body;

    if (!cepDestino || !produtos || !Array.isArray(produtos) || produtos.length === 0) {
      return res.status(400).json({ error: 'Envie cepDestino e um array de produtos.' });
    }

    const cepLimpo = String(cepDestino).replace(/\D/g, '');
    if (cepLimpo.length !== 8) {
      return res.status(400).json({ error: 'CEP de destino inválido.' });
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
      return res.status(resposta.status).json({ error: 'Erro ao consultar Melhor Envio', detalhes: dados });
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

    return res.status(200).json({ opcoes });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno', detalhes: err.message });
  }
}
