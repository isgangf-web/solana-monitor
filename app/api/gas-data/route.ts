import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Connection, PublicKey } from '@solana/web3.js';

// Solana RPC 连接
const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=93f747fb-101a-420c-b620-fd9b7d341ca1');

// 格式化为日期字符串 YYYY-MM-DD
function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 获取 SOL 历史价格（按天）
async function getSolPriceAtDate(date: string): Promise<number> {
  try {
    // 调用 CoinGecko API 获取历史价格
    // 注意：CoinGecko API 有请求限制，实际生产环境可能需要添加缓存
    const url = `https://api.coingecko.com/api/v3/coins/solana/history?date=${date}&localization=false`;
    
    // 重试机制
    let retries = 3;
    while (retries > 0) {
      try {
        // 添加超时设置
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时
        
        const response = await fetch(url, {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          if (data.market_data && data.market_data.current_price && data.market_data.current_price.usd) {
            return data.market_data.current_price.usd;
          }
        }
      } catch (error: any) {
        console.warn('获取 SOL 价格失败，重试中...', error.message);
        // 如果是网络错误，继续重试
        if (error.name === 'AbortError') {
          console.warn('请求超时，重试中...');
        }
      }
      retries--;
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // 如果获取失败，返回默认价格
    return 85; // 默认 SOL 价格
  } catch (error) {
    console.error('获取 SOL 价格失败：', error);
    return 85; // 默认 SOL 价格
  }
}

// 处理分页拉取交易签名（支持增量同步）
async function getSignaturesForAddress(
  address: string, 
  startTime: number, 
  endTime: number, 
  lastSignature?: string
) {
  let signatures: any[] = [];
  let currentLastSignature = lastSignature;
  const limit = 1000; // 每次拉取的签名数量

  try {
    while (true) {
      // 调用 RPC 获取签名
      // 注意：这里使用 before 参数，因为签名是按时间倒序返回的
      const sigs = await connection.getSignaturesForAddress(
        new PublicKey(address),
        {
          limit,
          before: currentLastSignature,
        }
      );

      if (sigs.length === 0) break;

      // 过滤出指定时间范围内的签名
      const filteredSigs = sigs.filter(sig => {
        if (!sig.blockTime) return false;
        return sig.blockTime >= startTime && sig.blockTime <= endTime;
      });

      signatures = [...signatures, ...filteredSigs];

      // 检查是否已经获取到足够的签名或者已经到达时间范围的开始
      const oldestSig = sigs[sigs.length - 1];
      if (oldestSig.blockTime && oldestSig.blockTime < startTime) break;

      // 更新 currentLastSignature 用于下一次分页请求
      currentLastSignature = oldestSig.signature;

      // 避免 Rate Limit
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error('获取交易签名失败：', error);
    throw error;
  }

  return signatures;
}

// 分批处理交易
async function getTransactionsInBatches(signatures: string[], batchSize: number = 10) {
  const transactions = [];

  for (let i = 0; i < signatures.length; i += batchSize) {
    const batch = signatures.slice(i, i + batchSize);
    try {
      // 批量获取交易
      const batchTransactions = await Promise.all(
        batch.map(sig => 
          connection.getTransaction(sig, { 
            maxSupportedTransactionVersion: 0 
          }) 
        )
      );
      
      // 过滤掉失败的交易
      const validTransactions = batchTransactions.filter(tx => tx !== null);
      transactions.push(...validTransactions);
    } catch (error) {
      console.error('获取交易失败：', error);
      // 继续处理下一批
    }

    // 避免 Rate Limit
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return transactions;
}

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

    // 验证 Solana 地址格式
    try {
      new PublicKey(address);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Invalid Solana address' },
        { status: 400 }
      );
    }

    // 计算月份的开始和结束时间戳
    const [year, monthNum] = month.split('-').map(Number);
    const startDate = new Date(year, monthNum - 1, 1);
    const endDate = new Date(year, monthNum, 0);
    endDate.setHours(23, 59, 59, 999);

    const startTime = Math.floor(startDate.getTime() / 1000);
    const endTime = Math.floor(endDate.getTime() / 1000);

    // 【增量同步逻辑】查询数据库中该地址的最新记录
    const latestRecord = await prisma.gasCache.findFirst({
      where: {
        walletAddress: address
      },
      orderBy: {
        date: 'desc'
      }
    });

    // 确定需要从 RPC 拉取的起始时间和签名
    let fetchStartTime = startTime;
    let lastSignature: string | undefined;

    if (latestRecord) {
      // 如果存在历史数据，从最新记录的日期开始拉取
      // 注意：这里使用日期的开始时间，确保不会遗漏任何交易
      const latestDate = new Date(latestRecord.date);
      fetchStartTime = Math.floor(latestDate.getTime() / 1000);
      console.log(`存在历史数据，从 ${latestRecord.date} 开始增量同步`);
    } else {
      console.log('不存在历史数据，从头开始同步');
    }

    // 从数据库查询历史数据
    const dbData = await prisma.gasCache.findMany({
      where: {
        walletAddress: address,
        date: {
          gte: startDate.toISOString().split('T')[0],
          lte: endDate.toISOString().split('T')[0]
        }
      }
    });

    // 将数据库数据转换为字典，方便查找
    const dbDataMap: Record<string, { txCount: number; totalGasFee: string; totalGasUsd: number }> = {};
    dbData.forEach(item => {
      dbDataMap[item.date] = {
        txCount: item.txCount,
        totalGasFee: item.totalGasFee,
        totalGasUsd: item.totalGasUsd
      };
    });

    // 如果需要从 RPC 拉取数据（增量部分）
    if (fetchStartTime <= endTime) {
      console.log('从 RPC 拉取增量数据...');
      
      // 获取交易签名
      const signatures = await getSignaturesForAddress(address, fetchStartTime, endTime, lastSignature);
      console.log(`获取到 ${signatures.length} 个交易签名`);

      if (signatures.length > 0) {
        // 分批获取交易详情
        const transactions = await getTransactionsInBatches(
          signatures.map(sig => sig.signature)
        );
        console.log(`获取到 ${transactions.length} 个交易详情`);

        // 按日期聚合数据
        const aggregatedData: Record<string, { 
          txCount: number; 
          totalGasFee: number; 
          totalGasUsd: number 
        }> = {};
        
        for (const tx of transactions) {
          if (!tx || !tx.blockTime || !tx.meta) continue;
          
          const dateStr = formatDate(tx.blockTime);
          const fee = tx.meta.fee / 1e9; // 将 lamports 转换为 SOL
          
          // 获取交易发生时的 SOL 价格
          const solPrice = await getSolPriceAtDate(dateStr);
          const feeUsd = fee * solPrice;
          
          if (!aggregatedData[dateStr]) {
            aggregatedData[dateStr] = { txCount: 0, totalGasFee: 0, totalGasUsd: 0 };
          }
          
          aggregatedData[dateStr].txCount++;
          aggregatedData[dateStr].totalGasFee += fee;
          aggregatedData[dateStr].totalGasUsd += feeUsd;
        }

        // 将聚合数据保存到数据库
        for (const [date, data] of Object.entries(aggregatedData)) {
          try {
            await prisma.gasCache.upsert({
              where: {
                walletAddress_date: {
                  walletAddress: address,
                  date
                }
              },
              update: {
                txCount: data.txCount,
                totalGasFee: data.totalGasFee.toFixed(9), // 保留 9 位小数
                totalGasUsd: data.totalGasUsd,
                updatedAt: new Date()
              },
              create: {
                walletAddress: address,
                date,
                txCount: data.txCount,
                totalGasFee: data.totalGasFee.toFixed(9),
                totalGasUsd: data.totalGasUsd
              }
            });
          } catch (error) {
            console.error(`保存数据失败 (${date})：`, error);
          }
        }

        // 重新从数据库获取完整数据
        const updatedDbData = await prisma.gasCache.findMany({
          where: {
            walletAddress: address,
            date: {
              gte: startDate.toISOString().split('T')[0],
              lte: endDate.toISOString().split('T')[0]
            }
          }
        });

        // 更新数据映射
        updatedDbData.forEach(item => {
          dbDataMap[item.date] = {
            txCount: item.txCount,
            totalGasFee: item.totalGasFee,
            totalGasUsd: item.totalGasUsd
          };
        });
      }
    }

    // 构建返回结果
    const result: Record<string, { tx_count: number; total_gas_usd: number }> = {};
    let resultDate = new Date(startDate);
    while (resultDate <= endDate) {
      const dateStr = formatDate(Math.floor(resultDate.getTime() / 1000));
      const data = dbDataMap[dateStr];
      
      result[dateStr] = {
        tx_count: data ? data.txCount : 0,
        total_gas_usd: data ? data.totalGasUsd : 0
      };
      
      // 移动到下一天
      resultDate.setDate(resultDate.getDate() + 1);
    }

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
    const { address, date, txCount, totalGasFee, totalGasUsd } = await request.json();

    // 验证参数
    if (!address || !date || txCount === undefined || totalGasFee === undefined || totalGasUsd === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // 使用 Prisma 的 upsert 方法保存数据
    await prisma.gasCache.upsert({
      where: {
        walletAddress_date: {
          walletAddress: address,
          date
        }
      },
      update: {
        txCount,
        totalGasFee,
        totalGasUsd,
        updatedAt: new Date()
      },
      create: {
        walletAddress: address,
        date,
        txCount,
        totalGasFee,
        totalGasUsd
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