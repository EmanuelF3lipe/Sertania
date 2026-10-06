import { useEffect, useState } from 'react';
import { PRESETS_ACESSIBILIDADE, useAcessibilidade } from '../acessibilidade';
import { useTema } from '../tema';

type IconName =
  | 'accessibility'
  | 'arrow-right'
  | 'building'
  | 'check'
  | 'chat'
  | 'clock'
  | 'edit'
  | 'lock'
  | 'menu'
  | 'mobile'
  | 'spark'
  | 'shield'
  | 'user';

function Icon({ name, size = 22 }: { readonly name: IconName; readonly size?: number }) {
  const propriedades = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };

  switch (name) {
    case 'accessibility':
      return (
        <svg {...propriedades}>
          <circle cx="12" cy="4.5" r="1.8" />
          <path d="M5 8.2h14M12 8.2v11.3M8.2 20l3.8-6.1 3.8 6.1M8.2 12.1 5.8 18M15.8 12.1l2.4 5.9" />
        </svg>
      );
    case 'arrow-right':
      return (
        <svg {...propriedades}>
          <path d="M4 12h15M13 6l6 6-6 6" />
        </svg>
      );
    case 'building':
      return (
        <svg {...propriedades}>
          <path d="M4 20h16M6 20V5.5L12 3l6 2.5V20M9 8h1M14 8h1M9 12h1M14 12h1M10 20v-4h4v4" />
        </svg>
      );
    case 'check':
      return (
        <svg {...propriedades}>
          <path d="m5 12.5 4.2 4.2L19.5 6.5" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...propriedades}>
          <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.8 8.8 0 0 1-3.4-.7L4 20l1.7-3.7A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" />
          <path d="M8.5 12h.1M12 12h.1M15.5 12h.1" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...propriedades}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3.5 2" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...propriedades}>
          <path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5l-1 3Z" />
          <path d="m14.5 7.5 2 2" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...propriedades}>
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...propriedades}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case 'mobile':
      return (
        <svg {...propriedades}>
          <rect x="7" y="3" width="10" height="18" rx="2" />
          <path d="M10.5 6h3M11 17.5h2" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...propriedades}>
          <path d="m12 3 1.3 4.7L18 9l-4.7 1.3L12 15l-1.3-4.7L6 9l4.7-1.3L12 3ZM19 15l.6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6L19 15Z" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...propriedades}>
          <path d="M12 3.5 19 6v5.3c0 4.5-2.8 7.8-7 9.2-4.2-1.4-7-4.7-7-9.2V6l7-2.5Z" />
          <path d="m8.5 12 2.2 2.2 4.8-4.8" />
        </svg>
      );
    case 'user':
      return (
        <svg {...propriedades}>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
  }
}

function loginHref(perfil: 'cidadao' | 'servidor', destino: string): string {
  const retorno = destino.startsWith('/') ? destino : '/minhas';
  return `/api/v1/auth/login/${perfil}?voltar=${encodeURIComponent(retorno)}`;
}

function mensagemDeLogin(): string | null {
  if (window.location.pathname !== '/entrar') return null;
  const codigo = new URLSearchParams(window.location.search).get('erro');
  switch (codigo) {
    case 'login_cancelado':
      return 'O login foi cancelado. Quando quiser, você pode tentar novamente.';
    case 'resposta_incompleta':
      return 'O provedor não concluiu o login. Tente novamente para continuar.';
    case 'sessao_invalida':
      return 'Esta tentativa de login expirou ou já foi utilizada. Comece novamente.';
    case 'conta_bloqueada':
      return 'O acesso está temporariamente bloqueado. Procure a administração da prefeitura.';
    case 'email_nao_verificado':
      return 'Confirme seu e-mail antes de entrar no ambiente institucional.';
    case 'falha_no_login':
      return 'Não foi possível concluir o login agora. Tente novamente em instantes.';
    default:
      return null;
  }
}

