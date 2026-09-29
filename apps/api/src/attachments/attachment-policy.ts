/**
 * Politica de anexos (especificacao secao 13).
 *
 * Decisoes de implementacao, todas ancoradas na especificacao:
 *
 * 1. A lista de formatos ACEITOS e fechada: JPEG, PNG e PDF verificado.
 *    Executaveis, HTML, SVG e compactados sao recusados no MVP.
 *
 * 2. A deteccao e feita por ASSINATURA DE FORMATO (magic bytes), nunca pela
 *    extensao nem pelo MIME declarado pelo cliente. Um arquivo `.pdf` que
 *    comeca com `MZ` e um executavel renomeado.
 *
 * 3. Falha ou indisponibilidade da inspecao mantem o arquivo BLOQUEADO. O
 *    estado `ERROR` nunca vira `RELEASED`.
 *
 * 4. PDF cifrado e recusado com orientacao clara, porque nao ha como inspecionar
 *    o conteudo.
 */

import { createHash, randomUUID } from 'node:crypto';

export interface DetectedFormat {
  readonly mediaType: string;
  readonly extension: string;
  readonly category: 'IMAGE' | 'PDF';
  /** `true` quando a assinatura bate com um formato conhecido. */
  readonly signatureMatches: boolean;
}

/**
 * Assinaturas de formato aceitas.
 *
 * A lista e curta e revisada de proposito: aceitar um formato novo exige
 * decisao documentada, nao um `*` silencioso.
 */
const SIGNATURES: ReadonlyArray<{
  readonly mediaType: string;
  readonly extension: string;
  readonly category: 'IMAGE' | 'PDF';
  readonly offset: number;
  readonly bytes: readonly number[];
  /** bytes a comparar apos a assinatura, para reduzir colisao. */
  readonly followBytes?: ReadonlyArray<{ offset: number; bytes: readonly number[] }>;
}> = [
  // JPEG: FF D8 FF
  {
    mediaType: 'image/jpeg',
    extension: 'jpg',
    category: 'IMAGE',
    offset: 0,
    bytes: [0xff, 0xd8, 0xff],
  },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  {
    mediaType: 'image/png',
    extension: 'png',
    category: 'IMAGE',
    offset: 0,
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  // PDF: %PDF-
  {
    mediaType: 'application/pdf',
    extension: 'pdf',
    category: 'PDF',
    offset: 0,
    bytes: [0x25, 0x50, 0x44, 0x46, 0x2d],
  },
];

/** Formatos com assinaturaKnown para bloqueio explicito. */
const DANGEROUS_SIGNATURES: ReadonlyArray<{ readonly offset: number; readonly bytes: readonly number[]; readonly label: string }> = [
  { offset: 0, bytes: [0x4d, 0x5a], label: 'executavel Windows (MZ)' },
  { offset: 0, bytes: [0x7f, 0x45, 0x4c, 0x46], label: 'executavel Linux (ELF)' },
  { offset: 0, bytes: [0x23, 0x21], label: 'script com shebang' },
  { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04], label: 'arquivo compactado (ZIP/Office)' },
  { offset: 0, bytes: [0x1f, 0x8b], label: 'arquivo compactado (gzip)' },
  { offset: 0, bytes: [0x42, 0x5a, 0x68], label: 'arquivo compactado (bzip2)' },
  { offset: 0, bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], label: 'arquivo compactado (xz)' },
  { offset: 0, bytes: [0x52, 0x61, 0x72, 0x21], label: 'arquivo compactado (RAR)' },
  { offset: 0, bytes: [0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74], label: 'HTML' },
  { offset: 0, bytes: [0x3c, 0x3f, 0x78, 0x6d, 0x6c], label: 'XML' },
  { offset: 0, bytes: [0x3c, 0x73, 0x76, 0x67], label: 'SVG' },
];

/** Extensoes recusadas, como segunda barreira apos a assinatura. */
const DENIED_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe', 'dll', 'com', 'bat', 'cmd', 'msi', 'scr', 'ps1', 'vbs', 'js', 'jse',
  'hta', 'jar', 'sh', 'html', 'htm', 'xhtml', 'svg', 'svgz', 'xml', 'swf',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
]);

/** Limites iniciais propostos na secao 13. Sao propostas, nao regra municipal. */
export const ATTACHMENT_LIMITS = {
  maxFilesPerRequest: 5,
  maxBytesPerFile: 10 * 1024 * 1024,
} as const;

