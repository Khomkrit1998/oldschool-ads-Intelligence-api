import { Router } from "express";

import * as access from "../controllers/access.controller.js";
import * as fb from "../controllers/facebook.controller.js";
import * as share from "../controllers/share.controller.js";

/** Gate ส่วนหน้า (ตรวจ access code) — mount ที่ /api/access, ไม่ต้องมี session */
export const accessRouter = Router();
accessRouter.get("/status", access.status);
accessRouter.post("/verify", access.verify);
accessRouter.post("/lock", access.lock);

/** OAuth flow (เปิดผ่าน browser โดยตรง) — mount ที่ /auth/facebook */
export const authRouter = Router();
authRouter.get("/login", fb.login);
authRouter.get("/callback", fb.callback);
authRouter.post("/logout", fb.logout);
// เชื่อมด้วย access token ที่ผู้ใช้วางเอง (หลัง gate, ยังไม่ต้องมี session — เป็นเส้นที่สร้าง session)
authRouter.post("/token", access.requireGate, fb.connectWithToken);

/** Data API (React เรียกผ่าน axios) — mount ที่ /api/facebook, ต้องผ่าน gate + มี session */
export const apiRouter = Router();
apiRouter.use(access.requireGate);
apiRouter.use(fb.requireSession);
apiRouter.get("/profile", fb.getProfile);
apiRouter.get("/session", fb.getConnectionMeta);
apiRouter.get("/businesses", fb.getBusinesses);
apiRouter.get("/businesses/:businessId/users", fb.getBusinessUsers);
apiRouter.get("/adaccounts", fb.getAdAccounts);
apiRouter.get("/adaccounts/:accountId/insights", fb.getAdAccountInsights);
apiRouter.get("/adaccounts/:accountId/geo", fb.getGeo);
apiRouter.get("/adaccounts/:accountId/campaigns", fb.getCampaigns);
apiRouter.get("/campaigns/:campaignId/ads", fb.getCampaignAds);
apiRouter.get("/pages", fb.getPages);
apiRouter.get("/pages/:pageId/posts", fb.getPagePosts);

// share links (agency สร้าง/ดู/revoke) — ต้องมี session
apiRouter.post("/share-links", share.create);
apiRouter.get("/share-links", share.list);
apiRouter.delete("/share-links/:id", share.revoke);

/**
 * Public shared dashboard — mount ที่ /api/shared
 * ไม่ต้องมี session: ใช้ share token (จากลิงก์) เป็นตัวยืนยันแทน
 */
export const sharedRouter = Router();
sharedRouter.get("/:token", share.sharedContext);
sharedRouter.get("/:token/insights", share.sharedInsights);
sharedRouter.get("/:token/campaigns", share.sharedCampaigns);
sharedRouter.get("/:token/campaigns/:campaignId/ads", share.sharedCampaignAds);
