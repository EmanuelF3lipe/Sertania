import path from 'node:path';
import fs from 'node:fs';

/** Carrega .env simples (sem dependencia externa). Variaveis ja definidas prevalecem. */
function carregarEnv(): void {
  const arquivo = path.resolve('.env');
  if (!fs.existsSync(arquivo)) return;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? '';
  }
}
carregarEnv();

export interface Config {
  porta: number;
  pastaDados: string;
  iaProvedor: 'local' | 'claude';
  retencaoDias: number;
  limiarSupressao: number;
  producao: boolean;
  /** Conteudo criado quando o banco esta vazio: demonstracao, modelo ou limpo. */
  modoInicial: 'demonstracao' | 'modelo' | 'limpo';
}

/** Aceita tambem --porta=3000 --dados=./dados --modo-inicial=limpo --ia=claude na linha de comando. */
function argumentos(): Record<string, string> {
  const r: Record<string, string> = {};
  const mapa: Record<string, string> = { porta: 'PORTA', dados: 'PASTA_DADOS', 'modo-inicial': 'MODO_INICIAL', ia: 'IA_PROVEDOR' };
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (m && m[1] && mapa[m[1]]) r[mapa[m[1]]!] = m[2] ?? '';
  }
  return r;
}

export function lerConfig(sobrescrever: Partial<Config> = {}): Config {
  const env = { ...process.env, ...argumentos() };
  const ia = env['IA_PROVEDOR'] === 'claude' ? 'claude' : 'local';
  return {
    porta: Number(env['PORTA'] ?? 3000),
    pastaDados: path.resolve(env['PASTA_DADOS'] ?? './dados'),
    iaProvedor: ia,
    retencaoDias: Number(env['RETENCAO_DIAS'] ?? 365),
    limiarSupressao: Number(env['LIMIAR_SUPRESSAO'] ?? 5),
    producao: env['NODE_ENV'] === 'production',
    modoInicial: env['MODO_INICIAL'] === 'limpo' ? 'limpo' : env['MODO_INICIAL'] === 'modelo' ? 'modelo' : 'demonstracao',
    ...sobrescrever,
  };
}
