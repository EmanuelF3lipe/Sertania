import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type Linha = Record<string, SQLInputValue>;
type Param = SQLInputValue | boolean | undefined;

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS secretarias (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL UNIQUE, sigla TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS setores (
  id INTEGER PRIMARY KEY, secretaria_id INTEGER NOT NULL REFERENCES secretarias(id), nome TEXT NOT NULL,
  UNIQUE (secretaria_id, nome)
);
CREATE TABLE IF NOT EXISTS servicos (
  id INTEGER PRIMARY KEY, setor_id INTEGER NOT NULL REFERENCES setores(id), nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '', palavras_chave TEXT NOT NULL DEFAULT '',
  prazo_dias_uteis INTEGER NOT NULL DEFAULT 5, prioridade_padrao TEXT NOT NULL DEFAULT 'NORMAL',
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS localidades (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL UNIQUE, tipo TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS feriados (data TEXT PRIMARY KEY, nome TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, telefone TEXT,
  senha_hash TEXT NOT NULL, papel TEXT NOT NULL, secretaria_id INTEGER REFERENCES secretarias(id),
  setor_id INTEGER REFERENCES setores(id), ativo INTEGER NOT NULL DEFAULT 1,
  consentimento_em TEXT, criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  csrf TEXT NOT NULL, expira_em TEXT NOT NULL, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contadores (chave TEXT PRIMARY KEY, valor INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS demandas (
  id INTEGER PRIMARY KEY,
  protocolo TEXT NOT NULL UNIQUE,
  codigo_hash TEXT NOT NULL,
  servico_id INTEGER NOT NULL REFERENCES servicos(id),
  setor_id INTEGER NOT NULL REFERENCES setores(id),
  secretaria_id INTEGER NOT NULL REFERENCES secretarias(id),
  status TEXT NOT NULL,
  status_anterior TEXT,
  prioridade TEXT NOT NULL,
  descricao TEXT NOT NULL,
  endereco TEXT, referencia TEXT,
  localidade_id INTEGER REFERENCES localidades(id),
  lat REAL, lng REAL,
  canal TEXT NOT NULL,
  solicitante_id INTEGER REFERENCES usuarios(id),
  solicitante_nome TEXT, solicitante_telefone TEXT, solicitante_email TEXT,
  anonima INTEGER NOT NULL DEFAULT 0,
  responsavel_id INTEGER REFERENCES usuarios(id),
  registrada_por INTEGER REFERENCES usuarios(id),
  criada_em TEXT NOT NULL,
  encaminhada_em TEXT, primeira_resposta_em TEXT, concluida_em TEXT,
  prazo_em TEXT, pausada_desde TEXT,
  resultado TEXT, agendada_para TEXT,
  ciclo INTEGER NOT NULL DEFAULT 1,
  reaberturas INTEGER NOT NULL DEFAULT 0,
  recorrencia_de INTEGER REFERENCES demandas(id),
  avaliacao_nota INTEGER, avaliacao_comentario TEXT,
  chave_idempotencia TEXT UNIQUE,
  versao INTEGER NOT NULL DEFAULT 1,
  anonimizada_em TEXT
);
CREATE INDEX IF NOT EXISTS ix_demandas_status ON demandas(status);
CREATE INDEX IF NOT EXISTS ix_demandas_secretaria ON demandas(secretaria_id, setor_id);
CREATE INDEX IF NOT EXISTS ix_demandas_criada ON demandas(criada_em);
CREATE TABLE IF NOT EXISTS idempotencia (chave TEXT PRIMARY KEY, resposta TEXT NOT NULL, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY, demanda_id INTEGER NOT NULL REFERENCES demandas(id),
  tipo TEXT NOT NULL, de_status TEXT, para_status TEXT,
  texto_publico TEXT, nota_interna TEXT,
  autor_id INTEGER REFERENCES usuarios(id), autor_nome TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_eventos_demanda ON eventos(demanda_id);
CREATE TABLE IF NOT EXISTS anexos (
  id INTEGER PRIMARY KEY, demanda_id INTEGER NOT NULL REFERENCES demandas(id),
  evento_id INTEGER REFERENCES eventos(id),
  nome TEXT NOT NULL, mime TEXT NOT NULL, tamanho INTEGER NOT NULL, sha256 TEXT NOT NULL,
  caminho TEXT NOT NULL, origem TEXT NOT NULL, enviado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY, em TEXT NOT NULL, usuario_id INTEGER, usuario_nome TEXT,
  acao TEXT NOT NULL, entidade TEXT, entidade_id TEXT, detalhes TEXT, ip TEXT,
  hash_anterior TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sugestoes_ia (
  id INTEGER PRIMARY KEY, demanda_id INTEGER NOT NULL REFERENCES demandas(id),
  conteudo TEXT NOT NULL, provedor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDENTE', decisao_detalhe TEXT,
  decidido_por INTEGER REFERENCES usuarios(id), decidido_em TEXT, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alertas (
  id INTEGER PRIMARY KEY, chave TEXT NOT NULL UNIQUE, tipo TEXT NOT NULL, severidade TEXT NOT NULL,
  titulo TEXT NOT NULL, descricao TEXT NOT NULL,
  secretaria_id INTEGER, localidade_id INTEGER, demanda_id INTEGER,
  status TEXT NOT NULL DEFAULT 'ABERTO', tratado_por INTEGER, tratado_em TEXT, observacao TEXT,
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relatorios (
  id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, filtros TEXT NOT NULL, conteudo TEXT NOT NULL,
  narrativa TEXT NOT NULL, narrativa_status TEXT NOT NULL, provedor TEXT NOT NULL,
  gerado_por INTEGER REFERENCES usuarios(id), revisado_por INTEGER, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notificacoes (
  id INTEGER PRIMARY KEY, demanda_id INTEGER NOT NULL, canal TEXT NOT NULL, destino TEXT NOT NULL,
  mensagem TEXT NOT NULL, criado_em TEXT NOT NULL, enviado_em TEXT
);
CREATE TABLE IF NOT EXISTS uso_paineis (
  id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL, painel TEXT NOT NULL, em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS diagnostico (
  id INTEGER PRIMARY KEY, indicador TEXT NOT NULL, valor TEXT NOT NULL, unidade TEXT,
  periodo TEXT, fonte TEXT NOT NULL, observacao TEXT, validado INTEGER NOT NULL DEFAULT 0,
  registrado_por INTEGER REFERENCES usuarios(id), validado_por INTEGER, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens_integracao (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, escopos TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios(id), criado_em TEXT NOT NULL, revogado_em TEXT, ultimo_uso TEXT
);
`;

export class Banco {
  readonly db: DatabaseSync;

  constructor(arquivo: string) {
    if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    this.db = new DatabaseSync(arquivo);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(ESQUEMA);
    this.migrar();
  }

  /** Migracoes aditivas para bancos criados por versoes anteriores. */
  private migrar(): void {
    const colunas = (t: string) => (this.db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    if (!colunas('usuarios').includes('deve_trocar_senha'))
      this.db.exec('ALTER TABLE usuarios ADD COLUMN deve_trocar_senha INTEGER NOT NULL DEFAULT 0');
    if (!colunas('usuarios').includes('ultimo_acesso_em')) this.db.exec('ALTER TABLE usuarios ADD COLUMN ultimo_acesso_em TEXT');
    if (!colunas('usuarios').includes('pediu_senha_em')) this.db.exec('ALTER TABLE usuarios ADD COLUMN pediu_senha_em TEXT');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS parametros (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS perfis_permissoes (papel TEXT PRIMARY KEY, permissoes TEXT NOT NULL, atualizado_em TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ia_uso (
        id INTEGER PRIMARY KEY AUTOINCREMENT, mes TEXT NOT NULL, criado_em TEXT NOT NULL, operacao TEXT NOT NULL, modelo TEXT NOT NULL,
        entrada INTEGER NOT NULL DEFAULT 0, saida INTEGER NOT NULL DEFAULT 0, cache_leitura INTEGER NOT NULL DEFAULT 0, cache_escrita INTEGER NOT NULL DEFAULT 0,
        ok INTEGER NOT NULL DEFAULT 1, erro TEXT, demanda_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS ix_ia_uso_mes ON ia_uso (mes);
    `);
  }

  private conv(params: Param[]): SQLInputValue[] {
    return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
  }

  all<T = Linha>(sql: string, ...params: Param[]): T[] {
    return this.db.prepare(sql).all(...this.conv(params)) as T[];
  }

  get<T = Linha>(sql: string, ...params: Param[]): T | undefined {
    return this.db.prepare(sql).get(...this.conv(params)) as T | undefined;
  }

  run(sql: string, ...params: Param[]): { id: number; alteradas: number } {
    const r = this.db.prepare(sql).run(...this.conv(params));
    return { id: Number(r.lastInsertRowid), alteradas: Number(r.changes) };
  }

  /** Transacao sincrona: o node:sqlite e sincrono, entao nao ha intercalacao. */
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  fechar(): void {
    this.db.close();
  }
}

export const agoraIso = (): string => new Date().toISOString();
