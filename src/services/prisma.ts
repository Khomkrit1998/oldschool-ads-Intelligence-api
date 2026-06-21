import { PrismaClient } from "@prisma/client";

/**
 * Prisma client เดี่ยว ใช้ร่วมทั้งแอป
 * เก็บไว้บน globalThis เพื่อไม่ให้ tsx watch สร้าง connection ซ้ำตอน hot-reload
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (!env_isProduction()) {
  globalForPrisma.prisma = prisma;
}

function env_isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
