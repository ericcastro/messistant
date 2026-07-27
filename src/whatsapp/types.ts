import type { Message } from "whatsapp-web.js";

export type ChatType = "self" | "direct" | "group" | "broadcast" | "status";

export interface NormalizedMessageEvent {
  id: string;
  occurredAt: number;
  body: string;
  chatId: string;
  chatName: string;
  actorId: string;
  accountId: string;
  direction: "incoming" | "outgoing";
  chatType: ChatType;
  fromMe: boolean;
  messageType: string;
  voiceSeconds: number;
  hasMedia: boolean;
  recentMessages: Message[];
  raw: Message;
}

export interface KnownChat {
  id: string;
  name: string;
  phoneNumber?: string;
  type: "self" | "direct" | "group";
}

export type WhatsAppPhase =
  | "stopped"
  | "starting"
  | "qr_required"
  | "authenticated"
  | "ready"
  | "disconnected"
  | "error";

export interface WhatsAppStatus {
  phase: WhatsAppPhase;
  detail: string;
  qrDataUrl: string | null;
  accountId: string | null;
  updatedAt: number;
}
