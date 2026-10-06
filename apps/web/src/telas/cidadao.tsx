/**
 * Telas do cidadao.
 *
 * Este arquivo concentra as telas em vez de uma por arquivo porque sao quatro e
 * compartilham os mesmos estados (carregando, vazio, erro, sessao expirada).
 * Quando o fluxo crescer, quebrar por arquivo e' o certo; agora seria quatro
 * arquivos de vinte linhas cada.
 *
 * A regra que atravessa todas as telas: a interface NAO decide permissao. Ela
 * mostra o que a API devolveu e esconde o que a API nao devolveu. Esconder por
 * CSS nao e protecao, e nenhuma tela aqui tenta.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiUpload, ErroApi, IDEMPOTENCY_HEADER } from '../api/cliente';
import { useSessao } from '../api/sessao';
import type {
  Catalogo,
  CatalogoSecretariat,
  CatalogoServico,
  DetalheCidadao,
  Pagina,
  PedidoCidadao,
} from '../api/tipos';
import { Estado, Aviso } from './comuns';
import { MensagensPedido } from './mensagens';
import { AvaliacaoSatisfacao } from './avaliacao';
import { AnexosPedido } from './anexos';
import { LandingPage } from './landing';
import { ResumoSla } from './sla';
import {
  carregarRascunho,
  limparRascunho,
  salvarRascunho,
  type RascunhoSolicitacao,
} from '../rascunhos';

/* ---------------------------------------------------------------- entrada */

export function TelaEntrada({ destino }: { readonly destino: string }) {
  return <LandingPage destino={destino} />;
}

/* ------------------------------------------------------------- lista do cidadao */

