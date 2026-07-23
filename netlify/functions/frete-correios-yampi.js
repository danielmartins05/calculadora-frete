// Proxy serverless (Netlify Functions) — "Frete por API" da Yampi.
// Reaproveita a MESMA integração real com o contrato dos Correios já validada na
// calculadora da página do produto (PAC tabela 04596, SEDEX tabela 04553).
//
// IMPORTANTE: a Yampi NÃO guarda peso/dimensão real dos produtos (confirmado no
// próprio painel dela). Por isso esta função busca o peso e as dimensões reais
// DIRETO NO SHOPIFY (mesma fonte que a calculadora da página do produto usa:
// peso da variante + metafields custom.comprimento_cm / largura_cm / altura_cm),
// usando o "platform.external_id" que a Yampi manda em cada SKU (esse sim é o
// ID real da variante no Shopify — o "product_id" no topo do SKU é interno da Yampi).
//
// Como cadastrar na Yampi: Configurações > Logística > +Novo frete > modalidade API.
//   Nome: qualquer um (ex: "Correios contrato")
//   URL:  https://calculadorajl-frete.netlify.app/.netlify/functions/frete-correios-yampi
//   Headers: não precisa (a validação é feita via assinatura HMAC, ver abaixo)
//
// Variáveis de ambiente necessárias:
//   CORREIOS_SENHA, CORREIOS_CONTRATO, CORREIOS_DR, CORREIOS_CEP_ORIGEM,
//   CORREIOS_BASE_URL_PRECO, CORREIOS_BASE_URL_PRAZO
//   YAMPI_FRETE_SECRET      -> chave secreta gerada pela Yampi (opcional, recomendado)
//   SHOPIFY_STORE_DOMAIN    -> ex: "gd1vjn-ph.myshopify.com" (sem https://)
//   SHOPIFY_CLIENT_ID       -> Client ID do app custom "Frete Correios" (Dev Dashboard)
//   SHOPIFY_CLIENT_SECRET   -> Client Secret do mesmo app

const crypto = require('crypto');

const SERVICOS = [
  { coProduto: '04596', nome: 'PAC' },
  { coProduto: '04553', nome: 'SEDEX' }
];

// Caixa/peso padrão quando o produto não tiver metafield de dimensão ou peso
// cadastrado no Shopify (mesmo padrão usado na calculadora da página do produto).
const PADRAO = { pesoKg: 0.5, comprimento: 16, largura: 11, altura: 11 };
const DIM_MINIMA = 11; // cm — abaixo disso é tratado como valor implausível
const PESO_MINIMO_KG = 0.02; // kg — abaixo disso é tratado como valor implausível

async function lerResposta(resposta) {
  const texto = await resposta.text();
  try {
    return { dados: texto ? JSON.parse(texto) : {}, ok: resposta.ok, status: resposta.status };
  } catch (e) {
    throw new Error(`Resposta inesperada (status ${resposta.status}): ${texto.slice(0, 300)}`);
  }
}

// ---------- Shopify: token via Client Credentials Grant (cacheado em memória) ----------
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
    // expira em ~24h (86399s); renova com folga de 5 minutos antes
    expiraEm: Date.now() + (Number(dados.expires_in || 86399) - 300) * 1000
  };
  return shopifyTokenCache.token;
}

// Busca peso real (kg) + dimensões reais (cm) de uma variante do Shopify,
// pelo ID que a Yampi manda em sku.platform.external_id.
async function buscarDadosVariante(variantExternalId) {
  const token = await obterTokenShopify();
  const query = `
    query dadosVariante($id: ID!) {
      productVariant(id: $id) {
        inventoryItem {
          measurement {
            weight { value unit }
          }
        }
        product {
          comprimento: metafield(namespace: "custom", key: "comprimento_cm") { value }
          largura: metafield(namespace: "custom", key: "largura_cm") { value }
          altura: metafield(namespace: "custom", key: "altura_cm") { value }
        }
      }
    }
  `;
  const resposta = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2026-07/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify({
      query,
      variables: { id: `gid://shopify/ProductVariant/${variantExternalId}` }
    })
  });
  const { dados, ok } = await lerResposta(resposta);
  const variante = ok && dados.data ? dados.data.productVariant : null;

  if (!variante) return { ...PADRAO };

  // Peso: vem de inventoryItem.measurement.weight (value + unit).
  let pesoKg = PADRAO.pesoKg;
  const peso = variante.inventoryItem && variante.inventoryItem.measurement && variante.inventoryItem.measurement.weight;
  if (peso && peso.value) {
    const valor = Number(peso.value);
    const unidade = String(peso.unit || '').toUpperCase();
    let valorKg = valor;
    if (unidade === 'GRAMS') valorKg = valor / 1000;
    else if (unidade === 'OUNCES') valorKg = valor * 0.0283495;
    else if (unidade === 'POUNDS') valorKg = valor * 0.453592;
    // KILOGRAMS já está certo
    if (valorKg >= PESO_MINIMO_KG) pesoKg = valorKg;
  }

  const produto = variante.product || {};
  function metafieldNumero(campo, minimo, padrao) {
    const v = produto[campo] && produto[campo].value ? Number(produto[campo].value) : null;
    return v && v >= minimo ? v : padrao;
  }

  return {
    pesoKg,
    comprimento: metafieldNumero('comprimento', DIM_MINIMA, PADRAO.comprimento),
    largura: metafieldNumero('largura', DIM_MINIMA, PADRAO.largura),
    altura: metafieldNumero('altura', DIM_MINIMA, PADRAO.altura)
  };
}

