'use strict';
/**
 * Cardapio digital + painel de administracao.
 * Um servico so: serve o site publico, a API publica, o painel e a API do painel.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');

const store = require('./lib/store');
const auth = require('./lib/auth');
const images = require('./lib/images');

const PORT = parseInt(process.env.PORT || '8092', 10);
const BIND = process.env.BIND || '0.0.0.0';
const DATA_DIR = store.DATA_DIR;
const USUARIO_PADRAO = process.env.ADMIN_USER || 'admin';
const SENHA_INICIAL = process.env.ADMIN_PASSWORD || '';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(images.UPLOAD_DIR, { recursive: true });

// cria o usuario na primeira execucao e imprime a senha uma unica vez
const senhaCriada = auth.garantirUsuario(USUARIO_PADRAO, SENHA_INICIAL || undefined);
if (senhaCriada) {
  const aviso = path.join(DATA_DIR, 'SENHA-INICIAL.txt');
  fs.writeFileSync(
    aviso,
    `Usuario: ${USUARIO_PADRAO}\nSenha:   ${senhaCriada}\n\n` +
      'Troque a senha no painel: aba "Conta".\nApague este arquivo depois.\n',
    { mode: 0o600 }
  );
  console.log('=================================================');
  console.log(' USUARIO CRIADO');
  console.log('   usuario: ' + USUARIO_PADRAO);
  console.log('   senha:   ' + senhaCriada);
  console.log(' (tambem salvo em data/SENHA-INICIAL.txt)');
  console.log('=================================================');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.json({ limit: '16mb' }));

// cabecalhos de seguranca
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

function seguro(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/* ======================= PUBLICO ======================= */

app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/api/menu', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.json(store.publicView());
});

app.use('/uploads', express.static(images.UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false }));

/* ======================= PAINEL: AUTENTICACAO ======================= */

function exigirLogin(req, res, next) {
  const token = auth.lerCookies(req)[auth.COOKIE];
  const sessao = auth.sessaoValida(token);
  if (!sessao) return res.status(401).json({ erro: 'Sessao expirada. Entre novamente.' });
  req.sessao = sessao;
  req.token = token;
  next();
}

app.post('/admin/api/login', (req, res) => {
  const ip = req.ip || 'desconhecido';
  if (!auth.podeTentar(ip)) {
    return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos.' });
  }
  const { usuario, senha } = req.body || {};
  const dados = auth.lerAuth();
  const ok =
    dados &&
    String(usuario || '').trim().toLowerCase() === String(dados.usuario).toLowerCase() &&
    auth.verificarSenha(senha, dados.senhaHash);

  if (!ok) {
    auth.registrarFalha(ip);
    return res.status(401).json({ erro: 'Usuario ou senha incorretos.' });
  }
  auth.limparTentativas(ip);
  const token = auth.criarSessao(dados.usuario);
  res.setHeader('Set-Cookie', auth.montarCookie(token, seguro(req)));
  res.json({ ok: true, usuario: dados.usuario });
});

app.post('/admin/api/logout', (req, res) => {
  auth.encerrarSessao(auth.lerCookies(req)[auth.COOKIE]);
  res.setHeader('Set-Cookie', auth.cookieDeSaida());
  res.json({ ok: true });
});

app.get('/admin/api/sessao', (req, res) => {
  const sessao = auth.sessaoValida(auth.lerCookies(req)[auth.COOKIE]);
  if (!sessao) return res.status(401).json({ logado: false });
  res.json({ logado: true, usuario: sessao.usuario });
});

/* ======================= PAINEL: DADOS ======================= */

const api = express.Router();
api.use(exigirLogin);

api.get('/dados', (req, res) => res.json(store.read()));

api.put('/config', (req, res) => {
  const entrada = req.body && typeof req.body === 'object' ? req.body : {};
  const atual = store.read();
  const permitido = {};
  for (const k of Object.keys(store.configPadrao())) {
    if (Object.prototype.hasOwnProperty.call(entrada, k)) permitido[k] = entrada[k];
  }
  const db = store.write({ ...atual, config: { ...atual.config, ...permitido } });
  res.json({ ok: true, config: db.config });
});

/* ---------- monte seu bolo ---------- */

api.put('/bolo', (req, res) => {
  const entrada = req.body && typeof req.body === 'object' ? req.body : {};
  const atual = store.read();
  const db = store.write({ ...atual, bolo: entrada });
  res.json({ ok: true, bolo: db.bolo });
});

/* ---------- produtos ---------- */

api.post('/produtos', (req, res) => {
  const p = req.body || {};
  if (!String(p.nome || '').trim()) return res.status(400).json({ erro: 'O nome e obrigatorio.' });
  const db = store.update((d) => {
    const ordem = d.produtos.length ? Math.max(...d.produtos.map((x) => x.ordem || 0)) + 1 : 1;
    d.produtos.push({ ...p, id: store.novoId('p'), ordem });
    return d;
  });
  res.json({ ok: true, produtos: db.produtos });
});

