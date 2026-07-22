// Proxy serverless (Netlify Functions) — consulta REAL na API oficial dos Correios
// usando o contrato/cartão de postagem do cliente (API Preço + API Prazo).
// Isso substitui o Melhor Envio quando o objetivo é bater 100% com o valor do contrato.
//
// Variáveis de ambiente necessárias (configurar no painel da Netlify):
//   CORREIOS_USUARIO        -> usuário de login do Meu Correios (CNPJ/e-mail/CPF)
//   CORREIOS_SENHA          -> a "chave de acesso" gerada no CWS (Chaves de acesso)
//   CORREIOS_CARTAO_POSTAGEM-> número do cartão de postagem (ex: "0078112885")
//   CORREIOS_CONTRATO       -> número do contrato (ex: "9912632306")
//   CORREIOS_DR             -> número da DR/regional do contrato (ex: "74")
//   CORREIOS_CEP_ORIGEM     -> CEP de origem, só números (ex: "19806250")
//   CORREIOS_BASE_URL_TOKEN -> https://apihom.correios.com.br  (homologação)
//                              https://api.correios.com.br     (produção)
//   CORREIOS_BASE_URL_PRECO -> https://apihom.correios.com.br/preco/v1  (homologação)
//                              https://api.correios.com.br/preco/v1    (produção)
//   CORREIOS_BASE_URL_PRAZO -> https://apihom.correios.com.br/prazo/v1 (homologação)
//                              https://api.correios.com.br/prazo/v1   (produção)
//   LOJA_ORIGEM_PERMITIDA   -> opcional, ex: "https://minhaloja.myshopify.com" (CORS)
//
// Serviços consultados: PAC (03298) e SEDEX (03220).
 
// Códigos das TABELAS específicas do contrato (não os códigos públicos padrão 03298/03220).
// Confirmado no painel do site antigo: PAC usa a tabela 04596, Sedex usa a tabela 04553.
const SERVICOS = [
  { coProduto: '04596', nome: 'PAC' },
  { coProduto: '04553', nome: 'SEDEX' }
];
 
// Cache simples em memória (dura enquanto a função ficar "quente" entre chamadas).
let tokenCache = { token: null, expiraEm: 0 };
 
// Lê a resposta como texto primeiro (nunca quebra) e só depois tenta converter pra JSON.
// Se não for JSON válido, joga um erro com o status HTTP + o texto cru, pra dar pra
// diagnosticar (ex: página de erro HTML, corpo vazio, etc.) em vez do genérico
// "Unexpected end of JSON input".
async function lerResposta(resposta, origem) {
  const texto = await resposta.text();
  let dados;
  try {
    dados = texto ? JSON.parse(texto) : {};
  } catch (e) {
    throw new Error(
      `Resposta inesperada de ${origem} (status ${resposta.status}): ${texto.slice(0, 300) || '(corpo vazio)'}`
    );
  }
  return { dados, ok: resposta.ok, status: resposta.status };
}
 
// A "chave de acesso" gerada em CWS > Chaves de acesso (com os escopos Preço v3 / Prazo v3
// já habilitados, e restrita ao contrato/cartão de postagem) funciona como credencial pronta —
// não precisa trocar por outro token antes. Usa direto como Bearer Token.
async function obterToken() {
  return process.env.CORREIOS_SENHA;
}
 
async function consultarPreco(token, params) {
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
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
 
  const { dados, ok, status } = await lerResposta(resposta, 'API Preço');
  if (!ok) throw new Error(`Erro na API Preço (status ${status}): ` + JSON.stringify(dados));
  return Array.isArray(dados) ? dados : dados.parametrosProduto || dados.resultado || [];
}
 
async function consultarPrazo(token, params) {
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
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
 
  const { dados, ok, status } = await lerResposta(resposta, 'API Prazo');
  if (!ok) throw new Error(`Erro na API Prazo (status ${status}): ` + JSON.stringify(dados));
  return Array.isArray(dados) ? dados : dados.parametrosPrazo || dados.resultado || [];
}
 
exports.handler = async function (event) {
  const origemPermitida = process.env.LOJA_ORIGEM_PERMITIDA || '*';
  const headers = {
    'Access-Control-Allow-Origin': origemPermitida,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
 
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };
  }
 
  try {
    const { cepDestino, produtos } = JSON.parse(event.body || '{}');
 
    if (!cepDestino || !produtos || !Array.isArray(produtos) || produtos.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Envie cepDestino e um array de produtos.' }) };
    }
 
    const cepLimpo = String(cepDestino).replace(/\D/g, '');
    if (cepLimpo.length !== 8) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'CEP de destino inválido.' }) };
    }
 
    // Soma peso de todos os itens do carrinho/produto; usa caixa padrão se não vier dimensão.
    const pesoGramas = produtos.reduce((soma, p) => soma + (Number(p.weight) * 1000 || 500), 0);
    const comprimento = Math.max(...produtos.map((p) => Number(p.length) || 16));
    const largura = Math.max(...produtos.map((p) => Number(p.width) || 11));
    const altura = Math.max(...produtos.map((p) => Number(p.height) || 11));
    // Valor declarado (seguro) — soma do valor dos produtos. O site antigo provavelmente
    // declara o valor da encomenda, o que gera um adicional no preço final dos Correios.
    const valorDeclarado = produtos.reduce((soma, p) => soma + (Number(p.insurance_value) || 0), 0);
 
    const params = {
      cepOrigem: process.env.CORREIOS_CEP_ORIGEM,
      cepDestino: cepLimpo,
      pesoGramas,
      comprimento,
      largura,
      altura,
      valorDeclarado
    };
 
    const token = await obterToken();
    const [precos, prazos] = await Promise.all([
      consultarPreco(token, params),
      consultarPrazo(token, params)
    ]);
 
    const opcoes = SERVICOS.map((s) => {
      const preco = precos.find((p) => p.coProduto === s.coProduto);
      const prazo = prazos.find((p) => p.coProduto === s.coProduto);
      if (!preco || preco.txErro) return null;
      return {
        transportadora: 'Correios',
        servico: s.nome,
        preco: Number(String(preco.pcFinal).replace(',', '.')),
        prazoDias: prazo ? prazo.prazoEntrega : null
      };
    }).filter(Boolean);
 
    return { statusCode: 200, headers, body: JSON.stringify({ opcoes }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro interno', detalhes: err.message }) };
  }
};
 
