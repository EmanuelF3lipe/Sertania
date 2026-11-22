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
}

export function lerConfig(sobrescrever: Partial<Config> = {}): Config {
  const env = process.env;
  const ia = env['IA_PROVEDOR'] === 'claude' ? 'claude' : 'local';
  return {
    porta: Number(env['PORTA'] ?? 3000),
    pastaDados: path.resolve(env['PASTA_DADOS'] ?? './dados'),
    iaProvedor: ia,
    retencaoDias: Number(env['RETENCAO_DIAS'] ?? 365),
    limiarSupressao: Number(env['LIMIAR_SUPRESSAO'] ?? 5),
    producao: env['NODE_ENV'] === 'production',
    ...sobrescrever,
  };
}
