/**
 * Componentes compartilhados pelas telas.
 *
 * `Estado` e `Aviso` existem para que carregamento, vazio e erro sejam
 * componentes e nao um `if` repetido em cada tela. Alem de evitar a repeticao,
 * isso garante que toda tela trate os tres estados da mesma forma: quem usa o
 * sistema ve sempre a mesma linguagem, e nenhuma tela esquece um dos casos.
 */
import { useState, type ReactNode } from 'react';

export function Cabecalho({
  area,
  podeAbrir,
  podeVerFila,
  podeGerirServidores,
  podeVerDashboard,
  homeHref,
  sair,
}: {
  readonly area: string;
  readonly podeAbrir: boolean;
  readonly podeVerFila: boolean;
  readonly podeGerirServidores: boolean;
  readonly podeVerDashboard: boolean;
  readonly homeHref: string;
  readonly sair: () => Promise<void>;
}) {
  const [menuAberto, definirMenuAberto] = useState(false);
  const fecharMenu = () => definirMenuAberto(false);
  return (
    <header className="topo">
      <div className="topo-conteudo">
        <h1>Sertania - {area}</h1>
        <div className="menu-navegacao">
          <button
            className="botao-menu"
            aria-label="Abrir menu"
            aria-expanded={menuAberto}
            aria-controls="menu-principal"
            onClick={() => definirMenuAberto((aberto) => !aberto)}
          >
            <span aria-hidden="true">☰</span><span>Menu</span>
          </button>
          {menuAberto && (
            <nav id="menu-principal" className="menu-painel" aria-label="Menu principal">
              <a href={homeHref} onClick={fecharMenu}>Tela inicial</a>
              {podeAbrir && <a href="#/minhas" onClick={fecharMenu}>Minhas solicitacoes</a>}
              {podeAbrir && <a href="#/nova" onClick={fecharMenu}>Abrir solicitacao</a>}
              {podeVerFila && <a href="#/fila" onClick={fecharMenu}>Fila da secretaria</a>}
              {podeVerDashboard && <a href="#/dashboard" onClick={fecharMenu}>Dashboard</a>}
              {podeGerirServidores && <a href="#/administracao/servidores" onClick={fecharMenu}>Cadastrar servidor</a>}
              <a href="#/configuracoes" onClick={fecharMenu}>Configuracoes</a>
            </nav>
          )}
        </div>
        <button
          className="secundario"
          onClick={() => {
            if (window.confirm('Deseja realmente sair da plataforma?')) void sair();
          }}
        >
          Sair
        </button>
      </div>
    </header>
  );
}

/**
 * Carregando.
 *
 * `role="status"` com `aria-live` faz o leitor de tela anunciar a espera, e nao
 * so mostrar um texto que so quem enxerga le. O `aviso` visual e um ponto e uma
 * frase, e nao um "..." solto: um spinner sem texto nao diz nada para quem nao
 * ve a animacao.
 */
export function Estado({ titulo }: { readonly titulo: string }) {
  return (
    <p className="cartao" role="status" aria-live="polite">
      {titulo}...
    </p>
  );
}

/**
 * Mensagem de erro ou atencao.
 *
 * `role="alert"` para o erro: a pessoa precisa saber AGORA, sem esperar que o
 * leitor de tela encontre a mensagem. O tipo entra tambem no texto com uma
 * palavra, e nao so na cor: a cor sozinha nao chega em quem nao distingue.
 */
export function Aviso({
  tipo,
  children,
}: {
  readonly tipo: 'erro' | 'atencao' | 'info';
  readonly children: ReactNode;
}) {
  const rotulo = tipo === 'erro' ? 'Erro' : tipo === 'atencao' ? 'Atencao' : 'Informacao';
  return (
    <div
      className={`aviso aviso-${tipo}`}
      role={tipo === 'erro' ? 'alert' : 'status'}
      aria-live={tipo === 'erro' ? 'assertive' : 'polite'}
    >
      <strong>{rotulo}: </strong>
      {children}
    </div>
  );
}
