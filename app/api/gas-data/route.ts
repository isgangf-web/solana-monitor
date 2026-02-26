import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    console.log('API 被调用了');
    // 从 URL searchParams 中获取 address 和 month
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    const month = searchParams.get('month');

    // 验证参数
    if (!address || !month) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: address and month' },
        { status: 400 }
      );
    }

    // 使用 Prisma 查询数据库
    const gasData = await prisma.gasCache.findMany({
      where: {
        address,
        dateStr: {
          startsWith: month
        }
      }
    });

    // 转换为以 dateStr 为 key 的字典对象
    const result: Record<string, { tx_count: number; fee_usdt: string; fee_rmb: string }> = {};
    gasData.forEach((item: { dateStr: string; txCount: number; feeUsdt: string; feeRmb: string }) => {
      result[item.dateStr] = {
        tx_count: item.txCount,
        fee_usdt: item.feeUsdt,
        fee_rmb: item.feeRmb
      };
    });

    // 返回 JSON 格式
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('数据库查询报错：', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('API 被调用了');
    // 从 request body 中解析出数据
    const { address, date, txCount, feeUsdt, feeRmb } = await request.json();

    // 验证参数
    if (!address || !date || txCount === undefined || !feeUsdt || !feeRmb) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // 使用 Prisma 的 upsert 方法保存数据
    await prisma.gasCache.upsert({
      where: {
        address_dateStr: {
          address,
          dateStr: date
        }
      },
      update: {
        txCount,
        feeUsdt,
        feeRmb,
        updatedAt: new Date()
      },
      create: {
        address,
        dateStr: date,
        txCount,
        feeUsdt,
        feeRmb
      }
    });

    // 返回 JSON 格式
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('数据库查询报错：', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}