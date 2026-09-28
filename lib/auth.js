'use strict';
/**
 * Autenticacao sem dependencia externa: scrypt para senha, token aleatorio
 * em cookie HttpOnly para sessao. Sessoes persistem em disco para que um
 * restart do servico nao deslogue a cliente no meio do trabalho.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSAO_MS = 1000 * 60 * 60 * 24 * 14; // 14 dias
const COOKIE = 'cardapio_sid';

/* ---------------- senha ---------------- */

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${hash}`;
}

function verificarSenha(senha, armazenado) {
  try {
    const [alg, N, r, p, salt, hash] = String(armazenado).split('$');
    if (alg !== 'scrypt') return false;
    const calc = crypto.scryptSync(String(senha), salt, Buffer.from(hash, 'hex').length, {
      N: parseInt(N, 10),
      r: parseInt(r, 10),
      p: parseInt(p, 10),
    });
    const alvo = Buffer.from(hash, 'hex');
    if (calc.length !== alvo.length) return false;
    return crypto.timingSafeEqual(calc, alvo);
  } catch {
    return false;
  }
}

/* ---------------- arquivo de credenciais ---------------- */

function lerAuth() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function gravarAuth(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = AUTH_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, AUTH_FILE);
  fs.chmodSync(AUTH_FILE, 0o600);
}

/** Cria o usuario inicial se ainda nao existir. Retorna a senha gerada. */
function garantirUsuario(usuario, senhaDesejada) {
  const atual = lerAuth();
  if (atual && atual.usuario && atual.senhaHash) return null;
  const senha = senhaDesejada || gerarSenha();
  gravarAuth({
    usuario: usuario || 'admin',
    senhaHash: hashSenha(senha),
    criadoEm: new Date().toISOString(),
  });
  return senha;
}

function trocarSenha(senhaAtual, senhaNova) {
  const auth = lerAuth();
  if (!auth) return { ok: false, erro: 'Usuario nao configurado' };
  if (!verificarSenha(senhaAtual, auth.senhaHash)) return { ok: false, erro: 'Senha atual incorreta' };
  if (String(senhaNova).length < 8) return { ok: false, erro: 'A senha nova precisa ter ao menos 8 caracteres' };
  gravarAuth({ ...auth, senhaHash: hashSenha(senhaNova), alteradoEm: new Date().toISOString() });
  return { ok: true };
}

function gerarSenha(tamanho = 12) {
  const alfabeto = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(tamanho);
  let out = '';
  for (let i = 0; i < tamanho; i++) out += alfabeto[bytes[i] % alfabeto.length];
  return out;
}

/* ---------------- sessoes ---------------- */

function lerSessoes() {
  try {
    return JSON.parse(fs.readFileSync(SESS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function gravarSessoes(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SESS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, SESS_FILE);
  fs.chmodSync(SESS_FILE, 0o600);
}

function criarSessao(usuario) {
  const token = crypto.randomBytes(32).toString('hex');
  const todas = lerSessoes();
  const agora = Date.now();
  for (const t of Object.keys(todas)) {
    if (!todas[t].expiraEm || todas[t].expiraEm < agora) delete todas[t];
  }
  todas[token] = { usuario, criadoEm: agora, expiraEm: agora + SESSAO_MS };
  gravarSessoes(todas);
  return token;
}

function sessaoValida(token) {
  if (!token || typeof token !== 'string') return null;
  const todas = lerSessoes();
  const s = todas[token];
  if (!s) return null;
  if (!s.expiraEm || s.expiraEm < Date.now()) {
    delete todas[token];
    gravarSessoes(todas);
    return null;
  }
  return s;
}

function encerrarSessao(token) {
  if (!token) return;
  const todas = lerSessoes();
  if (todas[token]) {
    delete todas[token];
    gravarSessoes(todas);
  }
}

/* ---------------- cookies ---------------- */

function lerCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

function montarCookie(token, seguro) {
  const partes = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSAO_MS / 1000)}`,
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

function cookieDeSaida() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/* ---------------- limite de tentativas ---------------- */

const tentativas = new Map();
const MAX_TENTATIVAS = 6;
const JANELA_MS = 1000 * 60 * 15;

function podeTentar(ip) {
  const agora = Date.now();
  const reg = tentativas.get(ip);
  if (!reg) return true;
  if (agora - reg.primeira > JANELA_MS) {
    tentativas.delete(ip);
    return true;
  }
  return reg.n < MAX_TENTATIVAS;
}

function registrarFalha(ip) {
  const agora = Date.now();
  const reg = tentativas.get(ip);
  if (!reg || agora - reg.primeira > JANELA_MS) {
    tentativas.set(ip, { n: 1, primeira: agora });
  } else {
    reg.n++;
  }
}

function limparTentativas(ip) {
  tentativas.delete(ip);
}

module.exports = {
  COOKIE,
  hashSenha,
  verificarSenha,
  lerAuth,
  garantirUsuario,
  trocarSenha,
  gerarSenha,
  criarSessao,
  sessaoValida,
  encerrarSessao,
  lerCookies,
  montarCookie,
  cookieDeSaida,
  podeTentar,
  registrarFalha,
  limparTentativas,
};
