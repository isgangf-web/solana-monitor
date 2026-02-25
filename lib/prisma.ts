import { PrismaClient } from '../app/generated/prisma/client';

// 为 PrismaClient 添加全局类型声明
declare global {
  var prisma: PrismaClient | undefined;
}

// 创建单例的 PrismaClient 实例
const prisma = global.prisma || new PrismaClient();

// 在非生产环境中，将实例存储在全局变量中
if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export default prisma;