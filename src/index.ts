import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";

import { env } from "./config/env.js";
import { MetaApiError } from "./services/meta-error.js";
import {
  accessRouter,
  apiRouter,
  authRouter,
  sharedRouter,
} from "./routes/facebook.route.js";

const app = express();

app.use(express.json());
app.use(cookieParser(env.server.cookieSecret));

// React อยู่คนละ origin → ต้องเปิด CORS + credentials เพื่อให้ส่ง cookie ได้
app.use(
  cors({
    origin: env.server.frontendOrigin,
    credentials: true,
  }),
);

app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));

app.use("/api/access", accessRouter);
app.use("/auth/facebook", authRouter);
app.use("/api/facebook", apiRouter);
app.use("/api/shared", sharedRouter);

// error handler รวม — แปลง MetaApiError เป็น HTTP response ที่เหมาะสม
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof MetaApiError) {
    res.status(err.status).json({
      error: err.isTokenError
        ? "token_expired"
        : err.isPermissionError
          ? "missing_permission"
          : "meta_api_error",
      message: err.message,
      code: err.code,
    });
    return;
  }
  console.error("[unhandled]", err);
  res.status(500).json({ error: "internal_error" });
};
app.use(errorHandler);

app.listen(env.server.port, () => {
  console.log(`✅ Backend running on http://localhost:${env.server.port}`);
});
