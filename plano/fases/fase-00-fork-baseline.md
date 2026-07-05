# Fase 00 — Fork + baseline rodando (repo-template)

**Objetivo:** ter o wacrm original de pé, num repositório privado seu, rodando contra um Supabase de teste. Este
repo vira o **molde** de todo cliente futuro.

**Depende de:** nada. **Entrega:** wacrm rodando em `localhost` + 1 projeto Supabase de teste com todas as migrations.

## Passos

1. **Fork/clone privado**
   - Criar repo privado (é produto comercial). `git clone https://github.com/ArnasDon/wacrm` → novo remoto seu.
   - Manter o histórico e a licença MIT (obrigatório; MIT permite uso comercial e modificação).
   - Ler `README.md`, `docs/`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` do repo para o guia oficial de setup.

2. **Projeto Supabase de teste**
   - Criar 1 projeto no Supabase online (será descartável; só para validar).
   - Aplicar migrations `001..030` na ordem (Supabase CLI `supabase db push`, ou colar cada `.sql` no SQL Editor).
   - Confirmar que subiram tabelas: `whatsapp_config`, `conversations`, `messages`, `contacts`, `ai_*`, `flows`,
     `automations`, `deals`, etc.

3. **Variáveis de ambiente**
   - Copiar `.env.local.example` → `.env.local`. Preencher `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` (confirmar nome real no example)
     e a chave de LLM (Anthropic/OpenAI) se for testar a IA.

4. **Instalar e rodar**
   ```bash
   npm install
   npm run typecheck   # baseline verde antes de qualquer mudança
   npm run test        # suíte Vitest passando
   npm run dev         # http://localhost:3000
   ```
   - Criar usuário (signup), entrar no dashboard. Explorar inbox, contatos, pipelines, automations, flows, settings.

5. **Reconhecer o terreno (não mexer ainda)**
   - Abrir e ler: `src/app/api/whatsapp/webhook/route.ts`, `src/lib/whatsapp/meta-api.ts`,
     `src/lib/flows/meta-send.ts`, `src/lib/ai/auto-reply.ts`, `src/lib/ai/generate.ts`,
     `src/lib/whatsapp/encryption.ts`, `src/components/settings/whatsapp-config.tsx`.
   - Confirmar as premissas de `03-referencia-wacrm.md` contra o código atual (versões podem divergir).

6. **Branch de trabalho**
   - Criar branch `feat/uazapi-provider`. Todo o desenvolvimento das Fases 01-03 nele.

## Critério de conclusão (DoD)

- [ ] Repo privado criado, MIT preservada.
- [ ] `npm run typecheck` e `npm run test` verdes no baseline.
- [ ] wacrm rodando localmente, login funciona, dashboard abre.
- [ ] Migrations 001-030 aplicadas no Supabase de teste.
- [ ] Premissas de arquivos/tabelas confirmadas contra o código real.
