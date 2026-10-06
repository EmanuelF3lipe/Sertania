import { useEffect, useState } from 'react';
import { apiGet, apiPost, ErroApi } from '../api/cliente';
import type { MensagemPedido } from '../api/tipos';
import { Aviso, Estado } from './comuns';

export function MensagensPedido({
  requestId,
  serverView,
  onCitizenMessageSent,
}: {
  readonly requestId: string;
  readonly serverView: boolean;
  readonly onCitizenMessageSent?: (() => Promise<void>) | undefined;
}) {
  const [mensagens, definirMensagens] = useState<readonly MensagemPedido[] | null>(null);
  const [texto, definirTexto] = useState('');
  const [visibilidade, definirVisibilidade] = useState<'CITIZEN_VISIBLE' | 'INTERNAL_ONLY'>(
    serverView ? 'INTERNAL_ONLY' : 'CITIZEN_VISIBLE',
  );
  const [erro, definirErro] = useState<string | null>(null);
  const [enviando, definirEnviando] = useState(false);

  async function carregar() {
    try {
      definirMensagens(
        await apiGet<readonly MensagemPedido[]>(`/api/v1/requests/${requestId}/messages`),
      );
    } catch (error: unknown) {
      definirErro(
        error instanceof ErroApi ? error.message : 'Nao foi possivel carregar as mensagens.',
      );
    }
  }

  useEffect(() => {
    void carregar();
  }, [requestId]);

  async function enviar() {
    if (texto.trim() === '') return;
    definirEnviando(true);
    definirErro(null);
    try {
      await apiPost<MensagemPedido>(`/api/v1/requests/${requestId}/messages`, {
        body: texto,
        visibility: serverView ? visibilidade : 'CITIZEN_VISIBLE',
      });
      if (!serverView && onCitizenMessageSent !== undefined) {
        await onCitizenMessageSent();
      }
      definirTexto('');
      await carregar();
    } catch (error: unknown) {
      definirErro(error instanceof ErroApi ? error.message : 'Nao foi possivel enviar a mensagem.');
    } finally {
      definirEnviando(false);
    }
  }

  return (
    <section className="cartao" aria-labelledby={`titulo-mensagens-${requestId}`}>
      <h3 id={`titulo-mensagens-${requestId}`}>Conversa sobre este pedido</h3>
      <p className="dica">
        {serverView
          ? 'Mensagens internas ficam visiveis apenas para a equipe autorizada.'
          : onCitizenMessageSent !== undefined
            ? 'Ao enviar uma mensagem, a complementacao sera encaminhada para a equipe.'
            : 'Use este espaco para responder ou acrescentar informacoes ao pedido.'}
      </p>
      {erro !== null && <Aviso tipo="erro">{erro}</Aviso>}
      {mensagens === null ? (
        <Estado titulo="Carregando a conversa" />
      ) : mensagens.length === 0 ? (
        <p className="dica">Ainda nao ha mensagens nesta conversa.</p>
      ) : (
        <ol className="linha-do-tempo">
          {mensagens.map((mensagem) => (
            <li key={mensagem.id}>
              <time dateTime={mensagem.createdAt}>{formatarDataMensagem(mensagem.createdAt)}</time>
              <div>
                <strong>
                  {mensagem.isMine ? 'Voce' : serverView ? 'Cidadao' : 'Prefeitura'}
                  {mensagem.visibility === 'INTERNAL_ONLY' ? ' (interna)' : ''}
                </strong>
                <p style={{ whiteSpace: 'pre-wrap' }}>{mensagem.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="form-acao">
        {serverView && (
          <label className="rotulo" htmlFor={`visibilidade-${requestId}`}>
            Tipo de mensagem
            <select
              id={`visibilidade-${requestId}`}
              value={visibilidade}
              onChange={(event) => definirVisibilidade(event.target.value as typeof visibilidade)}
            >
              <option value="INTERNAL_ONLY">Nota interna</option>
              <option value="CITIZEN_VISIBLE">Mensagem para o cidadao</option>
            </select>
          </label>
        )}
        <label className="rotulo" htmlFor={`mensagem-${requestId}`}>
          Nova mensagem
        </label>
        <textarea
          id={`mensagem-${requestId}`}
          value={texto}
          maxLength={5000}
          onChange={(event) => definirTexto(event.target.value)}
          placeholder="Escreva uma mensagem..."
        />
        <button onClick={() => void enviar()} disabled={enviando || texto.trim() === ''}>
          {enviando ? 'Enviando...' : 'Enviar mensagem'}
        </button>
      </div>
    </section>
  );
}

function formatarDataMensagem(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
