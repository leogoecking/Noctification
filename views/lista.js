export function renderLista() {
  return `
    <section class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Lista completa</div>
          <div class="card-sub">Busca, filtros e ações em massa. Ajuste horário direto na linha.</div>
        </div>
        <div class="row end">
          <a class="btn btn-secondary" href="#/dashboard">Voltar ao dashboard</a>
        </div>
      </div>

      <div class="row">
        <div class="field" style="flex:1; min-width: 260px;">
          <label for="searchInput">Buscar</label>
          <input id="searchInput" type="search" placeholder="Filtrar por título..." />
        </div>

        <div class="field">
          <label for="viewSelect">Visão</label>
          <select id="viewSelect">
            <option value="all">Todos</option>
            <option value="upcoming">Próximos</option>
            <option value="overdue">Atrasados</option>
            <option value="done">Concluídos</option>
          </select>
        </div>

        <div class="field" style="min-width: 260px;">
          <label id="counter">—</label>
          <div class="row">
            <button id="markVisibleDoneBtn" class="btn btn-secondary" type="button">Concluir visíveis</button>
            <button id="deleteDoneBtn" class="btn btn-danger" type="button">Excluir concluídos</button>
          </div>
        </div>
      </div>

      <div id="empty" class="empty hidden">Sem lembretes para mostrar.</div>
      <ul id="list" class="list hidden"></ul>
    </section>
  `;
}