// ---------- Correios: Preço + Prazo (contrato) ----------
async function consultarPreco(params) {
  const payload = {
    idLote: '001',
    parametrosProduto: SERVICOS.map((s, i) => ({
      coProduto: s.coProduto,
      nuRequisicao: String(i + 1).padStart(4, '0'),
      nuContrato: process.env.CORREIOS_CONTRATO,
      nuDR: Number(process.env.CORREIOS_DR),
      cepOrigem: params.cepOrigem,
      cepDestino: params.cepDestino,
      psObjeto: String(params.pesoGramas),
      tpObjeto: '2',
      comprimento: String(params.comprimento),
      largura: String(params.largura),
      altura: String(params.altura),
      vlDeclarado: params.valorDeclarado ? String(params.valorDeclarado) : undefined
    }))
  };
  const resposta = await fetch(`${process.env.CORREIOS_BASE_URL_PRECO}/nacional`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CORREIOS_SENHA}` },
    body: JSON.stringify(payload)
  });
  const { dados, ok, status } = await lerResposta(resposta);
  if (!ok) throw new Error(`Erro na API Preço (status ${status}): ${JSON.stringify(dados)}`);
  return Array.isArray(dados) ? dados : dados.parametrosProduto || dados.resultado || [];
}

async function consultarPrazo(params) {
  const payload = {
    idLote: '001',
    parametrosPrazo: SERVICOS.map((s, i) => ({
      coProduto: s.coProduto,
      nuRequisicao: String(i + 1).padStart(4, '0'),
      cepOrigem: params.cepOrigem,
      cepDestino: params.cepDestino
    }))
  };
  const resposta = await fetch(`${process.env.CORREIOS_BASE_URL_PRAZO}/nacional`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CORREIOS_SENHA}` },
    body: JSON.stringify(payload)
  });
  const { dados, ok } = await lerResposta(resposta);
  if (!ok) return [];
  return Array.isArray(dados) ? dados : dados.parametrosPrazo || dados.resultado || [];
}

function validarAssinatura(event) {
  const secret = process.env.YAMPI_FRETE_SECRET;
  if (!secret) return true; // sem chave configurada, pula validação (menos seguro, mas não trava)
  const assinaturaRecebida = event.headers['x-yampi-hmac-sha256'] || event.headers['X-Yampi-Hmac-SHA256'];
  if (!assinaturaRecebida) return false;
  const assinaturaCalculada = crypto.createHmac('sha256', secret).update(event.body || '').digest('base64');
  return assinaturaCalculada === assinaturaRecebida;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  try {
    if (!validarAssinatura(event)) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Assinatura inválida' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const cepLimpo = String(body.zipcode || '').replace(/\D/g, '');
    const skus = Array.isArray(body.skus) ? body.skus : [];

    if (cepLimpo.length !== 8 || skus.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ quotes: [] }) };
    }

    // Busca peso/dimensão real no Shopify pra cada variante distinta do carrinho
    // (evita repetir a busca se o mesmo produto aparecer mais de uma vez).
    const cacheVariantes = {};
    async function dadosDoSku(sku) {
      const externalId = sku.platform && sku.platform.external_id;
      if (!externalId) return { ...PADRAO };
      if (!cacheVariantes[externalId]) {
        cacheVariantes[externalId] = buscarDadosVariante(externalId).catch(() => ({ ...PADRAO }));
      }
      return cacheVariantes[externalId];
    }

    const dadosPorSku = await Promise.all(skus.map(dadosDoSku));

    let pesoGramas = 0;
    let comprimento = PADRAO.comprimento;
    let largura = PADRAO.largura;
    let altura = PADRAO.altura;

    skus.forEach((sku, i) => {
      const dados = dadosPorSku[i];
      const quantidade = Number(sku.quantity) || 1;
      pesoGramas += dados.pesoKg * 1000 * quantidade;
      comprimento = Math.max(comprimento, dados.comprimento);
      largura = Math.max(largura, dados.largura);
      altura = Math.max(altura, dados.altura);
    });

    const valorDeclarado = Number(body.amount) || 0;

    const params = {
      cepOrigem: process.env.CORREIOS_CEP_ORIGEM,
      cepDestino: cepLimpo,
      pesoGramas: Math.max(Math.round(pesoGramas), 1),
      comprimento,
      largura,
      altura,
      valorDeclarado
    };

    console.log('[frete-yampi] dados buscados no Shopify por SKU:', JSON.stringify(dadosPorSku));
    console.log('[frete-yampi] params calculados:', JSON.stringify(params));

    const [precos, prazos] = await Promise.all([consultarPreco(params), consultarPrazo(params)]);

    const quotes = SERVICOS.map((s, i) => {
      const preco = precos.find((p) => p.coProduto === s.coProduto);
      const prazo = prazos.find((p) => p.coProduto === s.coProduto);
      if (!preco || !preco.pcFinal || preco.txErro) return null;
      return {
        name: s.nome === 'SEDEX' ? 'SEDEX - Correios' : 'PAC - Correios',
        service: s.nome,
        price: Number(String(preco.pcFinal).replace(',', '.')),
        days: prazo && prazo.prazoEntrega ? Number(prazo.prazoEntrega) : 7,
        quote_id: i + 1,
        free_shipment: false
      };
    }).filter(Boolean);

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quotes }) };
  } catch (err) {
    // Em erro, devolve lista vazia (a Yampi não trava o checkout, só não mostra opção) —
    // mas registra o motivo pra você conseguir ver nos logs da Netlify.
    console.error('Erro frete-correios-yampi:', err.message);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quotes: [] }) };
  }
};
