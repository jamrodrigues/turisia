'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Copy,
  Loader2,
  QrCode,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * uazapi provider settings (operator-facing).
 *
 * Flow: save base URL + instance name + instance token → the API
 * validates against the server, encrypts, generates the webhook
 * secret and returns the webhook URL to paste into the uazapi panel →
 * "Conectar (QR)" starts pairing and this component polls
 * /api/uazapi/config/connect until status flips to connected.
 */

interface UazapiConfigState {
  configured: boolean;
  base_url?: string;
  instance_name?: string;
  webhook_url?: string | null;
  daily_send_limit?: number | null;
  instance?: { status: string; qrcode?: string } | null;
}

const POLL_MS = 4000;

export function UazapiConfig() {
  const [state, setState] = useState<UazapiConfigState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);

  const [baseUrl, setBaseUrl] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [instanceToken, setInstanceToken] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [savingLimit, setSavingLimit] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/uazapi/config', { cache: 'no-store' });
      const data: UazapiConfigState = await res.json();
      setState(data);
      if (data.configured) {
        setBaseUrl(data.base_url ?? '');
        setInstanceName(data.instance_name ?? '');
        setDailyLimit(
          data.daily_send_limit != null ? String(data.daily_send_limit) : '',
        );
        setLiveStatus(data.instance?.status ?? null);
        if (data.instance?.qrcode) setQrcode(data.instance.qrcode);
      }
    } catch {
      toast.error('Falha ao carregar a configuração uazapi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return stopPolling;
  }, [refresh, stopPolling]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/uazapi/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: baseUrl,
          instance_name: instanceName,
          instance_token: instanceToken,
          daily_send_limit: dailyLimit.trim() === '' ? null : Number(dailyLimit),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Falha ao salvar.');
        return;
      }
      toast.success(
        data.webhook_configured
          ? 'Configuração salva — webhook configurado automaticamente no servidor.'
          : 'Configuração salva. Configure o webhook manualmente no painel uazapi (URL abaixo).',
      );
      setInstanceToken('');
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLimit = async () => {
    const trimmed = dailyLimit.trim();
    if (trimmed !== '') {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n <= 0) {
        toast.error('O teto diário deve ser um número inteiro positivo (ou vazio para sem limite).');
        return;
      }
    }
    setSavingLimit(true);
    try {
      // instance_token omitted → settings-only update on the route.
      const res = await fetch('/api/uazapi/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          daily_send_limit: trimmed === '' ? null : Number(trimmed),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Falha ao salvar o teto diário.');
        return;
      }
      toast.success(
        trimmed === ''
          ? 'Teto diário removido (envios ilimitados).'
          : `Teto diário salvo: ${trimmed} envios/dia.`,
      );
    } finally {
      setSavingLimit(false);
    }
  };

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/uazapi/config/connect', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) return;
      setLiveStatus(data.status);
      if (data.qrcode) setQrcode(data.qrcode);
      if (data.status === 'connected') {
        stopPolling();
        setQrcode(null);
        setConnecting(false);
        toast.success('WhatsApp conectado!');
      }
    } catch {
      // transient — keep polling
    }
  }, [stopPolling]);

  const handleConnect = async () => {
    setConnecting(true);
    setQrcode(null);
    try {
      const res = await fetch('/api/uazapi/config/connect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Falha ao iniciar a conexão.');
        setConnecting(false);
        return;
      }
      setLiveStatus(data.status);
      if (data.qrcode) setQrcode(data.qrcode);
      if (data.status === 'connected') {
        setConnecting(false);
        toast.success('WhatsApp já está conectado.');
        return;
      }
      stopPolling();
      pollRef.current = setInterval(() => void pollStatus(), POLL_MS);
    } catch {
      toast.error('Falha ao iniciar a conexão.');
      setConnecting(false);
    }
  };

  const handleDisconnectConfig = async () => {
    if (!window.confirm('Remover a configuração uazapi desta conta?')) return;
    const res = await fetch('/api/uazapi/config', { method: 'DELETE' });
    if (res.ok) {
      stopPolling();
      setState({ configured: false });
      setQrcode(null);
      setLiveStatus(null);
      toast.success('Configuração removida.');
    } else {
      toast.error('Falha ao remover.');
    }
  };

  const copyWebhookUrl = async () => {
    if (!state?.webhook_url) return;
    await navigator.clipboard.writeText(state.webhook_url);
    toast.success('URL do webhook copiada.');
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  const connected = liveStatus === 'connected';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>uazapi (conexão por QR code)</CardTitle>
          <CardDescription>
            Conecte um número de WhatsApp comum via QR code — sem conta
            Business API. Crie a instância no painel do seu servidor uazapi e
            cole o token dela aqui.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="uazapi-base-url">URL do servidor</Label>
            <Input
              id="uazapi-base-url"
              placeholder="https://seu-servidor.uazapi.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="uazapi-instance-name">Nome da instância</Label>
            <Input
              id="uazapi-instance-name"
              placeholder="minha-empresa"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="uazapi-instance-token">Token da instância</Label>
            <Input
              id="uazapi-instance-token"
              type="password"
              placeholder={state?.configured ? '•••••••• (salvo)' : 'token'}
              value={instanceToken}
              onChange={(e) => setInstanceToken(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
            {state?.configured && (
              <Button variant="destructive" onClick={handleDisconnectConfig}>
                <Trash2 className="mr-2 h-4 w-4" /> Remover
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {state?.configured && (
        <>
          {state.webhook_url && (
            <Alert>
              <AlertTitle>Webhook da instância</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  No painel do uazapi, configure o webhook da instância{' '}
                  <strong>{state.instance_name}</strong> para receber mensagens
                  nesta URL:
                </p>
                <div className="flex items-center gap-2">
                  <code className="block max-w-full flex-1 overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                    {state.webhook_url}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyWebhookUrl}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Status da conexão
                {connected ? (
                  <span className="inline-flex items-center gap-1 text-sm font-normal text-green-600">
                    <CheckCircle2 className="h-4 w-4" /> Conectado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-sm font-normal text-muted-foreground">
                    <XCircle className="h-4 w-4" />
                    {liveStatus === 'connecting' ? 'Aguardando QR' : 'Desconectado'}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!connected && (
                <Button onClick={handleConnect} disabled={connecting}>
                  {connecting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <QrCode className="mr-2 h-4 w-4" />
                  )}
                  Conectar (QR code)
                </Button>
              )}
              {qrcode && !connected && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Abra o WhatsApp no celular → Aparelhos conectados →
                    Conectar um aparelho, e escaneie:
                  </p>
                  {/* uazapi returns either a data-URL/base64 PNG or a raw
                      pairing string; render image when it looks like one. */}
                  {qrcode.startsWith('data:image') || qrcode.length > 500 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={
                        qrcode.startsWith('data:image')
                          ? qrcode
                          : `data:image/png;base64,${qrcode}`
                      }
                      alt="QR code de pareamento do WhatsApp"
                      className="h-64 w-64 rounded border bg-white p-2"
                    />
                  ) : (
                    <code className="block break-all rounded bg-muted p-2 text-xs">
                      {qrcode}
                    </code>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Teto diário de envios (anti-ban)</CardTitle>
              <CardDescription>
                Limite de mensagens em massa (disparos) por dia. Números não
                oficiais são banidos por volume alto, principalmente quando
                novos. Deixe em branco para não ter limite. Aquecimento
                sugerido: semana 1 = 30–50/dia, semana 2 = 80, semana 3 = 120,
                semana 4+ = 150–200. Respostas 1 a 1 (inbox/robô) nunca são
                bloqueadas por este teto.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="uazapi-daily-limit">Envios por dia</Label>
                <div className="flex gap-2">
                  <Input
                    id="uazapi-daily-limit"
                    type="number"
                    min={1}
                    placeholder="sem limite"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(e.target.value)}
                    className="max-w-[200px]"
                  />
                  <Button onClick={handleSaveLimit} disabled={savingLimit}>
                    {savingLimit && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Salvar teto
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
