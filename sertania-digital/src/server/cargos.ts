import type { Banco } from './db.js';
import { agoraIso } from './db.js';
import {
  ESCOPO_PAPEL, ESCOPOS_CARGO, PAPEIS, PERMISSOES, TODAS_PERMISSOES,
  type CargoDto, type EscopoCargo, type Papel, type Permissao, type UsuarioSessao,
} from '../shared/dominio.js';
import { conflito, invalido, naoEncontrado } from './erros.js';

/**
 * Cargos definidos pela Prefeitura: nome, alcance (setor, secretaria ou municipio) e permissoes.
 * Na instalacao nascem 7 cargos iguais aos perfis originais; a administracao edita, duplica, cria e exclui.
 * A pessoa pode estar ligada a varias secretarias e setores (tabela usuario_lotacoes).
 */

/** Nomes dos cargos iniciais (um por perfil original). */
const NOME_INICIAL: Record<Exclude<Papel, 'CIDADAO'>, [string, string]> = {
  ATENDENTE: ['Atendimento / triagem', 'Recebe os pedidos, classifica, encaminha e registra no balcão.'],
  CAMPO: ['Equipe de campo', 'Executa os serviços do seu setor e registra o que foi feito.'],
  GESTOR_SETOR: ['Gestor de setor', 'Distribui o trabalho do setor e acompanha os prazos.'],
  GESTOR_SECRETARIA: ['Gestor de secretaria', 'Acompanha a secretaria inteira, indicadores e relatórios.'],
  ADMIN_SAD: ['Administração (SAD)', 'Configura o sistema e acompanha o município, sem ver dados pessoais.'],
  AUDITOR: ['Auditoria / controle interno', 'Consulta solicitações, indicadores e a trilha de auditoria.'],
};

export const PERMISSAO_ADMIN: Permissao = 'admin.usuarios';

const limpar = (lista: unknown): Permissao[] =>
  [...new Set((Array.isArray(lista) ? lista : []).filter((p): p is Permissao => (TODAS_PERMISSOES as string[]).includes(p as string)))];

/** Cria os cargos iniciais (se nao houver nenhum) e liga cada servidor ao cargo e as suas lotacoes. Idempotente. */
export function garantirCargos(banco: Banco): void {
  banco.tx(() => {
    const n = banco.get<{ n: number }>('SELECT COUNT(*) AS n FROM cargos')!.n;
    if (n === 0) {
      const agora = agoraIso();
      for (const papel of PAPEIS) {
        if (papel === 'CIDADAO') continue;
        // ajustes feitos na versao anterior (tela "Quem pode o que") sao preservados
        const ajuste = banco.get<{ permissoes: string }>('SELECT permissoes FROM perfis_permissoes WHERE papel = ?', papel);
        const perms = ajuste ? limpar(JSON.parse(ajuste.permissoes)) : [...PERMISSOES[papel]];
        if (papel === 'ADMIN_SAD' && !perms.includes(PERMISSAO_ADMIN)) perms.push(PERMISSAO_ADMIN);
        const [nome, descricao] = NOME_INICIAL[papel];
        banco.run('INSERT INTO cargos (nome, descricao, escopo, permissoes, codigo, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?)',
          nome, descricao, ESCOPO_PAPEL[papel], JSON.stringify(perms), papel, agora, agora);
      }
    }
    banco.run(`UPDATE usuarios SET cargo_id = (SELECT c.id FROM cargos c WHERE c.codigo = usuarios.papel)
               WHERE cargo_id IS NULL AND papel <> 'CIDADAO'`);
    // lotacoes a partir da secretaria/setor de cada servidor que ainda nao tem nenhuma
    banco.run(`INSERT OR IGNORE INTO usuario_lotacoes (usuario_id, secretaria_id, setor_id)
               SELECT u.id, COALESCE(u.secretaria_id, (SELECT st.secretaria_id FROM setores st WHERE st.id = u.setor_id)), u.setor_id FROM usuarios u
               WHERE u.papel <> 'CIDADAO' AND (u.secretaria_id IS NOT NULL OR u.setor_id IS NOT NULL)
                 AND NOT EXISTS (SELECT 1 FROM usuario_lotacoes l WHERE l.usuario_id = u.id)`);
  });
}

