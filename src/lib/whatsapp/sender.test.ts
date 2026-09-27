import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  humanizedTypingDelayMs,
  providerSendInteractiveButtons,
  providerSendInteractiveList,
  type ProviderSendConfig,
} from './sender'

// decrypt() is exercised elsewhere; here we only care about the dispatch
// + native-menu/fallback logic, so make it an identity passthrough.
vi.mock('./encryption', () => ({ decrypt: (v: string) => v }))

describe('humanizedTypingDelayMs', () => {
  it('clamps short text up to the 1500ms floor', () => {
    expect(humanizedTypingDelayMs(0)).toBe(1500)
    expect(humanizedTypingDelayMs(10)).toBe(1500) // 500 < 1500 → floor
    expect(humanizedTypingDelayMs(30)).toBe(1500) // 1500 == floor
  })

  it('scales proportionally (50ms/char) inside the band', () => {
    expect(humanizedTypingDelayMs(40)).toBe(2000)
    expect(humanizedTypingDelayMs(80)).toBe(4000)
    expect(humanizedTypingDelayMs(119)).toBe(5950)
  })

  it('clamps long text at the 6000ms ceiling', () => {
    expect(humanizedTypingDelayMs(120)).toBe(6000) // 6000 == ceiling
    expect(humanizedTypingDelayMs(500)).toBe(6000)
    expect(humanizedTypingDelayMs(10_000)).toBe(6000)
  })
})

// ============================================================
// uazapi native interactive menus + numbered-text fallback
// ============================================================

const UAZAPI_CONFIG: ProviderSendConfig = {
  provider: 'uazapi',
  phone_number_id: 'unused',
  access_token: 'unused',
  uazapi_base_url: 'https://server.uazapi.test',
  uazapi_instance_token: 'inst-token',
}

function okJson(payload: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

/** All fetch calls made so far, as { url, body } pairs. */
function fetchCalls(): Array<{ url: string; body: Record<string, unknown> }> {
  const mock = fetch as unknown as ReturnType<typeof vi.fn>
  return mock.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse(String((init as RequestInit).body)),
  }))
}

describe('providerSendInteractiveButtons — uazapi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends a native button menu to /send/menu', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson({ messageid: 'WA-MENU' })))
    const result = await providerSendInteractiveButtons({
      config: UAZAPI_CONFIG,
      to: '5511999999999',
      bodyText: 'Como podemos ajudar?',
      headerText: 'Atendimento',
      footerText: 'Escolha uma opção',
      buttons: [
        { id: 'suporte', title: 'Suporte' },
        { id: 'pedido', title: 'Fazer pedido' },
      ],
    })
    const calls = fetchCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://server.uazapi.test/send/menu')
    expect(calls[0].body).toEqual({
      number: '5511999999999',
      type: 'button',
      text: '*Atendimento*\n\nComo podemos ajudar?',
      choices: ['Suporte|suporte', 'Fazer pedido|pedido'],
      footerText: 'Escolha uma opção',
    })
    expect(result.messageId).toBe('WA-MENU')
  })

  it('falls back to a numbered text menu when /send/menu fails', async () => {
    const fetchMock = vi.fn((url: string | URL) =>
      String(url).endsWith('/send/menu')
        ? Promise.resolve(new Response(JSON.stringify({ error: 'menu unsupported' }), { status: 400 }))
        : okJson({ messageid: 'WA-TEXT' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await providerSendInteractiveButtons({
      config: UAZAPI_CONFIG,
      to: '5511999999999',
      bodyText: 'Como podemos ajudar?',
      buttons: [
        { id: 'suporte', title: 'Suporte' },
        { id: 'pedido', title: 'Fazer pedido' },
      ],
    })
    const calls = fetchCalls()
    expect(calls.map((c) => c.url)).toEqual([
      'https://server.uazapi.test/send/menu',
      'https://server.uazapi.test/send/text',
    ])
    expect(calls[1].body).toEqual({
      number: '5511999999999',
      text: 'Como podemos ajudar?\n\n1. Suporte\n2. Fazer pedido',
    })
    expect(result.messageId).toBe('WA-TEXT')
  })
})

describe('providerSendInteractiveList — uazapi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends a native list menu with section headers to /send/menu', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson({ messageid: 'WA-LIST' })))
    await providerSendInteractiveList({
      config: UAZAPI_CONFIG,
      to: '5511999999999',
      bodyText: 'Escolha um horário',
      buttonLabel: 'Ver horários',
      sections: [
        {
          title: 'Manhã',
          rows: [
            { id: 'h09', title: '09:00', description: 'Dr. Ana' },
            { id: 'h10', title: '10:00' },
          ],
        },
        { title: 'Tarde', rows: [{ id: 'h14', title: '14:00' }] },
      ],
    })
    const calls = fetchCalls()
    expect(calls[0].url).toBe('https://server.uazapi.test/send/menu')
    expect(calls[0].body).toEqual({
      number: '5511999999999',
      type: 'list',
      text: 'Escolha um horário',
      choices: ['[Manhã]', '09:00|h09|Dr. Ana', '10:00|h10', '[Tarde]', '14:00|h14'],
      listButton: 'Ver horários',
    })
  })

  it('falls back to numbered text when /send/menu fails', async () => {
    const fetchMock = vi.fn((url: string | URL) =>
      String(url).endsWith('/send/menu')
        ? Promise.resolve(new Response('boom', { status: 500 }))
        : okJson({ messageid: 'WA-TEXT' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await providerSendInteractiveList({
      config: UAZAPI_CONFIG,
      to: '5511999999999',
      bodyText: 'Escolha',
      buttonLabel: 'Ver',
      sections: [{ title: 'Opções', rows: [{ id: 'a', title: 'A' }] }],
    })
    const calls = fetchCalls()
    expect(calls.map((c) => c.url)).toEqual([
      'https://server.uazapi.test/send/menu',
      'https://server.uazapi.test/send/text',
    ])
    expect(calls[1].body.text).toBe('Escolha\n\n*Opções*\n1. A')
    expect(result.messageId).toBe('WA-TEXT')
  })
})
