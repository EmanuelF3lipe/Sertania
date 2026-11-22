import { describe, expect, it } from 'vitest';
import { comandosPermitidos, podeTransicionar } from '../src/shared/dominio.js';
import { calcularSla, somarDiasUteis } from '../src/shared/sla.js';
import { Classificador, sugerirPrioridade } from '../src/server/ia/local.js';
import { pseudonimizar } from '../src/server/privacidade.js';
import { detectarFormato } from '../src/server/arquivos.js';

describe('fluxo', () => {
  it('só aceita comandos válidos para o estado', () => {
    expect(podeTransicionar('RECEBIDA', 'CONCLUIR')).toBe(false);
    expect(podeTransicionar('EM_EXECUCAO', 'CONCLUIR')).toBe(true);
    expect(comandosPermitidos('CONCLUIDA')).toEqual(['REABRIR']);
  });
});

describe('prazo em dias úteis', () => {
  it('pula fim de semana e feriado', () => {
    const sexta = new Date('2026-11-13T12:00:00-03:00');
    // 16/11 seg, 17/11 ter (feriado fictício), 18/11 qua
    const r = somarDiasUteis(sexta, 2, new Set(['2026-11-17']));
    expect(r.toISOString().slice(0, 10)).toBe('2026-11-18');
  });
  it('pausa congela o consumo', () => {
    const s = calcularSla({ criadaEm: new Date('2026-01-01'), prazoEm: new Date('2026-01-11'), pausadaDesde: new Date('2026-01-06'), encerradaEm: null }, new Date('2026-02-01'));
    expect(s.pausada).toBe(true);
    expect(s.vencida).toBe(false);
    expect(s.percentual).toBe(50);
  });
});

describe('IA local', () => {
  const clf = new Classificador([
    { id: 1, nome: 'Lâmpada apagada', descricao: '', palavrasChave: 'poste luz iluminacao', exemplos: [] },
    { id: 2, nome: 'Buraco na rua', descricao: '', palavrasChave: 'buraco calcamento asfalto', exemplos: [] },
  ]);
  it('classifica pelo relato', () => {
    expect(clf.classificar('o poste está sem luz')[0]?.servicoId).toBe(1);
    expect(clf.classificar('cratera e buraco no calçamento')[0]?.servicoId).toBe(2);
  });
  it('prioriza risco à vida', () => {
    expect(sugerirPrioridade('fio partido caído na calçada', 'NORMAL').prioridade).toBe('URGENTE');
    expect(sugerirPrioridade('lâmpada queimada', 'NORMAL').prioridade).toBe('NORMAL');
  });
  it('pseudonimiza antes de enviar a provedor externo', () => {
    const t = pseudonimizar('Sou Maria Souza, CPF 123.456.789-00, fone (87) 99999-1234, maria@x.com', ['Maria Souza']);
    expect(t).not.toMatch(/Maria|123\.456|99999|maria@/);
  });
});

describe('anexos', () => {
  it('decide pelo conteúdo, não pela extensão', () => {
    expect(detectarFormato(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(detectarFormato(Buffer.from('MZ executavel'))).toBeNull();
  });
});
