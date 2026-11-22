import path from 'node:path';
import { Banco } from './db.js';
import { lerConfig } from './config.js';
import { fazerBackup } from './rotas/admin.js';

const config = lerConfig();
const banco = new Banco(path.join(config.pastaDados, 'sertania.db'));
const r = fazerBackup({ banco, config });
console.log(`Backup gerado: ${path.join(config.pastaDados, 'backups', r.arquivo)} (${r.tamanho} bytes)`);
console.log('Para restaurar: pare a API e copie o arquivo de backup sobre dados/sertania.db.');
