'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Building2, ImagePlus, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { uploadAccountMedia } from '@/lib/storage/upload-media';
import type { Account } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

const EMPTY_FORM = {
  name: '',
  cnpj: '',
  telefone: '',
  endereco: '',
  pix_key: '',
  politica_cancelamento: '',
};

/**
 * Agency business profile — feeds the voucher PDF header/footer
 * (src/lib/flows/voucher.ts) and is the only place to register the
 * agency's own CNPJ/address/phone/logo/Pix/cancellation policy. Was
 * entirely missing before (accounts only had `name`) — flagged by the
 * agency owner right after the first live automated booking, see
 * turia_agencia_layout memory note.
 */
export function AgencySettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [form, setForm] = useState(EMPTY_FORM);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('accounts')
        .select('*')
        .eq('id', accountId)
        .maybeSingle();
      if (cancelled || !data) return;
      const account = data as Account;
      setForm({
        name: account.name ?? '',
        cnpj: account.cnpj ?? '',
        telefone: account.telefone ?? '',
        endereco: account.endereco ?? '',
        pix_key: account.pix_key ?? '',
        politica_cancelamento: account.politica_cancelamento ?? '',
      });
      setLogoUrl(account.logo_url ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  async function handleSave() {
    if (!accountId) return;
    if (!form.name.trim()) {
      toast.error('Nome da agência é obrigatório');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('accounts')
      .update({
        name: form.name.trim(),
        cnpj: form.cnpj.trim() || null,
        telefone: form.telefone.trim() || null,
        endereco: form.endereco.trim() || null,
        pix_key: form.pix_key.trim() || null,
        politica_cancelamento: form.politica_cancelamento.trim() || null,
      })
      .eq('id', accountId);
    setSaving(false);
    if (error) {
      toast.error('Falha ao salvar os dados da agência');
      return;
    }
    toast.success('Dados da agência atualizados');
  }

  async function handleLogoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !accountId) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Envie uma imagem');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Imagem muito grande (máx. 2 MB)');
      return;
    }
    setUploadingLogo(true);
    try {
      const { publicUrl } = await uploadAccountMedia('agency-logo', file);
      const { error } = await supabase
        .from('accounts')
        .update({ logo_url: publicUrl })
        .eq('id', accountId);
      if (error) throw error;
      setLogoUrl(publicUrl);
      toast.success('Logo atualizada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar a logo');
    } finally {
      setUploadingLogo(false);
    }
  }

  const disabled = !canEditSettings || loading;

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Dados da agência"
        description="Aparecem no voucher enviado ao cliente e em qualquer documento que o sistema gerar em nome da agência."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Building2 className="size-4 text-primary" />
            Perfil da agência
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {canEditSettings
              ? 'Preencha o que fizer sentido — campos vazios simplesmente não aparecem no voucher.'
              : 'Apenas administradores da conta podem editar os dados da agência.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">Logo</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Logo da agência" className="h-full w-full object-contain" />
                ) : (
                  <Building2 className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              {canEditSettings && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                  {uploadingLogo ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImagePlus className="h-4 w-4" />
                  )}
                  {logoUrl ? 'Trocar logo' : 'Enviar logo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={uploadingLogo}
                    onChange={handleLogoUpload}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="agency-name" className="text-muted-foreground">
              Nome da agência
            </Label>
            <Input
              id="agency-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              disabled={disabled}
              className="bg-muted border-border text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="agency-cnpj" className="text-muted-foreground">
                CNPJ
              </Label>
              <Input
                id="agency-cnpj"
                value={form.cnpj}
                onChange={(e) => setForm((f) => ({ ...f, cnpj: e.target.value }))}
                disabled={disabled}
                placeholder="00.000.000/0001-00"
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="agency-telefone" className="text-muted-foreground">
                Telefone
              </Label>
              <Input
                id="agency-telefone"
                value={form.telefone}
                onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
                disabled={disabled}
                placeholder="+55 81 91234 5678"
                className="bg-muted border-border text-foreground"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="agency-endereco" className="text-muted-foreground">
              Endereço
            </Label>
            <Input
              id="agency-endereco"
              value={form.endereco}
              onChange={(e) => setForm((f) => ({ ...f, endereco: e.target.value }))}
              disabled={disabled}
              placeholder="Rua, número, bairro, cidade — Porto de Galinhas, PE"
              className="bg-muted border-border text-foreground"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="agency-pix" className="text-muted-foreground">
              Chave Pix
            </Label>
            <Input
              id="agency-pix"
              value={form.pix_key}
              onChange={(e) => setForm((f) => ({ ...f, pix_key: e.target.value }))}
              disabled={disabled}
              placeholder="Opcional — mostrada no voucher como instrução de pagamento"
              className="bg-muted border-border text-foreground"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="agency-politica" className="text-muted-foreground">
              Política de cancelamento
            </Label>
            <Textarea
              id="agency-politica"
              value={form.politica_cancelamento}
              onChange={(e) => setForm((f) => ({ ...f, politica_cancelamento: e.target.value }))}
              disabled={disabled}
              placeholder="Opcional — entra no rodapé do voucher, ex.: regras de reembolso"
              rows={3}
              className="bg-muted border-border text-foreground"
            />
          </div>

          {canEditSettings && (
            <Button
              onClick={handleSave}
              disabled={saving || loading}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
