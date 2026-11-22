import { useState } from 'react';
import { PAPEIS, PAPEL_TEXTO, PRIORIDADES, TIPOS_LOCALIDADE, type Catalogo, type Papel, type Prioridade, type TipoLocalidade } from '../../shared/dominio';
import { api, fmtData, post } from '../api';
import { useDados, useEstado } from '../nucleo';
import { Abas, Aviso, Carregando, Copiar } from '../componentes/comuns';

type Aba = 'usuarios' | 'catalogo' | 'localidades' | 'diagnostico' | 'auditoria' | 'dados' | 'integracao' | 'privacidade';

export function Admin() {
  const { pode } = useEstado();
  const abas = ([
    ['usuarios', 'Servidores e perfis', 'admin.usuarios'],
    ['catalogo', 'Serviços e prazos', 'admin.catalogo'],
    ['localidades', 'Localidades e feriados', 'admin.catalogo'],
    ['diagnostico', 'Diagnóstico (linha de base)', 'admin.diagnostico'],
    ['auditoria', 'Auditoria', 'auditoria.ver'],
    ['dados', 'Backup e exportação', 'admin.backup'],
    ['integracao', 'Integrações (API)', 'admin.integracao'],
    ['privacidade', 'Privacidade (LGPD)', 'admin.privacidade'],
  ] as const).filter(([, , p]) => pode(p)).map(([a, r]) => [a, r] as [Aba, string]);
  const [aba, setAba] = useState<Aba>(abas[0]?.[0] ?? 'auditoria');
  if (!abas.length) return <Aviso tipo="erro">Sem permissão.</Aviso>;
  return (
    <>
      <h1>Administração</h1>
      <Abas abas={abas} atual={aba} aoMudar={setAba} />
      {aba === 'usuarios' && <Usuarios />}
      {aba === 'catalogo' && <CatalogoAdmin />}
      {aba === 'localidades' && <Localidades />}
      {aba === 'diagnostico' && <Diagnostico />}
      {aba === 'auditoria' && <Auditoria />}
      {aba === 'dados' && <Dados />}
      {aba === 'integracao' && <Integracao />}
      {aba === 'privacidade' && <Privacidade />}
    </>
  );
}

interface Usuario { id: number; nome: string; email: string; telefone: string | null; papel: Papel; secretariaId: number | null; setorId: number | null; ativo: number; secretaria: string | null; setor: string | null }

