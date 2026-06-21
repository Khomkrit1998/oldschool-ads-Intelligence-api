import "dotenv/config";

/**
 * อ่าน + validate environment variables ทั้งหมดที่ตอนนี้ครั้งเดียว
 * ถ้าตัวไหนขาดให้ throw ตั้งแต่ boot จะได้ไม่ค่อยพังกลางทาง runtime
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`[env] Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export const env = {
  meta: {
    appId: required("META_APP_ID"),
    appSecret: required("META_APP_SECRET"),
    graphVersion: optional("META_GRAPH_VERSION", "v19.0"),
    redirectUri: required("META_REDIRECT_URI"),
    scopes: optional(
      "META_SCOPES",
      "public_profile,email,pages_show_list,pages_read_engagement",
    ),
    /**
     * config_id ของ Facebook Login for Business (จาก Business Settings)
     * ถ้าตั้งค่า -> ใช้ flow FLB (ส่ง config_id แทน scope, ได้ System User token)
     * ถ้าเว้นว่าง -> fallback เป็น standard user OAuth (ใช้ scopes ด้านบน)
     */
    loginConfigId: optional("META_LOGIN_CONFIG_ID", ""),
  },
  db: {
    url: optional("DATABASE_URL", "file:./dev.db"),
  },
  server: {
    port: Number(optional("PORT", "4000")),
    frontendOrigin: optional("FRONTEND_ORIGIN", "http://localhost:5173"),
    cookieSecret: required("COOKIE_SECRET"),
    isProduction: optional("NODE_ENV", "development") === "production",
  },
} as const;

/** true เมื่อใช้ Facebook Login for Business (มี config_id) */
export const usesBusinessLogin = env.meta.loginConfigId !== "";

/** baseURL ของ Graph API เช่น https://graph.facebook.com/v19.0 */
export const GRAPH_BASE_URL = `https://graph.facebook.com/${env.meta.graphVersion}`;

/** endpoint OAuth dialog (อยู่บน www.facebook.com ไม่ใช่ graph.) */
export const OAUTH_DIALOG_URL = `https://www.facebook.com/${env.meta.graphVersion}/dialog/oauth`;
