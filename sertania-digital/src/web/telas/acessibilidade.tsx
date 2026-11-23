import { Accessibility, Ear, Eye, Hand, Keyboard, Mic, Phone, Volume2 } from 'lucide-react';
import { AtalhosLista, ComandosLista, ContatoAtendimento, abrirPainelAcessibilidade, ligarComandos } from '../acessibilidade/painel';
import { falaDisponivel, falar, reconhecimentoDisponivel, textoDaPagina } from '../acessibilidade/voz';

/** Declaracao de acessibilidade: o que o site oferece para cada pessoa e como pedir ajuda. */
export function PaginaAcessibilidade() {
  return (
    <div className="pagina-acess">
      <h1>Acessibilidade</h1>
      <p className="sec">O Sertânia Digital foi feito para que qualquer pessoa consiga pedir e acompanhar um serviço da Prefeitura: quem não enxerga ou enxerga pouco, quem não ouve, quem não pode digitar ou usar o mouse, quem tem dificuldade de leitura. E quem não quiser usar o site é atendido por telefone, WhatsApp ou pessoalmente.</p>
      <div className="linha">
        <button type="button" className="botao" onClick={abrirPainelAcessibilidade}><Accessibility size={18} aria-hidden="true" /> Abrir o painel de acessibilidade</button>
        {falaDisponivel() && <button type="button" className="botao sec" onClick={() => falar(textoDaPagina())}><Volume2 size={18} aria-hidden="true" /> Ouvir esta página</button>}
        {reconhecimentoDisponivel() && <button type="button" className="botao sec" onClick={() => ligarComandos(true)}><Mic size={18} aria-hidden="true" /> Ligar comandos de voz</button>}
      </div>

      <div className="grade-acess">
        <section className="cartao">
          <h2><Eye size={20} aria-hidden="true" /> Para quem não enxerga ou enxerga pouco</h2>
          <ul>
            <li>Funciona com leitores de tela (NVDA, JAWS, TalkBack, VoiceOver): títulos, campos e botões têm nome, e avisos e erros são anunciados.</li>
            <li>Leitura em voz alta da página, ou só do que você tocar ou selecionar, com velocidade ajustável.</li>
            <li>Letras em três tamanhos, alto contraste, modo escuro, tons de cinza, cursor grande e destaque de links.</li>
            <li>Fonte Atkinson Hyperlegible, desenhada para pessoas com baixa visão.</li>
            <li>Nada depende só de cor: situação e prazo sempre vêm escritos.</li>
          </ul>
        </section>
        <section className="cartao">
          <h2><Ear size={20} aria-hidden="true" /> Para quem não ouve</h2>
          <ul>
            <li>Tradutor para Libras (VLibras, do Governo Federal): ligue no painel, clique na mão azul e no texto.</li>
            <li>O site não usa som para avisar nada. Tudo aparece por escrito, e a leitura em voz alta também mostra legenda.</li>
            <li>Acompanhamento pelo protocolo e contato por mensagem de texto, sem precisar ligar.</li>
          </ul>
        </section>
        <section className="cartao">
          <h2><Mic size={20} aria-hidden="true" /> Para quem não pode digitar ou usar o mouse</h2>
          <ul>
            <li>Botão de microfone no relato da solicitação: fale e o texto aparece. Ligue o ditado no painel para usar em qualquer campo.</li>
            <li>Comandos de voz: navegue, escolha opções e envie falando. “Mostrar números” numera tudo que dá para clicar.</li>
            <li>Todo o site funciona só com o teclado, com atalhos.</li>
            <li>Botões e campos maiores, para quem tem tremor ou usa o dedo.</li>
          </ul>
        </section>
        <section className="cartao">
          <h2><Hand size={20} aria-hidden="true" /> Para leitura e atenção</h2>
          <ul>
            <li>Linguagem simples e formulário em 5 passos curtos.</li>
            <li>Fonte de leitura fácil e espaçamento maior (ajuda pessoas com dislexia).</li>
            <li>Guia de leitura que destaca a linha atual e opção para tirar animações.</li>
          </ul>
        </section>
      </div>

      <div className="grade g2">
        <section className="cartao">
          <h2><Keyboard size={20} aria-hidden="true" /> Atalhos de teclado</h2>
          <AtalhosLista />
        </section>
        <section className="cartao">
          <h2><Mic size={20} aria-hidden="true" /> Comandos de voz</h2>
          {reconhecimentoDisponivel() ? <ComandosLista /> : <p className="sec">Este navegador não reconhece voz. Use o Chrome ou o Edge, ou o microfone do teclado do celular para ditar.</p>}
        </section>
      </div>

      <section className="cartao" style={{ marginTop: 16 }}>
        <h2><Phone size={20} aria-hidden="true" /> Atendimento sem usar o site</h2>
        <ContatoAtendimento />
      </section>

      <section className="cartao" style={{ marginTop: 16 }}>
        <h2>Encontrou uma barreira?</h2>
        <p>O site segue como referência o eMAG (Modelo de Acessibilidade em Governo Eletrônico) e as WCAG 2.2, nível AA. Se algo não funcionou para você, conte para a Prefeitura pelos contatos acima ou registre uma solicitação. As preferências do painel ficam guardadas só no seu aparelho.</p>
      </section>
    </div>
  );
}