function Usuarios() {
  const { catalogo } = useEstado();
  const { dados, recarregar } = useDados<Usuario[]>('/admin/usuarios');
  const vazio = { id: 0, nome: '', email: '', telefone: '', papel: 'ATENDENTE' as Papel, secretariaId: '', setorId: '', ativo: true, senha: '' };
  const [f, setF] = useState(vazio);
  const [msg, setMsg] = useState<{ t: 'ok' | 'erro'; m: string } | null>(null);
  if (!dados || !catalogo) return <Carregando />;
  const salvar = async () => {
    setMsg(null);
    const corpo = { nome: f.nome, email: f.email, telefone: f.telefone || null, papel: f.papel, secretariaId: f.secretariaId ? Number(f.secretariaId) : null, setorId: f.setorId ? Number(f.setorId) : null, ativo: f.ativo, senha: f.senha || undefined };
    try {
      if (f.id) await api('PUT', `/admin/usuarios/${f.id}`, corpo);
      else {
        const r = await post<{ senhaProvisoria: string | null }>('/admin/usuarios', corpo);
        if (r.senhaProvisoria) setMsg({ t: 'ok', m: `Servidor criado. Senha provisória: ${r.senhaProvisoria} (entregue por canal seguro).` });
      }
      if (f.id) setMsg({ t: 'ok', m: 'Alterações salvas. Sessões ativas do servidor foram encerradas se o perfil mudou.' });
      setF(vazio);
      recarregar();
    } catch (e) {
      setMsg({ t: 'erro', m: (e as Error).message });
    }
  };
  return (
    <div className="grade g2" style={{ alignItems: 'start' }}>
      <div className="cartao rolagem-x">
        <h2>Servidores</h2>
        <table><thead><tr><th>Nome</th><th>Perfil</th><th>Lotação</th><th></th></tr></thead>
          <tbody>{dados.map((u) => (
            <tr key={u.id} style={{ opacity: u.ativo ? 1 : 0.5 }}>
              <td>{u.nome}<div className="pequeno mudo">{u.email}</div></td><td className="pequeno">{PAPEL_TEXTO[u.papel]}</td><td className="pequeno">{[u.secretaria, u.setor].filter(Boolean).join(' / ') || '—'}</td>
              <td><button className="botao sec peq" onClick={() => setF({ id: u.id, nome: u.nome, email: u.email, telefone: u.telefone ?? '', papel: u.papel, secretariaId: String(u.secretariaId ?? ''), setorId: String(u.setorId ?? ''), ativo: !!u.ativo, senha: '' })}>Editar</button></td>
            </tr>
          ))}</tbody></table>
      </div>
      <div className="cartao">
        <h2>{f.id ? 'Editar servidor' : 'Novo servidor'}</h2>
        <div className="campo"><label htmlFor="u-n">Nome</label><input id="u-n" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
        <div className="campo"><label htmlFor="u-e">E-mail institucional</label><input id="u-e" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="campo"><label htmlFor="u-p">Perfil</label><select id="u-p" value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value as Papel })}>{PAPEIS.filter((p) => p !== 'CIDADAO').map((p) => <option key={p} value={p}>{PAPEL_TEXTO[p]}</option>)}</select></div>
        <div className="campo"><label htmlFor="u-s">Secretaria</label><select id="u-s" value={f.secretariaId} onChange={(e) => setF({ ...f, secretariaId: e.target.value, setorId: '' })}><option value="">—</option>{catalogo.secretarias.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></div>
        <div className="campo"><label htmlFor="u-st">Setor</label><select id="u-st" value={f.setorId} onChange={(e) => setF({ ...f, setorId: e.target.value })}><option value="">—</option>{catalogo.setores.filter((s) => !f.secretariaId || s.secretariaId === Number(f.secretariaId)).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></div>
        <div className="campo"><label htmlFor="u-pw">{f.id ? 'Nova senha (opcional)' : 'Senha inicial (vazio = gerar)'}</label><input id="u-pw" type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} autoComplete="new-password" /></div>
        <label className="check campo"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /><span>Ativo</span></label>
        <p className="ajuda">Equipe de campo e gestor de setor precisam de setor; gestor de secretaria precisa de secretaria. O perfil define o que a pessoa vê e faz — conferido também pela API.</p>
        {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
        <div className="linha"><button className="botao" onClick={() => void salvar()}>Salvar</button>{f.id > 0 && <button className="botao sec" onClick={() => setF(vazio)}>Novo</button>}</div>
      </div>
    </div>
  );
}

