import { PrismaClient } from './app/generated/prisma/client.js';

// @ts-ignore - 忽略类型错误，Prisma 7.4.1 要求提供 options 参数，但运行时不需要
const prisma = new PrismaClient();

async function testPrisma() {
  console.log('Testing Prisma connection...');
  
  try {
    // 尝试插入一条测试数据
    const testData = await prisma.gasCache.create({
      data: {
        address: 'test_address_123',
        dateStr: '2024-01-01',
        txCount: 10,
        feeUsdt: '1.5',
        feeRmb: '10.5',
      },
    });
    
    console.log('Successfully inserted test data:', testData);
    
    // 尝试读取数据
    const allData = await prisma.gasCache.findMany();
    console.log('All data in GasCache table:', allData);
    
    // 删除测试数据
    await prisma.gasCache.delete({
      where: {
        address_dateStr: {
          address: 'test_address_123',
          dateStr: '2024-01-01',
        },
      },
    });
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Error testing Prisma:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testPrisma();