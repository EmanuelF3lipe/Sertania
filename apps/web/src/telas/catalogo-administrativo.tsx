import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiGet, apiPost, ErroApi } from '../api/cliente';
import { useSessao } from '../api/sessao';
import type { CatalogoAdmin, CatalogoAdminServico } from '../api/tipos';
import { Aviso, Estado } from './comuns';

type Classification = 'PUBLIC_APPROVED' | 'INTERNAL' | 'RESTRICTED_PERSONAL' | 'RESTRICTED_SENSITIVE';
type SlaUnit = 'BUSINESS_HOURS' | 'CALENDAR_HOURS' | 'BUSINESS_DAYS' | 'CALENDAR_DAYS';

interface FormularioServico {
  readonly id?: string;
  readonly secretariatId: string;
  readonly unitId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly guidance: string;
  readonly teamName: string;
  readonly classification: Classification;
  readonly requiresRepresentation: boolean;
  readonly maxAttachments: number;
  readonly firstResponseMinutes: number;
  readonly resolutionValue: number;
  readonly resolutionUnit: SlaUnit;
  readonly published: boolean;
  readonly active: boolean;
}

const CLASSIFICACOES: ReadonlyArray<{ readonly value: Classification; readonly label: string; readonly help: string }> = [
  { value: 'PUBLIC_APPROVED', label: 'Público aprovado', help: 'Pode ser tratado sem dados sensíveis.' },
  { value: 'INTERNAL', label: 'Interno', help: 'Uso operacional da prefeitura.' },
  { value: 'RESTRICTED_PERSONAL', label: 'Restrito pessoal', help: 'Contém dados pessoais e exige cuidado adicional.' },
  { value: 'RESTRICTED_SENSITIVE', label: 'Restrito sensível', help: 'Acesso limitado à equipe responsável.' },
];

const UNIDADES_PRAZO: ReadonlyArray<{ readonly value: SlaUnit; readonly label: string }> = [
  { value: 'BUSINESS_HOURS', label: 'horas úteis' },
  { value: 'CALENDAR_HOURS', label: 'horas corridas' },
  { value: 'BUSINESS_DAYS', label: 'dias úteis' },
  { value: 'CALENDAR_DAYS', label: 'dias corridos' },
];

const CLASSIFICACAO_TEXTO: Readonly<Record<string, string>> = Object.fromEntries(
  CLASSIFICACOES.map((item) => [item.value, item.label]),
);