interface LinhaCargo { id: number; nome: string; descricao: string | null; escopo: EscopoCargo; permissoes: string; codigo: string | null; atualizado_em: string }

function paraDto(c: LinhaCargo, usuarios: number): CargoDto {
  return { id: c.id, nome: c.nome, descricao: c.descricao, escopo: c.escopo, permissoes: limpar(JSON.parse(c.permissoes)), codigo: c.codigo, usuarios, atualizadoEm: c.atualizado_em };
}

export function listarCargos(banco: Banco): CargoDto[] {
  const contagem = new Map(banco.all<{ cargo_id: number; n: number }>("SELECT cargo_id, COUNT(*) AS n FROM usuarios WHERE ativo = 1 AND papel <> 'CIDADAO' GROUP BY cargo_id").map((x) => [x.cargo_id, x.n]));
  return banco.all<LinhaCargo>('SELECT * FROM cargos ORDER BY nome COLLATE NOCASE').map((c) => paraDto(c, contagem.get(c.id) ?? 0));
}

export function lerCargo(banco: Banco, id: number): CargoDto {
  const c = banco.get<LinhaCargo>('SELECT * FROM cargos WHERE id = ?', id);
  if (!c) throw naoEncontrado('Cargo não encontrado');
  const n = banco.get<{ n: number }>("SELECT COUNT(*) AS n FROM usuarios WHERE ativo = 1 AND cargo_id = ? AND papel <> 'CIDADAO'", id)!.n;
  return paraDto(c, n);
}

/** Quantos servidores ativos ficariam com a permissao de administrar a equipe, depois de uma mudanca hipotetica. */
function administradores(banco: Banco, mudanca: { cargoId?: number; permissoes?: Permissao[]; excluirCargo?: number; usuarioId?: number; novoCargoId?: number | null; desativar?: boolean }): number {
  const cargos = new Map(banco.all<{ id: number; permissoes: string }>('SELECT id, permissoes FROM cargos').map((c) => [c.id, limpar(JSON.parse(c.permissoes))]));
  if (mudanca.cargoId !== undefined && mudanca.permissoes) cargos.set(mudanca.cargoId, mudanca.permissoes);
  if (mudanca.excluirCargo !== undefined) cargos.delete(mudanca.excluirCargo);
  const pessoas = banco.all<{ id: number; cargo_id: number | null }>("SELECT id, cargo_id FROM usuarios WHERE ativo = 1 AND papel <> 'CIDADAO'");
  return pessoas.filter((p) => {
    if (p.id === mudanca.usuarioId) {
      if (mudanca.desativar) return false;
      const cid = mudanca.novoCargoId === undefined ? p.cargo_id : mudanca.novoCargoId;
      return cid !== null && (cargos.get(cid) ?? []).includes(PERMISSAO_ADMIN);
    }
    return p.cargo_id !== null && (cargos.get(p.cargo_id) ?? []).includes(PERMISSAO_ADMIN);
  }).length;
}

const SEM_ADMIN = 'Pelo menos uma pessoa ativa precisa poder administrar a equipe. Dê essa permissão a outro cargo antes.';

/** Antes de trocar o cargo de alguem ou desativar a pessoa. */
export function conferirAdministradores(banco: Banco, usuarioId: number, novoCargoId: number | null, desativar: boolean): void {
  if (administradores(banco, { usuarioId, novoCargoId, desativar }) === 0) throw conflito(SEM_ADMIN);
}

export interface EntradaCargo { nome: string; descricao: string | null; escopo: EscopoCargo; permissoes: Permissao[] }

function validarEntrada(e: EntradaCargo): EntradaCargo {
  const nome = e.nome.trim().replace(/\s+/g, ' ');
  if (nome.length < 2) throw invalido('Dê um nome ao cargo');
  if (!ESCOPOS_CARGO.includes(e.escopo)) throw invalido('Alcance inválido');
  return { nome, descricao: e.descricao?.trim() || null, escopo: e.escopo, permissoes: limpar(e.permissoes) };
}

