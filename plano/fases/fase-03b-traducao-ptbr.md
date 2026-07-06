# Fase 03b — Tradução completa para português do Brasil

**Objetivo:** toda a superfície visível ao usuário em **pt-BR**. O wacrm original é 100% inglês, **sem i18n**
(strings hardcoded nos componentes, `lang="en"`, sem locale no date-fns — confirmado no código).

**Posição no cronograma:** depois da Fase 03 (core estável — traduzir antes criaria conflito constante com o
desenvolvimento pesado das Fases 01-03) e **antes da Fase 05** (nenhum cliente pode ver inglês).

**Depende de:** Fase 03. **Entrega:** painel 100% pt-BR validado por navegação completa.

## Decisão de estratégia (registrada)

**Verificado no código:** o wacrm NÃO tem nenhum ponto pronto de i18n — `next.config.ts` sem config de locale,
nenhum arquivo de dicionário/strings/messages, nada nos docs. Escala real: **122 arquivos `.tsx`**, ~152 strings
só em atributos (`placeholder`/`title`/`aria-label`) + os textos JSX — estimativa 600-900 strings visíveis.
A varredura é inevitável; a escolha é só ONDE as traduções ficam.

> **Nota de execução (o que foi realmente feito):** abordagem **híbrida** para permitir tradução em paralelo por
> vários agentes sem conflito num único arquivo quente. **Vocabulário compartilhado** (nav, papéis, ações comuns,
> status) vive no dicionário `src/lib/i18n/pt-br.ts` (`t.*`); **strings específicas de cada área** (inbox, contatos,
> funis, auth) foram traduzidas **inline no próprio componente**. Migrar tudo para o dicionário é um refactor
> posterior opcional. O glossário abaixo vale para os dois casos.

**Escolhido: dicionário central leve, SEM framework** (`src/lib/i18n/pt-br.ts`):

```ts
// src/lib/i18n/pt-br.ts — objeto TS puro, tipado, sem runtime extra
export const t = {
  common: { save: 'Salvar', cancel: 'Cancelar', delete: 'Excluir', search: 'Buscar', loading: 'Carregando…' },
  nav:    { inbox: 'Caixa de entrada', contacts: 'Contatos', pipelines: 'Funis', broadcasts: 'Disparos',
            automations: 'Automações', flows: 'Fluxos', settings: 'Configurações', dashboard: 'Painel' },
  inbox:  { searchConversations: 'Buscar conversas…', addNote: 'Adicionar uma nota…',
            addCaption: 'Adicionar legenda…', assignedTo: 'Atribuída a', returnToBot: 'Devolver ao bot',
            awaitingHuman: 'Aguardando atendente' },
  // ... uma seção por área da tabela §3b.4
} as const
```

Nos componentes: `placeholder="Search conversations..."` → `placeholder={t.inbox.searchConversations}`.

Por quê assim (e não framework nem tradução solta):
- **Um local único** para revisar/ajustar todo o texto do produto (o "local fácil" que não existe no original).
- Zero dependência nova, zero mudança de rota/URL (`/inbox`, `/contacts` ficam), zero mudança em tabela/enum
  (`'open'`, `'bot'`, `sender_type` etc. intactos — são valores internos, nunca exibidos crus).
- Merge upstream fica MAIS fácil que tradução solta: string nova do upstream chega em inglês no componente,
  aparece "crua" na UI, e a correção é 1 linha no componente + 1 chave no dicionário.
- Se um dia precisar de 2º idioma, o dicionário já é o formato certo (trocar import ou carregar por env).

Regra para o executor: **nenhuma string visível hardcoded em componente** a partir desta fase — tudo via `t.*`.
Documentar no `deploy/UPGRADE.md`: "após merge upstream, rodar a varredura §3b.6 nas áreas tocadas".

## 3b.1 — Fundamentos técnicos (não só texto)

1. **`lang="pt-BR"`** em `src/app/layout.tsx` (linha ~85, hoje `lang="en"`).
2. **date-fns com locale pt-BR** — o repo usa `date-fns` v4. Todo `format`/`formatDistanceToNow`/etc deve receber
   `{ locale: ptBR }` (import `date-fns/locale`). Criar helper central `src/lib/dates.ts` (`formatBR`,
   `distanceBR`) e substituir os usos diretos — evita esquecer locale em chamada nova.
3. **Moeda padrão BRL** — migration `021_account_default_currency` tornou a moeda configurável por conta. No seed
   do provisionamento (Fase 04.3 passo 4): `accounts.default_currency='BRL'`. Conferir formatação R$ nos
   componentes de pipeline/deals (Intl.NumberFormat `pt-BR`/`BRL`).
4. **Telefone com DDI +55 como default** nos formulários de contato/import (o `phone-utils.ts` já normaliza; é só
   o default de UI).
5. **Fuso horário** — exibição de datas/horas em `America/Sao_Paulo` (complementa Fase 05 §5.1/gaps §9).

