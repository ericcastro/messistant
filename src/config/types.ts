export const accessModes = [
  "disabled",
  "self_chat_only",
  "owner_any_chat",
  "allowlist",
  "owner_or_allowlist",
  "everyone",
] as const;

export type AccessMode = (typeof accessModes)[number];

export interface CapabilityConfiguration {
  id: string;
  enabled: boolean;
  accessMode: AccessMode;
  groupIds: string[];
  directChatIds: string[];
  settings: Record<string, unknown>;
}

export interface CapabilityDefaults extends CapabilityConfiguration {
  name: string;
  description: string;
  triggerLabel: string;
}

export interface AccessGroup {
  id: string;
  name: string;
  chatIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface GlobalSettings {
  textModel: string;
  transcriptionModel: string;
  timezone: string;
  retentionDays: number;
}

export interface AuthenticatedSession {
  tokenHash: string;
  username: string;
  csrfToken: string;
  mustChangePassword: boolean;
  expiresAt: number;
}

