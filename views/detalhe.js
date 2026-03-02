export function renderDetalhe({ params }) {
  const id = params.get("id") || "";
  return `
    <section class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Detalhe do lembrete</div>
          <div class="card-sub">ID: ${id ? `<code>${id}</code>` : "—"}</div>
        </div>
        <div class="row end">
          <a class="btn btn-secondary" href="#/lista">Voltar</a>
        </div>
      </div>

      <div class="empty">
        Esta tela é opcional. Se você quiser, eu adapto para editar tudo do lembrete aqui
        (título, prioridade, recorrência, data base, etc.).
      </div>
    </section>
  `;
}