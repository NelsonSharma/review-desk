import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";

export const userName = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Use 2–40 letters, numbers, dots, hyphens, or underscores.");
export const passwordRule = z.string().min(1, "Enter a password.").max(200);
export const sessionAge = 14 * 24 * 60 * 60 * 1000;
const derivation = promisify(scrypt);
const parameters = { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 };
const tokenHex = /^[a-f0-9]{64}$/;

export async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const key = await derivation(password, salt, 64, parameters);
  return "scrypt:" + salt + ":" + key.toString("hex");
}

export async function correctPassword(password, hash) {
  const [, salt, encoded] = (hash || "scrypt:48be3e199a96b70330ade2cba5d1bd4e:" + "0".repeat(128)).split(":");
  const derived = await hashPassword(password, salt);
  return timingSafeEqual(Buffer.from(derived.split(":")[2], "hex"), Buffer.from(encoded, "hex")) && Boolean(hash);
}

export function secretToken() { return randomBytes(32).toString("hex"); }
export function digest(token) { return createHash("sha256").update(token).digest("hex"); }

export function sessionToken(req) {
  const cookie = req.headers.cookie?.match(/(?:^|;\s*)literature_desk=([a-f0-9]{64})(?:;|$)/)?.[1];
  return cookie || "";
}

export function validCsrf(value, expected) {
  return typeof value === "string" && tokenHex.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
