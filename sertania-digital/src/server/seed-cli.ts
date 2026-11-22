import fs from 'node:fs';
import path from 'node:path';
import { lerConfig } from './config.js';
import { criarApp } from './app.js';

/**
 * Cria o banco do zero.
 *   npm run iniciar -- --limpo        minimo para implantacao real (recomendado na prefeitura)
 *   npm run iniciar -- --modelo       catalogo modelo de secretarias/servicos, sem pessoas nem demandas
 *   npm run iniciar -- --demonstracao dados ficticios para conhecer o sistema
 * Se ja existir um banco, exige --recriar (apaga tudo, inclusive anexos).
 */
const args = process.argv.slice(2);
const modo = args.includes('--limpo') ? 'limpo' : args.includes('--modelo') ? 'modelo' : 'demonstracao';
const config = lerConfig({ modoInicial: modo });
const arquivo = path.join(config.pastaDados, 'sertania.db');
if (fs.existsSync(arquivo)) {
  if (!args.includes('--recriar')) {
    console.log(`Já existe um banco em ${arquivo}.`);
    console.log('Para APAGAR tudo e recriar, repita o comando com --recriar (faça um backup antes: npm run backup).');
    process.exit(0);
  }
  for (const f of [arquivo, `${arquivo}-wal`, `${arquivo}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
  fs.rmSync(path.join(config.pastaDados, 'anexos'), { recursive: true, force: true });
}
const { ctx } = criarApp({ modoInicial: modo });
ctx.banco.fechar();
console.log(`Banco criado no modo "${modo}" em ${arquivo}.`);
console.log('Inicie o servidor (npm start ou npm run dev): o código de primeiro acesso aparecerá no terminal.');
