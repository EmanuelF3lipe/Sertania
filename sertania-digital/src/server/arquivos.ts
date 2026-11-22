import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import multer from 'multer';
import { invalido } from './erros.js';

/**
 * Politica de anexos, herdada do repositorio original: o formato e decidido pela
 * ASSINATURA do arquivo (magic bytes), nunca pela extensao ou MIME informado.
 */
const ASSINATURAS: Array<{ mime: string; ext: string; bytes: number[]; deslocamento?: number }> = [
  { mime: 'image/jpeg', ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/webp', ext: 'webp', bytes: [0x57, 0x45, 0x42, 0x50], deslocamento: 8 },
  { mime: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

export const LIMITE_ARQUIVOS = 5;
export const LIMITE_BYTES = 8 * 1024 * 1024;

export function detectarFormato(buf: Buffer): { mime: string; ext: string } | null {
  for (const a of ASSINATURAS) {
    const d = a.deslocamento ?? 0;
    if (buf.length >= d + a.bytes.length && a.bytes.every((b, i) => buf[d + i] === b)) {
      if (a.mime === 'image/webp' && buf.subarray(0, 4).toString('latin1') !== 'RIFF') continue;
      return { mime: a.mime, ext: a.ext };
    }
  }
  return null;
}

export function pdfCifrado(buf: Buffer): boolean {
  return buf.toString('latin1').includes('/Encrypt');
}

export const receberArquivos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITE_BYTES, files: LIMITE_ARQUIVOS },
}).array('arquivos', LIMITE_ARQUIVOS);

export interface ArquivoSalvo { nome: string; mime: string; tamanho: number; sha256: string; caminho: string }

export function salvarArquivo(pastaDados: string, arquivo: Express.Multer.File): ArquivoSalvo {
  const formato = detectarFormato(arquivo.buffer);
  if (!formato) throw invalido(`"${arquivo.originalname}" não é uma foto (JPG, PNG, WEBP) ou PDF válido`);
  if (formato.mime === 'application/pdf' && pdfCifrado(arquivo.buffer))
    throw invalido(`"${arquivo.originalname}" é um PDF protegido por senha. Envie sem senha.`);
  const sha = createHash('sha256').update(arquivo.buffer).digest('hex');
  const relativo = path.join('anexos', sha.slice(0, 2), `${randomUUID()}.${formato.ext}`);
  const destino = path.join(pastaDados, relativo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, arquivo.buffer);
  const nomeLimpo = arquivo.originalname.replace(/[^\w.\- ]/g, '_').slice(0, 120) || `arquivo.${formato.ext}`;
  return { nome: nomeLimpo, mime: formato.mime, tamanho: arquivo.size, sha256: sha, caminho: relativo };
}