function nomeLivre(banco: Banco, nome: string, exceto?: number) {
  const outro = banco.get<{ id: number }>('SELECT id FROM cargos WHERE nome = ? COLLATE NOCASE', nome);
  if (outro && outro.id !== exceto) throw conflito(`Já existe um cargo chamado “${nome}”`);
}

export function criarCargo(banco: Banco, entrada: EntradaCargo): CargoDto {
  const e = validarEntrada(entrada);
  nomeLivre(banco, e.nome);
  const agora = agoraIso();
  const { id } = banco.run('INSERT INTO cargos (nome, descricao, escopo, permissoes, criado_em, atualizado_em) VALUES (?,?,?,?,?,?)',
    e.nome, e.descricao, e.escopo, JSON.stringify(e.permissoes), agora, agora);
  return lerCargo(banco, id);
}

export function alterarCargo(banco: Banco, id: number, entrada: EntradaCargo): { antes: CargoDto; depois: CargoDto } {
  const antes = lerCargo(banco, id);
  const e = validarEntrada(entrada);
  nomeLivre(banco, e.nome, id);
  if (antes.permissoes.includes(PERMISSAO_ADMIN) && !e.permissoes.includes(PERMISSAO_ADMIN) && administradores(banco, { cargoId: id, permissoes: e.permissoes }) === 0)
    throw conflito(SEM_ADMIN);
  banco.run('UPDATE cargos SET nome = ?, descricao = ?, escopo = ?, permissoes = ?, atualizado_em = ? WHERE id = ?',
    e.nome, e.descricao, e.escopo, JSON.stringify(e.permissoes), agoraIso(), id);
  return { antes, depois: lerCargo(banco, id) };
}

export function excluirCargo(banco: Banco, id: number): CargoDto {
  const c = lerCargo(banco, id);
  const todos = banco.get<{ n: number }>('SELECT COUNT(*) AS n FROM usuarios WHERE cargo_id = ?', id)!.n;
  if (todos > 0) throw conflito(`${todos} pessoa(s) ainda têm o cargo “${c.nome}”. Mude o cargo delas antes de excluir.`);
  banco.run('DELETE FROM cargos WHERE id = ?', id);
  return c;
}

export function duplicarCargo(banco: Banco, id: number): CargoDto {
  const c = lerCargo(banco, id);
  let nome = `${c.nome} (cópia)`;
  for (let i = 2; banco.get('SELECT 1 FROM cargos WHERE nome = ? COLLATE NOCASE', nome); i++) nome = `${c.nome} (cópia ${i})`;
  return criarCargo(banco, { nome, descricao: c.descricao, escopo: c.escopo, permissoes: c.permissoes });
}

// ------------------------------------------------------------------ lotacoes
export interface Lotacao { secretariaId: number; setorId: number | null }

export function lotacoesDe(banco: Banco, usuarioId: number): Lotacao[] {
  return banco.all<{ secretaria_id: number; setor_id: number | null }>(
    'SELECT secretaria_id, setor_id FROM usuario_lotacoes WHERE usuario_id = ? AND secretaria_id IS NOT NULL ORDER BY rowid', usuarioId,
  ).map((l) => ({ secretariaId: l.secretaria_id, setorId: l.setor_id }));
}

