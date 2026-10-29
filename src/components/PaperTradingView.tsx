/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Wallet,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  FileText,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import {
  PaperTradingEngine,
  PaperAccountState,
  PaperPosition,
  PaperTradeJournalEntry,
} from '../utils/paperTrading.ts';
import { formatINR } from '../services/marketDataProvider.ts';
import { IntradayCandle } from '../services/intradayData.ts';

interface PaperTradingViewProps {
  engine: PaperTradingEngine;
  onRefresh: () => void;
  replayCandles?: IntradayCandle[];
}

export function PaperTradingView({ engine, onRefresh, replayCandles = [] }: PaperTradingViewProps) {
  const [replayIndex, setReplayIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const accountState = engine.getState();
  const alerts = engine.getAlerts();

  const handleStepReplay = () => {
    if (replayIndex >= replayCandles.length) return;
    const candle = replayCandles[replayIndex];
    engine.evaluatePositionsOnBar(candle);
    setReplayIndex((prev) => prev + 1);
    onRefresh();
  };

  const handleResetReplay = () => {
    setIsPlaying(false);
    setReplayIndex(0);
    engine.reset(100000);
    onRefresh();
  };

  const handleClosePosition = (pos: PaperPosition) => {
    // Manually trigger a close bar at current price
    const mockBar: IntradayCandle = {
      timestamp: Date.now(),
      timestampIST: new Date().toLocaleTimeString('en-IN'),
      dateString: '2026-10-29',
      timeString: '15:15',
      open: pos.currentPrice,
      high: pos.currentPrice,
      low: pos.currentPrice,
      close: pos.currentPrice,
      volume: 1000,
      isComplete: true,
      sessionMinute: 360,
      isValid: true,
    };
    engine.evaluatePositionsOnBar(mockBar);
    onRefresh();
  };

  const currentReplayCandle = replayCandles[replayIndex - 1] || null;

  return (
    <div className="space-y-6">
      {/* Account Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <span className="text-[11px] text-slate-400 block">Total Equity</span>
          <span className="text-base font-bold text-white font-mono">
            ₹{accountState.equityINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <span className="text-[11px] text-slate-400 block">Available Cash</span>
          <span className="text-base font-bold text-slate-200 font-mono">
            ₹{accountState.availableCashINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <span className="text-[11px] text-slate-400 block">Margin Blocked</span>
          <span className="text-base font-bold text-indigo-400 font-mono">
            ₹{accountState.marginBlockedINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <span className="text-[11px] text-slate-400 block">Unrealized P&L</span>
          <span
            className={`text-base font-bold font-mono ${
              accountState.unrealizedPnLINR >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {accountState.unrealizedPnLINR >= 0 ? '+' : ''}
            ₹{accountState.unrealizedPnLINR.toFixed(2)}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <span className="text-[11px] text-slate-400 block">Realized P&L</span>
          <span
            className={`text-base font-bold font-mono ${
              accountState.realizedPnLINR >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {accountState.realizedPnLINR >= 0 ? '+' : ''}
            ₹{accountState.realizedPnLINR.toFixed(2)}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <span className="text-[11px] text-slate-400 block">Statutory Fees</span>
          <span className="text-base font-bold text-amber-400 font-mono">
            ₹{accountState.totalFeesPaidINR.toFixed(2)}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <span className="text-[11px] text-slate-400 block">Peak Equity</span>
          <span className="text-base font-bold text-slate-300 font-mono">
            ₹{accountState.peakEquityINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <span className="text-[11px] text-slate-400 block">Max Drawdown</span>
          <span className="text-base font-bold text-rose-400 font-mono">
            {accountState.maxDrawdownPct.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Historical Replay / Time Machine Controls */}
      {replayCandles.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="text-sm font-bold text-white">Historical "Time Machine" Replay</h3>
              <p className="text-xs text-slate-400">
                Bar {replayIndex} of {replayCandles.length}{' '}
                {currentReplayCandle ? `(${currentReplayCandle.timestampIST})` : '(Ready to step)'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleStepReplay}
              disabled={replayIndex >= replayCandles.length}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            >
              <SkipForward className="w-3.5 h-3.5" />
              Step 1 Bar
            </button>
            <button
              onClick={handleResetReplay}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Grid: Open Positions (Top) & Trade Journal (Bottom) */}
      <div className="space-y-4">
        {/* Open Positions */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-indigo-400" />
              Open Positions ({accountState.openPositions.length})
            </h3>
            <span className="text-xs text-slate-400">Intraday MIS (Auto square-off at 15:15 IST)</span>
          </div>

          {accountState.openPositions.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-lg">
              No open positions. Use the Intraday Scanner to find approved setups and execute paper trades.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Qty</th>
                    <th className="py-2.5 px-3">Entry Price</th>
                    <th className="py-2.5 px-3">Current Price</th>
                    <th className="py-2.5 px-3">Target</th>
                    <th className="py-2.5 px-3">Stop Loss</th>
                    <th className="py-2.5 px-3">Unrealized P&L</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {accountState.openPositions.map((pos) => (
                    <tr key={pos.symbol} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-bold text-white">{pos.symbol}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            pos.direction === 'LONG'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}
                        >
                          {pos.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono">{pos.quantity}</td>
                      <td className="py-2.5 px-3 font-mono">₹{pos.averageEntryPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-3 font-mono">₹{pos.currentPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-3 font-mono text-emerald-400">₹{pos.targetPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-3 font-mono text-rose-400">₹{pos.stopLossPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-3 font-mono">
                        <span className={pos.unrealizedPnLINR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {pos.unrealizedPnLINR >= 0 ? '+' : ''}₹{pos.unrealizedPnLINR.toFixed(2)} (
                          {pos.unrealizedPnLPct.toFixed(2)}%)
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => handleClosePosition(pos)}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] px-2.5 py-1 rounded"
                        >
                          Square Off
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Trade Journal with Statutory Fee Breakdown */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Receipt className="w-4 h-4 text-emerald-400" />
              Trade Journal ({accountState.tradeJournal.length} Trades)
            </h3>
            <span className="text-xs text-slate-400">
              Win Rate: {accountState.totalTrades > 0 ? ((accountState.winCount / accountState.totalTrades) * 100).toFixed(1) : 0}%
            </span>
          </div>

          {accountState.tradeJournal.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-lg">
              No closed trades yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Qty</th>
                    <th className="py-2.5 px-3">Entry</th>
                    <th className="py-2.5 px-3">Exit</th>
                    <th className="py-2.5 px-3">Exit Reason</th>
                    <th className="py-2.5 px-3">Gross P&L</th>
                    <th className="py-2.5 px-3">Statutory Fees</th>
                    <th className="py-2.5 px-3 text-right">Net P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {accountState.tradeJournal.map((trade) => (
                    <tr key={trade.id} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 text-slate-400">{trade.exitTimestampIST}</td>
                      <td className="py-2.5 px-3 font-bold text-white">{trade.symbol}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            trade.direction === 'LONG'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}
                        >
                          {trade.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono">{trade.quantity}</td>
                      <td className="py-2.5 px-3 font-mono">₹{trade.entryPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-3 font-mono">₹{trade.exitPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-3">
                        <span className="text-[11px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">
                          {trade.exitReason}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        <span className={trade.grossPnLINR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {trade.grossPnLINR >= 0 ? '+' : ''}₹{trade.grossPnLINR.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-amber-300" title={`STT: ₹${trade.feesBreakdown.stt.toFixed(2)}, Brokerage: ₹${trade.feesBreakdown.brokerage.toFixed(2)}, GST: ₹${trade.feesBreakdown.gst.toFixed(2)}`}>
                        ₹{trade.totalFeesINR.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">
                        <span className={trade.netPnLINR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {trade.netPnLINR >= 0 ? '+' : ''}₹{trade.netPnLINR.toFixed(2)} ({trade.returnPct.toFixed(2)}%)
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
