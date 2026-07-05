import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractMessageId,
  uazapiInitInstance,
  uazapiSendMedia,
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
