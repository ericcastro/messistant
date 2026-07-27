import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const keyLength = 64;
const cost = 32_768;
const blockSize = 8;
const parallelization = 1;
const maxmem = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, keyLength, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem,
  });

  return [
    "scrypt",
    cost,
    blockSize,
    parallelization,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, nValue, rValue, pValue, saltValue, hashValue] =
    encoded.split("$");

  if (
    algorithm !== "scrypt" ||
    !nValue ||
    !rValue ||
    !pValue ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }

  const expected = Buffer.from(hashValue, "base64url");
  const actual = scryptSync(
    password,
    Buffer.from(saltValue, "base64url"),
    expected.length,
    {
      N: Number(nValue),
      r: Number(rValue),
      p: Number(pValue),
      maxmem,
    },
  );

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

