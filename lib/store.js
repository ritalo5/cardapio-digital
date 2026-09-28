'use strict';
/**
 * Camada de dados: um unico arquivo JSON, escrito de forma atomica.
 * Para um cardapio (dezenas de produtos, um usuario editando) isso e
 * suficiente e elimina dependencia de banco. Backup = copiar a pasta data/.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'menu.json');
const TMP_FILE = DB_FILE + '.tmp';
const BKP_DIR = path.join(DATA_DIR, 'backups');

// Quantos snapshots manter. O cliente edita pelo painel e apaga item sem
// querer; sem historico nao existe de onde recuperar. Sao arquivos pequenos.
const MANTER_RECENTES = 40;   // os N ultimos, independente do dia
const MANTER_DIAS = 30;       // uma foto por dia, para pegar "semana passada"

let cache = null;
let cacheMtime = 0;

function configPadrao() {
  return {
    nome: 'Minha Confeitaria',
    slogan: 'Confeitaria Artesanal',
    descricao: 'Doces feitos a mao, com ingredientes selecionados.',
    whatsapp: '',
    instagram: '',
    heroImg: '',
    sobreScript: 'Feito com amor',
    sobreTitulo: 'Nossa historia',
    sobreTexto: '',
    sobreImg: '',
    rodape: '',
    msgPedido: 'Ola! Gostei do produto:',
    aviso: '',
    mostrarPrecos: true,
    // Identidade visual — cores do site e enquadramento da foto de capa.
    // As chaves precisam existir aqui: o PUT /admin/api/config só aceita
    // campos que estejam neste objeto.
    corDestaque: '#c9a96e',
    corTitulos: '#4a2c2a',
    corFundo: '#fdf8f3',
    corDetalhes: '#d98a9e',
    capaAjuste: 'preencher',
  };
}

function boloPadrao() {
  return {
    ativo: false,
    titulo: 'Monte seu Bolo',
    subtitulo: 'Escolha massa, recheio e cobertura do jeito que você quiser.',
    texto: '',
    img: '',
    precoBase: 0,
    prazoDias: 2,
    prazoAviso: '',
    etapas: [],
  };
}

const TIPOS_ETAPA = ['unico', 'multiplo', 'texto', 'data'];

function normalizeEtapa(e, i) {
  const tipo = TIPOS_ETAPA.indexOf(texto(e && e.tipo)) >= 0 ? e.tipo : 'unico';
  const opcoes = Array.isArray(e && e.opcoes) ? e.opcoes : [];
  const etapa = {
    id: texto(e && e.id).trim() || 'etapa' + (i + 1),
    titulo: texto(e && e.titulo).trim() || 'Etapa ' + (i + 1),
    tipo: tipo,
    obrigatorio: booleano(e && e.obrigatorio, false),
    max: Math.max(1, Math.round(numero(e && e.max, 1))),
    ajuda: texto(e && e.ajuda),
    placeholder: texto(e && e.placeholder),
    opcoes: opcoes
      .filter((o) => o && typeof o === 'object')
      .map((o, k) => ({
        id: texto(o.id).trim() || 'op' + (i + 1) + '_' + (k + 1),
        nome: texto(o.nome).trim() || 'Opção ' + (k + 1),
        preco: numero(o.preco, 0),
        descricao: texto(o.descricao),
      })),
  };
  if (etapa.tipo === 'multiplo' && etapa.max < 1) etapa.max = 1;
  return etapa;
}

function normalizeBolo(raw) {
  const d = boloPadrao();
  if (!raw || typeof raw !== 'object') return d;
  const etapas = Array.isArray(raw.etapas) ? raw.etapas : [];
  return {
    ativo: booleano(raw.ativo, d.ativo),
    titulo: texto(raw.titulo, d.titulo),
    subtitulo: texto(raw.subtitulo, d.subtitulo),
    texto: texto(raw.texto, d.texto),
    img: texto(raw.img, d.img),
    precoBase: numero(raw.precoBase, d.precoBase),
    prazoDias: Math.max(0, Math.round(numero(raw.prazoDias, d.prazoDias))),
    prazoAviso: texto(raw.prazoAviso, d.prazoAviso),
    etapas: etapas.filter((e) => e && typeof e === 'object').map(normalizeEtapa),
  };
}

function defaults() {
  return { config: configPadrao(), categorias: [], produtos: [], bolo: boloPadrao() };
}

function texto(v, padrao) {
  return typeof v === 'string' ? v : (padrao || '');
}

function numero(v, padrao) {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : (padrao || 0);
}

function booleano(v, padrao) {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return padrao;
}

/** Normaliza qualquer coisa que chegue em algo com a forma esperada. */
function normalize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;

  const cfg = raw.config && typeof raw.config === 'object' ? raw.config : {};
  const config = {};
  for (const k of Object.keys(d.config)) {
    config[k] = typeof d.config[k] === 'boolean'
      ? booleano(cfg[k], d.config[k])
      : texto(cfg[k], d.config[k]);
  }

  const cats = Array.isArray(raw.categorias) ? raw.categorias : [];
  const categorias = cats
    .filter((c) => c && typeof c === 'object')
    .map((c, i) => ({
      id: texto(c.id).trim() || 'cat' + (i + 1),
      nome: texto(c.nome).trim() || 'Sem nome',
      ordem: numero(c.ordem, i + 1),
    }));

  const prods = Array.isArray(raw.produtos) ? raw.produtos : [];
  const produtos = prods
    .filter((p) => p && typeof p === 'object')
    .map((p, i) => ({
      id: texto(p.id).trim() || 'p' + (i + 1),
      nome: texto(p.nome).trim() || 'Sem nome',
      descricao: texto(p.descricao),
      preco: numero(p.preco, 0),
      unidade: texto(p.unidade, 'unidade'),
      categoria: texto(p.categoria),
      tag: texto(p.tag),
      img: texto(p.img),
      disponivel: booleano(p.disponivel, true),
      ordem: numero(p.ordem, i + 1),
    }));

  return { config, categorias, produtos, bolo: normalizeBolo(raw.bolo) };
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read() {
  ensureDir();
  try {
    const st = fs.statSync(DB_FILE);
    if (cache && st.mtimeMs === cacheMtime) return cache;
    const db = normalize(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    cache = db;
    cacheMtime = st.mtimeMs;
    return db;
  } catch (e) {
    if (e.code === 'ENOENT') {
      const db = defaults();
      write(db);
      return db;
    }
    throw e;
  }
}

/* ---------------- historico (backup a cada gravacao) ---------------- */

function dois(n) { return String(n).padStart(2, '0'); }

function carimbo(d) {
  const t = d || new Date();
  return t.getFullYear() + dois(t.getMonth() + 1) + dois(t.getDate())
    + '-' + dois(t.getHours()) + dois(t.getMinutes()) + dois(t.getSeconds());
}

/** Copia o arquivo atual para data/backups/ antes de sobrescrever. */
function guardarHistorico() {
  try {
    if (!fs.existsSync(DB_FILE)) return;              // primeira gravacao
    const conteudo = fs.readFileSync(DB_FILE, 'utf8');
    if (!conteudo.trim()) return;                     // nao guarda arquivo vazio
    fs.mkdirSync(BKP_DIR, { recursive: true });
    const destino = path.join(BKP_DIR, 'menu-' + carimbo() + '.json');
    // Nao regrava se o conteudo for igual ao snapshot mais novo (evita encher
    // o historico com copias identicas quando o cliente salva sem mudar nada).
    const ultimo = listarHistorico()[0];
    if (ultimo && ultimo.conteudo === conteudo) return;
    fs.writeFileSync(destino, conteudo, 'utf8');
    limparHistorico();
  } catch (e) {
    // Backup nunca pode impedir o cliente de salvar.
    console.error('[backup] falhou:', e.message);
  }
}

function listarHistorico() {
  try {
    return fs.readdirSync(BKP_DIR)
      .filter((f) => /^menu-\d{8}-\d{6}\.json$/.test(f))
      .sort()
      .reverse()
      .map((f) => {
        const p = path.join(BKP_DIR, f);
        let conteudo = null;
        try { conteudo = fs.readFileSync(p, 'utf8'); } catch (e) {}
        return { arquivo: f, caminho: p, conteudo, mtime: fs.statSync(p).mtime };
      });
  } catch (e) {
    return [];
  }
}

/**
 * Mantem os N mais recentes e, dos mais antigos, uma foto por dia.
 * Sem isso o historico cresce para sempre ou perde o "de ontem".
 */
function limparHistorico() {
  const todos = listarHistorico();          // ja vem do mais novo ao mais antigo
  const manter = new Set(todos.slice(0, MANTER_RECENTES).map((b) => b.arquivo));
  const dias = new Set();
  for (const b of todos) {
    const dia = b.arquivo.slice(5, 13);     // AAAAMMDD
    if (!dias.has(dia) && dias.size < MANTER_DIAS) {
      dias.add(dia);
      manter.add(b.arquivo);
    }
  }
  for (const b of todos) {
    if (!manter.has(b.arquivo)) {
      try { fs.unlinkSync(b.caminho); } catch (e) {}
    }
  }
}

/** Restaura um snapshot (nome do arquivo). Guarda o atual antes. */
function restaurarHistorico(arquivo) {
  const alvo = path.join(BKP_DIR, path.basename(String(arquivo)));
  if (!fs.existsSync(alvo)) return { ok: false, erro: 'Backup nao encontrado' };
  let conteudo;
  try {
    conteudo = fs.readFileSync(alvo, 'utf8');
    JSON.parse(conteudo);                   // so restaura JSON valido
  } catch (e) {
    return { ok: false, erro: 'Backup corrompido: ' + e.message };
  }
  guardarHistorico();                       // salva o estado atual antes de trocar
  fs.writeFileSync(DB_FILE, conteudo, 'utf8');
  cache = null;
  cacheMtime = 0;
  return { ok: true, config: read() };
}

function write(db) {
  ensureDir();
  const norm = normalize(db);
  guardarHistorico();
  fs.writeFileSync(TMP_FILE, JSON.stringify(norm, null, 2), 'utf8');
  fs.renameSync(TMP_FILE, DB_FILE);
  cache = norm;
  cacheMtime = fs.statSync(DB_FILE).mtimeMs;
  return norm;
}

/** Atualizacao parcial segura: recebe uma funcao que recebe uma copia. */
function update(fn) {
  const atual = JSON.parse(JSON.stringify(read()));
  const novo = fn(atual) || atual;
  return write(novo);
}

function porOrdem(a, b) {
  return (a.ordem || 0) - (b.ordem || 0);
}

/** Visao publica: so o que o site do cliente precisa, so produto disponivel. */
function publicView(db) {
  const d = db || read();
  return {
    config: {
      nome: d.config.nome,
      slogan: d.config.slogan,
      descricao: d.config.descricao,
      whatsapp: d.config.whatsapp,
      instagram: d.config.instagram,
      heroImg: d.config.heroImg,
      sobreScript: d.config.sobreScript,
      sobreTitulo: d.config.sobreTitulo,
      sobreTexto: d.config.sobreTexto,
      sobreImg: d.config.sobreImg,
      rodape: d.config.rodape,
      msgPedido: d.config.msgPedido,
      aviso: d.config.aviso,
      mostrarPrecos: d.config.mostrarPrecos,
      // Identidade visual: sem estas linhas o painel salva as cores mas o
      // site nunca recebe — a visao publica so devolve o que esta listado.
      corDestaque: d.config.corDestaque,
      corTitulos: d.config.corTitulos,
      corDetalhes: d.config.corDetalhes,
      corFundo: d.config.corFundo,
      capaAjuste: d.config.capaAjuste,
    },
    categorias: d.categorias.slice().sort(porOrdem),
    produtos: d.produtos
      .filter((p) => p.disponivel !== false)
      .slice()
      .sort(porOrdem),
    bolo: d.bolo,
    atualizadoEm: Date.now(),
  };
}

function novoId(prefixo) {
  return (prefixo || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

module.exports = {
  DATA_DIR,
  DB_FILE,
  BKP_DIR,
  defaults,
  normalize,
  read,
  write,
  update,
  publicView,
  novoId,
  configPadrao,
  listarHistorico,
  restaurarHistorico,
};
