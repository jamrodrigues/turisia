/**
 * Best-effort voice-note transcription (OpenAI Whisper).
 *
 * Clinic-type accounts get a lot of audio; the built-in (simple) brain
 * is text-only, so an untranscribed voice note is invisible to it. We
 * fetch the (already-decrypted, server-hosted) media URL and send it to
 * Whisper. Whisper is OpenAI-only, so this runs only when an OpenAI key
 * is available; advanced (n8n) accounts transcribe inside their own
 * flow and never call this.
 *
 * Never throws — on any failure the caller keeps the placeholder text.
 */

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions'

export async function transcribeAudio(args: {
  /** Public/hosted audio URL (uazapi /message/download result). */
  url: string
  /** OpenAI API key. */
  apiKey: string
  /** Whisper model; gpt-4o-mini-transcribe is cheap + accurate. */
  model?: string
  /** ISO-639-1 hint improves accuracy; default pt (Brazil). */
  language?: string
}): Promise<string | null> {
  try {
    const audioRes = await fetch(args.url)
    if (!audioRes.ok) return null
    const blob = await audioRes.blob()

    const form = new FormData()
    form.append('file', blob, 'audio.ogg')
    form.append('model', args.model ?? 'gpt-4o-mini-transcribe')
    form.append('language', args.language ?? 'pt')

    const res = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.apiKey}` },
      body: form,
    })
    if (!res.ok) {
      console.warn('[transcribe] whisper non-2xx:', res.status)
      return null
    }
    const data = (await res.json()) as { text?: string }
    const text = data.text?.trim()
    return text || null
  } catch (err) {
    console.warn(
      '[transcribe] failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
