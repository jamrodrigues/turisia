'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { WhatsAppConfig } from './whatsapp-config';
import { UazapiConfig } from './uazapi-config';

/**
 * Provider selector for the WhatsApp settings section.
 *
 * The account runs on ONE provider at a time (whatsapp_config.provider).
 * Defaults to whichever is already configured: if the account has a
 * saved uazapi instance we open that tab, otherwise Meta (the wacrm
 * default). Switching tabs only changes what's shown — the active
 * provider actually flips when a config is saved on that tab.
 */

type Provider = 'meta' | 'uazapi';

export function WhatsAppProviderTabs() {
  const [tab, setTab] = useState<Provider>('meta');
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/uazapi/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.configured) setTab('uazapi');
      })
      .catch(() => {
        /* default stays meta */
      })
      .finally(() => {
        if (!cancelled) setResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-lg border p-1">
        <Button
          size="sm"
          variant={tab === 'uazapi' ? 'default' : 'ghost'}
          onClick={() => setTab('uazapi')}
        >
          uazapi (QR code)
        </Button>
        <Button
          size="sm"
          variant={tab === 'meta' ? 'default' : 'ghost'}
          onClick={() => setTab('meta')}
        >
          Meta Cloud API (oficial)
        </Button>
      </div>

      {/* Render only after the default tab is resolved to avoid a
          Meta→uazapi flash for uazapi-configured accounts. */}
      {resolved && (tab === 'uazapi' ? <UazapiConfig /> : <WhatsAppConfig />)}
    </div>
  );
}
