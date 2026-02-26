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
const DEFAULT_RPC = 'https://mainnet.helius-rpc.com/?api-key=93f747fb-101a-420c-b620-fd9b7d341ca1';
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

  // 初始化月份
  useEffect(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    setTargetMonth(`${year}-${month}`);
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



  // 从本地存储中获取数据
  const getLocalStorageData = (): Record<string, Record<string, { tx_count: number; fee_usdt: string; fee_rmb: string }>> => {
    try {
      const data = localStorage.getItem('solana_gas_data');
      return data ? JSON.parse(data) : {};
    } catch (err) {
      console.warn('读取本地存储失败:', err);
      return {};
    }
  };

  // 保存数据到本地存储
  const saveLocalStorageData = (data: Record<string, Record<string, { tx_count: number; fee_usdt: string; fee_rmb: string }>>) => {
    try {
      localStorage.setItem('solana_gas_data', JSON.stringify(data));
    } catch (err) {
      console.warn('保存本地存储失败:', err);
    }
  };

  const handleLoadMonth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      setError('请输入有效的 Solana 钱包地址');
      return;
    }

    localStorage.setItem('sol_address', address);
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
      let reachedEnd = false;

      while (!reachedEnd && allSignatures.length < MAX_MONTH_TXS) {
        const params: any[] = [address, { limit: 1000, ...(lastSignature ? { before: lastSignature } : {}) }];
        const sigs = await callRpc(DEFAULT_RPC, 'getSignaturesForAddress', params);
        
        if (!sigs || sigs.length === 0) break;

        for (const sig of sigs) {
          const txTime = sig.blockTime;
          if (!txTime) continue;
          if (txTime < startTimestamp) {
            reachedEnd = true;
            break;
          }
          if (txTime <= endTimestamp && txTime >= startTimestamp) {
            const offset = new Date(txTime * 1000).getTimezoneOffset() * 60000;
            const localDate = (new Date(txTime * 1000 - offset)).toISOString().split('T')[0];
            allSignatures.push({ signature: sig.signature, blockTime: txTime, localDate });
          }
        }
        lastSignature = sigs[sigs.length - 1].signature;
        if (sigs.length < 1000) break;
      }
      
      setMonthSignatures(allSignatures);

      const chainCounts: Record<string, number> = {};
      days.forEach(d => chainCounts[d] = 0);
      allSignatures.forEach(sig => {
        if (chainCounts[sig.localDate] !== undefined) {
          chainCounts[sig.localDate]++;
        }
      });

      setProgressMsg('正在校验本地缓存...');
      const finalMonthData: DayData[] = [];
      
      // 从本地存储中获取数据
      const localData = getLocalStorageData();
      const addressData = localData[address] || {};

      days.forEach((dayStr) => {
        const chainCount = chainCounts[dayStr];
        const dbSnap = addressData[dayStr];
        let isSynced = false;
        let feeUsdt = '0.000000';
        let feeRmb = '0.000';

        if (dbSnap) {
          // 如果链上抓出来的笔数和本地存储存的一模一样，说明不需要再查 RPC
          if (dbSnap.tx_count === chainCount) {
            isSynced = true;
            feeUsdt = dbSnap.fee_usdt;
            feeRmb = dbSnap.fee_rmb;
          }
        }

        finalMonthData.push({
          date: dayStr,
          txCount: chainCount,
          isSynced: chainCount === 0 ? true : isSynced, 
          feeUsdt: isSynced ? feeUsdt : '0.000000',
          feeRmb: isSynced ? feeRmb : '0.000'
        });
      });

      setMonthData(finalMonthData);
      const firstActive = finalMonthData.find(d => d.txCount > 0);
      setSelectedDay(firstActive || finalMonthData[finalMonthData.length - 1]);
      
      // 保存所有从链上获取的数据到本地存储
      // 为了避免性能问题，我们先保存第一笔有交易但未同步的数据
      const firstUnsynced = finalMonthData.find(d => d.txCount > 0 && !d.isSynced);
      if (firstUnsynced) {
        // 计算手续费并保存
        handleCalculateDay(firstUnsynced);
      }

    } catch (err: any) {
      setError(err.message || '获取月度数据失败，请重试');
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  };

  const handleCalculateDay = async (dayObj: DayData) => {
    setCalcLoading(true);
    setProgressMsg('正在精准解析当日手续费...');
    
    try {
      const daySigs = monthSignatures.filter(s => s.localDate === dayObj.date);
      let totalFeeUsdt = 0;
      const batchSize = 5; 
      
      for (let i = 0; i < daySigs.length; i += batchSize) {
        const batchSigs = daySigs.slice(i, i + batchSize);
        const paramsArray = batchSigs.map(sig => [
          sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }
        ]);

        try {
          const responses = await callRpcBatch(DEFAULT_RPC, 'getTransaction', paramsArray);
          for (const res of responses) {
            if (res.error || !res.result) continue;
            
            if (res.result.meta && res.result.meta.fee) {
              const feeSol = res.result.meta.fee / 1e9;
              const txTimeSec = res.result.blockTime;
              
              let priceAtTxTime = exchangeRates.solUsd;
              if (monthlyKlines && monthlyKlines.length > 0 && txTimeSec) {
                const txTimeMs = txTimeSec * 1000;
                for (const k of monthlyKlines) {
                  if (txTimeMs >= k[0] && txTimeMs <= k[6]) {
                    priceAtTxTime = (parseFloat(k[1]) + parseFloat(k[4])) / 2;
                    break;
                  }
                }
              }
              totalFeeUsdt += (feeSol * priceAtTxTime);
            }
          }
        } catch (batchErr) {
          console.warn("批次跳过", batchErr);
        }

        setProgressMsg(`解析中 (${Math.min(i + batchSize, daySigs.length)} / ${daySigs.length})...`);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      const totalFeeRmb = totalFeeUsdt * exchangeRates.usdToCny;
      const finalUsdtStr = totalFeeUsdt.toFixed(6);
      const finalRmbStr = totalFeeRmb.toFixed(3);

      // 保存数据到本地存储
      try {
        const localData = getLocalStorageData();
        if (!localData[address]) {
          localData[address] = {};
        }
        localData[address][dayObj.date] = {
          tx_count: dayObj.txCount,
          fee_usdt: finalUsdtStr,
          fee_rmb: finalRmbStr
        };
        saveLocalStorageData(localData);
      } catch (err) {
        console.warn("保存到本地存储失败", err);
      }

      const updatedData = monthData.map(d => 
        d.date === dayObj.date 
          ? { ...d, isSynced: true, feeUsdt: finalUsdtStr, feeRmb: finalRmbStr } 
          : d
      );
      setMonthData(updatedData);
      setSelectedDay(updatedData.find(d => d.date === dayObj.date) || null);

    } catch (err: any) {
      alert('计算失败: ' + err.message);
    } finally {
      setCalcLoading(false);
      setProgressMsg('');
    }
  };

  const maxTxCount = useMemo(() => {
    return monthData.reduce((max, day) => Math.max(max, day.txCount), 0) || 1;
  }, [monthData]);

  const monthlyTotals = useMemo(() => {
    let sumUsdt = 0;
    let sumRmb = 0;
    let syncedDays = 0;
    let totalActiveDays = 0;

    monthData.forEach(d => {
      if (d.txCount > 0) totalActiveDays++;
      if (d.isSynced && d.txCount > 0) {
        sumUsdt += parseFloat(d.feeUsdt);
        sumRmb += parseFloat(d.feeRmb);
        syncedDays++;
      }
    });
    return { sumUsdt: sumUsdt.toFixed(4), sumRmb: sumRmb.toFixed(2), syncedDays, totalActiveDays };
  }, [monthData]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-800">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100">
        
        <div className="bg-gradient-to-r from-purple-600 to-teal-500 p-6 text-white">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-6 h-6 text-yellow-300" />
            <h1 className="text-xl font-bold">SOL 本地数据库 Gas 看板</h1>
          </div>
          <p className="text-purple-100 text-sm opacity-90 flex items-center gap-1">
            <Database className="w-3 h-3" /> 数据存储于本地 MySQL，极速调取免查链
          </p>
        </div>

        <div className="p-6">
          <form onSubmit={handleLoadMonth} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">Solana 钱包地址</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Wallet className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Base58 地址..."
                    className="block w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">查询月份</label>
                <div className="relative">
                  <input
                    type="month"
                    value={targetMonth}
                    onChange={(e) => setTargetMonth(e.target.value)}
                    className="block w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                    required
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center p-3 text-sm text-red-800 bg-red-50 rounded-lg border border-red-200">
                <AlertCircle className="w-4 h-4 mr-2" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex flex-col justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none disabled:opacity-70 transition-all min-h-[44px]"
            >
              {loading ? (
                <div className="flex flex-col items-center">
                  <div className="flex items-center">
                    <Loader2 className="animate-spin mr-2 h-4 w-4" />
                    扫描整月数据中...
                  </div>
                  {progressMsg && <span className="text-[10px] text-purple-200 mt-1">{progressMsg}</span>}
                </div>
              ) : (
                <div className="flex items-center">
                  <BarChart3 className="mr-2 h-4 w-4" />
                  拉取当月活动视图
                </div>
              )}
            </button>
          </form>

          {monthData.length > 0 && !loading && (
            <div className="mt-8 animate-in fade-in duration-300">
              
              <div className="mb-6">
                <h3 className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wider flex justify-between">
                  <span>{targetMonth} 每日活跃度</span>
                  <span>单月扫描上限: {MAX_MONTH_TXS} 笔</span>
                </h3>
                
                <div className="h-32 flex items-end gap-[2px] border-b border-slate-200 pb-1 px-1">
                  {monthData.map((day) => {
                    const heightPct = day.txCount === 0 ? 0 : Math.max(5, (day.txCount / maxTxCount) * 100);
                    const isSelected = selectedDay?.date === day.date;
                    return (
                      <div 
                        key={day.date}
                        title={`${day.date}: ${day.txCount} 笔交易`}
                        onClick={() => setSelectedDay(day)}
                        className={`flex-1 rounded-t-sm cursor-pointer transition-all ${
                          isSelected ? 'bg-teal-500' : 
                          day.txCount === 0 ? 'bg-transparent' : 
                          day.isSynced ? 'bg-purple-400 hover:bg-purple-500' : 'bg-orange-300 hover:bg-orange-400'
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 mt-1 px-1">
                  <span>{monthData[0].date.slice(-2)}日</span>
                  <span>{monthData[monthData.length-1].date.slice(-2)}日</span>
                </div>
              </div>

              {selectedDay && (
                <div className={`p-5 rounded-xl border ${selectedDay.isSynced ? 'border-teal-200 bg-teal-50/50' : 'border-orange-200 bg-orange-50/50'} shadow-sm transition-all relative`}>
                  
                  <div className={`absolute top-0 right-0 px-3 py-1 rounded-bl-lg rounded-tr-xl text-[10px] font-bold flex items-center gap-1 ${
                    selectedDay.isSynced ? 'bg-teal-500 text-white' : 'bg-orange-500 text-white'
                  }`}>
                    {selectedDay.isSynced ? <CheckCircle2 className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
                    {selectedDay.isSynced ? '已匹配本地缓存' : '需要计算'}
                  </div>

                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h4 className="text-lg font-bold text-slate-800">{selectedDay.date}</h4>
                      <p className="text-xs text-slate-500">当日总交易：<span className="font-semibold">{selectedDay.txCount}</span> 笔</p>
                    </div>
                  </div>

                  {selectedDay.txCount === 0 ? (
                    <div className="text-center py-4 text-sm text-slate-400">当日无任何交易记录</div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        {selectedDay.isSynced ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-baseline gap-1">
                              <span className="text-3xl font-bold text-slate-800">{selectedDay.feeUsdt}</span>
                              <span className="text-xs font-bold text-slate-500">USDT</span>
                            </div>
                            <span className="text-xs text-slate-500">≈ {selectedDay.feeRmb} RMB</span>
                          </div>
                        ) : (
                          <div className="text-sm text-orange-600 font-medium">
                            检测到未缓存的新交易，请重新计算差额。
                          </div>
                        )}
                      </div>

                      {!selectedDay.isSynced && (
                        <button
                          onClick={() => handleCalculateDay(selectedDay)}
                          disabled={calcLoading}
                          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-70 flex items-center"
                        >
                          {calcLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Database className="w-4 h-4 mr-1" />}
                          {calcLoading ? '计算中...' : '计算当日并存档'}
                        </button>
                      )}
                    </div>
                  )}
                  {calcLoading && progressMsg && <p className="text-[10px] text-orange-600 mt-2 text-right">{progressMsg}</p>}
                </div>
              )}

              <div className="mt-6 pt-5 border-t border-slate-100 flex justify-between items-center">
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">本月账单总计 (基于已存档天数)</h4>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-purple-700">{monthlyTotals.sumUsdt}</span>
                    <span className="text-xs font-bold text-slate-400">USDT</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-400 mb-1">
                    完成度: {monthlyTotals.syncedDays} / {monthlyTotals.totalActiveDays} 活跃天
                  </p>
                  {monthlyTotals.syncedDays < monthlyTotals.totalActiveDays && (
                    <p className="text-[10px] text-orange-500 bg-orange-50 px-2 py-1 rounded">
                      部分天数未归档，总额不完整
                    </p>
                  )}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
