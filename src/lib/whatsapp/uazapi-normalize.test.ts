import { describe, expect, it } from "vitest";
import {
  extractInstanceName,
  isBroadcastJid,
  isGroupJid,
  normalizeUazapiWebhook,
  phoneFromJid,
  uazapiTypeToContentKind,
} from "./uazapi-normalize";

describe("jid helpers", () => {
  it("extracts the phone from user jids", () => {
    expect(phoneFromJid("5511999999999@s.whatsapp.net")).toBe("5511999999999");
    expect(phoneFromJid("5511999999999@c.us")).toBe("5511999999999");
    // Baileys device suffix (":12") must be stripped too
    expect(phoneFromJid("5511999999999:12@s.whatsapp.net")).toBe("5511999999999");
  });

  it("detects group and broadcast jids", () => {
    expect(isGroupJid("123456-987654@g.us")).toBe(true);
    expect(isGroupJid("5511999999999@s.whatsapp.net")).toBe(false);
    expect(isBroadcastJid("status@broadcast")).toBe(true);
  });
});

describe("normalizeUazapiWebhook — envelope shapes", () => {
  const MSG = {
    messageid: "WA-1",
    chatid: "5511988887777@s.whatsapp.net",
    sender: "5511988887777@s.whatsapp.net",
    senderName: "Maria",
    fromMe: false,
    type: "conversation",
    text: "oi, quero agendar",
    messageTimestamp: 1750000000,
  };

  it("parses the flat { EventType, message } shape", () => {
    const ev = normalizeUazapiWebhook({
      EventType: "messages",
      instance: "clinica",
      message: MSG,
    });
    expect(ev.kind).toBe("inbound");
    expect(ev.instanceName).toBe("clinica");
    expect(ev.fromPhone).toBe("5511988887777");
    expect(ev.pushName).toBe("Maria");
    expect(ev.waMessageId).toBe("WA-1");
    expect(ev.text).toBe("oi, quero agendar");
    expect(ev.timestamp.getTime()).toBe(1750000000 * 1000);
  });

  it("parses the { event, data } shape with a nested instance object", () => {
    const ev = normalizeUazapiWebhook({
      event: "messages.upsert",
      instance: { name: "clube", token: "t" },
      data: MSG,
    });
    expect(ev.kind).toBe("inbound");
    expect(ev.instanceName).toBe("clube");
    expect(ev.fromPhone).toBe("5511988887777");
  });

  it("parses a raw Baileys key envelope", () => {
    const ev = normalizeUazapiWebhook({
      instance: "carros",
      message: {
        key: {
          remoteJid: "5511977776666@s.whatsapp.net",
          fromMe: false,
          id: "BAILEYS-1",
        },
        pushName: "João",
        messageTimestamp: 1750000001,
        type: "conversation",
        text: "quanto custa o civic?",
      },
    });
    expect(ev.kind).toBe("inbound");
    expect(ev.waMessageId).toBe("BAILEYS-1");
    expect(ev.fromPhone).toBe("5511977776666");
    expect(ev.pushName).toBe("João");
  });

  it("flags fromMe messages (owner answered from the handset)", () => {
    const ev = normalizeUazapiWebhook({
      EventType: "messages",
      instance: "clinica",
      message: { ...MSG, fromMe: true },
    });
    expect(ev.kind).toBe("from_me");
    // For fromMe, the customer is the chat jid (recipient side)
    expect(ev.fromPhone).toBe("5511988887777");
  });
});

describe("normalizeUazapiWebhook — must-ignore cases (fase-01 §1.7)", () => {
  it("ignores group messages", () => {
    const ev = normalizeUazapiWebhook({
      EventType: "messages",
      instance: "clinica",
      message: {
        messageid: "G-1",
        chatid: "12036302@g.us",
        sender: "5511988887777@s.whatsapp.net",
        type: "conversation",
        text: "mensagem em grupo",
      },
    });
    expect(ev.kind).toBe("ignored");
    expect(ev.ignoredReason).toMatch(/group/);
  });

  it("ignores stories (status@broadcast)", () => {
    const ev = normalizeUazapiWebhook({
      EventType: "messages",
      instance: "clinica",
      message: { messageid: "S-1", chatid: "status@broadcast", type: "imageMessage" },
    });
    expect(ev.kind).toBe("ignored");
  });

  it("ignores non-message events (connection, qrcode, presence)", () => {
    for (const eventType of ["connection", "qrcode", "presence", "chats"]) {
      const ev = normalizeUazapiWebhook({ EventType: eventType, instance: "x" });
      expect(ev.kind).toBe("ignored");
    }
  });

  it("ignores garbage bodies without crashing", () => {
    expect(normalizeUazapiWebhook(null).kind).toBe("ignored");
    expect(normalizeUazapiWebhook("str").kind).toBe("ignored");
    expect(normalizeUazapiWebhook({}).kind).toBe("ignored");
  });
});

describe("uazapiTypeToContentKind — CHECK-constraint safety (§1.7.2)", () => {
  it.each([
    ["conversation", "text", null],
    ["imageMessage", "image", null],
    ["videoMessage", "video", null],
    ["audioMessage", "audio", null],
    ["ptt", "audio", null],
    ["documentMessage", "document", null],
    ["locationMessage", "location", "[localização]"],
    ["stickerMessage", "image", "[figurinha]"],
    ["contactMessage", "text", "[contato compartilhado]"],
    ["pollCreationMessage", "text", "[enquete]"],
    ["someFutureType", "text", null],
  ])("%s → %s", (provider, contentType, placeholder) => {
    const r = uazapiTypeToContentKind(provider);
    expect(r.contentType).toBe(contentType);
    expect(r.placeholder).toBe(placeholder);
  });
});

describe("extractInstanceName", () => {
  it("reads flat and nested shapes", () => {
    expect(extractInstanceName({ instance: "a" })).toBe("a");
    expect(extractInstanceName({ instance: { name: "b" } })).toBe("b");
    expect(extractInstanceName({ instanceName: "c" })).toBe("c");
    expect(extractInstanceName({})).toBe(null);
  });
});
