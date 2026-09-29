/**
 * Configuracao do Vite para a interface da prefeitura.
 *
 * Duas decisoes que tem efeito sobre seguranca, e nao so sobre produtividade:
 *
 * 1. O DEV SERVER FAZ PROXY para a API, em vez de a interface chamar
 *    `http://localhost:3000` direto. Isso mantem a interface e a API na MESMA
 *    origem durante o desenvolvimento, e e o que permite usar o cookie de
 *    sessao sem `SameSite=None` e sem `Secure` local. Um `cors` frouxo seria a
 *    alternativa, e ela enfraqueceria justamente o cookie que substitui o token.
 *
 * 2. O build nao embute valores de ambiente. A URL da API vem de
 *    `VITE_API_URL` no momento do build; quando ela falta, o codigo usa a mesma
 *    origem, que e o caso do deploy com proxy. Nenhum segredo entra no pacote do
 *    navegador: token nenhum chega aqui, e a interface nao guarda nada.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // `strictPort`: sem isso o Vite escolheria outra porta e o redirecionamento
    // do login, que aponta para `http://localhost:5173`, cairia numa pagina de
    // erro sem explicacao.
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
