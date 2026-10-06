/*
 * Alias da conta administrativa local de demonstracao.
 *
 * O realm de cidadaos usa e-mail como identificador. A conta demonstrativa
 * continua armazenada como `admin@exemplo.invalid`, mas o atalho solicitado
 * `admin/admin` deve funcionar no formulario sem alterar o fluxo OIDC.
 */
(function () {
  'use strict';

  function configurarAlias() {
    var formulario = document.getElementById('kc-form-login');
    var usuario = document.getElementById('username');
    if (!formulario || !usuario) return;

    formulario.addEventListener('submit', function () {
      if (usuario.value.trim().toLowerCase() === 'admin') {
        usuario.value = 'admin@exemplo.invalid';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', configurarAlias);
  } else {
    configurarAlias();
  }
})();