function CatalogoAdmin() {
  const { recarregarCatalogo } = useEstado();
  const { dados, recarregar } = useDados<Catalogo>('/admin/catalogo');
  const vazio = { id: 0, nome: '', setorId: '', descricao: '', palavrasChave: '', prazoDiasUteis: 5, prioridadePadrao: 'NORMAL' as Prioridade, ativo: true };
  const [f, setF] = useState(vazio);
  const [novoSetor, setNovoSetor] = useState({ nome: '', secretariaId: '' });
  const [novaSec, setNovaSec] = useState({ nome: '', sigla: '' });
  const [msg, setMsg] = useState<string | null>(null);
  if (!dados) return <Carregando />;
  const salvar = async () => {
    setMsg(null);
    const corpo = { ...f, setorId: Number(f.setorId), prazoDiasUteis: Number(f.prazoDiasUteis) };
    try {
      if (f.id) await api('PUT', `/admin/servicos/${f.id}`, corpo);
      else await post('/admin/servicos', corpo);
      setF(vazio);
      recarregar();
      recarregarCatalogo();
    } catch (e) { setMsg((e as Error).message); }
  };
  const setorNome = (id: number) => dados.setores.find((s) => s.id === id)?.nome;
  return (
    <div className="grade g2" style={{ alignItems: 'start' }}>
      <div className="cartao rolagem-x">
        <h2>Serviços</h2>
        <table><thead><tr><th>Serviço</th><th>Setor</th><th className="num">Prazo</th><th></th></tr></thead>
          <tbody>{dados.servicos.map((s) => (
            <tr key={s.id} style={{ opacity: s.ativo ? 1 : 0.5 }}><td>{s.nome}<div className="pequeno mudo">{s.palavrasChave}</div></td><td className="pequeno">{setorNome(s.setorId)}</td><td className="num">{s.prazoDiasUteis} d.u.</td>
              <td><button className="botao sec peq" onClick={() => setF({ id: s.id, nome: s.nome, setorId: String(s.setorId), descricao: s.descricao, palavrasChave: s.palavrasChave, prazoDiasUteis: s.prazoDiasUteis, prioridadePadrao: s.prioridadePadrao, ativo: s.ativo })}>Editar</button></td></tr>
          ))}</tbody></table>
      </div>
      <div className="coluna">
        <div className="cartao">
          <h2>{f.id ? 'Editar serviço' : 'Novo serviço'}</h2>
          <div className="campo"><label htmlFor="s-n">Nome (linguagem simples)</label><input id="s-n" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
          <div className="campo"><label htmlFor="s-st">Setor responsável</label><select id="s-st" value={f.setorId} onChange={(e) => setF({ ...f, setorId: e.target.value })}><option value="">Escolha…</option>{dados.secretarias.map((sc) => <optgroup key={sc.id} label={sc.nome}>{dados.setores.filter((s) => s.secretariaId === sc.id).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</optgroup>)}</select></div>
          <div className="campo"><label htmlFor="s-d">Descrição para o cidadão</label><textarea id="s-d" style={{ minHeight: 60 }} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
          <div className="campo"><label htmlFor="s-k">Palavras-chave (ajudam a IA a classificar)</label><input id="s-k" value={f.palavrasChave} onChange={(e) => setF({ ...f, palavrasChave: e.target.value })} /></div>
          <div className="grade g2">
            <div className="campo"><label htmlFor="s-p">Prazo (dias úteis)</label><input id="s-p" type="number" min={1} value={f.prazoDiasUteis} onChange={(e) => setF({ ...f, prazoDiasUteis: Number(e.target.value) })} /></div>
            <div className="campo"><label htmlFor="s-pr">Prioridade padrão</label><select id="s-pr" value={f.prioridadePadrao} onChange={(e) => setF({ ...f, prioridadePadrao: e.target.value as Prioridade })}>{PRIORIDADES.map((p) => <option key={p}>{p}</option>)}</select></div>
          </div>
          <label className="check campo"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /><span>Disponível para o cidadão</span></label>
          <p className="ajuda">Prazos de demonstração não são compromisso oficial; ajuste conforme o diagnóstico. Mudanças valem para novas solicitações.</p>
          {msg && <Aviso tipo="erro">{msg}</Aviso>}
          <div className="linha"><button className="botao" onClick={() => void salvar()}>Salvar</button>{f.id > 0 && <button className="botao sec" onClick={() => setF(vazio)}>Novo</button>}</div>
        </div>
        <div className="cartao">
          <h3>Nova secretaria</h3>
          <div className="linha"><input aria-label="Nome da secretaria" placeholder="Nome" value={novaSec.nome} onChange={(e) => setNovaSec({ ...novaSec, nome: e.target.value })} style={{ flex: 2 }} /><input aria-label="Sigla" placeholder="Sigla" value={novaSec.sigla} onChange={(e) => setNovaSec({ ...novaSec, sigla: e.target.value })} style={{ flex: 1 }} />
            <button className="botao sec" onClick={() => void post('/admin/secretarias', novaSec).then(() => { setNovaSec({ nome: '', sigla: '' }); recarregar(); recarregarCatalogo(); }).catch((e: Error) => setMsg(e.message))}>Adicionar</button></div>
          <h3 style={{ marginTop: 12 }}>Novo setor</h3>
          <div className="linha"><select aria-label="Secretaria do setor" value={novoSetor.secretariaId} onChange={(e) => setNovoSetor({ ...novoSetor, secretariaId: e.target.value })} style={{ flex: 1 }}><option value="">Secretaria…</option>{dados.secretarias.map((s) => <option key={s.id} value={s.id}>{s.sigla}</option>)}</select><input aria-label="Nome do setor" placeholder="Nome do setor" value={novoSetor.nome} onChange={(e) => setNovoSetor({ ...novoSetor, nome: e.target.value })} style={{ flex: 2 }} />
            <button className="botao sec" onClick={() => void post('/admin/setores', { nome: novoSetor.nome, secretariaId: Number(novoSetor.secretariaId) }).then(() => { setNovoSetor({ nome: '', secretariaId: '' }); recarregar(); recarregarCatalogo(); }).catch((e: Error) => setMsg(e.message))}>Adicionar</button></div>
        </div>
      </div>
    </div>
  );
}

function Localidades() {
  const { recarregarCatalogo } = useEstado();
  const { dados, recarregar } = useDados<Catalogo & { feriados: Array<{ data: string; nome: string }> }>('/admin/catalogo');
  const [f, setF] = useState({ id: 0, nome: '', tipo: 'COMUNIDADE_RURAL' as TipoLocalidade, lat: '', lng: '' });
  const [fer, setFer] = useState({ data: '', nome: '' });
  const [msg, setMsg] = useState<string | null>(null);
  if (!dados) return <Carregando />;
  const salvar = () => {
    const corpo = { nome: f.nome, tipo: f.tipo, lat: Number(f.lat), lng: Number(f.lng) };
    void (f.id ? api('PUT', `/admin/localidades/${f.id}`, corpo) : post('/admin/localidades', corpo)).then(() => { setF({ id: 0, nome: '', tipo: 'COMUNIDADE_RURAL', lat: '', lng: '' }); recarregar(); recarregarCatalogo(); }).catch((e: Error) => setMsg(e.message));
  };
  return (
    <div className="grade g2" style={{ alignItems: 'start' }}>
      <div className="cartao">
        <h2>Sede, distritos e comunidades</h2>
        <Aviso tipo="alerta">Coordenadas iniciais são aproximadas e as comunidades marcadas “(exemplo)” são fictícias. Substitua pelo cadastro oficial.</Aviso>
        <table><tbody>{dados.localidades.map((l) => <tr key={l.id}><td>{l.nome}<div className="pequeno mudo">{l.tipo} · {l.lat.toFixed(4)}, {l.lng.toFixed(4)}</div></td><td><button className="botao sec peq" onClick={() => setF({ id: l.id, nome: l.nome, tipo: l.tipo, lat: String(l.lat), lng: String(l.lng) })}>Editar</button></td></tr>)}</tbody></table>
        <h3 style={{ marginTop: 12 }}>{f.id ? 'Editar' : 'Nova'} localidade</h3>
        <div className="grade g2">
          <input aria-label="Nome" placeholder="Nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
          <select aria-label="Tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoLocalidade })}>{TIPOS_LOCALIDADE.map((t) => <option key={t}>{t}</option>)}</select>
          <input aria-label="Latitude" placeholder="Latitude (ex. -8.07)" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} inputMode="decimal" />
          <input aria-label="Longitude" placeholder="Longitude (ex. -37.26)" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} inputMode="decimal" />
        </div>
        {msg && <Aviso tipo="erro">{msg}</Aviso>}
        <button className="botao" style={{ marginTop: 8 }} onClick={salvar}>Salvar localidade</button>
      </div>
      <div className="cartao">
        <h2>Feriados (contagem de prazo)</h2>
        <p className="ajuda">Prazos contam dias úteis no fuso America/Recife. Inclua os feriados municipais de Sertânia.</p>
        <table><tbody>{dados.feriados.map((x) => <tr key={x.data}><td>{x.data.split('-').reverse().join('/')}</td><td>{x.nome}</td></tr>)}</tbody></table>
        <div className="linha" style={{ marginTop: 8 }}><input aria-label="Data" type="date" value={fer.data} onChange={(e) => setFer({ ...fer, data: e.target.value })} style={{ flex: 1 }} /><input aria-label="Nome do feriado" placeholder="Nome" value={fer.nome} onChange={(e) => setFer({ ...fer, nome: e.target.value })} style={{ flex: 2 }} />
          <button className="botao sec" onClick={() => void post('/admin/feriados', fer).then(() => { setFer({ data: '', nome: '' }); recarregar(); })}>Adicionar</button></div>
      </div>
    </div>
  );
}

