import { PRESETS_ACESSIBILIDADE, useAcessibilidade } from '../acessibilidade';

export function Configuracoes() {
  const { preset, definirPreset } = useAcessibilidade();
  return (
    <section aria-labelledby="titulo-configuracoes">
      <div className="pagina-cabecalho">
        <div><span className="sobretitulo">Preferencias</span><h2 id="titulo-configuracoes">Configuracoes</h2></div>
      </div>
      <div className="cartao">
        <h3>Acessibilidade</h3>
        <p className="dica">Escolha uma aparencia que facilite sua leitura e navegação. A preferência fica salva somente neste navegador.</p>
        <div className="preset-grade">
          {PRESETS_ACESSIBILIDADE.map((item) => (
            <button
              key={item.id}
              className={preset === item.id ? 'preset selecionado' : 'preset'}
              aria-pressed={preset === item.id}
              onClick={() => definirPreset(item.id)}
            >
              <strong>{item.name}</strong><span>{item.description}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
