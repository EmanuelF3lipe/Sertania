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
import { apiGet, apiPost, ErroApi, IDEMPOTENCY_HEADER } from '../api/cliente';
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

/* ---------------------------------------------------------------- entrada */

export function TelaEntrada({ destino }: { readonly destino: string }) {
  return (
    <main className="conteudo" id="conteudo">
      <h1>Servicos da Prefeitura de Sertania</h1>
      <p className="dica">
        Escolha como voce quer entrar. As duas entradas levam a lugares diferentes, e
        escolher uma delas nao da acesso a outra.
      </p>
      <div className="grade-duas">
        <section className="cartao" aria-labelledby="titulo-cidadao">
          <h2 id="titulo-cidadao">Sou cidadao</h2>
          <p>Acompanhar minhas solicitacoes, abrir novos pedidos e responder ao que a prefeitura pedir.</p>
          <a className="botao" href={`/api/v1/auth/login/cidadao?voltar=${encodeURIComponent(destino)}`}>
            Entrar como cidadao
          </a>
        </section>
        <section className="cartao" aria-labelledby="titulo-servidor">
          <h2 id="titulo-servidor">Sou servidor da prefeitura</h2>
          <p>Atender a fila da minha secretaria. Exige segundo fator de autenticacao.</p>
          <a className="botao secundaria" href={`/api/v1/auth/login/servidor?voltar=${encodeURIComponent(destino)}`}>
            Entrar como servidor
          </a>
        </section>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------- lista do cidadao */

export function MinhasSolicitacoes() {
  const { fase } = useSessao();
  const [pedidos, definirPedidos] = useState<readonly PedidoCidadao[] | null>(null);
  const [erro, definirErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    apiGet<Pagina<PedidoCidadao>>('/api/v1/requests/mine')
      .then((dados) => { if (ativo) definirPedidos(dados.items); })
      .catch((e: unknown) => {
        if (!ativo) return;
        definirErro(e instanceof ErroApi ? e.message : 'Nao foi possivel carregar suas solicitacoes.');
      });
    return () => { ativo = false; };
  }, [fase]);

  if (erro !== null) return <Aviso tipo="erro">{erro}</Aviso>;
  if (pedidos === null) return <Estado titulo="Carregando suas solicitacoes" />;

  return (
    <section className="cartao" aria-labelledby="titulo-lista">
      <div className="linha">
        <h2 id="titulo-lista">Minhas solicitacoes</h2>
        <a className="botao" href="#/nova">Abrir nova solicitacao</a>
      </div>
      {pedidos.length === 0 ? (
        <p>
          Voce ainda nao tem nenhuma solicitacao. <a href="#/nova">Abrir a primeira</a>.
        </p>
      ) : (
        <ul className="lista">
          {pedidos.map((p) => (
            <li key={p.id}>
              <div className="linha">
                <div>
                  <a href={`#/pedido/${p.id}`}>
                    <strong>{p.protocol}</strong> - {p.serviceName}
                  </a>
                  <div className="dica">
                    {p.secretariatName} - aberto em {formatarData(p.createdAt)}
                  </div>
                </div>
                <span className={`etiqueta ${classeEstado(p.state)}`}>{p.stateText}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
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

export function NovaSolicitacao() {
  const [catalogo, definirCatalogo] = useState<Catalogo | null>(null);
  const [passo, definirPasso] = useState<Passo>('servico');
  const [escolha, definirEscolha] = useState<Escolha | null>(null);
  const [enviando, definirEnviando] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  const [protocolo, definirProtocolo] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Catalogo>('/api/v1/catalog')
      .then(definirCatalogo)
      .catch((e: unknown) => {
        definirErro(e instanceof ErroApi ? e.message : 'Nao foi possivel carregar o catalogo de servicos.');
      });
  }, []);

  /**
   * A chave de idempotencia nasce com a tela e muda quando a escolha muda.
   *
   * E' o que faz "repetir o envio por falha de rede" nao virar dois pedidos.
   * Uma chave nova a cada clique faria cada tentativa contar como operacao
   * nova, que e exatamente o problema que a chave existe para evitar.
   */
  const recomecar = useCallback(() => {
    definirEscolha(null);
    definirPasso('servico');
    definirProtocolo(null);
    definirErro(null);
  }, []);

  if (protocolo !== null) {
    return (
      <section className="cartao" aria-labelledby="titulo-ok">
        <h2 id="titulo-ok">Solicitacao registrada</h2>
        <p>
          Guarde o numero de protocolo. Ele serve para qualquer contato com a prefeitura.
        </p>
        <p>
          <strong style={{ fontSize: '1.4rem' }}>{protocolo}</strong>
        </p>
        <p className="dica">Voce pode acompanhar o andamento em "Minhas solicitacoes".</p>
        <button onClick={recomecar}>Abrir outra solicitacao</button>
      </section>
    );
  }

  if (erro !== null && catalogo === null) return <Aviso tipo="erro">{erro}</Aviso>;
  if (catalogo === null) return <Estado titulo="Carregando o catalogo de servicos" />;

  if (catalogo.secretariats.length === 0) {
    return (
      <Aviso tipo="atencao">
        Nenhum servico esta disponivel no momento. Volte mais tarde ou procure a
        prefeitura pelo telefone.
      </Aviso>
    );
  }

  async function enviar() {
    if (escolha === null) return;
    definirEnviando(true);
    definirErro(null);
    try {
      const resposta = await apiPost<{ protocol: string }>(
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
      definirProtocolo(resposta.protocol);
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
    <section className="cartao" aria-labelledby="titulo-nova">
      <h2 id="titulo-nova">Abrir solicitacao</h2>
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
            <div key={secretaria.id} style={{ marginBottom: '1rem' }}>
              <h3>{secretaria.name}</h3>
              {secretaria.services.length === 0 && <p className="dica">Nenhum servico publicado.</p>}
              {secretaria.services.map((servico) => (
                <div key={servico.id} className="cartao">
                  <h4>{servico.name}</h4>
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
            onChange={(e) =>
              definirEscolha({ ...escolha, descricao: e.target.value })
            }
          />
          <p className="dica" id="dica-descricao">
            Quanto mais claro o local e o problema, mais rapido o atendimento.
          </p>
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
          <Aviso tipo="atencao">
            Este prazo e' {escolha.servico.sla.publishedCommitment
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

  useEffect(() => {
    let ativo = true;
    apiGet<DetalheCidadao>(`/api/v1/requests/${id}`)
      .then((dados) => { if (ativo) definirDetalhe(dados); })
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
    return () => { ativo = false; };
  }, [id]);

  if (erro !== null) return <Aviso tipo="erro">{erro}</Aviso>;
  if (detalhe === null) return <Estado titulo="Carregando o pedido" />;

  return (
    <section className="cartao" aria-labelledby="titulo-detalhe">
      <div className="linha">
        <h2 id="titulo-detalhe">{detalhe.protocol}</h2>
        <span className={`etiqueta ${classeEstado(detalhe.state)}`}>{detalhe.stateText}</span>
      </div>
      <p className="dica">
        {detalhe.serviceName} - {detalhe.secretariatName}
      </p>
      {detalhe.requiresRepresentation && (
        <Aviso tipo="info">
          Este servico trata de menores. Se voce fala por outra pessoa, a prefeitura
          vai pedir a representacao legal.
        </Aviso>
      )}
      <h3>O que foi pedido</h3>
      <p style={{ whiteSpace: 'pre-wrap' }}>{detalhe.description}</p>
      <h3>Andamento</h3>
      <ul className="linha-do-tempo">
        {detalhe.timeline.map((evento) => (
          <li key={`${evento.at}-${evento.text}`}>
            <time dateTime={evento.at}>{formatarData(evento.at)}</time>
            <div>{evento.text}</div>
          </li>
        ))}
      </ul>
      {detalhe.outcomeText !== null && (
        <Aviso tipo="info">
          <strong>Resultado:</strong> {detalhe.outcomeText}
        </Aviso>
      )}
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
  const unidade = resolutionUnit === 'BUSINESS_DAYS' ? `${resolutionValue} dias uteis`
    : resolutionUnit === 'CALENDAR_DAYS' ? `${resolutionValue} dias`
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
