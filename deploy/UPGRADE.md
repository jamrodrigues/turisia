# Atualizando os clientes (multi-deploy)

Todo cliente roda o **mesmo** repositório numa tag/versão. Atualizar = repetir estes passos por cliente.

## 1. Escolher a versão
```bash
git fetch --tags
git checkout vX.Y.Z        # a tag que você validou em staging
```

## 2. Por cliente
Para cada cliente no inventário (`clients-inventory.md`):

```bash
# a) migrations novas no Supabase do cliente
npx supabase db push --db-url "postgresql://postgres:<senha>@db.<ref>.supabase.co:5432/postgres"

# b) rebuild + restart do container
docker compose --env-file deploy/.env.<slug> -p crm-<slug> up -d --build

# c) fumaça: /login responde 200, inbox abre, envia/recebe 1 mensagem de teste
```

## 3. Após merge do upstream (wacrm original)
As mudanças do produto ficam concentradas (adapter uazapi, dispatcher,
rotas novas, i18n). Depois de `git merge upstream/main`:

1. Resolver conflitos (tendem a ser pequenos).
2. **Re-varrer a tradução** nas áreas que o upstream tocou — rodar o
   checklist §3b.6 do `plano/fases/fase-03b-traducao-ptbr.md` nas telas
   afetadas (string nova do upstream chega em inglês).
3. `npm run typecheck && npm run test` verdes antes de taggear.

## Rollback
- Deploy: `docker compose ... up -d` apontando para a tag anterior.
- Migrations: são aditivas/idempotentes (não destroem dados). Reverter
  só se uma migration nova falhar — `alter table ... drop column`.

## Regras
- **`ENCRYPTION_KEY` é único por cliente** — nunca reutilizar. Trocar a
  chave invalida todos os tokens cifrados daquele cliente.
- Anotar no inventário a versão implantada + a data por cliente.
