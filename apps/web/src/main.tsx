/**
 * Ponto de entrada da interface.
 *
 * A navegacao e' por hash, e nao por `history` da API. Tres motivos, e o
 * terceiro e o que costuma decides:
 *
 * 1. O servidor de arquivos estatico nao precisa saber reescrever URLs. A
 *    interface e servida como arquivos, e `#/fila` resolve no proprio arquivo.
 * 2. A sessao vive num cookie `HttpOnly`: recarregar a pagina nao pode
 *    transformar em "saiu do sistema".
 * 3. Nao ha biblioteca de rotas. Um arquivo com dez telas e uma funcao que
 *    escolhe a tela e' mais facil de ler do que configuracao de rotas, e a
 *    interface ainda tem poucas telas.
 *
 * O que a interface NAO faz: decidir permissao. Ela mostra o que a API
 * devolveu. Esconder um botao e' cortesia, nao protecao, e a protecao esta no
 * servidor.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProvedorSessao, useSessao } from './api/sessao';
import { Cabecalho, Estado } from './telas/comuns';
import {
  DetalhePedido,
  MinhasSolicitacoes,
  NovaSolicitacao,
  TelaEntrada,
  formatarData,
} from './telas/cidadao';
import './estilos.css';

const elemento = document.getElementById('raiz');
if (elemento === null) {
  throw new Error('Elemento #raiz nao encontrado no index.html');
}

/** Destino da rota atual, extraido do hash. */
function rotaAtual(): string {
  const bruto = window.location.hash.replace(/^#\/?/, '');
  return bruto === '' ? '/minhas' : bruto;
}

function Aplicacao() {
  const { fase, sessao, sair } = useSessao();
  const [rota, definirRota] = useState<string>(rotaAtual());

  useEffect(() => {
    const aoMudar = () => definirRota(rotaAtual());
    window.addEventListener('hashchange', aoMudar);
    return () => window.removeEventListener('hashchange', aoMudar);
  }, []);

  if (fase === 'carregando') {
    return (
      <>
        <a className="pular-para-conteudo" href="#conteudo">Pular para o conteudo</a>
        <main className="conteudo" id="conteudo">
          <Estado titulo="Verificando sua sessao" />
        </main>
      </>
    );
  }

  if (fase === 'anonimo') {
    return <TelaEntrada destino={rota} />;
  }

  const cidadao = fase === 'cidadao';
  const pode = sessao?.can;

  // O servidor institucional ve a fila; a tela dele ainda nao foi construida
  // neste marco, e a interface diz isso em vez de mostrar um espaco vazio que
  // parece defeito.
  if (!cidadao) {
    return (
      <>
        <a className="pular-para-conteudo" href="#conteudo">Pular para o conteudo</a>
        <Cabecalho
          area={sessao?.contexts[0]?.secretariatName ?? 'Servidor'}
          podeAbrir={false}
          podeVerFila={pode?.viewQueue ?? false}
          sair={sair}
        />
        <main className="conteudo" id="conteudo">
          <h2>Fila da secretaria</h2>
          <p>
            A tela da fila institucional ainda nao foi construida. O que ja funciona:
            autenticacao com segundo fator, selecao de contexto e as rotas de fila,
            pedido e comandos na API, com 40 testes de integracao.
          </p>
          <p className="dica">
            Contexto atual: {sessao?.contexts[0]?.secretariatName ?? 'sem contexto'} -{' '}
            {sessao?.contexts[0]?.roles.join(', ') ?? 'sem funcao'}
          </p>
        </main>
      </>
    );
  }

  const partes = rota.split('/').filter((p) => p !== '');

  return (
    <>
      <a className="pular-para-conteudo" href="#conteudo">Pular para o conteudo</a>
      <Cabecalho
        area="Cidadao"
        podeAbrir={pode?.openRequest ?? false}
        podeVerFila={false}
        sair={sair}
      />
      <main className="conteudo" id="conteudo">
        {partes[0] === 'nova' && <NovaSolicitacao />}
        {partes[0] === 'minhas' && <MinhasSolicitacoes />}
        {partes[0] === 'pedido' && partes[1] !== undefined && (
          <DetalhePedido id={partes[1]} />
        )}
        {partes[0] !== 'nova' && partes[0] !== 'minhas' && partes[0] !== 'pedido' && (
          <MinhasSolicitacoes />
        )}
        <footer className="dica" style={{ marginTop: '2rem' }}>
          Dados de demonstracao. Em caso de problema, procure a prefeitura pelo
          telefone. Sessao iniciada em {formatarData(new Date().toISOString())}.
        </footer>
      </main>
    </>
  );
}

createRoot(elemento).render(
  <StrictMode>
    <ProvedorSessao>
      <Aplicacao />
    </ProvedorSessao>
  </StrictMode>,
);
