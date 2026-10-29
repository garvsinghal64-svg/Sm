/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SMART INTRADAY DECISION ENGINE — OPPORTUNITY RANKER & TRADE PLAN GENERATOR
 * =========================================================================
 * Transparent cross-sectional scoring and decision-support engine.
 * Ranks all scanned candidates across the NSE universe using declared, objective rules:
 * - Setup Quality & Net R:R (0 to 30 pts)
 * - Trend Alignment with 20/50 SMA & VWAP (0 to 20 pts)
 * - Volume Confirmation vs 20-period average (0 to 15 pts)
 * - Momentum Confirmation via RSI and MACD (0 to 15 pts)
 * - Market Regime Synergy (Nifty/Bank Nifty trend alignment) (0 to 10 pts)
 * - Verified News & Catalyst Impact (0 to 10 pts)
 *
 * Produces an explicit DECISION VERDICT:
 * - 'STRONG_QUALIFIED_SETUP': Candidate scores >= 65, Net R:R >= 1.5, volume confirmed, no invalidations.
 * - 'NO_TRADE': Emitted when data is stale/missing, market is closed, choppy regime, or no setup passes threshold.
 *
 * NEVER forces a recommendation.
 */

import { SetupCandidate } from './intradayScanner.ts';
import { calculateCompliantPositionSize, PositionSizingResult, RiskManagementConfig, DEFAULT_RISK_CONFIG } from './riskManagement.ts';
import { MacroRegimeAssessment } from '../services/globalMarketData.ts';
import { VerifiedNewsItem } from '../services/newsService.ts';
import { calculateIndianEquityTradeCostBreakdown } from './predictionResearch.ts';

export interface ScoreComponentBreakdown {
  setupQualityScore: number; // max 30
  trendAlignmentScore: number; // max 20
  volumeConfirmationScore: number; // max 15
  momentumScore: number; // max 15
  regimeSynergyScore: number; // max 10
  newsCatalystScore: number; // max 10
  totalScore: number; // max 100
  scoringNotes: string[];
}

export interface RankedOpportunity {
  rank: number;
  candidate: SetupCandidate;
  scoreBreakdown: ScoreComponentBreakdown;
  totalScore: number;
  rankReason: string;
  supportingFactors: string[];
  riskFactors: string[];
  invalidationTrigger: string;
  riskEvaluation: PositionSizingResult;
  tradePlan?: IntradayTradePlan;
}

export interface IntradayTradePlan {
  symbol: string;
  name: string;
  direction: 'LONG' | 'SHORT';
  setupType: string;
  signalTimestampIST: string;
  entryTriggerLevel: number;
  entryExecutionCondition: string;
  requiresBarConfirmation: boolean;
  stopLossPrice: number;
  stopDistanceINR: number;
  stopMethod: string;
  target1Price: number;
  target2Price: number;
  target1DistanceINR: number;
  target2DistanceINR: number;
  grossRiskRewardRatio: number;
  netRiskRewardRatio: number;
  calculatedQuantity: number;
  positionNotionalINR: number;
  requiredMarginINR: number;
  riskAmountINR: number;
  riskPctOfCapital: number;
  statutoryFeeBreakdownINR: {
    brokerageINR: number;
    sttINR: number;
    exchangeAndSebiINR: number;
    gstINR: number;
    stampDutyINR: number;
    totalStatutoryChargesINR: number;
  };
  invalidationConditions: string[];
  exitRules: {
    target1Action: string;
    target2Action: string;
    stopLossAction: string;
    timeStopAction: string;
    mandatorySquareOffIST: string;
  };
}

export interface DecisionEngineResult {
  verdict: 'STRONG_QUALIFIED_SETUP' | 'NO_TRADE';
  verdictReason: string;
  evaluationTimestampIST: string;
  totalCandidatesEvaluated: number;
  eligibleTradableCount: number;
  disqualifiedIndexProxyCount: number;
  topOpportunity: RankedOpportunity | null;
  rankedOpportunities: RankedOpportunity[];
  reasonsToAvoidTrading: string[];
  macroRegimeSummary: string;
}

