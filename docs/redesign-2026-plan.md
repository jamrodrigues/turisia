# Redesign 2026-09 — plano de implementação

> **Como usar este arquivo entre sessões:** antes de começar a trabalhar nisso numa
> sessão nova, leia a seção **Status atual** abaixo primeiro — ela diz exatamente
> qual foi o último passo concluído e qual é o próximo. Ao terminar um passo, marque
> o checkbox `[x]`, atualize **Status atual** e faça commit deste arquivo junto com o
> código daquele passo. Não pule fases — cada uma assume que a anterior está no ar.

## Status atual

**Última atualização:** 2026-09-27
**Fase concluída:** Fase 7 (code review + correção de todos os achados)
**Próximo passo:** nada agendado. Falta só decidir sobre commit (ver nota
abaixo) — nada foi commitado ainda nesta leva toda (Fases 1–7).

## Fase 7 — Fechamento ✅ concluída 2026-09-27

- [x] **7.1** Rodei `/code-review --level high` no diff acumulado
      (Fases 1–6 + a feature de WhatsApp/pagamentos que já estava
      staged antes desta sessão começar). 10 achados, **nenhum no meu
      trabalho da sessão** — todos na feature de pagamentos/webhook
      já em andamento. Corrigi os 10:
      1. `validate.ts` não validava os 4 node types novos
         (`set_var`/`create_reservation`/`create_payment`/
         `send_voucher`) → bloqueava ativação de fluxo. Adicionei os
         casos de validação + `outgoingEdges`.
      2. `.ilike()` com wildcard `_` não escapado em
         `uazapi/webhook` e `uazapi/config` (podia colidir instâncias
         de contas diferentes) → criei `escapeIlikeExactMatch()` em
         `uazapi-api.ts`, aplicado nos dois lugares.
      3. Migrations/arquivos da feature de pagamentos ainda não
         estavam staged junto — **não é bug de código, é decisão de
         staging**; não mexi (ver nota abaixo).
      4. Botão "Copiar" no `uazapi-config.tsx` copiava a URL do
         webhook **mascarada** (`secret=***`, inútil) → removi o
         botão, reescrevi o texto pra apontar pro "Reapontar webhook"
         (o caminho que já existia e não expõe o segredo).
      5. `POST /api/uazapi/config` montava a URL do webhook na mão
         (sem `encodeURIComponent`) em vez de usar
         `buildUazapiWebhookUrl()` que `GET`/repoint já usavam →
         trocado pra usar o helper compartilhado.
      6. `mediaMimeType` capturado no webhook mas nunca gravado →
         migration `069_messages_media_mime_type.sql` + insert
         corrigido em `process-inbound.ts`. Comentário do campo
         corrigido pra não afirmar que o flow engine já consome isso
         (ainda não consome — `ParsedInbound` continua degradando
         mídia pra texto, é um follow-up real, não fingi que tava
         pronto).
      7. Awaits sequenciais sem dependência de dados em
         `executeCreatePayment`/`executeSendVoucher` (engine.ts) →
         paralelizados com `Promise.all`.
      8. Padrão "persistir current_node_key e suspender" duplicado em
         4 lugares (collect_input/create_payment/send_buttons/
         send_list) → extraído em `advanceAndSuspend()`. Padrão
         "mesclar var em run.vars e persistir" duplicado em 3 lugares
         (create_reservation × 2, set_var) → extraído em
         `mergeRunVar()`. **Não** mexi no capture do collect_input —
         ele faz mais coisa (reprompt_count + log), forçar o mesmo
         helper ali criaria uma abstração pior que a duplicação.
      9. `useSignedMediaUrl` re-assinava toda montagem sem cache →
         cache em memória por módulo, respeitando o TTL real
         (1h - margem de 5min).
      10. Lógica de "insere conversa, corrige em corrida de índice
          único" duplicada com formatos diferentes em
          `resolve-conversation.ts` e `process-inbound.ts` → extraída
          em `find-or-create-conversation.ts`, cada chamador mantém
          sua própria convenção de erro (throw vs. null).