function AcessibilidadeRapida({ aoAbrir }: { readonly aoAbrir: () => void }) {
  const [aberta, definirAberta] = useState(false);
  const { preset, definirPreset } = useAcessibilidade();
  const { tema, alternarTema } = useTema();

  useEffect(() => {
    if (!aberta) return undefined;
    const aoPressionar = (event: KeyboardEvent) => {
      if (event.key === 'Escape') definirAberta(false);
    };
    document.addEventListener('keydown', aoPressionar);
    return () => document.removeEventListener('keydown', aoPressionar);
  }, [aberta]);

  return (
    <div className="landing-acessibilidade">
      <button
        className="landing-acessibilidade-botao"
        type="button"
        aria-expanded={aberta}
        aria-controls="painel-acessibilidade"
        onClick={() => {
          aoAbrir();
          definirAberta((valor) => !valor);
        }}
      >
        <Icon name="accessibility" size={18} />
        <span>Acessibilidade</span>
      </button>
      {aberta && (
        <div className="landing-acessibilidade-painel" id="painel-acessibilidade" role="dialog" aria-label="Opções de acessibilidade">
          <div className="landing-acessibilidade-titulo">
            <div>
              <strong>Personalize sua experiência</strong>
              <span>Escolha uma opção visual.</span>
            </div>
            <button
              className="landing-fechar-painel"
              type="button"
              aria-label="Fechar opções de acessibilidade"
              onClick={() => definirAberta(false)}
            >
              ×
            </button>
          </div>
          <div className="landing-acessibilidade-opcoes">
            {PRESETS_ACESSIBILIDADE.map((opcao) => (
              <button
                className={preset === opcao.id ? 'selecionado' : ''}
                key={opcao.id}
                type="button"
                aria-pressed={preset === opcao.id}
                onClick={() => definirPreset(opcao.id)}
              >
                <strong>{opcao.name}</strong>
                <span>{opcao.description}</span>
                </button>
              ))}
            <button
              className={tema === 'escuro' ? 'selecionado' : ''}
              type="button"
              aria-pressed={tema === 'escuro'}
              onClick={alternarTema}
            >
              <strong>{tema === 'escuro' ? 'Modo claro' : 'Modo escuro'}</strong>
              <span>{tema === 'escuro' ? 'Volta para o fundo claro.' : 'Reduz a luminosidade da tela.'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const BENEFICIOS: ReadonlyArray<{
  readonly icon: IconName;
  readonly titulo: string;
  readonly texto: string;
}> = [
  {
    icon: 'edit',
    titulo: 'Solicite sem complicação',
    texto: 'Explique o que você precisa e envie sua solicitação em poucos passos.',
  },
  {
    icon: 'clock',
    titulo: 'Acompanhe cada etapa',
    texto: 'Consulte o protocolo e veja com clareza o andamento do atendimento.',
  },
  {
    icon: 'chat',
    titulo: 'Converse com a equipe',
    texto: 'Responda mensagens e complemente informações sem sair do portal.',
  },
  {
    icon: 'mobile',
    titulo: 'Use onde estiver',
    texto: 'Uma experiência leve e responsiva para computador, tablet ou celular.',
  },
];

const ETAPAS: ReadonlyArray<{
  readonly numero: string;
  readonly titulo: string;
  readonly texto: string;
}> = [
  {
    numero: '01',
    titulo: 'Entre com segurança',
    texto: 'Escolha seu perfil e acesse o portal com uma autenticação protegida.',
  },
  {
    numero: '02',
    titulo: 'Conte o que aconteceu',
    texto: 'Selecione o serviço, descreva a situação e envie os detalhes importantes.',
  },
  {
    numero: '03',
    titulo: 'Acompanhe até resolver',
    texto: 'Guarde seu protocolo, acompanhe a equipe e participe da solução.',
  },
];

const PRINCIPIOS: ReadonlyArray<{
  readonly icon: IconName;
  readonly titulo: string;
  readonly texto: string;
}> = [
  {
    icon: 'shield',
    titulo: 'Transparência',
    texto: 'Você sabe onde sua solicitação está e quais são os próximos passos.',
  },
  {
    icon: 'lock',
    titulo: 'Proteção de dados',
    texto: 'A sessão é protegida e as informações são acessadas apenas por quem precisa atendê-las.',
  },
  {
    icon: 'accessibility',
    titulo: 'Acesso para todos',
    texto: 'Recursos de contraste, texto ampliado e redução de movimento ficam sempre à mão.',
  },
];

export function LandingPage({ destino }: { readonly destino: string }) {
  const [menuAberto, definirMenuAberto] = useState(false);
  const hrefCidadao = loginHref('cidadao', destino);
  const hrefServidor = loginHref('servidor', destino);
  const erroLogin = mensagemDeLogin();

  const fecharMenu = () => definirMenuAberto(false);

  return (
    <div className="landing" id="inicio">
      <a className="pular-para-conteudo" href="#conteudo">Pular para o conteúdo</a>

      <header className="landing-cabecalho">
        <div className="landing-shell landing-cabecalho-conteudo">
          <a className="landing-marca" href="#inicio" onClick={fecharMenu} aria-label="Sertania, início">
            <span className="landing-marca-simbolo" aria-hidden="true">S</span>
            <span className="landing-marca-texto">
              <strong>Sertania</strong>
              <small>Prefeitura Municipal</small>
            </span>
          </a>

          <button
            className="landing-menu-botao"
            type="button"
            aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuAberto}
            aria-controls="navegacao-publica"
            onClick={() => definirMenuAberto((valor) => !valor)}
          >
            <Icon name="menu" size={22} />
          </button>

          <nav
            className={`landing-navegacao${menuAberto ? ' aberto' : ''}`}
            id="navegacao-publica"
            aria-label="Navegação principal"
          >
            <a href="#inicio" onClick={fecharMenu}>Início</a>
            <a href="#servicos" onClick={fecharMenu}>O que você pode fazer</a>
            <a href="#como-funciona" onClick={fecharMenu}>Como funciona</a>
            <a href="#seguranca" onClick={fecharMenu}>Segurança</a>
            <a className="landing-navegacao-entrar" href={hrefCidadao} onClick={fecharMenu}>Entrar</a>
            <a className="landing-navegacao-servidor" href={hrefServidor} onClick={fecharMenu}>Acesso prefeitura</a>
          </nav>

          <AcessibilidadeRapida aoAbrir={fecharMenu} />
        </div>
      </header>

      {erroLogin !== null && (
        <div className="landing-alerta-login" role="alert">
          <div className="landing-shell landing-alerta-login-conteudo">
            <span className="landing-alerta-login-icone"><Icon name="shield" size={18} /></span>
            <p>{erroLogin}</p>
            <a href={hrefCidadao}>Tentar novamente <Icon name="arrow-right" size={16} /></a>
          </div>
        </div>
      )}

      <main id="conteudo">
        <section className="landing-hero" aria-labelledby="titulo-hero">
          <div className="landing-shell landing-hero-grid">
            <div className="landing-hero-conteudo">
              <p className="landing-sobretitulo"><span aria-hidden="true" /> Portal de serviços públicos</p>
              <h1 id="titulo-hero">Uma cidade que <em>escuta, responde</em> e avança.</h1>
              <p className="landing-hero-introducao">
                Resolva o que precisa com a Prefeitura de Sertania em um só lugar — do primeiro pedido ao acompanhamento da solução.
              </p>
              <div className="landing-hero-acoes">
                <a className="landing-botao landing-botao-principal" href={hrefCidadao}>
                  Começar agora <Icon name="arrow-right" size={19} />
                </a>
                <a className="landing-botao landing-botao-secundario" href="#como-funciona">
                  Entenda como funciona
                </a>
                <a
                  className="landing-botao landing-botao-inicializador"
                  href="/iniciar-app.bat"
                  download="iniciar-app.bat"
                  title="Baixe e coloque o arquivo na raiz do projeto para iniciar a aplicação no Windows"
                >
                  Inicializador Windows
                </a>
              </div>
              <p className="landing-inicializador-ajuda">
                Para desenvolvimento local: baixe o inicializador e execute-o na raiz do projeto.
              </p>
              <div className="landing-confiança" aria-label="Benefícios do portal">
                <span><Icon name="check" size={16} /> Protocolo para acompanhar</span>
                <span><Icon name="check" size={16} /> Atendimento mais transparente</span>
              </div>
            </div>

            <div className="landing-hero-visual" aria-label="Exemplo visual de acompanhamento de uma solicitação">
              <div className="landing-visual-brilho landing-visual-brilho-um" aria-hidden="true" />
              <div className="landing-visual-brilho landing-visual-brilho-dois" aria-hidden="true" />
              <div className="landing-demonstracao">
                <div className="landing-demonstracao-barra" aria-hidden="true">
                  <span /><span /><span />
                  <small>sertania.gov.br</small>
                </div>
                <div className="landing-demonstracao-corpo">
                  <div className="landing-demonstracao-cabecalho">
                    <div>
                      <span className="landing-demo-legenda">EXEMPLO DE ACOMPANHAMENTO</span>
                      <strong>Iluminação pública</strong>
                    </div>
                    <span className="landing-demo-status"><i /> Em andamento</span>
                  </div>
                  <div className="landing-demo-protocolo">
                    <span>Protocolo</span>
                    <strong>SER-2026-0000</strong>
                  </div>
                  <ol className="landing-demo-etapas">
                    <li className="concluida"><span><Icon name="check" size={13} /></span><div><strong>Solicitação recebida</strong><small>Seu pedido chegou à prefeitura</small></div></li>
                    <li className="concluida"><span><Icon name="check" size={13} /></span><div><strong>Em análise</strong><small>A equipe está avaliando o caso</small></div></li>
                    <li className="atual"><span><i /></span><div><strong>Em atendimento</strong><small>Próxima atualização em breve</small></div></li>
                    <li><span /></li>
                  </ol>
                  <div className="landing-demo-rodape"><Icon name="shield" size={16} /> Acompanhamento seguro e transparente</div>
                </div>
              </div>
              <div className="landing-cartao-flutuante"><span><Icon name="spark" size={17} /></span><div><strong>Você no controle</strong><small>Informação em cada etapa</small></div></div>
            </div>
          </div>
        </section>

        <section className="landing-confiança-faixa" aria-label="Destaques do portal">
          <div className="landing-shell landing-confiança-grid">
            <span className="landing-confiança-titulo">Um jeito mais simples de falar com a prefeitura</span>
            <span><Icon name="shield" size={19} /> Acesso protegido</span>
            <span><Icon name="clock" size={19} /> Acompanhe quando quiser</span>
            <span><Icon name="chat" size={19} /> Comunicação em um só lugar</span>
          </div>
        </section>

        <section className="landing-secao" id="servicos" aria-labelledby="titulo-beneficios">
          <div className="landing-shell">
            <div className="landing-secao-cabecalho">
              <div>
                <p className="landing-kicker">Tudo mais perto</p>
                <h2 id="titulo-beneficios">Do pedido à solução, sem perder o fio.</h2>
              </div>
              <p>O portal organiza sua conversa com o município para você gastar menos tempo procurando informações e mais tempo acompanhando o que importa.</p>
            </div>
            <div className="landing-beneficios-grid">
              {BENEFICIOS.map((beneficio, indice) => (
                <article className="landing-beneficio" key={beneficio.titulo}>
                  <span className={`landing-beneficio-icone numero-${indice + 1}`}><Icon name={beneficio.icon} size={24} /></span>
                  <span className="landing-beneficio-numero">0{indice + 1}</span>
                  <h3>{beneficio.titulo}</h3>
                  <p>{beneficio.texto}</p>
                  <a href={hrefCidadao}>Acessar portal <Icon name="arrow-right" size={16} /></a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-secao landing-secao-clara" id="como-funciona" aria-labelledby="titulo-como-funciona">
          <div className="landing-shell">
            <div className="landing-secao-centralizada">
              <p className="landing-kicker">Sem burocracia desnecessária</p>
              <h2 id="titulo-como-funciona">Resolver pode ser simples.</h2>
              <p>Três passos para registrar uma demanda e continuar por dentro de tudo.</p>
            </div>
            <ol className="landing-etapas-grid">
              {ETAPAS.map((etapa) => (
                <li className="landing-etapa" key={etapa.numero}>
                  <span className="landing-etapa-numero">{etapa.numero}</span>
                  <div className="landing-etapa-linha" aria-hidden="true" />
                  <h3>{etapa.titulo}</h3>
                  <p>{etapa.texto}</p>
                </li>
              ))}
            </ol>
            <div className="landing-secao-acao"><a className="landing-link-destaque" href={hrefCidadao}>Abrir uma solicitação <Icon name="arrow-right" size={18} /></a></div>
          </div>
        </section>

        <section className="landing-secao landing-secao-seguranca" id="seguranca" aria-labelledby="titulo-seguranca">
          <div className="landing-shell landing-seguranca-grid">
            <div className="landing-seguranca-intro">
              <p className="landing-kicker">Cuidado em cada detalhe</p>
              <h2 id="titulo-seguranca">Tecnologia para aproximar. Respeito para proteger.</h2>
              <p>O atendimento digital precisa ser fácil para quem usa e responsável com as informações que recebe. Por isso, o Sertania combina clareza, segurança e recursos de acessibilidade desde o primeiro acesso.</p>
              <div className="landing-selo"><span><Icon name="shield" size={20} /></span><div><strong>Feito para o serviço público</strong><small>Transparência, segurança e inclusão como padrão.</small></div></div>
            </div>
            <div className="landing-principios-grid">
              {PRINCIPIOS.map((principio) => (
                <article className="landing-principio" key={principio.titulo}>
                  <span className="landing-principio-icone"><Icon name={principio.icon} size={22} /></span>
                  <div><h3>{principio.titulo}</h3><p>{principio.texto}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-secao landing-faq-secao" aria-labelledby="titulo-faq">
          <div className="landing-shell landing-faq-grid">
            <div className="landing-faq-intro">
              <p className="landing-kicker">Ainda ficou alguma dúvida?</p>
              <h2 id="titulo-faq">Perguntas frequentes</h2>
              <p>Se precisar de ajuda, comece por aqui. As respostas foram escritas para serem diretas e fáceis de entender.</p>
              <a className="landing-link-destaque" href={hrefCidadao}>Entrar no portal <Icon name="arrow-right" size={18} /></a>
            </div>
            <div className="landing-perguntas">
              <details>
                <summary>Preciso criar uma conta para usar o portal?</summary>
                <p>Você entra usando a autenticação do portal. No primeiro acesso como cidadão, sua identidade é vinculada ao atendimento sem que o sistema peça uma senha paralela.</p>
              </details>
              <details>
                <summary>Como acompanho uma solicitação que já enviei?</summary>
                <p>Depois de entrar, acesse “Minhas solicitações”. Lá ficam o protocolo, o estado atual, as atualizações da equipe e as mensagens do atendimento.</p>
              </details>
              <details>
                <summary>Sou servidor. Onde faço meu acesso?</summary>
                <p>Use o botão “Acesso prefeitura” no topo. O acesso institucional é separado do cidadão e conta com uma camada adicional de proteção.</p>
              </details>
              <details>
                <summary>O portal funciona no celular?</summary>
                <p>Sim. A interface foi pensada para se adaptar a telas pequenas e também oferece opções de texto ampliado, alto contraste e menos movimento.</p>
              </details>
            </div>
          </div>
        </section>

        <section className="landing-cta" aria-labelledby="titulo-cta">
          <div className="landing-shell landing-cta-conteudo">
            <div><span className="landing-cta-estrela" aria-hidden="true"><Icon name="spark" size={22} /></span><h2 id="titulo-cta">Sua voz ajuda Sertania a avançar.</h2><p>Quando você participa, a prefeitura entende melhor e consegue agir com mais precisão.</p></div>
            <div className="landing-cta-acoes"><a className="landing-botao landing-botao-claro" href={hrefCidadao}>Começar como cidadão <Icon name="arrow-right" size={18} /></a><a className="landing-cta-link" href={hrefServidor}>Sou servidor da prefeitura</a></div>
          </div>
        </section>
      </main>

      <footer className="landing-rodape">
        <div className="landing-shell landing-rodape-grid">
          <div className="landing-rodape-marca"><a className="landing-marca landing-marca-rodape" href="#inicio"><span className="landing-marca-simbolo" aria-hidden="true">S</span><span className="landing-marca-texto"><strong>Sertania</strong><small>Prefeitura Municipal</small></span></a><p>Serviços públicos mais simples, acessíveis e próximos de você.</p></div>
          <div className="landing-rodape-coluna"><strong>Acesso rápido</strong><a href="#servicos">O que você pode fazer</a><a href="#como-funciona">Como funciona</a><a href="#seguranca">Segurança</a></div>
          <div className="landing-rodape-coluna"><strong>Entrar</strong><a href={hrefCidadao}>Portal do cidadão</a><a href={hrefServidor}>Acesso prefeitura</a><a href="#inicio">Voltar ao início</a></div>
        </div>
        <div className="landing-rodape-base"><div className="landing-shell"><span>© {new Date().getFullYear()} Prefeitura Municipal de Sertania</span><span>Atendimento público com transparência e respeito.</span></div></div>
      </footer>
    </div>
  );
}
