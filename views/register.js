export function renderRegister() {
  return `
    <section class="card auth-card">
      <div class="card-head">
        <div>
          <div class="card-title">Criar conta</div>
          <div class="card-sub">Cadastre um usuario para usar o sistema.</div>
        </div>
      </div>

      <div class="stack" style="max-width: 420px;">
        <div class="field">
          <label for="registerUsernameInput">Usuario</label>
          <input id="registerUsernameInput" type="text" autocomplete="username" placeholder="3-40 chars: a-z0-9._-" />
        </div>

        <div class="field">
          <label for="registerPasswordInput">Senha</label>
          <input id="registerPasswordInput" type="password" autocomplete="new-password" placeholder="Minimo 6 caracteres" />
        </div>

        <div class="row">
          <button id="registerSubmitBtn" class="btn btn-primary" type="button">Registrar</button>
          <a class="btn btn-secondary" href="#/login">Ja tenho conta</a>
        </div>
      </div>
    </section>
  `;
}