export function CatalogoAdministrativo() {
  const { sessao } = useSessao();
  const [catalogo, definirCatalogo] = useState<CatalogoAdmin | null>(null);
  const [secretariatId, definirSecretariatId] = useState('');
  const [busca, definirBusca] = useState('');
  const [modal, definirModal] = useState<'servico' | 'unidade' | null>(null);
  const [formulario, definirFormulario] = useState<FormularioServico | null>(null);
  const [unidadeNome, definirUnidadeNome] = useState('');
  const [localidade, definirLocalidade] = useState('');
  const [mensagem, definirMensagem] = useState<string | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [salvando, definirSalvando] = useState(false);

  async function carregar() {
    definirErro(null);
    try {
      const resposta = await apiGet<CatalogoAdmin>('/api/v1/admin/catalog');
      definirCatalogo(resposta);
      definirSecretariatId((atual) => {
        if (atual !== '' && resposta.secretariats.some((item) => item.id === atual)) return atual;
        const contexto = sessao?.contexts.find((item) => item.isCurrent);
        return contexto !== undefined && resposta.secretariats.some((item) => item.id === contexto.secretariatId)
          ? contexto.secretariatId
          : resposta.secretariats[0]?.id ?? '';
      });
    } catch (reason: unknown) {
      definirErro(reason instanceof ErroApi ? reason.message : 'Não foi possível carregar o catálogo municipal.');
    }
  }

  useEffect(() => {
    void carregar();
    // O contexto é usado apenas para escolher a secretaria inicial; mudanças de contexto são feitas pelo cabeçalho.
  }, []);

  const secretaria = catalogo?.secretariats.find((item) => item.id === secretariatId);
  const servicos = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase();
    return (secretaria?.services ?? []).filter((service) => {
      if (termo === '') return true;
      const versao = service.version;
      return service.slug.toLocaleLowerCase().includes(termo) || versao?.name.toLocaleLowerCase().includes(termo) === true;
    });
  }, [busca, secretaria]);
  const totalServicos = catalogo?.secretariats.reduce((total, item) => total + item.services.length, 0) ?? 0;
  const totalUnidades = catalogo?.secretariats.reduce((total, item) => total + item.units.length, 0) ?? 0;
  const publicados = catalogo?.secretariats.reduce(
    (total, item) => total + item.services.filter((service) => service.version?.published === true).length,
    0,
  ) ?? 0;

  function novoServico() {
    const unidade = secretaria?.units[0];
    if (secretariatId === '' || unidade === undefined) {
      definirMensagem('Cadastre uma unidade antes de criar o primeiro serviço desta secretaria.');
      definirModal('unidade');
      return;
    }
    definirFormulario({
      secretariatId,
      unitId: unidade.id,
      slug: '',
      name: '',
      description: '',
      guidance: '',
      teamName: 'Atendimento municipal',
      classification: 'PUBLIC_APPROVED',
      requiresRepresentation: false,
      maxAttachments: 5,
      firstResponseMinutes: 480,
      resolutionValue: 5,
      resolutionUnit: 'BUSINESS_DAYS',
      published: true,
      active: true,
    });
    definirErro(null);
    definirMensagem(null);
    definirModal('servico');
  }

  function editarServico(service: CatalogoAdminServico) {
    const versao = service.version;
    if (versao === null) return;
    definirFormulario({
      id: service.id,
      secretariatId,
      unitId: service.defaultUnitId ?? secretaria?.units[0]?.id ?? '',
      slug: service.slug,
      name: versao.name,
      description: versao.description,
      guidance: versao.guidance,
      teamName: service.teams.find((team) => team.enabled)?.name ?? service.teams[0]?.name ?? 'Atendimento municipal',
      classification: versao.classification as Classification,
      requiresRepresentation: versao.requiresRepresentation,
      maxAttachments: versao.maxAttachments,
      firstResponseMinutes: versao.sla?.firstResponseMinutes ?? 480,
      resolutionValue: versao.sla?.resolutionValue ?? 5,
      resolutionUnit: (versao.sla?.resolutionUnit ?? 'BUSINESS_DAYS') as SlaUnit,
      published: versao.published,
      active: service.active,
    });
    definirErro(null);
    definirMensagem(null);
    definirModal('servico');
  }

  async function salvarServico(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formulario === null) return;
    definirSalvando(true);
    definirErro(null);
    definirMensagem(null);
    try {
      const { id, ...payload } = formulario;
      if (id === undefined) {
        await apiPost('/api/v1/admin/catalog/services', payload);
        definirMensagem('Serviço criado e pronto para publicação.');
      } else {
        await apiPost(`/api/v1/admin/catalog/services/${id}`, payload);
        definirMensagem('Serviço atualizado. Uma nova versão foi registrada sem alterar pedidos antigos.');
      }
      definirModal(null);
      definirFormulario(null);
      await carregar();
    } catch (reason: unknown) {
      definirErro(reason instanceof ErroApi ? reason.message : 'Não foi possível salvar o serviço.');
    } finally {
      definirSalvando(false);
    }
  }

  async function salvarUnidade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (secretariatId === '') return;
    definirSalvando(true);
    definirErro(null);
    try {
      await apiPost('/api/v1/admin/catalog/units', { secretariatId, name: unidadeNome, locality: localidade });
      definirUnidadeNome('');
      definirLocalidade('');
      definirModal(null);
      definirMensagem('Unidade cadastrada. Ela já está disponível no catálogo.');
      await carregar();
    } catch (reason: unknown) {
      definirErro(reason instanceof ErroApi ? reason.message : 'Não foi possível cadastrar a unidade.');
    } finally {
      definirSalvando(false);
    }
  }

  if (catalogo === null && erro === null) return <Estado titulo="Carregando catálogo municipal" />;

  return (
    <section className="catalogo-admin" aria-labelledby="titulo-catalogo-admin">
      <div className="pagina-cabecalho catalogo-admin-cabecalho">
        <div><span className="sobretitulo">Gestão municipal</span><h2 id="titulo-catalogo-admin">Catálogo de serviços</h2><p className="dica">Organize secretarias, unidades, equipes e serviços que o cidadão encontra no portal.</p></div>
        <div className="catalogo-admin-acoes"><button className="secundario" type="button" onClick={() => definirModal('unidade')}>+ Nova unidade</button><button type="button" onClick={novoServico}>+ Novo serviço</button></div>
      </div>
      {erro !== null && <Aviso tipo="erro">{erro}</Aviso>}
      {mensagem !== null && <Aviso tipo="info">{mensagem}</Aviso>}

      <div className="catalogo-resumo">
        <div><span className="sobretitulo">Secretarias no escopo</span><strong>{catalogo?.secretariats.length ?? 0}</strong><small>áreas organizadas</small></div>
        <div><span className="sobretitulo">Serviços cadastrados</span><strong>{totalServicos}</strong><small>{publicados} publicados para o cidadão</small></div>
        <div><span className="sobretitulo">Unidades de atendimento</span><strong>{totalUnidades}</strong><small>com equipes vinculadas</small></div>
      </div>

      <div className="catalogo-admin-layout">
        <aside className="catalogo-secretarias cartao" aria-label="Secretarias">
          <div className="catalogo-coluna-titulo"><div><span className="sobretitulo">Estrutura</span><h3>Secretarias</h3></div><span className="contador-pill">{catalogo?.secretariats.length ?? 0}</span></div>
          <div className="catalogo-secretarias-lista">
            {catalogo?.secretariats.map((item) => (
              <button className={item.id === secretariatId ? 'secretaria-item selecionada' : 'secretaria-item'} key={item.id} type="button" onClick={() => { definirSecretariatId(item.id); definirBusca(''); }}>
                <span className="secretaria-avatar">{item.name.charAt(0)}</span><span><strong>{item.name}</strong><small>{item.services.length} serviço(s) · {item.units.length} unidade(s)</small></span><span className="seta-secretaria">→</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="catalogo-servicos-area">
          <div className="catalogo-servicos-cabecalho">
            <div><span className="sobretitulo">Secretaria selecionada</span><h3>{secretaria?.name ?? 'Selecione uma secretaria'}</h3><p>{secretaria?.description}</p></div>
            <label className="campo-busca"><span className="sr-only">Buscar serviço</span><input type="search" value={busca} onChange={(event) => definirBusca(event.target.value)} placeholder="Buscar serviço..." /></label>
          </div>
          {secretaria !== undefined && <div className="unidades-resumo">{secretaria.units.map((unit) => <span key={unit.id}><b>{unit.name}</b>{unit.locality !== '' ? ` · ${unit.locality}` : ''}</span>)}</div>}
          {servicos.length === 0 ? <div className="estado-vazio"><strong>Nenhum serviço encontrado</strong><p>Crie um serviço ou ajuste sua busca.</p><button type="button" onClick={novoServico}>Cadastrar primeiro serviço</button></div> : (
            <div className="catalogo-servicos-grid">
              {servicos.map((service) => <CartaoServico key={service.id} service={service} onEdit={() => editarServico(service)} />)}
            </div>
          )}
        </div>
      </div>

      {modal === 'servico' && formulario !== null && (
        <div className="modal-fundo" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) definirModal(null); }}>
          <section className="modal-conteudo modal-grande" role="dialog" aria-modal="true" aria-labelledby="titulo-form-servico">
            <div className="modal-cabecalho"><div><span className="sobretitulo">{formulario.id === undefined ? 'Novo cadastro' : 'Nova versão'}</span><h3 id="titulo-form-servico">{formulario.id === undefined ? 'Publicar um serviço' : 'Editar serviço'}</h3></div><button className="modal-fechar" type="button" aria-label="Fechar" onClick={() => definirModal(null)}>×</button></div>
            <form className="formulario-catalogo" onSubmit={(event) => void salvarServico(event)}>
              <div className="formulario-grid formulario-grid-2"><label className="campo"><span className="rotulo">Secretaria</span><select value={formulario.secretariatId} onChange={(event) => definirFormulario({ ...formulario, secretariatId: event.target.value, unitId: catalogo?.secretariats.find((item) => item.id === event.target.value)?.units[0]?.id ?? '' })}>{catalogo?.secretariats.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="campo"><span className="rotulo">Unidade responsável</span><select value={formulario.unitId} onChange={(event) => definirFormulario({ ...formulario, unitId: event.target.value })}>{catalogo?.secretariats.find((item) => item.id === formulario.secretariatId)?.units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
              <div className="formulario-grid formulario-grid-2"><label className="campo"><span className="rotulo">Nome exibido ao cidadão</span><input value={formulario.name} onChange={(event) => definirFormulario({ ...formulario, name: event.target.value })} required maxLength={160} /></label><label className="campo"><span className="rotulo">Identificador técnico</span><input value={formulario.slug} onChange={(event) => definirFormulario({ ...formulario, slug: event.target.value })} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={120} placeholder="ex: poda-de-arvore" /></label></div>
              <label className="campo"><span className="rotulo">Descrição curta</span><textarea value={formulario.description} onChange={(event) => definirFormulario({ ...formulario, description: event.target.value })} required maxLength={2000} /></label>
              <label className="campo"><span className="rotulo">Orientação antes do envio</span><textarea value={formulario.guidance} onChange={(event) => definirFormulario({ ...formulario, guidance: event.target.value })} required maxLength={3000} /></label>
              <div className="formulario-grid formulario-grid-3"><label className="campo"><span className="rotulo">Equipe responsável</span><input value={formulario.teamName} onChange={(event) => definirFormulario({ ...formulario, teamName: event.target.value })} required maxLength={140} /></label><label className="campo"><span className="rotulo">Classificação</span><select value={formulario.classification} onChange={(event) => definirFormulario({ ...formulario, classification: event.target.value as Classification })}>{CLASSIFICACOES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="campo"><span className="rotulo">Máximo de anexos</span><input type="number" min={0} max={20} value={formulario.maxAttachments} onChange={(event) => definirFormulario({ ...formulario, maxAttachments: Number(event.target.value) })} /></label></div>
              <fieldset className="fieldset-catalogo"><legend>Prazo de atendimento</legend><div className="formulario-grid formulario-grid-3"><label className="campo"><span className="rotulo">Primeira resposta</span><input type="number" min={1} value={formulario.firstResponseMinutes} onChange={(event) => definirFormulario({ ...formulario, firstResponseMinutes: Number(event.target.value) })} required /></label><label className="campo"><span className="rotulo">Conclusão em</span><input type="number" min={1} value={formulario.resolutionValue} onChange={(event) => definirFormulario({ ...formulario, resolutionValue: Number(event.target.value) })} required /></label><label className="campo"><span className="rotulo">Unidade do prazo</span><select value={formulario.resolutionUnit} onChange={(event) => definirFormulario({ ...formulario, resolutionUnit: event.target.value as SlaUnit })}>{UNIDADES_PRAZO.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div></fieldset>
              <div className="opcoes-catalogo"><label><input type="checkbox" checked={formulario.published} onChange={(event) => definirFormulario({ ...formulario, published: event.target.checked })} /><span><strong>Disponível no portal</strong><small>O cidadão poderá encontrar e selecionar este serviço.</small></span></label><label><input type="checkbox" checked={formulario.requiresRepresentation} onChange={(event) => definirFormulario({ ...formulario, requiresRepresentation: event.target.checked })} /><span><strong>Exige representação</strong><small>Use para pedidos feitos em nome de menores ou terceiros.</small></span></label><label><input type="checkbox" checked={formulario.active} onChange={(event) => definirFormulario({ ...formulario, active: event.target.checked })} /><span><strong>Cadastro ativo</strong><small>Desative sem apagar o histórico de pedidos.</small></span></label></div>
              <div className="modal-acoes"><button className="secundario" type="button" onClick={() => definirModal(null)}>Cancelar</button><button type="submit" disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar serviço'}</button></div>
            </form>
          </section>
        </div>
      )}

      {modal === 'unidade' && (
        <div className="modal-fundo" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) definirModal(null); }}>
          <section className="modal-conteudo modal-pequeno" role="dialog" aria-modal="true" aria-labelledby="titulo-form-unidade"><div className="modal-cabecalho"><div><span className="sobretitulo">Estrutura</span><h3 id="titulo-form-unidade">Nova unidade</h3></div><button className="modal-fechar" type="button" aria-label="Fechar" onClick={() => definirModal(null)}>×</button></div><form onSubmit={(event) => void salvarUnidade(event)}><label className="campo"><span className="rotulo">Secretaria</span><select value={secretariatId} onChange={(event) => definirSecretariatId(event.target.value)}>{catalogo?.secretariats.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="campo"><span className="rotulo">Nome da unidade</span><input value={unidadeNome} onChange={(event) => definirUnidadeNome(event.target.value)} required maxLength={140} /></label><label className="campo"><span className="rotulo">Localidade</span><input value={localidade} onChange={(event) => definirLocalidade(event.target.value)} maxLength={120} placeholder="Ex.: Centro" /></label><div className="modal-acoes"><button className="secundario" type="button" onClick={() => definirModal(null)}>Cancelar</button><button type="submit" disabled={salvando}>{salvando ? 'Salvando...' : 'Cadastrar unidade'}</button></div></form></section>
        </div>
      )}
    </section>
  );
}

function CartaoServico({ service, onEdit }: { readonly service: CatalogoAdminServico; readonly onEdit: () => void }) {
  const version = service.version;
  if (version === null) return null;
  const prazo = version.sla === null ? 'Prazo não configurado' : `${version.sla.resolutionValue} ${UNIDADES_PRAZO.find((item) => item.value === version.sla?.resolutionUnit)?.label ?? version.sla.resolutionUnit}`;
  return <article className={`cartao cartao-servico-admin${service.active ? '' : ' inativo'}`}><div className="cartao-servico-topo"><span className="icone-servico-admin" aria-hidden="true">✦</span><div><span className={version.published ? 'status-servico publicado' : 'status-servico rascunho'}>{version.published ? 'Publicado' : 'Rascunho'}</span><span className={service.active ? 'status-servico ativo' : 'status-servico inativo'}>{service.active ? 'Ativo' : 'Desativado'}</span></div><button className="botao-icone" type="button" aria-label={`Editar ${version.name}`} onClick={onEdit}>⋯</button></div><h4>{version.name}</h4><p>{version.description}</p><div className="cartao-servico-meta"><span><b>Prazo</b>{prazo}</span><span><b>Classificação</b>{CLASSIFICACAO_TEXTO[version.classification] ?? version.classification}</span><span><b>Versão</b>v{version.number}</span></div><div className="cartao-servico-rodape"><span>{service.slug}</span><button className="link-pequeno" type="button" onClick={onEdit}>Editar versão →</button></div></article>;
}
