export function renderAdmin() {
  return `
    <div class="grid cols-2">
      <section class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Usuarios cadastrados</div>
            <div class="card-sub">Selecione um ou mais destinatarios.</div>
          </div>
          <div class="row end">
            <button id="adminSelectAllBtn" class="btn btn-secondary" type="button">Selecionar todos</button>
          </div>
        </div>

        <div id="adminUsersEmpty" class="empty hidden">Nenhum usuario disponivel.</div>
        <ul id="adminUsersList" class="list hidden"></ul>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Enviar notificacao</div>
            <div id="adminRecipientCount" class="card-sub">0 destinatario(s) selecionado(s)</div>
          </div>
        </div>

        <div class="stack">
          <div class="field">
            <label for="adminNotifTitleInput">Titulo</label>
            <input id="adminNotifTitleInput" type="text" placeholder="Titulo da notificacao" />
          </div>

          <div class="field">
            <label for="adminNotifMessageInput">Mensagem</label>
            <textarea id="adminNotifMessageInput" rows="6" placeholder="Mensagem para os usuarios"></textarea>
          </div>

          <div class="row">
            <button id="adminSendNotifBtn" class="btn btn-primary" type="button">Enviar notificacao</button>
          </div>
        </div>
      </section>
    </div>
  `;
}
