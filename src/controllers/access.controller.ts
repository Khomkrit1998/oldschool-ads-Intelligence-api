import { timingSafeEqual } from "node:crypto";
import type { CookieOptions, NextFunction, Request, Response } from "express";

import { env } from "../config/env.js";

/**
 * Gate ส่วนหน้า: ต้องกรอก ACCESS_CODE ให้ถูกก่อนถึงจะใช้งานเว็บหลักได้
 * ยืนยันแล้วเก็บสถานะไว้ใน signed cookie (httpOnly) — แก้ที่ฝั่ง client ไม่ได้
 */
const GATE_COOKIE = "gate";
const GATE_VALUE = "ok";
const GATE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 วัน

function cookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    signed: true,
    secure: env.server.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeMs,
  };
}

/** เทียบรหัสแบบ constant-time กัน timing attack (รองรับความยาวต่างกัน) */
function codeMatches(input: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(env.access.code);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** true เมื่อ request นี้ผ่าน gate มาแล้ว (มี signed cookie ที่ถูกต้อง) */
export function isUnlocked(req: Request): boolean {
  return req.signedCookies?.[GATE_COOKIE] === GATE_VALUE;
}

/** GET /api/access/status — ให้ frontend เช็คว่าปลดล็อกแล้วหรือยัง */
export function status(req: Request, res: Response): void {
  res.json({ unlocked: isUnlocked(req) });
}

/** POST /api/access/verify  body: { code } — ตรวจรหัสแล้วตั้ง cookie ถ้าถูก */
export function verify(req: Request, res: Response): void {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!code || !codeMatches(code)) {
    res.status(401).json({ error: "invalid_code" });
    return;
  }
  res.cookie(GATE_COOKIE, GATE_VALUE, cookieOptions(GATE_TTL_MS));
  res.json({ ok: true });
}

/** POST /api/access/lock — ยกเลิก gate (ลบ cookie) บังคับให้กรอกรหัสใหม่ */
export function lock(_req: Request, res: Response): void {
  res.clearCookie(GATE_COOKIE, cookieOptions(0));
  res.json({ ok: true });
}

/**
 * Middleware: ต้องผ่าน gate ก่อนถึงจะเรียก data API ได้
 * (กันการข้ามหน้า gate ของ frontend แล้วยิง API ตรง ๆ)
 */
export function requireGate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isUnlocked(req)) {
    res.status(403).json({ error: "gate_locked" });
    return;
  }
  next();
}
