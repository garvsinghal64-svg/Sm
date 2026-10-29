/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Layers,
  Coins,
  FileText,
  Percent,
} from 'lucide-react';
import { DecisionEngineResult, RankedOpportunity } from '../utils/opportunityRanker.ts';

interface TradePlanCardProps {
  decision: DecisionEngineResult;
  onSelectCandidate?: (opportunity: RankedOpportunity) => void;
  onDeployToPaperTrading?: (opportunity: RankedOpportunity) => void;
}

export const TradePlanCard: React.FC<TradePlanCardProps> = ({
  decision,
  onSelectCandidate,
  onDeployToPaperTrading,
}) => {
  const { verdict, verdictReason, topOpportunity, reasonsToAvoidTrading, evaluationTimestampIST } = decision;

  if (verdict === 'NO_TRADE' || !topOpportunity || !topOpportunity.tradePlan) {
    return (
      <div className="bg-slate-900 border-2 border-amber-500/40 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div>
              <span className="text-xs font-mono uppercase tracking-widest text-amber-400/80 font-semibold">
                Decision Engine Verdict
              </span>
              <h2 className="text-2xl font-black text-amber-400 tracking-tight flex items-center gap-2">
                NO TRADE
              </h2>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400 font-mono flex items-center gap-1 justify-end">
              <Clock className="w-3.5 h-3.5" /> {evaluationTimestampIST}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">
              Strict Gate: Score ≥ 65 & Approved SEBI Risk
            </span>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <div className="p-4 bg-slate-950/70 border border-slate-800/80 rounded-xl text-slate-300 text-sm leading-relaxed">
            <p className="font-semibold text-slate-200 mb-1">Gate Summary:</p>
            {verdictReason}
          </div>

          {reasonsToAvoidTrading.length > 0 && (
            <div className="p-4 bg-amber-950/20 border border-amber-900/40 rounded-xl space-y-2">
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Reasons to Avoid Trading Right Now
              </span>
              <ul className="space-y-1.5 text-xs text-amber-200/90 pl-1">
                {reasonsToAvoidTrading.map((reason, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-amber-400 font-bold">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="p-3 bg-slate-950/50 border border-slate-800/50 rounded-lg text-xs text-slate-400 flex items-center justify-between">
            <span>Capital Preservation Principle:</span>
            <span className="text-slate-300 font-mono font-medium">
              "Staying in cash is an active, valid trading decision."
            </span>
          </div>
        </div>
      </div>
    );
  }

  const { candidate, totalScore, scoreBreakdown, rankReason, tradePlan } = topOpportunity;
  const isLong = tradePlan.direction === 'LONG';

  return (
    <div className="bg-slate-900 border-2 border-emerald-500/40 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 font-bold px-2 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                Top Qualified Opportunity
              </span>
              <span className="text-xs font-mono text-slate-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> {tradePlan.signalTimestampIST}
              </span>
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight flex items-center gap-2 mt-1">
              <span>{tradePlan.name}</span>
              <span className="text-sm font-mono font-bold text-slate-400">({tradePlan.symbol})</span>
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[11px] font-mono text-slate-400 uppercase">Composite Score</span>
            <div className="text-2xl font-black text-emerald-400 font-mono">
              {totalScore}<span className="text-sm text-slate-400">/100</span>
            </div>
          </div>
          <div className={`px-4 py-2 rounded-xl border font-bold text-sm flex items-center gap-1.5 ${
            isLong
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
          }`}>
            {isLong ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span>INTRADAY {tradePlan.direction}</span>
          </div>
        </div>
      </div>

      {/* Rationale & Scoring Highlights */}
      <div className="mt-4 p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-slate-300 flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium text-slate-200">
          <strong className="text-emerald-400">Rank #1 Reason:</strong> {rankReason}
        </span>
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">
            Setup: {scoreBreakdown.setupQualityScore}/30
          </span>
          <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">
            Trend: {scoreBreakdown.trendAlignmentScore}/20
          </span>
          <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">
            Volume: {scoreBreakdown.volumeConfirmationScore}/15
          </span>
          <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">
            Momentum: {scoreBreakdown.momentumScore}/15
          </span>
        </div>
      </div>

      {/* Grid: Execution Levels & Targets */}
      <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Entry */}
        <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
            1. Proposed Entry Trigger
          </span>
          <div className="text-xl font-bold font-mono text-cyan-400">
            ₹{tradePlan.entryTriggerLevel.toFixed(2)}
          </div>
          <span className="text-[11px] text-slate-400 block mt-1 leading-tight">
            Execute on confirmed 5m bar close
          </span>
        </div>

        {/* Stop Loss */}
        <div className="p-4 bg-slate-950/80 border border-rose-900/40 rounded-xl">
          <span className="text-[11px] font-mono uppercase text-rose-400 block mb-1">
            2. Stop Loss (Mandatory)
          </span>
          <div className="text-xl font-bold font-mono text-rose-400">
            ₹{tradePlan.stopLossPrice.toFixed(2)}
          </div>
          <span className="text-[11px] text-slate-400 block mt-1 leading-tight">
            Risk: ₹{tradePlan.stopDistanceINR.toFixed(2)} / share ({tradePlan.stopMethod})
          </span>
        </div>

        {/* Target 1 */}
        <div className="p-4 bg-slate-950/80 border border-emerald-900/40 rounded-xl">
          <span className="text-[11px] font-mono uppercase text-emerald-400 block mb-1">
            3. Target 1 (50% Book)
          </span>
          <div className="text-xl font-bold font-mono text-emerald-400">
            ₹{tradePlan.target1Price.toFixed(2)}
          </div>
          <span className="text-[11px] text-slate-400 block mt-1 leading-tight">
            +₹{tradePlan.target1DistanceINR.toFixed(2)} / share (Trail stop to BE)
          </span>
        </div>

        {/* Target 2 */}
        <div className="p-4 bg-slate-950/80 border border-emerald-900/40 rounded-xl">
          <span className="text-[11px] font-mono uppercase text-emerald-400 block mb-1">
            4. Target 2 (Runner)
          </span>
          <div className="text-xl font-bold font-mono text-emerald-400">
            ₹{tradePlan.target2Price.toFixed(2)}
          </div>
          <span className="text-[11px] text-slate-400 block mt-1 leading-tight">
            +₹{tradePlan.target2DistanceINR.toFixed(2)} / share (Final Exit)
          </span>
        </div>
      </div>

      {/* Sizing, Margins & Statutory Costs */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Sizing */}
        <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Calculated Quantity:</span>
            <span className="font-mono font-bold text-white text-sm">{tradePlan.calculatedQuantity} Shares</span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Trade Notional:</span>
            <span className="font-mono text-slate-300">₹{tradePlan.positionNotionalINR.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>SEBI 5x MIS Margin (20%):</span>
            <span className="font-mono font-bold text-amber-400">₹{tradePlan.requiredMarginINR.toLocaleString('en-IN')}</span>
          </div>
        </div>

        {/* Risk & Net R:R */}
        <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Risk Budget (1% Equity):</span>
            <span className="font-mono font-bold text-rose-400">₹{tradePlan.riskAmountINR.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Gross R:R Ratio:</span>
            <span className="font-mono text-slate-300">{tradePlan.grossRiskRewardRatio.toFixed(2)} : 1</span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Net R:R (After Taxes):</span>
            <span className="font-mono font-bold text-emerald-400">{tradePlan.netRiskRewardRatio.toFixed(2)} : 1</span>
          </div>
        </div>

        {/* Statutory Taxes */}
        <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl space-y-1 text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span>Brokerage (₹20 cap):</span>
            <span className="font-mono text-slate-300">₹{tradePlan.statutoryFeeBreakdownINR.brokerageINR.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>STT (0.025% sell):</span>
            <span className="font-mono text-slate-300">₹{tradePlan.statutoryFeeBreakdownINR.sttINR.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>Total Taxes & Charges:</span>
            <span className="font-mono font-bold text-amber-400">₹{tradePlan.statutoryFeeBreakdownINR.totalStatutoryChargesINR.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Invalidation & Exit Conditions */}
      <div className="mt-4 p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Setup Invalidation & Square-Off Conditions
        </span>
        <ul className="text-xs text-slate-400 space-y-1 pl-1">
          {tradePlan.invalidationConditions.map((cond, idx) => (
            <li key={idx} className="flex items-start gap-1.5">
              <span className="text-amber-400">•</span>
              <span>{cond}</span>
            </li>
          ))}
          <li className="flex items-start gap-1.5 text-amber-300/90 font-medium">
            <span className="text-amber-400">•</span>
            <span>Mandatory Auto Square-Off: {tradePlan.exitRules.mandatorySquareOffIST}</span>
          </li>
        </ul>
      </div>

      {/* Action Buttons */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
        <span className="text-[11px] text-slate-500">
          ⚠️ Decision-support only. Always confirm candlestick close before entering.
        </span>

        <div className="flex items-center gap-2">
          {onDeployToPaperTrading && (
            <button
              onClick={() => onDeployToPaperTrading(topOpportunity)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-emerald-950/40"
            >
              <Coins className="w-4 h-4" />
              <span>Deploy to Paper Ledger</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