## 3b.2 — E-mails de autenticação (Supabase — por projeto!)

Os e-mails de signup/reset/convite (**Auth → Email Templates**) são configurados **no painel do Supabase, POR
PROJETO**. Traduzir os templates e **incluir no checklist por cliente** (cada projeto novo nasce com templates em
inglês). Textos: confirmação de cadastro, redefinição de senha, convite, magic link.

## 3b.3 — Prompts e comportamento da IA

- `src/lib/ai/defaults.ts` (`buildSystemPrompt`) — o prompt-base é em inglês. Traduzir/adaptar E **instruir
  explicitamente: "Responda sempre em português do Brasil"** (senão o modelo pode responder em inglês para
  mensagens ambíguas).
- O **sentinela de handoff** (`HANDOFF_SENTINEL`) é um marcador técnico — **NÃO traduzir o marcador**, só as
  instruções ao redor.
- Mensagens automáticas visíveis ao cliente final (ex.: aviso de transferência para atendente) em pt-BR.

## 3b.4 — Varredura da UI (o grosso)

Traduzir por área, nesta ordem (áreas que o cliente `agent` vê primeiro):

| Ordem | Área | Diretórios |
|-------|------|-----------|
| 1 | Inbox (composer, lista, sidebar, notas) | `src/components/inbox/` |
| 2 | Login/signup/recuperação + convite | `src/app/(auth)/`, `src/app/join/`, `src/components/auth/` |
| 3 | Contatos (+import CSV, tags, campos) | `src/components/contacts/` |
| 4 | Pipelines/deals | `src/components/pipelines/` |
| 5 | Dashboard/notificações/layout (menu!) | `src/components/dashboard/`, `layout/`, `presence/` |
| 6 | Settings (WhatsApp, IA, membros) — admin | `src/components/settings/` |
| 7 | Automations/Flows/Broadcasts — admin | `src/components/automations/`, `flows/`, `broadcasts/` |
| 8 | Toasts/erros de API voltados ao usuário | `sonner` calls + rotas `src/app/api/**` (só mensagens de UI) |
| 9 | Templates de flows prontos | `/api/flows/templates` |

**Como varrer (para o agente executor):** por diretório, grep de padrões de string visível:
`>Texto<`, `placeholder="`, `label="`, `title="`, `aria-label="`, `toast.`, `confirm(`, strings em `sonner`.
Cada string vira uma chave no dicionário `src/lib/i18n/pt-br.ts` (seção da área) e o componente passa a usar
`t.<area>.<chave>`. **NÃO tocar em:** rotas/URLs (`/inbox`, `/contacts`…), nomes de variáveis/props, chaves de
objeto, valores de enum/status do banco (`'open'`, `'bot'`, `sender_type`…), logs `console.*`, comentários.
Strings com interpolação viram funções no dicionário: `deleteConfirm: (n: string) => \`Excluir ${n}?\``.

**Glossário fixo (consistência):**
Inbox → Caixa de entrada · Contacts → Contatos · Pipelines → Funis · Deals → Negócios · Broadcasts → Disparos ·
Automations → Automações · Flows → Fluxos · Settings → Configurações · Agents/Members → Atendentes/Membros ·
Tags → Etiquetas · Assigned → Atribuído · Unread → Não lida · Handoff → Transferência para atendente ·
Knowledge base → Base de conhecimento · Templates → Modelos.

## 3b.5 — Testes que asseram texto

A suíte Vitest tem testes que verificam strings da UI/mensagens. Ao traduzir, **rodar `npm run test` e atualizar
os asserts afetados junto com cada área** (não deixar acumular). `npm run typecheck` + suite verde = portão da fase.

## 3b.6 — Validação final

- [ ] Navegação completa logado como `agent`: zero inglês visível (inbox, contatos, funis, notificações, toasts).
- [ ] Navegação como `admin`: settings/automações/fluxos/disparos em pt-BR.
- [ ] Signup→e-mail de confirmação→reset de senha→convite: e-mails em pt-BR.
- [ ] Datas ("há 5 minutos", "ontem"), moeda (R$ 1.234,56) e DDI +55 corretos.
- [ ] IA responde em pt-BR mesmo a mensagem ambígua/curta.
- [ ] `typecheck` + `test` verdes.

## DoD

- [ ] `lang="pt-BR"`, helper de datas com locale, BRL default, DDI +55.
- [ ] Dicionário central `src/lib/i18n/pt-br.ts` criado; componentes usam `t.*` (zero string visível hardcoded).
- [ ] URLs/rotas, tabelas, enums e valores internos INTACTOS (só a superfície visível muda).
- [ ] 9 áreas da tabela varridas e traduzidas com o glossário.
- [ ] Templates de e-mail Supabase traduzidos + passo adicionado ao checklist por cliente.
- [ ] Prompt-base da IA em pt-BR com instrução explícita de idioma (sentinela intacto).
- [ ] Testes atualizados; validação final completa.
