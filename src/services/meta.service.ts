import axios, { type AxiosInstance } from "axios";

import {
  env,
  GRAPH_BASE_URL,
  OAUTH_DIALOG_URL,
  usesBusinessLogin,
} from "../config/env.js";
import type {
  ActionStat,
  AdAccountInsights,
  FacebookAd,
  FacebookAdAccount,
  FacebookBusiness,
  FacebookBusinessUser,
  FacebookCampaign,
  FacebookInsights,
  RegionInsight,
  FacebookPage,
  FacebookPaged,
  FacebookPost,
  FacebookProfile,
  MetaTokenResponse,
} from "../types/facebook.type.js";
import { MetaApiError, toMetaApiError } from "./meta-error.js";

/**
 * Service กลางสำหรับเรียก Meta Graph API ทั้งหมด — reusable, ไม่รู้จัก Express
 * controller จะ import ฟังก์ชันเหล่านี้ไปใช้ต่อ
 */

const graph: AxiosInstance = axios.create({
  baseURL: GRAPH_BASE_URL,
  timeout: 15_000,
});

/** ห่อ axios call ให้ทุก error กลายเป็น MetaApiError ที่ controller จัดการง่าย */
async function graphGet<T>(
  url: string,
  params: Record<string, string | number>,
): Promise<T> {
  try {
    const { data } = await graph.get<T>(url, { params });
    return data;
  } catch (err) {
    throw toMetaApiError(err);
  }
}

/**
 * cache สั้น ๆ สำหรับ GET ที่อ่านอย่างเดียว — ลดจำนวน call ไป Meta (กัน rate limit)
 * key = url + params (รวม access_token จึงแยกตาม user); TTL 60 วิ
 * ไม่ใช้กับ oauth/token (ต้องสดเสมอ)
 */
interface CacheEntry {
  at: number;
  data: unknown;
}
const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 300;

async function graphGetCached<T>(
  url: string,
  params: Record<string, string | number>,
): Promise<T> {
  const key =
    url +
    "?" +
    Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");

  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.data as T;
  }

  const data = await graphGet<T>(url, params);

  // กันโตไม่จำกัด — ลบ entry เก่าสุดเมื่อเต็ม
  if (responseCache.size >= CACHE_MAX) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(key, { at: Date.now(), data });
  return data;
}

/** ล้าง cache ของ user (เรียกหลัง logout หรือเมื่ออยากบังคับ refresh) */
export function clearGraphCache(): void {
  responseCache.clear();
}

/* ── date range (preset หรือ custom since/until) ───────── */

export type DateSpec = { datePreset?: string; since?: string; until?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_PRESETS = new Set([
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
  "last_90d",
]);

/**
 * แปลงค่าจาก query -> DateSpec ที่ปลอดภัย
 * ถ้ามี since+until (YYYY-MM-DD ทั้งคู่) -> ใช้ช่วงกำหนดเอง, ไม่งั้นใช้ preset
 */
export function resolveDateSpec(
  datePreset: unknown,
  since: unknown,
  until: unknown,
): DateSpec {
  if (
    typeof since === "string" &&
    typeof until === "string" &&
    DATE_RE.test(since) &&
    DATE_RE.test(until)
  ) {
    return { since, until };
  }
  return {
    datePreset:
      typeof datePreset === "string" && ALLOWED_PRESETS.has(datePreset)
        ? datePreset
        : "last_30d",
  };
}

/** argument ของ insights ใน field-expansion เช่น date_preset(last_30d) หรือ time_range({...}) */
function insightsTimeArg(d: DateSpec): string {
  if (d.since && d.until) {
    return `time_range({'since':'${d.since}','until':'${d.until}'})`;
  }
  return `date_preset(${d.datePreset ?? "last_30d"})`;
}

/** params ของ insights แบบเรียกตรง (date_preset หรือ time_range) */
function insightsTimeParams(d: DateSpec): Record<string, string> {
  if (d.since && d.until) {
    return { time_range: JSON.stringify({ since: d.since, until: d.until }) };
  }
  return { date_preset: d.datePreset ?? "last_30d" };
}

/**
 * (1) สร้าง URL ของ Facebook OAuth dialog
 * state = ค่า random ที่เราเก็บไว้ฝั่ง server เพื่อกัน CSRF
 *
 * - Facebook Login for Business (มี config_id): ส่ง `config_id` แทน `scope`
 *   permission/asset ถูกกำหนดไว้ใน configuration ฝั่ง Business Settings แล้ว
 *   และจะได้ System User token กลับมา
 * - Standard user OAuth (ไม่มี config_id): ส่ง `scope` แบบเดิม
 */
export function buildLoginUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.meta.appId,
    redirect_uri: env.meta.redirectUri,
    state,
    response_type: "code",
  });

  if (usesBusinessLogin) {
    params.set("config_id", env.meta.loginConfigId);
    // ให้ response เป็น authorization code (มาตรฐานของ FLB ฝั่ง server-side)
    params.set("override_default_response_type", "true");
  } else {
    params.set("scope", env.meta.scopes);
  }

  return `${OAUTH_DIALOG_URL}?${params.toString()}`;
}

