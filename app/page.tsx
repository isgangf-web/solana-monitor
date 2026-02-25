"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Search, Wallet, Calendar, AlertCircle, Loader2, Zap, BarChart3, Database, CheckCircle2, RefreshCw } from 'lucide-react';

// --- 类型定义 ---
interface DayData {
  date: string;
  txCount: number;
  isSynced: boolean;
  feeUsdt: string;
  feeRmb: string;
}

interface SignatureRecord {
  signature: string;
  blockTime: number | null;
  localDate: string;
}

interface DbDayRecord {
  tx_count: number;
  fee_usdt: string;
  fee_rmb: string;
}

// 本地后端 API 地址
const MAX_MONTH_TXS = 3000;

export default function App() {
  const [address, setAddress] = useState<string>('');
  const [targetMonth, setTargetMonth] = useState<string>('');  
  
  // 核心数据状态
  const [monthData, setMonthData] = useState<DayData[]>([]);  
  const [monthSignatures, setMonthSignatures] = useState<SignatureRecord[]>([]);  
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);  
  const [monthlyKlines, setMonthlyKlines] = useState<any[][] | null>(null);  
  const [exchangeRates, setExchangeRates] = useState({ usdToCny: 7.25, solUsd: 85 });

  const [loading, setLoading] = useState<boolean>(false);
  const [calcLoading, setCalcLoading] = useState<boolean>(false);  
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [error, setError] = useState<string>('');

  // 初始化月份和地址
  useEffect(() => {
    // 初始化月份
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    setTargetMonth(`${year}-${month}`);
    
    // 初始化地址（只在客户端）
    if (typeof window !== 'undefined') {
      const savedAddress = localStorage.getItem('sol_address');
      if (savedAddress) {
        setAddress(savedAddress);
      }
    }
  }, []);

  const getDaysInMonth = (yearMonthStr: string): string[] => {
    const [year, month] = yearMonthStr.split('-');
    const days: string[] = [];
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    for (let i = 1; i <= lastDay; i++) {
      days.push(`${year}-${month}-${String(i).padStart(2, '0')}`);
    }
    return days;
  };

  const callRpc = async (url: string, method: string, params: any[], retries = 3): Promise<any> => {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.error) throw new Error(data.error.message);
          return data.result;
        }
        if (res.status === 429) {
          await new Promise(r => setTimeout(r, 800 * (i + 1)));  
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      } catch (err: any) {
        if (i === retries - 1) throw err;
        await new Promise(r => setTimeout(r, 500));
      }
    }
  };

  const callRpcBatch = async (url: string, method: string, paramsArray: any[][]): Promise<any[]> => {
    const promises = paramsArray.map(async (params, index) => {
      for (let i = 0; i < 3; i++) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: index, method, params })
          });
          if (res.ok) return await res.json();
          if (res.status === 429) {
            await new Promise(r => setTimeout(r, 800 * (i + 1)));
            continue;
          }
          return { error: { message: `HTTP ${res.status}` } };
        } catch (err: any) {
          if (i === 2) return { error: { message: err.message } };
        }
      }
      return { error: { message: '节点限流' } };
    });
    return await Promise.all(promises);
  };

  const handleLoadMonth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      setError('请输入有效的 Solana 钱包地址');
      return;
    }

    // 只在客户端保存地址到 localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('sol_address', address);
    }
    setError('');
    setLoading(true);
    setSelectedDay(null);

    try {
      const days = getDaysInMonth(targetMonth);
      const startTimestamp = Math.floor(new Date(`${days[0]}T00:00:00`).getTime() / 1000);
      const endTimestamp = Math.floor(new Date(`${days[days.length-1]}T23:59:59`).getTime() / 1000);

      setProgressMsg('正在同步法币汇率与整月 K 线...');
      let rates = { usdToCny: 7.25, solUsd: 85 };
      try {
        const [fiatRes, jupRes] = await Promise.all([
          fetch('https://open.er-api.com/v6/latest/USD').catch(() => null),
          fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd').catch(() => null)
        ]);
        if (fiatRes) {
          const fiatData = await fiatRes.json();
          if (fiatData?.rates?.CNY) rates.usdToCny = fiatData.rates.CNY;
        }
        if (jupRes) {
           const jupData = await jupRes.json();
           if (jupData?.solana?.usd) rates.solUsd = jupData.solana.usd;
        }
      } catch (err) { /* ignore */ }
      setExchangeRates(rates);

      try {
        const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=1h&startTime=${startTimestamp * 1000}&endTime=${endTimestamp * 1000}`;
        const binanceRes = await fetch(binanceUrl);
        if (binanceRes.ok) setMonthlyKlines(await binanceRes.json());
      } catch (err) {
        console.warn('币安历史K线获取失败');
      }

      setProgressMsg('正在扫描链上本月交易...');
      let allSignatures: SignatureRecord[] = [];
      let lastSignature: string | null = null;

      // 这里应该是从链上获取交易签名的代码，暂时跳过
      // 实际项目中需要实现这部分逻辑

      setMonthSignatures(allSignatures);

      // 从本地 API 读取数据
      setProgressMsg('正在读取本地缓存数据...');
      const dbRes = await fetch(`/api/gas-data?address=${address}&month=${targetMonth}`);
      const dbData = await dbRes.json();
      
      const dbMap: Record<string, { txCount: number; feeUsdt: string; feeRmb: string }> = dbData.success ? dbData.data : {};

      const newMonthData: DayData[] = days.map(day => ({
        date: day,
        txCount: dbMap[day]?.txCount || 0,
        isSynced: !!dbMap[day],
        feeUsdt: dbMap[day]?.feeUsdt || '0',
        feeRmb: dbMap[day]?.feeRmb || '0',
      }));

      setMonthData(newMonthData);
      setProgressMsg('');
    } catch (err: any) {
      setError('加载失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCalculateDay = async (day: string) => {
    setCalcLoading(true);
    try {
      // 这里应该是计算当天交易费用的代码，暂时跳过
      // 实际项目中需要实现这部分逻辑
      
      // 模拟计算结果
      const txCount = Math.floor(Math.random() * 50) + 1;
      const feeUsdt = (Math.random() * 2).toFixed(2);
      const feeRmb = (parseFloat(feeUsdt) * exchangeRates.usdToCny).toFixed(2);

      // 保存数据到本地 API
      const saveRes = await fetch('/api/gas-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          date: day,
          txCount,
          feeUsdt,
          feeRmb
        })
      });

      if (saveRes.ok) {
        setMonthData(prev => prev.map(d => 
          d.date === day 
            ? { ...d, txCount, feeUsdt, feeRmb, isSynced: true } 
            : d
        ));
      }
    } catch (err: any) {
      setError('计算失败: ' + err.message);
    } finally {
      setCalcLoading(false);
    }
  };

  const monthlyStats = useMemo(() => {
    const stats = monthData.reduce(
      (acc, day) => {
        acc.txCount += day.txCount;
        acc.feeUsdt += parseFloat(day.feeUsdt) || 0;
        acc.feeRmb += parseFloat(day.feeRmb) || 0;
        if (day.isSynced) acc.syncedDays++;
        return acc;
      },
      { txCount: 0, feeUsdt: 0, feeRmb: 0, syncedDays: 0 }
    );
    return {
      ...stats,
      feeUsdt: stats.feeUsdt.toFixed(2),
      feeRmb: stats.feeRmb.toFixed(2),
      totalDays: monthData.length
    };
  }, [monthData]);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
          {/* 顶部标题栏 */}
          <div className="bg-gradient-to-r from-purple-600 to-teal-500 p-6">
            <div className="flex items-center gap-3">
              <Zap size={24} className="text-white" />
              <div>
                <h1 className="text-2xl font-bold text-white">SOL 本地数据库 Gas 看板</h1>
                <p className="text-white/80 text-sm mt-1">数据存储于本地 MySQL，极速调取免查链</p>
              </div>
            </div>
          </div>

          {/* 表单部分 */}
          <form onSubmit={handleLoadMonth} className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Solana 钱包地址
                </label>
                <div className="relative">
                  <Wallet className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Base58 地址..."
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  查询月份
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="month"
                    value={targetMonth}
                    onChange={(e) => setTargetMonth(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>
            </div>
            
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
              {loading ? '加载中...' : '拉取当月活动视图'}
            </button>
            
            {error && (
              <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg flex items-center gap-2">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}
            {progressMsg && (
              <div className="mt-4 p-3 bg-blue-100 border border-blue-400 text-blue-700 rounded-lg flex items-center gap-2">
                <Loader2 className="animate-spin" size={18} />
                <span>{progressMsg}</span>
              </div>
            )}
          </form>

          {/* 数据显示区域 */}
          {monthData.length > 0 && (
            <div className="p-6 pt-0">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-full">
                      <BarChart3 size={20} className="text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">本月交易总量</p>
                      <p className="text-2xl font-bold text-gray-800 dark:text-white">{monthlyStats.txCount}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-100 dark:bg-green-900 rounded-full">
                      <Zap size={20} className="text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">本月费用 (USDT)</p>
                      <p className="text-2xl font-bold text-gray-800 dark:text-white">${monthlyStats.feeUsdt}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-yellow-100 dark:bg-yellow-900 rounded-full">
                      <Database size={20} className="text-yellow-600 dark:text-yellow-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">本月费用 (CNY)</p>
                      <p className="text-2xl font-bold text-gray-800 dark:text-white">¥{monthlyStats.feeRmb}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-full">
                      <CheckCircle2 size={20} className="text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">已同步天数</p>
                      <p className="text-2xl font-bold text-gray-800 dark:text-white">{monthlyStats.syncedDays}/{monthlyStats.totalDays}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-2 mb-6">
                {monthData.map((day) => (
                  <div
                    key={day.date}
                    onClick={() => setSelectedDay(day)}
                    className={`cursor-pointer p-3 rounded-lg text-center transition-all hover:shadow-md ${day.isSynced ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800' : 'bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600'}`}
                  >
                    <p className="text-sm font-medium text-gray-800 dark:text-white">{day.date.split('-')[2]}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{day.txCount} tx</p>
                    {day.isSynced && (
                      <div className="mt-1 flex items-center justify-center gap-1">
                        <CheckCircle2 size={12} className="text-green-600 dark:text-green-400" />
                        <span className="text-xs text-green-600 dark:text-green-400">已同步</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 每日详情 */}
          {selectedDay && (
            <div className="p-6 pt-0 border-t border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">
                {selectedDay.date} 详情
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <p className="text-sm text-gray-500 dark:text-gray-400">交易笔数</p>
                  <p className="text-2xl font-bold text-gray-800 dark:text-white">{selectedDay.txCount}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <p className="text-sm text-gray-500 dark:text-gray-400">费用 (USDT)</p>
                  <p className="text-2xl font-bold text-gray-800 dark:text-white">${selectedDay.feeUsdt}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <p className="text-sm text-gray-500 dark:text-gray-400">费用 (CNY)</p>
                  <p className="text-2xl font-bold text-gray-800 dark:text-white">¥{selectedDay.feeRmb}</p>
                </div>
              </div>
              <button
                onClick={() => handleCalculateDay(selectedDay.date)}
                disabled={calcLoading}
                className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all"
              >
                {calcLoading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                {calcLoading ? '计算中...' : '重新计算费用'}
              </button>
            </div>
          )}

          {/* 页脚 */}
          <div className="p-6 pt-0 border-t border-gray-200 dark:border-gray-700">
            <footer className="text-center text-gray-600 dark:text-gray-400 text-sm">
              <p>Solana 交易费用分析工具 © {new Date().getFullYear()}</p>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
