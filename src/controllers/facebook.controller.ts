import { randomBytes } from "node:crypto";
import type { CookieOptions, NextFunction, Request, Response } from "express";

import { env, usesBusinessLogin } from "../config/env.js";
import * as meta from "../services/meta.service.js";
import { MetaApiError } from "../services/meta-error.js";
import {
  createSession,
  destroySession,
  getSessionContext,
  saveConnection,
  type SessionContext,
} from "../services/token.store.js";

const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 วัน

const SID_COOKIE = "sid"; // session ของ OAuth live dashboard
const SID_TOKEN_COOKIE = "sid_token"; // session ของหน้า "เชื่อมด้วย token" (แยกกัน)
const STATE_COOKIE = "fb_oauth_state";

/**
 * เลือกชื่อ cookie ของ session ตาม header `x-fb-session`
 * - "token" → หน้า BYO-token (sid_token)
 * - อื่น ๆ  → OAuth live dashboard (sid)
 * ทำให้สองหน้ามี session แยกกันในเบราว์เซอร์เดียว
 */
function sidCookieName(req: Request): string {
  return req.get("x-fb-session") === "token" ? SID_TOKEN_COOKIE : SID_COOKIE;
}

/** ตัวเลือก cookie กลาง: httpOnly เสมอ, Secure เฉพาะ production */
function cookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.server.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeMs,
  };
}

/**
 * GET /auth/facebook/login
 * สร้าง state กัน CSRF, เก็บลง httpOnly cookie, แล้ว redirect ไป Facebook
 */
export function login(_req: Request, res: Response): void {
  const state = randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, cookieOptions(10 * 60 * 1000)); // 10 นาที
  res.redirect(meta.buildLoginUrl(state));
}

/**
 * GET /auth/facebook/callback?code&state
 * จุดที่ Facebook redirect กลับมา — validate state, แลก token, สร้าง session
 */
export async function callback(req: Request, res: Response): Promise<void> {
  const { code, state, error, error_description } = req.query;

  // (11) user กด Cancel / ไม่อนุญาต
  if (typeof error === "string") {
    const reason = typeof error_description === "string" ? error_description : error;
    redirectToFrontend(res, { ok: false, reason });
    return;
  }

  // (11) ป้องกัน CSRF: state จาก query ต้องตรงกับ cookie ที่เราเซ็ตไว้
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, cookieOptions(0));
  if (
    typeof state !== "string" ||
    typeof expectedState !== "string" ||
    state !== expectedState
  ) {
    redirectToFrontend(res, { ok: false, reason: "invalid_state" });
    return;
  }

  if (typeof code !== "string") {
    redirectToFrontend(res, { ok: false, reason: "missing_code" });
    return;
  }

  try {
    const exchanged = await meta.exchangeCodeForToken(code);

    // FLB: System User token เสถียร/long-lived อยู่แล้ว ไม่ต้องแลกต่อ
    // Standard OAuth: แลก short-lived -> long-lived (~60 วัน)
    const tokenRes = usesBusinessLogin
      ? exchanged
      : await meta.exchangeForLongLivedToken(exchanged.access_token);

    const profile = await meta.getProfile(tokenRes.access_token);

    // upsert ลูกค้า + เก็บ token (เข้ารหัส) ลง DB แล้วผูก session
    const customerId = await saveConnection({
      fbUserId: profile.id,
      name: profile.name,
      email: profile.email,
      accessToken: tokenRes.access_token,
      tokenType: usesBusinessLogin ? "system_user" : "user",
      expiresAt: tokenRes.expires_in
        ? Date.now() + tokenRes.expires_in * 1000
        : undefined,
    });
    const sid = await createSession(customerId, SESSION_TTL_MS);
    res.cookie(SID_COOKIE, sid, cookieOptions(SESSION_TTL_MS));
    redirectToFrontend(res, { ok: true });
  } catch (err) {
    // log สาเหตุจริงจาก Facebook (code/subcode/fbtrace) เพื่อ debug — ไม่ส่งให้ frontend ตรง ๆ
    if (err instanceof MetaApiError) {
      console.error("[fb callback] token exchange failed:", {
        message: err.message,
        code: err.code,
        subcode: err.subcode,
        status: err.status,
        fbtraceId: err.fbtraceId,
      });
    } else {
      console.error("[fb callback] token exchange failed:", err);
    }
    const reason = err instanceof MetaApiError ? err.message : "exchange_failed";
    redirectToFrontend(res, { ok: false, reason });
  }
}

/** POST /auth/facebook/logout — ลบ session + cookie (ของ session ที่ระบุด้วย header) */
export async function logout(req: Request, res: Response): Promise<void> {
  const cookie = sidCookieName(req);
  await destroySession(req.cookies?.[cookie]);
  meta.clearGraphCache();
  res.clearCookie(cookie, cookieOptions(0));
  res.json({ ok: true });
}