api.put('/produtos/:id', (req, res) => {
  const { id } = req.params;
  const patch = req.body || {};
  let achou = false;
  const db = store.update((d) => {
    const i = d.produtos.findIndex((p) => p.id === id);
    if (i < 0) return d;
    achou = true;
    d.produtos[i] = { ...d.produtos[i], ...patch, id };
    return d;
  });
  if (!achou) return res.status(404).json({ erro: 'Produto nao encontrado.' });
  res.json({ ok: true, produtos: db.produtos });
});

api.delete('/produtos/:id', (req, res) => {
  const { id } = req.params;
  let removido = null;
  const db = store.update((d) => {
    const i = d.produtos.findIndex((p) => p.id === id);
    if (i >= 0) {
      removido = d.produtos[i];
      d.produtos.splice(i, 1);
    }
    return d;
  });
  if (!removido) return res.status(404).json({ erro: 'Produto nao encontrado.' });
  if (removido.img) images.apagarImagem(removido.img);
  res.json({ ok: true, produtos: db.produtos });
});

/** Reordena: recebe a lista de ids na ordem desejada. */
api.put('/produtos', (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : null;
  if (!ids) return res.status(400).json({ erro: 'Envie { ids: [...] }.' });
  const db = store.update((d) => {
    ids.forEach((id, i) => {
      const p = d.produtos.find((x) => x.id === id);
      if (p) p.ordem = i + 1;
    });
    return d;
  });
  res.json({ ok: true, produtos: db.produtos });
});

/* ---------- categorias ---------- */

api.post('/categorias', (req, res) => {
  const nome = String((req.body && req.body.nome) || '').trim();
  if (!nome) return res.status(400).json({ erro: 'O nome da categoria e obrigatorio.' });
  const db = store.update((d) => {
    const ordem = d.categorias.length ? Math.max(...d.categorias.map((c) => c.ordem || 0)) + 1 : 1;
    d.categorias.push({ id: store.novoId('cat'), nome, ordem });
    return d;
  });
  res.json({ ok: true, categorias: db.categorias });
});

api.put('/categorias/:id', (req, res) => {
  const { id } = req.params;
  const patch = req.body || {};
  let achou = false;
  const db = store.update((d) => {
    const i = d.categorias.findIndex((c) => c.id === id);
    if (i < 0) return d;
    achou = true;
    d.categorias[i] = { ...d.categorias[i], ...patch, id };
    return d;
  });
  if (!achou) return res.status(404).json({ erro: 'Categoria nao encontrada.' });
  res.json({ ok: true, categorias: db.categorias });
});

api.delete('/categorias/:id', (req, res) => {
  const { id } = req.params;
  const db = store.update((d) => {
    d.categorias = d.categorias.filter((c) => c.id !== id);
    // produtos da categoria apagada ficam sem categoria, nao somem
    d.produtos.forEach((p) => {
      if (p.categoria === id) p.categoria = '';
    });
    return d;
  });
  res.json({ ok: true, categorias: db.categorias, produtos: db.produtos });
});

/* ---------- imagem ---------- */

api.post('/upload', async (req, res) => {
  try {
    const r = await images.salvarImagem((req.body && req.body.imagem) || '');
    res.json({ ok: true, url: r.url, bytes: r.bytes });
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Falha ao processar a imagem.' });
  }
});

/* ---------- conta ---------- */

api.post('/senha', (req, res) => {
  const { atual, nova } = req.body || {};
  const r = auth.trocarSenha(atual, nova);
  if (!r.ok) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true });
});

/* ---------- backup / transferencia entre clientes ---------- */

api.get('/exportar', (req, res) => {
  const nome = 'cardapio-' + new Date().toISOString().slice(0, 10) + '.json';
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.send(JSON.stringify(store.read(), null, 2));
});

api.post('/importar', (req, res) => {
  try {
    const dados = req.body && req.body.dados ? req.body.dados : req.body;
    if (!dados || typeof dados !== 'object') return res.status(400).json({ erro: 'Conteudo invalido.' });
    const db = store.write(dados);
    res.json({ ok: true, categorias: db.categorias.length, produtos: db.produtos.length });
  } catch {
    res.status(400).json({ erro: 'Nao foi possivel importar esse arquivo.' });
  }
});

app.use('/admin/api', api);

/* ======================= ARQUIVOS ESTATICOS ======================= */

app.use('/admin', express.static(path.join(__dirname, 'admin'), { index: 'index.html' }));
app.use('/', express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

app.use((req, res) => res.status(404).send('Nao encontrado'));

app.use((err, req, res, next) => {
  console.error('erro:', err && err.message);
  res.status(500).json({ erro: 'Erro interno.' });
});

app.listen(PORT, BIND, () => {
  console.log(`cardapio-app ouvindo em http://${BIND}:${PORT}`);
  console.log(`  site publico: http://<host>:${PORT}/`);
  console.log(`  painel:       http://<host>:${PORT}/admin`);
});
