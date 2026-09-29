import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const cost = 1 << 15;
const blockSize = 8;
const parallelization = 3;
const keyLength = 32;
const maximumMemory = 64 * 1024 * 1024;
const dummySalt = Buffer.alloc(16, 0x45);

function validPassword(password: string): boolean {
  const bytes = Buffer.byteLength(password, "utf8");
  return bytes >= 15 && bytes <= 1024;
}

export function assertPassword(password: string): void {
  if (!validPassword(password)) throw new Error("A senha deve conter de 15 a 1024 bytes.");
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, {
      N: cost, r: blockSize, p: parallelization, maxmem: maximumMemory,
    }, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  assertPassword(password);
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$${cost}$${blockSize}$${parallelization}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  if (!validPassword(password)) return false;
  const parts = encoded?.split("$");
  if (!parts || parts.length !== 6 || parts[0] !== "scrypt"
    || parts[1] !== String(cost) || parts[2] !== String(blockSize) || parts[3] !== String(parallelization)) {
    await derive(password, dummySalt);
    return false;
  }
  try {
    const salt = Buffer.from(parts[4]!, "base64url");
    const expected = Buffer.from(parts[5]!, "base64url");
    if (salt.length !== 16 || expected.length !== keyLength) return false;
    const actual = await derive(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function generateTemporaryPassword(): string {
  return randomBytes(24).toString("base64url");
}
