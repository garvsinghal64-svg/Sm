/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Globe,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Compass,
  Layers,
  Fuel,
  Coins,
  DollarSign,
  AlertCircle,
  HelpCircle,
  ChevronRight,
  Shield,
  Clock,
} from 'lucide-react';
import {
  MacroIndicatorItem,
  MacroRegimeAssessment,
  fetchMacroIndicator,
  createDeterministicMacroFixture,
  assessMacroRegime,
  MACRO_INSTRUMENTS_CONFIG,
} from '../services/globalMarketData.ts';

export const GlobalMarketContextView: React.FC = () => {
  const [indicators, setIndicators] = useState<MacroIndicatorItem[]>(createDeterministicMacroFixture());
  const [regime, setRegime] = useState<MacroRegimeAssessment>(assessMacroRegime(indicators));
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLiveMode, setIsLiveMode] = useState<boolean>(false);
  const [selectedIndicator, setSelectedIndicator] = useState<MacroIndicatorItem | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadData = async (live: boolean) => {
    setIsLoading(true);
    setFetchError(null);

    if (!live) {
      const fix = createDeterministicMacroFixture();
      setIndicators(fix);
      setRegime(assessMacroRegime(fix));
      setIsLoading(false);
      return;
    }

    try {
      // Fetch all indicators in parallel
      const results = await Promise.all(
        MACRO_INSTRUMENTS_CONFIG.map((cfg) => fetchMacroIndicator(cfg))
      );
      setIndicators(results);
      setRegime(assessMacroRegime(results));
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to fetch live macro feeds');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(isLiveMode);
  }, [isLiveMode]);

  const commodities = indicators.filter((i) => i.category === 'COMMODITY');
  const currencies = indicators.filter((i) => i.category === 'CURRENCY');
  const globalIndices = indicators.filter((i) => i.category === 'GLOBAL_INDEX');
  const domesticIndices = indicators.filter((i) => i.category === 'DOMESTIC_BENCHMARK');

  return (
    <div className="space-y-6">
      {/* Top Header & Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-900 border border-slate-800 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400">
            <Globe className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <span>Global Macro & Transmission Engine</span>
              <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                isLiveMode
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}>
                {isLiveMode ? 'LIVE YAHOO FEED' : 'OFFLINE FIXTURE'}
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Gold, Silver, Crude Oil, USD/INR, and World Equities transmission to Indian stocks
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsLiveMode(!isLiveMode)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 transition"
          >
            Switch to {isLiveMode ? 'Offline Fixture' : 'Live Yahoo Feed'}
          </button>
          <button
            onClick={() => loadData(isLiveMode)}
            disabled={isLoading}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-bold text-white rounded-lg flex items-center gap-1.5 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="p-4 bg-rose-950/30 border border-rose-900/50 rounded-xl text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{fetchError} (Showing last verified points; zero fabricated values).</span>
        </div>
      )}

      {/* Market Regime Assessment Card */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
              Macroeconomic Market Regime
            </span>
            <div className="flex items-center gap-2.5 mt-0.5">
              <span className={`text-xl font-black font-mono tracking-tight ${
                regime.overallRegime === 'RISK_ON_BULLISH'
                  ? 'text-emerald-400'
                  : regime.overallRegime === 'RISK_OFF_BEARISH'
                  ? 'text-rose-400'
                  : 'text-amber-400'
              }`}>
                {regime.overallRegime.replace(/_/g, ' ')}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 font-mono text-slate-300">
                Confidence: {regime.confidenceScorePct}%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs font-mono">
            <div className="p-2 bg-slate-950 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 text-[10px] block">NIFTY TREND</span>
              <span className={`font-bold ${
                regime.niftyTrend === 'UPTREND' ? 'text-emerald-400' : regime.niftyTrend === 'DOWNTREND' ? 'text-rose-400' : 'text-slate-300'
              }`}>
                {regime.niftyTrend}
              </span>
            </div>
            <div className="p-2 bg-slate-950 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 text-[10px] block">CRUDE PRESSURE</span>
              <span className={`font-bold ${
                regime.crudePressure === 'ELEVATED_HEADWIND' ? 'text-rose-400' : regime.crudePressure === 'BENIGN_TAILWIND' ? 'text-emerald-400' : 'text-slate-300'
              }`}>
                {regime.crudePressure.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="p-2 bg-slate-950 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 text-[10px] block">USD/INR</span>
              <span className="font-bold text-slate-300">
                {regime.currencyPressure.replace(/_/g, ' ')}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3 text-xs text-slate-300 bg-slate-950/50 p-3 rounded-xl border border-slate-800/60 leading-relaxed">
          <strong className="text-slate-200">System Assessment:</strong> {regime.keyTakeaway}
        </div>
      </div>

      {/* Grid of Indicators by Category */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Commodities */}
        <div className="space-y-3">
          <h3 className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <Fuel className="w-4 h-4" /> Energy & Metals
          </h3>
          <div className="space-y-2">
            {commodities.map((item) => (
              <IndicatorCard
                key={item.symbol}
                item={item}
                isSelected={selectedIndicator?.symbol === item.symbol}
                onSelect={() => setSelectedIndicator(item)}
              />
            ))}
          </div>
        </div>

        {/* Currency */}
        <div className="space-y-3">
          <h3 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <DollarSign className="w-4 h-4" /> Foreign Exchange
          </h3>
          <div className="space-y-2">
            {currencies.map((item) => (
              <IndicatorCard
                key={item.symbol}
                item={item}
                isSelected={selectedIndicator?.symbol === item.symbol}
                onSelect={() => setSelectedIndicator(item)}
              />
            ))}
          </div>
        </div>

        {/* Global Equities */}
        <div className="space-y-3">
          <h3 className="text-xs font-mono font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
            <Globe className="w-4 h-4" /> World Benchmarks
          </h3>
          <div className="space-y-2">
            {globalIndices.map((item) => (
              <IndicatorCard
                key={item.symbol}
                item={item}
                isSelected={selectedIndicator?.symbol === item.symbol}
                onSelect={() => setSelectedIndicator(item)}
              />
            ))}
          </div>
        </div>

        {/* Domestic Benchmarks */}
        <div className="space-y-3">
          <h3 className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
            <Compass className="w-4 h-4" /> Indian Benchmarks
          </h3>
          <div className="space-y-2">
            {domesticIndices.map((item) => (
              <IndicatorCard
                key={item.symbol}
                item={item}
                isSelected={selectedIndicator?.symbol === item.symbol}
                onSelect={() => setSelectedIndicator(item)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Selected Indicator Transmission Details Modal / Expandable Card */}
      {selectedIndicator && (
        <div className="p-5 bg-slate-900 border-2 border-blue-500/40 rounded-2xl shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">{selectedIndicator.name}</span>
              <span className="text-xs font-mono text-slate-400">({selectedIndicator.symbol})</span>
            </div>
            <button
              onClick={() => setSelectedIndicator(null)}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800"
            >
              Close Details
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
              <span className="font-semibold text-blue-400 uppercase tracking-wider block">
                Macro Relevance to Indian Economy
              </span>
              <p className="text-slate-300 leading-relaxed">{selectedIndicator.relevanceToIndia}</p>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
              <span className="font-semibold text-emerald-400 uppercase tracking-wider block">
                Transmission Mechanism to Stocks
              </span>
              <p className="text-slate-300 leading-relaxed">{selectedIndicator.transmissionMechanism}</p>
            </div>
          </div>

          {selectedIndicator.affectedSectors.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block">
                Sector-Specific Impact Matrix
              </span>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {selectedIndicator.affectedSectors.map((sec, idx) => (
                  <div key={idx} className="p-3 bg-slate-950 rounded-lg border border-slate-800/80 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200 text-xs">{sec.sector}</span>
                      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        sec.impactDirection === 'FAVORABLE'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : sec.impactDirection === 'UNFAVORABLE'
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {sec.impactDirection}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-tight">{sec.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const IndicatorCard: React.FC<{
  item: MacroIndicatorItem;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ item, isSelected, onSelect }) => {
  const isUp = (item.changePercent ?? 0) >= 0;
  const isUnavailable = item.freshness === 'UNAVAILABLE' || item.latestPrice === null;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3.5 rounded-xl border transition-all ${
        isSelected
          ? 'bg-blue-950/30 border-blue-500/60 shadow-lg'
          : 'bg-slate-900 hover:bg-slate-850 border-slate-800'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-200 truncate pr-2">{item.name}</span>
        <span className="text-[10px] font-mono text-slate-500 shrink-0">{item.symbol}</span>
      </div>

      <div className="mt-2 flex items-baseline justify-between">
        <div className="text-base font-bold font-mono text-white">
          {isUnavailable ? (
            <span className="text-xs text-rose-400">UNAVAILABLE</span>
          ) : (
            <>
              {item.latestPrice?.toLocaleString('en-IN')}{' '}
              <span className="text-[10px] text-slate-400 font-normal">{item.currency}</span>
            </>
          )}
        </div>

        {!isUnavailable && item.changePercent !== null && (
          <div className={`text-xs font-mono font-bold flex items-center gap-0.5 ${
            isUp ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{isUp ? '+' : ''}{item.changePercent.toFixed(2)}%</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1.5 border-t border-slate-800/60">
        <span>{item.freshness}</span>
        <span className="text-blue-400 flex items-center gap-0.5">
          Transmission <ChevronRight className="w-2.5 h-2.5" />
        </span>
      </div>
    </button>
  );
};
