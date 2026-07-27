import { createHash, randomBytes } from "node:crypto";
import type { MessistantDatabase } from "../persistence/database.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { AuthenticatedSession } from "../config/types.js";

const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export class AuthService {
  constructor(readonly database: MessistantDatabase) {
    database.ensureAdmin(hashPassword("admin"));
    database.deleteExpiredSessions();
  }

  login(
    username: string,
    password: string,
  ): { token: string; session: AuthenticatedSession } | null {
    const user = this.database.getUser(username);

    if (!user || !verifyPassword(password, user.password_hash)) {
      return null;
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const now = Date.now();
    const csrfToken = randomBytes(24).toString("base64url");
    const expiresAt = now + sessionLifetimeMs;

    this.database.createSession({
      tokenHash,
      username,
      csrfToken,
      createdAt: now,
      expiresAt,
    });

    return {
      token,
      session: {
        tokenHash,
        username,
        csrfToken,
        mustChangePassword: user.must_change_password === 1,
        expiresAt,
      },
    };
  }

  getSession(token: string | undefined): AuthenticatedSession | null {
    return token ? this.database.getSession(hashToken(token)) : null;
  }

  logout(token: string | undefined): void {
    if (token) {
      this.database.deleteSession(hashToken(token));
    }
  }

  changePassword(input: {
    username: string;
    currentPassword: string;
    newPassword: string;
  }): void {
    const user = this.database.getUser(input.username);
    if (!user || !verifyPassword(input.currentPassword, user.password_hash)) {
      throw new Error("The current password is incorrect.");
    }
    if (input.newPassword.length < 12) {
      throw new Error("The new password must contain at least 12 characters.");
    }
    if (input.newPassword === "admin") {
      throw new Error("Choose a password other than the default.");
    }
    this.database.updatePassword(
      input.username,
      hashPassword(input.newPassword),
    );
  }
}

