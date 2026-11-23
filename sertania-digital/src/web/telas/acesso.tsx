import { useState } from 'react';
import type { UsuarioSessao } from '../../shared/dominio';
import { post } from '../api';
import { ir, useEstado } from '../nucleo';
import { Aviso } from '../componentes/comuns';

/** Tela unica de uma instalacao nova: cria o primeiro administrador com o codigo do terminal. */
export function PrimeiroAcesso() {
  const { definirUsuario, recarregarInstalacao } = useEstado();
  const [f, setF] = useState({ codigo: '', nome: '', email: '', senha: '', confirma: '' });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setErro(null);
    if (f.senha !== f.confirma) return setErro('As senhas não conferem.');
    setEnviando(true);
    try {
      const r = await post<{ csrf: string; usuario: UsuarioSessao }>('/configuracao/primeiro-acesso', f);
      definirUsuario(r.usuario, r.csrf);
      recarregarInstalacao();
      ir('/equipe');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="estreito" style={{ maxWidth: 560 }}>
      <h1>Bem-vindo ao Sertânia Digital</h1>
      <p className="sec">Esta instalação ainda não tem administrador. Crie agora a conta da pessoa responsável pela configuração. Normalmente é alguém da Secretaria de Administração ou da TI.</p>
      <form className="cartao" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <div className="campo">
          <label htmlFor="pa-c">Código de instalação</label>
          <input id="pa-c" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value.toUpperCase() })} autoComplete="off" style={{ fontFamily: 'ui-monospace, Consolas, monospace', letterSpacing: '0.15em' }} />
          <div className="ajuda">Aparece no terminal (ou no log) onde o servidor foi iniciado. Ele impede que outra pessoa assuma o sistema antes de você.</div>
        </div>
        <div className="campo"><label htmlFor="pa-n">Seu nome completo</label><input id="pa-n" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoComplete="name" /></div>
        <div className="campo"><label htmlFor="pa-e">E-mail institucional</label><input id="pa-e" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" /></div>
        <div className="grade g2">
          <div className="campo"><label htmlFor="pa-s">Senha</label><input id="pa-s" type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} autoComplete="new-password" /></div>
          <div className="campo"><label htmlFor="pa-s2">Repita a senha</label><input id="pa-s2" type="password" value={f.confirma} onChange={(e) => setF({ ...f, confirma: e.target.value })} autoComplete="new-password" /></div>
        </div>
        <div className="ajuda" style={{ marginBottom: 12 }}>Mínimo de 8 caracteres, com letras e números.</div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <button className="botao" style={{ width: '100%' }} disabled={enviando}>{enviando ? 'Criando…' : 'Criar administrador e começar'}</button>
      </form>
    </div>
  );
}

/** Servidor com senha provisoria (criada pelo administrador) troca antes de usar o sistema. */
export function TrocarSenha() {
  const { usuario, definirUsuario, sair } = useEstado();
  const [f, setF] = useState({ atual: '', nova: '', confirma: '' });
  const [erro, setErro] = useState<string | null>(null);
  const enviar = async () => {
    setErro(null);
    if (f.nova !== f.confirma) return setErro('As senhas novas não conferem.');
    try {
      const r = await post<{ csrf: string; usuario: UsuarioSessao }>('/auth/trocar-senha', { atual: f.atual, nova: f.nova });
      definirUsuario(r.usuario, r.csrf);
      ir(r.usuario.papel === 'CIDADAO' ? '/minhas' : '/equipe');
    } catch (e) {
      setErro((e as Error).message);
    }
  };
  return (
    <div className="estreito" style={{ maxWidth: 480 }}>
      <h1>Crie sua senha</h1>
      <p className="sec">Olá, {usuario?.nome.split(' ')[0]}! Você entrou com uma senha provisória. Para proteger os dados dos cidadãos, crie uma senha só sua antes de continuar.</p>
      <form className="cartao" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <div className="campo"><label htmlFor="ts-a">Senha provisória</label><input id="ts-a" type="password" value={f.atual} onChange={(e) => setF({ ...f, atual: e.target.value })} autoComplete="current-password" /></div>
        <div className="campo"><label htmlFor="ts-n">Nova senha</label><input id="ts-n" type="password" value={f.nova} onChange={(e) => setF({ ...f, nova: e.target.value })} autoComplete="new-password" /><div className="ajuda">Mínimo de 8 caracteres, com letras e números.</div></div>
        <div className="campo"><label htmlFor="ts-c">Repita a nova senha</label><input id="ts-c" type="password" value={f.confirma} onChange={(e) => setF({ ...f, confirma: e.target.value })} autoComplete="new-password" /></div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="linha entre"><button className="botao">Salvar senha</button><button type="button" className="botao sec" onClick={() => void sair()}>Sair</button></div>
      </form>
    </div>
  );
}
