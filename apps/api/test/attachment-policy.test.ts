import { describe, expect, it } from '@jest/globals';
import {
  ATTACHMENT_LIMITS,
  detectFormat,
  isDeniedExtension,
  isEncryptedPdf,
  validateUpload,
} from '../src/attachments/attachment-policy';

/** Constroi um JPEG minimo com assinatura valida. */
function jpeg(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

/** Constroi um PNG minimo com assinatura valida. */
function png(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
}

/** Constroi um PDF nao cifrado. */
function pdf(): Buffer {
  return Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF', 'latin1');
}

/** PDF com dicionario de cifragem. */
function encryptedPdf(): Buffer {
  return Buffer.from(
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Encrypt 2 0 R >>\nendobj\n%%EOF',
    'latin1',
  );
}

describe('deteccao por assinatura de formato', () => {
  it('reconhece JPEG pelos magic bytes', () => {
    const result = detectFormat(jpeg());
    expect(result.ok).toBe(true);
    expect(result.detected?.mediaType).toBe('image/jpeg');
  });

  it('reconhece PNG pelos magic bytes', () => {
    const result = detectFormat(png());
    expect(result.ok).toBe(true);
    expect(result.detected?.mediaType).toBe('image/png');
  });

  it('reconhece PDF pelo cabecalho', () => {
    const result = detectFormat(pdf());
    expect(result.ok).toBe(true);
    expect(result.detected?.mediaType).toBe('application/pdf');
  });

  it('recusa executavel Windows mesmo com extensao .pdf', () => {
    // Este e o ataque principal contra filtro de upload: renomear o
    // executavel. A decisao se baseia nos bytes, nunca no nome enviado.
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const result = detectFormat(exe);
    expect(result.ok).toBe(false);
    expect(result.dangerous).toContain('executavel');
  });

  it('recusa HTML, que pode carregar script', () => {
    const html = Buffer.from('<script>alert(1)</script>', 'latin1');
    const result = detectFormat(html);
    expect(result.ok).toBe(false);
    expect(result.dangerous).toContain('HTML');
  });

  it('recusa SVG, que pode carregar script embutido', () => {
    const svg = Buffer.from('<svg onload="alert(1)"></svg>', 'latin1');
    expect(detectFormat(svg).ok).toBe(false);
  });

  it('recusa arquivo compactado, usado para esconder conteudo', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    expect(detectFormat(zip).ok).toBe(false);
  });

  it('recusa arquivo vazio', () => {
    expect(detectFormat(Buffer.alloc(0)).ok).toBe(false);
  });

  it('recusa conteudo sem assinatura conhecida', () => {
    const texto = Buffer.from('isto e um texto qualquer sem formato', 'latin1');
    const result = detectFormat(texto);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/JPG|PNG|PDF/i);
  });
});

describe('extensoes recusadas', () => {
  it('recusa lista de extensoes perigosas', () => {
    const perigosas = ['a.exe', 'b.HTML', 'c.svg', 'd.zip', 'e.bat', 'f.ps1', 'g.jar'];
    for (const nome of perigosas) {
      expect([nome, isDeniedExtension(nome)]).toEqual([nome, true]);
    }
  });

  it('aceita extensoes de formatos permitidos e arquivo sem extensao', () => {
    const permitidos = ['a.jpg', 'b.JPEG', 'c.png', 'd.pdf', 'sem-extensao'];
    for (const nome of permitidos) {
      expect([nome, isDeniedExtension(nome)]).toEqual([nome, false]);
    }
  });
});

describe('PDF cifrado', () => {
  it('detecta dicionario de cifragem', () => {
    expect(isEncryptedPdf(encryptedPdf())).toBe(true);
  });

  it('nao confunde PDF comum com cifrado', () => {
    expect(isEncryptedPdf(pdf())).toBe(false);
  });

  it('recusa PDF cifrado com orientacao clara', () => {
    // Sem isso, um PDF protegido entraria sem inspecao possivel.
    const result = validateUpload({ buffer: encryptedPdf(), fileName: 'documento.pdf' });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error('PDF cifrado deveria ser recusado');
    expect(result.reason).toMatch(/senha/i);
  });
});

