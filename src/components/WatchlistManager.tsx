/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Star,
  CheckCircle2,
  Trash2,
  RotateCcw,
  BarChart2,
  ShieldCheck,
  TrendingUp,
  SlidersHorizontal,
  Bookmark,
  Layers,
} from 'lucide-react';
import {
  SUPPORTED_INSTRUMENTS,
  InstrumentConfig,
} from '../services/marketDataProvider.ts';
import { useWatchlist } from '../utils/watchlist.ts';

interface WatchlistManagerProps {
  onSelectInstrumentForChart?: (symbol: string) => void;
}

export function WatchlistManager({ onSelectInstrumentForChart }: WatchlistManagerProps) {
  const { watchlist, isInWatchlist, toggleSymbol, resetToDefault } = useWatchlist();
  const [filterMode, setFilterMode] = useState<'WATCHLIST' | 'ALL'>('WATCHLIST');

  const displayedInstruments = filterMode === 'WATCHLIST'
    ? SUPPORTED_INSTRUMENTS.filter((i) => isInWatchlist(i.symbol))
    : SUPPORTED_INSTRUMENTS;

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-400 border border-amber-800/60">
                <Bookmark className="w-3 h-3 text-amber-400" />
                Stage 3: Local Watchlist
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                Saved on Device
              </span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Personal Market Watchlist
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Pin and organize your active instruments. Preferences are saved automatically to your browser/Android local storage.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-950/80 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setFilterMode('WATCHLIST')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  filterMode === 'WATCHLIST'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Watchlist ({watchlist.length})
              </button>
              <button
                onClick={() => setFilterMode('ALL')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  filterMode === 'ALL'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All Supported ({SUPPORTED_INSTRUMENTS.length})
              </button>
            </div>

            <button
              onClick={resetToDefault}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-750 border border-slate-700 rounded-lg transition-colors"
              title="Reset to default watchlist"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          </div>
        </div>
      </div>

      {/* Instruments Grid / Cards */}
      {displayedInstruments.length === 0 ? (
        <div className="bg-slate-900 border border-dashed border-slate-800 rounded-xl p-8 text-center">
          <Star className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-slate-300">Your Watchlist is Empty</h3>
          <p className="text-xs text-slate-500 mt-1 mb-4">
            You haven't pinned any instruments yet. Browse all supported symbols and star your favorites.
          </p>
          <button
            onClick={() => setFilterMode('ALL')}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors"
          >
            Browse All 7 Instruments
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedInstruments.map((inst) => {
            const isSaved = isInWatchlist(inst.symbol);
            return (
              <div
                key={inst.symbol}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all shadow-md flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded uppercase bg-slate-800 text-slate-300 border border-slate-700">
                        {inst.exchange} &bull; {inst.type}
                      </span>
                      <h4 className="text-base font-bold text-white mt-1.5 leading-snug">
                        {inst.name}
                      </h4>
                      <span className="text-xs font-mono text-cyan-400">
                        {inst.symbol}
                      </span>
                    </div>

                    <button
                      onClick={() => toggleSymbol(inst.symbol)}
                      aria-label={isSaved ? `Remove ${inst.name} from watchlist` : `Add ${inst.name} to watchlist`}
                      className={`p-2 rounded-lg border transition-all ${
                        isSaved
                          ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 hover:bg-amber-500/20'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
                      }`}
                    >
                      <Star className={`w-4 h-4 ${isSaved ? 'fill-amber-400' : ''}`} />
                    </button>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500">
                    {isSaved ? 'In Watchlist' : 'Not Watchlisted'}
                  </span>

                  {onSelectInstrumentForChart && (
                    <button
                      onClick={() => onSelectInstrumentForChart(inst.symbol)}
                      className="flex items-center gap-1.5 px-3 py-1 bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 text-xs font-semibold rounded-lg border border-cyan-800 transition-colors"
                    >
                      <BarChart2 className="w-3.5 h-3.5" />
                      <span>Open Chart</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
