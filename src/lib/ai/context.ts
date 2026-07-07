import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

type MediaContentType = 'image' | 'video' | 'document' | 'audio'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
}

/** Media content types the brain can meaningfully see (item 4/5). */
const MEDIA_TYPES: MediaContentType[] = ['image', 'video', 'document', 'audio']

/** Human-readable Portuguese noun for a media type without a caption. */
const MEDIA_NOUN: Record<MediaContentType, string> = {
  image: 'uma imagem',
  video: 'um vídeo',
  document: 'um documento',
  audio: 'um áudio',
}

/** Portuguese label used to prefix a captioned media message. */
const MEDIA_LABEL: Record<MediaContentType, string> = {
  image: 'imagem',
  video: 'vídeo',
  document: 'documento',
  audio: 'áudio',
}

/**
 * Turn one DB row into the text the model should see, or null to skip it.
 *
 *   - text: the content verbatim (whitespace-trimmed).
 *   - audio: the in-place transcription (dispatch.ts writes it as
 *     "[áudio] …"). A row with no real text — i.e. an undownloaded /
 *     untranscribed placeholder like "[áudio não baixado]" — is dropped,
 *     since it carries nothing for the model.
 *   - image/video/document (customer only): the caption prefixed with the
 *     media kind, or a synthetic "[cliente enviou uma imagem]" when there
 *     is no caption — so the bot knows a photo/doc arrived instead of
 *     answering into the void. Bot/agent-sent media carries no useful
 *     context and would just burn tokens, so it's excluded.
 */
function rowToContent(m: DbMessage): string | null {
  const text = m.content_text?.trim() ?? ''

  if (m.content_type === 'text') {
    return text || null
  }

  if (m.content_type === 'audio') {
    // Keep only a transcribed voice note. The transcription is prefixed
    // "[áudio] " (dispatch.ts); a bare placeholder like "[áudio não
    // baixado]" starts with "[" but is not that prefix → drop it.
    if (!text) return null
    if (text.startsWith('[') && !text.startsWith('[áudio]')) return null
    return text
  }

  if ((MEDIA_TYPES as string[]).includes(m.content_type)) {
    // Only inbound (customer) media adds context worth modeling.
    if (m.sender_type !== 'customer') return null
    const kind = m.content_type as MediaContentType
    // A caption already prefixed by us ("[imagem] …") is passed through;
    // otherwise prefix the kind, or synthesize when there is no caption.
    if (text) {
      return text.startsWith('[') ? text : `[${MEDIA_LABEL[kind]}] ${text}`
    }
    return `[cliente enviou ${MEDIA_NOUN[kind]}]`
  }

  // templates / interactive / anything else — no text for the model.
  return null
}

/**
 * Fetch the last N messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`.
 *
 * Text, transcribed audio, and inbound media (as a synthetic
 * placeholder) all reach the model — so a customer who only sends voice
 * notes or photos is no longer invisible to the brain. Templates and
 * interactive prompts (no free text) are still excluded.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_type, content_text')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'audio', 'image', 'video', 'document'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  const out: ChatMessage[] = []
  for (const m of rows) {
    const content = rowToContent(m)
    if (!content) continue
    out.push({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content,
    })
  }
  return out
}