const ITENS_DIAGNOSTICO = [
  'Quantidade de secretarias e setores participantes', 'Canais atuais de atendimento', 'Volume mensal de solicitações (por tipo)',
  'Tempo médio de encaminhamento atual', 'Tempo médio de atendimento atual', 'Servidores envolvidos no atendimento', 'Ferramentas utilizadas hoje',
  'Distribuição territorial das demandas', 'Indicadores já acompanhados pela gestão',
];
interface RegDiag { id: number; indicador: string; valor: string; unidade: string | null; periodo: string | null; fonte: string; observacao: string | null; validado: number; registrado_por_nome: string; criado_em: string }

function Diagnostico() {
  const { pode } = useEstado();
  const { dados, recarregar } = useDados<RegDiag[]>('/admin/diagnostico');
  const [f, setF] = useState({ indicador: ITENS_DIAGNOSTICO[0]!, valor: '', unidade: '', periodo: '', fonte: '', observacao: '' });
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="grade g2" style={{ alignItems: 'start' }}>
      <div className="cartao">
        <h2>Linha de base do Município</h2>
        <p className="sec">Registre aqui os dados reais levantados no diagnóstico (item 6 do desafio), com fonte. Um dado só vira referência oficial após validação por outra pessoa.</p>
        {!dados ? <Carregando /> : dados.length === 0 ? <Aviso>Nenhum dado de diagnóstico registrado ainda. Enquanto isso, nenhum número da plataforma deve ser apresentado como estimativa oficial.</Aviso> : (
          <table><thead><tr><th>Indicador</th><th>Valor</th><th>Fonte</th><th></th></tr></thead>
            <tbody>{dados.map((d) => <tr key={d.id}><td>{d.indicador}<div className="pequeno mudo">{d.periodo}</div></td><td>{d.valor} {d.unidade}</td><td className="pequeno">{d.fonte}<div className="mudo">{d.registrado_por_nome} · {fmtData(d.criado_em, false)}</div></td>
              <td>{d.validado ? <span className="etq">✓ validado</span> : pode('admin.diagnostico') ? <button className="botao sec peq" onClick={() => void post(`/admin/diagnostico/${d.id}/validar`).then(recarregar).catch((e: Error) => setMsg(e.message))}>Validar</button> : <span className="etq">pendente</span>}</td></tr>)}</tbody></table>
        )}
        {msg && <Aviso tipo="erro">{msg}</Aviso>}
      </div>
      {pode('admin.diagnostico') && (
        <div className="cartao">
          <h2>Registrar dado</h2>
          <div className="campo"><label htmlFor="d-i">Indicador</label><input id="d-i" list="itens-diag" value={f.indicador} onChange={(e) => setF({ ...f, indicador: e.target.value })} /><datalist id="itens-diag">{ITENS_DIAGNOSTICO.map((i) => <option key={i} value={i} />)}</datalist></div>
          <div className="grade g2">
            <div className="campo"><label htmlFor="d-v">Valor</label><input id="d-v" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></div>
            <div className="campo"><label htmlFor="d-u">Unidade</label><input id="d-u" value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value })} placeholder="dias, %, quantidade…" /></div>
          </div>
          <div className="campo"><label htmlFor="d-p">Período de referência</label><input id="d-p" value={f.periodo} onChange={(e) => setF({ ...f, periodo: e.target.value })} placeholder="ex. jan–jun/2026" /></div>
          <div className="campo"><label htmlFor="d-f">Fonte</label><input id="d-f" value={f.fonte} onChange={(e) => setF({ ...f, fonte: e.target.value })} placeholder="planilha, sistema, levantamento…" /></div>
          <div className="campo"><label htmlFor="d-o">Observação</label><textarea id="d-o" style={{ minHeight: 60 }} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} /></div>
          <button className="botao" onClick={() => void post('/admin/diagnostico', { ...f, unidade: f.unidade || undefined, periodo: f.periodo || undefined, observacao: f.observacao || undefined }).then(() => { setF({ ...f, valor: '', observacao: '' }); recarregar(); }).catch((e: Error) => setMsg(e.message))}>Registrar</button>
        </div>
      )}
    </div>
  );
}

