import { useEffect, useState } from 'react';
import { apiGet, apiPost, ErroApi } from '../api/cliente';
import type { AvaliacaoPedido } from '../api/tipos';
import { Aviso, Estado } from './comuns';

export function AvaliacaoSatisfacao({
  requestId,
  state,
}: {
  readonly requestId: string;
  readonly state: string;
}) {
  const [avaliacao, definirAvaliacao] = useState<AvaliacaoPedido | null | undefined>(undefined);
  const [nota, definirNota] = useState(0);
  const [comentario, definirComentario] = useState('');
  const [erro, definirErro] = useState<string | null>(null);
  const [enviando, definirEnviando] = useState(false);

  useEffect(() => {
    if (state !== 'COMPLETED') {
      definirAvaliacao(null);
      return;
    }
    let ativo = true;
    apiGet<AvaliacaoPedido | null>(`/api/v1/requests/${requestId}/evaluation`)
      .then((resposta) => {
        if (ativo) definirAvaliacao(resposta);
      })
      .catch((error: unknown) => {
        if (ativo)
          definirErro(
            error instanceof ErroApi ? error.message : 'Nao foi possivel carregar a avaliacao.',
          );
      });
    return () => {
      ativo = false;
    };
  }, [requestId, state]);

  if (state !== 'COMPLETED') return null;
  if (avaliacao === undefined && erro === null) return <Estado titulo="Carregando avaliacao" />;
  if (avaliacao !== null && avaliacao !== undefined) {
    return (
      <section className="cartao" aria-labelledby={`titulo-avaliacao-${requestId}`}>
        <h3 id={`titulo-avaliacao-${requestId}`}>Sua avaliacao</h3>
        <p aria-label={`Nota ${avaliacao.rating} de 5`}>
          {'★'.repeat(avaliacao.rating)}
          {'☆'.repeat(5 - avaliacao.rating)}
        </p>
        {avaliacao.comment !== null && (
          <p style={{ whiteSpace: 'pre-wrap' }}>{avaliacao.comment}</p>
        )}
        <p className="dica">Obrigado por ajudar a melhorar os servicos municipais.</p>
      </section>
    );
  }

  async function enviar() {
    if (nota < 1) {
      definirErro('Escolha uma nota de 1 a 5.');
      return;
    }
    definirEnviando(true);
    definirErro(null);
    try {
      const resposta = await apiPost<AvaliacaoPedido>(`/api/v1/requests/${requestId}/evaluation`, {
        rating: nota,
        comment: comentario,
      });
      definirAvaliacao(resposta);
    } catch (error: unknown) {
      definirErro(
        error instanceof ErroApi ? error.message : 'Nao foi possivel registrar sua avaliacao.',
      );
    } finally {
      definirEnviando(false);
    }
  }

  return (
    <section className="cartao" aria-labelledby={`titulo-avaliacao-${requestId}`}>
      <h3 id={`titulo-avaliacao-${requestId}`}>Como foi o atendimento?</h3>
      <p className="dica">Sua resposta ajuda a prefeitura a melhorar o servico.</p>
      {erro !== null && <Aviso tipo="erro">{erro}</Aviso>}
      <fieldset>
        <legend className="rotulo">Escolha uma nota de 1 a 5</legend>
        <div className="linha" role="radiogroup" aria-label="Nota do atendimento">
          {[1, 2, 3, 4, 5].map((valor) => (
            <label key={valor}>
              <input
                type="radio"
                name={`nota-${requestId}`}
                value={valor}
                checked={nota === valor}
                onChange={() => definirNota(valor)}
              />
              {valor}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="rotulo" htmlFor={`comentario-avaliacao-${requestId}`}>
        Comentario (opcional)
      </label>
      <textarea
        id={`comentario-avaliacao-${requestId}`}
        maxLength={2000}
        value={comentario}
        onChange={(event) => definirComentario(event.target.value)}
      />
      <button onClick={() => void enviar()} disabled={enviando}>
        {enviando ? 'Enviando...' : 'Enviar avaliacao'}
      </button>
    </section>
  );
}
