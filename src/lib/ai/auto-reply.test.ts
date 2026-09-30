import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  retrieveBookableTopics: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  startFlowByAiTopic: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./booking-topics', () => ({ retrieveBookableTopics: h.retrieveBookableTopics }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('@/lib/flows/engine', () => ({ startFlowByAiTopic: h.startFlowByAiTopic }))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.retrieveBookableTopics.mockResolvedValue([])
  h.generateReply.mockResolvedValue({
    text: 'Hello!',
    handoff: false,
    bookingTopic: null,
    usage: { inputTokens: 100, outputTokens: 20 },
  })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.startFlowByAiTopic.mockResolvedValue({ consumed: true, outcome: 'started' })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({
      text: '',
      handoff: true,
      bookingTopic: null,
      usage: { inputTokens: 100, outputTokens: 5 },
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toEqual(
      expect.objectContaining({
        ai_autoreply_disabled: true,
        handoff_reason: 'ai_sentinel',
        handoff_by: 'bot',
        handoff_at: expect.any(String),
      }),
    )
    expect(h.state.rpcCalls).toHaveLength(0)
  })
})

describe('dispatchInboundToAiReply — booking sentinel', () => {
  it('starts the matching flow instead of sending a chat reply', async () => {
    h.retrieveBookableTopics.mockResolvedValue(['buggy'])
    h.generateReply.mockResolvedValue({
      text: '',
      handoff: false,
      bookingTopic: 'buggy',
      usage: { inputTokens: 100, outputTokens: 5 },
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.startFlowByAiTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        contactId: 'contact-1',
        conversationId: 'conv-1',
        topic: 'buggy',
      }),
    )
    expect(h.engineSendText).not.toHaveBeenCalled()
    // Consumed by the flow — the thread is NOT marked ai_autoreply_disabled.
    expect(h.state.updatePayload).toBeNull()
  })

  it('falls back to human handoff when no active flow matches the topic', async () => {
    h.retrieveBookableTopics.mockResolvedValue(['buggy'])
    h.generateReply.mockResolvedValue({
      text: '',
      handoff: false,
      bookingTopic: 'buggy',
      usage: { inputTokens: 100, outputTokens: 5 },
    })
    h.startFlowByAiTopic.mockResolvedValue({ consumed: false, outcome: 'no_match' })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toEqual(
      expect.objectContaining({ ai_autoreply_disabled: true, handoff_reason: 'ai_sentinel' }),
    )
  })

  it('ignores a booking topic the account never advertised as bookable', async () => {
    h.retrieveBookableTopics.mockResolvedValue(['buggy'])
    h.generateReply.mockResolvedValue({
      text: '',
      handoff: false,
      bookingTopic: 'mergulho', // not in bookableTopics
      usage: { inputTokens: 100, outputTokens: 5 },
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.startFlowByAiTopic).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    // Still disables auto-reply — a mismatched/hallucinated sentinel is
    // never sent to the customer as literal text either.
    expect(h.state.updatePayload).toEqual(
      expect.objectContaining({ ai_autoreply_disabled: true, handoff_reason: 'ai_sentinel' }),
    )
  })
})
