/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Newspaper,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Search,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Clock,
  Tag,
  Building,
} from 'lucide-react';
import {
  VerifiedNewsItem,
  NewsFeedResult,
  fetchLiveMarketNews,
  createDeterministicNewsFixture,
  NewsEventCategory,
  SentimentImpact,
} from '../services/newsService.ts';

export const MarketNewsView: React.FC = () => {
  const [newsResult, setNewsResult] = useState<NewsFeedResult>({
    status: 'OFFLINE_FIXTURE',
    fetchedAtIST: '2026-10-29 15:30:00 IST',
    totalItems: 6,
    uniqueCount: 6,
    deduplicatedCount: 0,
    items: createDeterministicNewsFixture(),
  });
  const [searchQuery, setSearchQuery] = useState<string>('Indian Stock Market NSE Nifty Sensex');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedSentiment, setSelectedSentiment] = useState<string>('ALL');
  const [isLiveMode, setIsLiveMode] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const loadNews = async (live: boolean, query: string) => {
    setIsLoading(true);
    if (!live) {
      const fixtureItems = createDeterministicNewsFixture();
      setNewsResult({
        status: 'OFFLINE_FIXTURE',
        fetchedAtIST: '2026-10-29 15:30:00 IST',
        totalItems: fixtureItems.length,
        uniqueCount: fixtureItems.length,
        deduplicatedCount: 0,
        items: fixtureItems,
      });
      setIsLoading(false);
      return;
    }

    const res = await fetchLiveMarketNews(query);
    setNewsResult(res);
    setIsLoading(false);
  };

  useEffect(() => {
    loadNews(isLiveMode, searchQuery);
  }, [isLiveMode]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadNews(isLiveMode, searchQuery);
  };

  // Filter items by category & sentiment
  const filteredItems = newsResult.items.filter((item) => {
    if (selectedCategory !== 'ALL' && item.category !== selectedCategory) {
      return false;
    }
    if (selectedSentiment !== 'ALL' && item.sentiment !== selectedSentiment) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-900 border border-slate-800 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400">
            <Newspaper className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <span>Financial News & Macro Intelligence</span>
              <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                newsResult.status === 'LIVE_VERIFIED'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : newsResult.status === 'OFFLINE_FIXTURE'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}>
                {newsResult.status.replace(/_/g, ' ')}
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Verified RSS feeds with rule-based sentiment reasoning & zero black-box hallucinations
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsLiveMode(!isLiveMode)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 transition"
          >
            Switch to {isLiveMode ? 'Offline Fixture' : 'Live RSS Feed'}
          </button>
          <button
            onClick={() => loadNews(isLiveMode, searchQuery)}
            disabled={isLoading}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-xs font-bold text-white rounded-lg flex items-center gap-1.5 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {newsResult.error && (
        <div className="p-4 bg-rose-950/30 border border-rose-900/50 rounded-xl text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{newsResult.error}</span>
        </div>
      )}

      {/* Search & Category Filter Bar */}
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Indian market news (e.g. Nifty, Reliance, Quarterly results, SEBI)..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white rounded-xl transition"
          >
            Search
          </button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
          {/* Categories */}
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-slate-500 mr-1">Category:</span>
            {['ALL', 'EARNINGS_RESULTS', 'CONTRACT_ORDER_WIN', 'REGULATORY_SEBI', 'MACRO_ECONOMIC', 'GENERAL_MARKET'].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2 py-0.5 rounded-md font-mono transition ${
                  selectedCategory === cat
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                {cat.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          {/* Sentiment Filter */}
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-slate-500 mr-1">Sentiment:</span>
            {['ALL', 'BULLISH', 'BEARISH', 'NEUTRAL', 'MIXED'].map((s) => (
              <button
                key={s}
                onClick={() => setSelectedSentiment(s)}
                className={`px-2 py-0.5 rounded-md font-mono transition ${
                  selectedSentiment === s
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                    : 'bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* News Articles List */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-400 text-sm">
            No headlines match the selected category/sentiment filter.
          </div>
        ) : (
          filteredItems.map((item) => (
            <div
              key={item.id}
              className="p-4 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-2xl transition space-y-2.5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                    item.sentiment === 'BULLISH'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : item.sentiment === 'BEARISH'
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                      : item.sentiment === 'MIXED'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}>
                    {item.sentiment}
                  </span>

                  <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/40 border border-cyan-800/50 px-2 py-0.5 rounded-md">
                    {item.category.replace(/_/g, ' ')}
                  </span>

                  {item.relevantSymbols.map((sym) => (
                    <span key={sym} className="text-[10px] font-mono text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded">
                      {sym}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {item.pubDateIST}
                  </span>
                  <span>•</span>
                  <span className="text-slate-400 font-medium">{item.source}</span>
                </div>
              </div>

              {/* Headline */}
              <h3 className="text-sm font-semibold text-white leading-snug hover:text-cyan-300 transition">
                {item.sourceUrl ? (
                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5">
                    <span>{item.title}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-500 shrink-0 inline" />
                  </a>
                ) : (
                  item.title
                )}
              </h3>

              {/* Rationale & Keyword Evidence */}
              <div className="p-2.5 bg-slate-950/80 border border-slate-800/80 rounded-xl text-xs space-y-1">
                <div className="flex items-start gap-1.5 text-slate-400">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                  <span className="leading-tight">
                    <strong className="text-slate-300">Evidence Rationale:</strong> {item.reasoning}
                  </span>
                </div>
                {item.evidenceKeywords.length > 0 && (
                  <div className="text-[11px] font-mono text-slate-500 pl-5">
                    Keywords: {item.evidenceKeywords.join(' • ')}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