/**
 * Calculates deterministic score breakdown for a setup candidate.
 */
export function calculateCandidateScore(
  candidate: SetupCandidate,
  regime?: MacroRegimeAssessment,
  newsItems: VerifiedNewsItem[] = []
): ScoreComponentBreakdown {
  const notes: string[] = [];

  // 1. Setup Quality (0 to 30 pts)
  let setupQuality = 0;
  if (candidate.status === 'QUALIFIED') {
    setupQuality += 15;
    if (candidate.netRewardRiskRatio >= 2.0) {
      setupQuality += 15;
      notes.push('Excellent net R:R >= 2.0 (+30 pts)');
    } else if (candidate.netRewardRiskRatio >= 1.5) {
      setupQuality += 10;
      notes.push('Qualified net R:R >= 1.5 (+25 pts)');
    } else {
      setupQuality += 5;
      notes.push('Sub-optimal net R:R < 1.5 (+20 pts)');
    }
  } else {
    notes.push(`Disqualified: ${candidate.rejectionReason || 'Non-tradable'} (0 pts)`);
  }

  // 2. Trend Alignment (0 to 20 pts)
  let trendScore = 10; // baseline
  if (candidate.indicators.vwap) {
    if (candidate.direction === 'LONG' && candidate.entryTriggerPrice >= candidate.indicators.vwap) {
      trendScore = 20;
      notes.push('Long above session VWAP (+20 pts)');
    } else if (candidate.direction === 'SHORT' && candidate.entryTriggerPrice <= candidate.indicators.vwap) {
      trendScore = 20;
      notes.push('Short below session VWAP (+20 pts)');
    } else {
      trendScore = 5;
      notes.push('Counter-VWAP bias (+5 pts)');
    }
  }

  // 3. Volume Confirmation (0 to 15 pts)
  let volumeScore = 5;
  const volMult = candidate.indicators.volumeMultiplier ?? 1.0;
  if (volMult >= 2.0) {
    volumeScore = 15;
    notes.push(`Strong volume expansion ${volMult.toFixed(1)}x (+15 pts)`);
  } else if (volMult >= 1.2) {
    volumeScore = 10;
    notes.push(`Above average volume ${volMult.toFixed(1)}x (+10 pts)`);
  } else {
    volumeScore = 5;
    notes.push(`Subdued volume ${volMult.toFixed(1)}x (+5 pts)`);
  }

  // 4. Momentum Confirmation (0 to 15 pts)
  let momentumScore = 5;
  const rsi = candidate.indicators.rsi14;
  if (rsi !== undefined && rsi !== null) {
    if (candidate.direction === 'LONG' && rsi >= 52 && rsi <= 68) {
      momentumScore = 15;
      notes.push(`Optimal bullish RSI ${rsi.toFixed(1)} (+15 pts)`);
    } else if (candidate.direction === 'SHORT' && rsi <= 48 && rsi >= 32) {
      momentumScore = 15;
      notes.push(`Optimal bearish RSI ${rsi.toFixed(1)} (+15 pts)`);
    } else if (rsi > 75 || rsi < 25) {
      momentumScore = 2;
      notes.push(`Extreme overbought/oversold RSI ${rsi.toFixed(1)} (+2 pts)`);
    } else {
      momentumScore = 8;
      notes.push(`Neutral RSI ${rsi.toFixed(1)} (+8 pts)`);
    }
  }

  // 5. Macro Regime Synergy (0 to 10 pts)
  let regimeScore = 5;
  if (regime) {
    if (regime.niftyTrend === 'UPTREND' && candidate.direction === 'LONG') {
      regimeScore = 10;
      notes.push('Nifty uptrend beta synergy (+10 pts)');
    } else if (regime.niftyTrend === 'DOWNTREND' && candidate.direction === 'SHORT') {
      regimeScore = 10;
      notes.push('Nifty downtrend beta synergy (+10 pts)');
    } else if ((regime.niftyTrend === 'UPTREND' && candidate.direction === 'SHORT') ||
               (regime.niftyTrend === 'DOWNTREND' && candidate.direction === 'LONG')) {
      regimeScore = 2;
      notes.push('Counter-regime index divergence (+2 pts)');
    } else {
      regimeScore = 5;
      notes.push('Neutral market regime (+5 pts)');
    }
  }

  // 6. News Catalyst Impact (0 to 10 pts)
  let newsScore = 5;
  const relevantNews = newsItems.filter((n) => n.relevantSymbols.includes(candidate.symbol));
  if (relevantNews.length > 0) {
    const hasBullish = relevantNews.some((n) => n.sentiment === 'BULLISH');
    const hasBearish = relevantNews.some((n) => n.sentiment === 'BEARISH');
    if (candidate.direction === 'LONG' && hasBullish && !hasBearish) {
      newsScore = 10;
      notes.push('Verified bullish news catalyst (+10 pts)');
    } else if (candidate.direction === 'SHORT' && hasBearish && !hasBullish) {
      newsScore = 10;
      notes.push('Verified bearish headline catalyst (+10 pts)');
    } else if ((candidate.direction === 'LONG' && hasBearish) || (candidate.direction === 'SHORT' && hasBullish)) {
      newsScore = 0;
      notes.push('Conflicting news catalyst headwind (0 pts)');
    } else {
      newsScore = 5;
    }
  }

  const totalScore = setupQuality + trendScore + volumeScore + momentumScore + regimeScore + newsScore;

  return {
    setupQualityScore: setupQuality,
    trendAlignmentScore: trendScore,
    volumeConfirmationScore: volumeScore,
    momentumScore,
    regimeSynergyScore: regimeScore,
    newsCatalystScore: newsScore,
    totalScore,
    scoringNotes: notes,
  };
}