/**
 * POST /auth/facebook/token  body: { accessToken }
 * เชื่อมต่อด้วย access token ที่ผู้ใช้วางเอง (BYO) — validate แล้วเก็บเข้ารหัสฝั่ง server
 * สร้าง session แยก (cookie `sid_token`) ไม่กระทบ OAuth live dashboard
 */
export async function connectWithToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const accessToken =
      typeof req.body?.accessToken === "string" ? req.body.accessToken.trim() : "";
    if (!accessToken) {
      res.status(400).json({ error: "missing_token" });
      return;
    }

    // 1) best-effort แลก long-lived (ได้เฉพาะ token ที่ออกจากแอปเรา; แอปอื่นจะ error -> ใช้ของเดิม)
    let token = accessToken;
    let expiresAt: number | undefined;
    try {
      const longLived = await meta.exchangeForLongLivedToken(accessToken);
      if (longLived.access_token) {
        token = longLived.access_token;
        if (longLived.expires_in) expiresAt = Date.now() + longLived.expires_in * 1000;
      }
    } catch {
      /* token จากแอปอื่น/หมดสิทธิ์แลก — ใช้ token เดิม */
    }

    // 2) best-effort: debug_token เพื่ออ่านวันหมดอายุ (NOTE: is_valid ผูกกับแอป — ห้ามใช้ตัดสิน)
    // long-lived token มักได้ expires_at = 0 (ตัว token ไม่หมด) แต่ data_access_expires_at
    // คือกำหนดที่ต้อง re-auth (~90 วัน) → ใช้เป็น fallback
    if (expiresAt === undefined) {
      try {
        const info = await meta.debugToken(token);
        const sec =
          info.expires_at && info.expires_at > 0
            ? info.expires_at
            : info.data_access_expires_at && info.data_access_expires_at > 0
              ? info.data_access_expires_at
              : 0;
        if (sec > 0) expiresAt = sec * 1000;
      } catch {
        /* debug ด้วยแอปเราไม่ได้ (token แอปอื่น) — ข้าม */
      }
    }

    // 3) ตัวตัดสินจริง: เรียก /me ด้วย token เอง — ถ้าได้ profile = token ใช้ได้
    let profile;
    try {
      profile = await meta.getProfile(token);
    } catch (err) {
      const reason =
        err instanceof MetaApiError ? `${err.message} (code ${err.code})` : String(err);
      console.error("[fb connect-token] token ใช้ไม่ได้:", reason);
      res.status(400).json({
        error: "invalid_token",
        message: err instanceof MetaApiError ? err.message : undefined,
      });
      return;
    }

    // 4) เก็บ (เข้ารหัส) + สร้าง session แยกของ BYO
    const customerId = await saveConnection({
      fbUserId: profile.id,
      name: profile.name,
      email: profile.email,
      accessToken: token,
      tokenType: "manual",
      expiresAt: expiresAt && expiresAt > Date.now() ? expiresAt : undefined,
    });
    const sid = await createSession(customerId, SESSION_TTL_MS);
    res.cookie(SID_TOKEN_COOKIE, sid, cookieOptions(SESSION_TTL_MS));
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof MetaApiError) {
      console.error("[fb connect-token] error:", err.message, "code", err.code);
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/** GET /api/facebook/session — meta ของการเชื่อมต่อปัจจุบัน (ชนิด token + วันหมดอายุ) */
export function getConnectionMeta(_req: Request, res: Response): void {
  const session = res.locals.session as SessionContext;
  res.json({
    tokenType: session.tokenType,
    expiresAt: session.tokenExpiresAt,
  });
}

/**
 * Middleware: ต้องมี session ที่ valid ถึงจะผ่าน
 * แนบ session context ไว้ที่ res.locals.session ให้ controller ถัดไปใช้
 */
export async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await getSessionContext(req.cookies?.[sidCookieName(req)]);
    if (!session) {
      res.status(401).json({ error: "not_authenticated" });
      return;
    }
    res.locals.session = session;
    next();
  } catch (err) {
    next(err);
  }
}

/** GET /api/facebook/profile */
export async function getProfile(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    res.json(await meta.getProfile(session.userAccessToken));
  } catch (err) {
    next(err);
  }
}

/** GET /api/facebook/pages */
export async function getPages(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    res.json(await meta.getPages(session.userAccessToken));
  } catch (err) {
    next(err);
  }
}

/** GET /api/facebook/businesses — business portfolios (ต้องมี business_management) */
export async function getBusinesses(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    res.json(await meta.getBusinesses(session.userAccessToken));
  } catch (err) {
    next(err);
  }
}

