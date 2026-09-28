'use strict';
/* Painel do cardápio — lógica */

let DADOS = { config: {}, categorias: [], produtos: [] };
let produtoEditando = null;

/* ==================== utilidades ==================== */

async function api(metodo, caminho, corpo) {
  const opcoes = { method: metodo, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (corpo !== undefined) opcoes.body = JSON.stringify(corpo);
  const r = await fetch(caminho, opcoes);
  let dados = null;
  try { dados = await r.json(); } catch (e) {}
  if (r.status === 401 && caminho !== '/admin/api/login') {
    mostrarLogin();
    throw new Error('Sessão expirada');
  }
  if (!r.ok) throw new Error((dados && dados.erro) || 'Erro ' + r.status);
  return dados;
}

let toastTimer;
function toast(msg, tipo) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (tipo ? ' ' + tipo : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.className = 'toast'; }, 2600);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function precoBR(v) {
  return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
}

function parsePreco(txt) {
  const limpo = String(txt || '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* ==================== sessão ==================== */

function mostrarLogin() {
  document.getElementById('telaLogin').classList.remove('escondido');
  document.getElementById('app').classList.add('escondido');
}

function mostrarApp() {
  document.getElementById('telaLogin').classList.add('escondido');
  document.getElementById('app').classList.remove('escondido');
}

async function entrar(e) {
  e.preventDefault();
  const btn = document.getElementById('btnEntrar');
  const msg = document.getElementById('msgLogin');
  msg.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  try {
    const r = await api('POST', '/admin/api/login', {
      usuario: document.getElementById('usuario').value,
      senha: document.getElementById('senha').value,
    });
    document.getElementById('senha').value = '';
    document.getElementById('usuarioAtual').textContent = r.usuario;
    mostrarApp();
    await carregarDados();
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

async function sair() {
  try { await api('POST', '/admin/api/logout'); } catch (e) {}
  location.reload();
}

async function verificarSessao() {
  try {
    const r = await api('GET', '/admin/api/sessao');
    if (r && r.logado) {
      document.getElementById('usuarioAtual').textContent = r.usuario;
      mostrarApp();
      await carregarDados();
      return;
    }
  } catch (e) {}
  mostrarLogin();
}

/* ==================== navegação ==================== */

function trocarAba(nome, btn) {
  document.querySelectorAll('.aba').forEach(function (s) { s.classList.remove('ativa'); });
  document.getElementById('aba-' + nome).classList.add('ativa');
  document.querySelectorAll('nav.abas button').forEach(function (b) { b.classList.remove('ativo'); });
  if (btn) btn.classList.add('ativo');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ==================== carga inicial ==================== */

async function carregarDados() {
  const d = await api('GET', '/admin/api/dados');
  DADOS = d;
  document.getElementById('nomeLoja').innerHTML =
    esc(d.config.nome || 'Cardápio') + '<small>painel de edição</small>';
  preencherConfig();
  renderProdutos();
  renderCategorias();
  preencherBolo();
  limparPendencia();
}

/* ==================== produtos ==================== */

function renderProdutos() {
  const alvo = document.getElementById('listaProdutos');
  const lista = DADOS.produtos.slice().sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); });

  if (!lista.length) {
    alvo.innerHTML = '<div class="vazio"><i>🍰</i>Nenhum produto ainda.<br>Clique em "Adicionar produto" para começar.</div>';
    return;
  }

  const nomeCat = {};
  DADOS.categorias.forEach(function (c) { nomeCat[c.id] = c.nome; });

  alvo.innerHTML = lista.map(function (p, i) {
    const thumb = p.img
      ? '<img class="thumb" src="' + esc(p.img) + '" alt="">'
      : '<div class="thumb"></div>';
    return '<div class="item-produto' + (p.disponivel === false ? ' indisponivel' : '') + '">' +
      thumb +
      '<div class="dados">' +
        '<h3>' + esc(p.nome) + (p.tag ? '<span class="tag-mini">' + esc(p.tag) + '</span>' : '') + '</h3>' +
        '<div class="meta">' + precoBR(p.preco) + ' • ' + esc(p.unidade) +
          (nomeCat[p.categoria] ? ' • ' + esc(nomeCat[p.categoria]) : '') +
          (p.disponivel === false ? ' • <strong>escondido</strong>' : '') +
        '</div>' +
      '</div>' +
      '<div class="botoes">' +
        '<button title="Subir" onclick="moverProduto(\'' + esc(p.id) + '\',-1)"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button title="Descer" onclick="moverProduto(\'' + esc(p.id) + '\',1)"' + (i === lista.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button title="Editar" onclick="abrirProduto(\'' + esc(p.id) + '\')">✎</button>' +
        '<button class="apagar" title="Apagar" onclick="apagarProduto(\'' + esc(p.id) + '\')">🗑</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function abrirProduto(id) {
  produtoEditando = id ? DADOS.produtos.find(function (p) { return p.id === id; }) : null;
  const p = produtoEditando || { nome: '', descricao: '', preco: 0, unidade: 'unidade', categoria: '', tag: '', img: '', disponivel: true };

  document.getElementById('modalTitulo').textContent = id ? 'Editar produto' : 'Novo produto';
  document.getElementById('pNome').value = p.nome || '';
  document.getElementById('pDesc').value = p.descricao || '';
  document.getElementById('pPreco').value = p.preco ? String(p.preco).replace('.', ',') : '';
  document.getElementById('pUnid').value = p.unidade || 'unidade';
  document.getElementById('pTag').value = p.tag || '';
  document.getElementById('pImg').value = p.img || '';
  document.getElementById('pDisp').checked = p.disponivel !== false;

  const sel = document.getElementById('pCat');
  sel.innerHTML = '<option value="">(sem categoria)</option>' + DADOS.categorias
    .slice().sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); })
    .map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === p.categoria ? ' selected' : '') + '>' + esc(c.nome) + '</option>'; })
    .join('');

  const prev = document.getElementById('prevProdImg');
  if (p.img) { prev.src = p.img; prev.classList.remove('escondido'); }
  else { prev.removeAttribute('src'); prev.classList.add('escondido'); }

  document.getElementById('overlayModal').classList.add('aberto');
  document.body.style.overflow = 'hidden';
}

