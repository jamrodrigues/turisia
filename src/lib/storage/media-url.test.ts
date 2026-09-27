import { describe, it, expect, vi } from "vitest";
import {
  parseStorageUrl,
  isSignedStorageUrl,
  MEDIA_URL_TTL,
} from "./media-url";

const HOST = "https://supabasees.astrealabs.com.br";
const ACCT = "account-11111111-1111-1111-1111-111111111111";

describe("parseStorageUrl", () => {
  it("lê a forma pública (a que fica gravada em messages.media_url)", () => {
    expect(
      parseStorageUrl(`${HOST}/storage/v1/object/public/chat-media/${ACCT}/1-foto.jpg`),
    ).toEqual({ bucket: "chat-media", path: `${ACCT}/1-foto.jpg` });
  });

  it("lê a forma assinada e a autenticada", () => {
    expect(
      parseStorageUrl(
        `${HOST}/storage/v1/object/sign/chat-media/${ACCT}/1-a.pdf?token=abc.def`,
      ),
    ).toEqual({ bucket: "chat-media", path: `${ACCT}/1-a.pdf` });
    expect(
      parseStorageUrl(`${HOST}/storage/v1/object/authenticated/flow-media/${ACCT}/x.png`),
    ).toEqual({ bucket: "flow-media", path: `${ACCT}/x.png` });
  });

  it("aceita o caminho legado do flow-media (pasta do usuário, pré-020)", () => {
    const uid = "22222222-2222-2222-2222-222222222222";
    expect(
      parseStorageUrl(`${HOST}/storage/v1/object/public/flow-media/${uid}/9-b.png`),
    ).toEqual({ bucket: "flow-media", path: `${uid}/9-b.png` });
  });

  it("decodifica caminho com espaço/acento", () => {
    const parsed = parseStorageUrl(
      `${HOST}/storage/v1/object/public/chat-media/${ACCT}/1-guia%20m%C3%A9dica.pdf`,
    );
    expect(parsed?.path).toBe(`${ACCT}/1-guia médica.pdf`);
  });

  it("devolve null para o que NÃO é bucket nosso — não assinamos às cegas", () => {
    // bucket de outra finalidade
    expect(
      parseStorageUrl(`${HOST}/storage/v1/object/public/avatars/${ACCT}/me.png`),
    ).toBeNull();
    // URL do provedor (uazapi) — o fallback quando o re-upload falha
    expect(parseStorageUrl("https://uazapi.example.com/files/abc.ogg")).toBeNull();
    // proxy interno da Meta
    expect(parseStorageUrl("/api/whatsapp/media/1234")).toBeNull();
    expect(parseStorageUrl("")).toBeNull();
    expect(parseStorageUrl("not a url")).toBeNull();
  });

  it("devolve null quando não há caminho depois do bucket", () => {
    expect(parseStorageUrl(`${HOST}/storage/v1/object/public/chat-media/`)).toBeNull();
    expect(parseStorageUrl(`${HOST}/storage/v1/object/public/chat-media`)).toBeNull();
  });
});

describe("isSignedStorageUrl", () => {
  it("reconhece uma URL já assinada (para não assinar duas vezes)", () => {
    expect(
      isSignedStorageUrl(
        `${HOST}/storage/v1/object/sign/chat-media/${ACCT}/a.jpg?token=xyz`,
      ),
    ).toBe(true);
    expect(
      isSignedStorageUrl(`${HOST}/storage/v1/object/public/chat-media/${ACCT}/a.jpg`),
    ).toBe(false);
  });
});

describe("signMediaUrl (servidor) — comportamento tolerante a falha", () => {
  it("passa adiante, sem assinar, o que não é bucket nosso", async () => {
    const { signMediaUrl } = await import("./media-url.server");
    const externa = "https://uazapi.example.com/files/abc.ogg";
    await expect(signMediaUrl(externa)).resolves.toBe(externa);
    await expect(signMediaUrl(null)).resolves.toBe("");
    await expect(signMediaUrl(undefined)).resolves.toBe("");
  });

  it("não re-assina uma URL que já veio assinada", async () => {
    const { signMediaUrl } = await import("./media-url.server");
    const assinada = `${HOST}/storage/v1/object/sign/chat-media/${ACCT}/a.jpg?token=xyz`;
    await expect(signMediaUrl(assinada)).resolves.toBe(assinada);
  });

  it("devolve a URL original quando a assinatura falha (mídia > nada)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/flows/admin-client", () => ({
      supabaseAdmin: () => ({
        storage: {
          from: () => ({
            createSignedUrl: async () => ({
              data: null,
              error: { message: "storage indisponível" },
            }),
          }),
        },
      }),
    }));
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { signMediaUrl } = await import("./media-url.server");
    const url = `${HOST}/storage/v1/object/public/chat-media/${ACCT}/a.jpg`;
    await expect(signMediaUrl(url)).resolves.toBe(url);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
    vi.doUnmock("@/lib/flows/admin-client");
    vi.resetModules();
  });

  it("assina com o TTL pedido quando o objeto é nosso", async () => {
    vi.resetModules();
    const createSignedUrl = vi.fn(async (path: string) => ({
      data: { signedUrl: `${HOST}/storage/v1/object/sign/chat-media/${path}?token=t` },
      error: null,
    }));
    vi.doMock("@/lib/flows/admin-client", () => ({
      supabaseAdmin: () => ({ storage: { from: () => ({ createSignedUrl }) } }),
    }));
    const { signMediaUrl } = await import("./media-url.server");
    const url = `${HOST}/storage/v1/object/public/chat-media/${ACCT}/a.jpg`;
    const out = await signMediaUrl(url, MEDIA_URL_TTL.outboundSend);
    expect(out).toContain("/object/sign/");
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${ACCT}/a.jpg`,
      MEDIA_URL_TTL.outboundSend,
    );
    vi.doUnmock("@/lib/flows/admin-client");
    vi.resetModules();
  });
});
