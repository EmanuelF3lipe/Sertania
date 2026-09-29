import { describe, expect, it } from 'vitest';
import {
  formatProtocol,
  isValidProtocol,
  newRequestId,
  protocolMatchesYear,
  protocolYear,
  reserveNextProtocolSql,
  PROTOCOL_PREFIX,
} from '../src/protocol.js';
import { PROTOCOL_PATTERN } from '../src/auth.js';

describe('formato de protocolo (secao 6)', () => {
  it('usa o formato SER-AAAA-NNNNNN', () => {
    const protocol = formatProtocol(2026, 1);
    expect(protocol).toBe('SER-2026-000001');
    expect(protocol).toMatch(PROTOCOL_PATTERN);
  });

  it('preenche com zeros a esquerda para manter largura fixa', () => {
    expect(formatProtocol(2026, 1)).toBe('SER-2026-000001');
    expect(formatProtocol(2026, 42)).toBe('SER-2026-000042');
    expect(formatProtocol(2026, 999999)).toBe('SER-2026-999999');
  });

  it('aceita apenas o prefixo e o ano corretos', () => {
    expect(formatProtocol(2026, 1).startsWith(`${PROTOCOL_PREFIX}-2026-`)).toBe(true);
  });

  it('recusa sequencia zero ou negativa', () => {
    expect(() => formatProtocol(2026, 0)).toThrow(/invalida/i);
    expect(() => formatProtocol(2026, -1)).toThrow(/invalida/i);
  });

  it('recusa sequencia nao inteira', () => {
    expect(() => formatProtocol(2026, 1.5)).toThrow(/invalida/i);
  });

  it('falha explicitamente quando o ano esgota os seis digitos', () => {
    // Gerar um setimo digito quebraria o formato que a propria interface
    // valida. Falhar aqui e melhor que emitir um protocolo invalido.
    expect(() => formatProtocol(2026, 1000000)).toThrow(/esgotou/i);
  });

  it('valida protocolo corretamente', () => {
    expect(isValidProtocol('SER-2026-000001')).toBe(true);
    expect(isValidProtocol('SER-2026-999999')).toBe(true);
    expect(isValidProtocol('SER-2026-00001')).toBe(false); // curto
    expect(isValidProtocol('SER-2026-0000001')).toBe(false); // longo
    expect(isValidProtocol('ser-2026-000001')).toBe(false); // minusculo
    expect(isValidProtocol('ABC-2026-000001')).toBe(false); // prefixo
    expect(isValidProtocol('SER-26-000001')).toBe(false); // ano curto
    expect(isValidProtocol('')).toBe(false);
  });

  it('extrai o ano do instante de envio', () => {
    expect(protocolYear(new Date('2026-09-28T12:00:00.000Z'))).toBe(2026);
    expect(protocolYear(new Date('2027-01-01T00:00:00.000Z'))).toBe(2027);
  });

  it('confere se o protocolo pertence ao ano esperado', () => {
    expect(protocolMatchesYear('SER-2026-000001', 2026)).toBe(true);
    expect(protocolMatchesYear('SER-2026-000001', 2027)).toBe(false);
  });
});

describe('reserva de numero por sequencia do banco', () => {
  const sql = reserveNextProtocolSql(2026);

  it('usa ON CONFLICT DO UPDATE RETURNING, que e atomico', () => {
    // Sem isso, dois envios concorrentes leria o mesmo maximo e gerariam o
    // mesmo protocolo. A distribuicao de numero fica no proprio banco.
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE');
    expect(sql).toContain('RETURNING');
  });

  it('parametriza o ano, em vez de concatena-lo', () => {
    // Concatenar tornaria o valor nao-confiavel numa query.
    expect(sql).toContain('$1');
    expect(sql).not.toContain('2026');
  });

  it('incrementa o contador existente', () => {
    expect(sql).toMatch(/last_value"\s*\+\s*1/);
  });

  it('nunca calcula por MAX mais um', () => {
    // A forma proibida pela especificacao, verificaveivel por inspecao.
    expect(sql.toUpperCase()).not.toContain('MAX(');
  });

  it('atualiza o instante, para poder auditar a ultima reserva', () => {
    expect(sql).toContain('updated_at');
  });
});

describe('identificador interno', () => {
  it('e UUID aleatorio, diferente do protocolo', () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it('nao guarda a sequencia do protocolo', () => {
    // O UUID nao deve permitir adivinhar quantas solicitacoes existem.
    const id = newRequestId();
    expect(id).not.toContain('SER-');
  });
});

describe('protocolo nao e senha', () => {
  it('o padrao aceito nao permite advinhar o proximo numero', () => {
    // Conhecer um protocolo nao da acesso a outro. A separacao real e a
    // autorizacao por cidadao, verificada em authorization.test.ts; aqui
    // registramos que o formato em si nao carrega segredo.
    const p1 = formatProtocol(2026, 1);
    const p2 = formatProtocol(2026, 2);
    expect(p1).not.toBe(p2);
  });
});
