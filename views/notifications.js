export function renderNotifications() {
  return `
    <section class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Notificacoes</div>
          <div class="card-sub">Historico completo com filtro e paginacao.</div>
        </div>
        <div class="row end">
          <button id="notifMarkAllBtn" class="btn btn-secondary" type="button">Marcar todas como lidas</button>
        </div>
      </div>

      <div class="row">
        <div class="field" style="min-width: 220px;">
          <label for="notifStatusFilter">Status</label>
          <select id="notifStatusFilter">
            <option value="all">Todas</option>
            <option value="unread">Nao lidas</option>
            <option value="read">Lidas</option>
          </select>
        </div>
      </div>

      <div id="notifPageEmpty" class="empty hidden">Nenhuma notificacao para este filtro.</div>
      <ul id="notifPageList" class="list hidden"></ul>

      <div class="row" style="margin-top: 12px;">
        <button id="notifLoadMoreBtn" class="btn btn-secondary" type="button">Carregar mais</button>
      </div>
    </section>
  `;
}
