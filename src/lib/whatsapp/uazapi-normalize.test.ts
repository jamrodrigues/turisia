import { describe, expect, it } from "vitest";
import {
  extractInstanceName,
  isBroadcastJid,
  isGroupJid,
  normalizeUazapiWebhook,
  phoneFromJid,
  resolveContentKind,
} from "./uazapi-normalize";

// Real captured envelope (uazapiGO v2). Individual tests override `message`.
const envelope = (message: Record<string, unknown>) => ({
  EventType: "messages",
  instanceName: "crmia-teste",
  message,
});

const TEXT_MSG = {
  type: "text",
  messageType: "ExtendedTextMessage",
  mediaType: "",
  chatid: "558198335873@s.whatsapp.net",
  sender: "139711091880175@lid", // WhatsApp LID — NOT a phone!
  senderName: "Patricia Emidia",
  fromMe: false,
  isGroup: false,
  messageid: "AC9F57DCAA0792B96CBB4F3BB6D2CB26",
  messageTimestamp: 1783293782000,
  text: "Oi teste",
};

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
    expect(isBroadcastJid("5511999999999@s.whatsapp.net")).toBe(false);
  });
});

describe("normalizeUazapiWebhook — real captured payloads", () => {
  it("normalizes a 1:1 text message (phone from chatid, NOT the lid)", () => {
    const ev = normalizeUazapiWebhook(envelope(TEXT_MSG));
    expect(ev.kind).toBe("inbound");
    expect(ev.fromPhone).toBe("558198335873"); // chatid, never the @lid sender
    expect(ev.pushName).toBe("Patricia Emidia");
    expect(ev.waMessageId).toBe("AC9F57DCAA0792B96CBB4F3BB6D2CB26");
    expect(ev.contentType).toBe("text");
    expect(ev.text).toBe("Oi teste");
    expect(ev.hasMedia).toBe(false);
    expect(ev.timestamp.getTime()).toBe(1783293782000);
    expect(ev.instanceName).toBe("crmia-teste");
  });

  it("normalizes a 1:1 image message (media)", () => {
    const ev = normalizeUazapiWebhook(
      envelope({
        type: "media",
        messageType: "ImageMessage",
        mediaType: "image",
        chatid: "558198335873@s.whatsapp.net",
        sender: "139711091880175@lid",
        senderName: "Patricia Emidia",
        fromMe: false,
        isGroup: false,
        messageid: "IMG-1",
        messageTimestamp: 1783293782000,
        text: "",
        content: {
          URL: "https://mmg.whatsapp.net/x.enc",
          mimetype: "image/jpeg",
          caption: "",
        },
      }),
    );
    expect(ev.kind).toBe("inbound");
    expect(ev.contentType).toBe("image");
    expect(ev.hasMedia).toBe(true);
    expect(ev.fromPhone).toBe("558198335873");
  });

  it("normalizes a 1:1 audio/ptt message (media)", () => {
    const ev = normalizeUazapiWebhook(
      envelope({
        type: "media",
        messageType: "AudioMessage",
        mediaType: "ptt",
        chatid: "558198335873@s.whatsapp.net",
        sender: "139711091880175@lid",
        senderName: "Patricia Emidia",
        fromMe: false,
        isGroup: false,
        messageid: "PTT-1",
        messageTimestamp: 1783293782000,
        text: "",
      }),
    );
    expect(ev.kind).toBe("inbound");
    expect(ev.contentType).toBe("audio");
    expect(ev.hasMedia).toBe(true);
  });

  it("flags fromMe messages (owner answered from the handset)", () => {
    const ev = normalizeUazapiWebhook(
      envelope({ ...TEXT_MSG, fromMe: true }),
    );
    expect(ev.kind).toBe("from_me");
    // For fromMe, the phone is still the chat jid (recipient side)
    expect(ev.fromPhone).toBe("558198335873");
  });
});

