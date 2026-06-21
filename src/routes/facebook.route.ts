import { Router } from "express";

import * as fb from "../controllers/facebook.controller.js";
import * as share from "../controllers/share.controller.js";

/** OAuth flow (เปิดผ่าน browser โดยตรง) — mount ที่ /auth/facebook */
export const authRouter = Router();
authRouter.get("/login", fb.login);
authRouter.get("/callback", fb.callback);
authRouter.post("/logout", fb.logout);

/** Data API (React เรียกผ่าน axios) — mount ที่ /api/facebook, ต้องมี session */
export const apiRouter = Router();
apiRouter.use(fb.requireSession);
apiRouter.get("/profile", fb.getProfile);
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
