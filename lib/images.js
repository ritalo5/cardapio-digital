'use strict';
/**
 * Processamento de imagem no upload.
 * Foto de celular tem 3-5 MB; o cardapio precisa abrir rapido no 4G.
 * Redimensiona, gira conforme o EXIF e converte para WebP.
 * Reencodar tambem descarta metadados e neutraliza payload embutido.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB de arquivo original
const LARGURA_MAX = 1400;

/** Assinaturas de arquivo. Confiamos no conteudo, nunca na extensao. */
function tipoPorAssinatura(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.slice(0, 3).toString('ascii') === 'GIF') return 'gif';
  if (buf.slice(4, 12).toString('ascii').startsWith('ftyphei') || buf.slice(4, 12).toString('ascii').startsWith('ftypmif')) return 'heic';
  return null;
}

function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  return { mime: m[1].toLowerCase(), buf };
}

function garantirDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * Recebe um data URL e devolve o caminho publico da imagem salva.
 * Lanca Error com mensagem amigavel quando o arquivo nao serve.
 */
async function salvarImagem(dataUrl) {
  const dec = decodeDataUrl(dataUrl);
  if (!dec) throw new Error('Formato invalido. Envie um arquivo de imagem.');
  if (dec.buf.length > MAX_BYTES) throw new Error('Imagem muito grande (maximo 12 MB).');
  if (!tipoPorAssinatura(dec.buf)) throw new Error('O arquivo nao parece ser uma imagem valida.');

  garantirDir();
  const nome = crypto.randomBytes(12).toString('hex') + '.webp';
  const destino = path.join(UPLOAD_DIR, nome);

  await sharp(dec.buf, { failOn: 'none', limitInputPixels: 50_000_000 })
    .rotate() // respeita a orientacao do EXIF
    .resize({ width: LARGURA_MAX, height: LARGURA_MAX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(destino);

  const st = fs.statSync(destino);
  if (!st.size) {
    fs.unlinkSync(destino);
    throw new Error('Nao foi possivel processar a imagem.');
  }
  return { url: '/uploads/' + nome, bytes: st.size };
}

/** Apaga uma imagem enviada. Nunca sai de UPLOAD_DIR. */
function apagarImagem(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return false;
  const nome = path.basename(url);
  if (!/^[a-f0-9]{24}\.webp$/.test(nome)) return false;
  const alvo = path.join(UPLOAD_DIR, nome);
  if (!alvo.startsWith(UPLOAD_DIR + path.sep)) return false;
  try {
    fs.unlinkSync(alvo);
    return true;
  } catch {
    return false;
  }
}

module.exports = { salvarImagem, apagarImagem, UPLOAD_DIR, MAX_BYTES };
