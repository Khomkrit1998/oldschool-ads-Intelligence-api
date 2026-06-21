import { randomBytes } from "node:crypto";

import { prisma } from "./prisma.js";
import { decryptToken } from "./token-cipher.js";

/**
 * จัดการ share link ที่ agency สร้างให้ client เปิดดู dashboard ของบัญชีเดียว
 * โดยไม่ต้อง login — ใช้ token ของ agency (customer) ฝั่ง server
 */

export interface ShareLinkInfo {
  id: string;
  token: string;
  adAccountId: string;
  accountName: string | null;
  label: string | null;
  revoked: boolean;
  expiresAt: Date | null;
  createdAt: Date;
}

/** สร้าง share link สำหรับบัญชีโฆษณาหนึ่ง คืน token */
export async function createShareLink(input: {
  customerId: string;
  adAccountId: string;
  accountName?: string;
  label?: string;
  expiresAt?: Date;
}): Promise<ShareLinkInfo> {
  const token = randomBytes(24).toString("base64url");
  const link = await prisma.shareLink.create({
    data: {
      token,
      customerId: input.customerId,
      adAccountId: input.adAccountId,
      accountName: input.accountName ?? null,
      label: input.label ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  });
  return toInfo(link);
}

/** รายการ share link ของ agency คนนี้ (ใหม่สุดก่อน) */
export async function listShareLinks(customerId: string): Promise<ShareLinkInfo[]> {
  const links = await prisma.shareLink.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
  });
  return links.map(toInfo);
}

/** revoke (ปิดการใช้งาน) — ต้องเป็นของ agency คนนี้เท่านั้น */
export async function revokeShareLink(
  id: string,
  customerId: string,
): Promise<boolean> {
  const result = await prisma.shareLink.updateMany({
    where: { id, customerId },
    data: { revoked: true },
  });
  return result.count > 0;
}

/** resolve token ของ client -> ข้อมูลที่ใช้ดึง (token ของ agency + บัญชีที่อนุญาต) */
export async function resolveShareLink(token: string): Promise<{
  customerId: string;
  adAccountId: string;
  accountName: string | null;
  userAccessToken: string;
} | null> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: { customer: true },
  });
  if (!link || link.revoked) return null;
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return null;

  // token ของ agency หมดอายุ -> ลิงก์ใช้ไม่ได้
  if (link.customer.expiresAt && link.customer.expiresAt.getTime() < Date.now()) {
    return null;
  }

  return {
    customerId: link.customerId,
    adAccountId: link.adAccountId,
    accountName: link.accountName,
    userAccessToken: decryptToken(link.customer.tokenEnc),
  };
}

function toInfo(link: {
  id: string;
  token: string;
  adAccountId: string;
  accountName: string | null;
  label: string | null;
  revoked: boolean;
  expiresAt: Date | null;
  createdAt: Date;
}): ShareLinkInfo {
  return {
    id: link.id,
    token: link.token,
    adAccountId: link.adAccountId,
    accountName: link.accountName,
    label: link.label,
    revoked: link.revoked,
    expiresAt: link.expiresAt,
    createdAt: link.createdAt,
  };
}
