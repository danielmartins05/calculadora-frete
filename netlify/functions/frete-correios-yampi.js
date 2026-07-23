// Proxy serverless (Netlify Functions) — "Frete por API" da Yampi.
// Reaproveita a MESMA integração real com o contrato dos Correios já validada na
// calculadora da página do produto (PAC tabela 04596, SEDEX tabela 04553).
//
// Como cadastrar na Yampi: Configurações > Logística > +Novo frete > modalidade API.
//   Nome: qualquer um (ex: "Correios contrato")
//   URL:  https://calculadorajl-frete.netlify.app/.netlify/functions/frete-correios-yampi
//   Headers: não precisa (a validação é feita via assinatura HMAC, ver abaixo)
// Depois de criar, a Yampi mostra uma "chave secreta" — copie e cole na variável de
// ambiente YAMPI_FRETE_SECRET na Netlify (opcional, mas recomendado p/ segurança).
//
// Variáveis de ambiente (reaproveita as mesmas da calculadora):
//   CORREIOS_SENHA, CORREIOS_CONTRATO, CORREIOS_DR, CORREIOS_CEP_ORIGEM,
//   CORREIOS_BASE_URL_PRECO, CORREIOS_BASE_URL_PRAZO
//   YAMPI_FRETE_SECRET -> chave secreta gerada pela Yampi (opcional)

const crypto = require('crypto');

const SERVICOS = [
  { coProduto: '04596', nome: 'PAC' },
  { coProduto: '04553', nome: 'SEDEX' }
];

async function lerResposta(resposta) {
  const texto = await resposta.text();
  try {
    return { dados: texto ? JSON.parse(texto) : {}, ok: resposta.ok, status: resposta.status };
  } catch (e) {
    throw new Error(`Resposta inesperada (status ${resposta.status}): ${texto.slice(0, 300)}`);
  }
}

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

    const pesoGramas = skus.reduce((soma, s) => soma + (Number(s.weight) || 0.1) * 1000 * (Number(s.quantity) || 1), 0);
    const comprimento = Math.max(...skus.map((s) => Number(s.length) || 16));
    const largura = Math.max(...skus.map((s) => Number(s.width) || 11));
    const altura = Math.max(...skus.map((s) => Number(s.height) || 11));
    const valorDeclarado = Number(body.amount) || 0;

    const params = {
      cepOrigem: process.env.CORREIOS_CEP_ORIGEM,
      cepDestino: cepLimpo,
      pesoGramas: Math.max(pesoGramas, 1),
      comprimento,
      largura,
      altura,
      valorDeclarado
    };

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
