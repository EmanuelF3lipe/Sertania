import fs from 'node:fs';
import path from 'node:path';
import { lerConfig } from './config.js';
import { criarApp } from './app.js';

// Recria o banco de demonstracao. Pede confirmacao explicita por argumento.
const config = lerConfig();
const arquivo = path.join(config.pastaDados, 'sertania.db');
if (fs.existsSync(arquivo) && !process.argv.includes('--recriar')) {
  console.log(`Já existe ${arquivo}. Use "npm run seed -- --recriar" para apagar e recriar os dados de demonstração.`);
  process.exit(0);
}
for (const f of [arquivo, `${arquivo}-wal`, `${arquivo}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
criarApp({ semDemonstracao: process.argv.includes('--vazio') }).ctx.banco.fechar();
console.log('Banco criado com dados de demonstração.');
