export function renderLogin() {
  return `
    <section class="card auth-card">
      <div class="card-head">
        <div>
          <div class="card-title">Entrar</div>
          <div class="card-sub">Acesse sua conta para abrir os lembretes e notificacoes.</div>
        </div>
      </div>

      <div class="stack" style="max-width: 420px;">
        <div class="field">
          <label for="loginUsernameInput">Usuario</label>
          <input id="loginUsernameInput" type="text" autocomplete="username" placeholder="ex: operador.noc" />
        </div>

        <div class="field">
          <label for="loginPasswordInput">Senha</label>
          <input id="loginPasswordInput" type="password" autocomplete="current-password" placeholder="Sua senha" />
        </div>

        <div class="row">
          <button id="loginSubmitBtn" class="btn btn-primary" type="button">Entrar</button>
          <a class="btn btn-secondary" href="#/register">Criar conta</a>
        </div>
      </div>
    </section>
  `;
}
