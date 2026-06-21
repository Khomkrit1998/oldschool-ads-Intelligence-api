import type { NextFunction, Request, Response } from "express";

import * as meta from "../services/meta.service.js";
import {
  createShareLink,
  listShareLinks,
  resolveShareLink,
  revokeShareLink,
} from "../services/share.store.js";
import type { SessionContext } from "../services/token.store.js";

function strParam(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/* ── agency (auth required) ─────────────────────────────── */

/** POST /api/facebook/share-links  body: { accountId, label?, expiresInDays? } */
export async function create(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    const accountId = strParam(req.body?.accountId);
    if (!accountId) {
      res.status(400).json({ error: "missing_account_id" });
      return;
    }

    // ต้องเป็นบัญชีที่ agency เข้าถึงได้จริง
    const accounts = await meta.getAdAccounts(session.userAccessToken);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      res.status(404).json({ error: "adaccount_not_found_or_no_access" });
      return;
    }

    const days = Number(req.body?.expiresInDays);
    const expiresAt =
      Number.isFinite(days) && days > 0
        ? new Date(Date.now() + days * 24 * 60 * 60 * 1000)
        : undefined;

    const link = await createShareLink({
      customerId: session.customerId,
      adAccountId: accountId,
      accountName: account.name,
      label: strParam(req.body?.label) ?? undefined,
      expiresAt,
    });
    res.status(201).json(link);
  } catch (err) {
    next(err);
  }
}

/** GET /api/facebook/share-links */
export async function list(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    res.json(await listShareLinks(session.customerId));
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/facebook/share-links/:id */
export async function revoke(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = res.locals.session as SessionContext;
    const id = strParam(req.params.id);
    if (!id) {
      res.status(400).json({ error: "missing_id" });
      return;
    }
    const ok = await revokeShareLink(id, session.customerId);
    if (!ok) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/* ── public (share token, no session) ───────────────────── */

/** resolve token + ยืนยันว่าบัญชียังเข้าถึงได้ คืน { token, account } หรือ null */
async function resolveOr404(
  token: string | null,
  res: Response,
): Promise<{ userAccessToken: string; accountId: string; accountName: string | null } | null> {
  if (!token) {
    res.status(400).json({ error: "missing_token" });
    return null;
  }
  const link = await resolveShareLink(token);
  if (!link) {
    res.status(404).json({ error: "invalid_or_expired_link" });
    return null;
  }
  return {
    userAccessToken: link.userAccessToken,
    accountId: link.adAccountId,
    accountName: link.accountName,
  };
}

/** GET /api/shared/:token — context พื้นฐาน (ชื่อบัญชี, สกุลเงิน, สถานะ) */
export async function sharedContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const link = await resolveOr404(strParam(req.params.token), res);
    if (!link) return;

    const accounts = await meta.getAdAccounts(link.userAccessToken);
    const account = accounts.find((a) => a.id === link.accountId);
    if (!account) {
      res.status(410).json({ error: "account_no_longer_accessible" });
      return;
    }
    res.json({
      accountId: account.id,
      name: account.name,
      currency: account.currency,
      account_status: account.account_status,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/shared/:token/insights?datePreset= */
export async function sharedInsights(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const link = await resolveOr404(strParam(req.params.token), res);
    if (!link) return;
    res.json(
      await meta.getAdAccountInsights(
        link.accountId,
        link.userAccessToken,
        meta.resolveDateSpec(req.query.datePreset, req.query.since, req.query.until),
      ),
    );
  } catch (err) {
    next(err);
  }
}

/** GET /api/shared/:token/campaigns/:campaignId/ads — ชิ้นงานในแคมเปญ (ตรวจ scope) */
export async function sharedCampaignAds(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const link = await resolveOr404(strParam(req.params.token), res);
    if (!link) return;
    const campaignId = strParam(req.params.campaignId);
    if (!campaignId) {
      res.status(400).json({ error: "missing_campaign_id" });
      return;
    }
    // ความปลอดภัย: campaign ต้องอยู่ในบัญชีของลิงก์นี้เท่านั้น
    const campaigns = await meta.getCampaigns(link.accountId, link.userAccessToken, {});
    if (!campaigns.some((c) => c.id === campaignId)) {
      res.status(404).json({ error: "campaign_not_in_account" });
      return;
    }
    res.json(
      await meta.getCampaignAds(
        campaignId,
        link.userAccessToken,
        meta.resolveDateSpec(req.query.datePreset, req.query.since, req.query.until),
      ),
    );
  } catch (err) {
    next(err);
  }
}

/** GET /api/shared/:token/campaigns?datePreset= */
export async function sharedCampaigns(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const link = await resolveOr404(strParam(req.params.token), res);
    if (!link) return;
    res.json(
      await meta.getCampaigns(
        link.accountId,
        link.userAccessToken,
        meta.resolveDateSpec(req.query.datePreset, req.query.since, req.query.until),
      ),
    );
  } catch (err) {
    next(err);
  }
}