/** GET /api/facebook/businesses/:businessId/users — สมาชิกใน portfolio + บทบาท */
export async function getBusinessUsers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    const { businessId } = req.params;
    if (typeof businessId !== "string" || businessId === "") {
      res.status(400).json({ error: "missing_business_id" });
      return;
    }

    // ตรวจสอบว่า business นี้เป็นของ user จริง (กัน query portfolio คนอื่น)
    const businesses = await meta.getBusinesses(session.userAccessToken);
    if (!businesses.some((b) => b.id === businessId)) {
      res.status(404).json({ error: "business_not_found_or_no_access" });
      return;
    }

    res.json(await meta.getBusinessUsers(businessId, session.userAccessToken));
  } catch (err) {
    next(err);
  }
}

/** GET /api/facebook/adaccounts — บัญชีโฆษณาที่ user เข้าถึงได้ (Marketing API) */
export async function getAdAccounts(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    res.json(await meta.getAdAccounts(session.userAccessToken));
  } catch (err) {
    next(err);
  }
}

/** GET /api/facebook/adaccounts/:accountId/insights?datePreset= | ?since&until — KPI + กราฟ */
export async function getAdAccountInsights(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    const { accountId } = req.params;
    if (typeof accountId !== "string" || accountId === "") {
      res.status(400).json({ error: "missing_account_id" });
      return;
    }

    const accounts = await meta.getAdAccounts(session.userAccessToken);
    if (!accounts.some((a) => a.id === accountId)) {
      res.status(404).json({ error: "adaccount_not_found_or_no_access" });
      return;
    }

    const date = meta.resolveDateSpec(
      req.query.datePreset,
      req.query.since,
      req.query.until,
    );
    res.json(
      await meta.getAdAccountInsights(accountId, session.userAccessToken, date),
    );
  } catch (err) {
    next(err);
  }
}

/** GET /api/facebook/campaigns/:campaignId/ads — ชิ้นงานโฆษณาในแคมเปญ */
export async function getCampaignAds(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    const { campaignId } = req.params;
    if (typeof campaignId !== "string" || campaignId === "") {
      res.status(400).json({ error: "missing_campaign_id" });
      return;
    }
    const date = meta.resolveDateSpec(
      req.query.datePreset,
      req.query.since,
      req.query.until,
    );
    res.json(
      await meta.getCampaignAds(campaignId, session.userAccessToken, date),
    );
  } catch (err) {
    next(err);
  }
}

/** GET /api/facebook/adaccounts/:accountId/geo — insights รายจังหวัด (heatmap) */
export async function getGeo(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    const { accountId } = req.params;
    if (typeof accountId !== "string" || accountId === "") {
      res.status(400).json({ error: "missing_account_id" });
      return;
    }
    const accounts = await meta.getAdAccounts(session.userAccessToken);
    if (!accounts.some((a) => a.id === accountId)) {
      res.status(404).json({ error: "adaccount_not_found_or_no_access" });
      return;
    }
    const date = meta.resolveDateSpec(
      req.query.datePreset,
      req.query.since,
      req.query.until,
    );
    res.json(await meta.getAdAccountGeo(accountId, session.userAccessToken, date));
  } catch (err) {
    next(err);
  }
}

/** GET /api/facebook/adaccounts/:accountId/campaigns — campaigns + insights */
export async function getCampaigns(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    const { accountId } = req.params;
    if (typeof accountId !== "string" || accountId === "") {
      res.status(400).json({ error: "missing_account_id" });
      return;
    }

    // ตรวจสอบว่า account นี้เป็นของ user จริง (กัน query บัญชีคนอื่น)
    const accounts = await meta.getAdAccounts(session.userAccessToken);
    const owned = accounts.some((a) => a.id === accountId);
    if (!owned) {
      res.status(404).json({ error: "adaccount_not_found_or_no_access" });
      return;
    }

    const date = meta.resolveDateSpec(
      req.query.datePreset,
      req.query.since,
      req.query.until,
    );
    res.json(await meta.getCampaigns(accountId, session.userAccessToken, date));
  } catch (err) {
    next(err);
  }
}

/** GET /api/facebook/pages/:pageId/posts */
export async function getPagePosts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    const { pageId } = req.params;

    // ต้องใช้ Page access token — หาเฉพาะ Page ที่ user มีสิทธิ์จริง
    const pages = await meta.getPages(session.userAccessToken);
    const page = pages.find((p) => p.id === pageId);
    if (!page) {
      res.status(404).json({ error: "page_not_found_or_no_access" });
      return;
    }

    res.json(await meta.getPagePosts(page.id, page.access_token));
  } catch (err) {
    next(err);
  }
}

/** redirect กลับ React หน้า /auth/callback พร้อมผลลัพธ์ (ไม่มี token ใน URL) */
function redirectToFrontend(
  res: Response,
  result: { ok: true } | { ok: false; reason: string },
): void {
  const params = new URLSearchParams(
    result.ok ? { connected: "1" } : { error: result.reason },
  );
  res.redirect(`${env.server.frontendOrigin}/auth/callback?${params.toString()}`);
}