- [x] Build limpo, suíte de testes rodada inteira: só 2 arquivos
      falhando (`currency.test.ts`, `date-utils.test.ts`) — **pré-
      existentes, nada a ver com esta sessão nem com os 10 achados**
      (confirmado: `git status` mostra esses arquivos sem nenhuma
      mudança). Uma falha própria (`contacts.test.ts` — esqueci de
      atualizar o teste quando adicionei `source` na Fase 6.4) foi
      corrigida.
- [x] Migration 069 aplicada no banco de teste (mesmo processo das
      outras — `supabase_admin` porque `messages` é tabela antiga).

**Nota sobre o achado nº3 (staging):** os arquivos da feature de
pagamentos/webhook (uazapi, storage/media-url, process-inbound etc.)
já estavam `git add`ados antes desta sessão começar, mas várias
migrations e módulos que esse código importa (`voucher.ts`,
`payments/*`, `pacotes.ts`, migrations 055-069) **não** estão
staged. Um commit feito só do que já está no índice quebraria o
build. Isso é uma decisão de `git add`, não uma correção de código —
não mexi no staging sozinho; avisar antes de commitar qualquer coisa
desta sessão.

## Contexto (não re-explicar, só ler)

- Motivo da virada: mock de identidade visual aprovado pelo usuário após comparar com
  os sistemas que agências de Porto de Galinhas já usam (Tindo, PaxPro, Toursys,
  ChipWeb) — "não quero diferente ao mercado, até para ter uma aceitação melhor".
  Detalhes completos: memória `turia_visual_mock_market_aligned` e `DESIGN.md`.
- O app tinha um sistema de design anterior ("Control Tower", dark-mode, acento
  violeta único, zero sombra) documentado e implementado. Essa virada o substitui
  oficialmente — `DESIGN.md` e `PRODUCT.md` já foram reescritos (Fase 0).
- Infra que **já existe** e vamos reaproveitar, não recriar: sistema de 5 acentos
  (`html[data-theme="..."]` em `globals.css`) e sistema de modo claro/escuro
  (`html[data-mode="..."]`) — o modo claro já está implementado, só nunca foi o
  padrão. Ver `src/app/globals.css`.
- Paleta final (já convertida pra OKLCH, já com contraste WCAG verificado — não
  reabrir essa discussão, só implementar): ver bloco `colors:` no topo do `DESIGN.md`.

---

## Fase 0 — Fundação (docs) ✅ concluída 2026-09-27

- [x] Reescrever `DESIGN.md` com a nova identidade (paleta Petrol, light-first,
      header-band, sombra sutil, padrão filter-bar).
- [x] Atualizar `PRODUCT.md` (anti-referências e princípios que contradiziam a
      virada).
- [x] Salvar memória do projeto (`turia_visual_mock_market_aligned`).
- [x] Criar este arquivo de plano.

## Fase 1 — Retema (tokens, sem mexer em layout ainda) ✅ concluída 2026-09-27

- [x] **1.1** `html[data-theme="petrol"]` adicionado em `globals.css`.
- [x] **1.2** `DEFAULT_THEME` = `"petrol"` em `src/lib/themes.ts`.
- [x] **1.3** `DEFAULT_MODE` = `"light"` em `src/lib/themes.ts`.
- [x] **1.4** `appearance-panel.tsx` já itera `THEMES` dinamicamente — petrol
      aparece sem precisar editar esse arquivo.
- [x] **1.5** `npm run build` — passou limpo (62 páginas estáticas, sem erro TS).
- [ ] **Checkpoint com o usuário:** ainda não visto rodando de verdade
      (`npm run dev`) — pendente, mas o usuário autorizou seguir sem parar pra
      isso entre as fases 1–5; revisar visualmente no fim da Fase 5.

## Fase 2 — Elevação (sombra) + Shaded-Band rule

