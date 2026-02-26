"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Search, Wallet, Calendar, AlertCircle, Loader2, Zap, BarChart3, Database, CheckCircle2, RefreshCw } from 'lucide-react';

// --- 类型定义 ---
interface DayData {
  date: string;
  txCount: number;
  isSynced: boolean;
  totalGasUsd: number;
}

interface SignatureRecord {
  signature: string;
  blockTime: number | null;
  localDate: string;
}

interface DbDayRecord {
  tx_count: number;
  total_gas_usd: number;
}



export default function App() {
  const [address, setAddress] = useState<string>('');
  const [targetMonth, setTargetMonth] = useState<string>('');  
  
  // 核心数据状态
  const [monthData, setMonthData] = useState<DayData[]>([]);  
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);  

  const [loading, setLoading] = useState<boolean>(false);
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
      setProgressMsg('正在从数据库和链上获取数据...');
      
      // 调用 API 获取数据
      const response = await fetch(`/api/gas-data?address=${address}&month=${targetMonth}`);
      const result = await response.json();
      
      if (!result.success) {
        setError(result.error || '获取数据失败');
        return;
      }
      
      const data = result.data;
      const days = getDaysInMonth(targetMonth);
      
      // 构建月度数据
      const finalMonthData: DayData[] = days.map(dayStr => {
        const dayData = data[dayStr];
        return {
          date: dayStr,
          txCount: dayData ? dayData.tx_count : 0,
          isSynced: dayData ? true : false,
          totalGasUsd: dayData ? dayData.total_gas_usd : 0
        };
      });

      setMonthData(finalMonthData);
      const firstActive = finalMonthData.find(d => d.txCount > 0);
      setSelectedDay(firstActive || finalMonthData[finalMonthData.length - 1]);

    } catch (err: any) {
      setError(err.message || '获取月度数据失败，请重试');
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  };



  const maxTxCount = useMemo(() => {
    return monthData.reduce((max, day) => Math.max(max, day.txCount), 0) || 1;
  }, [monthData]);

  const monthlyTotals = useMemo(() => {
    let sumGasUsd = 0;
    let syncedDays = 0;
    let totalActiveDays = 0;

    monthData.forEach(d => {
      if (d.txCount > 0) totalActiveDays++;
      if (d.isSynced && d.txCount > 0) {
        sumGasUsd += d.totalGasUsd;
        syncedDays++;
      }
    });
    return { sumGasUsd: sumGasUsd.toFixed(2), syncedDays, totalActiveDays };
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
                              <span className="text-3xl font-bold text-slate-800">{selectedDay.totalGasUsd.toFixed(2)}</span>
                              <span className="text-xs font-bold text-slate-500">USD</span>
                            </div>
                            <span className="text-xs text-slate-500">当日总 Gas 消耗</span>
                          </div>
                        ) : (
                          <div className="text-sm text-orange-600 font-medium">
                            数据正在同步中...
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-6 pt-5 border-t border-slate-100 flex justify-between items-center">
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">本月 Gas 总计 (基于已同步天数)</h4>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-purple-700">{monthlyTotals.sumGasUsd}</span>
                    <span className="text-xs font-bold text-slate-400">USD</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-400 mb-1">
                    完成度: {monthlyTotals.syncedDays} / {monthlyTotals.totalActiveDays} 活跃天
                  </p>
                  {monthlyTotals.syncedDays < monthlyTotals.totalActiveDays && (
                    <p className="text-[10px] text-orange-500 bg-orange-50 px-2 py-1 rounded">
                      部分天数未同步，总额不完整
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