function fecharModal() {
  document.getElementById('overlayModal').classList.remove('aberto');
  document.body.style.overflow = '';
  produtoEditando = null;
}

async function salvarProduto() {
  const nome = document.getElementById('pNome').value.trim();
  if (!nome) { toast('O nome é obrigatório.', 'erro'); document.getElementById('pNome').focus(); return; }

  const corpo = {
    nome: nome,
    descricao: document.getElementById('pDesc').value.trim(),
    preco: parsePreco(document.getElementById('pPreco').value),
    unidade: document.getElementById('pUnid').value.trim() || 'unidade',
    categoria: document.getElementById('pCat').value,
    tag: document.getElementById('pTag').value.trim(),
    img: document.getElementById('pImg').value,
    disponivel: document.getElementById('pDisp').checked,
  };

  const btn = document.getElementById('btnSalvarProduto');
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const r = produtoEditando
      ? await api('PUT', '/admin/api/produtos/' + encodeURIComponent(produtoEditando.id), corpo)
      : await api('POST', '/admin/api/produtos', corpo);
    DADOS.produtos = r.produtos;
    renderProdutos();
    fecharModal();
    toast('Produto salvo!', 'ok');
  } catch (e) {
    toast(e.message, 'erro');
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar';
  }
}

async function apagarProduto(id) {
  const p = DADOS.produtos.find(function (x) { return x.id === id; });
  if (!confirm('Apagar "' + (p ? p.nome : 'este produto') + '"?\n\nEssa ação não pode ser desfeita.')) return;
  try {
    const r = await api('DELETE', '/admin/api/produtos/' + encodeURIComponent(id));
    DADOS.produtos = r.produtos;
    renderProdutos();
    toast('Produto apagado.', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function moverProduto(id, direcao) {
  const lista = DADOS.produtos.slice().sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); });
  const i = lista.findIndex(function (p) { return p.id === id; });
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= lista.length) return;
  const tmp = lista[i]; lista[i] = lista[j]; lista[j] = tmp;
  try {
    const r = await api('PUT', '/admin/api/produtos', { ids: lista.map(function (p) { return p.id; }) });
    DADOS.produtos = r.produtos;
    renderProdutos();
  } catch (e) { toast(e.message, 'erro'); }
}

/* ==================== categorias ==================== */

