import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const algorithm = "aes-256-gcm";

export class SecretVault {
  readonly #key: Buffer;

  constructor(dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    const keyPath = path.join(dataDirectory, "master.key");

    if (!existsSync(keyPath)) {
      writeFileSync(keyPath, randomBytes(32), {
        flag: "wx",
        mode: 0o600,
      });
    }

    chmodSync(keyPath, 0o600);
    this.#key = readFileSync(keyPath);

    if (this.#key.length !== 32) {
      throw new Error("The local secret-vault key is invalid.");
    }
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(algorithm, this.#key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [iv, tag, ciphertext]
      .map((part) => part.toString("base64url"))
      .join(".");
  }

  decrypt(value: string): string {
    const [ivValue, tagValue, ciphertextValue] = value.split(".");

    if (!ivValue || !tagValue || !ciphertextValue) {
      throw new Error("The encrypted secret has an invalid format.");
    }

    const decipher = createDecipheriv(
      algorithm,
      this.#key,
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