/**
 * Builds an explicit, actionable Intraday Trade Plan for a qualified candidate.
 */
export function buildIntradayTradePlan(
  candidate: SetupCandidate,
  riskEval: PositionSizingResult,
  capitalINR: number
): IntradayTradePlan {
  const entry = candidate.entryTriggerPrice;
  const stop = candidate.stopLossPrice;
  const target1 = candidate.targetPrice;
  // Second target: 1.5x of target1 distance
  const targetDist1 = Math.abs(target1 - entry);
  const target2 = candidate.direction === 'LONG'
    ? Math.round((entry + targetDist1 * 1.5) * 100) / 100
    : Math.round((entry - targetDist1 * 1.5) * 100) / 100;

  const notional = riskEval.calculatedQuantity * entry;
  const costBreakdown = calculateIndianEquityTradeCostBreakdown('CASH_EQUITY_INTRADAY_MIS', notional, notional);

  return {
    symbol: candidate.symbol,
    name: candidate.name,
    direction: candidate.direction,
    setupType: candidate.setupType,
    signalTimestampIST: candidate.signalTimestampIST,
    entryTriggerLevel: entry,
    entryExecutionCondition: `Execute at market or limit when 5m candle closes with confirmation at or above ₹${entry.toFixed(2)}.`,
    requiresBarConfirmation: true,
    stopLossPrice: stop,
    stopDistanceINR: Math.round(candidate.stopDistanceINR * 100) / 100,
    stopMethod: candidate.setupType === 'VWAP_PULLBACK' ? 'Opposite side of VWAP + 1.0 ATR buffer' : '15-minute Opening Range High/Low + 1.0 ATR buffer',
    target1Price: target1,
    target2Price: target2,
    target1DistanceINR: Math.round(targetDist1 * 100) / 100,
    target2DistanceINR: Math.round(Math.abs(target2 - entry) * 100) / 100,
    grossRiskRewardRatio: candidate.grossRiskRewardRatio,
    netRiskRewardRatio: candidate.netRewardRiskRatio,
    calculatedQuantity: riskEval.calculatedQuantity,
    positionNotionalINR: Math.round(notional),
    requiredMarginINR: riskEval.marginRequiredINR,
    riskAmountINR: riskEval.riskBudgetINR,
    riskPctOfCapital: Math.round(((riskEval.riskBudgetINR) / capitalINR) * 10000) / 100,
    statutoryFeeBreakdownINR: {
      brokerageINR: costBreakdown.roundTripTotal.brokerageINR,
      sttINR: costBreakdown.roundTripTotal.sttINR,
      exchangeAndSebiINR: Math.round((costBreakdown.roundTripTotal.exchangeTransactionChargesINR + costBreakdown.roundTripTotal.sebiChargesINR) * 100) / 100,
      gstINR: costBreakdown.roundTripTotal.gstINR,
      stampDutyINR: costBreakdown.roundTripTotal.stampDutyINR,
      totalStatutoryChargesINR: costBreakdown.roundTripTotal.totalCostINR,
    },
    invalidationConditions: [
      candidate.invalidationCondition,
      '5m candle closes opposite to trade direction with volume > 2x average',
      'Time reaches 15:00 IST without triggering entry',
    ],
    exitRules: {
      target1Action: `At ₹${target1.toFixed(2)}, book 50% profit and trail stop loss to break-even (₹${entry.toFixed(2)}).`,
      target2Action: `At ₹${target2.toFixed(2)}, liquidate remaining 50% position.`,
      stopLossAction: `If price breaches ₹${stop.toFixed(2)}, execute market stop immediately. Do not hold hope.`,
      timeStopAction: 'If position is flat after 60 minutes with low volume, square off at market.',
      mandatorySquareOffIST: '15:15:00 IST (Broker MIS automated intraday liquidation).',
    },
  };
}