function matchesAt(buffer: Buffer, offset: number, bytes: readonly number[]): boolean {
  if (buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
}

export interface FormatDetection {
  readonly ok: boolean;
  readonly detected?: DetectedFormat;
  /** Motivo de recusa, seguro para exibicao ao cidadao. */
  readonly reason?: string;
  /** `true` quando um formato perigoso foi reconhecido explicitamente. */
  readonly dangerous?: string;
}

/**
 * Detecta o formato real pelos primeiros bytes.
 *
 * A extensao enviada pelo cliente nao participa da decisao. Ela serve apenas
 * para gerar um nome interno, e mesmo assim vamos gerar um nome aleatorio.
 */
export function detectFormat(buffer: Buffer): FormatDetection {
  if (buffer.length === 0) {
    return { ok: false, reason: 'O arquivo esta vazio.' };
  }

  // Formatos perigosos sao rejeitados pelo nome, antes de qualquer aceitacao,
  // para que a mensagem de erro seja especifica.
  for (const danger of DANGEROUS_SIGNATURES) {
    if (matchesAt(buffer, danger.offset, danger.bytes)) {
      return {
        ok: false,
        dangerous: danger.label,
        reason:
          'Este tipo de arquivo nao e aceito. Envie uma foto (JPG ou PNG) ou um PDF.',
      };
    }
  }

  for (const signature of SIGNATURES) {
    if (matchesAt(buffer, signature.offset, signature.bytes)) {
      return {
        ok: true,
        detected: {
          mediaType: signature.mediaType,
          extension: signature.extension,
          category: signature.category,
          signatureMatches: true,
        },
      };
    }
  }

  return {
    ok: false,
    reason:
      'Nao foi possivel identificar o formato do arquivo. Envie uma foto (JPG ou PNG) ou um PDF.',
  };
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

export function isDeniedExtension(fileName: string): boolean {
  return DENIED_EXTENSIONS.has(extensionOf(fileName));
}

/**
 * Detecta PDF cifrado.
 *
 * Um PDF cifrado nao pode ser inspecionado, e a especificacao manda recusar com
 * orientacao clara em vez de liberar sem verificacao.
 */
export function isEncryptedPdf(buffer: Buffer): boolean {
  if (buffer.length === 0 || !matchesAt(buffer, 0, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return false;
  }
  // Procura o dicionario `/Encrypt` no arquivo.
  return buffer.includes(Buffer.from('/Encrypt', 'latin1'));
}

/**
 * Resultado da validacao, como uniao discriminada.
 *
 * Modelar assim evita o caso em que `accepted: false` vem sem `reason`, o que
 * deixaria a interface do cidadao sem explicacao do problema. Com
 * `exactOptionalPropertyTypes` ligado, a alternativa seria tolerar `undefined`
 * num campo que a interface trata como obrigatorio.
 */
export type AttachmentValidation =
  | {
      readonly accepted: true;
      readonly detectedMediaType: string;
      readonly sha256: string;
      readonly internalName: string;
    }
  | {
      readonly accepted: false;
      readonly reason: string;
    };

/**
 * Valida um upload antes de qualquer escrita em armazenamento.
 *
 * A ordem importa: formato primeiro, tamanho depois. Um arquivo grande demais
 * nao deve consumir recursos de deteccao.
 */
export function validateUpload(input: {
  readonly buffer: Buffer;
  readonly fileName: string;
  readonly maxBytes?: number;
}): AttachmentValidation {
  const maxBytes = input.maxBytes ?? ATTACHMENT_LIMITS.maxBytesPerFile;

  if (input.buffer.length === 0) {
    return { accepted: false, reason: 'O arquivo esta vazio.' };
  }
  if (input.buffer.length > maxBytes) {
    const limitMb = Math.round(maxBytes / (1024 * 1024));
    return {
      accepted: false,
      reason: `O arquivo passa de ${limitMb} MB. Envie um arquivo menor.`,
    };
  }

  // Segunda barreira: extensao, mesmo que a assinatura seja valida. Um PDF
  // chamado `.exe` e um comportamento de quem tenta contornar a filtro.
  if (isDeniedExtension(input.fileName)) {
    return {
      accepted: false,
      reason: 'Este tipo de arquivo nao e aceito. Envie uma foto (JPG ou PNG) ou um PDF.',
    };
  }

  const detection = detectFormat(input.buffer);
  if (!detection.ok || !detection.detected) {
    // `detectFormat` sempre devolve um motivo quando recusa; o fallback cobre
    // o caso em que um novo formato for adicionado sem texto de recusa.
    return {
      accepted: false,
      reason: detection.reason ?? 'Formato de arquivo nao aceito.',
    };
  }

  if (detection.detected.category === 'PDF' && isEncryptedPdf(input.buffer)) {
    return {
      accepted: false,
      reason:
        'Este PDF esta protegido por senha e nao pode ser verificado. Envie um PDF sem senha.',
    };
  }

  return {
    accepted: true,
    detectedMediaType: detection.detected.mediaType,
    sha256: createHash('sha256').update(input.buffer).digest('hex'),
    // Nome interno aleatorio: o nome original pode conter dado pessoal e nao
    // precisa ser armazenado nem aparecer em log.
    internalName: `${randomUUID()}.${detection.detected.extension}`,
  };
}
