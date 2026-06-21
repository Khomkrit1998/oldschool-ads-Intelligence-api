import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

import { env } from "../config/env.js";

/**
 * เข้ารหัส access token ก่อนเก็บลง DB (encryption at rest)
 * - AES-256-GCM (มี auth tag กันการแก้ไข ciphertext)
 * - key derive จาก COOKIE_SECRET ด้วย scrypt (ไม่ต้องเพิ่ม env ใหม่)
 *
 * รูปแบบที่เก็บ: base64(iv).base64(authTag).base64(ciphertext)
 */
const KEY = scryptSync(env.server.cookieSecret, "fb-token-enc", 32);
const IV_LENGTH = 12; // มาตรฐานของ GCM

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(".");
}

export function decryptToken(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted token");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    KEY,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
