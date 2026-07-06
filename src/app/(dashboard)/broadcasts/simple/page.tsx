'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Step2SelectAudience } from '@/components/broadcasts/step2-select-audience';
import {
  useBroadcastSending,
  type AudienceConfig,
} from '@/hooks/use-broadcast-sending';
import { Button } from '@/components/ui/button';
import { Check, Loader2, ArrowLeft, Send } from 'lucide-react';

/**
 * Simple (free-text) broadcast — a plain message with no Meta template.
 * This is the path uazapi accounts use (they have no template registry);
 * on Meta it reaches recipients inside the 24h window. The heavier
 * template wizard lives at /broadcasts/new.
 */

const steps = [
  { label: 'Público', key: 'audience' },
  { label: 'Mensagem', key: 'message' },
] as const;

/** WhatsApp text body cap. */
const MAX_LEN = 4096;

export default function SimpleBroadcastPage() {
  const router = useRouter();
  const { createAndSendTextBroadcast, isProcessing, progress } =
    useBroadcastSending();

  const [currentStep, setCurrentStep] = useState(0);
  const [audience, setAudience] = useState<AudienceConfig>({ type: 'all' });
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error('Escreva a mensagem antes de enviar.');
      return;
    }
    try {
      const broadcastId = await createAndSendTextBroadcast({
        name: name.trim() || 'Envio simples',
        message: trimmed,
        audience,
      });
      router.push(`/broadcasts/${broadcastId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha no envio';
      console.error('Text broadcast failed:', err);
      toast.error(msg);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Envio simples</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Envie uma mensagem de texto para seus contatos, sem modelo aprovado.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;
          return (
            <div key={step.key} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground'
                      : isActive
                        ? 'border-2 border-primary bg-primary/10 text-primary'
                        : 'border border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <span
                  className={`hidden text-sm font-medium sm:block ${
                    isActive
                      ? 'text-foreground'
                      : isCompleted
                        ? 'text-primary'
                        : 'text-muted-foreground'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`mx-3 h-px flex-1 ${
                    index < currentStep ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Content */}
      <div className="relative min-h-[400px]">
        <div
          className="transition-all duration-300 ease-in-out"
          style={{
            opacity: isProcessing ? 0.6 : 1,
            pointerEvents: isProcessing ? 'none' : 'auto',
          }}
        >
          {currentStep === 0 && (
            <Step2SelectAudience
              audience={audience}
              onUpdate={setAudience}
              onNext={() => setCurrentStep(1)}
              onBack={() => router.push('/broadcasts')}
            />
          )}

          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <label
                  htmlFor="broadcast-name"
                  className="text-sm font-medium text-foreground"
                >
                  Nome do envio{' '}
                  <span className="text-muted-foreground">(opcional)</span>
                </label>
                <input
                  id="broadcast-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Promoção de julho"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="broadcast-message"
                  className="text-sm font-medium text-foreground"
                >
                  Mensagem
                </label>
                <textarea
                  id="broadcast-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
                  rows={8}
                  placeholder="Escreva a mensagem que será enviada a cada contato…"
                  className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                />
                <div className="text-right text-xs tabular-nums text-muted-foreground">
                  {message.length}/{MAX_LEN}
                </div>
              </div>

              {isProcessing && (
                <div className="space-y-2">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    Enviando… {progress}%
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep(0)}
                  disabled={isProcessing}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </Button>
                <Button
                  onClick={handleSend}
                  disabled={isProcessing || !message.trim()}
                >
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Enviar agora
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
