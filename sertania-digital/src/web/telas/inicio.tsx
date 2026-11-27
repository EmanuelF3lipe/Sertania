import { useEffect, useState } from 'react';
import type { Servico } from '../../shared/dominio';
import { fmtNum } from '../api';
import { ir, useDados, useEstado, useOnline } from '../nucleo';
import { Aviso } from '../componentes/comuns';
import { IconeServico } from '../componentes/icone-servico';
import { Xilogravura } from '../componentes/xilogravura';
import { enviadas, pendentes, type Enviada } from '../offline';

interface Transp { total: number; concluidas: number; noPrazoPct: number | null; satisfacao: number | null }

export function Inicio() {
  const { usuario, pode, catalogo, instalacao } = useEstado();
  const online = useOnline();
  const transp = useDados<Transp>('/publico/transparencia');
  const [locais, setLocais] = useState<{ pend: number; env: Enviada[] }>({ pend: 0, env: [] });
  const [protocolo, setProtocolo] = useState('');
  const [codigo, setCodigo] = useState('');
  useEffect(() => {
    Promise.all([pendentes(), enviadas()]).then(([p, e]) => setLocais({ pend: p.length, env: e.slice(-3).reverse() })).catch(() => undefined);
  }, []);

  const acompanhar = () => {
    try { sessionStorage.setItem('codigo-acesso', codigo.trim().toUpperCase()); } catch { /* sem armazenamento */ }
    ir(`/acompanhar?protocolo=${encodeURIComponent(protocolo.trim().toUpperCase())}`);
  };

  // Atalhos: os servicos do catalogo, com "Outro assunto" sempre por ultimo.
  const todos = catalogo?.servicos ?? [];
  const servicos: Servico[] = [...todos.filter((s) => !/outro/i.test(s.nome)).slice(0, 11), ...todos.filter((s) => /outro/i.test(s.nome))];
  const equipe = pode('demanda.ver');

  return (
    <div className="inicio">
      {equipe && (
        <div className="faixa-equipe">
          <span>Olá, <strong>{usuario?.nome.split(' ')[0]}</strong>. Área da equipe:</span>
          <a href="#/equipe">Abrir a área da equipe</a>
        </div>
      )}
      {instalacao?.parametros.avisoInicio && <div className="aviso info" role="note">{instalacao.parametros.avisoInicio}</div>}

      <section className="heroi">
        <div className="heroi-texto">
          <h1>Viu um problema na sua rua, distrito ou comunidade? Avise a Prefeitura.</h1>
          <p>Registre em 2 minutos e acompanhe cada passo: quem recebeu, quem é o responsável, qual é o prazo e o que foi feito. Funciona no celular, mesmo com internet fraca.</p>
          <div className="linha">
            <a className="botao heroi-cta" href="#/nova">Registrar solicitação</a>
            <a className="heroi-link" href="#/transparencia">Ver os números do atendimento</a>
          </div>
        </div>
        <form className="heroi-acompanhar" onSubmit={(e) => { e.preventDefault(); acompanhar(); }}>
          <h2>Já registrou? Acompanhe</h2>
          <div className="campo"><label htmlFor="h-p">Protocolo</label><input id="h-p" value={protocolo} onChange={(e) => setProtocolo(e.target.value.toUpperCase())} placeholder="SER-2026-000123" autoComplete="off" /></div>
          <div className="campo"><label htmlFor="h-c">Código de acesso</label><input id="h-c" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="6 letras e números" autoComplete="off" /></div>
          <button className="botao" style={{ width: '100%' }} disabled={!protocolo || !codigo}>Consultar</button>
          <p className="ajuda">Os dois estão no comprovante que você recebeu ao registrar.</p>
        </form>
        <Xilogravura className="heroi-paisagem" />
      </section>

      {!online && <Aviso tipo="alerta">Você está sem internet. Mesmo assim pode registrar: a solicitação fica guardada no aparelho e é enviada quando o sinal voltar.</Aviso>}
      {locais.pend > 0 && <Aviso tipo="alerta">{locais.pend} solicitação(ões) deste aparelho aguardando internet para envio.</Aviso>}
      {locais.env.length > 0 && (
        <Aviso tipo="ok">
          Enviadas quando o sinal voltou: {locais.env.map((e) => <span key={e.chave}> <strong>{e.protocolo}</strong> (código <code>{e.codigo}</code>)</span>)}
        </Aviso>
      )}

      {servicos.length > 0 && (
        <section className="bloco" aria-labelledby="t-servicos">
          <div className="bloco-cabeca"><h2 id="t-servicos">O que você precisa?</h2><a href="#/nova">Ver todos os serviços</a></div>
          <ul className="lista-servicos">
            {servicos.map((s) => (
              <li key={s.id}>
                <a href={`#/nova?servico=${s.id}`}>
                  <span className="ls-icone"><IconeServico nome={s.nome} /></span>
                  <span className="ls-nome">{s.nome}</span>
                  <span className="ls-prazo">até {s.prazoDiasUteis} dia{s.prazoDiasUteis > 1 ? 's' : ''} úte{s.prazoDiasUteis > 1 ? 'is' : 'il'}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bloco" aria-labelledby="t-como">
        <h2 id="t-como">Como funciona</h2>
        <ol className="trilha">
          <li><span className="tr-n">1</span><strong>Registre</strong><span>Conte o que aconteceu, marque o local e, se puder, envie uma foto. Pode ser anônimo.</span></li>
          <li><span className="tr-n">2</span><strong>Acompanhe</strong><span>Com o protocolo você vê para qual setor foi, o prazo e cada atualização da equipe.</span></li>
          <li><span className="tr-n">3</span><strong>Avalie</strong><span>Quando terminar, diga se o problema foi resolvido. Sua nota ajuda a melhorar o serviço.</span></li>
        </ol>
      </section>

      {transp.dados && transp.dados.total > 0 && (
        <section className="bloco numeros" aria-label="Números do atendimento">
          <div><span className="num-grande">{fmtNum(transp.dados.total, 0)}</span><span>solicitações nos últimos 90 dias</span></div>
          <div><span className="num-grande">{fmtNum(transp.dados.noPrazoPct, 0, '%')}</span><span>concluídas dentro do prazo</span></div>
          <div><span className="num-grande">{fmtNum(transp.dados.satisfacao, 1)}</span><span>de 5 na avaliação dos cidadãos</span></div>
          <p className="numeros-rodape">{instalacao?.demonstracao ? 'Ambiente de demonstração: números fictícios. ' : ''}<a href="#/transparencia">Transparência e dados abertos</a></p>
        </section>
      )}

      <section className="bloco" aria-labelledby="t-outros">
        <h2 id="t-outros">Outros jeitos de ser atendido</h2>
        <dl className="outros-jeitos">
          <div><dt>Prefere falar com alguém?</dt><dd>Vá ao atendimento da Prefeitura, à ouvidoria ou ao posto do seu distrito, ou ligue. O servidor registra para você e entrega o protocolo impresso. <a href="#/acessibilidade">Ver contatos</a></dd></div>
          <div><dt>Internet fraca?</dt><dd>O site funciona com pouco sinal. As fotos são reduzidas no próprio celular e, sem conexão, o pedido espera e é enviado depois, sem duplicar.</dd></div>
          <div><dt>E os seus dados?</dt><dd>São usados só para este atendimento (LGPD). A equipe de campo não vê seu telefone completo, e os relatórios não identificam ninguém.</dd></div>
        </dl>
      </section>

      {!usuario && (
        <p className="sec rodape-inicio">
          Quer ver todas as suas solicitações em um só lugar? <a href="#/entrar">Crie uma conta</a>, é opcional. Trabalha na Prefeitura? <a href="#/entrar">Entre por aqui</a>.
        </p>
      )}
    </div>
  );
}
