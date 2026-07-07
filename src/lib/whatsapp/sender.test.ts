import { describe, it, expect } from 'vitest'
import { humanizedTypingDelayMs } from './sender'

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
