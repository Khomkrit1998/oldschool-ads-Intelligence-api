import axios from "axios";

import type { GraphApiError } from "../types/facebook.type.js";

/**
 * Error ที่ normalize แล้วจาก Graph API
 * controller เอา .status ไปตอบกลับ React และ .code ไปแยกเคส (เช่น token หมดอายุ)
 */
export class MetaApiError extends Error {
  /** HTTP status ที่จะส่งกลับให้ React */
  readonly status: number;
  /** error.code ของ Graph API (เช่น 190 = token หมดอายุ/ใช้ไม่ได้) */
  readonly code?: number;
  readonly subcode?: number;
  readonly fbtraceId?: string;

  constructor(args: {
    message: string;
    status: number;
    code?: number;
    subcode?: number;
    fbtraceId?: string;
  }) {
    super(args.message);
    this.name = "MetaApiError";
    this.status = args.status;
    this.code = args.code;
    this.subcode = args.subcode;
    this.fbtraceId = args.fbtraceId;
  }

  /** token expired / invalid (ต้อง login ใหม่) */
  get isTokenError(): boolean {
    return this.code === 190 || this.status === 401;
  }

  /** ไม่มี permission ที่จำเป็น */
  get isPermissionError(): boolean {
    return this.code === 10 || this.code === 200 || this.status === 403;
  }
}

/** แปลง error ดิบ (มักจาก axios) -> MetaApiError */
export function toMetaApiError(err: unknown): MetaApiError {
  if (axios.isAxiosError<GraphApiError>(err)) {
    const status = err.response?.status ?? 502;
    const apiError = err.response?.data?.error;

    if (apiError) {
      return new MetaApiError({
        message: apiError.message,
        status: mapGraphCodeToStatus(apiError.code, status),
        code: apiError.code,
        subcode: apiError.error_subcode,
        fbtraceId: apiError.fbtrace_id,
      });
    }

    return new MetaApiError({
      message: err.message || "Meta API request failed",
      status,
    });
  }

  return new MetaApiError({
    message: err instanceof Error ? err.message : "Unknown Meta API error",
    status: 500,
  });
}

/** map error code ของ Graph API ให้เป็น HTTP status ที่สื่อความหมายกับ frontend */
function mapGraphCodeToStatus(code: number, fallback: number): number {
  switch (code) {
    case 190: // invalid/expired access token
      return 401;
    case 10: // permission denied
    case 200: // missing permission
      return 403;
    case 4: // app-level rate limit
    case 17: // user-level rate limit
    case 32: // page-level rate limit
      return 429;
    default:
      return fallback;
  }
}
