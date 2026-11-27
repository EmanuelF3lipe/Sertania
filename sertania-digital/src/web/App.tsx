import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { Accessibility, Hand, Volume2 } from 'lucide-react';
import { Acessibilidade, abrirPainelAcessibilidade } from './acessibilidade/painel';
import { falaDisponivel, falar, textoDaPagina } from './acessibilidade/voz';
import { PaginaAcessibilidade } from './telas/acessibilidade';
import { PAPEL_TEXTO } from '../shared/dominio';
import { useDados, useEstado, useOnline, usePreferencias, useRota } from './nucleo';
import { sincronizar } from './offline';
import { Aviso, Carregando } from './componentes/comuns';
import { Acompanhar, AvaliarPorLink, MinhasDemandas, Transparencia } from './telas/publico';
import { Entrar } from './telas/entrar';
import { InicioEquipe } from './telas/equipe';
import { Configuracoes } from './telas/config';
import { Casca, MarcaSertania } from './componentes/casca';
import { Inicio } from './telas/inicio';
import { PrimeiroAcesso, TrocarSenha } from './telas/acesso';
import { NovaDemanda } from './telas/nova-demanda';
import { DetalheDemanda, Fila } from './telas/gestao';
import { IaAlertas, MapaTela, Painel, Relatorios } from './telas/paineis';

/** Links para pular direto (aparecem ao usar Tab), com os atalhos do padrao eMAG */
function AtalhosTopo() {
  const focar = (sel: string) => (e: MouseEvent) => { e.preventDefault(); const el = document.querySelector<HTMLElement>(sel); el?.focus(); el?.scrollIntoView({ block: 'start' }); };
  return (
    <nav className="atalhos-topo" aria-label="Atalhos">
      <a href="#conteudo" onClick={focar('#conteudo')}>Ir para o conteúdo [Alt+1]</a>
      <a href="#nav" onClick={focar('#nav a, .ct-nav a')}>Ir para o menu [Alt+2]</a>
      <a href="#acessibilidade" onClick={(e) => { e.preventDefault(); abrirPainelAcessibilidade(); }}>Acessibilidade [Alt+3]</a>
    </nav>
  );
}

function Marca() {
  const { instalacao } = useEstado();
  const par = instalacao?.parametros;
  return (
    <a className="marca" href="#/">
      <MarcaSertania tamanho={38} />
      <span>{par?.nomeSistema ?? 'Sertânia Digital'}<small>{par?.orgao ?? 'Prefeitura Municipal de Sertânia – PE'}</small></span>
    </a>
  );
}