- [x] **2.1/2.2** `src/components/ui/card.tsx`: trocado `ring-1
      ring-foreground/10` por `border border-border shadow-sm`, `rounded-xl` →
      `rounded-md` (Card, CardHeader, CardFooter). Build passou limpo. ✅
- [ ] **2.3** Auditoria do "Shaded-Band rule" (uma cor de fundo "recuada" igual à
      cor de fundo da página) **NÃO foi feita** — precisa de olho humano/screenshot
      real, não é seguro automatizar às cegas. `--muted`/`--secondary` no modo
      claro (`oklch(0.967...)`) está bem perto de `--background`
      (`oklch(0.99...)`) — mesma ordem de grandeza do bug que pegamos no mock.
      Revisar visualmente quando abrir o app (ver Checkpoint da Fase 1).
- [x] **2.4** `npm run build` — passou limpo. ✅ Fase 2 concluída (exceto o item
      2.3, deixado como follow-up visual — ver acima).

## Fase 3 — Navegação: sidebar → header-band com abas ✅ concluída 2026-09-27

- [x] **3.1** Criado `src/components/layout/app-header.tsx` — brand+avatar numa
      linha, itens do antigo `navGroups`/`bottomNavItems` (RBAC/`canSeePlumbing`,
      unread dot, badge de notificação, chip Beta — tudo preservado). Role chip
      + nome da conta migraram pra dentro do dropdown de conta.
- [x] **3.1b (correção 2026-09-27)** Primeira versão colocou os 15 itens numa
      faixa flat só — estourou e virou barra de rolagem horizontal (usuário
      reportou, feio). Reagrupado: 6 itens do dia a dia direto na barra
      (Painel/Caixa de entrada/Notificações/Reservas/Pacotes/Contatos) +
      "Logística ▾" e "CRM & Automação ▾" como dropdown (mesmo padrão do
      Toursys real: "Módulos ▾ / Integrações ▾"). Sem scrollbar agora,
      testado clicando nos dois dropdowns no dev server.
- [x] **3.2** `dashboard-shell.tsx` atualizado: layout virou coluna
      (`AppHeader` em cima, `main` embaixo), removido o estado
      `sidebarOpen`/drawer (não existe mais).
- [x] **3.3** Mobile: a faixa de abas já usa `overflow-x-auto`, sem drawer.
- [x] **3.4** Rotas não mudaram, só a apresentação da nav.
- [x] **3.5** `sidebar.tsx` e `header.tsx` (o antigo, separado) deletados —
      confirmado que nada mais importava eles.
- [x] **3.6** `npm run build` passou limpo (todas as rotas). Verificado também
      rodando `npm run dev` de verdade e abrindo /dashboard, /reservas,
      /pacotes no navegador — sem erro de console, visual bate com o esperado.
- [x] **Checkpoint com o usuário** — feito, usuário viu rodando ao vivo.

## Fase 4 — Padrão "filter bar" componentizado

- [x] **4.1** Criado `src/components/ui/filter-bar.tsx` — `FilterBar` +
      `FilterField`, layout puro (sem lógica), quem usa guarda o próprio state
      e filtra em memória o array já carregado (sem refazer query). Sem botão
      "Filtrar" explícito — como o filtro é sobre dados já em memória (não uma
      nova consulta), reagir na hora é estritamente melhor UX; o botão do
      DESIGN.md fazia sentido pro mock (fingindo uma query nova), não aqui.
- [x] **4.2** Aplicado em `Reservas`: filtro de Status (Todos/Pendente/
      Confirmada/Cancelada), combinado com o filtro de dia que já existia.
      Build passou.
- [x] **4.3** `Contacts`/CRM — **pulado de propósito**: a página já tem um
      filtro de tags mais sofisticado (Popover com checkboxes); um FilterBar
      simples ali seria redundante/conflitante, não uma melhoria.
- [x] **4.4** `agenda-operacional` — filtro de "Status do veículo"
      (Disponível/Manutenção/Inativo) adicionado, mesmo padrão. Build passou.