interface RegAud { id: number; em: string; usuario: string | null; acao: string; entidade: string | null; entidadeId: string | null; detalhes: string; ip: string | null }

function Auditoria() {
  const [acao, setAcao] = useState('');
  const { dados } = useDados<{ cadeia: { integra: boolean; registros: number; quebraEm: number | null }; registros: RegAud[] }>(`/admin/auditoria?acao=${encodeURIComponent(acao)}`);
  if (!dados) return <Carregando />;
  return (
    <div className="cartao rolagem-x">
      {dados.cadeia.integra ? <Aviso tipo="ok">Cadeia de auditoria íntegra: {dados.cadeia.registros} registros encadeados por hash, nenhum alterado ou removido.</Aviso> : <Aviso tipo="erro">Cadeia de auditoria QUEBRADA no registro {dados.cadeia.quebraEm}. Houve alteração ou exclusão direta no banco.</Aviso>}
      <div className="filtros"><div><label htmlFor="a-f">Filtrar ação</label><input id="a-f" value={acao} onChange={(e) => setAcao(e.target.value)} placeholder="LOGIN, COMANDO, IA, EXPORT…" /></div></div>
      <table><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th><th>Detalhes</th></tr></thead>
        <tbody>{dados.registros.map((r) => <tr key={r.id}><td className="pequeno">{fmtData(r.em)}</td><td className="pequeno">{r.usuario}<div className="mudo">{r.ip}</div></td><td className="pequeno"><code>{r.acao}</code></td><td className="pequeno">{r.entidade} {r.entidadeId}</td><td className="pequeno" style={{ maxWidth: 360, wordBreak: 'break-word' }}>{r.detalhes !== '{}' ? r.detalhes : ''}</td></tr>)}</tbody></table>
    </div>
  );
}

