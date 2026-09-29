'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Wallet, Trash2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

const MASKED = '••••••••••••••••';

/**
 * Mercado Pago Pix settings — the credential the `create_payment` flow
 * node (Fase B, 2026-09-08) needs to charge a reservation and confirm
 * it automatically. Same shape/security posture as AiConfig
 * (src/components/settings/ai-config.tsx): admin+ only, secrets never
 * round-trip to the client, masked placeholder shown once stored.
 */
export function PaymentSettings() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [acceptCardInstallments, setAcceptCardInstallments] = useState(false);

  const [accessToken, setAccessToken] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [hasStoredToken, setHasStoredToken] = useState(false);

  const [webhookSecret, setWebhookSecret] = useState('');
  const [secretEdited, setSecretEdited] = useState(false);
  const [hasStoredSecret, setHasStoredSecret] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/payments/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Falha ao carregar configuração de pagamentos');
        return;
      }
      setConfigured(Boolean(data.configured));
      setIsActive(Boolean(data.is_active));
      setAcceptCardInstallments(Boolean(data.accept_card_installments));
      setHasStoredToken(Boolean(data.has_access_token));
      setHasStoredSecret(Boolean(data.has_webhook_secret));
      setAccessToken('');
      setWebhookSecret('');
      setTokenEdited(false);
      setSecretEdited(false);
    } catch {
      toast.error('Falha ao carregar configuração de pagamentos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || profileLoading) return;
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
  }, [accountId, profileLoading, fetchConfig]);

  async function handleSave() {
    if (isActive && !tokenEdited && !hasStoredToken) {
      toast.error('Access Token é obrigatório para ativar cobrança automática');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/payments/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: isActive,
          accept_card_installments: acceptCardInstallments,
          ...(tokenEdited ? { access_token: accessToken.trim() } : {}),
          ...(secretEdited ? { webhook_secret: webhookSecret.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Falha ao salvar');
        return;
      }
      toast.success('Configuração de pagamentos salva');
      await fetchConfig();
    } catch {
      toast.error('Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      const res = await fetch('/api/payments/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Falha ao remover');
        return;
      }
      toast.success('Configuração de pagamentos removida');
      await fetchConfig();
    } catch {
      toast.error('Falha ao remover');
    } finally {
      setRemoving(false);
    }
  }

  const disabled = !canEdit || loading;

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Pagamentos"
        description="Cobrança automática via Pix (Mercado Pago) — usado pelo passo 'Cobrar pagamento' dos fluxos de fechamento automático."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Wallet className="size-4 text-primary" />
            Mercado Pago
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {canEdit
              ? 'Access Token da sua conta Mercado Pago (Suas integrações → Credenciais). Nunca é reexibido depois de salvo.'
              : 'Apenas administradores da conta podem configurar pagamentos.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Cobrança automática ativa</p>
              <p className="text-xs text-muted-foreground">
                Com isso desligado, os fluxos pulam o passo de pagamento.
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} disabled={disabled} />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Aceitar cartão parcelado</p>
              <p className="text-xs text-muted-foreground">
                Com isso ligado, o cliente recebe um link de checkout (Pix, cartão ou parcelado)
                em vez do Pix copia-e-cola. Desligado por padrão — mantém o comportamento atual.
              </p>
            </div>
            <Switch
              checked={acceptCardInstallments}
              onCheckedChange={setAcceptCardInstallments}
              disabled={disabled}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="mp-token" className="text-muted-foreground">
              Access Token
            </Label>
            <div className="relative">
              <Input
                id="mp-token"
                type={showToken ? 'text' : 'password'}
                value={tokenEdited ? accessToken : hasStoredToken ? MASKED : ''}
                onChange={(e) => {
                  setTokenEdited(true);
                  setAccessToken(e.target.value);
                }}
                onFocus={() => {
                  if (!tokenEdited && hasStoredToken) {
                    setTokenEdited(true);
                    setAccessToken('');
                  }
                }}
                disabled={disabled}
                placeholder="APP_USR-..."
                className="bg-muted border-border pr-9 text-foreground"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="mp-secret" className="text-muted-foreground">
              Chave secreta do webhook
            </Label>
            <Input
              id="mp-secret"
              type="password"
              value={secretEdited ? webhookSecret : hasStoredSecret ? MASKED : ''}
              onChange={(e) => {
                setSecretEdited(true);
                setWebhookSecret(e.target.value);
              }}
              onFocus={() => {
                if (!secretEdited && hasStoredSecret) {
                  setSecretEdited(true);
                  setWebhookSecret('');
                }
              }}
              disabled={disabled}
              placeholder="Suas integrações → Webhooks → Configurar notificação"
              className="bg-muted border-border text-foreground"
            />
            <p className="text-xs text-muted-foreground">
              Configure a URL de notificação no Mercado Pago (Suas integrações → Webhooks) como:{' '}
              <code className="block break-all rounded bg-muted px-1 py-0.5 mt-1">
                {typeof window !== 'undefined' ? window.location.origin : ''}/api/payments/webhook/{accountId ?? '{sua-conta}'}
              </code>
            </p>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2">
              <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Salvar
              </Button>
              {configured && (
                <Button variant="outline" onClick={handleRemove} disabled={removing} className="text-destructive">
                  {removing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Remover
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
