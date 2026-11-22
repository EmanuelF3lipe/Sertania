import { useEffect, useState, type ReactNode } from 'react';
import { PAPEL_TEXTO } from '../shared/dominio';
import { useDados, useEstado, useOnline, usePreferencias, useRota } from './nucleo';
import { sincronizar } from './offline';
import { Aviso, Carregando } from './componentes/comuns';
import { Acompanhar, Entrar, MinhasDemandas, Transparencia } from './telas/publico';
import { Inicio } from './telas/inicio';
import { PrimeiroAcesso, TrocarSenha } from './telas/acesso';
import { NovaDemanda } from './telas/nova-demanda';
import { DetalheDemanda, Fila } from './telas/gestao';
import { IaAlertas, MapaTela, Painel, Relatorios } from './telas/paineis';
import { Admin } from './telas/admin';

function Marca() {
  return (
    <a className="marca" href="#/">
      <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#ffffff" /><path d="M8 21c3 2 6 2 8 0s5-2 8 0M8 15c3 2 6 2 8 0s5-2 8 0" stroke="#11643a" strokeWidth="2.4" fill="none" strokeLinecap="round" /><circle cx="23" cy="9" r="2.5" fill="#f0b400" /></svg>
      <span>Sertânia Digital<small>Prefeitura Municipal de Sertânia – PE</small></span>
    </a>
  );
}

function Topo() {
  const { usuario, pode, sair } = useEstado();
  const { caminho } = useRota();
  const [aberto, setAberto] = useState(false);
  const { p, alternar } = usePreferencias();
  useEffect(() => setAberto(false), [caminho]);
  const link = (href: string, rotulo: string) => <a href={`#${href}`} aria-current={caminho === href || (href !== '/' && caminho.startsWith(href)) ? 'page' : undefined}>{rotulo}</a>;
  return (
    <header>
      <div className="barra-acess" aria-label="Acessibilidade">
        <div className="int">
          <span>Acessibilidade:</span>
          <button aria-pressed={p.texto === 'grande'} onClick={() => alternar('texto', 'grande')}>A+ Texto maior</button>
          <button aria-pressed={p.contraste === 'alto'} onClick={() => alternar('contraste', 'alto')}>◐ Alto contraste</button>
          <button aria-pressed={p.theme === 'dark'} onClick={() => alternar('theme', 'dark')}>☾ Modo escuro</button>
          <button aria-pressed={p.movimento === 'reduzido'} onClick={() => alternar('movimento', 'reduzido')}>Menos movimento</button>
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
            {pode('demanda.ver') && link('/gestao/fila', 'Fila')}
            {pode('painel.ver') && link('/gestao/painel', 'Painel')}
            {pode('demanda.ver') && link('/gestao/mapa', 'Mapa')}
            {pode('painel.ver', 'demanda.triagem', 'demanda.executar') && link('/gestao/alertas', 'Alertas e IA')}
            {pode('relatorio.gerar', 'painel.ver') && link('/gestao/relatorios', 'Relatórios')}
            {pode('admin.usuarios', 'auditoria.ver', 'admin.diagnostico') && link('/admin', 'Administração')}
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
  let tela: ReactNode;
  if (instalacao?.precisaPrimeiroAcesso) tela = <PrimeiroAcesso />;
  else if (usuario?.deveTrocarSenha) tela = <TrocarSenha />;
  else if (!a) tela = <Inicio />;
  else if (a === 'nova') tela = <NovaDemanda />;
  else if (a === 'acompanhar') tela = <Acompanhar />;
  else if (a === 'transparencia') tela = <Transparencia />;
  else if (a === 'entrar') tela = <Entrar />;
  else if (a === 'minhas') tela = <MinhasDemandas />;
  else if (a === 'api') tela = <ApiDocs />;
  else if (a === 'admin') tela = <Restrito permitido={pode('admin.usuarios', 'auditoria.ver', 'admin.diagnostico')}><Admin /></Restrito>;
  else if (a === 'gestao') {
    if (b === 'fila') tela = <Restrito permitido={pode('demanda.ver')}><Fila /></Restrito>;
    else if (b === 'demanda') tela = <Restrito permitido={pode('demanda.ver')}><DetalheDemanda /></Restrito>;
    else if (b === 'assistido') tela = <Restrito permitido={pode('demanda.registrar_assistido')}><NovaDemanda assistido /></Restrito>;
    else if (b === 'painel') tela = <Restrito permitido={pode('painel.ver')}><Painel /></Restrito>;
    else if (b === 'mapa') tela = <Restrito permitido={pode('demanda.ver')}><MapaTela /></Restrito>;
    else if (b === 'alertas') tela = <Restrito permitido={pode('painel.ver', 'demanda.triagem', 'demanda.executar')}><IaAlertas /></Restrito>;
    else if (b === 'relatorios') tela = <Restrito permitido={pode('relatorio.gerar', 'painel.ver')}><Relatorios /></Restrito>;
  }
  return (
    <>
      <a className="pular" href="#conteudo" onClick={(e) => { e.preventDefault(); document.getElementById('conteudo')?.focus(); }}>Pular para o conteúdo</a>
      <Topo />
      {!online && <div className="offline-faixa" role="status">Sem internet. Você pode continuar registrando: enviaremos quando a conexão voltar.</div>}
      <main id="conteudo" tabIndex={-1}>
        {sincronizadas > 0 && <Aviso tipo="ok">{sincronizadas} solicitação(ões) guardadas no aparelho foram enviadas. Veja os protocolos na página inicial.</Aviso>}
        {tela ?? <Aviso tipo="erro">Página não encontrada. <a href="#/">Voltar ao início</a></Aviso>}
      </main>
    </>
  );
}