function renderCategorias() {
  const alvo = document.getElementById('listaCategorias');
  const lista = DADOS.categorias.slice().sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); });

  if (!lista.length) {
    alvo.innerHTML = '<div class="vazio"><i>📂</i>Nenhuma categoria ainda.</div>';
    return;
  }

  alvo.innerHTML = lista.map(function (c, i) {
    const n = DADOS.produtos.filter(function (p) { return p.categoria === c.id; }).length;
    return '<div class="item-cat">' +
      '<span class="nome">' + esc(c.nome) + '</span>' +
      '<span class="contagem">' + n + (n === 1 ? ' produto' : ' produtos') + '</span>' +
      '<div class="botoes" style="display:flex;gap:6px;">' +
        '<button class="btn secundario mini" onclick="moverCategoria(\'' + esc(c.id) + '\',-1)"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="btn secundario mini" onclick="moverCategoria(\'' + esc(c.id) + '\',1)"' + (i === lista.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="btn secundario mini" onclick="renomearCategoria(\'' + esc(c.id) + '\')">Renomear</button>' +
        '<button class="btn perigo mini" onclick="apagarCategoria(\'' + esc(c.id) + '\')">Apagar</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function criarCategoria() {
  const input = document.getElementById('novaCat');
  const nome = input.value.trim();
  if (!nome) return;
  try {
    const r = await api('POST', '/admin/api/categorias', { nome: nome });
    DADOS.categorias = r.categorias;
    input.value = '';
    renderCategorias();
    toast('Categoria criada!', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function renomearCategoria(id) {
  const c = DADOS.categorias.find(function (x) { return x.id === id; });
  if (!c) return;
  const novo = prompt('Novo nome da categoria:', c.nome);
  if (novo === null) return;
  if (!novo.trim()) { toast('O nome não pode ficar vazio.', 'erro'); return; }
  try {
    const r = await api('PUT', '/admin/api/categorias/' + encodeURIComponent(id), { nome: novo.trim() });
    DADOS.categorias = r.categorias;
    renderCategorias();
    toast('Categoria renomeada.', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function apagarCategoria(id) {
  const c = DADOS.categorias.find(function (x) { return x.id === id; });
  const n = DADOS.produtos.filter(function (p) { return p.categoria === id; }).length;
  const aviso = n
    ? 'Apagar a categoria "' + c.nome + '"?\n\nOs ' + n + ' produtos dela NÃO serão apagados — eles ficam sem categoria.'
    : 'Apagar a categoria "' + c.nome + '"?';
  if (!confirm(aviso)) return;
  try {
    const r = await api('DELETE', '/admin/api/categorias/' + encodeURIComponent(id));
    DADOS.categorias = r.categorias;
    DADOS.produtos = r.produtos;
    renderCategorias();
    renderProdutos();
    toast('Categoria apagada.', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function moverCategoria(id, direcao) {
  const lista = DADOS.categorias.slice().sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); });
  const i = lista.findIndex(function (c) { return c.id === id; });
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= lista.length) return;
  const tmp = lista[i]; lista[i] = lista[j]; lista[j] = tmp;
  try {
    for (let k = 0; k < lista.length; k++) {
      await api('PUT', '/admin/api/categorias/' + encodeURIComponent(lista[k].id), { ordem: k + 1 });
    }
    DADOS.categorias = lista.map(function (c, k) { return Object.assign({}, c, { ordem: k + 1 }); });
    renderCategorias();
  } catch (e) { toast(e.message, 'erro'); }
}

/* ==================== monte seu bolo ==================== */

const ROTULO_TIPO = {
  unico: 'Escolha única',
  multiplo: 'Escolha múltipla',
  texto: 'Campo de texto',
  data: 'Data',
};

function preencherBolo() {
  const b = DADOS.bolo || { etapas: [] };
  document.querySelectorAll('[data-bolo]').forEach(function (el) {
    const chave = el.getAttribute('data-bolo');
    const v = b[chave];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'number') el.value = v == null ? 0 : v;
    else el.value = v == null ? '' : v;
  });
  document.getElementById('boloBase').value =
    Number(b.precoBase) ? String(b.precoBase).replace('.', ',') : '';
  const prev = document.getElementById('prevBolo');
  const img = document.getElementById('boloImg').value;
  if (img) { prev.src = img; prev.classList.remove('escondido'); }
  else { prev.removeAttribute('src'); prev.classList.add('escondido'); }
  renderEtapas();
}

function coletarBolo() {
  const b = {};
  document.querySelectorAll('[data-bolo]').forEach(function (el) {
    const chave = el.getAttribute('data-bolo');
    if (el.type === 'checkbox') b[chave] = el.checked;
    else if (el.type === 'number') b[chave] = parseInt(el.value, 10) || 0;
    else b[chave] = el.value;
  });
  b.precoBase = parsePreco(document.getElementById('boloBase').value);
  b.etapas = (DADOS.bolo && DADOS.bolo.etapas) ? DADOS.bolo.etapas : [];
  return b;
}

async function salvarBolo(silencioso) {
  try {
    const r = await api('PUT', '/admin/api/bolo', coletarBolo());
    DADOS.bolo = r.bolo;
    sujo.bolo = false;
    atualizarBarra();
    if (!silencioso) confirmarSalvo();
  } catch (e) {
    toast(e.message, 'erro');
  }
}

function renderEtapas() {
  const alvo = document.getElementById('listaEtapas');
  const etapas = (DADOS.bolo && DADOS.bolo.etapas) ? DADOS.bolo.etapas : [];
  if (!etapas.length) {
    alvo.innerHTML = '<div class="vazio" style="padding:28px 16px;"><i>🎂</i>Nenhuma etapa ainda.<br>Clique em "Adicionar etapa" para montar as perguntas.</div>';
    return;
  }
  alvo.innerHTML = etapas.map(function (e, i) {
    let meta = ROTULO_TIPO[e.tipo] || e.tipo;
    if (e.tipo === 'multiplo') meta += ' (até ' + (e.max || 1) + ')';
    if (e.tipo === 'unico' || e.tipo === 'multiplo') {
      meta += ' · ' + e.opcoes.length + (e.opcoes.length === 1 ? ' opção' : ' opções');
    }
    if (e.obrigatorio) meta += ' · obrigatória';
    return '<div class="item-etapa">' +
      '<div class="cab">' +
        '<span class="n">' + (i + 1) + '</span>' +
        '<span class="t">' + esc(e.titulo) + '</span>' +
        '<div class="acoes">' +
          '<button title="Subir" onclick="moverEtapa(\'' + esc(e.id) + '\',-1)"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button title="Descer" onclick="moverEtapa(\'' + esc(e.id) + '\',1)"' + (i === etapas.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button title="Editar" onclick="abrirEtapa(\'' + esc(e.id) + '\')">✎</button>' +
          '<button class="apagar" title="Apagar" onclick="apagarEtapa(\'' + esc(e.id) + '\')">🗑</button>' +
        '</div>' +
      '</div>' +
      '<div class="meta">' + esc(meta) + '</div>' +
    '</div>';
  }).join('');
}

/* ---------- modal da etapa ---------- */

let etapaEditando = null;

function abrirEtapa(id) {
  const etapas = (DADOS.bolo && DADOS.bolo.etapas) ? DADOS.bolo.etapas : [];
  const e = id ? etapas.find(function (x) { return x.id === id; }) : null;
  etapaEditando = e
    ? JSON.parse(JSON.stringify(e))
    : { id: '', titulo: '', tipo: 'unico', obrigatorio: false, max: 1, ajuda: '', placeholder: '', opcoes: [] };

  document.getElementById('etapaModalTitulo').textContent = e ? 'Editar etapa' : 'Nova etapa';
  document.getElementById('etTitulo').value = etapaEditando.titulo || '';
  document.getElementById('etTipo').value = etapaEditando.tipo || 'unico';
  document.getElementById('etObrig').checked = !!etapaEditando.obrigatorio;
  document.getElementById('etMax').value = etapaEditando.max || 1;
  document.getElementById('etAjuda').value = etapaEditando.ajuda || '';
  document.getElementById('etPlaceholder').value = etapaEditando.placeholder || '';
  renderOpcoesEtapa(etapaEditando.opcoes || []);
  atualizarCamposEtapa();

  document.getElementById('overlayEtapa').classList.add('aberto');
  document.body.style.overflow = 'hidden';
}

function fecharEtapa() {
  document.getElementById('overlayEtapa').classList.remove('aberto');
  document.body.style.overflow = '';
  etapaEditando = null;
}

function atualizarCamposEtapa() {
  const tipo = document.getElementById('etTipo').value;
  document.getElementById('campoEtMax').style.display = tipo === 'multiplo' ? '' : 'none';
  document.getElementById('campoEtPlaceholder').style.display = tipo === 'texto' ? '' : 'none';
  document.getElementById('blocoEtOpcoes').style.display =
    (tipo === 'texto' || tipo === 'data') ? 'none' : '';
}

function linhaOpcaoHTML(o, i, total) {
  return '<div class="op-linha" data-id="' + esc(o.id || '') + '">' +
    '<input type="text" class="op-nome" placeholder="Nome da opção" value="' + esc(o.nome || '') + '">' +
    '<input type="text" class="op-preco" inputmode="decimal" placeholder="+ R$" value="' +
      (Number(o.preco) ? String(o.preco).replace('.', ',') : '') + '">' +
    '<input type="text" class="op-desc" placeholder="Descrição (opcional)" value="' + esc(o.descricao || '') + '">' +
    '<div class="btns">' +
      '<button title="Subir" onclick="moverOpcao(' + i + ',-1)"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button title="Descer" onclick="moverOpcao(' + i + ',1)"' + (i === total - 1 ? ' disabled' : '') + '>↓</button>' +
      '<button title="Apagar" onclick="removerOpcao(' + i + ')">🗑</button>' +
    '</div>' +
  '</div>';
}

function renderOpcoesEtapa(lista) {
  const alvo = document.getElementById('listaOpcoesEtapa');
  if (!lista.length) {
    alvo.innerHTML = '<div class="ajuda" style="margin-bottom:8px;">Nenhuma opção ainda.</div>';
    return;
  }
  alvo.innerHTML = lista
    .map(function (o, i) { return linhaOpcaoHTML(o, i, lista.length); })
    .join('');
}

function lerOpcoesEtapa() {
  return [].slice.call(document.querySelectorAll('#listaOpcoesEtapa .op-linha'))
    .map(function (linha) {
      return {
        id: linha.getAttribute('data-id') || '',
        nome: linha.querySelector('.op-nome').value.trim(),
        preco: parsePreco(linha.querySelector('.op-preco').value),
        descricao: linha.querySelector('.op-desc').value.trim(),
      };
    })
    .filter(function (o) { return o.nome; });
}

function addOpcaoEtapa() {
  const lista = lerOpcoesEtapa();
  lista.push({ id: '', nome: '', preco: 0, descricao: '' });
  renderOpcoesEtapa(lista);
  const linhas = document.querySelectorAll('#listaOpcoesEtapa .op-linha');
  if (linhas.length) linhas[linhas.length - 1].querySelector('.op-nome').focus();
}

function removerOpcao(i) {
  const lista = lerOpcoesEtapa();
  lista.splice(i, 1);
  renderOpcoesEtapa(lista);
}

function moverOpcao(i, dir) {
  const lista = lerOpcoesEtapa();
  const j = i + dir;
  if (j < 0 || j >= lista.length) return;
  const t = lista[i]; lista[i] = lista[j]; lista[j] = t;
  renderOpcoesEtapa(lista);
}

async function salvarEtapa() {
  const titulo = document.getElementById('etTitulo').value.trim();
  if (!titulo) { toast('O título da etapa é obrigatório.', 'erro'); return; }

  const tipo = document.getElementById('etTipo').value;
  const opcoes = (tipo === 'texto' || tipo === 'data') ? [] : lerOpcoesEtapa();
  if ((tipo === 'unico' || tipo === 'multiplo') && !opcoes.length) {
    toast('Adicione pelo menos uma opção nessa etapa.', 'erro');
    return;
  }

  const nova = {
    id: etapaEditando && etapaEditando.id ? etapaEditando.id : '',
    titulo: titulo,
    tipo: tipo,
    obrigatorio: document.getElementById('etObrig').checked,
    max: Math.max(1, parseInt(document.getElementById('etMax').value, 10) || 1),
    ajuda: document.getElementById('etAjuda').value.trim(),
    placeholder: document.getElementById('etPlaceholder').value.trim(),
    opcoes: opcoes,
  };

  const etapas = (DADOS.bolo && DADOS.bolo.etapas) ? DADOS.bolo.etapas.slice() : [];
  const idx = nova.id ? etapas.findIndex(function (x) { return x.id === nova.id; }) : -1;
  if (idx >= 0) etapas[idx] = nova;
  else etapas.push(nova);

  const eraEdicao = idx >= 0;
  DADOS.bolo = Object.assign({}, DADOS.bolo, { etapas: etapas });
  const guardado = nova.id;
  await salvarBolo(true);
  renderEtapas();
  fecharEtapa();
  toast(eraEdicao || guardado ? 'Etapa atualizada!' : 'Etapa criada!', 'ok');
}

async function apagarEtapa(id) {
  const etapas = (DADOS.bolo && DADOS.bolo.etapas) ? DADOS.bolo.etapas : [];
  const e = etapas.find(function (x) { return x.id === id; });
  if (!e) return;
  if (!confirm('Apagar a etapa "' + e.titulo + '"?\n\nO que o cliente já tiver escolhido nela se perde.')) return;
  DADOS.bolo = Object.assign({}, DADOS.bolo, {
    etapas: etapas.filter(function (x) { return x.id !== id; }),
  });
  await salvarBolo(true);
  renderEtapas();
  toast('Etapa apagada.', 'ok');
}

async function moverEtapa(id, direcao) {
  const etapas = (DADOS.bolo && DADOS.bolo.etapas) ? DADOS.bolo.etapas.slice() : [];
  const i = etapas.findIndex(function (x) { return x.id === id; });
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= etapas.length) return;
  const t = etapas[i]; etapas[i] = etapas[j]; etapas[j] = t;
  DADOS.bolo = Object.assign({}, DADOS.bolo, { etapas: etapas });
  await salvarBolo(true);
  renderEtapas();
}

/* ==================== configurações da loja ==================== */

/* ==================== cores do site ==================== */

// Paletas prontas: cada uma é um conjunto harmonizado das quatro cores do site.
// Servem para o cliente não precisar escolher cor por cor do zero.
const PALETAS = [
  { nome: 'Dourado Clássico', destaque: '#c9a96e', titulos: '#4a2c2a', detalhes: '#d98a9e', fundo: '#fdf8f3' },
  { nome: 'Rosa Chá',        destaque: '#d98a9e', titulos: '#7a3b4d', detalhes: '#c96f86', fundo: '#fff7f9' },
  { nome: 'Chocolate',       destaque: '#b07d4f', titulos: '#3b2317', detalhes: '#a8624a', fundo: '#fbf6f0' },
  { nome: 'Menta',           destaque: '#4fae95', titulos: '#2c4a44', detalhes: '#7cc4b0', fundo: '#f4fbf9' },
  { nome: 'Lavanda',         destaque: '#9b8ec4', titulos: '#3f3556', detalhes: '#b8a7d9', fundo: '#f8f6fd' },
  { nome: 'Cereja',          destaque: '#d94f6a', titulos: '#5a2430', detalhes: '#e2788f', fundo: '#fff6f8' },
  { nome: 'Baunilha',        destaque: '#d9b25f', titulos: '#4a3b2a', detalhes: '#c98f5a', fundo: '#fdfaf2' },
  { nome: 'Azul Sereno',     destaque: '#6f9bc4', titulos: '#2c3f56', detalhes: '#8fb3d1', fundo: '#f5f9fd' },
];

const CAMPO_CORES = { corDestaque: 'destaque', corTitulos: 'titulos', corDetalhes: 'detalhes', corFundo: 'fundo' };

function hexParaRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function rgbParaHex(r, g, b) {
  return '#' + [r, g, b].map(function (v) {
    return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  }).join('');
}

// Mistura "a" com "b" (0 = só a, 1 = só b). Usado para tons derivados.
function misturar(a, b, q) {
  const A = hexParaRgb(a), B = hexParaRgb(b);
  return rgbParaHex(A[0] + (B[0] - A[0]) * q, A[1] + (B[1] - A[1]) * q, A[2] + (B[2] - A[2]) * q);
}

function escurecer(h, q) { return misturar(h, '#000000', q); }

// Texto legível sobre um fundo: cor clara pede texto escuro.
function textoSobre(h) {
  const c = hexParaRgb(h);
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 > 0.62 ? '#2b2b2b' : '#ffffff';
}

function corAtual(id) {
  const el = document.getElementById(id);
  return el && /^#[0-9a-f]{6}$/i.test(el.value) ? el.value : null;
}

function renderPaletas() {
  const box = document.getElementById('paletas');
  if (!box) return;
  const atual = corAtual('corDestaque');
  box.innerHTML = PALETAS.map(function (p, i) {
    const ativa = atual === p.destaque
      && corAtual('corTitulos') === p.titulos
      && corAtual('corDetalhes') === p.detalhes
      && corAtual('corFundo') === p.fundo;
    const pontos = [p.destaque, p.titulos, p.detalhes, p.fundo]
      .map(function (c) { return '<span class="ponto" style="background:' + c + '"></span>'; }).join('');
    return '<button type="button" class="paleta" data-paleta="' + i + '"'
      + (ativa ? ' style="border-color:var(--dourado);box-shadow:0 0 0 2px rgba(201,169,110,.2)"' : '')
      + '><span class="pontos">' + pontos + '</span>' + esc(p.nome) + '</button>';
  }).join('');
  box.querySelectorAll('[data-paleta]').forEach(function (b) {
    b.addEventListener('click', function () {
      aplicarPaleta(PALETAS[parseInt(b.getAttribute('data-paleta'), 10)]);
    });
  });
}

function aplicarPaleta(p) {
  if (!p) return;
  Object.keys(CAMPO_CORES).forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.value = p[CAMPO_CORES[id]];
  });
  marcarAlterado('config');
  atualizarPrevia();
  renderPaletas();
}

function atualizarPrevia() {
  const d = corAtual('corDestaque');
  const t = corAtual('corTitulos');
  const de = corAtual('corDetalhes');
  const f = corAtual('corFundo');
  if (!d || !t || !de || !f) return;

  const cartao = misturar(de, '#ffffff', 0.9);   // fundo dos cartões de produto
  const destEsc = escurecer(d, 0.26);            // variação escura do destaque

  const pintar = function (id, estilo) {
    const el = document.getElementById(id);
    if (el) for (const k in estilo) el.style[k] = estilo[k];
  };

  pintar('previaSite', { background: f });
  pintar('pvTopo', { background: t, color: textoSobre(t) });
  pintar('pvNome', { color: 'inherit' });
  pintar('pvSlogan', { color: 'inherit' });
  pintar('pvTitulo', { color: t });
  pintar('pvLinha', { background: d });
  pintar('pvCard', { background: cartao });
  pintar('pvThumb', { background: misturar(de, '#ffffff', 0.55) });
  pintar('pvItem', { color: t });
  pintar('pvPreco', { color: destEsc });
  pintar('pvBtn', { background: d, color: textoSobre(d) });
  pintar('pvCorpo', { background: f });
}

function iniciarCores() {
  renderPaletas();
  atualizarPrevia();
  Object.keys(CAMPO_CORES).forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', atualizarPrevia);
    if (el) el.addEventListener('change', function () { renderPaletas(); atualizarPrevia(); });
  });
  ['cfgNome', 'cfgSlogan'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', atualizarNomesPrevia);
  });
}

function preencherConfig() {
  document.querySelectorAll('[data-cfg]').forEach(function (el) {
    const chave = el.getAttribute('data-cfg');
    const valor = DADOS.config[chave];
    if (el.type === 'checkbox') el.checked = valor !== false;
    else el.value = valor == null ? '' : valor;
  });
  const hero = document.getElementById('cfgHeroImg').value;
  const prevHero = document.getElementById('prevHero');
  if (hero) { prevHero.src = hero; prevHero.classList.remove('escondido'); }
  const sobre = document.getElementById('cfgSobreImg').value;
  const prevSobre = document.getElementById('prevSobre');
  if (sobre) { prevSobre.src = sobre; prevSobre.classList.remove('escondido'); }
  // Cores: a prévia precisa ser redesenhada porque atribuir value por código
  // não dispara o evento "input" que a mantém atualizada.
  renderPaletas();
  atualizarPrevia();
  atualizarNomesPrevia();
}

// Mostra o nome e o subtítulo que a loja já tem, para a prévia não mentir.
function atualizarNomesPrevia() {
  const nome = document.getElementById('cfgNome');
  const slogan = document.getElementById('cfgSlogan');
  const pvNome = document.getElementById('pvNome');
  const pvSlogan = document.getElementById('pvSlogan');
  if (pvNome && nome && nome.value) pvNome.textContent = nome.value;
  if (pvSlogan && slogan) pvSlogan.textContent = slogan.value || '';
}

/* ==================== salvar (botão explícito) ==================== */

// Alterações ficam pendentes até apertar "Salvar alterações". Salvamento
// automático sem botão deixa quem não é técnico sem saber se gravou.
let sujo = { config: false, bolo: false };

function marcarAlterado(secao) {
  sujo[secao] = true;
  atualizarBarra();
}

function atualizarBarra() {
  const pendente = sujo.config || sujo.bolo;
  const barra = document.getElementById('barraSalvar');
  if (barra) barra.classList.toggle('visivel', pendente);
  if (pendente) {
    const st = document.getElementById('statusSalvar');
    if (st) st.textContent = '';
  }
}

function confirmarSalvo() {
  const st = document.getElementById('statusSalvar');
  if (st) {
    st.textContent = 'Tudo salvo ✓';
    setTimeout(function () { if (st.textContent === 'Tudo salvo ✓') st.textContent = ''; }, 2500);
  }
}

function limparPendencia() {
  sujo = { config: false, bolo: false };
  atualizarBarra();
}

// Liga cada campo ao aviso "não salvo" — não grava nada sozinho
function ligarFormularios() {
  document.querySelectorAll('[data-cfg]').forEach(function (el) {
    const evento = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(evento, function () { marcarAlterado('config'); });
  });
  document.querySelectorAll('[data-bolo]').forEach(function (el) {
    const evento = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(evento, function () { marcarAlterado('bolo'); });
  });
  const base = document.getElementById('boloBase');
  if (base) base.addEventListener('input', function () { marcarAlterado('bolo'); });

  window.addEventListener('beforeunload', function (e) {
    if (sujo.config || sujo.bolo) { e.preventDefault(); e.returnValue = ''; }
  });
}

function coletarConfig() {
  const corpo = {};
  document.querySelectorAll('[data-cfg]').forEach(function (el) {
    const chave = el.getAttribute('data-cfg');
    corpo[chave] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return corpo;
}

async function salvarAlteracoes() {
  const btn = document.getElementById('btnSalvarTudo');
  const rotulo = '<i class="fa-solid fa-floppy-disk"></i> Salvar alterações';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando…'; }
  try {
    if (sujo.config) {
      const r = await api('PUT', '/admin/api/config', coletarConfig());
      DADOS.config = r.config;
      document.getElementById('nomeLoja').innerHTML =
        esc(r.config.nome || 'Cardápio') + '<small>painel de edição</small>';
      sujo.config = false;
    }
    if (sujo.bolo) {
      const r = await api('PUT', '/admin/api/bolo', coletarBolo());
      DADOS.bolo = r.bolo;
      sujo.bolo = false;
    }
    atualizarBarra();
    confirmarSalvo();
    toast('Alterações salvas!', 'ok');
  } catch (e) {
    toast(e.message, 'erro');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = rotulo; }
  }
}

/* ==================== imagem ==================== */

// O input escondido que guarda o caminho da foto nao segue um padrao unico de id:
// uns sao id="pImg"/"boloImg", outros id="cfgHeroImg" com data-cfg="heroImg".
// Procurar pelos dois evita o erro "null is not an object" ao trocar a foto.
function campoOculto(nome) {
  return document.getElementById(nome)
      || document.querySelector('[data-cfg="' + nome + '"]')
      || document.querySelector('[data-bolo="' + nome + '"]');
}

async function enviarImagem(input, campo, previewId) {
  const arquivo = input.files && input.files[0];
  if (!arquivo) return;
  if (arquivo.size > 12 * 1024 * 1024) { toast('Imagem muito grande (máximo 12 MB).', 'erro'); input.value = ''; return; }

  const alvo = campoOculto(campo);
  // Confere ANTES de subir: se o campo nao existe, o arquivo ficaria orfao no servidor.
  if (!alvo) { toast('Não encontrei o campo "' + campo + '" nesta tela.', 'erro'); input.value = ''; return; }

  const prev = document.getElementById(previewId);
  const area = input.previousElementSibling;
  const textoOriginal = area ? area.innerHTML : '';

  if (area) area.innerHTML = '<p><strong>Enviando e otimizando a foto…</strong></p>';

  try {
    const dataUrl = await lerArquivo(arquivo);
    const r = await api('POST', '/admin/api/upload', { imagem: dataUrl });
    alvo.value = r.url;
    if (prev) { prev.src = r.url; prev.classList.remove('escondido'); }
    if (area) {
      area.innerHTML = '';
      const img = document.createElement('img');
      img.className = 'prev';
      img.id = previewId;
      img.src = r.url;
      area.appendChild(img);
      const p = document.createElement('p');
      p.innerHTML = '<strong>Trocar foto</strong>';
      area.appendChild(p);
    }
    const kb = Math.round(r.bytes / 1024);
    toast('Foto salva (' + kb + ' KB).', 'ok');
    if (campo === 'heroImg' || campo === 'sobreImg') marcarAlterado('config');
    if (campo === 'boloImg') marcarAlterado('bolo');
  } catch (e) {
    if (area) area.innerHTML = textoOriginal;
    toast(e.message, 'erro');
  } finally {
    input.value = '';
  }
}

function lerArquivo(arquivo) {
  return new Promise(function (resolve, reject) {
    const fr = new FileReader();
    fr.onload = function () { resolve(fr.result); };
    fr.onerror = function () { reject(new Error('Não foi possível ler o arquivo.')); };
    fr.readAsDataURL(arquivo);
  });
}

/* ==================== backup ==================== */

async function exportar() {
  try {
    const r = await fetch('/admin/api/exportar', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('Erro ao exportar');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cardapio-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Backup baixado.', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

async function importar(input) {
  const arquivo = input.files && input.files[0];
  if (!arquivo) return;
  if (!confirm('Restaurar este backup?\n\nO cardápio atual será substituído pelos dados do arquivo.')) { input.value = ''; return; }
  try {
    const texto = await new Promise(function (res, rej) {
      const fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('Falha ao ler o arquivo.')); };
      fr.readAsText(arquivo);
    });
    const dados = JSON.parse(texto);
    const r = await api('POST', '/admin/api/importar', { dados: dados });
    await carregarDados();
    toast('Backup restaurado: ' + r.produtos + ' produtos.', 'ok');
  } catch (e) { toast(e.message || 'Arquivo inválido.', 'erro'); }
  finally { input.value = ''; }
}

/* ==================== conta ==================== */

async function trocarSenha() {
  const atual = document.getElementById('senhaAtual').value;
  const nova = document.getElementById('senhaNova').value;
  const nova2 = document.getElementById('senhaNova2').value;
  if (nova !== nova2) { toast('As senhas novas não são iguais.', 'erro'); return; }
  if (nova.length < 8) { toast('A senha nova precisa ter ao menos 8 caracteres.', 'erro'); return; }
  try {
    await api('POST', '/admin/api/senha', { atual: atual, nova: nova });
    document.getElementById('senhaAtual').value = '';
    document.getElementById('senhaNova').value = '';
    document.getElementById('senhaNova2').value = '';
    toast('Senha alterada!', 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

/* ==================== init ==================== */

document.addEventListener('DOMContentLoaded', function () {
  ligarFormularios();
  iniciarCores();
  document.getElementById('overlayModal').addEventListener('click', function (e) {
    if (e.target === this) fecharModal();
  });
  document.getElementById('overlayEtapa').addEventListener('click', function (e) {
    if (e.target === this) fecharEtapa();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { fecharModal(); fecharEtapa(); }
  });
  verificarSessao();
});