describe("normalizeUazapiWebhook — must-ignore cases", () => {
  it("ignores group messages", () => {
    const ev = normalizeUazapiWebhook(
      envelope({
        type: "text",
        messageType: "ExtendedTextMessage",
        mediaType: "",
        chatid: "120363424197612637@g.us",
        sender: "139711091880175@lid",
        isGroup: true,
        messageid: "G-1",
        messageTimestamp: 1783293782000,
        text: "mensagem em grupo",
      }),
    );
    expect(ev.kind).toBe("ignored");
    expect(ev.ignoredReason).toMatch(/group/);
  });

  it("ignores reactions (bare emoji rows would spam the inbox)", () => {
    const ev = normalizeUazapiWebhook(
      envelope({
        type: "reaction",
        messageType: "ReactionMessage",
        mediaType: "",
        chatid: "5511988887777@s.whatsapp.net",
        sender: "139711091880175@lid",
        isGroup: false,
        messageid: "R-1",
        messageTimestamp: 1783293782000,
        text: "👍🏻",
      }),
    );
    expect(ev.kind).toBe("ignored");
    expect(ev.ignoredReason).toBe("reaction");
  });

  it("ignores stories (status@broadcast)", () => {
    const ev = normalizeUazapiWebhook(
      envelope({
        type: "media",
        messageType: "ImageMessage",
        mediaType: "image",
        chatid: "status@broadcast",
        messageid: "S-1",
        messageTimestamp: 1783293782000,
      }),
    );
    expect(ev.kind).toBe("ignored");
  });

  it("ignores non-message events (connection, qrcode, presence, chats)", () => {
    for (const eventType of ["connection", "qrcode", "presence", "chats"]) {
      const ev = normalizeUazapiWebhook({ EventType: eventType, instanceName: "x" });
      expect(ev.kind).toBe("ignored");
    }
  });

  it("ignores garbage bodies without crashing", () => {
    expect(normalizeUazapiWebhook(null).kind).toBe("ignored");
    expect(normalizeUazapiWebhook("str").kind).toBe("ignored");
    expect(normalizeUazapiWebhook({}).kind).toBe("ignored");
  });
});

describe("resolveContentKind — CHECK-constraint safety", () => {
  it.each([
    // type,   mediaType,               messageType,             contentType, hasMedia, placeholder
    ["text", "", "Conversation", "text", false, null],
    ["media", "image", "ImageMessage", "image", true, null],
    ["media", "ptt", "AudioMessage", "audio", true, null],
    ["media", "gif", "VideoMessage", "video", true, null],
    ["media", "sticker", "StickerMessage", "image", true, "[figurinha]"],
    ["media", "user_created_sticker", "StickerMessage", "image", true, "[figurinha]"],
    ["media", "url", "ExtendedTextMessage", "text", false, null], // link preview
    ["media", "", "DocumentMessage", "document", true, null],
    ["media", "", "VideoMessage", "video", true, null],
  ])(
    "type=%s mediaType=%s messageType=%s → %s",
    (type, mediaType, messageType, contentType, hasMedia, placeholder) => {
      const r = resolveContentKind({
        type: type as string,
        mediaType: mediaType as string,
        messageType: messageType as string,
      });
      expect(r.contentType).toBe(contentType);
      expect(r.hasMedia).toBe(hasMedia);
      expect(r.placeholder).toBe(placeholder);
    },
  );
});

describe("extractInstanceName", () => {
  it("reads flat and nested shapes (flat instanceName wins first)", () => {
    expect(extractInstanceName({ instanceName: "crmia-teste" })).toBe("crmia-teste");
    expect(extractInstanceName({ instance: "a" })).toBe("a");
    expect(extractInstanceName({ instance: { name: "b" } })).toBe("b");
    // flat instanceName is checked FIRST, before the `instance` fallback
    expect(extractInstanceName({ instanceName: "c", instance: "z" })).toBe("c");
    expect(extractInstanceName({})).toBe(null);
  });
});