/** (2) แลก authorization code -> short-lived user access token */
export async function exchangeCodeForToken(
  code: string,
): Promise<MetaTokenResponse> {
  return graphGet<MetaTokenResponse>("/oauth/access_token", {
    client_id: env.meta.appId,
    client_secret: env.meta.appSecret,
    redirect_uri: env.meta.redirectUri,
    code,
  });
}

/** (3) แลก short-lived -> long-lived user access token (~60 วัน) */
export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<MetaTokenResponse> {
  return graphGet<MetaTokenResponse>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: env.meta.appId,
    client_secret: env.meta.appSecret,
    fb_exchange_token: shortLivedToken,
  });
}

/** (4) ดึง profile ของ user ที่ login: id, name, email, picture */
export async function getProfile(
  userAccessToken: string,
): Promise<FacebookProfile> {
  return graphGetCached<FacebookProfile>("/me", {
    fields: "id,name,email,picture",
    access_token: userAccessToken,
  });
}

/** (5) ดึง Pages ที่ user มีสิทธิ์ผ่าน /me/accounts */
export async function getPages(
  userAccessToken: string,
): Promise<FacebookPage[]> {
  const res = await graphGetCached<FacebookPaged<FacebookPage>>("/me/accounts", {
    fields: "id,name,access_token,category,tasks",
    access_token: userAccessToken,
  });
  return res.data;
}

/**
 * (6) ดึง posts ของ Page
 * NOTE: ต้องใช้ "Page access token" (จาก /me/accounts) ไม่ใช่ user token
 */
export async function getPagePosts(
  pageId: string,
  pageAccessToken: string,
): Promise<FacebookPost[]> {
  const res = await graphGetCached<FacebookPaged<FacebookPost>>(`/${pageId}/posts`, {
    fields: "id,message,story,created_time,permalink_url,full_picture",
    limit: 25,
    access_token: pageAccessToken,
  });
  return res.data;
}

/**
 * ดึง business portfolios ที่ user เป็นสมาชิก ผ่าน /me/businesses
 * NOTE: ต้องใช้ scope `business_management`
 */
export async function getBusinesses(
  userAccessToken: string,
): Promise<FacebookBusiness[]> {
  const res = await graphGetCached<FacebookPaged<FacebookBusiness>>("/me/businesses", {
    fields: "id,name,verification_status,created_time,primary_page{id,name}",
    limit: 100,
    access_token: userAccessToken,
  });
  return res.data;
}

/**
 * ดึงสมาชิก (users) ของ business portfolio + บทบาท ผ่าน /{business-id}/business_users
 * NOTE: ต้องใช้ scope `business_management` และผู้เรียกต้องเป็น admin ของ business
 */
export async function getBusinessUsers(
  businessId: string,
  userAccessToken: string,
): Promise<FacebookBusinessUser[]> {
  const res = await graphGetCached<FacebookPaged<FacebookBusinessUser>>(
    `/${businessId}/business_users`,
    {
      fields: "id,name,email,role,pending_email",
      limit: 100,
      access_token: userAccessToken,
    },
  );
  return res.data;
}

/**
 * (7) ดึง ad accounts ที่ user มีสิทธิ์ผ่าน /me/adaccounts (Marketing API)
 * NOTE: ต้องใช้ scope `ads_read`
 */
export async function getAdAccounts(
  userAccessToken: string,
): Promise<FacebookAdAccount[]> {
  const res = await graphGetCached<FacebookPaged<FacebookAdAccount>>(
    "/me/adaccounts",
    {
      // NOTE: ไม่ขอ field `business` เพราะต้องใช้ permission `business_management` (error #100)
      fields:
        "id,account_id,name,account_status,currency,timezone_name,amount_spent",
      limit: 100,
      access_token: userAccessToken,
    },
  );
  return res.data;
}

/**
 * (8) ดึง campaigns ของ ad account + insights (spend/impressions/clicks/ctr/reach)
 * ใช้ field-expansion ดึง insights ในคำขอเดียว (date_preset = ช่วงเวลา)
 * NOTE: ต้องใช้ scope `ads_read`; adAccountId รูปแบบ "act_123456789"
 */
export async function getCampaigns(
  adAccountId: string,
  userAccessToken: string,
  date: DateSpec = {},
): Promise<FacebookCampaign[]> {
  const res = await graphGetCached<FacebookPaged<FacebookCampaign>>(
    `/${adAccountId}/campaigns`,
    {
      fields:
        "id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time," +
        `insights.${insightsTimeArg(date)}` +
        "{spend,impressions,clicks,ctr,reach,cpc,cpm,actions,action_values,purchase_roas}",
      limit: 100,
      access_token: userAccessToken,
    },
  );
  return res.data;
}