/** Confere as lotacoes contra o alcance do cargo e grava. Devolve a lotacao principal (a primeira). */
export function gravarLotacoes(banco: Banco, usuarioId: number, escopo: EscopoCargo, lotacoes: Lotacao[]): Lotacao | null {
  const unicas = new Map<string, Lotacao>();
  for (const l of lotacoes) {
    const setor = l.setorId ? banco.get<{ secretaria_id: number }>('SELECT secretaria_id FROM setores WHERE id = ?', l.setorId) : null;
    if (l.setorId && !setor) throw invalido('Setor não encontrado');
    const secretariaId = setor ? setor.secretaria_id : l.secretariaId;
    if (!banco.get('SELECT 1 FROM secretarias WHERE id = ?', secretariaId)) throw invalido('Secretaria não encontrada');
    const item = { secretariaId, setorId: escopo === 'SETOR' ? l.setorId ?? null : null };
    unicas.set(`${item.secretariaId}:${item.setorId ?? ''}`, item);
  }
  const lista = [...unicas.values()];
  if (escopo === 'SETOR' && !lista.some((l) => l.setorId)) throw invalido('Este cargo enxerga por setor: escolha pelo menos um setor');
  if (escopo === 'SECRETARIA' && !lista.length) throw invalido('Este cargo enxerga por secretaria: escolha pelo menos uma secretaria');
  banco.run('DELETE FROM usuario_lotacoes WHERE usuario_id = ?', usuarioId);
  for (const l of lista) banco.run('INSERT INTO usuario_lotacoes (usuario_id, secretaria_id, setor_id) VALUES (?,?,?)', usuarioId, l.secretariaId, l.setorId);
  return lista[0] ?? null;
}

// ------------------------------------------------------------------ sessao
export interface LinhaSessao { id: number; nome: string; email: string; papel: Papel; secretaria_id: number | null; setor_id: number | null; deve_trocar_senha?: number; cargo_id?: number | null }

export function montarSessao(banco: Banco | undefined, u: LinhaSessao): UsuarioSessao {
  const base = { id: u.id, nome: u.nome, email: u.email, papel: u.papel, secretariaId: u.secretaria_id, setorId: u.setor_id, deveTrocarSenha: u.deve_trocar_senha === 1 };
  if (u.papel === 'CIDADAO') return { ...base, permissoes: [], cargoId: null, cargo: 'Cidadão', escopo: 'PROPRIO', secretariaIds: [], setorIds: [] };
  const cargo = banco && u.cargo_id ? banco.get<LinhaCargo>('SELECT * FROM cargos WHERE id = ?', u.cargo_id) : undefined;
  if (!banco || !cargo) {
    // sem cargo (nao deveria acontecer depois da migracao): perfil original como reserva
    const lot = { secretariaIds: u.secretaria_id ? [u.secretaria_id] : [], setorIds: u.setor_id ? [u.setor_id] : [] };
    return { ...base, permissoes: [...PERMISSOES[u.papel]], cargoId: null, cargo: NOME_INICIAL[u.papel as Exclude<Papel, 'CIDADAO'>]?.[0] ?? u.papel, escopo: ESCOPO_PAPEL[u.papel], ...lot };
  }
  const lot = lotacoesDe(banco, u.id);
  return {
    ...base,
    permissoes: limpar(JSON.parse(cargo.permissoes)),
    cargoId: cargo.id, cargo: cargo.nome, escopo: cargo.escopo,
    secretariaIds: [...new Set(lot.map((l) => l.secretariaId))],
    setorIds: [...new Set(lot.map((l) => l.setorId).filter((x): x is number => x !== null))],
  };
}

/** Existe alguem ativo que pode administrar a equipe? (senao, o sistema pede o primeiro acesso) */
export function haAdministrador(banco: Banco): boolean {
  return administradores(banco, {}) > 0;
}

/** Cargo para o primeiro administrador: o "Administração (SAD)" original ou outro com a permissao; cria se nao houver. */
export function cargoAdministrador(banco: Banco): number {
  const original = banco.get<{ id: number }>("SELECT id FROM cargos WHERE codigo = 'ADMIN_SAD'");
  if (original && lerCargo(banco, original.id).permissoes.includes(PERMISSAO_ADMIN)) return original.id;
  const outro = listarCargos(banco).find((c) => c.permissoes.includes(PERMISSAO_ADMIN) && c.escopo === 'MUNICIPIO');
  if (outro) return outro.id;
  let nome = 'Administração do sistema';
  for (let i = 2; banco.get('SELECT 1 FROM cargos WHERE nome = ? COLLATE NOCASE', nome); i++) nome = `Administração do sistema ${i}`;
  return criarCargo(banco, { nome, descricao: 'Criado no primeiro acesso.', escopo: 'MUNICIPIO', permissoes: [...PERMISSOES.ADMIN_SAD] }).id;
}
