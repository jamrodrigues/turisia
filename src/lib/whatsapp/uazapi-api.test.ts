import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractMessageId,
  uazapiInitInstance,
  uazapiSendMedia,
  uazapiSendMenu,
  uazapiSendReaction,
  uazapiSendText,
} from "./uazapi-api";

const CTX = { baseUrl: "https://server.uazapi.test", token: "inst-token" };

function okJson(payload: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function lastCall(): { url: string; init: RequestInit } {
  const mock = fetch as unknown as ReturnType<typeof vi.fn>;
  const [url, init] = mock.mock.calls[mock.mock.calls.length - 1];
  return { url: String(url), init: init as RequestInit };
}

function lastBody(): Record<string, unknown> {
  return JSON.parse(String(lastCall().init.body));
}

describe("uazapiSendText", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ messageid: "WA123" })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs { number, text } to /send/text with the instance token header", async () => {
    const result = await uazapiSendText({ ctx: CTX, to: "5511999999999", text: "olá" });
    const { url, init } = lastCall();
    expect(url).toBe("https://server.uazapi.test/send/text");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).token).toBe("inst-token");
    expect(lastBody()).toEqual({ number: "5511999999999", text: "olá" });
    expect(result.messageId).toBe("WA123");
  });

  it("tolerates a trailing slash in baseUrl", async () => {
    await uazapiSendText({
      ctx: { ...CTX, baseUrl: "https://server.uazapi.test/" },
      to: "5511999999999",
      text: "oi",
    });
    expect(lastCall().url).toBe("https://server.uazapi.test/send/text");
  });

  it("rejects empty text before any network call", async () => {
    await expect(
      uazapiSendText({ ctx: CTX, to: "5511999999999", text: "" }),
    ).rejects.toThrow(/requires text/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces the server's error message on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "instance disconnected" }), {
            status: 400,
          }),
        ),
      ),
    );
    await expect(
      uazapiSendText({ ctx: CTX, to: "5511999999999", text: "oi" }),
    ).rejects.toThrow("instance disconnected");
  });

  it("falls back to a status-based message when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<html>boom</html>", { status: 502 }))),
    );
    await expect(
      uazapiSendText({ ctx: CTX, to: "5511999999999", text: "oi" }),
    ).rejects.toThrow(/uazapi error 502/);
  });
});

