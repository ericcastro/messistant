import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/security/password.js";

describe("password hashing", () => {
  it("verifies the right password and rejects another", () => {
    const encoded = hashPassword("a serious password");
    expect(encoded).not.toContain("a serious password");
    expect(verifyPassword("a serious password", encoded)).toBe(true);
    expect(verifyPassword("wrong password", encoded)).toBe(false);
  });

  it("rejects malformed hashes", () => {
    expect(verifyPassword("anything", "not-a-real-hash")).toBe(false);
  });
});

