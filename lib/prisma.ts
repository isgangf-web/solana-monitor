import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// 这种写法能防止 Next.js 热更新导致数据库连接爆满
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query'], // 开启后，你能在终端直接看到 SQL 语句
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;