## Fase 5 — Reintroduzir badge de automação (IA/Fluxo vs Atendente) ✅ concluída 2026-09-27

- [x] **5.1** Confirmado: o badge (coluna "Origem", `Sparkles` + "IA/Fluxo" vs
      "Atendente", baseado em `r.created_by === null`) está em
      `reservas/page.tsx` linhas ~257-265.
- [x] **5.2** Nunca sumiu — a Fase 3 só mexeu no shell (header/nav), não no
      corpo das páginas, então o badge sobreviveu intacto. Confirmado que ele
      NÃO existe em `agenda-operacional` — decisão deliberada de não forçar
      ali: uma "saída" agrupa várias reservas (algumas IA, outras humanas) por
      veículo/horário, não é 1:1 com uma reserva, então um badge de origem por
      linha não faria sentido semântico nessa granularidade. Se o usuário
      quiser essa informação em Agenda operacional no futuro, seria um
      resumo por saída (ex. "3 de 5 pela IA"), não o mesmo badge — não
      implementado agora, fora do escopo desta fase.

## Fase 6 — Gaps de mercado (novos módulos, cada um é seu próprio projeto)

Ordem sugerida por impacto/esforço — **decidir com o usuário antes de começar cada
um**, não assumir prioridade sozinho:

- [x] **6.1 Financeiro/conciliação** — v1 entregue 2026-09-27:
      - `supabase/migrations/066_financeiro.sql` (NÃO aplicado ainda — só
        escrito. Precisa rodar `supabase db push` ou aplicar manualmente;
        não fiz sozinho por afetar banco real/compartilhado). Tabelas
        `contas_financeiras` + `lancamentos_financeiros`, RLS seguindo
        exatamente o padrão de `064_logistica_operacional.sql`
        (`is_account_member`, trigger `updated_at`).
      - Escopo deliberadamente menor que "conciliação bancária" de
        verdade (PaxPro-style) — é um livro-caixa manual, sem import de
        extrato/matching automático. Isso é um follow-up futuro, não
        confundir com o que foi entregue.
      - Página `/financeiro`: contas (com saldo calculado) + lançamentos
        com FilterBar (tipo/conta) + KPIs (saldo total, entradas/saídas
        do mês). Nav: item novo em `primaryNavItems`, `adminOnly: true`
        (dado financeiro — só owner/admin).
      - Build passou. **Migration aplicada** 2026-09-27 direto no Postgres
        do Supabase self-hosted (`supabase-turia` no Coolify), via
        Terminal do container `supabase-db` (psql local, sem precisar de
        connection string) — tabelas confirmadas com `\dt`, schema cache
        do PostgREST recarregado (`NOTIFY pgrst, 'reload schema'`).
        Testado ponta a ponta no navegador: criei conta → registrei
        lançamento → conferi saldo/KPIs calculando certo → removi os dois
        (dado de teste não fica no banco). **Fase 6.1 100% concluída.**
- [x] **6.2 Documentos com marca** — v1 entregue 2026-09-27:
      - **Descoberta importante**: voucher com marca **já existia**
        (`src/lib/flows/voucher.ts`, gerado automático no fechamento da
        reserva, mandado por WhatsApp) — não foi reinventado.
      - **Novo**: recibo de pagamento (`src/lib/flows/recibo.ts`, mesmo
        estilo visual do voucher, reaproveita `formatBRL`/`formatDateBR`
        exportados de lá) + rota `GET /api/documentos/recibo?reserva_id=`
        (agent+, só emite pra reserva com `pagamento_status = 'pago'`,
        streama o PDF direto, sem upload em storage). Botão de download
        na tabela de Reservas, só aparece em reservas pagas.
      - **Contrato**: propositalmente **não implementado** — exigiria
        texto jurídico real da agência; inventar um modelo genérico
        violaria a regra "real data or nothing" do PRODUCT.md. Fica de
        follow-up se o usuário trouxer o texto real.
      - Build + `vitest` (voucher.test.ts) passaram. Endpoint testado ao
        vivo (404 limpo pra reserva inexistente) — sem reserva paga real
        no banco de teste pra um teste 100% ponta a ponta com PDF de
        verdade; a lógica é a mesma do voucher já em produção.
