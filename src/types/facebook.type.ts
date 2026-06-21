/**
 * Type ของ response ที่สำคัญจาก Meta Graph API
 * อ้างอิง: https://developers.facebook.com/docs/graph-api/reference
 */

/** response จาก oauth/access_token (แลก code -> token, หรือ short -> long lived) */
export interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  /** หน่วยเป็นวินาที; long-lived ~ 5,184,000 (60 วัน). short-lived จะมีหรือไม่มีก็ได้ */
  expires_in?: number;
}

/** GET /me */
export interface FacebookProfile {
  id: string;
  name: string;
  /** จะมีก็ต่อเมื่อ user อนุญาต scope `email` เท่านั้น */
  email?: string;
  picture?: {
    data: {
      url: string;
      width: number;
      height: number;
      is_silhouette: boolean;
    };
  };
}

/** 1 รายการใน GET /me/accounts */
export interface FacebookPage {
  id: string;
  name: string;
  /** Page access token — ใช้สำหรับเรียกข้อมูลของ Page นั้น ๆ */
  access_token: string;
  category: string;
  tasks?: string[];
}

/**
 * Business portfolio (เดิมชื่อ Business Manager) จาก GET /me/businesses
 * ต้องใช้ scope `business_management`
 */
export interface FacebookBusiness {
  id: string;
  name: string;
  /** verified / not_verified / pending_need_more_info / ... */
  verification_status?: string;
  created_time?: string;
  primary_page?: { id: string; name: string };
}

/**
 * สมาชิกใน business portfolio จาก GET /{business-id}/business_users
 * คือ "คนที่มีสิทธิ์เข้าถึง portfolio นี้" + บทบาท
 */
export interface FacebookBusinessUser {
  id: string;
  name?: string;
  email?: string;
  /** ADMIN | EMPLOYEE | FINANCE_EDITOR | FINANCE_ANALYST | ... */
  role?: string;
  /** อีเมลที่เชิญไว้แต่ยังไม่ตอบรับ */
  pending_email?: string;
}

/**
 * 1 รายการใน GET /me/adaccounts (Marketing API)
 * ต้องใช้ scope `ads_read`
 */
export interface FacebookAdAccount {
  /** รูปแบบ "act_123456789" — ใช้เป็น prefix เวลาเรียก insights ต่อ */
  id: string;
  /** เลขล้วน "123456789" */
  account_id: string;
  name: string;
  /** 1=ACTIVE, 2=DISABLED, 3=UNSETTLED, 7=PENDING_RISK_REVIEW, 9=IN_GRACE_PERIOD, 101=CLOSED ... */
  account_status: number;
  currency: string;
  timezone_name?: string;
  /** ยอดใช้จ่ายสะสม (Graph คืนมาเป็น string หน่วยเล็กสุดของสกุลเงิน เช่น สตางค์) */
  amount_spent?: string;
  business?: { id: string; name: string };
}

/** 1 รายการในฟิลด์ actions/action_values/purchase_roas (action_type + value) */
export interface ActionStat {
  action_type: string;
  value: string;
}

/** ตัวเลข insights ของ campaign (Graph คืนเป็น string) */
export interface FacebookInsights {
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  reach?: string;
  cpc?: string;
  cpm?: string;
  /** จำนวนผลลัพธ์แยกตาม action_type เช่น purchase, lead */
  actions?: ActionStat[];
  /** มูลค่าผลลัพธ์ (ยอดขาย) แยกตาม action_type */
  action_values?: ActionStat[];
  /** ROAS แยกตาม action_type */
  purchase_roas?: ActionStat[];
  /** ชื่อภูมิภาค/จังหวัด (เมื่อใช้ breakdowns=region) */
  region?: string;
  date_start?: string;
  date_stop?: string;
}

/** insights รายจังหวัด (จาก breakdowns=region) — แปลงเป็น number แล้ว */
export interface RegionInsight {
  region: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  reach: number;
  results: number;
  sales: number;
}

/** 1 จุดในกราฟรายวัน (จาก insights time_increment=1) — แปลงเป็น number แล้ว */
export interface InsightDay {
  date: string;
  spend: number;
  clicks: number;
}

/** ผล insights ระดับบัญชี: ยอดรวมช่วงเวลา + ซีรีส์รายวันสำหรับกราฟ */
export interface AdAccountInsights {
  totals: FacebookInsights | null;
  daily: InsightDay[];
}

/**
 * 1 campaign ใน GET /{ad-account-id}/campaigns (Marketing API, ต้องมี ads_read)
 * insights ถูกดึงมาแบบ field-expansion ในคำขอเดียว -> มาเป็น { data: [...] }
 */
export interface FacebookCampaign {
  id: string;
  name: string;
  objective?: string;
  /** สถานะที่ตั้งไว้: ACTIVE / PAUSED / ... */
  status: string;
  /** สถานะจริงรวมเหตุอื่น (เช่น CAMPAIGN_PAUSED, ADSET_PAUSED) */
  effective_status?: string;
  /** งบ (หน่วยเล็กสุดของสกุลเงิน เช่น สตางค์) — string */
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
  insights?: { data: FacebookInsights[] };
}

/** ชิ้นงานโฆษณา (ad) ใน GET /{campaign-id}/ads */
export interface FacebookAd {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  creative?: {
    id: string;
    name?: string;
    thumbnail_url?: string;
  };
  insights?: { data: FacebookInsights[] };
}

/** 1 โพสต์ใน GET /{page-id}/posts */
export interface FacebookPost {
  id: string;
  message?: string;
  story?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
}

/** envelope ของ list response แบบมี paging */
export interface FacebookPaged<T> {
  data: T[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
    previous?: string;
  };
}

/** error envelope มาตรฐานของ Graph API */
export interface GraphApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}
