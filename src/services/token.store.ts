import { randomBytes } from "node:crypto";

import { prisma } from "./prisma.js";
import { decryptToken, encryptToken } from "./token-cipher.js";

/**
 * Token store แบบ multi-tenant บน DB (Prisma)
 * - 1 Customer = 1 คน/ระบบที่เชื่อมต่อ Facebook (token เก็บแบบเข้ารหัส)
 * - sid cookie -> Session -> Customer
 * React ไม่เคยเห็น access token — เห็นแค่ sid
 */

export interface ConnectionInput {
  fbUserId: string;
  name: string;
  email?: string;
  accessToken: string;
  tokenType: string;
  /** epoch ms ที่ token หมดอายุ (system user token มักไม่หมด -> undefined) */
  expiresAt?: number;
}

/** context ที่ controller ใช้ต่อหลังผ่าน requireSession */
export interface SessionContext {
  customerId: string;
  userId: string;
  userAccessToken: string;
  tokenType: string;
  /** epoch ms ที่ token หมดอายุ (null = ไม่หมด/ไม่ทราบ) */
  tokenExpiresAt: number | null;
}

/** upsert customer + token (encrypt ก่อนเก็บ) แล้วคืน customerId */
export async function saveConnection(input: ConnectionInput): Promise<string> {
  const data = {
    name: input.name,
    email: input.email ?? null,
    tokenEnc: encryptToken(input.accessToken),
    tokenType: input.tokenType,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
  };
  const customer = await prisma.customer.upsert({
    where: { fbUserId: input.fbUserId },
    update: data,
    create: { fbUserId: input.fbUserId, ...data },
  });
  return customer.id;
}

/** สร้าง session ใหม่ผูกกับ customer คืนค่า sid */
export async function createSession(
  customerId: string,
  ttlMs: number,
): Promise<string> {
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      id: sid,
      customerId,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return sid;
}

/** resolve sid -> SessionContext (decrypt token), null ถ้าไม่มี/หมดอายุ */
export async function getSessionContext(
  sid: string | undefined,
): Promise<SessionContext | null> {
  if (!sid) return null;

  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { customer: true },
  });
  if (!session) return null;

  // session หมดอายุ
  if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: sid } }).catch(() => undefined);
    return null;
  }
  // token หมดอายุ (เช่น user token 60 วัน)
  if (
    session.customer.expiresAt &&
    session.customer.expiresAt.getTime() < Date.now()
  ) {
    return null;
  }

  return {
    customerId: session.customerId,
    userId: session.customer.fbUserId,
    userAccessToken: decryptToken(session.customer.tokenEnc),
    tokenType: session.customer.tokenType,
    tokenExpiresAt: session.customer.expiresAt
      ? session.customer.expiresAt.getTime()
      : null,
  };
}

/** ลบ session (logout) */
export async function destroySession(sid: string | undefined): Promise<void> {
  if (!sid) return;
  await prisma.session.delete({ where: { id: sid } }).catch(() => undefined);
}