function Dados() {
  const { dados, recarregar } = useDados<Array<{ arquivo: string; tamanho: number }>>('/admin/backups');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="grade g2" style={{ alignItems: 'start' }}>
      <div className="cartao">
        <h2>Backup</h2>
        <p className="sec">Cópia consistente do banco (feita automaticamente todo dia; os 30 últimos são mantidos). Para restaurar: parar a API e substituir <code>dados/sertania.db</code> pelo arquivo escolhido. Copie a pasta <code>dados/backups</code> para outro local regularmente.</p>
        <button className="botao" onClick={() => void post<{ arquivo: string }>('/admin/backups').then((r) => { setMsg(`Backup gerado: ${r.arquivo}`); recarregar(); })}>Gerar backup agora</button>
        {msg && <Aviso tipo="ok">{msg}</Aviso>}
        <table style={{ marginTop: 12 }}><tbody>{(dados ?? []).map((b) => <tr key={b.arquivo}><td className="pequeno">{b.arquivo}</td><td className="num pequeno">{(b.tamanho / 1024).toFixed(0)} KB</td></tr>)}</tbody></table>
      </div>
      <div className="cartao">
        <h2>Exportação completa (portabilidade)</h2>
        <p className="sec">Todos os dados em JSON aberto e documentado, para auditoria externa, migração ou outro fornecedor. Senhas e sessões não são exportadas.</p>
        <a className="botao sec" href="/api/admin/exportacao-completa">Baixar exportação completa</a>
      </div>
    </div>
  );
}