function Topo() {
  const { usuario, sair } = useEstado();
  const { caminho } = useRota();
  const [aberto, setAberto] = useState(false);
  const { p, alternar, definir } = usePreferencias();
  useEffect(() => setAberto(false), [caminho]);
  const link = (href: string, rotulo: string) => <a href={`#${href}`} aria-current={caminho === href || (href !== '/' && caminho.startsWith(href)) ? 'page' : undefined}>{rotulo}</a>;
  return (
    <header>
      <div className="faixa-cordel" aria-hidden="true" />
      <div className="barra-acess" role="region" aria-label="Acessibilidade">
        <div className="int">
          <button className="ba-abrir" aria-haspopup="dialog" onClick={abrirPainelAcessibilidade}><Accessibility size={16} aria-hidden="true" /> Acessibilidade</button>
          <button aria-pressed={p.texto !== ''} onClick={() => definir('texto', p.texto === '' ? 'grande' : p.texto === 'grande' ? 'enorme' : '')} aria-label={`Tamanho das letras: ${p.texto === 'enorme' ? 'muito grande' : p.texto === 'grande' ? 'grande' : 'normal'}`}>A+ Letras</button>
          <button aria-pressed={p.contraste === 'alto'} onClick={() => alternar('contraste', 'alto')}>◐ Contraste</button>
          <button aria-pressed={p.theme === 'dark'} onClick={() => alternar('theme', 'dark')}>☾ Escuro</button>
          {falaDisponivel() && <button onClick={() => falar(textoDaPagina())}><Volume2 size={15} aria-hidden="true" /> Ouvir a página</button>}
          <button aria-pressed={p.libras === 'on'} onClick={() => alternar('libras', 'on')}><Hand size={15} aria-hidden="true" /> Libras</button>
          <a href="#/acessibilidade" className="ba-sobre">Sobre a acessibilidade</a>
        </div>
      </div>
      <div className="topo">
        <div className="topo-int">
          <Marca />
          <button className="menu-botao" aria-expanded={aberto} aria-controls="nav" onClick={() => setAberto(!aberto)}>☰ Menu</button>
          <nav id="nav" className={`nav${aberto ? ' aberto' : ''}`} aria-label="Principal">
            {link('/nova', 'Registrar')}
            {link('/acompanhar', 'Acompanhar')}
            {usuario?.papel === 'CIDADAO' && link('/minhas', 'Minhas')}
            {usuario && usuario.papel !== 'CIDADAO' && link('/equipe', 'Área da equipe')}
            {link('/transparencia', 'Transparência')}
            {usuario ? (
              <button className="link" onClick={() => void sair()} title={`${usuario.nome} – ${PAPEL_TEXTO[usuario.papel]}`}>Sair ({usuario.nome.split(' ')[0]})</button>
            ) : (
              link('/entrar', 'Entrar')
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

function Restrito({ permitido, children }: { permitido: boolean; children: ReactNode }) {
  const { usuario, carregando } = useEstado();
  if (carregando) return <Carregando />;
  if (!usuario) return <Aviso>Esta área é da equipe da prefeitura. <a href="#/entrar">Entrar</a></Aviso>;
  if (!permitido) return <Aviso tipo="erro">Seu perfil ({PAPEL_TEXTO[usuario.papel]}) não tem acesso a esta área.</Aviso>;
  return <>{children}</>;
}

function ApiDocs() {
  const { dados } = useDados<{ info: { title: string; description: string; version: string }; paths: Record<string, Record<string, { summary: string; tags: string[] }>> }>('/openapi.json');
  if (!dados) return <Carregando />;
  return (
    <>
      <h1>{dados.info.title} <span className="etq">v{dados.info.version}</span></h1>
      <p className="sec">{dados.info.description}</p>
      <p><a className="botao sec" href="/api/openapi.json" target="_blank" rel="noreferrer">Baixar especificação OpenAPI 3.1 (JSON)</a></p>
      <div className="cartao rolagem-x">
        <table><thead><tr><th>Método</th><th>Rota</th><th>Grupo</th><th>Descrição</th></tr></thead>
          <tbody>{Object.entries(dados.paths).flatMap(([rota, ops]) => Object.entries(ops).map(([m, o]) => <tr key={rota + m}><td><code>{m.toUpperCase()}</code></td><td><code>/api{rota}</code></td><td className="pequeno">{o.tags[0]}</td><td className="pequeno">{o.summary}</td></tr>))}</tbody></table>
      </div>
    </>
  );
}

export function App() {
  const { partes } = useRota();
  const { pode, usuario, instalacao } = useEstado();
  const online = useOnline();
  const [sincronizadas, setSincronizadas] = useState(0);

  useEffect(() => {
    if (!online) return;
    sincronizar().then((r) => r.length && setSincronizadas((n) => n + r.length)).catch(() => undefined);
  }, [online]);

  const [a, b] = partes;
  const equipe = !!usuario && usuario.papel !== 'CIDADAO';
  let tela: ReactNode;
  let interna = false;
  if (instalacao?.precisaPrimeiroAcesso) tela = <PrimeiroAcesso />;
  else if (usuario?.deveTrocarSenha) tela = <TrocarSenha />;
  else if (a === 'entrar') return <><Entrar /><Acessibilidade /></>;
  else if (!a) tela = <Inicio />;
  else if (a === 'nova') tela = <NovaDemanda />;
  else if (a === 'acompanhar') tela = <Acompanhar />;
  else if (a === 'avaliar' && b) tela = <AvaliarPorLink token={b} />;
  else if (a === 'transparencia') tela = <Transparencia />;
  else if (a === 'acessibilidade') { tela = <PaginaAcessibilidade />; interna = equipe; }
  else if (a === 'minhas') tela = <MinhasDemandas />;
  else if (a === 'api') { tela = <ApiDocs />; interna = equipe; }
  else if (a === 'equipe') { tela = <Restrito permitido={equipe}><InicioEquipe /></Restrito>; interna = true; }
  else if (a === 'config' || a === 'admin') { tela = <Restrito permitido={equipe}><Configuracoes /></Restrito>; interna = true; }
  else if (a === 'gestao') {
    interna = true;
    if (b === 'fila') tela = <Restrito permitido={pode('demanda.ver')}><Fila /></Restrito>;
    else if (b === 'demanda') tela = <Restrito permitido={pode('demanda.ver')}><DetalheDemanda /></Restrito>;
    else if (b === 'assistido') tela = <Restrito permitido={pode('demanda.registrar_assistido')}><NovaDemanda assistido /></Restrito>;
    else if (b === 'painel') tela = <Restrito permitido={pode('painel.ver')}><Painel /></Restrito>;
    else if (b === 'mapa') tela = <Restrito permitido={pode('demanda.ver')}><MapaTela /></Restrito>;
    else if (b === 'alertas') tela = <Restrito permitido={pode('painel.ver', 'demanda.triagem', 'demanda.executar')}><IaAlertas /></Restrito>;
    else if (b === 'relatorios') tela = <Restrito permitido={pode('relatorio.gerar', 'painel.ver')}><Relatorios /></Restrito>;
  }
  const faixas = (
    <>
      {!online && <div className="offline-faixa" role="status">Sem internet. Você pode continuar registrando: enviaremos quando a conexão voltar.</div>}
      {sincronizadas > 0 && <Aviso tipo="ok">{sincronizadas} solicitação(ões) guardadas no aparelho foram enviadas. Veja os protocolos na página inicial.</Aviso>}
    </>
  );
  const conteudo = tela ?? <Aviso tipo="erro">Página não encontrada. <a href="#/">Voltar ao início</a></Aviso>;
  if (interna && equipe) {
    return (
      <>
        <AtalhosTopo />
        <Casca><main id="conteudo" className="conteudo-interno" tabIndex={-1}>{faixas}{conteudo}</main></Casca>
        <Acessibilidade />
      </>
    );
  }
  return (
    <>
      <AtalhosTopo />
      <Topo />
      <main id="conteudo" tabIndex={-1}>
        {faixas}
        {conteudo}
      </main>
      <Acessibilidade />
    </>
  );
}
