export function renderSettings() {
  return `
    <div class="grid cols-2">

      <section class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Pacotes</div>
            <div class="card-sub">Salve o conjunto atual de lembretes e aplique em outra data.</div>
          </div>
        </div>

        <div class="row">
          <div class="field" style="flex:1;">
            <label for="pkgNameInput">Nome do pacote</label>
            <input id="pkgNameInput" type="text" placeholder="Ex: Turno 07h / Rotina NOC" />
          </div>
          <div class="field" style="min-width: 160px;">
            <label>&nbsp;</label>
            <button id="savePackageBtn" class="btn btn-primary" type="button">Salvar</button>
          </div>
        </div>

        <div class="row">
          <div class="field" style="flex:1;">
            <label for="pkgSelect">Selecionar pacote</label>
            <select id="pkgSelect"></select>
            <div id="pkgInfo" class="card-sub"></div>
          </div>

          <div class="field">
            <label for="pkgDateInput">Aplicar na data</label>
            <input id="pkgDateInput" type="date" />
          </div>

          <div class="field" style="min-width: 160px;">
            <label>&nbsp;</label>
            <div class="row">
              <button id="applyPackageBtn" class="btn btn-secondary" type="button">Aplicar</button>
              <button id="deletePackageBtn" class="btn btn-danger" type="button">Excluir</button>
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Backup</div>
            <div class="card-sub">Exporta/Importa lembretes, pacotes e logs.</div>
          </div>
        </div>

        <div class="row">
          <button id="exportBtn" class="btn btn-secondary" type="button">Exportar JSON</button>
          <button id="importBtn" class="btn btn-secondary" type="button">Importar JSON</button>
        </div>

        <div class="empty" style="margin-top: 12px;">
          <b>Importante:</b> o import sobrescreve por <i>id</i>. Se tiver ids iguais, ele atualiza.
        </div>
      </section>

      <section class="card" style="grid-column: 1 / -1;">
        <div class="card-head">
          <div>
            <div class="card-title">Histórico de hoje</div>
            <div class="card-sub">Auditoria leve das ações do dia (criado/disparou/ACK/snooze...).</div>
          </div>
          <div class="row end">
            <button id="clearTodayLogBtn" class="btn btn-danger" type="button">Limpar logs de hoje</button>
          </div>
        </div>

        <div id="logEmpty" class="empty">—</div>
        <ul id="logList" class="list hidden"></ul>
      </section>

    </div>
  `;
}