# Noctification (Lembretes NOC)
Aplicativo web local para criar, acompanhar e disparar lembretes operacionais com prioridade normal ou critica.

## Funcao do aplicativo
O Noctification foi feito para rotina de NOC (Network Operations Center), ajudando a:
- registrar lembretes com horario e recorrencia
- disparar alerta visual + som no momento certo
- dar tratamento especial para itens criticos (ACK, repeticao de aviso)
- manter historico diario das acoes
- exportar/importar dados em JSON para backup

## Principais recursos
- Dashboard para criacao rapida de lembretes
- Lista completa com busca, filtros e acoes em massa
- Pacotes de lembretes para reaplicar em datas diferentes
- Notificacoes do sistema via Service Worker
- Armazenamento local com IndexedDB (sem backend)
- Deteccao de atraso pos sleep/hibernacao com fila de overdue

## Como os dados funcionam
- Todos os dados ficam locais no navegador (IndexedDB)
- Nada e enviado para servidor remoto pelo app
- O backup e feito por exportacao manual de arquivo JSON

## Executar localmente
Requisitos:
- Node.js 18+

Comandos:
```bash
npm install
npm start
```

O app sobe em:
`http://127.0.0.1:8765/index.html`

## Estrutura
- `index.html`: shell principal da aplicacao
- `js/app.js`: logica principal (agenda, fila, modal, alarmes)
- `js/api.js`: IndexedDB, Service Worker e notificacoes
- `sw.js`: tratamento de clique em notificacoes
- `views/`: telas (dashboard, lista, settings, detalhe)

## Observacoes
- Projeto pensado para uso local/individual
- Para uso multiusuario real, e necessario backend + banco central