describe("uazapiSendMedia", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ id: "WAMEDIA1" })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs { number, type, file, caption } to /send/media", async () => {
    const result = await uazapiSendMedia({
      ctx: CTX,
      to: "5511999999999",
      kind: "image",
      file: "https://cdn.example/pic.jpg",
      caption: "legenda",
    });
    expect(lastCall().url).toBe("https://server.uazapi.test/send/media");
    expect(lastBody()).toEqual({
      number: "5511999999999",
      type: "image",
      file: "https://cdn.example/pic.jpg",
      caption: "legenda",
    });
    expect(result.messageId).toBe("WAMEDIA1");
  });

  it("omits caption for audio (voice notes reject captions)", async () => {
    await uazapiSendMedia({
      ctx: CTX,
      to: "5511999999999",
      kind: "audio",
      file: "https://cdn.example/voice.ogg",
      caption: "ignored",
    });
    expect(lastBody()).toEqual({
      number: "5511999999999",
      type: "audio",
      file: "https://cdn.example/voice.ogg",
    });
  });

  it("sends docName only for documents", async () => {
    await uazapiSendMedia({
      ctx: CTX,
      to: "5511999999999",
      kind: "document",
      file: "https://cdn.example/contrato.pdf",
      filename: "contrato.pdf",
    });
    expect(lastBody()).toMatchObject({ type: "document", docName: "contrato.pdf" });

    await uazapiSendMedia({
      ctx: CTX,
      to: "5511999999999",
      kind: "image",
      file: "https://cdn.example/pic.jpg",
      filename: "pic.jpg",
    });
    expect(lastBody()).not.toHaveProperty("docName");
  });

  it("rejects a missing file before any network call", async () => {
    await expect(
      uazapiSendMedia({ ctx: CTX, to: "5511999999999", kind: "image", file: "" }),
    ).rejects.toThrow(/requires a file/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("uazapiSendReaction", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ messageid: "WAREACT1" })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs { number, id, text } to /message/react", async () => {
    await uazapiSendReaction({
      ctx: CTX,
      to: "5511999999999",
      targetMessageId: "WA123",
      emoji: "👍",
    });
    expect(lastCall().url).toBe("https://server.uazapi.test/message/react");
    expect(lastBody()).toEqual({ number: "5511999999999", id: "WA123", text: "👍" });
  });

  it("requires the target message id", async () => {
    await expect(
      uazapiSendReaction({ ctx: CTX, to: "5511999999999", targetMessageId: "", emoji: "👍" }),
    ).rejects.toThrow(/requires targetMessageId/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("uazapiSendMenu", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ messageid: "WAMENU1" })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs a button menu with pipe-encoded 'label|id' choices to /send/menu", async () => {
    const result = await uazapiSendMenu({
      ctx: CTX,
      to: "5511999999999",
      kind: "button",
      text: "Como podemos ajudar?",
      choices: [
        { label: "Suporte", id: "suporte" },
        { label: "Pedido", id: "pedido" },
      ],
      footerText: "Escolha uma opção",
    });
    expect(lastCall().url).toBe("https://server.uazapi.test/send/menu");
    expect(lastBody()).toEqual({
      number: "5511999999999",
      type: "button",
      text: "Como podemos ajudar?",
      choices: ["Suporte|suporte", "Pedido|pedido"],
      footerText: "Escolha uma opção",
    });
    expect(result.messageId).toBe("WAMENU1");
  });

  it("encodes a list menu with section headers and 'label|id|description' rows", async () => {
    await uazapiSendMenu({
      ctx: CTX,
      to: "5511999999999",
      kind: "list",
      text: "Catálogo",
      choices: [
        { label: "Smartphones", id: "phones", description: "Lançamentos", section: "Eletrônicos" },
        { label: "Notebooks", id: "notes", section: "Eletrônicos" },
        { label: "Fones", id: "fones", description: "Bluetooth", section: "Acessórios" },
      ],
      listButton: "Ver Catálogo",
      footerText: "Preços sujeitos a alteração",
    });
    expect(lastBody()).toEqual({
      number: "5511999999999",
      type: "list",
      text: "Catálogo",
      choices: [
        "[Eletrônicos]",
        "Smartphones|phones|Lançamentos",
        "Notebooks|notes",
        "[Acessórios]",
        "Fones|fones|Bluetooth",
      ],
      listButton: "Ver Catálogo",
      footerText: "Preços sujeitos a alteração",
    });
  });

  it("omits footerText and listButton when not provided", async () => {
    await uazapiSendMenu({
      ctx: CTX,
      to: "5511999999999",
      kind: "button",
      text: "Sim ou não?",
      choices: [
        { label: "Sim", id: "yes" },
        { label: "Não", id: "no" },
      ],
    });
    expect(lastBody()).toEqual({
      number: "5511999999999",
      type: "button",
      text: "Sim ou não?",
      choices: ["Sim|yes", "Não|no"],
    });
  });

  it("rejects empty text and empty choices before any network call", async () => {
    await expect(
      uazapiSendMenu({ ctx: CTX, to: "5511999999999", kind: "button", text: "", choices: [{ label: "A", id: "a" }] }),
    ).rejects.toThrow(/requires text/);
    await expect(
      uazapiSendMenu({ ctx: CTX, to: "5511999999999", kind: "button", text: "oi", choices: [] }),
    ).rejects.toThrow(/at least one choice/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("extractMessageId — response envelope variants", () => {
  it.each([
    [{ messageid: "A" }, "A"],
    [{ messageId: "B" }, "B"],
    [{ id: "C" }, "C"],
    [{ key: { id: "D" } }, "D"],
    [{ message: { messageid: "E" } }, "E"],
    [{ response: { key: { id: "F" } } }, "F"],
    [{ data: { id: "G" } }, "G"],
  ])("extracts from %j", (payload, expected) => {
    expect(extractMessageId(payload)).toBe(expected);
  });

  it("returns '' when nothing matches (callers persist with null message_id)", () => {
    expect(extractMessageId({ ok: true })).toBe("");
    expect(extractMessageId(null)).toBe("");
    expect(extractMessageId("WA1")).toBe("");
  });

  it("does not recurse forever on circular payloads", () => {
    const a: Record<string, unknown> = {};
    a.message = a;
    expect(extractMessageId(a)).toBe("");
  });
});

describe("uazapiSetWebhook", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs { url, events, enabled } to /webhook with the instance token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => okJson([{ id: "wh1", url: "https://crm/api/uazapi/webhook?secret=s" }])),
    );
    const { uazapiSetWebhook } = await import("./uazapi-api");
    await uazapiSetWebhook(CTX, { url: "https://crm/api/uazapi/webhook?secret=s" });
    expect(lastCall().url).toBe("https://server.uazapi.test/webhook");
    expect(lastBody()).toEqual({
      url: "https://crm/api/uazapi/webhook?secret=s",
      events: ["messages"],
      enabled: true,
    });
  });
});

describe("uazapiInitInstance (provisioning)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the admintoken header and returns the new instance token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => okJson({ instance: { name: "clinica", token: "new-inst-token" } })),
    );
    const result = await uazapiInitInstance({
      baseUrl: "https://server.uazapi.test",
      adminToken: "admin-secret",
      name: "clinica",
    });
    const { url, init } = lastCall();
    expect(url).toBe("https://server.uazapi.test/instance/init");
    expect((init.headers as Record<string, string>).admintoken).toBe("admin-secret");
    expect((init.headers as Record<string, string>).token).toBeUndefined();
    expect(lastBody()).toEqual({ name: "clinica" });
    expect(result.instanceToken).toBe("new-inst-token");
  });

  it("throws when the server returns no token", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ status: "created" })));
    await expect(
      uazapiInitInstance({
        baseUrl: "https://server.uazapi.test",
        adminToken: "admin-secret",
        name: "clinica",
      }),
    ).rejects.toThrow(/did not return an instance token/);
  });
});