describe('validacao completa de upload', () => {
  it('aceita JPEG valido e devolve hash e nome interno', () => {
    const result = validateUpload({ buffer: jpeg(), fileName: 'minha foto.jpg' });
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error('JPEG valido deveria ser aceito');
    expect(result.detectedMediaType).toBe('image/jpeg');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    // O nome interno e aleatorio e nao preserva o nome original, que pode
    // conter dado pessoal.
    expect(result.internalName).toMatch(/^[0-9a-f-]{36}\.jpg$/);
  });

  it('aceita PNG e PDF validos', () => {
    expect(validateUpload({ buffer: png(), fileName: 'a.png' }).accepted).toBe(true);
    expect(validateUpload({ buffer: pdf(), fileName: 'a.pdf' }).accepted).toBe(true);
  });

  it('recusa arquivo acima do limite com mensagem util', () => {
    const grande = Buffer.concat([jpeg(), Buffer.alloc(ATTACHMENT_LIMITS.maxBytesPerFile)]);
    const result = validateUpload({ buffer: grande, fileName: 'grande.jpg' });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error('arquivo acima do limite deveria ser recusado');
    // A mensagem diz como corrigir, e nao apenas que ha um erro.
    expect(result.reason).toMatch(/10 MB/);
  });

  it('recusa executavel mesmo com nome de imagem valido', () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
    expect(validateUpload({ buffer: exe, fileName: 'foto.jpg' }).accepted).toBe(false);
  });

  it('recusa PDF verdadeiro com extensao de executavel', () => {
    // Segunda barreira: mesmo com assinatura de PDF valida, uma extensao
    // perigosa e recusada.
    const result = validateUpload({ buffer: pdf(), fileName: 'documento.exe' });
    expect(result.accepted).toBe(false);
  });

  it('gera hash diferente para conteudo diferente', () => {
    const a = validateUpload({ buffer: jpeg(), fileName: 'a.jpg' });
    const b = validateUpload({
      buffer: Buffer.concat([jpeg(), Buffer.from([1])]),
      fileName: 'b.jpg',
    });
    expect(a.accepted).toBe(true);
    expect(b.accepted).toBe(true);
    if (!a.accepted || !b.accepted) throw new Error('upload deveria ter sido aceito');
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('gera nome interno diferente para o mesmo conteudo', () => {
    // Nome interno aleatorio evita que dois usuarios com a mesma foto tenham
    // chaves de armazenamento adivinhaveis.
    const a = validateUpload({ buffer: jpeg(), fileName: 'a.jpg' });
    const b = validateUpload({ buffer: jpeg(), fileName: 'a.jpg' });
    // A uniao discriminada exige estreitar antes de ler os campos do caso
    // aceito; se `accepted` fosse apenas `boolean`, estes campos ficariam
    // opcionalmente indefinidos e o teste passaria a compilar sem verificar.
    expect(a.accepted).toBe(true);
    expect(b.accepted).toBe(true);
    if (!a.accepted || !b.accepted) throw new Error('upload deveria ter sido aceito');
    expect(a.internalName).not.toBe(b.internalName);
  });

  it('aceita arquivo exatamente no limite e recusa um byte acima', () => {
    // A secao 13 define 5 anexos de ate 10 MB. O limite e inclusivo: um
    // arquivo de exatamente 10 MB passa, um de 10 MB e 1 byte nao. A contagem
    // de arquivos por solicitacao vive no caso de uso, nao aqui.
    const assinatura = jpeg();
    const noLimite = Buffer.concat([
      assinatura,
      Buffer.alloc(ATTACHMENT_LIMITS.maxBytesPerFile - assinatura.length),
    ]);
    expect(noLimite.length).toBe(ATTACHMENT_LIMITS.maxBytesPerFile);
    expect(validateUpload({ buffer: noLimite, fileName: 'no-limite.jpg' }).accepted).toBe(true);

    const acimaDoLimite = Buffer.concat([noLimite, Buffer.from([0])]);
    const resultado = validateUpload({ buffer: acimaDoLimite, fileName: 'acima.jpg' });
    expect(resultado.accepted).toBe(false);
    if (resultado.accepted) throw new Error('arquivo 1 byte acima do limite deveria ser recusado');
  });
});