/**
 * (9) insights ระดับบัญชี — ยอดรวม + ซีรีส์รายวัน (สำหรับ KPI + กราฟแนวโน้ม)
 * - call (ก) แบบ aggregate: ได้ reach/cpm/cpc ที่ "รวมเองไม่ได้" + ผลลัพธ์ (ขาย/ทัก) ตรงจาก Meta
 * - call (ข) time_increment=1: ซีรีส์รายวันสำหรับกราฟ + sparkline
 * ยิงขนานกันเพื่อลด latency
 */
export async function getAdAccountInsights(
  adAccountId: string,
  userAccessToken: string,
  date: DateSpec = {},
): Promise<AdAccountInsights> {
  const [aggRes, dailyRes] = await Promise.all([
    graphGetCached<FacebookPaged<FacebookInsights>>(`/${adAccountId}/insights`, {
      fields: "spend,impressions,clicks,ctr,reach,cpc,cpm,actions,action_values",
      access_token: userAccessToken,
      ...insightsTimeParams(date),
    }),
    graphGetCached<FacebookPaged<FacebookInsights>>(`/${adAccountId}/insights`, {
      fields: "spend,clicks",
      time_increment: 1,
      access_token: userAccessToken,
      ...insightsTimeParams(date),
    }),
  ]);

  const agg = aggRes.data[0];
  // "ทัก" = แชทที่เริ่มจากโฆษณา · "ยอดขาย" = จำนวน + มูลค่า purchase
  const chats = pickAction(agg?.actions, MESSAGING_TYPES);
  const sales = pickAction(agg?.actions, PURCHASE_TYPES);
  const salesValue = pickAction(agg?.action_values, PURCHASE_TYPES);

  const totals: FacebookInsights | null = agg
    ? {
        spend: agg.spend,
        impressions: agg.impressions,
        clicks: agg.clicks,
        ctr: agg.ctr,
        reach: agg.reach,
        cpc: agg.cpc,
        cpm: agg.cpm,
        actions: [
          { action_type: MESSAGING_RESULT_TYPE, value: String(chats) },
          { action_type: PURCHASE_RESULT_TYPE, value: String(sales) },
        ],
        action_values: [
          { action_type: PURCHASE_RESULT_TYPE, value: String(salesValue) },
        ],
      }
    : null;

  return {
    totals,
    daily: dailyRes.data.map((d) => ({
      date: d.date_start ?? "",
      spend: Number(d.spend ?? 0),
      clicks: Number(d.clicks ?? 0),
    })),
  };
}

/** action_type มาตรฐานที่เราใช้ "คืน" ใน totals (normalize แล้ว) */
const MESSAGING_RESULT_TYPE = "onsite_conversion.messaging_conversation_started_7d";
const PURCHASE_RESULT_TYPE = "purchase";

/** action_type ของ "ทัก" (เริ่มบทสนทนา/ข้อความเข้า — เน้น Messenger) */
const MESSAGING_TYPES = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.total_messaging_connection",
  "messaging_conversation_started_7d",
];

/** action_type ของ "ผลลัพธ์/ยอดขาย" (เน้น purchase สำหรับ ecom) */
const PURCHASE_TYPES = [
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
];
function pickAction(arr: ActionStat[] | undefined, types: string[]): number {
  if (!arr) return 0;
  for (const t of types) {
    const hit = arr.find((a) => a.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

/**
 * ดึงชิ้นงานโฆษณา (ads) ในแคมเปญ + creative thumbnail + insights ตามช่วงเวลา
 * NOTE: Meta บังคับสิทธิ์เอง — token เข้าถึง campaign ไม่ได้จะ error
 */
export async function getCampaignAds(
  campaignId: string,
  userAccessToken: string,
  date: DateSpec = {},
): Promise<FacebookAd[]> {
  const res = await graphGetCached<FacebookPaged<FacebookAd>>(
    `/${campaignId}/ads`,
    {
      fields:
        "id,name,status,effective_status,creative{id,name,thumbnail_url}," +
        `insights.${insightsTimeArg(date)}` +
        "{spend,impressions,clicks,ctr,actions,action_values}",
      limit: 50,
      access_token: userAccessToken,
    },
  );
  return res.data;
}

/**
 * (10) insights รายจังหวัด ของบัญชี ผ่าน breakdowns=region (Geo heatmap)
 * NOTE: ต้องใช้ scope `ads_read`; region เป็นชื่อจังหวัด (อังกฤษ)
 */
export async function getAdAccountGeo(
  adAccountId: string,
  userAccessToken: string,
  date: DateSpec = {},
): Promise<RegionInsight[]> {
  const res = await graphGetCached<FacebookPaged<FacebookInsights>>(
    `/${adAccountId}/insights`,
    {
      fields: "spend,impressions,clicks,ctr,reach,actions,action_values",
      breakdowns: "region",
      level: "account",
      limit: 500,
      access_token: userAccessToken,
      ...insightsTimeParams(date),
    },
  );
  return res.data.map((r) => ({
    region: r.region ?? "Unknown",
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    ctr: Number(r.ctr ?? 0),
    reach: Number(r.reach ?? 0),
    results: pickAction(r.actions, PURCHASE_TYPES),
    sales: pickAction(r.action_values, PURCHASE_TYPES),
  }));
}

export { MetaApiError };
