# Fase 06 — Camada comercial (depois de faturar)

**Objetivo:** transformar a operação em produto vendável de forma sustentável. Só depois de 1-3 clientes pagando
estáveis.

**Depende de:** Fase 05. **Entrega:** white-label, cobrança e visão central da operação.

## 6.1 — White-label por cliente

- Logo, nome do painel, cores por conta. Reaproveitar o tema do wacrm (Tailwind v4). Guardar branding em
  `profiles`/`account` ou tabela dedicada.
- Domínio próprio por cliente (ex.: `crm.clinicadaneuza.com.br`) apontando para o deploy do cliente.

## 6.2 — Cobrança / mensalidade

- **MVP:** cobrança manual (fora do sistema) + um flag `active/suspended` por conta que bloqueia o login quando
  inadimplente.
- **Evolução:** Stripe/assinatura. Webhook do Stripe → seta `active/suspended`. Não misturar com o core agora.

## 6.3 — Painel central do operador (multi-cliente)

- Uma visão sua com o **inventário** de clientes (Fase 04.4): status da instância uazapi (conectada?), versão do
  deploy, uso, alertas (número desconectou, webhook falhando).
- Pode ser um dashboard separado que lê os N Supabase (ou um Supabase "de operação" que os deploys reportam).
- Monitorar: reconexão de QR (uazapi cai e precisa reescanear), erros de webhook, saúde do n8n.

## 6.4 — Melhorar o construtor de fluxo embutido

- Investir no builder visual nativo (`flows`, `@xyflow/react`) para cobrir mais casos **sem n8n** → reduz
  dependência externa e aumenta margem. Ex.: nós de "chamar LLM com tools", "consultar Supabase".
- Meta de longo prazo: tier simple cobrir clínica-simples também, deixando n8n só para integrações pesadas.

## 6.5 — Polish de humanização do bot

- **"Digitando..."**: enviar presença (endpoint de presence do uazapi) antes da resposta + delay proporcional ao
  tamanho do texto. Bot parece humano; também ajuda antiban (padrão de resposta menos robótico).
- Quebrar respostas longas em 2-3 mensagens com pequenos intervalos (opcional, por conta).

## 6.6 — Antiban e confiabilidade (uazapi)

- uazapi é não-oficial: risco de bloqueio do número. Boas práticas: aquecimento, limites de disparo, opt-in,
  evitar broadcast agressivo. Documentar limites por cliente. Considerar oferecer migração para API oficial (Meta)
  quando o cliente crescer — **o código já suporta os dois providers** (é só trocar `provider`).

## DoD

- [ ] White-label básico por cliente (logo/nome/cores/domínio).
- [ ] Flag active/suspended integrado ao login; caminho de cobrança definido.
- [ ] Painel central com inventário + saúde das instâncias.
- [ ] Diretrizes de antiban documentadas por cliente.
