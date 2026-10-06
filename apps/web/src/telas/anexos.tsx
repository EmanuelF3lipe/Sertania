import { useEffect, useState } from 'react';
import { apiGet, apiUpload, ErroApi } from '../api/cliente';
import type { AnexoPedido } from '../api/tipos';
import { Aviso, Estado } from './comuns';

export function AnexosPedido({
  requestId,
  allowUpload,
}: {
  readonly requestId: string;
  readonly allowUpload: boolean;
}) {
  const [anexos, definirAnexos] = useState<readonly AnexoPedido[] | null>(null);
  const [arquivo, definirArquivo] = useState<File | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [enviando, definirEnviando] = useState(false);

  async function carregar() {
    try {
      definirAnexos(
        await apiGet<readonly AnexoPedido[]>(`/api/v1/requests/${requestId}/attachments`),
      );
    } catch (error: unknown) {
      definirErro(
        error instanceof ErroApi ? error.message : 'Nao foi possivel carregar os anexos.',
      );
    }
  }

  useEffect(() => {
    void carregar();
  }, [requestId]);

  async function enviar() {
    if (arquivo === null) return;
    definirEnviando(true);
    definirErro(null);
    const formulario = new FormData();
    formulario.append('file', arquivo);
    try {
      await apiUpload(`/api/v1/requests/${requestId}/attachments`, formulario);
      definirArquivo(null);
      await carregar();
    } catch (error: unknown) {
      definirErro(error instanceof ErroApi ? error.message : 'Nao foi possivel enviar o anexo.');
    } finally {
      definirEnviando(false);
    }
  }

  return (
    <section className="cartao" aria-labelledby={`titulo-anexos-${requestId}`}>
      <h3 id={`titulo-anexos-${requestId}`}>Anexos</h3>
      <p className="dica">
        Formatos aceitos: JPG, PNG e PDF verificado. Limite de 10 MB por arquivo.
      </p>
      {erro !== null && <Aviso tipo="erro">{erro}</Aviso>}
      {anexos === null ? (
        <Estado titulo="Carregando anexos" />
      ) : anexos.length === 0 ? (
        <p className="dica">Nenhum anexo foi enviado.</p>
      ) : (
        <ul>
          {anexos.map((anexo) => (
            <li key={anexo.id}>
              <span>
                {nomeDoTipo(anexo.detectedMediaType)} ({formatarTamanho(anexo.sizeBytes)})
              </span>{' '}
              <span className="dica">{textoEstado(anexo.inspectionState)}</span>{' '}
              {anexo.available && (
                <a href={`/api/v1/requests/${requestId}/attachments/${anexo.id}`}>Baixar</a>
              )}
            </li>
          ))}
        </ul>
      )}
      {allowUpload && (
        <div className="form-acao">
          <label className="rotulo" htmlFor={`arquivo-${requestId}`}>
            Enviar arquivo
          </label>
          <input
            id={`arquivo-${requestId}`}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(event) => definirArquivo(event.target.files?.[0] ?? null)}
          />
          <button onClick={() => void enviar()} disabled={enviando || arquivo === null}>
            {enviando ? 'Enviando e verificando...' : 'Enviar anexo'}
          </button>
        </div>
      )}
    </section>
  );
}

function nomeDoTipo(mediaType: string): string {
  if (mediaType === 'application/pdf') return 'PDF';
  if (mediaType === 'image/png') return 'Imagem PNG';
  return 'Imagem JPEG';
}

function textoEstado(state: AnexoPedido['inspectionState']): string {
  if (state === 'RELEASED') return 'disponivel';
  if (state === 'REJECTED') return 'recusado na verificacao';
  if (state === 'ERROR') return 'verificacao indisponivel';
  return 'em verificacao';
}

function formatarTamanho(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