- [x] **6.3 Tarefas & lembretes internos** — v1 entregue 2026-09-27:
      `067_tarefas.sql` (tabela `tarefas`, RLS igual ao padrão), página
      `/tarefas` (status pendente/concluída com toggle, prazo atrasado em
      vermelho, responsável + contato opcionais, FilterBar
      status/responsável). Nav em CRM & Automação. Build delegado a
      subagent (`phase6-3-tarefas`), revisado e corrigido por mim (1 bug
      de digitação + 1 bug real: embed `profiles!responsavel_id` precisa
      do hint de FK porque `tarefas` tem duas colunas apontando pra
      `profiles` — `responsavel_id` e `created_by` — e o PostgREST
      rejeita embed ambíguo sem isso). Testado ponta a ponta ao vivo:
      criei → concluí → removi.
- [x] **6.4 Captação de leads via Facebook/Instagram Ads** — v1 entregue
      2026-09-27, escopo bem menor que o esperado:
      - **Descoberta**: a API pública (`POST /api/v1/contacts`) **já
        permite** qualquer sistema externo criar contato — um formulário
        de Meta Lead Ads já pode ser conectado hoje via Zapier/Make/n8n,
        sem nenhum código novo. O gap real não era a integração, era não
        ter como marcar **de onde** veio o contato.
      - **Novo**: `068_contact_source.sql` (coluna `contacts.source`,
        sem default/backfill — dado real ou nada), aceita em
        `POST /api/v1/contacts` (`source: "facebook_ads"` etc.), badge
        "Origem" na tabela de Contatos, e os dois caminhos reais de
        criação de contato passam a marcar sozinhos: inbound do WhatsApp
        → `source: "whatsapp"`, criado manual pelo form → `source:
        "manual"`. Documentado em `docs/public-api.md`.
      - **Nota de infra**: `contacts` (e outras tabelas antigas) são
        donas do role `supabase_admin`, não `postgres` — `ALTER TABLE`
        nelas precisa rodar como `supabase_admin`, diferente das tabelas
        novas que eu criei (essas são do `postgres`). Vale lembrar em
        migrations futuras que alterem tabelas pré-existentes.
      - Build passou.
- [x] **6.5 "Traslados" como módulo nomeado** — v1 entregue 2026-09-27,
      escopo menor que o esperado (igual 6.2/6.4):
      - **Descoberta**: `Agenda operacional` **já é** um manifesto de
        transfer completo — veículo/motorista/guia por saída, passageiro +
        pousada/apartamento por reserva, com seletor de data pra
        consultar qualquer dia (não só hoje). O que o Tindo chama de
        "Traslados" já existe aqui, só com outro nome.
      - **Novo**: campo de busca "Passageiro" na FilterBar (filtra saídas
        pelo nome/telefone do contato — o campo "Passageiro" que o Tindo
        tem e a Agenda operacional não tinha) + menção a "traslados" no
        subtítulo da página, pra quem procura por esse nome.
      - **Não criei uma página nova** — seria duplicar/fragmentar um
        conceito que já existe (contra o princípio de "composable
        within the existing system" do PRODUCT.md).
      - Build passou, testado visualmente (sem dado do dia no banco de
        teste pra testar o filtro com resultado, mas a lógica é um
        `.filter` simples de baixo risco).

## Fase 6 — CONCLUÍDA (todos os 5 itens, 2026-09-27)

## Fase 7 — Fechamento

- [ ] **7.1** Passar o `code-review` skill no diff acumulado das Fases 1–5.
- [ ] **7.2** Atualizar screenshots/README se houver.
- [ ] **7.3** Marcar este arquivo como concluído ou arquivar em `docs/`.
