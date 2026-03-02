export function renderDashboard() {
  return `
    <section class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Novo lembrete</div>
          <div class="card-sub">Crie rápido e deixe o app te puxar pela fila (com críticos primeiro).</div>
        </div>
      </div>

      <div class="row">
        <div class="field" style="flex:1; min-width: 260px;">
          <label for="titleInput">Título</label>
          <input id="titleInput" type="text" placeholder="Ex: Verificar tráfego Conect / Sparkle" />
        </div>

        <div class="field">
          <label for="newTimeInput">Horário</label>
          <input id="newTimeInput" type="time" value="09:00" />
        </div>

        <div class="field">
          <label for="repeatSelect">Recorrência</label>
          <select id="repeatSelect">
            <option value="none">Uma vez</option>
            <option value="daily">Diário</option>
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensal</option>
          </select>
        </div>

        <div class="field">
          <label for="prioritySelect">Prioridade</label>
          <select id="prioritySelect">
            <option value="normal">Normal</option>
            <option value="critical">CRÍTICO</option>
          </select>
        </div>

        <div class="field" style="min-width: 160px;">
          <label>&nbsp;</label>
          <button id="addBtn" class="btn btn-primary" type="button">Adicionar</button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Lembretes de hoje</div>
          <div class="card-sub">Mostra somente os lembretes com data de hoje (concluídos e pendentes).</div>
        </div>
        <div class="row end">
          <a class="btn btn-secondary" href="#/lista">Abrir lista completa</a>
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
            <option value="today">Hoje</option>
            <option value="upcoming">Próximos</option>
            <option value="overdue">Atrasados</option>
            <option value="done">Concluídos</option>
          </select>
        </div>

        <div class="field" style="min-width: 240px;">
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