function Integracao() {
  const { dados, recarregar } = useDados<Array<{ id: number; nome: string; escopos: string; criadoEm: string; revogadoEm: string | null; ultimoUso: string | null }>>('/admin/tokens');
  const [f, setF] = useState({ nome: '', escopos: ['demandas:ler'] });
  const [novo, setNovo] = useState<string | null>(null);
  const alternar = (e: string) => setF({ ...f, escopos: f.escopos.includes(e) ? f.escopos.filter((x) => x !== e) : [...f.escopos, e] });
  return (
    <div className="grade g2" style={{ alignItems: 'start' }}>
      <div className="cartao">
        <h2>Tokens de integração</h2>
        <p className="sec">Para outros sistemas (ouvidoria, e-SIC, BI, sistemas estaduais) consumirem a API por padrões abertos. Integrações nunca recebem dados pessoais. <a href="#/api">Ver documentação OpenAPI</a>.</p>
        <table><tbody>{(dados ?? []).map((t) => <tr key={t.id} style={{ opacity: t.revogadoEm ? 0.5 : 1 }}><td>{t.nome}<div className="pequeno mudo">{t.escopos} · último uso {fmtData(t.ultimoUso)}</div></td><td>{!t.revogadoEm ? <button className="botao sec peq" onClick={() => void post(`/admin/tokens/${t.id}/revogar`).then(recarregar)}>Revogar</button> : 'revogado'}</td></tr>)}</tbody></table>
      </div>
      <div className="cartao">
        <h2>Novo token</h2>
        <div className="campo"><label htmlFor="t-n">Sistema</label><input id="t-n" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
        {['demandas:ler', 'demandas:criar', 'indicadores:ler'].map((e) => <label key={e} className="check"><input type="checkbox" checked={f.escopos.includes(e)} onChange={() => alternar(e)} /><span><code>{e}</code></span></label>)}
        <button className="botao" style={{ marginTop: 8 }} onClick={() => void post<{ token: string }>('/admin/tokens', f).then((r) => { setNovo(r.token); recarregar(); })}>Criar token</button>
        {novo && <Aviso tipo="ok">Guarde agora (não será mostrado de novo):<br /><code style={{ wordBreak: 'break-all' }}>{novo}</code> <Copiar texto={novo} /></Aviso>}
      </div>
    </div>
  );
}

function Privacidade() {
  const { dados, recarregar } = useDados<{ retencaoDias: number; limiarSupressao: number; iaProvedor: string; comDadosPessoais: number; anonimizadas: number; anonimas: number }>('/admin/privacidade');
  const [msg, setMsg] = useState<string | null>(null);
  if (!dados) return <Carregando />;
  return (
    <div className="grade g2" style={{ alignItems: 'start' }}>
      <div className="cartao">
        <h2>Tratamento de dados pessoais</h2>
        <ul className="sec">
          <li>Dados de contato só com consentimento; registro anônimo disponível.</li>
          <li>Campo e SAD veem contato minimizado; exportações gerenciais e integrações não levam dados pessoais.</li>
          <li>Retenção: dados pessoais removidos <strong>{dados.retencaoDias} dias</strong> após o encerramento (rotina diária).</li>
          <li>Dados abertos com supressão de grupos com menos de <strong>{dados.limiarSupressao}</strong> casos.</li>
          <li>IA: <strong>{dados.iaProvedor === 'claude' ? 'Claude API, com texto pseudonimizado antes do envio' : 'local, nenhum dado sai do servidor'}</strong>.</li>
          <li>Cidadão com conta exporta e exclui seus dados (LGPD art. 18).</li>
        </ul>
      </div>
      <div className="cartao">
        <h2>Situação atual</h2>
        <p>{dados.comDadosPessoais} solicitações com dados pessoais · {dados.anonimizadas} já anonimizadas · {dados.anonimas} registradas como anônimas.</p>
        <button className="botao sec" onClick={() => void post<{ anonimizadas: number }>('/admin/privacidade/anonimizar').then((r) => { setMsg(`${r.anonimizadas} solicitação(ões) anonimizadas.`); recarregar(); })}>Aplicar política de retenção agora</button>
        {msg && <Aviso tipo="ok">{msg}</Aviso>}
      </div>
    </div>
  );
}