export function MinhasSolicitacoes() {
  const { fase } = useSessao();
  const [pagina, definirPagina] = useState<Pagina<PedidoCidadao> | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [busca, definirBusca] = useState('');
  const [filtroEstado, definirFiltroEstado] = useState('');
  const [rascunho, definirRascunho] = useState<RascunhoSolicitacao | null>(null);

  useEffect(() => {
    let ativo = true;
    const carregar = () => {
      apiGet<Pagina<PedidoCidadao>>('/api/v1/requests/mine')
        .then((dados) => {
          if (ativo) definirPagina(dados);
        })
        .catch((e: unknown) => {
          if (!ativo) return;
          definirErro(
            e instanceof ErroApi ? e.message : 'Nao foi possivel carregar suas solicitacoes.',
          );
        });
    };
    carregar();
    const intervalo = window.setInterval(carregar, 60_000);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, [fase]);

  useEffect(() => {
    definirRascunho(carregarRascunho());
  }, []);

  if (erro !== null) return <Aviso tipo="erro">{erro}</Aviso>;
  if (pagina === null) return <Estado titulo="Carregando suas solicitacoes" />;
  const pedidos = pagina.items;
  const emAndamento = pedidos.filter((pedido) => !['COMPLETED', 'CANCELED'].includes(pedido.state)).length;
  const aguardando = pedidos.filter((pedido) => pedido.state === 'WAITING_CITIZEN').length;
  const concluidos = pedidos.filter((pedido) => pedido.state === 'COMPLETED').length;
  const termoBusca = busca.trim().toLocaleLowerCase();
  const pedidosVisiveis = pedidos.filter((pedido) => {
    const correspondeEstado =
      filtroEstado === '' ||
      (filtroEstado === 'ACTIVE'
        ? !['COMPLETED', 'CANCELED'].includes(pedido.state)
        : pedido.state === filtroEstado);
    const correspondeBusca =
      termoBusca === '' ||
      pedido.protocol.toLocaleLowerCase().includes(termoBusca) ||
      pedido.serviceName.toLocaleLowerCase().includes(termoBusca) ||
      pedido.secretariatName.toLocaleLowerCase().includes(termoBusca);
    return correspondeEstado && correspondeBusca;
  });

  return (
    <section className="cidadao-home" aria-labelledby="titulo-lista">
      <div className="pagina-cabecalho cidadao-pagina-cabecalho">
        <div>
          <span className="sobretitulo">Portal do cidadao</span>
          <h2 id="titulo-lista">Acompanhe tudo em um so lugar</h2>
          <p className="dica">Consulte seus protocolos, veja os prazos e participe de cada etapa do atendimento.</p>
        </div>
        <a className="botao cidadao-botao-principal" href="#/nova">
          + Abrir solicitacao
        </a>
      </div>

      {rascunho !== null && (
        <article className="cidadao-rascunho" aria-label="Rascunho de solicitacao">
          <span className="cidadao-rascunho-icone" aria-hidden="true">✎</span>
          <div>
            <span className="sobretitulo">Rascunho salvo nesta aba</span>
            <strong>{rascunho.servicoNome}</strong>
            <small>Atualizado em {formatarDataHora(rascunho.atualizadoEm)} · fotos precisam ser selecionadas novamente.</small>
          </div>
          <a className="botao secundario" href="#/nova">Continuar rascunho</a>
        </article>
      )}

      <div className="cidadao-resumo-grid" aria-label="Resumo das solicitacoes">
        <article className="cidadao-resumo-card cidadao-resumo-card-destaque">
          <span className="cidadao-resumo-icone" aria-hidden="true">◌</span>
          <div><span>Total de pedidos</span><strong>{pagina.total}</strong><small>protocolos registrados</small></div>
        </article>
        <article className="cidadao-resumo-card">
          <span className="cidadao-resumo-icone" aria-hidden="true">↗</span>
          <div><span>Em andamento</span><strong>{emAndamento}</strong><small>em acompanhamento</small></div>
        </article>
        <article className="cidadao-resumo-card">
          <span className="cidadao-resumo-icone" aria-hidden="true">!</span>
          <div><span>Aguardando voce</span><strong>{aguardando}</strong><small>respostas necessarias</small></div>
        </article>
        <article className="cidadao-resumo-card">
          <span className="cidadao-resumo-icone" aria-hidden="true">✓</span>
          <div><span>Concluidos</span><strong>{concluidos}</strong><small>atendimentos encerrados</small></div>
        </article>
      </div>

      <div className="cidadao-home-grid">
        <section className="cartao cidadao-lista-cartao" aria-labelledby="titulo-pedidos">
          <div className="cidadao-secao-cabecalho">
            <div><span className="sobretitulo">Historico pessoal</span><h3 id="titulo-pedidos">Minhas solicitacoes</h3></div>
            <span className="cidadao-contador">{pedidosVisiveis.length} de {pagina.total}</span>
          </div>
          {pedidos.length === 0 ? (
            <div className="cidadao-estado-vazio">
              <span className="cidadao-estado-icone" aria-hidden="true">✦</span>
              <strong>Comece pelo que precisa</strong>
              <p>Abra sua primeira solicitacao e acompanhe o atendimento por aqui.</p>
              <a className="botao" href="#/nova">Conhecer servicos</a>
            </div>
          ) : pedidosVisiveis.length === 0 ? (
            <div className="cidadao-estado-vazio cidadao-estado-vazio-pequeno">
              <span className="cidadao-estado-icone" aria-hidden="true">⌕</span>
              <strong>Nenhum pedido corresponde ao filtro</strong>
              <p>Tente outro termo ou limpe os filtros para ver seu historico completo.</p>
              <button className="secundario" type="button" onClick={() => { definirBusca(''); definirFiltroEstado(''); }}>
                Limpar filtros
              </button>
            </div>
          ) : (
            <ul className="cidadao-pedidos-lista">
              {pedidosVisiveis.map((p) => (
                <li key={p.id} className="cidadao-pedido-card">
                  <div className="cidadao-pedido-cabecalho">
                    <div>
                      <span className="cidadao-protocolo">{p.protocol}</span>
                      <a href={`#/pedido/${p.id}`}><strong>{p.serviceName}</strong></a>
                      <p>{p.secretariatName} · aberto em {formatarData(p.createdAt)}</p>
                    </div>
                    <span className={`etiqueta ${classeEstado(p.state)}`}>{p.stateText}</span>
                  </div>
                  <div className="cidadao-pedido-rodape">
                    <ResumoSla sla={p.sla} />
                    <a className="link-pequeno" href={`#/pedido/${p.id}`}>Ver detalhes →</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {pedidos.length > 0 && (
            <div className="cidadao-filtros" aria-label="Filtrar solicitacoes">
              <label>
                <span className="sr-only">Buscar por protocolo ou servico</span>
                <input
                  type="search"
                  value={busca}
                  onChange={(event) => definirBusca(event.target.value)}
                  placeholder="Buscar protocolo ou servico"
                />
              </label>
              <label>
                <span className="sr-only">Filtrar por estado</span>
                <select value={filtroEstado} onChange={(event) => definirFiltroEstado(event.target.value)}>
                  <option value="">Todos os estados</option>
                  <option value="ACTIVE">Em andamento</option>
                  <option value="WAITING_CITIZEN">Aguardando voce</option>
                  <option value="COMPLETED">Concluidos</option>
                  <option value="CANCELED">Cancelados</option>
                </select>
              </label>
            </div>
          )}
        </section>

        <aside className="cartao cidadao-proximos-passos" aria-labelledby="titulo-proximos-passos">
          <span className="sobretitulo">Como funciona</span>
          <h3 id="titulo-proximos-passos">Seu atendimento, passo a passo</h3>
          <ol className="cidadao-checklist">
            <li><span>01</span><div><strong>Escolha um servico</strong><small>Encontre a secretaria certa para sua necessidade.</small></div></li>
            <li><span>02</span><div><strong>Explique a situacao</strong><small>Inclua local, detalhes e o que precisa ser feito.</small></div></li>
            <li><span>03</span><div><strong>Acompanhe a equipe</strong><small>Responda mensagens e consulte o prazo em tempo real.</small></div></li>
          </ol>
          <a className="link-destaque" href="#/nova">Ver catalogo de servicos →</a>
        </aside>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- abertura */

type Passo = 'servico' | 'unidade' | 'descricao' | 'revisao';

const PASSOS: readonly { readonly id: Passo; readonly rotulo: string }[] = [
  { id: 'servico', rotulo: '1. Servico' },
  { id: 'unidade', rotulo: '2. Unidade' },
  { id: 'descricao', rotulo: '3. Detalhes' },
  { id: 'revisao', rotulo: '4. Revisao' },
];

interface Escolha {
  readonly secretaria: CatalogoSecretariat;
  readonly servico: CatalogoServico;
  readonly descricao: string;
  readonly chaveIdempotencia: string;
}

interface ResultadoSolicitacao {
  readonly protocol: string;
  readonly requestId: string;
  readonly fotosEnviadas: number;
  readonly totalFotos: number;
  readonly erroAnexos: string | null;
}

const MAXIMO_FOTOS_POR_SOLICITACAO = 5;
const MAXIMO_BYTES_POR_FOTO = 10 * 1024 * 1024;

export function NovaSolicitacao() {
  const [catalogo, definirCatalogo] = useState<Catalogo | null>(null);
  const [passo, definirPasso] = useState<Passo>('servico');
  const [escolha, definirEscolha] = useState<Escolha | null>(null);
  const [fotos, definirFotos] = useState<readonly File[]>([]);
  const [enviando, definirEnviando] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  const [pedidoCriado, definirPedidoCriado] = useState<ResultadoSolicitacao | null>(null);
  const [rascunhoSalvo, definirRascunhoSalvo] = useState<RascunhoSolicitacao | null>(null);

  useEffect(() => {
    apiGet<Catalogo>('/api/v1/catalog')
      .then(definirCatalogo)
      .catch((e: unknown) => {
        definirErro(
          e instanceof ErroApi ? e.message : 'Nao foi possivel carregar o catalogo de servicos.',
        );
      });
  }, []);

  useEffect(() => {
    definirRascunhoSalvo(carregarRascunho());
  }, []);

  useEffect(() => {
    if (escolha === null || pedidoCriado !== null) return;
    salvarRascunho({
      secretariaId: escolha.secretaria.id,
      secretariaNome: escolha.secretaria.name,
      servicoId: escolha.servico.id,
      servicoNome: escolha.servico.name,
      descricao: escolha.descricao,
      atualizadoEm: new Date().toISOString(),
    });
  }, [escolha, pedidoCriado]);

  /**
   * A chave de idempotencia nasce com a tela e muda quando a escolha muda.
   *
   * E' o que faz "repetir o envio por falha de rede" nao virar dois pedidos.
   * Uma chave nova a cada clique faria cada tentativa contar como operacao
   * nova, que e exatamente o problema que a chave existe para evitar.
   */
  const recomecar = useCallback(() => {
    definirEscolha(null);
    definirFotos([]);
    definirPasso('servico');
    definirPedidoCriado(null);
    definirRascunhoSalvo(null);
    limparRascunho();
    definirErro(null);
  }, []);

  if (pedidoCriado !== null) {
    return (
      <section className="cartao cidadao-solicitacao-ok" aria-labelledby="titulo-ok">
        <span className="sobretitulo">Tudo certo</span>
        <h2 id="titulo-ok">Solicitacao registrada</h2>
        <p>Guarde o numero de protocolo. Ele serve para qualquer contato com a prefeitura.</p>
        <p>
          <strong className="cidadao-protocolo-destaque">{pedidoCriado.protocol}</strong>
        </p>
        {pedidoCriado.erroAnexos !== null ? (
          <Aviso tipo="atencao">
            A solicitacao foi criada, mas {pedidoCriado.fotosEnviadas} de {pedidoCriado.totalFotos}{' '}
            {pedidoCriado.totalFotos === 1 ? 'foto nao foi enviada' : 'fotos nao foram enviadas'}.
            {' '}{pedidoCriado.erroAnexos}{' '}
            <a href={`#/pedido/${pedidoCriado.requestId}`}>Abra o protocolo para tentar novamente.</a>
          </Aviso>
        ) : (
          <p className="dica">
            {pedidoCriado.totalFotos === 0
              ? 'Voce pode acompanhar o andamento em Minhas solicitacoes.'
              : `${pedidoCriado.fotosEnviadas} ${pedidoCriado.fotosEnviadas === 1 ? 'foto foi enviada' : 'fotos foram enviadas'} e sera verificada antes de ficar disponivel.`}
          </p>
        )}
        <p>
          <a className="botao" href={`#/pedido/${pedidoCriado.requestId}`}>
            Acompanhar solicitacao
          </a>
        </p>
        <button onClick={recomecar}>Abrir outra solicitacao</button>
      </section>
    );
  }

  if (erro !== null && catalogo === null) return <Aviso tipo="erro">{erro}</Aviso>;
  if (catalogo === null) return <Estado titulo="Carregando o catalogo de servicos" />;
  const catalogoDisponivel = catalogo;

  if (catalogo.secretariats.length === 0) {
    return (
      <Aviso tipo="atencao">
        Nenhum servico esta disponivel no momento. Volte mais tarde ou procure a prefeitura pelo
        telefone.
      </Aviso>
    );
  }

  function continuarRascunho() {
    if (rascunhoSalvo === null) return;
    const secretaria = catalogoDisponivel.secretariats.find((item) => item.id === rascunhoSalvo.secretariaId);
    const servico = secretaria?.services.find((item) => item.id === rascunhoSalvo.servicoId);
    if (secretaria === undefined || servico === undefined) {
      definirErro('Este servico nao esta mais disponivel. O rascunho foi descartado.');
      definirRascunhoSalvo(null);
      limparRascunho();
      return;
    }
    definirEscolha({
      secretaria,
      servico,
      descricao: rascunhoSalvo.descricao,
      chaveIdempotencia: novaChave(),
    });
    definirFotos([]);
    definirPasso('descricao');
    definirRascunhoSalvo(null);
  }

  function descartarRascunho() {
    definirRascunhoSalvo(null);
    limparRascunho();
  }

  async function enviar() {
    if (escolha === null) return;
    definirEnviando(true);
    definirErro(null);
    try {
      const resposta = await apiPost<{ protocol: string; requestId: string }>(
        '/api/v1/requests',
        {
          serviceVersionId: escolha.servico.id,
          secretariatId: escolha.secretaria.id,
          unitId: escolha.servico.defaultUnitId,
          slaPolicyId: escolha.servico.sla.id,
          description: escolha.descricao,
        },
        { [IDEMPOTENCY_HEADER]: escolha.chaveIdempotencia },
      );
      limparRascunho();
      definirRascunhoSalvo(null);
      let fotosEnviadas = 0;
      let erroAnexos: string | null = null;
      for (const foto of fotos) {
        const formulario = new FormData();
        formulario.append('file', foto);
        try {
          await apiUpload(`/api/v1/requests/${resposta.requestId}/attachments`, formulario);
          fotosEnviadas += 1;
        } catch (error: unknown) {
          erroAnexos =
            error instanceof ErroApi
              ? error.message
              : 'Nao foi possivel enviar uma das fotos.';
          break;
        }
      }
      definirPedidoCriado({
        protocol: resposta.protocol,
        requestId: resposta.requestId,
        fotosEnviadas,
        totalFotos: fotos.length,
        erroAnexos,
      });
    } catch (e) {
      if (e instanceof ErroApi && e.semSessao) {
        definirErro('Sua sessao terminou. Entre novamente para enviar.');
      } else if (e instanceof ErroApi && e.codigo === 'IDEMPOTENCY_CONFLICT') {
        definirErro(
          'Este envio ja foi registrado antes com outro conteudo. Recarregue a pagina e comece de novo.',
        );
      } else {
        definirErro(
          e instanceof ErroApi
            ? `${e.message} (codigo ${e.identificadorCorrelacao})`
            : 'Nao foi possivel enviar. Voce pode tentar de novo com segurança.',
        );
      }
    } finally {
      definirEnviando(false);
    }
  }

  return (
    <section className="cartao cidadao-fluxo-cartao" aria-labelledby="titulo-nova">
      <div className="pagina-cabecalho cidadao-pagina-cabecalho">
        <div>
          <span className="sobretitulo">Nova solicitacao</span>
          <h2 id="titulo-nova">Conte o que a prefeitura pode resolver</h2>
          <p className="dica">Escolha um servico, detalhe a situacao e acompanhe tudo pelo protocolo.</p>
        </div>
        <span className="cidadao-fluxo-selo">Seguro e simples</span>
      </div>
      {rascunhoSalvo !== null && (
        <Aviso tipo="info">
          Encontramos um rascunho de <strong>{rascunhoSalvo.servicoNome}</strong>, atualizado em{' '}
          {formatarDataHora(rascunhoSalvo.atualizadoEm)}. Fotos precisam ser selecionadas novamente.
          <div className="linha cidadao-rascunho-acoes">
            <button type="button" onClick={continuarRascunho}>Continuar rascunho</button>
            <button type="button" className="secundario" onClick={descartarRascunho}>Descartar</button>
          </div>
        </Aviso>
      )}
      <ol className="passos">
        {PASSOS.map((p) => (
          <li key={p.id} aria-current={passo === p.id ? 'step' : undefined}>
            {p.rotulo}
          </li>
        ))}
      </ol>

      {erro !== null && <Aviso tipo="erro">{erro}</Aviso>}

      {passo === 'servico' && (
        <fieldset>
          <legend className="rotulo">Para qual secretaria e servico?</legend>
          {catalogo.secretariats.map((secretaria) => (
            <div key={secretaria.id} className="cidadao-secretaria-bloco">
              <div className="cidadao-secretaria-titulo">
                <span className="cidadao-secretaria-icone" aria-hidden="true">⌂</span>
                <h3>{secretaria.name}</h3>
              </div>
              {secretaria.services.length === 0 && (
                <p className="dica">Nenhum servico publicado.</p>
              )}
              {secretaria.services.map((servico) => (
                <div key={servico.id} className="cidadao-servico-card">
                  <div className="cidadao-servico-card-topo">
                    <span className="cidadao-servico-icone" aria-hidden="true">✦</span>
                    <div><h4>{servico.name}</h4><span className="cidadao-servico-disponivel">Servico disponivel</span></div>
                  </div>
                  <p>{servico.description}</p>
                  <p className="dica">
                    Prazo de conclusao: {prazoEmTexto(servico)}.{' '}
                    {servico.sla.publishedCommitment
                      ? 'Prazo publicado pela prefeitura.'
                      : 'Prazo em estudo, ainda nao e compromisso oficial.'}
                    {servico.requiresRepresentation
                      ? ' Pedidos sobre menores passam por representacao legal.'
                      : ''}
                  </p>
                  <button
                    onClick={() => {
                      definirEscolha({
                        secretaria,
                        servico,
                        descricao: escolha?.descricao ?? '',
                        chaveIdempotencia: novaChave(),
                      });
                      definirFotos([]);
                      definirRascunhoSalvo(null);
                      definirPasso('descricao');
                    }}
                  >
                    Escolher este servico
                  </button>
                </div>
              ))}
            </div>
          ))}
        </fieldset>
      )}

      {passo === 'descricao' && escolha !== null && (
        <div>
          <p className="dica">{escolha.servico.guidance}</p>
          <label className="rotulo" htmlFor="descricao">
            Conte o que voce precisa
          </label>
          <textarea
            id="descricao"
            value={escolha.descricao}
            aria-describedby="dica-descricao"
            onChange={(e) => definirEscolha({ ...escolha, descricao: e.target.value })}
          />
          <p className="dica" id="dica-descricao">
            Quanto mais claro o local e o problema, mais rapido o atendimento.
          </p>
          {escolha.servico.maxAttachments > 0 && (
            <div className="cidadao-fotos-campo">
              <label className="rotulo" htmlFor="fotos-solicitacao">
                Fotos da situacao <span className="dica-inline">(opcional)</span>
              </label>
              <p className="dica" id="dica-fotos-solicitacao">
                Envie ate {Math.min(escolha.servico.maxAttachments, MAXIMO_FOTOS_POR_SOLICITACAO)} fotos JPG ou PNG, com no maximo 10 MB cada.
              </p>
              <input
                id="fotos-solicitacao"
                type="file"
                accept="image/jpeg,image/png"
                multiple
                aria-describedby="dica-fotos-solicitacao"
                onChange={(event) => {
                  const limite = Math.min(
                    escolha.servico.maxAttachments,
                    MAXIMO_FOTOS_POR_SOLICITACAO,
                  );
                  const selecionadas = Array.from(event.target.files ?? []);
                  if (selecionadas.length > limite) {
                    definirErro(`Escolha no maximo ${limite} fotos para este servico.`);
                    definirFotos([]);
                    return;
                  }
                  const fotoInvalida = selecionadas.find(
                    (foto) =>
                      !['image/jpeg', 'image/png'].includes(foto.type) ||
                      foto.size > MAXIMO_BYTES_POR_FOTO,
                  );
                  if (fotoInvalida !== undefined) {
                    definirErro('Cada foto precisa ser JPG ou PNG e ter no maximo 10 MB.');
                    definirFotos([]);
                    return;
                  }
                  definirErro(null);
                  definirFotos(selecionadas);
                }}
              />
              {fotos.length > 0 && (
                <ul className="cidadao-fotos-lista" aria-label="Fotos selecionadas">
                  {fotos.map((foto, indice) => (
                    <li key={`${foto.name}-${foto.lastModified}-${indice}`}>
                      <span>{foto.name}</span>
                      <button
                        type="button"
                        className="botao-remover-foto"
                        aria-label={`Remover ${foto.name}`}
                        onClick={() => definirFotos(fotos.filter((_, i) => i !== indice))}
                      >
                        Remover
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="linha">
            <button
              className="secundario"
              onClick={() => {
                definirPasso('servico');
                definirEscolha(null);
              }}
            >
              Trocar de servico
            </button>
            <button
              disabled={escolha.descricao.trim().length < 10}
              onClick={() => definirPasso('revisao')}
            >
              Revisar
            </button>
          </div>
          {escolha.descricao.trim().length < 10 && (
            <p className="dica">Descreva em pelo menos uma frase.</p>
          )}
        </div>
      )}

      {passo === 'revisao' && escolha !== null && (
        <div>
          <h3>Confira antes de enviar</h3>
          <dl>
            <dt style={{ fontWeight: 600 }}>Secretaria</dt>
            <dd>{escolha.secretaria.name}</dd>
            <dt style={{ fontWeight: 600 }}>Servico</dt>
            <dd>{escolha.servico.name}</dd>
            <dt style={{ fontWeight: 600 }}>Prazo</dt>
            <dd>{prazoEmTexto(escolha.servico)}</dd>
            <dt style={{ fontWeight: 600 }}>Sua descricao</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{escolha.descricao}</dd>
          </dl>
          {fotos.length > 0 && (
            <div className="cidadao-fotos-revisao">
              <strong>Fotos ({fotos.length})</strong>
              <ul className="cidadao-fotos-lista">
                {fotos.map((foto, indice) => (
                  <li key={`${foto.name}-${foto.lastModified}-${indice}`}>
                    <span>{foto.name}</span>
                    <span className="dica">{formatarTamanhoArquivo(foto.size)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Aviso tipo="atencao">
            Este prazo e'{' '}
            {escolha.servico.sla.publishedCommitment
              ? 'compromisso publicado pela prefeitura'
              : 'simulado e ainda nao constitui compromisso oficial'}
            .
          </Aviso>
          <div className="linha">
            <button className="secundario" onClick={() => definirPasso('descricao')}>
              Voltar
            </button>
            <button onClick={() => void enviar()} disabled={enviando}>
              {enviando ? 'Enviando...' : 'Enviar solicitacao'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- detalhe */

export function DetalhePedido({ id }: { readonly id: string }) {
  const [detalhe, definirDetalhe] = useState<DetalheCidadao | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [acaoProtocolo, definirAcaoProtocolo] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    const carregar = () => {
      apiGet<DetalheCidadao>(`/api/v1/requests/${id}`)
        .then((dados) => {
          if (ativo) definirDetalhe(dados);
        })
        .catch((e: unknown) => {
          if (!ativo) return;
          // 403 e 404 sao respostas DIFERENTES e recebem textos diferentes. "Nao
          // encontrado" para quem tem o pedido esconderia que existe um pedido
          // que nao e seu, e "sem permissao" para quem nao tem nada a ver
          // obrigaria a pessoa a achar que digitou o numero errado.
          if (e instanceof ErroApi && e.status === 403) {
            definirErro('Este pedido nao pertence a voce.');
          } else if (e instanceof ErroApi && e.status === 404) {
            definirErro('Pedido nao encontrado.');
          } else {
            definirErro(e instanceof ErroApi ? e.message : 'Nao foi possivel carregar o pedido.');
          }
        });
    };
    carregar();
    const intervalo = window.setInterval(carregar, 60_000);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, [id]);

  if (erro !== null) return <Aviso tipo="erro">{erro}</Aviso>;
  if (detalhe === null) return <Estado titulo="Carregando o pedido" />;
  const detalheAtual = detalhe;

  async function responderComplementacao() {
    const resposta = await apiPost<{ ok: boolean; error?: string }>(
      `/api/v1/requests/${id}/commands/PROVIDE_INFORMATION`,
      {
        expectedVersion: detalheAtual.version,
        publicText: 'O cidadao enviou a informacao solicitada pela equipe.',
      },
    );
    if (!resposta.ok) {
      throw new Error(resposta.error ?? 'Nao foi possivel registrar a resposta.');
    }
    definirDetalhe(await apiGet<DetalheCidadao>(`/api/v1/requests/${id}`));
  }

  async function copiarProtocolo() {
    if (detalhe === null || navigator.clipboard === undefined) {
      definirAcaoProtocolo('Copie o protocolo manualmente: ' + (detalhe?.protocol ?? 'indisponivel'));
      return;
    }
    try {
      await navigator.clipboard.writeText(detalhe.protocol);
      definirAcaoProtocolo('Protocolo copiado.');
    } catch {
      definirAcaoProtocolo('Nao foi possivel copiar automaticamente.');
    }
  }

  async function compartilharProtocolo() {
    if (detalhe === null) return;
    try {
      if (navigator.share !== undefined) {
        await navigator.share({
          title: `Solicitacao ${detalhe.protocol}`,
          text: `Acompanhe a solicitacao ${detalhe.protocol} na Prefeitura de Sertania.`,
          url: window.location.href,
        });
        definirAcaoProtocolo('Link de acompanhamento compartilhado.');
      } else if (navigator.clipboard !== undefined) {
        await navigator.clipboard.writeText(window.location.href);
        definirAcaoProtocolo('Link de acompanhamento copiado.');
      } else {
        definirAcaoProtocolo('Copie o endereco desta pagina para compartilhar.');
      }
    } catch {
      // Cancelar o dialogo nativo de compartilhamento nao e erro para a pessoa.
    }
  }

  return (
    <section className="cartao cidadao-detalhe" aria-labelledby="titulo-detalhe">
      <div className="pagina-cabecalho cidadao-pagina-cabecalho cidadao-detalhe-cabecalho">
        <div>
          <span className="sobretitulo">Acompanhamento do protocolo</span>
          <h2 id="titulo-detalhe">{detalhe.protocol}</h2>
          <p className="dica">{detalhe.serviceName} · {detalhe.secretariatName}</p>
        </div>
        <span className={`etiqueta ${classeEstado(detalhe.state)}`}>{detalhe.stateText}</span>
      </div>
      <div className="cidadao-detalhe-acoes" aria-label="Acoes do protocolo">
        <button type="button" className="secundario" onClick={() => void copiarProtocolo()}>Copiar protocolo</button>
        <button type="button" className="secundario" onClick={() => void compartilharProtocolo()}>Compartilhar</button>
        <button type="button" className="secundario" onClick={() => window.print()}>Imprimir comprovante</button>
      </div>
      {acaoProtocolo !== null && <p className="dica" role="status" aria-live="polite">{acaoProtocolo}</p>}
      <ResumoSla sla={detalhe.sla} detalhado />
      {detalhe.scheduledFor !== null && (
        <Aviso tipo="info">
          Atendimento {detalhe.scheduleIsEstimate ? 'previsto' : 'agendado'} para{' '}
          <strong>{formatarDataHora(detalhe.scheduledFor)}</strong>.
        </Aviso>
      )}
      {detalhe.requiresRepresentation && (
        <Aviso tipo="info">
          Este servico trata de menores. Se voce fala por outra pessoa, a prefeitura vai pedir a
          representacao legal.
        </Aviso>
      )}
      <div className="cidadao-detalhe-grid">
        <div className="cidadao-detalhe-bloco">
          <span className="sobretitulo">Resumo enviado</span>
          <h3>O que foi pedido</h3>
          <p className="cidadao-descricao" style={{ whiteSpace: 'pre-wrap' }}>{detalhe.description}</p>
        </div>
        <div className="cidadao-detalhe-bloco">
          <span className="sobretitulo">Historico do atendimento</span>
          <h3>Andamento</h3>
          <ul className="linha-do-tempo">
            {detalhe.timeline.map((evento) => (
              <li key={`${evento.at}-${evento.text}`}>
                <time dateTime={evento.at}>{formatarData(evento.at)}</time>
                <div>{evento.text}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {detalhe.outcomeText !== null && detalhe.outcomeText !== undefined && (
        <Aviso tipo="info">
          <strong>Resultado:</strong> {detalhe.outcomeText}
        </Aviso>
      )}
      <MensagensPedido
        requestId={id}
        serverView={false}
        {...(detalheAtual.state === 'WAITING_CITIZEN'
          ? { onCitizenMessageSent: responderComplementacao }
          : {})}
      />
      <AnexosPedido requestId={id} allowUpload />
      <AvaliacaoSatisfacao requestId={id} state={detalhe.state} />
      <p>
        <a href="#/minhas">Voltar para minhas solicitacoes</a>
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ apoio */

function classeEstado(estado: string): string {
  if (estado === 'COMPLETED' || estado === 'CANCELED') return 'etiqueta-fim';
  if (estado === 'WAITING_CITIZEN') return 'etiqueta-espera';
  return 'etiqueta-ativa';
}

export function prazoEmTexto(servico: CatalogoServico): string {
  const { resolutionValue, resolutionUnit, firstResponseMinutes } = servico.sla;
  const unidade =
    resolutionUnit === 'BUSINESS_DAYS'
      ? `${resolutionValue} dias uteis`
      : resolutionUnit === 'CALENDAR_DAYS'
        ? `${resolutionValue} dias`
        : `${resolutionValue} horas`;
  const horas = Math.round(firstResponseMinutes / 60);
  return `${unidade}, com primeira resposta humana em ${horas}h`;
}

function novaChave(): string {
  return crypto.randomUUID();
}

export function formatarData(iso: string): string {
  const data = new Date(iso);
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatarTamanhoArquivo(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatarDataHora(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return 'data indisponivel';
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