/**
 * Cross-sectionally evaluates and ranks all candidates, selecting the single best
 * opportunity or returning 'NO_TRADE'.
 */
export function rankIntradayOpportunities(
  candidates: SetupCandidate[],
  options: {
    accountEquityINR?: number;
    availableCashINR?: number;
    currentOpenPositions?: number;
    dailyRealizedLossINR?: number;
    riskConfig?: RiskManagementConfig;
    regime?: MacroRegimeAssessment;
    newsItems?: VerifiedNewsItem[];
    isMarketOpen?: boolean;
  } = {}
): DecisionEngineResult {
  const equity = options.accountEquityINR ?? 100000;
  const cash = options.availableCashINR ?? equity;
  const openPos = options.currentOpenPositions ?? 0;
  const lossToday = options.dailyRealizedLossINR ?? 0;
  const riskCfg = options.riskConfig ?? DEFAULT_RISK_CONFIG;
  const isMarketOpen = options.isMarketOpen ?? true;

  const reasonsToAvoid: string[] = [];

  if (!isMarketOpen) {
    reasonsToAvoid.push('Indian markets are currently closed (Regular trading hours: 09:15 to 15:30 IST).');
  }

  if (candidates.length === 0) {
    reasonsToAvoid.push('No technical setups detected across the scanned universe.');
  }

  const eligibleCandidates = candidates.filter((c) => c.isTradableCashEquity);
  const disqualifiedProxies = candidates.filter((c) => !c.isTradableCashEquity);

  const ranked: RankedOpportunity[] = [];

  for (const cand of eligibleCandidates) {
    const scoreBreakdown = calculateCandidateScore(cand, options.regime, options.newsItems);

    // Calculate compliant risk-sized quantity
    const riskEval = calculateCompliantPositionSize(
      cand.entryTriggerPrice,
      cand.stopLossPrice,
      cand.targetPrice,
      cand.direction,
      equity,
      cash,
      openPos,
      lossToday,
      riskCfg
    );

    const supporting: string[] = [];
    const risks: string[] = [];

    if (cand.netRewardRiskRatio >= 1.5) {
      supporting.push(`Favorable statutory net reward/risk ratio (${cand.netRewardRiskRatio.toFixed(2)}:1 after fees)`);
    } else {
      risks.push(`Low net reward/risk (${cand.netRewardRiskRatio.toFixed(2)}:1) after statutory Indian costs`);
    }

    if ((cand.indicators.volumeMultiplier ?? 1) >= 1.5) {
      supporting.push(`Volume surge ${(cand.indicators.volumeMultiplier ?? 1).toFixed(1)}x confirms institutional interest`);
    } else {
      risks.push('Low relative volume; setup lacks aggressive participation');
    }

    if (cand.setupType === 'VWAP_PULLBACK') {
      supporting.push('Mean-reversion pullback to session VWAP offers asymmetric stop location');
    } else if (cand.setupType === 'OPENING_RANGE_BREAKOUT') {
      supporting.push('Breakout above/below initial 15-minute range indicates directional momentum');
    }

    let tradePlan: IntradayTradePlan | undefined;
    if (cand.status === 'QUALIFIED' && riskEval.isApproved && riskEval.calculatedQuantity > 0) {
      tradePlan = buildIntradayTradePlan(cand, riskEval, equity);
    }

    ranked.push({
      rank: 0, // set after sorting
      candidate: cand,
      scoreBreakdown,
      totalScore: scoreBreakdown.totalScore,
      rankReason: `Composite Score: ${scoreBreakdown.totalScore}/100. ${scoreBreakdown.scoringNotes.slice(0, 2).join('. ')}.`,
      supportingFactors: supporting,
      riskFactors: risks,
      invalidationTrigger: cand.invalidationCondition,
      riskEvaluation: riskEval,
      tradePlan,
    });
  }

  // Sort descending by total score
  ranked.sort((a, b) => b.totalScore - a.totalScore);
  ranked.forEach((item, idx) => {
    item.rank = idx + 1;
  });

  const nowIST = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + ' IST';

  // Evaluate Top Opportunity against Qualification Threshold (Score >= 65 and Approved Risk)
  const topCandidate = ranked.length > 0 ? ranked[0] : null;

  let verdict: 'STRONG_QUALIFIED_SETUP' | 'NO_TRADE' = 'NO_TRADE';
  let verdictReason = 'No setups qualified above the strict 65/100 composite threshold or met SEBI risk requirements.';

  if (!isMarketOpen) {
    verdict = 'NO_TRADE';
    verdictReason = 'NO TRADE: Indian markets are currently closed. Intraday execution is only valid between 09:15 and 15:15 IST.';
  } else if (topCandidate && topCandidate.totalScore >= 65 && topCandidate.tradePlan && topCandidate.riskEvaluation.isApproved) {
    verdict = 'STRONG_QUALIFIED_SETUP';
    verdictReason = `QUALIFIED: ${topCandidate.candidate.symbol} achieved top composite score (${topCandidate.totalScore}/100) with verified net R:R ${topCandidate.candidate.netRewardRiskRatio.toFixed(2)} and fully compliant SEBI margin sizing.`;
  } else {
    verdict = 'NO_TRADE';
    if (topCandidate && topCandidate.totalScore < 65) {
      reasonsToAvoid.push(`Top candidate (${topCandidate.candidate.symbol}) scored ${topCandidate.totalScore}/100, which is below the mandatory 65-point entry gate.`);
    }
    if (topCandidate && !topCandidate.riskEvaluation.isApproved) {
      reasonsToAvoid.push(`Top setup rejected by risk manager: ${topCandidate.riskEvaluation.rejectionReason}`);
    }
  }

  return {
    verdict,
    verdictReason,
    evaluationTimestampIST: nowIST,
    totalCandidatesEvaluated: candidates.length,
    eligibleTradableCount: eligibleCandidates.length,
    disqualifiedIndexProxyCount: disqualifiedProxies.length,
    topOpportunity: verdict === 'STRONG_QUALIFIED_SETUP' ? topCandidate : null,
    rankedOpportunities: ranked,
    reasonsToAvoidTrading: reasonsToAvoid,
    macroRegimeSummary: options.regime?.keyTakeaway || 'Neutral market regime.',
  };
}
