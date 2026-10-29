/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * STAGE 4A & 4A.1 — HISTORICAL PREDICTION RESEARCH PIPELINE & BACKTEST AUDIT ENGINE
 * =================================================================================
 * Strictly research-only, reproducible time-series dataset builder, leakage-free
 * training preprocessor, transparent baseline models, and risk-aware evaluation engine.
 *
 * IMPORTANT CONSTRAINTS & DISCLOSURES:
 * - Does NOT output buy/sell calls or live entry/target/stop-loss trading recommendations.
 * - Does NOT claim predictive accuracy or profitability.
 * - Never fabricates missing market data or assumes Yahoo Finance provides verified official closes.
 * - Calculates all features strictly from causal prefix slices (0..cutoffIndex) so future
 *   observations cannot mathematically influence earlier features or fitted preprocessing.
 */

import {
  HistoricalSeries,
  HistoricalCandle,
  CalendarDateStatus,
  CandleFormationStatus,
  formatISTDateOnly,
  classifyExchangeCalendarDate,
  auditHistoricalSessionCalendar,
  SUPPORTED_INSTRUMENTS,
} from '../services/historicalData.ts';
import { formatISTTime } from '../services/marketDataProvider.ts';
import {
  calculateSMA,
  calculateRSI,
  calculateMACD,
} from './indicators.ts';
import {
  TimeSeriesRecord,
  splitChronologically,
  verifyNoLookaheadLeakage,
  verifyNoWindowOverlap,
  assertTemporalIntegrity,
} from './dataLeakageAudit.ts';

export type ForecastDirection = 'UP' | 'DOWN' | 'FLAT';

export type ExecutionPriceBasis =
  | 'INTRADAY_NEXT_OPEN_TO_CLOSE'
  | 'MULTI_DAY_POSITION'
  | 'NEXT_OPEN_TO_CLOSE'
  | 'CLOSE_TO_CLOSE';

export type InstrumentTradabilityClass =
  | 'NON_TRADABLE_SPOT_INDEX_PROXY'
  | 'CASH_EQUITY_LONG_ONLY_ELIGIBLE';

export const FEATURE_NAMES = [
  'return1dPct',
  'return5dPct',
  'sma20DistancePct',
  'sma50DistancePct',
  'sma20OverSma50Pct',
  'rsi14',
  'macdHistogramPct',
  'intradayRangePct',
  'volatility5dPct',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export type FeatureMap = Record<FeatureName, number>;

export interface ObservationCandleSnapshot {
  timestamp: number;
  dateString: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number | null;
  volume: number | null;
}

export interface ObservationMissingDataFlags {
  hasMissingInLookbackWindow: boolean;
  hasMissingInTargetHorizon: boolean;
  isPredictionCandleIncompleteIntraday: boolean;
  isCalendarUnverified: boolean;
  hasAdjustedCloseDivergence: boolean;
  adjustmentRatioSpreadPct: number | null;
  hasTargetHorizonDividendEvent: boolean;
  targetDividendAdjustmentPct: number | null;
}

export interface ObservationProvenance {
  provider: string;
  fetchedAt: number;
  fetchedAtIST: string;
  isOfficialCloseVerified: boolean;
  candleFormationStatus: CandleFormationStatus;
  latestCandleFormationLabel: string;
}

export interface PredictionResearchObservation extends TimeSeriesRecord {
  symbol: string;
  exchange: 'NSE' | 'BSE';
  instrumentType: 'INDEX' | 'EQUITY';
  timestamp: number; // Prediction cutoff timestamp (ms)
  predictionDateIST: string; // YYYY-MM-DD in IST
  windowStartTimestamp: number;
  windowEndTimestamp: number;
  lookbackWindowLength: number;
  availableWindowCandles: ObservationCandleSnapshot[];
  features: FeatureMap;
  featureValues: number[];
  forecastHorizonSessions: number;
  targetTimestamp: number;
  targetDateIST: string;
  targetWindowTimestamps: number[];
  currentClose: number;
  nextSessionOpen: number;
  targetClose: number;
  targetValue: number; // targetReturnPct (close-to-close split-adjusted price return)
  targetReturnPct: number; // (targetClose - currentClose) / currentClose * 100
  targetTotalReturnAdjClosePct: number | null; // (targetAdjClose - currentAdjClose) / currentAdjClose * 100
  overnightGapReturnPct: number; // (nextSessionOpen - currentClose) / currentClose * 100
  openToTargetReturnPct: number; // (targetClose - nextSessionOpen) / nextSessionOpen * 100
  targetDirection: ForecastDirection;
  targetValues: number[];
  calendarStatus: CalendarDateStatus;
  missingDataFlags: ObservationMissingDataFlags;
  priceAdjustmentBasis: 'SPLIT_ADJUSTED_UNADJUSTED_DIVIDEND';
  priceAdjustmentDisclosure: string;
  sourceProvenance: ObservationProvenance;
}

export interface DatasetBuildOptions {
  forecastHorizonSessions?: number; // Default: 1 trading session ahead
  minLookbackCandles?: number; // Default: 50 candles (required for SMA 50 & MACD 26/9)
  excludeUnverifiedCalendarDates?: boolean; // Default: false (flagged via isCalendarUnverified)
  excludeAdjustedPriceDivergence?: boolean; // Default: false (flagged via hasAdjustedCloseDivergence)
  adjustedDivergenceThresholdPct?: number; // Default: 0.5% spread between adjClose/close ratios in window
  excludeTargetDividendEvents?: boolean; // Default: false (flagged via hasTargetHorizonDividendEvent)
  targetDividendThresholdPct?: number; // Default: 0.05% shift in adjClose/close across target horizon
}

export interface DatasetExclusionSummary {
  insufficientLookbackWarmup: number;
  insufficientFutureHorizon: number;
  incompleteIntradayBars: number;
  missingOrInvalidLookbackCandles: number;
  missingOrInvalidTargetCandles: number;
  unverifiedCalendarDatesExcluded: number;
  adjustedPriceDivergenceExcluded: number;
  targetDividendEventsExcluded: number;
}

export interface HistoricalPredictionDataset {
  symbol: string;
  exchange: 'NSE' | 'BSE';
  instrumentType: 'INDEX' | 'EQUITY';
  forecastHorizonSessions: number;
  minLookbackCandles: number;
  totalRawCandles: number;
  usableObservations: PredictionResearchObservation[];
  verifiedCalendarObservationCount: number;
  unverifiedCalendarObservationCount: number;
  adjustedPriceDivergenceCount: number;
  targetDividendEventCount: number;
  exclusions: DatasetExclusionSummary;
  priceAdjustmentBasis: 'SPLIT_ADJUSTED_UNADJUSTED_DIVIDEND';
  priceAdjustmentDisclosure: string;
  dataSource: string;
}

export interface MultiInstrumentPredictionDataset {
  instrumentCount: number;
  symbols: string[];
  forecastHorizonSessions: number;
  minLookbackCandles: number;
  totalRawCandlesAcrossInstruments: number;
  totalUsableObservations: number;
  datasetsBySymbol: Record<string, HistoricalPredictionDataset>;
  aggregatedExclusions: DatasetExclusionSummary;
}

export interface FittedFeaturePreprocessor {
  featureNames: FeatureName[];
  selectedFeatureNames: FeatureName[];
  selectedFeatureIndices: number[];
  means: Record<FeatureName, number>;
  stdDevs: Record<FeatureName, number>;
  mins: Record<FeatureName, number>;
  maxs: Record<FeatureName, number>;
  fitSampleCount: number;
  fitMinTimestamp: number;
  fitMaxTimestamp: number;
  varianceThreshold: number;
}

export interface ScaledObservation<T extends PredictionResearchObservation = PredictionResearchObservation> {
  observation: T;
  scaledFeatures: Record<FeatureName, number>;
  selectedFeatureVector: number[];
}

export interface ResearchSplitPipelineResult {
  train: PredictionResearchObservation[];
  validation: PredictionResearchObservation[];
  test: PredictionResearchObservation[];
  scaledTrain: ScaledObservation[];
  scaledValidation: ScaledObservation[];
  scaledTest: ScaledObservation[];
  preprocessor: FittedFeaturePreprocessor;
  purgedRecordCount: number;
  trainCutoffTimestamp: number;
  valCutoffTimestamp: number;
  isStrictlyChronological: boolean;
  hasOverlappingWindows: boolean;
  hasMissingObservations: boolean;
}

export interface BaselinePredictionPoint {
  symbol: string;
  predictionTimestamp: number;
  predictionDateIST: string;
  targetTimestamp: number;
  targetDateIST: string;
  forecastHorizonSessions: number;
  currentClose: number;
  nextSessionOpen?: number;
  actualTargetClose: number;
  actualReturnPct: number;
  overnightGapReturnPct?: number;
  openToTargetReturnPct?: number;
  actualDirection: ForecastDirection;
  predictedTargetClose: number;
  predictedReturnPct: number;
  predictedDirection: ForecastDirection;
  positionSignal: -1 | 0 | 1;
  positionSize?: number; // Optional continuous/partial notional position in [-1, 1] (defaults to positionSignal)
  baselineModelName: string;
  ruleExplanation: string;
}

export type CostComponentRateClassification =
  | 'STATUTORY_VERIFIED'
  | 'EXCHANGE_REGULATED_VERIFIED'
  | 'BROKER_DEPENDENT_CONFIGURABLE'
  | 'EMPIRICAL_ESTIMATE_CONFIGURABLE';

export interface IndianCostComponentProvenance {
  component:
    | 'brokerage'
    | 'stt'
    | 'exchangeTransactionCharges'
    | 'sebiCharges'
    | 'gst'
    | 'stampDuty'
    | 'dpCharges'
    | 'estimatedSlippage';
  classification: CostComponentRateClassification;
  isVerifiedExactRate: boolean;
  isConfigurable: boolean;
  applicableSide: 'BUY_ONLY' | 'SELL_ONLY' | 'BOTH_BUY_AND_SELL' | 'NONE';
  rateSummary: string;
  authoritySource: string;
  effectiveDate: string;
  instrumentScope: string;
  assumptions: string;
}

export interface SideSpecificCostBpsSchedule {
  side: 'BUY' | 'SELL';
  brokerageBps: number;
  sttBps: number;
  exchangeTransactionChargesBps: number;
  sebiChargesBps: number;
  dpChargesBps: number;
  gstBps: number;
  stampDutyBps: number;
  slippageBps: number;
  totalStatutoryAndExchangeBps: number;
  totalCostBps: number;
}

export interface IndianMarketCostPresetOptions {
  referenceNotionalINR?: number; // Default: ₹1,00,000
  brokerageBpsPerOrder?: number; // Overrides default broker-dependent brokerage bps (MIS: 3.0 bps, CNC: 0.0 bps)
  maxBrokeragePerOrderINR?: number | null; // Optional rupee cap per order (e.g. ₹20 at discount brokers; null = uncapped ad-valorem)
  dpChargeBaseINRPerSellOrder?: number; // Default: ₹13.50 (+ 18% GST = ₹15.93) on CNC Delivery SELL; ₹0 on MIS
  slippageBpsPerTurn?: number; // Default: 5.0 bps empirical estimate
  exchangeTransactionChargesBpsPerTurn?: number; // Default: 0.297 bps (NSE Cash circular effective 1 Oct 2024)
}

export interface IndianMarketCostPreset {
  presetName: 'CASH_EQUITY_INTRADAY_MIS' | 'CASH_EQUITY_DELIVERY_CNC' | 'INDEX_FUTURES_PROXY';
  oneTurnoverUnitDefinition: string;
  referenceNotionalINR: number;
  buySide: SideSpecificCostBpsSchedule;
  sellSide: SideSpecificCostBpsSchedule;
  roundTripBps: number;
  transactionCostBpsPerTurn: number;
  brokerageBpsPerTurn: number;
  sttBpsPerTurn: number;
  stampDutyBpsPerTurn: number;
  sttAndTaxesBpsPerTurn: number;
  exchangeTransactionChargesBpsPerTurn: number;
  sebiChargesBpsPerTurn: number;
  dpChargesBpsPerTurn: number;
  gstBpsPerTurn: number;
  exchangeAndSebiChargesBpsPerTurn: number;
  slippageBpsPerTurn: number;
  dpChargeBaseINRPerSellOrder: number;
  maxBrokeragePerOrderINR: number | null;
  provenance: IndianCostComponentProvenance[];
}

export interface IndianEquityOrderCostBreakdown {
  side: 'BUY' | 'SELL';
  notionalINR: number;
  turnoverUnits: number;
  brokerageINR: number;
  sttINR: number;
  exchangeTransactionChargesINR: number;
  sebiChargesINR: number;
  dpChargesINR: number;
  gstINR: number;
  stampDutyINR: number;
  estimatedSlippageINR: number;
  totalStatutoryAndExchangeINR: number;
  totalCostINR: number;
  brokerageBps: number;
  sttBps: number;
  exchangeTransactionChargesBps: number;
  sebiChargesBps: number;
  dpChargesBps: number;
  gstBps: number;
  stampDutyBps: number;
  estimatedSlippageBps: number;
  totalStatutoryAndExchangeBps: number;
  totalCostBps: number;
}

export interface IndianEquityTradeCostBreakdownResult {
  presetName: 'CASH_EQUITY_INTRADAY_MIS' | 'CASH_EQUITY_DELIVERY_CNC';
  oneTurnoverUnitDefinition: string;
  referenceNotionalINR: number;
  entryBuyOrder: IndianEquityOrderCostBreakdown;
  exitSellOrder: IndianEquityOrderCostBreakdown;
  roundTripTotal: {
    totalTradedNotionalINR: number;
    totalTurnoverUnits: number;
    brokerageINR: number;
    sttINR: number;
    exchangeTransactionChargesINR: number;
    sebiChargesINR: number;
    dpChargesINR: number;
    gstINR: number;
    stampDutyINR: number;
    estimatedSlippageINR: number;
    totalStatutoryAndExchangeINR: number;
    totalCostINR: number;
    roundTripBpsOfPositionNotional: number;
    averageBpsPerOneWayTurn: number;
  };
  provenance: IndianCostComponentProvenance[];
}

export interface EvaluationOptions {
  transactionCostBpsPerTurn?: number; // Default: 10 bps (0.10%) per 1.0 unit of notional turnover when useRealisticIndianCostPreset is false
  brokerageBpsPerTurn?: number; // Default: 3.0 bps per turn (legacy custom mode)
  sttAndTaxesBpsPerTurn?: number; // Default: 2.5 bps per turn (legacy custom mode)
  exchangeAndSebiChargesBpsPerTurn?: number; // Default: 0.5 bps per turn (legacy custom mode)
  slippageBpsPerTurn?: number; // Default: 4.0 bps per turn (legacy custom mode)
  useRealisticIndianCostPreset?: boolean; // Applies side-specific statutory MIS/CNC/Futures cost preset by symbol & executionBasis
  indianCostPresetOptions?: IndianMarketCostPresetOptions; // Optional overrides for brokerage, DP charge, slippage, or notional cap
  allowShortSelling?: boolean; // Default: true (theoretical long/short); if false, maps < 0 signals to 0 (long-only cash)
  executionBasis?: ExecutionPriceBasis; // Default: 'INTRADAY_NEXT_OPEN_TO_CLOSE' ('NEXT_OPEN_TO_CLOSE' alias; 'MULTI_DAY_POSITION' or 'CLOSE_TO_CLOSE' also supported)
}

export interface EvaluationMetricsReport {
  modelName: string;
  forecastHorizonSessions: number;
  sampleCount: number;
  effectiveIndependentSampleCount: number;
  evaluationStartDateIST: string;
  evaluationEndDateIST: string;
  evaluationTimestamps: number[];
  executionBasis: ExecutionPriceBasis;
  allowShortSelling: boolean;
  instrumentTradability: InstrumentTradabilityClass;
  tradabilityDisclosure: string;
  // Forecast Error Metrics & 95% Confidence Intervals (i.i.d. & Newey-West HAC overlap-adjusted)
  maeReturnPct: number;
  rmseReturnPct: number;
  maePriceINR: number;
  maeReturnSePct: number;
  maeReturnCi95HalfWidthPct: number;
  maeReturnCi95LowerPct: number;
  maeReturnCi95UpperPct: number;
  maeReturnHacSePct: number;
  maeReturnHacCi95LowerPct: number;
  maeReturnHacCi95UpperPct: number;
  // Directional Metrics, Explicit Denominators & 95% Wilson Confidence Intervals
  directionalAccuracyPct: number;
  directionalAccuracyNumerator: number;
  directionalAccuracyDenominator: number;
  activeDirectionalAccuracyPct: number;
  activeHitRateNumerator: number;
  activeHitRateDenominator: number;
  activeCallCount: number;
  activeCallRatePct: number;
  activeHitRateSePct: number;
  activeHitRateCi95LowerPct: number;
  activeHitRateCi95UpperPct: number;
  // Exposure, Trade Count & Decomposed Turnover Cost Breakdown
  transactionCostBpsPerTurn: number;
  buySideCostBpsPerTurn: number;
  sellSideCostBpsPerTurn: number;
  brokerageBpsPerTurn: number;
  sttBpsPerTurn: number;
  stampDutyBpsPerTurn: number;
  sttAndTaxesBpsPerTurn: number;
  exchangeTransactionChargesBpsPerTurn: number;
  sebiChargesBpsPerTurn: number;
  dpChargesBpsPerTurn: number;
  gstBpsPerTurn: number;
  exchangeAndSebiChargesBpsPerTurn: number;
  slippageBpsPerTurn: number;
  nonOverlappingStepCount: number;
  longStepCount: number;
  shortStepCount: number;
  flatStepCount: number;
  exposurePct: number;
  tradeChangeCount: number;
  entryCount: number;
  exitCount: number;
  reversalCount: number;
  totalBuyTurnoverUnits: number;
  totalSellTurnoverUnits: number;
  totalTurnoverUnits: number;
  totalTransactionCostPct: number;
  totalBrokerageCostPct: number;
  totalSttCostPct: number;
  totalStampDutyCostPct: number;
  totalTaxesAndSttPct: number;
  totalExchangeTransactionChargesPct: number;
  totalSebiChargesPct: number;
  totalDpChargesPct: number;
  totalGstCostPct: number;
  totalExchangeChargesPct: number;
  totalSlippageCostPct: number;
  terminalOpenPosition: number;
  terminalLiquidationCostPct: number;
  // Risk-Aware Backtest Metrics & Asymptotic / Autocorrelation-Adjusted Sharpe 95% CI
  cumulativeReturnGrossPct: number;
  cumulativeReturnNetPct: number;
  cumulativeReturnNetLiquidatedPct: number;
  maxDrawdownPct: number;
  annualizedVolatilityPct: number;
  sharpeRatioZeroRf: number;
  sharpeRatioSe: number;
  sharpeRatioCi95Lower: number;
  sharpeRatioCi95Upper: number;
  stepReturnLag1Autocorrelation: number;
  sharpeRatioHacSe: number;
  sharpeRatioHacCi95Lower: number;
  sharpeRatioHacCi95Upper: number;
  grossProfitFactor: number;
  profitFactor: number;
  winRatePct: number;
  limitationsDisclosure: string;
}

export interface BaselineComparisonResult {
  symbol: string;
  partitionName: 'VALIDATION' | 'TEST';
  forecastHorizonSessions: number;
  sampleCount: number;
  evaluationStartDateIST: string;
  evaluationEndDateIST: string;
  isAligned: boolean;
  noChangeBaseline: {
    predictions: BaselinePredictionPoint[];
    metrics: EvaluationMetricsReport;
  };
  returnPersistenceBaseline: {
    predictions: BaselinePredictionPoint[];
    metrics: EvaluationMetricsReport;
  };
  ruleBasedBaseline: {
    predictions: BaselinePredictionPoint[];
    metrics: EvaluationMetricsReport;
  };
}

export interface WalkForwardFoldResult {
  foldIndex: number; // 1-indexed (1..numFolds)
  trainSampleCount: number;
  trainStartDateIST: string;
  trainEndDateIST: string;
  trainMinTimestamp: number;
  trainMaxTimestamp: number;
  validationSampleCount: number;
  validationStartDateIST: string;
  validationEndDateIST: string;
  validationMinTimestamp: number;
  validationMaxTimestamp: number;
  purgedBoundaryRecordCount: number;
  trainObservations: PredictionResearchObservation[];
  validationObservations: PredictionResearchObservation[];
  scaledTrain: ScaledObservation[];
  scaledValidation: ScaledObservation[];
  preprocessor: FittedFeaturePreprocessor;
  comparison: BaselineComparisonResult;
}

export interface WalkForwardValidationOptions extends EvaluationOptions {
  numFolds?: number; // Default: 4 expanding chronological validation folds
  minInitialTrainRatio?: number; // Default: 0.40 of pre-holdout development observations
  holdoutTestRatio?: number; // Default: 0.15 reserved strictly as final out-of-sample test partition
  varianceThreshold?: number;
}

export interface WalkForwardValidationReport {
  symbol: string;
  instrumentTradability: InstrumentTradabilityClass;
  forecastHorizonSessions: number;
  numFolds: number;
  totalUsableObservations: number;
  developmentObservationCount: number;
  totalWalkForwardValidationSamples: number;
  holdoutTestSampleCount: number;
  holdoutPurgedBoundaryCount: number;
  isStrictlyChronological: boolean;
  hasZeroFoldOverlap: boolean;
  folds: WalkForwardFoldResult[];
  pooledWalkForwardComparison: BaselineComparisonResult;
  holdoutTestComparison: BaselineComparisonResult;
  holdoutTestPreprocessor: FittedFeaturePreprocessor;
}

export interface OfflineFixtureOptions {
  symbol?: string;
  candleCount?: number;
  startYear?: number;
  basePrice?: number;
  injectMissingCandleAtIndices?: number[];
  injectAdjustedDivergenceAtIndex?: number;
  markLatestAsIncompleteIntraday?: boolean;
}

export const EVALUATION_LIMITATIONS_DISCLOSURE =
  'RESEARCH EVALUATION DISCLOSURE: Directional accuracy and historical backtest metrics do NOT guarantee future profitability. Point-forecast MAE and hit rates can mask asymmetric tail drawdowns, regime shifts, execution slippage, exchange fees, STT/brokerage taxes, and corporate-action dividend gaps. Yahoo Finance chart prices are unverified for official exchange settlement and should never be used to place live trades.';

export const OFFLINE_FIXTURE_PROVENANCE_LABEL =
  'OFFLINE_DETERMINISTIC_SYNTHETIC_FIXTURE (Fictional Research Data — Not Live Market Data)';

export const ONE_TURNOVER_UNIT_DEFINITION =
  '1.0 turnover unit equals a one-way execution of 100% of portfolio notional (|pos_t - pos_{t-1}| = 1.0). Specifically: (a) Entry from cash (0 -> +1 BUY or 0 -> -1 SELL) = 1.0 turn; (b) Holding unchanged (+1 -> +1 or -1 -> -1) = 0.0 turns; (c) Exit to cash (+1 -> 0 SELL or -1 -> 0 BUY) = 1.0 turn; (d) Full reversal (+1 -> -1 SELL 2.0 turns or -1 -> +1 BUY 2.0 turns) = 2.0 turns; (e) Completed round trip (0 -> +1 -> 0) = 2.0 turns (1.0 BUY turn + 1.0 SELL turn); (f) Partial rebalance = |pos_t - pos_{t-1}| fractional turns.';

/**
 * Classifies a percentage return into UP, DOWN, or FLAT (within 1e-9 epsilon).
 */
export function classifyReturnDirection(returnPct: number): ForecastDirection {
  if (returnPct > 1e-9) return 'UP';
  if (returnPct < -1e-9) return 'DOWN';
  return 'FLAT';
}

/**
 * Classifies whether a symbol is a non-tradable spot index proxy (requiring futures/ETFs)
 * or a cash-equity instrument eligible for long-only CNC delivery trading.
 */
export function classifyInstrumentTradability(
  symbol: string
): { tradability: InstrumentTradabilityClass; disclosure: string } {
  const inst = SUPPORTED_INSTRUMENTS.find((i) => i.symbol === symbol);
  if (inst?.type === 'INDEX' || symbol.startsWith('^')) {
    return {
      tradability: 'NON_TRADABLE_SPOT_INDEX_PROXY',
      disclosure:
        'NON-TRADABLE SPOT INDEX: Spot indices (^NSEI, ^NSEBANK, ^BSESN) cannot be bought or shorted directly; real execution requires NSE/BSE index futures or index ETFs with separate basis risk and lot sizes.',
    };
  }
  return {
    tradability: 'CASH_EQUITY_LONG_ONLY_ELIGIBLE',
    disclosure:
      'CASH EQUITY (NSE/BSE): Multi-day short selling in cash equities is restricted for retail participants without SLBM borrowing or F&O derivatives; realistic cash-equity evaluation requires allowShortSelling: false (Long-Only CNC).',
  };
}

/**
 * Builds authoritative provenance records for Indian equity statutory, exchange-regulated,
 * broker-dependent, and empirical slippage cost components.
 */
function buildIndianCostProvenance(
  presetName: 'CASH_EQUITY_INTRADAY_MIS' | 'CASH_EQUITY_DELIVERY_CNC' | 'INDEX_FUTURES_PROXY',
  brokerageBps: number,
  maxBrokeragePerOrderINR: number | null,
  dpChargeBaseINRPerSellOrder: number,
  slippageBps: number,
  exchangeTxnBps: number
): IndianCostComponentProvenance[] {
  if (presetName === 'CASH_EQUITY_INTRADAY_MIS') {
    return [
      {
        component: 'stt',
        classification: 'STATUTORY_VERIFIED',
        isVerifiedExactRate: true,
        isConfigurable: false,
        applicableSide: 'SELL_ONLY',
        rateSummary: '0.00% (0.00 bps) on BUY; 0.025% (2.50 bps) on SELL',
        authoritySource: 'Finance Act, 2004 (Chapter VII) & Finance (No. 2) Act, 2024 — Income Tax Dept, Govt. of India',
        effectiveDate: '2024-10-01',
        instrumentScope: 'Equity Intraday (Non-Delivery Cash Segment)',
        assumptions: 'Legally levied strictly on the SELL leg of non-delivery equity intraday transactions.',
      },
      {
        component: 'stampDuty',
        classification: 'STATUTORY_VERIFIED',
        isVerifiedExactRate: true,
        isConfigurable: false,
        applicableSide: 'BUY_ONLY',
        rateSummary: '0.003% (0.30 bps) on BUY; 0.00% (0.00 bps) on SELL',
        authoritySource: 'Indian Stamp Act, 1899 (Finance Act, 2019 Unified Stamp Duty Rules)',
        effectiveDate: '2020-07-01',
        instrumentScope: 'Equity Intraday (Non-Delivery Cash Segment)',
        assumptions: 'Legally levied strictly on the BUY/transferor-acquisition leg across all Indian states.',
      },
      {
        component: 'exchangeTransactionCharges',
        classification: 'EXCHANGE_REGULATED_VERIFIED',
        isVerifiedExactRate: true,
        isConfigurable: true,
        applicableSide: 'BOTH_BUY_AND_SELL',
        rateSummary: `${exchangeTxnBps} bps (0.00297% = ₹297/crore) on both BUY and SELL`,
        authoritySource: 'NSE Circular Ref. NSE/FAOP/64008 (True-to-Label Flat Fee Schedule)',
        effectiveDate: '2024-10-01',
        instrumentScope: 'NSE Capital Market (Cash Equity Intraday & Delivery)',
        assumptions: 'Uses NSE Capital Market flat rate of ₹2.97 per ₹1,00,000 turnover; BSE Cash rates vary by stock group and are configurable.',
      },
      {
        component: 'sebiCharges',
        classification: 'STATUTORY_VERIFIED',
        isVerifiedExactRate: true,
        isConfigurable: false,
        applicableSide: 'BOTH_BUY_AND_SELL',
        rateSummary: '0.01 bps (0.0001% = ₹10/crore) on both BUY and SELL',
        authoritySource: 'SEBI (Stock Brokers) Regulations — Regulatory Turnover Fee Schedule',
        effectiveDate: '2023-04-01',
        instrumentScope: 'All Equity & Derivatives Segments (NSE/BSE)',
        assumptions: 'Flat ₹10 per crore (₹0.10 per ₹1,00,000) on both buy and sell turnover.',
      },
      {
        component: 'brokerage',
        classification: 'BROKER_DEPENDENT_CONFIGURABLE',
        isVerifiedExactRate: false,
        isConfigurable: true,
        applicableSide: 'BOTH_BUY_AND_SELL',
        rateSummary:
          maxBrokeragePerOrderINR !== null
            ? `${brokerageBps} bps (0.03%) capped at ₹${maxBrokeragePerOrderINR}/order`
            : `${brokerageBps} bps (0.03%) ad-valorem per order (uncapped percentage basis)`,
        authoritySource: 'Unverified universal rate — Indian discount broker tariff benchmark (Zerodha/Upstox/Angel One)',
        effectiveDate: '2024-10-01',
        instrumentScope: 'Equity Intraday (MIS)',
        assumptions: 'SEBI caps statutory brokerage at 2.5%, while discount brokers charge min(0.03%, ₹20/order). Configurable via brokerageBpsPerOrder and maxBrokeragePerOrderINR.',
      },
      {
        component: 'dpCharges',
        classification: 'BROKER_DEPENDENT_CONFIGURABLE',
        isVerifiedExactRate: true,
        isConfigurable: false,
        applicableSide: 'NONE',
        rateSummary: '₹0.00 (0.00 bps) on BUY and SELL',
        authoritySource: 'CDSL / NSDL Depository Tariff',
        effectiveDate: '2024-10-01',
        instrumentScope: 'Equity Intraday (MIS)',
        assumptions: 'Intraday MIS positions are squared off before settlement; no demat debit occurs.',
      },
      {
        component: 'gst',
        classification: 'STATUTORY_VERIFIED',
        isVerifiedExactRate: true,
        isConfigurable: false,
        applicableSide: 'BOTH_BUY_AND_SELL',
        rateSummary: '18.0% of (Brokerage + Exchange Transaction Charges + SEBI Charges)',
        authoritySource: 'CGST / SGST / IGST Act, 2017 — Financial Brokerage & Exchange Services',
        effectiveDate: '2017-07-01',
        instrumentScope: 'All Financial Services',
        assumptions: 'Applies strictly to Brokerage, Exchange Transaction Charges, SEBI Turnover Fees, and DP Charges. Never applied to STT, Stamp Duty, or Slippage.',
      },
      {
        component: 'estimatedSlippage',
        classification: 'EMPIRICAL_ESTIMATE_CONFIGURABLE',
        isVerifiedExactRate: false,
        isConfigurable: true,
        applicableSide: 'BOTH_BUY_AND_SELL',
        rateSummary: `${slippageBps} bps (0.05%) per one-way order`,
        authoritySource: 'Unverified empirical estimate — configurable bid-ask spread and market-impact buffer',
        effectiveDate: 'N/A (Empirical Model Parameter)',
        instrumentScope: 'Large-Cap NSE/BSE Equities',
        assumptions: 'Empirical estimate for liquid Nifty 50 constituents; unverified and configurable via slippageBpsPerTurn.',
      },
    ];
  }

  if (presetName === 'CASH_EQUITY_DELIVERY_CNC') {
    return [
      {
        component: 'stt',
        classification: 'STATUTORY_VERIFIED',
        isVerifiedExactRate: true,
        isConfigurable: false,
        applicableSide: 'BOTH_BUY_AND_SELL',
        rateSummary: '0.10% (10.00 bps) on BUY; 0.10% (10.00 bps) on SELL',
        authoritySource: 'Finance Act, 2004 (Chapter VII) & Finance (No. 2) Act, 2024 — Income Tax Dept, Govt. of India',
        effectiveDate: '2024-10-01',
        instrumentScope: 'Equity Delivery (CNC Cash Segment)',
        assumptions: 'Legally levied at 0.10% on BOTH purchase and sale of delivery-settled equity shares.',
      },
      {
        component: 'stampDuty',
        classification: 'STATUTORY_VERIFIED',
        isVerifiedExactRate: true,
        isConfigurable: false,
        applicableSide: 'BUY_ONLY',
        rateSummary: '0.015% (1.50 bps) on BUY; 0.00% (0.00 bps) on SELL',
        authoritySource: 'Indian Stamp Act, 1899 (Finance Act, 2019 Unified Stamp Duty Rules)',
        effectiveDate: '2020-07-01',
        instrumentScope: 'Equity Delivery (CNC Cash Segment)',
        assumptions: 'Legally levied at 0.015% strictly on the BUY leg of delivery-based equity transfers.',
      },
      {
        component: 'exchangeTransactionCharges',
        classification: 'EXCHANGE_REGULATED_VERIFIED',
        isVerifiedExactRate: true,
        isConfigurable: true,
        applicableSide: 'BOTH_BUY_AND_SELL',
        rateSummary: `${exchangeTxnBps} bps (0.00297% = ₹297/crore) on both BUY and SELL`,
        authoritySource: 'NSE Circular Ref. NSE/FAOP/64008 (True-to-Label Flat Fee Schedule)',
        effectiveDate: '2024-10-01',
        instrumentScope: 'NSE Capital Market (Cash Equity Intraday & Delivery)',
        assumptions: 'Uses NSE Capital Market flat rate of ₹2.97 per ₹1,00,000 turnover; BSE Cash rates vary by stock group and are configurable.',
      },
      {
        component: 'sebiCharges',
        classification: 'STATUTORY_VERIFIED',
        isVerifiedExactRate: true,
        isConfigurable: false,
        applicableSide: 'BOTH_BUY_AND_SELL',
        rateSummary: '0.01 bps (0.0001% = ₹10/crore) on both BUY and SELL',
        authoritySource: 'SEBI (Stock Brokers) Regulations — Regulatory Turnover Fee Schedule',
        effectiveDate: '2023-04-01',
        instrumentScope: 'All Equity & Derivatives Segments (NSE/BSE)',
        assumptions: 'Flat ₹10 per crore (₹0.10 per ₹1,00,000) on both buy and sell turnover.',
      },
      {
        component: 'brokerage',
        classification: 'BROKER_DEPENDENT_CONFIGURABLE',
        isVerifiedExactRate: false,
        isConfigurable: true,
        applicableSide: 'BOTH_BUY_AND_SELL',
        rateSummary: `${brokerageBps} bps per order (₹0 zero-delivery discount-broker benchmark; configurable)`,
        authoritySource: 'Unverified universal rate — Indian discount broker tariff benchmark',
        effectiveDate: '2024-10-01',
        instrumentScope: 'Equity Delivery (CNC)',
        assumptions: 'Discount brokers often charge ₹0 (0.00 bps) for CNC delivery while full-service/flat-fee brokers charge 1–25 bps. Configurable via brokerageBpsPerOrder.',
      },
      {
        component: 'dpCharges',
        classification: 'BROKER_DEPENDENT_CONFIGURABLE',
        isVerifiedExactRate: false,
        isConfigurable: true,
        applicableSide: 'SELL_ONLY',
        rateSummary: `₹0.00 on BUY; ₹${dpChargeBaseINRPerSellOrder.toFixed(2)} base (+ 18% GST = ₹${(dpChargeBaseINRPerSellOrder * 1.18).toFixed(2)}) per SELL order`,
        authoritySource: 'Unverified universal rate — CDSL (₹3.50) + Discount Broker Depository Participant Tariff (₹10.00)',
        effectiveDate: '2024-10-01',
        instrumentScope: 'Equity Delivery (CNC Demat Debit on Sale)',
        assumptions: 'Flat per-scrip per-day demat debit charge on CNC SELL orders only (1.35 bps base + 0.243 bps GST = 1.593 bps at ₹1,00,000 reference notional). Configurable via dpChargeBaseINRPerSellOrder.',
      },
      {
        component: 'gst',
        classification: 'STATUTORY_VERIFIED',
        isVerifiedExactRate: true,
        isConfigurable: false,
        applicableSide: 'BOTH_BUY_AND_SELL',
        rateSummary: '18.0% of (Brokerage + Exchange Transaction Charges + SEBI Charges + DP Base Charges)',
        authoritySource: 'CGST / SGST / IGST Act, 2017 — Financial Brokerage, Exchange & Depository Services',
        effectiveDate: '2017-07-01',
        instrumentScope: 'All Financial Services',
        assumptions: 'Applies strictly to Brokerage, Exchange Transaction Charges, SEBI Turnover Fees, and DP Charges. Never applied to STT, Stamp Duty, or Slippage.',
      },
      {
        component: 'estimatedSlippage',
        classification: 'EMPIRICAL_ESTIMATE_CONFIGURABLE',
        isVerifiedExactRate: false,
        isConfigurable: true,
        applicableSide: 'BOTH_BUY_AND_SELL',
        rateSummary: `${slippageBps} bps (0.05%) per one-way order`,
        authoritySource: 'Unverified empirical estimate — configurable bid-ask spread and market-impact buffer',
        effectiveDate: 'N/A (Empirical Model Parameter)',
        instrumentScope: 'Large-Cap NSE/BSE Equities',
        assumptions: 'Empirical estimate for liquid Nifty 50 constituents; unverified and configurable via slippageBpsPerTurn.',
      },
    ];
  }

  return [
    {
      component: 'stt',
      classification: 'STATUTORY_VERIFIED',
      isVerifiedExactRate: true,
      isConfigurable: false,
      applicableSide: 'SELL_ONLY',
      rateSummary: '0.00% on BUY; 0.02% (2.00 bps) on SELL',
      authoritySource: 'Finance (No. 2) Act, 2024 (effective 1 Oct 2024 — revised from 0.0125% to 0.02% on futures sale)',
      effectiveDate: '2024-10-01',
      instrumentScope: 'Equity Index Futures Proxy (^NSEI, ^NSEBANK, ^BSESN)',
      assumptions: 'Spot indices are non-tradable; futures proxy models 0.02% STT on SELL side only.',
    },
    {
      component: 'stampDuty',
      classification: 'STATUTORY_VERIFIED',
      isVerifiedExactRate: true,
      isConfigurable: false,
      applicableSide: 'BUY_ONLY',
      rateSummary: '0.002% (0.20 bps) on BUY; 0.00% on SELL',
      authoritySource: 'Indian Stamp Act, 1899 (Unified Stamp Duty Rules)',
      effectiveDate: '2020-07-01',
      instrumentScope: 'Equity Index Futures Proxy',
      assumptions: '0.002% stamp duty on futures BUY leg only.',
    },
    {
      component: 'exchangeTransactionCharges',
      classification: 'EXCHANGE_REGULATED_VERIFIED',
      isVerifiedExactRate: true,
      isConfigurable: true,
      applicableSide: 'BOTH_BUY_AND_SELL',
      rateSummary: `${exchangeTxnBps} bps (0.00173% = ₹173/crore) on both BUY and SELL`,
      authoritySource: 'NSE Circular Ref. NSE/FAOP/64008 (effective 1 Oct 2024 — NSE Futures flat fee)',
      effectiveDate: '2024-10-01',
      instrumentScope: 'NSE F&O Futures Segment',
      assumptions: 'Uses NSE Futures flat fee of 0.173 bps per leg.',
    },
    {
      component: 'sebiCharges',
      classification: 'STATUTORY_VERIFIED',
      isVerifiedExactRate: true,
      isConfigurable: false,
      applicableSide: 'BOTH_BUY_AND_SELL',
      rateSummary: '0.01 bps (0.0001% = ₹10/crore) on both BUY and SELL',
      authoritySource: 'SEBI (Stock Brokers) Regulations',
      effectiveDate: '2023-04-01',
      instrumentScope: 'All Segments',
      assumptions: '₹10 per crore on both buy and sell legs.',
    },
    {
      component: 'brokerage',
      classification: 'BROKER_DEPENDENT_CONFIGURABLE',
      isVerifiedExactRate: false,
      isConfigurable: true,
      applicableSide: 'BOTH_BUY_AND_SELL',
      rateSummary: `${brokerageBps} bps per leg (configurable futures brokerage proxy)`,
      authoritySource: 'Unverified universal rate — discount broker futures benchmark',
      effectiveDate: '2024-10-01',
      instrumentScope: 'Index Futures Proxy',
      assumptions: 'Configurable brokerage bps per leg.',
    },
    {
      component: 'dpCharges',
      classification: 'BROKER_DEPENDENT_CONFIGURABLE',
      isVerifiedExactRate: true,
      isConfigurable: false,
      applicableSide: 'NONE',
      rateSummary: '₹0.00 (cash-settled index futures)',
      authoritySource: 'NSE Clearing Corporation',
      effectiveDate: '2024-10-01',
      instrumentScope: 'Index Futures Proxy',
      assumptions: 'Index futures are cash-settled; no demat DP charges apply.',
    },
    {
      component: 'gst',
      classification: 'STATUTORY_VERIFIED',
      isVerifiedExactRate: true,
      isConfigurable: false,
      applicableSide: 'BOTH_BUY_AND_SELL',
      rateSummary: '18.0% of (Brokerage + Exchange Transaction Charges + SEBI Charges)',
      authoritySource: 'CGST / SGST / IGST Act, 2017',
      effectiveDate: '2017-07-01',
      instrumentScope: 'All Segments',
      assumptions: '18% GST on brokerage, exchange fees, and SEBI fees.',
    },
    {
      component: 'estimatedSlippage',
      classification: 'EMPIRICAL_ESTIMATE_CONFIGURABLE',
      isVerifiedExactRate: false,
      isConfigurable: true,
      applicableSide: 'BOTH_BUY_AND_SELL',
      rateSummary: `${slippageBps} bps per leg`,
      authoritySource: 'Unverified empirical estimate — configurable index futures spread/slippage',
      effectiveDate: 'N/A',
      instrumentScope: 'Index Futures Proxy',
      assumptions: 'Configurable empirical slippage estimate.',
    },
  ];
}

/**
 * Returns side-specific Indian statutory, exchange-regulated, broker-dependent, and empirical
 * cost schedules (in bps of notional) differentiated by instrument class and execution mode:
 *
 * 1. `CASH_EQUITY_INTRADAY_MIS` (for ₹1,00,000 reference notional, default ad-valorem brokerage 3.00 bps):
 *    - BUY leg:  Brokerage 3.00 bps, STT 0.00 bps (sell-only), Exchange 0.297 bps, SEBI 0.01 bps,
 *                DP 0.00 bps, GST 0.59526 bps (18% of 3.307 bps), Stamp Duty 0.30 bps (buy-only),
 *                Slippage 5.00 bps => Total BUY = 9.20226 bps (₹92.0226 on ₹1,00,000).
 *    - SELL leg: Brokerage 3.00 bps, STT 2.50 bps (0.025% sell-only), Exchange 0.297 bps, SEBI 0.01 bps,
 *                DP 0.00 bps, GST 0.59526 bps (18% of 3.307 bps), Stamp Duty 0.00 bps (buy-only),
 *                Slippage 5.00 bps => Total SELL = 11.40226 bps (₹114.0226 on ₹1,00,000).
 *    - Round-Trip (BUY + SELL = 2.0 turns): 20.60452 bps (₹206.0452 on ₹1,00,000), or 10.30226 bps/turn.
 *
 * 2. `CASH_EQUITY_DELIVERY_CNC` (for ₹1,00,000 reference notional, default ₹0 discount-broker delivery
 *    brokerage and ₹13.50 base + 18% GST = ₹15.93 DP demat debit charge on SELL only):
 *    - BUY leg:  Brokerage 0.00 bps, STT 10.00 bps (0.10%), Exchange 0.297 bps, SEBI 0.01 bps,
 *                DP 0.00 bps, GST 0.05526 bps (18% of 0.307 bps), Stamp Duty 1.50 bps (0.015% buy-only),
 *                Slippage 5.00 bps => Total BUY = 16.86226 bps (₹168.6226 on ₹1,00,000).
 *    - SELL leg: Brokerage 0.00 bps, STT 10.00 bps (0.10%), Exchange 0.297 bps, SEBI 0.01 bps,
 *                DP 1.35 bps (₹13.50 on ₹1,00,000 sell-only), GST 0.29826 bps (18% of 1.657 bps),
 *                Stamp Duty 0.00 bps (buy-only), Slippage 5.00 bps => Total SELL = 16.95526 bps (₹169.5526 on ₹1,00,000).
 *    - Round-Trip (BUY + SELL = 2.0 turns): 33.81752 bps (₹338.1752 on ₹1,00,000), or 16.90876 bps/turn.
 */
export function getRealisticIndianMarketCostPreset(
  symbol: string,
  executionBasis: ExecutionPriceBasis = 'INTRADAY_NEXT_OPEN_TO_CLOSE',
  customOptions: IndianMarketCostPresetOptions = {}
): IndianMarketCostPreset {
  const referenceNotionalINR = customOptions.referenceNotionalINR ?? 100_000;
  if (!Number.isFinite(referenceNotionalINR) || referenceNotionalINR <= 0) {
    throw new Error(`referenceNotionalINR must be a positive number (received ${referenceNotionalINR})`);
  }

  const { tradability } = classifyInstrumentTradability(symbol);
  if (tradability === 'NON_TRADABLE_SPOT_INDEX_PROXY') {
    const rawBrokBps = customOptions.brokerageBpsPerOrder ?? 2.0;
    const maxCapINR = customOptions.maxBrokeragePerOrderINR ?? null;
    const effectiveBrokBps =
      maxCapINR !== null
        ? Math.min(rawBrokBps, (maxCapINR / referenceNotionalINR) * 10_000)
        : rawBrokBps;
    const exchangeTxnBps = customOptions.exchangeTransactionChargesBpsPerTurn ?? 0.173; // NSE Futures ₹173/cr
    const sebiBps = 0.01;
    const slippageBps = customOptions.slippageBpsPerTurn ?? 4.5;
    const gstBps = Number((0.18 * (effectiveBrokBps + exchangeTxnBps + sebiBps)).toFixed(5));

    const buyStatutoryBps = Number(
      (effectiveBrokBps + 0 + exchangeTxnBps + sebiBps + 0 + gstBps + 0.2).toFixed(5)
    );
    const sellStatutoryBps = Number(
      (effectiveBrokBps + 2.0 + exchangeTxnBps + sebiBps + 0 + gstBps + 0).toFixed(5)
    );

    const buySide: SideSpecificCostBpsSchedule = {
      side: 'BUY',
      brokerageBps: Number(effectiveBrokBps.toFixed(5)),
      sttBps: 0,
      exchangeTransactionChargesBps: exchangeTxnBps,
      sebiChargesBps: sebiBps,
      dpChargesBps: 0,
      gstBps,
      stampDutyBps: 0.2,
      slippageBps,
      totalStatutoryAndExchangeBps: buyStatutoryBps,
      totalCostBps: Number((buyStatutoryBps + slippageBps).toFixed(5)),
    };
    const sellSide: SideSpecificCostBpsSchedule = {
      side: 'SELL',
      brokerageBps: Number(effectiveBrokBps.toFixed(5)),
      sttBps: 2.0,
      exchangeTransactionChargesBps: exchangeTxnBps,
      sebiChargesBps: sebiBps,
      dpChargesBps: 0,
      gstBps,
      stampDutyBps: 0,
      slippageBps,
      totalStatutoryAndExchangeBps: sellStatutoryBps,
      totalCostBps: Number((sellStatutoryBps + slippageBps).toFixed(5)),
    };

    const roundTripBps = Number((buySide.totalCostBps + sellSide.totalCostBps).toFixed(5));
    const sttBpsPerTurn = 1.0;
    const stampDutyBpsPerTurn = 0.1;
    const exchangeAndSebiChargesBpsPerTurn = Number(
      (exchangeTxnBps + sebiBps + gstBps).toFixed(5)
    );

    return {
      presetName: 'INDEX_FUTURES_PROXY',
      oneTurnoverUnitDefinition: ONE_TURNOVER_UNIT_DEFINITION,
      referenceNotionalINR,
      buySide,
      sellSide,
      roundTripBps,
      transactionCostBpsPerTurn: Number((roundTripBps / 2).toFixed(5)),
      brokerageBpsPerTurn: Number(effectiveBrokBps.toFixed(5)),
      sttBpsPerTurn,
      stampDutyBpsPerTurn,
      sttAndTaxesBpsPerTurn: Number((sttBpsPerTurn + stampDutyBpsPerTurn).toFixed(5)),
      exchangeTransactionChargesBpsPerTurn: exchangeTxnBps,
      sebiChargesBpsPerTurn: sebiBps,
      dpChargesBpsPerTurn: 0,
      gstBpsPerTurn: gstBps,
      exchangeAndSebiChargesBpsPerTurn,
      slippageBpsPerTurn: slippageBps,
      dpChargeBaseINRPerSellOrder: 0,
      maxBrokeragePerOrderINR: maxCapINR,
      provenance: buildIndianCostProvenance(
        'INDEX_FUTURES_PROXY',
        effectiveBrokBps,
        maxCapINR,
        0,
        slippageBps,
        exchangeTxnBps
      ),
    };
  }

  const isIntraday =
    executionBasis === 'INTRADAY_NEXT_OPEN_TO_CLOSE' ||
    executionBasis === 'NEXT_OPEN_TO_CLOSE';

  const exchangeTxnBps = customOptions.exchangeTransactionChargesBpsPerTurn ?? 0.297; // NSE Cash 0.00297%
  const sebiBps = 0.01; // ₹10 / crore = 0.0001%
  const slippageBps = customOptions.slippageBpsPerTurn ?? 5.0;
  const maxCapINR = customOptions.maxBrokeragePerOrderINR ?? null;

  if (isIntraday) {
    const rawBrokBps = customOptions.brokerageBpsPerOrder ?? 3.0; // 0.03%
    const effectiveBrokBps =
      maxCapINR !== null
        ? Math.min(rawBrokBps, (maxCapINR / referenceNotionalINR) * 10_000)
        : rawBrokBps;
    const gstBps = Number((0.18 * (effectiveBrokBps + exchangeTxnBps + sebiBps)).toFixed(5));

    const buyStatutoryBps = Number(
      (effectiveBrokBps + 0 + exchangeTxnBps + sebiBps + 0 + gstBps + 0.3).toFixed(5)
    );
    const sellStatutoryBps = Number(
      (effectiveBrokBps + 2.5 + exchangeTxnBps + sebiBps + 0 + gstBps + 0).toFixed(5)
    );

    const buySide: SideSpecificCostBpsSchedule = {
      side: 'BUY',
      brokerageBps: Number(effectiveBrokBps.toFixed(5)),
      sttBps: 0, // MIS STT is 0% on BUY
      exchangeTransactionChargesBps: exchangeTxnBps,
      sebiChargesBps: sebiBps,
      dpChargesBps: 0,
      gstBps,
      stampDutyBps: 0.3, // MIS Stamp Duty is 0.003% (0.30 bps) on BUY only
      slippageBps,
      totalStatutoryAndExchangeBps: buyStatutoryBps,
      totalCostBps: Number((buyStatutoryBps + slippageBps).toFixed(5)),
    };

    const sellSide: SideSpecificCostBpsSchedule = {
      side: 'SELL',
      brokerageBps: Number(effectiveBrokBps.toFixed(5)),
      sttBps: 2.5, // MIS STT is 0.025% (2.50 bps) on SELL only
      exchangeTransactionChargesBps: exchangeTxnBps,
      sebiChargesBps: sebiBps,
      dpChargesBps: 0,
      gstBps,
      stampDutyBps: 0, // Stamp Duty is 0% on SELL
      slippageBps,
      totalStatutoryAndExchangeBps: sellStatutoryBps,
      totalCostBps: Number((sellStatutoryBps + slippageBps).toFixed(5)),
    };

    const roundTripBps = Number((buySide.totalCostBps + sellSide.totalCostBps).toFixed(5));
    const sttBpsPerTurn = 1.25;
    const stampDutyBpsPerTurn = 0.15;
    const exchangeAndSebiChargesBpsPerTurn = Number(
      (exchangeTxnBps + sebiBps + gstBps).toFixed(5)
    );

    return {
      presetName: 'CASH_EQUITY_INTRADAY_MIS',
      oneTurnoverUnitDefinition: ONE_TURNOVER_UNIT_DEFINITION,
      referenceNotionalINR,
      buySide,
      sellSide,
      roundTripBps,
      transactionCostBpsPerTurn: Number((roundTripBps / 2).toFixed(5)),
      brokerageBpsPerTurn: Number(effectiveBrokBps.toFixed(5)),
      sttBpsPerTurn,
      stampDutyBpsPerTurn,
      sttAndTaxesBpsPerTurn: Number((sttBpsPerTurn + stampDutyBpsPerTurn).toFixed(5)),
      exchangeTransactionChargesBpsPerTurn: exchangeTxnBps,
      sebiChargesBpsPerTurn: sebiBps,
      dpChargesBpsPerTurn: 0,
      gstBpsPerTurn: gstBps,
      exchangeAndSebiChargesBpsPerTurn,
      slippageBpsPerTurn: slippageBps,
      dpChargeBaseINRPerSellOrder: 0,
      maxBrokeragePerOrderINR: maxCapINR,
      provenance: buildIndianCostProvenance(
        'CASH_EQUITY_INTRADAY_MIS',
        effectiveBrokBps,
        maxCapINR,
        0,
        slippageBps,
        exchangeTxnBps
      ),
    };
  }

  // CASH_EQUITY_DELIVERY_CNC
  const rawBrokBps = customOptions.brokerageBpsPerOrder ?? 0.0; // ₹0 discount-broker delivery benchmark (configurable)
  const effectiveBrokBps =
    maxCapINR !== null
      ? Math.min(rawBrokBps, (maxCapINR / referenceNotionalINR) * 10_000)
      : rawBrokBps;
  const dpChargeBaseINR = customOptions.dpChargeBaseINRPerSellOrder ?? 13.5; // CDSL ₹3.50 + Broker ₹10.00 on CNC SELL only
  const dpSellBps = Number(((dpChargeBaseINR / referenceNotionalINR) * 10_000).toFixed(5));

  const buyGstBps = Number((0.18 * (effectiveBrokBps + exchangeTxnBps + sebiBps)).toFixed(5));
  const sellGstBps = Number(
    (0.18 * (effectiveBrokBps + exchangeTxnBps + sebiBps + dpSellBps)).toFixed(5)
  );

  const buyStatutoryBps = Number(
    (effectiveBrokBps + 10.0 + exchangeTxnBps + sebiBps + 0 + buyGstBps + 1.5).toFixed(5)
  );
  const sellStatutoryBps = Number(
    (effectiveBrokBps + 10.0 + exchangeTxnBps + sebiBps + dpSellBps + sellGstBps + 0).toFixed(5)
  );

  const buySide: SideSpecificCostBpsSchedule = {
    side: 'BUY',
    brokerageBps: Number(effectiveBrokBps.toFixed(5)),
    sttBps: 10.0, // CNC STT is 0.10% (10.00 bps) on BUY
    exchangeTransactionChargesBps: exchangeTxnBps,
    sebiChargesBps: sebiBps,
    dpChargesBps: 0, // No DP debit on BUY
    gstBps: buyGstBps,
    stampDutyBps: 1.5, // CNC Stamp Duty is 0.015% (1.50 bps) on BUY only
    slippageBps,
    totalStatutoryAndExchangeBps: buyStatutoryBps,
    totalCostBps: Number((buyStatutoryBps + slippageBps).toFixed(5)),
  };

  const sellSide: SideSpecificCostBpsSchedule = {
    side: 'SELL',
    brokerageBps: Number(effectiveBrokBps.toFixed(5)),
    sttBps: 10.0, // CNC STT is 0.10% (10.00 bps) on SELL
    exchangeTransactionChargesBps: exchangeTxnBps,
    sebiChargesBps: sebiBps,
    dpChargesBps: dpSellBps, // Demat debit DP charge on CNC SELL only
    gstBps: sellGstBps,
    stampDutyBps: 0, // Stamp Duty is 0% on SELL
    slippageBps,
    totalStatutoryAndExchangeBps: sellStatutoryBps,
    totalCostBps: Number((sellStatutoryBps + slippageBps).toFixed(5)),
  };

  const roundTripBps = Number((buySide.totalCostBps + sellSide.totalCostBps).toFixed(5));
  const sttBpsPerTurn = 10.0;
  const stampDutyBpsPerTurn = 0.75;
  const dpChargesBpsPerTurn = Number((dpSellBps / 2).toFixed(5));
  const gstBpsPerTurn = Number(((buyGstBps + sellGstBps) / 2).toFixed(5));
  const exchangeAndSebiChargesBpsPerTurn = Number(
    (exchangeTxnBps + sebiBps + dpChargesBpsPerTurn + gstBpsPerTurn).toFixed(5)
  );

  return {
    presetName: 'CASH_EQUITY_DELIVERY_CNC',
    oneTurnoverUnitDefinition: ONE_TURNOVER_UNIT_DEFINITION,
    referenceNotionalINR,
    buySide,
    sellSide,
    roundTripBps,
    transactionCostBpsPerTurn: Number((roundTripBps / 2).toFixed(5)),
    brokerageBpsPerTurn: Number(effectiveBrokBps.toFixed(5)),
    sttBpsPerTurn,
    stampDutyBpsPerTurn,
    sttAndTaxesBpsPerTurn: Number((sttBpsPerTurn + stampDutyBpsPerTurn).toFixed(5)),
    exchangeTransactionChargesBpsPerTurn: exchangeTxnBps,
    sebiChargesBpsPerTurn: sebiBps,
    dpChargesBpsPerTurn,
    gstBpsPerTurn,
    exchangeAndSebiChargesBpsPerTurn,
    slippageBpsPerTurn: slippageBps,
    dpChargeBaseINRPerSellOrder: dpChargeBaseINR,
    maxBrokeragePerOrderINR: maxCapINR,
    provenance: buildIndianCostProvenance(
      'CASH_EQUITY_DELIVERY_CNC',
      effectiveBrokBps,
      maxCapINR,
      dpChargeBaseINR,
      slippageBps,
      exchangeTxnBps
    ),
  };
}

/**
 * Calculates the exact Indian Rupee (INR) and basis-point (bps) cost breakdown for a cash equity
 * trade (Default: ₹1,00,000 entry BUY order and ₹1,00,000 exit SELL order) under either
 * `CASH_EQUITY_INTRADAY_MIS` or `CASH_EQUITY_DELIVERY_CNC`.
 *
 * Strictly separates brokerage, STT, exchange transaction charges, SEBI turnover charges,
 * 18% GST, stamp duty, DP charges (CNC sell only), and estimated slippage, and applies each
 * component only to the legally applicable side and notional.
 */
export function calculateIndianEquityTradeCostBreakdown(
  optionsOrPreset:
    | 'CASH_EQUITY_INTRADAY_MIS'
    | 'CASH_EQUITY_DELIVERY_CNC'
    | {
        presetName: 'CASH_EQUITY_INTRADAY_MIS' | 'CASH_EQUITY_DELIVERY_CNC';
        referenceNotionalINR?: number;
        entryBuyNotionalINR?: number;
        exitSellNotionalINR?: number;
        brokerageBpsPerOrder?: number;
        maxBrokeragePerOrderINR?: number | null;
        dpChargeBaseINRPerSellOrder?: number;
        slippageBpsPerTurn?: number;
        exchangeTransactionChargesBpsPerTurn?: number;
      },
  entryBuyNotionalArg?: number,
  exitSellNotionalArg?: number
): IndianEquityTradeCostBreakdownResult {
  const options =
    typeof optionsOrPreset === 'string'
      ? {
          presetName: optionsOrPreset,
          referenceNotionalINR: entryBuyNotionalArg ?? 100_000,
          entryBuyNotionalINR: entryBuyNotionalArg ?? 100_000,
          exitSellNotionalINR: exitSellNotionalArg ?? entryBuyNotionalArg ?? 100_000,
        }
      : optionsOrPreset;

  const referenceNotionalINR = options.referenceNotionalINR ?? 100_000;
  const entryBuyNotionalINR = options.entryBuyNotionalINR ?? referenceNotionalINR;
  const exitSellNotionalINR = options.exitSellNotionalINR ?? referenceNotionalINR;

  if (
    !Number.isFinite(referenceNotionalINR) ||
    referenceNotionalINR <= 0 ||
    !Number.isFinite(entryBuyNotionalINR) ||
    entryBuyNotionalINR < 0 ||
    !Number.isFinite(exitSellNotionalINR) ||
    exitSellNotionalINR < 0
  ) {
    throw new Error('Trade notional amounts must be finite and non-negative');
  }

  const isIntraday = options.presetName === 'CASH_EQUITY_INTRADAY_MIS';
  const preset = getRealisticIndianMarketCostPreset(
    'RELIANCE.NS',
    isIntraday ? 'INTRADAY_NEXT_OPEN_TO_CLOSE' : 'MULTI_DAY_POSITION',
    {
      referenceNotionalINR,
      brokerageBpsPerOrder: options.brokerageBpsPerOrder,
      maxBrokeragePerOrderINR: options.maxBrokeragePerOrderINR,
      dpChargeBaseINRPerSellOrder: options.dpChargeBaseINRPerSellOrder,
      slippageBpsPerTurn: options.slippageBpsPerTurn,
      exchangeTransactionChargesBpsPerTurn: options.exchangeTransactionChargesBpsPerTurn,
    }
  );

  const rawBrokBps =
    options.brokerageBpsPerOrder ?? (isIntraday ? 3.0 : 0.0);
  const maxCapINR = options.maxBrokeragePerOrderINR ?? null;
  const exchangeTxnBps = options.exchangeTransactionChargesBpsPerTurn ?? 0.297;
  const sebiBps = 0.01;
  const slippageBps = options.slippageBpsPerTurn ?? 5.0;
  const dpChargeBaseINR = isIntraday ? 0 : (options.dpChargeBaseINRPerSellOrder ?? 13.5);

  const computeSide = (side: 'BUY' | 'SELL', notionalINR: number): IndianEquityOrderCostBreakdown => {
    const turnoverUnits = Number((notionalINR / referenceNotionalINR).toFixed(6));
    if (notionalINR === 0) {
      return {
        side,
        notionalINR: 0,
        turnoverUnits: 0,
        brokerageINR: 0,
        sttINR: 0,
        exchangeTransactionChargesINR: 0,
        sebiChargesINR: 0,
        dpChargesINR: 0,
        gstINR: 0,
        stampDutyINR: 0,
        estimatedSlippageINR: 0,
        totalStatutoryAndExchangeINR: 0,
        totalCostINR: 0,
        brokerageBps: 0,
        sttBps: 0,
        exchangeTransactionChargesBps: 0,
        sebiChargesBps: 0,
        dpChargesBps: 0,
        gstBps: 0,
        stampDutyBps: 0,
        estimatedSlippageBps: 0,
        totalStatutoryAndExchangeBps: 0,
        totalCostBps: 0,
      };
    }

    const uncappedBrokINR = (notionalINR * rawBrokBps) / 10_000;
    const brokerageINR = Number(
      (maxCapINR !== null ? Math.min(uncappedBrokINR, maxCapINR) : uncappedBrokINR).toFixed(4)
    );
    const sttBps = isIntraday ? (side === 'SELL' ? 2.5 : 0) : 10.0;
    const sttINR = Number(((notionalINR * sttBps) / 10_000).toFixed(4));
    const exchangeTransactionChargesINR = Number(
      ((notionalINR * exchangeTxnBps) / 10_000).toFixed(4)
    );
    const sebiChargesINR = Number(((notionalINR * sebiBps) / 10_000).toFixed(4));
    const dpChargesINR =
      !isIntraday && side === 'SELL' ? Number(dpChargeBaseINR.toFixed(4)) : 0;
    const gstINR = Number(
      (
        0.18 *
        (brokerageINR + exchangeTransactionChargesINR + sebiChargesINR + dpChargesINR)
      ).toFixed(4)
    );
    const stampDutyBps = side === 'BUY' ? (isIntraday ? 0.3 : 1.5) : 0;
    const stampDutyINR = Number(((notionalINR * stampDutyBps) / 10_000).toFixed(4));
    const estimatedSlippageINR = Number(((notionalINR * slippageBps) / 10_000).toFixed(4));

    const totalStatutoryAndExchangeINR = Number(
      (
        brokerageINR +
        sttINR +
        exchangeTransactionChargesINR +
        sebiChargesINR +
        dpChargesINR +
        gstINR +
        stampDutyINR
      ).toFixed(4)
    );
    const totalCostINR = Number(
      (totalStatutoryAndExchangeINR + estimatedSlippageINR).toFixed(4)
    );

    const toBps = (inr: number) => Number(((inr / notionalINR) * 10_000).toFixed(5));

    return {
      side,
      notionalINR,
      turnoverUnits,
      brokerageINR,
      sttINR,
      exchangeTransactionChargesINR,
      sebiChargesINR,
      dpChargesINR,
      gstINR,
      stampDutyINR,
      estimatedSlippageINR,
      totalStatutoryAndExchangeINR,
      totalCostINR,
      brokerageBps: toBps(brokerageINR),
      sttBps: toBps(sttINR),
      exchangeTransactionChargesBps: toBps(exchangeTransactionChargesINR),
      sebiChargesBps: toBps(sebiChargesINR),
      dpChargesBps: toBps(dpChargesINR),
      gstBps: toBps(gstINR),
      stampDutyBps: toBps(stampDutyINR),
      estimatedSlippageBps: toBps(estimatedSlippageINR),
      totalStatutoryAndExchangeBps: toBps(totalStatutoryAndExchangeINR),
      totalCostBps: toBps(totalCostINR),
    };
  };

  const entryBuyOrder = computeSide('BUY', entryBuyNotionalINR);
  const exitSellOrder = computeSide('SELL', exitSellNotionalINR);

  const totalTurnoverUnits = Number(
    (entryBuyOrder.turnoverUnits + exitSellOrder.turnoverUnits).toFixed(6)
  );
  const totalCostINR = Number(
    (entryBuyOrder.totalCostINR + exitSellOrder.totalCostINR).toFixed(4)
  );
  const roundTripBpsOfPositionNotional = Number(
    ((totalCostINR / referenceNotionalINR) * 10_000).toFixed(5)
  );
  const averageBpsPerOneWayTurn =
    totalTurnoverUnits > 0
      ? Number((roundTripBpsOfPositionNotional / totalTurnoverUnits).toFixed(5))
      : 0;

  return {
    presetName: options.presetName,
    oneTurnoverUnitDefinition: ONE_TURNOVER_UNIT_DEFINITION,
    referenceNotionalINR,
    entryBuyOrder,
    exitSellOrder,
    roundTripTotal: {
      totalTradedNotionalINR: Number((entryBuyNotionalINR + exitSellNotionalINR).toFixed(2)),
      totalTurnoverUnits,
      brokerageINR: Number((entryBuyOrder.brokerageINR + exitSellOrder.brokerageINR).toFixed(4)),
      sttINR: Number((entryBuyOrder.sttINR + exitSellOrder.sttINR).toFixed(4)),
      exchangeTransactionChargesINR: Number(
        (
          entryBuyOrder.exchangeTransactionChargesINR +
          exitSellOrder.exchangeTransactionChargesINR
        ).toFixed(4)
      ),
      sebiChargesINR: Number(
        (entryBuyOrder.sebiChargesINR + exitSellOrder.sebiChargesINR).toFixed(4)
      ),
      dpChargesINR: Number((entryBuyOrder.dpChargesINR + exitSellOrder.dpChargesINR).toFixed(4)),
      gstINR: Number((entryBuyOrder.gstINR + exitSellOrder.gstINR).toFixed(4)),
      stampDutyINR: Number((entryBuyOrder.stampDutyINR + exitSellOrder.stampDutyINR).toFixed(4)),
      estimatedSlippageINR: Number(
        (entryBuyOrder.estimatedSlippageINR + exitSellOrder.estimatedSlippageINR).toFixed(4)
      ),
      totalStatutoryAndExchangeINR: Number(
        (
          entryBuyOrder.totalStatutoryAndExchangeINR +
          exitSellOrder.totalStatutoryAndExchangeINR
        ).toFixed(4)
      ),
      totalCostINR,
      roundTripBpsOfPositionNotional,
      averageBpsPerOneWayTurn,
    },
    provenance: preset.provenance,
  };
}

/**
 * Computes sample standard deviation of a numeric array (Bessel-corrected N - 1 denominator).
 */
function calculateSampleStdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const sumSq = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * Computes Newey-West (1987) heteroskedasticity and autocorrelation consistent (HAC) standard error
 * of the sample mean for a series with Bartlett kernel bandwidth `maxLag`.
 */
function calculateNeweyWestMeanStandardError(values: number[], maxLag: number): number {
  const n = values.length;
  if (n <= 1) return 0;
  const mean = values.reduce((acc, v) => acc + v, 0) / n;
  const centered = values.map((v) => v - mean);
  let gamma0 = 0;
  for (let t = 0; t < n; t++) {
    gamma0 += centered[t] * centered[t];
  }
  gamma0 /= n;

  let hacVar = gamma0;
  const L = Math.min(Math.max(0, Math.floor(maxLag)), n - 2);
  for (let lag = 1; lag <= L; lag++) {
    let cov = 0;
    for (let t = lag; t < n; t++) {
      cov += centered[t] * centered[t - lag];
    }
    cov /= n;
    const weight = 1 - lag / (L + 1);
    hacVar += 2 * weight * cov;
  }

  const effectiveVar = Math.max(hacVar, (gamma0 * n) / Math.max(1, n - 1) * 0.25);
  return Math.sqrt(effectiveVar / n);
}

/**
 * Computes sample lag-1 autocorrelation rho_1 of a numeric series.
 */
function calculateLag1Autocorrelation(values: number[]): number {
  const n = values.length;
  if (n <= 2) return 0;
  const mean = values.reduce((acc, v) => acc + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let t = 0; t < n; t++) {
    const d = values[t] - mean;
    den += d * d;
    if (t >= 1) {
      num += d * (values[t - 1] - mean);
    }
  }
  if (den <= 1e-12) return 0;
  return Math.max(-0.95, Math.min(0.95, num / den));
}

/**
 * Computes Wilson score 95% confidence interval [lowerPct, upperPct] for a binomial proportion k / n.
 */
function calculateWilsonScoreCi95Pct(
  hits: number,
  trials: number
): { sePct: number; lowerPct: number; upperPct: number } {
  if (trials <= 0) {
    return { sePct: 0, lowerPct: 0, upperPct: 0 };
  }
  const p = hits / trials;
  const z = 1.959963984540054;
  const z2 = z * z;
  const sePct = Number((Math.sqrt((p * (1 - p)) / trials) * 100).toFixed(2));
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const halfWidth =
    (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;
  const lowerPct = Number((Math.max(0, center - halfWidth) * 100).toFixed(2));
  const upperPct = Number((Math.min(1, center + halfWidth) * 100).toFixed(2));
  return { sePct, lowerPct, upperPct };
}

/**
 * Builds a reproducible historical prediction research dataset from a HistoricalSeries.
 * Strictly enforces causal feature calculation: for each cutoff index `i`, indicators
 * are computed ONLY on the prefix slice `candles.slice(windowStartIdx, i + 1)` so future observations
 * at `> i` can never leak into features at `i`.
 */
export function buildHistoricalPredictionDataset(
  series: HistoricalSeries,
  options: DatasetBuildOptions = {}
): HistoricalPredictionDataset {
  const forecastHorizonSessions = options.forecastHorizonSessions ?? 1;
  const minLookbackCandles = Math.max(options.minLookbackCandles ?? 50, 50);
  const excludeUnverifiedCalendarDates = options.excludeUnverifiedCalendarDates ?? false;
  const excludeAdjustedPriceDivergence = options.excludeAdjustedPriceDivergence ?? false;
  const adjustedDivergenceThresholdPct = options.adjustedDivergenceThresholdPct ?? 0.5;
  const excludeTargetDividendEvents = options.excludeTargetDividendEvents ?? false;
  const targetDividendThresholdPct = options.targetDividendThresholdPct ?? 0.05;

  if (!Number.isInteger(forecastHorizonSessions) || forecastHorizonSessions < 1) {
    throw new Error(`forecastHorizonSessions must be a positive integer (received ${forecastHorizonSessions})`);
  }

  const exclusions: DatasetExclusionSummary = {
    insufficientLookbackWarmup: 0,
    insufficientFutureHorizon: 0,
    incompleteIntradayBars: 0,
    missingOrInvalidLookbackCandles: 0,
    missingOrInvalidTargetCandles: 0,
    unverifiedCalendarDatesExcluded: 0,
    adjustedPriceDivergenceExcluded: 0,
    targetDividendEventsExcluded: 0,
  };

  const usableObservations: PredictionResearchObservation[] = [];
  let verifiedCalendarObservationCount = 0;
  let unverifiedCalendarObservationCount = 0;
  let adjustedPriceDivergenceCount = 0;
  let targetDividendEventCount = 0;

  const candles = series.candles || [];
  const n = candles.length;

  for (let i = 0; i < n; i++) {
    const currentCandle = candles[i];

    // 1. Exclude incomplete forming intraday candle (if i is the latest bar and session is still forming)
    const isLatestBar = i === n - 1;
    const isIncompleteIntraday =
      isLatestBar &&
      (series.latestCandleFormation === 'FORMING_INTRADAY' || !series.isLatestCandleComplete);

    if (isIncompleteIntraday) {
      exclusions.incompleteIntradayBars++;
      continue;
    }

    // 2. Check minimum lookback warmup length (need at least minLookbackCandles ending at i)
    if (i + 1 < minLookbackCandles) {
      exclusions.insufficientLookbackWarmup++;
      continue;
    }

    // 3. Check future target horizon availability (need i + forecastHorizonSessions < n, and target cannot be an incomplete intraday bar)
    const targetIdx = i + forecastHorizonSessions;
    if (targetIdx >= n) {
      exclusions.insufficientFutureHorizon++;
      continue;
    }
    const targetIsIncompleteIntraday =
      targetIdx === n - 1 &&
      (series.latestCandleFormation === 'FORMING_INTRADAY' || !series.isLatestCandleComplete);
    if (targetIsIncompleteIntraday) {
      exclusions.incompleteIntradayBars++;
      continue;
    }

    // 4. Inspect causal lookback window [i - minLookbackCandles + 1 .. i] for missing/invalid candles or non-trading holiday/weekend rows
    const windowStartIdx = i - minLookbackCandles + 1;
    const lookbackSlice = candles.slice(windowStartIdx, i + 1);
    const hasMissingInLookback = lookbackSlice.some(
      (c) =>
        c.isMissing ||
        c.status !== 'VALID' ||
        c.calendarStatus === 'CONFIRMED_EXCHANGE_HOLIDAY' ||
        c.calendarStatus === 'WEEKEND' ||
        c.close === null ||
        c.open === null ||
        c.high === null ||
        c.low === null
    );
    if (hasMissingInLookback) {
      exclusions.missingOrInvalidLookbackCandles++;
      continue;
    }

    // 5. Inspect future target horizon window [i + 1 .. i + forecastHorizonSessions] for missing/invalid candles or non-trading holiday/weekend rows
    const targetHorizonSlice = candles.slice(i + 1, targetIdx + 1);
    const hasMissingInTarget = targetHorizonSlice.some(
      (c) =>
        c.isMissing ||
        c.status !== 'VALID' ||
        c.calendarStatus === 'CONFIRMED_EXCHANGE_HOLIDAY' ||
        c.calendarStatus === 'WEEKEND' ||
        c.close === null ||
        c.open === null
    );
    if (hasMissingInTarget) {
      exclusions.missingOrInvalidTargetCandles++;
      continue;
    }

    // 6. Check exchange calendar verification status across observation and target
    const isCalendarUnverified =
      currentCandle.calendarStatus === 'CALENDAR_UNVERIFIED' ||
      targetHorizonSlice.some((c) => c.calendarStatus === 'CALENDAR_UNVERIFIED');
    if (excludeUnverifiedCalendarDates && isCalendarUnverified) {
      exclusions.unverifiedCalendarDatesExcluded++;
      continue;
    }

    // 7. Check split/dividend adjusted-close consistency across lookback + target window
    const combinedCheckSlice = [...lookbackSlice, ...targetHorizonSlice];
    const adjRatios: number[] = [];
    for (const c of combinedCheckSlice) {
      if (
        c.adjClose !== null &&
        c.close !== null &&
        c.close > 0 &&
        Number.isFinite(c.adjClose)
      ) {
        adjRatios.push(c.adjClose / c.close);
      }
    }
    let hasAdjustedCloseDivergence = false;
    let adjustmentRatioSpreadPct: number | null = null;
    if (adjRatios.length >= 2) {
      const minRatio = Math.min(...adjRatios);
      const maxRatio = Math.max(...adjRatios);
      const refRatio = adjRatios[adjRatios.length - 1] || 1;
      adjustmentRatioSpreadPct = Number((((maxRatio - minRatio) / refRatio) * 100).toFixed(4));
      if (adjustmentRatioSpreadPct > adjustedDivergenceThresholdPct) {
        hasAdjustedCloseDivergence = true;
      }
    }
    if (excludeAdjustedPriceDivergence && hasAdjustedCloseDivergence) {
      exclusions.adjustedPriceDivergenceExcluded++;
      continue;
    }

    // 7b. Detect corporate-action / ex-dividend adjustment step across the forward target horizon [i .. targetIdx]
    const targetCandleForAdj = candles[targetIdx];
    let hasTargetHorizonDividendEvent = false;
    let targetDividendAdjustmentPct: number | null = null;
    let targetTotalReturnAdjClosePct: number | null = null;
    if (
      currentCandle.adjClose !== null &&
      currentCandle.close !== null &&
      currentCandle.close > 0 &&
      currentCandle.adjClose > 0 &&
      targetCandleForAdj.adjClose !== null &&
      targetCandleForAdj.close !== null &&
      targetCandleForAdj.close > 0 &&
      Number.isFinite(currentCandle.adjClose) &&
      Number.isFinite(targetCandleForAdj.adjClose)
    ) {
      const ratioNow = currentCandle.adjClose / currentCandle.close;
      const ratioTarget = targetCandleForAdj.adjClose / targetCandleForAdj.close;
      targetDividendAdjustmentPct = Number(
        (((ratioTarget - ratioNow) / ratioNow) * 100).toFixed(4)
      );
      if (Math.abs(targetDividendAdjustmentPct) > targetDividendThresholdPct) {
        hasTargetHorizonDividendEvent = true;
      }
      targetTotalReturnAdjClosePct = Number(
        (
          ((targetCandleForAdj.adjClose - currentCandle.adjClose) / currentCandle.adjClose) *
          100
        ).toFixed(4)
      );
    }
    if (excludeTargetDividendEvents && hasTargetHorizonDividendEvent) {
      exclusions.targetDividendEventsExcluded++;
      continue;
    }

    // 8. Calculate features STRICTLY from the causal lookback window (lookbackSlice: windowStartIdx..i)
    // Future candles at > i are not even passed into the indicator functions!
    const causalCloses = lookbackSlice.map((c) => c.close as number);
    const L = causalCloses.length; // === minLookbackCandles (>= 50)
    const lastIdx = L - 1;

    const sma20Arr = calculateSMA(causalCloses, 20);
    const sma50Arr = calculateSMA(causalCloses, 50);
    const rsi14Arr = calculateRSI(causalCloses, 14);
    const macdObj = calculateMACD(causalCloses, 12, 26, 9);

    const cNow = causalCloses[lastIdx];
    const cPrev1 = causalCloses[lastIdx - 1];
    const cPrev5 = causalCloses[lastIdx - 5];
    const sma20Val = sma20Arr[lastIdx];
    const sma50Val = sma50Arr[lastIdx];
    const rsi14Val = rsi14Arr[lastIdx];
    const macdHistVal = macdObj.histogram[lastIdx];

    if (
      sma20Val === null ||
      sma50Val === null ||
      rsi14Val === null ||
      macdHistVal === null ||
      !Number.isFinite(cPrev1) ||
      !Number.isFinite(cPrev5)
    ) {
      exclusions.missingOrInvalidLookbackCandles++;
      continue;
    }

    // 5-day rolling 1-day return volatility strictly up to lastIdx
    const recent1dReturns: number[] = [];
    for (let k = lastIdx - 4; k <= lastIdx; k++) {
      const r1 = ((causalCloses[k] - causalCloses[k - 1]) / causalCloses[k - 1]) * 100;
      recent1dReturns.push(r1);
    }
    const volatility5dPct = Number(calculateSampleStdDev(recent1dReturns).toFixed(4));

    const return1dPct = Number((((cNow - cPrev1) / cPrev1) * 100).toFixed(4));
    const return5dPct = Number((((cNow - cPrev5) / cPrev5) * 100).toFixed(4));
    const sma20DistancePct = Number((((cNow - sma20Val) / sma20Val) * 100).toFixed(4));
    const sma50DistancePct = Number((((cNow - sma50Val) / sma50Val) * 100).toFixed(4));
    const sma20OverSma50Pct = Number((((sma20Val - sma50Val) / sma50Val) * 100).toFixed(4));
    const macdHistogramPct = Number(((macdHistVal / cNow) * 100).toFixed(4));
    const intradayRangePct = Number(
      ((((currentCandle.high as number) - (currentCandle.low as number)) / cNow) * 100).toFixed(4)
    );

    const features: FeatureMap = {
      return1dPct,
      return5dPct,
      sma20DistancePct,
      sma50DistancePct,
      sma20OverSma50Pct,
      rsi14: Number(rsi14Val.toFixed(4)),
      macdHistogramPct,
      intradayRangePct,
      volatility5dPct,
    };

    const featureValues = FEATURE_NAMES.map((name) => features[name]);

    const nextSessionCandle = candles[i + 1];
    const nextSessionOpen = nextSessionCandle.open as number;
    const targetCandle = candles[targetIdx];
    const targetClose = targetCandle.close as number;
    const targetReturnPct = Number((((targetClose - cNow) / cNow) * 100).toFixed(4));
    const overnightGapReturnPct = Number((((nextSessionOpen - cNow) / cNow) * 100).toFixed(4));
    const openToTargetReturnPct = Number(
      (((targetClose - nextSessionOpen) / nextSessionOpen) * 100).toFixed(4)
    );
    const targetDirection = classifyReturnDirection(targetReturnPct);
    const targetWindowTimestamps = targetHorizonSlice.map((c) => c.timestamp);
    const targetValues = targetHorizonSlice.map((c) =>
      Number(((((c.close as number) - cNow) / cNow) * 100).toFixed(4))
    );

    // Enforce temporal integrity assertion at dataset construction time
    assertTemporalIntegrity(
      currentCandle.timestamp,
      targetCandle.timestamp,
      currentCandle.timestamp
    );
    const leakageCheck = verifyNoLookaheadLeakage(
      lookbackSlice.map((c) => c.timestamp),
      currentCandle.timestamp
    );
    if (leakageCheck.hasLeakage) {
      throw new Error(
        `Internal lookahead violation detected at ${currentCandle.dateString}: feature timestamp exceeded cutoff`
      );
    }

    const availableWindowCandles: ObservationCandleSnapshot[] = lookbackSlice.map((c) => ({
      timestamp: c.timestamp,
      dateString: c.dateString,
      open: c.open as number,
      high: c.high as number,
      low: c.low as number,
      close: c.close as number,
      adjClose: c.adjClose,
      volume: c.volume,
    }));

    if (isCalendarUnverified) {
      unverifiedCalendarObservationCount++;
    } else {
      verifiedCalendarObservationCount++;
    }
    if (hasAdjustedCloseDivergence) {
      adjustedPriceDivergenceCount++;
    }
    if (hasTargetHorizonDividendEvent) {
      targetDividendEventCount++;
    }

    usableObservations.push({
      symbol: series.symbol,
      exchange: series.exchange,
      instrumentType: series.type,
      timestamp: currentCandle.timestamp,
      predictionDateIST: currentCandle.dateString,
      windowStartTimestamp: lookbackSlice[0].timestamp,
      windowEndTimestamp: currentCandle.timestamp,
      lookbackWindowLength: lookbackSlice.length,
      availableWindowCandles,
      features,
      featureValues,
      forecastHorizonSessions,
      targetTimestamp: targetCandle.timestamp,
      targetDateIST: targetCandle.dateString,
      targetWindowTimestamps,
      currentClose: cNow,
      nextSessionOpen,
      targetClose,
      targetValue: targetReturnPct,
      targetReturnPct,
      targetTotalReturnAdjClosePct,
      overnightGapReturnPct,
      openToTargetReturnPct,
      targetDirection,
      targetValues,
      isMissing: false,
      hasMissingObservation: false,
      close: cNow,
      calendarStatus: currentCandle.calendarStatus,
      missingDataFlags: {
        hasMissingInLookbackWindow: false,
        hasMissingInTargetHorizon: false,
        isPredictionCandleIncompleteIntraday: false,
        isCalendarUnverified,
        hasAdjustedCloseDivergence,
        adjustmentRatioSpreadPct,
        hasTargetHorizonDividendEvent,
        targetDividendAdjustmentPct,
      },
      priceAdjustmentBasis: series.priceAdjustmentBasis,
      priceAdjustmentDisclosure: series.priceAdjustmentDisclosure,
      sourceProvenance: {
        provider: series.dataSource,
        fetchedAt: series.fetchTimestamp,
        fetchedAtIST: series.fetchTimestampIST,
        isOfficialCloseVerified: series.isOfficialCloseVerified,
        candleFormationStatus: series.latestCandleFormation,
        latestCandleFormationLabel: series.latestCandleFormationLabel,
      },
    });
  }

  return {
    symbol: series.symbol,
    exchange: series.exchange,
    instrumentType: series.type,
    forecastHorizonSessions,
    minLookbackCandles,
    totalRawCandles: n,
    usableObservations,
    verifiedCalendarObservationCount,
    unverifiedCalendarObservationCount,
    adjustedPriceDivergenceCount,
    targetDividendEventCount,
    exclusions,
    priceAdjustmentBasis: series.priceAdjustmentBasis,
    priceAdjustmentDisclosure: series.priceAdjustmentDisclosure,
    dataSource: series.dataSource,
  };
}

/**
 * Builds a unified reproducible historical prediction dataset across multiple instruments
 * (e.g., all 7 supported NSE/BSE indices and large-cap equities).
 */
export function buildMultiInstrumentPredictionDataset(
  seriesList: HistoricalSeries[],
  options: DatasetBuildOptions = {}
): MultiInstrumentPredictionDataset {
  const forecastHorizonSessions = options.forecastHorizonSessions ?? 1;
  const minLookbackCandles = Math.max(options.minLookbackCandles ?? 50, 50);

  const datasetsBySymbol: Record<string, HistoricalPredictionDataset> = {};
  const symbols: string[] = [];
  let totalRawCandlesAcrossInstruments = 0;
  let totalUsableObservations = 0;

  const aggregatedExclusions: DatasetExclusionSummary = {
    insufficientLookbackWarmup: 0,
    insufficientFutureHorizon: 0,
    incompleteIntradayBars: 0,
    missingOrInvalidLookbackCandles: 0,
    missingOrInvalidTargetCandles: 0,
    unverifiedCalendarDatesExcluded: 0,
    adjustedPriceDivergenceExcluded: 0,
    targetDividendEventsExcluded: 0,
  };

  for (const series of seriesList) {
    const ds = buildHistoricalPredictionDataset(series, options);
    datasetsBySymbol[series.symbol] = ds;
    symbols.push(series.symbol);
    totalRawCandlesAcrossInstruments += ds.totalRawCandles;
    totalUsableObservations += ds.usableObservations.length;

    aggregatedExclusions.insufficientLookbackWarmup += ds.exclusions.insufficientLookbackWarmup;
    aggregatedExclusions.insufficientFutureHorizon += ds.exclusions.insufficientFutureHorizon;
    aggregatedExclusions.incompleteIntradayBars += ds.exclusions.incompleteIntradayBars;
    aggregatedExclusions.missingOrInvalidLookbackCandles +=
      ds.exclusions.missingOrInvalidLookbackCandles;
    aggregatedExclusions.missingOrInvalidTargetCandles +=
      ds.exclusions.missingOrInvalidTargetCandles;
    aggregatedExclusions.unverifiedCalendarDatesExcluded +=
      ds.exclusions.unverifiedCalendarDatesExcluded;
    aggregatedExclusions.adjustedPriceDivergenceExcluded +=
      ds.exclusions.adjustedPriceDivergenceExcluded;
    aggregatedExclusions.targetDividendEventsExcluded +=
      ds.exclusions.targetDividendEventsExcluded;
  }

  return {
    instrumentCount: symbols.length,
    symbols,
    forecastHorizonSessions,
    minLookbackCandles,
    totalRawCandlesAcrossInstruments,
    totalUsableObservations,
    datasetsBySymbol,
    aggregatedExclusions,
  };
}

/**
 * Fits z-score normalization (mean, stdDev, min, max) and variance-based feature selection
 * STRICTLY on the training partition. Validation and test partitions are never seen here.
 */
export function fitTrainingPreprocessor(
  trainObservations: PredictionResearchObservation[],
  options: { varianceThreshold?: number; maxAllowedTimestamp?: number } = {}
): FittedFeaturePreprocessor {
  if (!Array.isArray(trainObservations) || trainObservations.length === 0) {
    throw new Error('Cannot fit preprocessor on an empty training partition');
  }

  const varianceThreshold = options.varianceThreshold ?? 1e-8;
  const maxAllowedTimestamp = options.maxAllowedTimestamp ?? Infinity;

  let fitMinTimestamp = Infinity;
  let fitMaxTimestamp = -Infinity;

  for (const obs of trainObservations) {
    if (obs.timestamp > maxAllowedTimestamp) {
      throw new Error(
        `Preprocessor lookahead leakage: training observation timestamp (${obs.timestamp}) exceeds allowed training cutoff (${maxAllowedTimestamp})`
      );
    }
    if (obs.timestamp < fitMinTimestamp) fitMinTimestamp = obs.timestamp;
    if (obs.timestamp > fitMaxTimestamp) fitMaxTimestamp = obs.timestamp;
  }

  const means = {} as Record<FeatureName, number>;
  const stdDevs = {} as Record<FeatureName, number>;
  const mins = {} as Record<FeatureName, number>;
  const maxs = {} as Record<FeatureName, number>;
  const selectedFeatureNames: FeatureName[] = [];
  const selectedFeatureIndices: number[] = [];

  FEATURE_NAMES.forEach((name, idx) => {
    const col = trainObservations.map((o) => o.features[name]);
    const mean = col.reduce((a, b) => a + b, 0) / col.length;
    const std = calculateSampleStdDev(col);
    const min = Math.min(...col);
    const max = Math.max(...col);

    means[name] = Number(mean.toFixed(6));
    stdDevs[name] = Number(std.toFixed(6));
    mins[name] = Number(min.toFixed(6));
    maxs[name] = Number(max.toFixed(6));

    // Variance feature selection fitted solely on train
    if (std * std > varianceThreshold) {
      selectedFeatureNames.push(name);
      selectedFeatureIndices.push(idx);
    }
  });

  return {
    featureNames: [...FEATURE_NAMES],
    selectedFeatureNames,
    selectedFeatureIndices,
    means,
    stdDevs,
    mins,
    maxs,
    fitSampleCount: trainObservations.length,
    fitMinTimestamp,
    fitMaxTimestamp,
    varianceThreshold,
  };
}

/**
 * Applies a previously training-fitted preprocessor to any partition (train, validation, or test)
 * without updating or refitting any statistics.
 */
export function transformObservationsWithPreprocessor<
  T extends PredictionResearchObservation = PredictionResearchObservation
>(observations: T[], preprocessor: FittedFeaturePreprocessor): ScaledObservation<T>[] {
  return observations.map((obs) => {
    const scaledFeatures = {} as Record<FeatureName, number>;
    for (const name of FEATURE_NAMES) {
      const raw = obs.features[name];
      const mean = preprocessor.means[name];
      const std = preprocessor.stdDevs[name];
      scaledFeatures[name] = std > 1e-8 ? Number(((raw - mean) / std).toFixed(6)) : 0;
    }
    const selectedFeatureVector = preprocessor.selectedFeatureNames.map(
      (name) => scaledFeatures[name]
    );
    return {
      observation: obs,
      scaledFeatures,
      selectedFeatureVector,
    };
  });
}

/**
 * Splits a historical prediction dataset chronologically into train, validation, and test,
 * embargoes/purges any boundary observations whose forward target horizons cross into the
 * next split, and fits normalization/feature selection strictly on the training split.
 */
export function prepareLeakageFreeResearchSplits(
  observations: PredictionResearchObservation[],
  trainRatio: number = 0.7,
  valRatio: number = 0.15,
  testRatio: number = 0.15,
  options: { purgeFeatureWindowOverlaps?: boolean; varianceThreshold?: number } = {}
): ResearchSplitPipelineResult {
  const recordsForSplit = observations.map((obs) => ({
    ...obs,
    windowStartTimestamp: options.purgeFeatureWindowOverlaps
      ? obs.windowStartTimestamp
      : obs.timestamp,
  }));

  const split = splitChronologically(recordsForSplit, trainRatio, valRatio, testRatio, {
    purgeBoundaryOverlaps: true,
    rejectOverlappingWindows: true,
    rejectMissingObservations: true,
  });

  const restoreOriginal = (arr: PredictionResearchObservation[]) => {
    const byTs = new Map(observations.map((o) => [o.timestamp, o]));
    return arr.map((r) => byTs.get(r.timestamp)!);
  };

  const train = restoreOriginal(split.train);
  const validation = restoreOriginal(split.validation);
  const test = restoreOriginal(split.test);

  if (train.length === 0) {
    throw new Error('Training partition is empty after chronological split and boundary embargo');
  }

  const maxAllowedTrainTs =
    validation.length > 0
      ? validation[0].timestamp - 1
      : test.length > 0
      ? test[0].timestamp - 1
      : Infinity;

  const preprocessor = fitTrainingPreprocessor(train, {
    varianceThreshold: options.varianceThreshold,
    maxAllowedTimestamp: maxAllowedTrainTs,
  });

  const scaledTrain = transformObservationsWithPreprocessor(train, preprocessor);
  const scaledValidation = transformObservationsWithPreprocessor(validation, preprocessor);
  const scaledTest = transformObservationsWithPreprocessor(test, preprocessor);

  return {
    train,
    validation,
    test,
    scaledTrain,
    scaledValidation,
    scaledTest,
    preprocessor,
    purgedRecordCount: split.purgedRecordCount,
    trainCutoffTimestamp: split.trainCutoffTimestamp,
    valCutoffTimestamp: split.valCutoffTimestamp,
    isStrictlyChronological: split.isStrictlyChronological,
    hasOverlappingWindows: split.hasOverlappingWindows,
    hasMissingObservations: split.hasMissingObservations,
  };
}

/**
 * BASELINE 1A: No-Change / Previous-Close Baseline (predicts future close == current close, return == 0%).
 * Evaluated on the exact same forecast horizon and evaluation dates as all other models.
 */
export function predictNoChangeBaseline(
  observations: PredictionResearchObservation[]
): BaselinePredictionPoint[] {
  return observations.map((obs) => ({
    symbol: obs.symbol,
    predictionTimestamp: obs.timestamp,
    predictionDateIST: obs.predictionDateIST,
    targetTimestamp: obs.targetTimestamp,
    targetDateIST: obs.targetDateIST,
    forecastHorizonSessions: obs.forecastHorizonSessions,
    currentClose: obs.currentClose,
    nextSessionOpen: obs.nextSessionOpen,
    actualTargetClose: obs.targetClose,
    actualReturnPct: obs.targetReturnPct,
    overnightGapReturnPct: obs.overnightGapReturnPct,
    openToTargetReturnPct: obs.openToTargetReturnPct,
    actualDirection: obs.targetDirection,
    predictedTargetClose: obs.currentClose,
    predictedReturnPct: 0,
    predictedDirection: 'FLAT',
    positionSignal: 0,
    baselineModelName: 'No-Change / Previous-Close Baseline',
    ruleExplanation: 'Predicts future close equals current close (0.00% return, neutral exposure).',
  }));
}

/**
 * BASELINE 1B: Previous-Close Return Persistence Baseline
 * Predicts next H-session return equals the most recent observed 1-day return,
 * testing naive random-walk momentum persistence.
 */
export function predictPreviousReturnPersistenceBaseline(
  observations: PredictionResearchObservation[]
): BaselinePredictionPoint[] {
  return observations.map((obs) => {
    const predictedReturnPct = Number(obs.features.return1dPct.toFixed(4));
    const predictedTargetClose = Number(
      (obs.currentClose * (1 + predictedReturnPct / 100)).toFixed(2)
    );
    const predictedDirection = classifyReturnDirection(predictedReturnPct);
    const positionSignal: -1 | 0 | 1 =
      predictedDirection === 'UP' ? 1 : predictedDirection === 'DOWN' ? -1 : 0;

    return {
      symbol: obs.symbol,
      predictionTimestamp: obs.timestamp,
      predictionDateIST: obs.predictionDateIST,
      targetTimestamp: obs.targetTimestamp,
      targetDateIST: obs.targetDateIST,
      forecastHorizonSessions: obs.forecastHorizonSessions,
      currentClose: obs.currentClose,
      nextSessionOpen: obs.nextSessionOpen,
      actualTargetClose: obs.targetClose,
      actualReturnPct: obs.targetReturnPct,
      overnightGapReturnPct: obs.overnightGapReturnPct,
      openToTargetReturnPct: obs.openToTargetReturnPct,
      actualDirection: obs.targetDirection,
      predictedTargetClose,
      predictedReturnPct,
      predictedDirection,
      positionSignal,
      baselineModelName: 'Previous-Close Return Persistence Baseline',
      ruleExplanation:
        'Extrapolates the latest observed 1-session return (return1dPct) as the forecast return.',
    };
  });
}

/**
 * BASELINE 2: Transparent Rule-Based Baseline (SMA 20/50 Trend + RSI 14 Regime Filter)
 * Deterministic, parameter-free rule using only features known at the prediction cutoff:
 * - Bullish Regime: SMA 20 > SMA 50 AND 50 < RSI(14) < 70 -> predicts damped 5-day average daily drift
 *   (+0.5 * (return5dPct / 5) * H if positive, else +0.10% * H), direction UP, positionSignal = +1.
 * - Bearish Regime: SMA 20 < SMA 50 AND 30 < RSI(14) < 50 -> predicts damped 5-day average daily drift
 *   (0.5 * (return5dPct / 5) * H if negative, else -0.10% * H), direction DOWN, positionSignal = -1.
 * - Neutral / Exhausted Regime (RSI >= 70 overbought, RSI <= 30 oversold, or conflicting trend/momentum):
 *   predicts 0.00% return (previous close), direction FLAT, positionSignal = 0.
 */
export function predictRuleBasedBaseline(
  observations: PredictionResearchObservation[]
): BaselinePredictionPoint[] {
  return observations.map((obs) => {
    const { sma20OverSma50Pct, rsi14, return5dPct } = obs.features;
    const h = obs.forecastHorizonSessions;

    let predictedReturnPct = 0;
    let predictedDirection: ForecastDirection = 'FLAT';
    let positionSignal: -1 | 0 | 1 = 0;
    let ruleExplanation =
      'Neutral regime (trend/RSI divergence or RSI overbought/oversold) -> 0.00% forecast.';

    if (sma20OverSma50Pct > 0 && rsi14 > 50 && rsi14 < 70) {
      const dailyMean5d = return5dPct / 5;
      predictedReturnPct = Number(
        (dailyMean5d > 0 ? dailyMean5d * h * 0.5 : 0.1 * h).toFixed(4)
      );
      predictedDirection = 'UP';
      positionSignal = 1;
      ruleExplanation = `Bullish alignment: SMA20 > SMA50 (+${sma20OverSma50Pct.toFixed(2)}%) and 50 < RSI14 (${rsi14.toFixed(1)}) < 70.`;
    } else if (sma20OverSma50Pct < 0 && rsi14 < 50 && rsi14 > 30) {
      const dailyMean5d = return5dPct / 5;
      predictedReturnPct = Number(
        (dailyMean5d < 0 ? dailyMean5d * h * 0.5 : -0.1 * h).toFixed(4)
      );
      predictedDirection = 'DOWN';
      positionSignal = -1;
      ruleExplanation = `Bearish alignment: SMA20 < SMA50 (${sma20OverSma50Pct.toFixed(2)}%) and 30 < RSI14 (${rsi14.toFixed(1)}) < 50.`;
    }

    const predictedTargetClose = Number(
      (obs.currentClose * (1 + predictedReturnPct / 100)).toFixed(2)
    );

    return {
      symbol: obs.symbol,
      predictionTimestamp: obs.timestamp,
      predictionDateIST: obs.predictionDateIST,
      targetTimestamp: obs.targetTimestamp,
      targetDateIST: obs.targetDateIST,
      forecastHorizonSessions: obs.forecastHorizonSessions,
      currentClose: obs.currentClose,
      nextSessionOpen: obs.nextSessionOpen,
      actualTargetClose: obs.targetClose,
      actualReturnPct: obs.targetReturnPct,
      overnightGapReturnPct: obs.overnightGapReturnPct,
      openToTargetReturnPct: obs.openToTargetReturnPct,
      actualDirection: obs.targetDirection,
      predictedTargetClose,
      predictedReturnPct,
      predictedDirection,
      positionSignal,
      baselineModelName: 'SMA(20/50) + RSI(14) Rule-Based Baseline',
      ruleExplanation,
    };
  });
}

/**
 * Evaluates a set of predictions on a unified forecast horizon and date set.
 *
 * BACKTEST MATHEMATICS & COST CONVENTION:
 * - Default Execution Basis: `'NEXT_OPEN_TO_CLOSE'` (signal generated after session `t` close enters at session `t+1` open
 *   and exits at session `t+H` close, eliminating same-bar closing auction fill bias). `'CLOSE_TO_CLOSE'` remains available
 *   for theoretical reference comparisons.
 * - Position sizing: 100% notional (unlevered, pos in {-1, 0, +1}) rebalanced at non-overlapping
 *   H-session steps (`i = 0, H, 2H, ...`). If `allowShortSelling === false`, `-1` signals are mapped to `0`.
 * - Decomposed Indian Market Transaction & Slippage Cost Schedule:
 *   Default 10.0 bps (0.10%) per 1.0 unit of one-way notional turnover (`turnover = |pos_t - pos_{t-1}|`), decomposed into:
 *     * Brokerage (`brokerageBpsPerTurn`): 3.0 bps
 *     * STT & Statutory Taxes (`sttAndTaxesBpsPerTurn`): 2.5 bps
 *     * NSE/BSE Exchange & SEBI Turnover Fees (`exchangeAndSebiChargesBpsPerTurn`): 0.5 bps
 *     * Bid-Ask Spread & Market-Impact Slippage (`slippageBpsPerTurn`): 4.0 bps
 *     * Entry from flat (`0 -> +1` or `0 -> -1`): 1.0 turnover unit -> 10 bps (0.10%).
 *     * Holding unchanged (`+1 -> +1` or `-1 -> -1`): 0.0 turnover units -> 0 bps.
 *     * Exit to flat (`+1 -> 0` or `-1 -> 0`): 1.0 turnover unit -> 10 bps (0.10%).
 *     * Direct reversal (`+1 -> -1` or `-1 -> +1`): 2.0 turnover units (exit old + enter new) -> 20 bps (0.20%).
 * - Terminal liquidation: If `terminalOpenPosition !== 0` at the end of the final bar, `terminalLiquidationCostPct`
 *   and `cumulativeReturnNetLiquidatedPct` report the round-trip return after closing the final position.
 */
export function evaluateBaselinePredictions(
  predictions: BaselinePredictionPoint[],
  options: EvaluationOptions = {}
): EvaluationMetricsReport {
  if (!Array.isArray(predictions) || predictions.length === 0) {
    throw new Error('Cannot evaluate an empty prediction list');
  }

  const symbol = predictions[0].symbol;
  const { tradability: instrumentTradability, disclosure: tradabilityDisclosure } =
    classifyInstrumentTradability(symbol);

  const executionBasis: ExecutionPriceBasis =
    options.executionBasis ?? 'INTRADAY_NEXT_OPEN_TO_CLOSE';

  const preset = options.useRealisticIndianCostPreset
    ? getRealisticIndianMarketCostPreset(
        symbol,
        executionBasis,
        options.indianCostPresetOptions
      )
    : null;

  const hasCustomComponentCosts =
    options.brokerageBpsPerTurn !== undefined ||
    options.sttAndTaxesBpsPerTurn !== undefined ||
    options.exchangeAndSebiChargesBpsPerTurn !== undefined ||
    options.slippageBpsPerTurn !== undefined;

  const rawBrokerageBps = options.brokerageBpsPerTurn ?? preset?.brokerageBpsPerTurn ?? 3.0;
  const rawSttBps = options.sttAndTaxesBpsPerTurn ?? preset?.sttAndTaxesBpsPerTurn ?? 2.5;
  const rawExchangeBps =
    options.exchangeAndSebiChargesBpsPerTurn ?? preset?.exchangeAndSebiChargesBpsPerTurn ?? 0.5;
  const rawSlippageBps = options.slippageBpsPerTurn ?? preset?.slippageBpsPerTurn ?? 4.0;
  const rawComponentSumBps = rawBrokerageBps + rawSttBps + rawExchangeBps + rawSlippageBps;

  const transactionCostBpsPerTurn =
    options.transactionCostBpsPerTurn !== undefined
      ? options.transactionCostBpsPerTurn
      : hasCustomComponentCosts || preset !== null
      ? Number(rawComponentSumBps.toFixed(5))
      : 10;

  const componentScale =
    rawComponentSumBps > 0 ? transactionCostBpsPerTurn / rawComponentSumBps : 0;
  const brokerageBpsPerTurn = Number((rawBrokerageBps * componentScale).toFixed(5));
  const sttAndTaxesBpsPerTurn = Number((rawSttBps * componentScale).toFixed(5));
  const exchangeAndSebiChargesBpsPerTurn = Number((rawExchangeBps * componentScale).toFixed(5));
  const slippageBpsPerTurn = Number((rawSlippageBps * componentScale).toFixed(5));

  const useSideSpecificPresetSchedule =
    preset !== null &&
    options.transactionCostBpsPerTurn === undefined &&
    !hasCustomComponentCosts;

  const buySideCostBpsPerTurn = useSideSpecificPresetSchedule
    ? preset.buySide.totalCostBps
    : transactionCostBpsPerTurn;
  const sellSideCostBpsPerTurn = useSideSpecificPresetSchedule
    ? preset.sellSide.totalCostBps
    : transactionCostBpsPerTurn;

  const sttBpsPerTurn = useSideSpecificPresetSchedule
    ? preset.sttBpsPerTurn
    : sttAndTaxesBpsPerTurn;
  const stampDutyBpsPerTurn = useSideSpecificPresetSchedule
    ? preset.stampDutyBpsPerTurn
    : 0;
  const exchangeTransactionChargesBpsPerTurn = useSideSpecificPresetSchedule
    ? preset.exchangeTransactionChargesBpsPerTurn
    : exchangeAndSebiChargesBpsPerTurn;
  const sebiChargesBpsPerTurn = useSideSpecificPresetSchedule
    ? preset.sebiChargesBpsPerTurn
    : 0;
  const dpChargesBpsPerTurn = useSideSpecificPresetSchedule
    ? preset.dpChargesBpsPerTurn
    : 0;
  const gstBpsPerTurn = useSideSpecificPresetSchedule ? preset.gstBpsPerTurn : 0;

  const allowShortSelling = options.allowShortSelling ?? true;

  const modelName = predictions[0].baselineModelName;
  const forecastHorizonSessions = predictions[0].forecastHorizonSessions;
  const n = predictions.length;
  const effectiveIndependentSampleCount = Math.max(1, Math.floor(n / forecastHorizonSessions));

  const absReturnErrors: number[] = [];
  let sumAbsReturnError = 0;
  let sumSqReturnError = 0;
  let sumAbsPriceError = 0;
  let directionalHits = 0;
  let activeCalls = 0;
  let activeDirectionalHits = 0;

  for (const p of predictions) {
    if (p.forecastHorizonSessions !== forecastHorizonSessions) {
      throw new Error(
        `Inconsistent forecastHorizonSessions in evaluation: expected ${forecastHorizonSessions}, found ${p.forecastHorizonSessions}`
      );
    }
    const errRet = Math.abs(p.predictedReturnPct - p.actualReturnPct);
    absReturnErrors.push(errRet);
    sumAbsReturnError += errRet;
    sumSqReturnError += errRet * errRet;
    sumAbsPriceError += Math.abs(p.predictedTargetClose - p.actualTargetClose);

    if (p.predictedDirection === p.actualDirection) {
      directionalHits++;
    }
    if (p.predictedDirection !== 'FLAT') {
      activeCalls++;
      if (p.predictedDirection === p.actualDirection) {
        activeDirectionalHits++;
      }
    }
  }

  const maeReturnPct = Number((sumAbsReturnError / n).toFixed(4));
  const rmseReturnPct = Number(Math.sqrt(sumSqReturnError / n).toFixed(4));
  const maePriceINR = Number((sumAbsPriceError / n).toFixed(2));
  const absErrStd = calculateSampleStdDev(absReturnErrors);
  const maeReturnSePct = n > 1 ? Number((absErrStd / Math.sqrt(n)).toFixed(4)) : 0;
  const maeReturnCi95HalfWidthPct = Number((1.959963984540054 * maeReturnSePct).toFixed(4));
  const maeReturnCi95LowerPct = Number(
    Math.max(0, maeReturnPct - maeReturnCi95HalfWidthPct).toFixed(4)
  );
  const maeReturnCi95UpperPct = Number((maeReturnPct + maeReturnCi95HalfWidthPct).toFixed(4));

  // Newey-West HAC standard error for MAE accounting for serial correlation & overlapping horizons (bandwidth = max(H - 1, 1))
  const nwLag = Math.max(forecastHorizonSessions - 1, 1);
  const maeReturnHacSePct =
    n > 1 ? Number(calculateNeweyWestMeanStandardError(absReturnErrors, nwLag).toFixed(4)) : 0;
  const maeHacHalfWidth = 1.959963984540054 * maeReturnHacSePct;
  const maeReturnHacCi95LowerPct = Number(Math.max(0, maeReturnPct - maeHacHalfWidth).toFixed(4));
  const maeReturnHacCi95UpperPct = Number((maeReturnPct + maeHacHalfWidth).toFixed(4));

  const directionalAccuracyPct = Number(((directionalHits / n) * 100).toFixed(2));
  const activeCallRatePct = Number(((activeCalls / n) * 100).toFixed(2));
  const activeDirectionalAccuracyPct =
    activeCalls > 0 ? Number(((activeDirectionalHits / activeCalls) * 100).toFixed(2)) : 0;

  const activeWilson = calculateWilsonScoreCi95Pct(activeDirectionalHits, activeCalls);

  // Risk-aware backtest stepped at non-overlapping horizon intervals (step = forecastHorizonSessions)
  const isIntradayMode =
    executionBasis === 'INTRADAY_NEXT_OPEN_TO_CLOSE' ||
    executionBasis === 'NEXT_OPEN_TO_CLOSE';
  const isMultiDayOpenExecutionMode = executionBasis === 'MULTI_DAY_POSITION';

  const stepReturnsNet: number[] = [];
  let equityGross = 1.0;
  let equityNet = 1.0;
  let peakEquityNet = 1.0;
  let maxDrawdownPct = 0;
  let prevPosition: number = 0;

  let grossStepWins = 0;
  let grossStepLosses = 0;
  let netStepWins = 0;
  let netStepLosses = 0;
  let netWinningActiveSteps = 0;
  let activeStepCount = 0;
  let longStepCount = 0;
  let shortStepCount = 0;
  let flatStepCount = 0;
  let nonOverlappingStepCount = 0;

  let tradeChangeCount = 0;
  let entryCount = 0;
  let exitCount = 0;
  let reversalCount = 0;
  let totalBuyTurnoverUnits = 0;
  let totalSellTurnoverUnits = 0;
  let totalTurnoverUnits = 0;
  let totalTransactionCostPct = 0;

  let accumBrokeragePct = 0;
  let accumSttPct = 0;
  let accumStampDutyPct = 0;
  let accumExchangeTxnPct = 0;
  let accumSebiPct = 0;
  let accumDpPct = 0;
  let accumGstPct = 0;
  let accumSlippagePct = 0;

  for (let i = 0; i < n; i += forecastHorizonSessions) {
    const p = predictions[i];
    nonOverlappingStepCount++;

    const rawPos =
      typeof p.positionSize === 'number' && Number.isFinite(p.positionSize)
        ? Math.max(-1, Math.min(1, p.positionSize))
        : p.positionSignal;
    const pos: number = !allowShortSelling && rawPos < 0 ? 0 : rawPos;

    if (pos > 1e-9) longStepCount++;
    else if (pos < -1e-9) shortStepCount++;
    else flatStepCount++;

    let buyTurn = 0;
    let sellTurn = 0;
    let turnover = 0;
    let stepGrossRetPct = 0;

    const intradayOpenToCloseRetPct =
      typeof p.openToTargetReturnPct === 'number'
        ? p.openToTargetReturnPct
        : p.actualReturnPct;

    const overnightGapRetPct =
      typeof p.overnightGapReturnPct === 'number'
        ? p.overnightGapReturnPct
        : typeof p.nextSessionOpen === 'number' && p.currentClose > 0
        ? ((p.nextSessionOpen - p.currentClose) / p.currentClose) * 100
        : 0;

    if (isIntradayMode) {
      // MODE A: INTRADAY_NEXT_OPEN_TO_CLOSE
      // - Signal formed after session t close.
      // - Enters at session t+1 open (|pos| turn) and exits to flat at session t+H close (|pos| turn).
      // - Whether long (BUY at open, SELL at close) or short (SELL at open, BUY at close),
      //   each completed intraday round trip executes |pos| BUY turn and |pos| SELL turn.
      // - Never carries a closed intraday position overnight into the next session (prevPosition = 0).
      if (Math.abs(pos) > 1e-9) {
        buyTurn = Math.abs(pos);
        sellTurn = Math.abs(pos);
        turnover = buyTurn + sellTurn;
        tradeChangeCount += 2;
        entryCount += 1;
        exitCount += 1;
      } else {
        buyTurn = 0;
        sellTurn = 0;
        turnover = 0;
      }
      stepGrossRetPct = pos * intradayOpenToCloseRetPct;
      prevPosition = 0;
    } else if (isMultiDayOpenExecutionMode) {
      // MODE B: MULTI_DAY_POSITION
      // - Signal formed after session t close; earliest executable order time is session t+1 open.
      // - During the overnight gap (Close_t -> Open_{t+1}), the prior position (prevPosition) is still held
      //   and experiences overnightGapRetPct.
      // - At Open_{t+1}, rebalances prevPosition -> pos:
      //   deltaPos > 0 executes a BUY of deltaPos; deltaPos < 0 executes a SELL of |deltaPos|.
      // - During Open_{t+1} -> Close_{t+H}, holds pos and experiences intradayOpenToCloseRetPct.
      const overnightGrossFactor = 1 + (prevPosition * overnightGapRetPct) / 100;
      const intradayGrossFactor = 1 + (pos * intradayOpenToCloseRetPct) / 100;
      stepGrossRetPct = (overnightGrossFactor * intradayGrossFactor - 1) * 100;

      const deltaPos = pos - prevPosition;
      buyTurn = deltaPos > 1e-9 ? deltaPos : 0;
      sellTurn = deltaPos < -1e-9 ? -deltaPos : 0;
      turnover = buyTurn + sellTurn;

      if (turnover > 1e-9) {
        tradeChangeCount++;
        if (prevPosition * pos < -1e-9) {
          reversalCount++;
          exitCount++;
          entryCount++;
        } else if (Math.abs(pos) > Math.abs(prevPosition) + 1e-9) {
          entryCount++;
        } else if (Math.abs(pos) + 1e-9 < Math.abs(prevPosition)) {
          exitCount++;
        }
      }
      prevPosition = pos;
    } else {
      // REFERENCE MODE: CLOSE_TO_CLOSE
      // - Theoretical synchronous close-to-close execution at session t close.
      const deltaPos = pos - prevPosition;
      buyTurn = deltaPos > 1e-9 ? deltaPos : 0;
      sellTurn = deltaPos < -1e-9 ? -deltaPos : 0;
      turnover = buyTurn + sellTurn;

      if (turnover > 1e-9) {
        tradeChangeCount++;
        if (prevPosition * pos < -1e-9) {
          reversalCount++;
          exitCount++;
          entryCount++;
        } else if (Math.abs(pos) > Math.abs(prevPosition) + 1e-9) {
          entryCount++;
        } else if (Math.abs(pos) + 1e-9 < Math.abs(prevPosition)) {
          exitCount++;
        }
      }
      stepGrossRetPct = pos * p.actualReturnPct;
      prevPosition = pos;
    }

    totalBuyTurnoverUnits = Number((totalBuyTurnoverUnits + buyTurn).toFixed(6));
    totalSellTurnoverUnits = Number((totalSellTurnoverUnits + sellTurn).toFixed(6));
    totalTurnoverUnits = Number((totalTurnoverUnits + turnover).toFixed(6));

    const stepCostPct =
      (buyTurn * buySideCostBpsPerTurn + sellTurn * sellSideCostBpsPerTurn) / 100;
    totalTransactionCostPct += stepCostPct;

    if (useSideSpecificPresetSchedule && preset !== null) {
      accumBrokeragePct +=
        (buyTurn * preset.buySide.brokerageBps + sellTurn * preset.sellSide.brokerageBps) / 100;
      accumSttPct +=
        (buyTurn * preset.buySide.sttBps + sellTurn * preset.sellSide.sttBps) / 100;
      accumStampDutyPct +=
        (buyTurn * preset.buySide.stampDutyBps + sellTurn * preset.sellSide.stampDutyBps) / 100;
      accumExchangeTxnPct +=
        (buyTurn * preset.buySide.exchangeTransactionChargesBps +
          sellTurn * preset.sellSide.exchangeTransactionChargesBps) /
        100;
      accumSebiPct +=
        (buyTurn * preset.buySide.sebiChargesBps + sellTurn * preset.sellSide.sebiChargesBps) /
        100;
      accumDpPct +=
        (buyTurn * preset.buySide.dpChargesBps + sellTurn * preset.sellSide.dpChargesBps) / 100;
      accumGstPct +=
        (buyTurn * preset.buySide.gstBps + sellTurn * preset.sellSide.gstBps) / 100;
      accumSlippagePct +=
        (buyTurn * preset.buySide.slippageBps + sellTurn * preset.sellSide.slippageBps) / 100;
    } else {
      accumBrokeragePct += turnover * (brokerageBpsPerTurn / 100);
      accumSttPct += turnover * (sttAndTaxesBpsPerTurn / 100);
      accumExchangeTxnPct += turnover * (exchangeAndSebiChargesBpsPerTurn / 100);
      accumSlippagePct += turnover * (slippageBpsPerTurn / 100);
    }

    const stepNetRetPct = stepGrossRetPct - stepCostPct;
    stepReturnsNet.push(stepNetRetPct);

    equityGross *= 1 + stepGrossRetPct / 100;
    equityNet *= 1 + stepNetRetPct / 100;

    if (equityNet > peakEquityNet) {
      peakEquityNet = equityNet;
    }
    const ddPct = ((peakEquityNet - equityNet) / peakEquityNet) * 100;
    if (ddPct > maxDrawdownPct) {
      maxDrawdownPct = ddPct;
    }

    // Track gross wins/losses across steps
    if (stepGrossRetPct > 0) {
      grossStepWins += stepGrossRetPct;
    } else if (stepGrossRetPct < 0) {
      grossStepLosses += Math.abs(stepGrossRetPct);
    }

    // Track net wins/losses across ALL steps (including exit-to-flat steps where stepNetRetPct = -stepCostPct)
    if (stepNetRetPct > 0) {
      netStepWins += stepNetRetPct;
    } else if (stepNetRetPct < 0) {
      netStepLosses += Math.abs(stepNetRetPct);
    }

    if (Math.abs(pos) > 1e-9) {
      activeStepCount++;
      if (stepNetRetPct > 0) {
        netWinningActiveSteps++;
      }
    }
  }

  const terminalOpenPosition = isIntradayMode ? 0 : Number(prevPosition.toFixed(6));
  // Closing a long terminal position (> 0) is a SELL order; closing a short terminal position (< 0) is a BUY order
  const terminalLiquidationRateBps =
    terminalOpenPosition > 0
      ? sellSideCostBpsPerTurn
      : terminalOpenPosition < 0
      ? buySideCostBpsPerTurn
      : 0;
  const terminalLiquidationCostPct = Number(
    ((Math.abs(terminalOpenPosition) * terminalLiquidationRateBps) / 100).toFixed(4)
  );
  const equityNetLiquidated = equityNet * (1 - terminalLiquidationCostPct / 100);

  const totalBrokerageCostPct = Number(accumBrokeragePct.toFixed(4));
  const totalSttCostPct = Number(accumSttPct.toFixed(4));
  const totalStampDutyCostPct = Number(accumStampDutyPct.toFixed(4));
  const totalTaxesAndSttPct = Number((accumSttPct + accumStampDutyPct).toFixed(4));
  const totalExchangeTransactionChargesPct = Number(accumExchangeTxnPct.toFixed(4));
  const totalSebiChargesPct = Number(accumSebiPct.toFixed(4));
  const totalDpChargesPct = Number(accumDpPct.toFixed(4));
  const totalGstCostPct = Number(accumGstPct.toFixed(4));
  const totalExchangeChargesPct = Number(
    (accumExchangeTxnPct + accumSebiPct + accumDpPct + accumGstPct).toFixed(4)
  );
  const totalSlippageCostPct = Number(accumSlippagePct.toFixed(4));

  const exposurePct =
    nonOverlappingStepCount > 0
      ? Number(((activeStepCount / nonOverlappingStepCount) * 100).toFixed(2))
      : 0;

  const cumulativeReturnGrossPct = Number(((equityGross - 1) * 100).toFixed(4));
  const cumulativeReturnNetPct = Number(((equityNet - 1) * 100).toFixed(4));
  const cumulativeReturnNetLiquidatedPct = Number(((equityNetLiquidated - 1) * 100).toFixed(4));
  const stepStdPct = calculateSampleStdDev(stepReturnsNet);
  const periodsPerYear = 252 / forecastHorizonSessions;
  const annualizedVolatilityPct = Number((stepStdPct * Math.sqrt(periodsPerYear)).toFixed(4));

  const meanStepNetPct =
    stepReturnsNet.length > 0
      ? stepReturnsNet.reduce((a, b) => a + b, 0) / stepReturnsNet.length
      : 0;
  const stepSharpe = stepStdPct > 1e-8 ? meanStepNetPct / stepStdPct : 0;
  const sharpeRatioZeroRf =
    stepStdPct > 1e-8
      ? Number((stepSharpe * Math.sqrt(periodsPerYear)).toFixed(4))
      : 0;

  // Lo (2002) i.i.d. asymptotic standard error for annualized Sharpe ratio:
  // SE(SR_ann) = sqrt((1 + 0.5 * SR_step^2) / M) * sqrt(periodsPerYear)
  const sharpeRatioSe =
    stepStdPct > 1e-8 && nonOverlappingStepCount > 1
      ? Number(
          (
            Math.sqrt((1 + 0.5 * stepSharpe * stepSharpe) / nonOverlappingStepCount) *
            Math.sqrt(periodsPerYear)
          ).toFixed(4)
        )
      : 0;
  const sharpeCiHalfWidth = 1.959963984540054 * sharpeRatioSe;
  const sharpeRatioCi95Lower = Number((sharpeRatioZeroRf - sharpeCiHalfWidth).toFixed(4));
  const sharpeRatioCi95Upper = Number((sharpeRatioZeroRf + sharpeCiHalfWidth).toFixed(4));

  // Lo (2002) autocorrelation-adjusted (HAC) standard error for annualized Sharpe ratio:
  const stepReturnLag1Autocorrelation = Number(
    calculateLag1Autocorrelation(stepReturnsNet).toFixed(4)
  );
  const autocorrScale = Math.max(
    0.5,
    (1 + stepReturnLag1Autocorrelation) / Math.max(0.05, 1 - stepReturnLag1Autocorrelation)
  );
  const sharpeRatioHacSe = Number((sharpeRatioSe * Math.sqrt(autocorrScale)).toFixed(4));
  const sharpeHacHalfWidth = 1.959963984540054 * sharpeRatioHacSe;
  const sharpeRatioHacCi95Lower = Number((sharpeRatioZeroRf - sharpeHacHalfWidth).toFixed(4));
  const sharpeRatioHacCi95Upper = Number((sharpeRatioZeroRf + sharpeHacHalfWidth).toFixed(4));

  const grossProfitFactor =
    grossStepLosses > 1e-8
      ? Number((grossStepWins / grossStepLosses).toFixed(4))
      : grossStepWins > 0
      ? 999.9999
      : 0;

  const profitFactor =
    netStepLosses > 1e-8
      ? Number((netStepWins / netStepLosses).toFixed(4))
      : netStepWins > 0
      ? 999.9999
      : 0;

  const winRatePct =
    activeStepCount > 0
      ? Number(((netWinningActiveSteps / activeStepCount) * 100).toFixed(2))
      : 0;

  return {
    modelName,
    forecastHorizonSessions,
    sampleCount: n,
    effectiveIndependentSampleCount,
    evaluationStartDateIST: predictions[0].predictionDateIST,
    evaluationEndDateIST: predictions[n - 1].predictionDateIST,
    evaluationTimestamps: predictions.map((p) => p.predictionTimestamp),
    executionBasis,
    allowShortSelling,
    instrumentTradability,
    tradabilityDisclosure,
    maeReturnPct,
    rmseReturnPct,
    maePriceINR,
    maeReturnSePct,
    maeReturnCi95HalfWidthPct,
    maeReturnCi95LowerPct,
    maeReturnCi95UpperPct,
    maeReturnHacSePct,
    maeReturnHacCi95LowerPct,
    maeReturnHacCi95UpperPct,
    directionalAccuracyPct,
    directionalAccuracyNumerator: directionalHits,
    directionalAccuracyDenominator: n,
    activeDirectionalAccuracyPct,
    activeHitRateNumerator: activeDirectionalHits,
    activeHitRateDenominator: activeCalls,
    activeCallCount: activeCalls,
    activeCallRatePct,
    activeHitRateSePct: activeWilson.sePct,
    activeHitRateCi95LowerPct: activeWilson.lowerPct,
    activeHitRateCi95UpperPct: activeWilson.upperPct,
    transactionCostBpsPerTurn,
    buySideCostBpsPerTurn,
    sellSideCostBpsPerTurn,
    brokerageBpsPerTurn,
    sttBpsPerTurn,
    stampDutyBpsPerTurn,
    sttAndTaxesBpsPerTurn,
    exchangeTransactionChargesBpsPerTurn,
    sebiChargesBpsPerTurn,
    dpChargesBpsPerTurn,
    gstBpsPerTurn,
    exchangeAndSebiChargesBpsPerTurn,
    slippageBpsPerTurn,
    nonOverlappingStepCount,
    longStepCount,
    shortStepCount,
    flatStepCount,
    exposurePct,
    tradeChangeCount,
    entryCount,
    exitCount,
    reversalCount,
    totalBuyTurnoverUnits,
    totalSellTurnoverUnits,
    totalTurnoverUnits,
    totalTransactionCostPct: Number(totalTransactionCostPct.toFixed(4)),
    totalBrokerageCostPct,
    totalSttCostPct,
    totalStampDutyCostPct,
    totalTaxesAndSttPct,
    totalExchangeTransactionChargesPct,
    totalSebiChargesPct,
    totalDpChargesPct,
    totalGstCostPct,
    totalExchangeChargesPct,
    totalSlippageCostPct,
    terminalOpenPosition,
    terminalLiquidationCostPct,
    cumulativeReturnGrossPct,
    cumulativeReturnNetPct,
    cumulativeReturnNetLiquidatedPct,
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(4)),
    annualizedVolatilityPct,
    sharpeRatioZeroRf,
    sharpeRatioSe,
    sharpeRatioCi95Lower,
    sharpeRatioCi95Upper,
    stepReturnLag1Autocorrelation,
    sharpeRatioHacSe,
    sharpeRatioHacCi95Lower,
    sharpeRatioHacCi95Upper,
    grossProfitFactor,
    profitFactor,
    winRatePct,
    limitationsDisclosure: EVALUATION_LIMITATIONS_DISCLOSURE,
  };
}

/**
 * Verifies that two BaselinePredictionPoint arrays were evaluated on the exact same
 * timestamps and forecast horizon, enabling fair side-by-side baseline comparison.
 */
export function verifyAlignedEvaluationComparison(
  baselineA: BaselinePredictionPoint[],
  baselineB: BaselinePredictionPoint[]
): boolean {
  if (baselineA.length !== baselineB.length) return false;
  for (let i = 0; i < baselineA.length; i++) {
    if (
      baselineA[i].predictionTimestamp !== baselineB[i].predictionTimestamp ||
      baselineA[i].targetTimestamp !== baselineB[i].targetTimestamp ||
      baselineA[i].forecastHorizonSessions !== baselineB[i].forecastHorizonSessions
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Runs No-Change, Previous-Return Persistence, and SMA+RSI Rule-Based baselines on the exact
 * same evaluation partition (validation or test) and verifies date/horizon alignment.
 */
export function compareBaselinesOnEvaluationSplit(
  observations: PredictionResearchObservation[],
  partitionName: 'VALIDATION' | 'TEST' = 'TEST',
  options: EvaluationOptions = {}
): BaselineComparisonResult {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error(`Cannot compare baselines on an empty ${partitionName} partition`);
  }

  const noChangePreds = predictNoChangeBaseline(observations);
  const persistencePreds = predictPreviousReturnPersistenceBaseline(observations);
  const rulePreds = predictRuleBasedBaseline(observations);

  const isAligned =
    verifyAlignedEvaluationComparison(noChangePreds, persistencePreds) &&
    verifyAlignedEvaluationComparison(noChangePreds, rulePreds);

  if (!isAligned) {
    throw new Error('Baseline evaluation alignment check failed: mismatched timestamps or horizons');
  }

  return {
    symbol: observations[0].symbol,
    partitionName,
    forecastHorizonSessions: observations[0].forecastHorizonSessions,
    sampleCount: observations.length,
    evaluationStartDateIST: observations[0].predictionDateIST,
    evaluationEndDateIST: observations[observations.length - 1].predictionDateIST,
    isAligned,
    noChangeBaseline: {
      predictions: noChangePreds,
      metrics: evaluateBaselinePredictions(noChangePreds, options),
    },
    returnPersistenceBaseline: {
      predictions: persistencePreds,
      metrics: evaluateBaselinePredictions(persistencePreds, options),
    },
    ruleBasedBaseline: {
      predictions: rulePreds,
      metrics: evaluateBaselinePredictions(rulePreds, options),
    },
  };
}

/**
 * Stage 4B Preparation (Task 3): Runs expanding-window chronological walk-forward validation
 * alongside a strictly isolated final holdout test partition.
 *
 * Walk-Forward Protocol:
 * 1. Verifies observations are strictly ordered in time (`timestamp[k] > timestamp[k-1]`).
 * 2. Reserves the final `holdoutTestRatio` (default 15%) as an untouched out-of-sample `holdoutTest`
 *    partition, purging any boundary development observations whose forward targets (`targetTimestamp`)
 *    cross into `holdoutTest[0].timestamp`.
 * 3. Partitions the pre-holdout development set into an initial training anchor (`minInitialTrainRatio`,
 *    default 40%) followed by `numFolds` (default 4) sequential non-overlapping validation folds.
 * 4. For each fold `f = 1..numFolds`:
 *    - Training set is the expanding prefix `[0 .. valStartIdx - 1]` with boundary target purging
 *      so no training observation has `targetTimestamp >= validation[0].timestamp`.
 *    - Fits `fitTrainingPreprocessor` strictly on the fold's purged training observations.
 *    - Evaluates all three baselines on the fold's validation observations.
 * 5. Aggregates all out-of-sample validation observations across all `numFolds` into a pooled
 *    walk-forward comparison (`pooledWalkForwardComparison`) and also evaluates the isolated
 *    `holdoutTestComparison` with a preprocessor fit solely on pre-holdout development data.
 */
export function runExpandingWalkForwardValidation(
  observations: PredictionResearchObservation[],
  options: WalkForwardValidationOptions = {}
): WalkForwardValidationReport {
  if (!Array.isArray(observations) || observations.length < 20) {
    throw new Error(
      `Expanding walk-forward validation requires at least 20 observations (received ${observations?.length ?? 0})`
    );
  }

  for (let i = 1; i < observations.length; i++) {
    if (observations[i].timestamp <= observations[i - 1].timestamp) {
      throw new Error(
        `Observations must be strictly chronological for walk-forward validation (violation at index ${i})`
      );
    }
  }

  const numFolds = options.numFolds ?? 4;
  const minInitialTrainRatio = options.minInitialTrainRatio ?? 0.4;
  const holdoutTestRatio = options.holdoutTestRatio ?? 0.15;

  if (!Number.isInteger(numFolds) || numFolds < 2) {
    throw new Error(`numFolds must be an integer >= 2 (received ${numFolds})`);
  }
  if (minInitialTrainRatio <= 0.1 || minInitialTrainRatio >= 0.85) {
    throw new Error(`minInitialTrainRatio must be between 0.10 and 0.85 (received ${minInitialTrainRatio})`);
  }
  if (holdoutTestRatio < 0 || holdoutTestRatio >= 0.5) {
    throw new Error(`holdoutTestRatio must be between 0.0 and 0.50 (received ${holdoutTestRatio})`);
  }

  const totalN = observations.length;
  const holdoutCount =
    holdoutTestRatio > 0 ? Math.max(1, Math.floor(totalN * holdoutTestRatio)) : 0;
  const devRawEndIdx = totalN - holdoutCount;
  const holdoutTestRaw = holdoutCount > 0 ? observations.slice(devRawEndIdx) : [];
  const holdoutFirstTs =
    holdoutTestRaw.length > 0 ? holdoutTestRaw[0].timestamp : Infinity;

  // Purge any development observation whose forward target crosses into the isolated holdout test partition
  const devCandidates = observations.slice(0, devRawEndIdx);
  const devObservations = devCandidates.filter((obs) => obs.targetTimestamp < holdoutFirstTs);
  const holdoutPurgedBoundaryCount = devCandidates.length - devObservations.length;

  const devN = devObservations.length;
  const initialTrainCount = Math.max(5, Math.floor(devN * minInitialTrainRatio));
  const remainingForValidation = devN - initialTrainCount;
  if (remainingForValidation < numFolds) {
    throw new Error(
      `Insufficient development observations (${devN}) to form ${numFolds} validation folds after initial train (${initialTrainCount})`
    );
  }

  const baseFoldSize = Math.floor(remainingForValidation / numFolds);
  const foldRemainder = remainingForValidation % numFolds;

  const folds: WalkForwardFoldResult[] = [];
  const pooledValidationObservations: PredictionResearchObservation[] = [];
  const seenValTimestamps = new Set<number>();
  let hasZeroFoldOverlap = true;

  let currentValStartIdx = initialTrainCount;
  for (let f = 0; f < numFolds; f++) {
    const foldValCount = baseFoldSize + (f < foldRemainder ? 1 : 0);
    const currentValEndIdx = currentValStartIdx + foldValCount;

    const foldValObs = devObservations.slice(currentValStartIdx, currentValEndIdx);
    const valFirstTs = foldValObs[0].timestamp;

    // Expanding training prefix strictly prior to currentValStartIdx, purged of any forward targets crossing into foldValObs
    const rawTrainPrefix = devObservations.slice(0, currentValStartIdx);
    const purgedTrainPrefix = rawTrainPrefix.filter(
      (obs) => obs.targetTimestamp < valFirstTs
    );
    const purgedBoundaryRecordCount = rawTrainPrefix.length - purgedTrainPrefix.length;

    if (purgedTrainPrefix.length === 0) {
      throw new Error(`Fold ${f + 1} training partition is empty after boundary target purging`);
    }

    // Verify no validation timestamp overlap across folds
    for (const vObs of foldValObs) {
      if (seenValTimestamps.has(vObs.timestamp)) {
        hasZeroFoldOverlap = false;
      }
      seenValTimestamps.add(vObs.timestamp);
      pooledValidationObservations.push(vObs);
    }

    const foldPreprocessor = fitTrainingPreprocessor(purgedTrainPrefix, {
      varianceThreshold: options.varianceThreshold,
      maxAllowedTimestamp: valFirstTs - 1,
    });

    const scaledTrain = transformObservationsWithPreprocessor(
      purgedTrainPrefix,
      foldPreprocessor
    );
    const scaledValidation = transformObservationsWithPreprocessor(
      foldValObs,
      foldPreprocessor
    );

    const foldComparison = compareBaselinesOnEvaluationSplit(
      foldValObs,
      'VALIDATION',
      options
    );

    folds.push({
      foldIndex: f + 1,
      trainSampleCount: purgedTrainPrefix.length,
      trainStartDateIST: purgedTrainPrefix[0].predictionDateIST,
      trainEndDateIST: purgedTrainPrefix[purgedTrainPrefix.length - 1].predictionDateIST,
      trainMinTimestamp: purgedTrainPrefix[0].timestamp,
      trainMaxTimestamp: purgedTrainPrefix[purgedTrainPrefix.length - 1].timestamp,
      validationSampleCount: foldValObs.length,
      validationStartDateIST: foldValObs[0].predictionDateIST,
      validationEndDateIST: foldValObs[foldValObs.length - 1].predictionDateIST,
      validationMinTimestamp: foldValObs[0].timestamp,
      validationMaxTimestamp: foldValObs[foldValObs.length - 1].timestamp,
      purgedBoundaryRecordCount,
      trainObservations: purgedTrainPrefix,
      validationObservations: foldValObs,
      scaledTrain,
      scaledValidation,
      preprocessor: foldPreprocessor,
      comparison: foldComparison,
    });

    currentValStartIdx = currentValEndIdx;
  }

  const pooledWalkForwardComparison = compareBaselinesOnEvaluationSplit(
    pooledValidationObservations,
    'VALIDATION',
    options
  );

  const holdoutTestPreprocessor = fitTrainingPreprocessor(devObservations, {
    varianceThreshold: options.varianceThreshold,
    maxAllowedTimestamp: holdoutFirstTs - 1,
  });

  const holdoutEvalSet =
    holdoutTestRaw.length > 0 ? holdoutTestRaw : pooledValidationObservations;
  const holdoutTestComparison = compareBaselinesOnEvaluationSplit(
    holdoutEvalSet,
    'TEST',
    options
  );

  const symbol = observations[0].symbol;
  const { tradability: instrumentTradability } = classifyInstrumentTradability(symbol);

  return {
    symbol,
    instrumentTradability,
    forecastHorizonSessions: observations[0].forecastHorizonSessions,
    numFolds,
    totalUsableObservations: totalN,
    developmentObservationCount: devN,
    totalWalkForwardValidationSamples: pooledValidationObservations.length,
    holdoutTestSampleCount: holdoutTestRaw.length,
    holdoutPurgedBoundaryCount,
    isStrictlyChronological: true,
    hasZeroFoldOverlap,
    folds,
    pooledWalkForwardComparison,
    holdoutTestComparison,
    holdoutTestPreprocessor,
  };
}

/**
 * Creates a deterministic, clearly labeled OFFLINE FICTIONAL HistoricalSeries fixture
 * for reproducible unit testing and offline verification without network dependencies.
 * Never claims to be real market data.
 */
export function createDeterministicOfflineResearchFixture(
  options: OfflineFixtureOptions = {}
): HistoricalSeries {
  const symbol = options.symbol ?? '^NSEI';
  const candleCount = options.candleCount ?? 140;
  const startYear = options.startYear ?? 2025;
  const basePrice = options.basePrice ?? 22000;
  const missingIdxSet = new Set(options.injectMissingCandleAtIndices ?? []);
  const adjDivergenceIdx = options.injectAdjustedDivergenceAtIndex ?? -1;
  const markLatestAsIncompleteIntraday = options.markLatestAsIncompleteIntraday ?? false;

  const instConfig = SUPPORTED_INSTRUMENTS.find((i) => i.symbol === symbol);
  const exchange: 'NSE' | 'BSE' = instConfig?.exchange ?? 'NSE';
  const type: 'INDEX' | 'EQUITY' = instConfig?.type ?? 'INDEX';
  const name = `${instConfig?.name ?? symbol} [FICTIONAL OFFLINE FIXTURE]`;

  const candles: HistoricalCandle[] = [];
  const presentDates = new Set<string>();
  const missingDates: string[] = [];

  // Start at Jan 2 of startYear at 15:30 IST (10:00 UTC)
  let cursorUtcMs = Date.UTC(startYear, 0, 2, 10, 0, 0);
  const dayMs = 86400 * 1000;

  let generated = 0;
  let validCandles = 0;
  let nullCloseCandles = 0;
  let price = basePrice;

  while (generated < candleCount) {
    const dateStr = formatISTDateOnly(cursorUtcMs);
    const calStatus = classifyExchangeCalendarDate(dateStr, exchange);

    // Skip weekends and confirmed holidays when generating synthetic trading sessions
    if (calStatus === 'WEEKEND' || calStatus === 'CONFIRMED_EXCHANGE_HOLIDAY') {
      cursorUtcMs += dayMs;
      continue;
    }

    // Deterministic cyclical + drift wave so SMA(20), SMA(50), RSI(14), and MACD(12,26,9)
    // traverse both bullish and bearish regimes reproducibly
    const wave =
      Math.sin(generated * 0.18) * (basePrice * 0.008) +
      Math.cos(generated * 0.05) * (basePrice * 0.005) +
      generated * (basePrice * 0.0006);
    price = Number((basePrice + wave).toFixed(2));

    const open = Number((price * (1 - 0.002 * Math.cos(generated))).toFixed(2));
    const high = Number((Math.max(open, price) * 1.004).toFixed(2));
    const low = Number((Math.min(open, price) * 0.996).toFixed(2));
    const close = price;

    // Optional synthetic corporate-action dividend adjustment shift at adjDivergenceIdx
    const adjRatio =
      adjDivergenceIdx >= 0 && generated < adjDivergenceIdx ? 0.96 : 1.0;
    const adjClose = Number((close * adjRatio).toFixed(2));

    if (missingIdxSet.has(generated)) {
      nullCloseCandles++;
      missingDates.push(dateStr);
      candles.push({
        timestamp: cursorUtcMs,
        dateString: dateStr,
        open: null,
        high: null,
        low: null,
        close: null,
        adjClose: null,
        volume: null,
        isMissing: true,
        status: 'NULL_CLOSE',
        calendarStatus: calStatus,
      });
    } else {
      validCandles++;
      presentDates.add(dateStr);
      candles.push({
        timestamp: cursorUtcMs,
        dateString: dateStr,
        open,
        high,
        low,
        close,
        adjClose,
        volume: 100000 + generated * 500,
        isMissing: false,
        status: 'VALID',
        calendarStatus: calStatus,
      });
    }

    generated++;
    cursorUtcMs += dayMs;
  }

  const firstDate = candles[0]?.dateString ?? 'N/A';
  const lastDate = candles[candles.length - 1]?.dateString ?? 'N/A';
  const latestCandle = candles[candles.length - 1];
  const calendarAudit = auditHistoricalSessionCalendar(firstDate, lastDate, presentDates, exchange);

  const latestFormation: CandleFormationStatus = markLatestAsIncompleteIntraday
    ? 'FORMING_INTRADAY'
    : 'COMPLETED_EOD';
  const latestLabel = markLatestAsIncompleteIntraday
    ? 'Forming intraday candle — official close unverified.'
    : 'Latest available daily candle — official close unverified.';

  return {
    symbol,
    name,
    exchange,
    type,
    currency: 'INR',
    range: '1y',
    interval: '1d',
    candles,
    totalCandles: candles.length,
    validCandles,
    missingCandles: candles.length - validCandles,
    nullCloseCandles,
    nullOhlcCandles: 0,
    invalidPriceCandles: 0,
    holidayOrSpecialNullCandles: 0,
    unverifiedCalendarNullCandles: 0,
    genuinelyMissingTradingCandles: nullCloseCandles,
    malformedTimestamps: 0,
    duplicateTimestampsRemoved: 0,
    wasOutOfOrder: false,
    missingDates,
    missingSessionDates: calendarAudit.missingSessionDates,
    confirmedHolidayDates: calendarAudit.confirmedHolidayDates,
    specialSessionDates: calendarAudit.specialSessionDates,
    unverifiedCalendarDates: calendarAudit.unverifiedCalendarDates,
    verifiedCalendarYears: calendarAudit.verifiedCalendarYears,
    unverifiedCalendarYears: calendarAudit.unverifiedCalendarYears,
    calendarCoverageStatus: calendarAudit.calendarCoverageStatus,
    periodStart: firstDate,
    periodEnd: lastDate,
    latestCandleTimestamp: latestCandle?.timestamp ?? 0,
    latestCandleTimestampIST: formatISTTime(latestCandle?.timestamp ?? 0),
    latestCandleSessionDateIST: lastDate,
    isLatestCandleComplete: !markLatestAsIncompleteIntraday,
    isOfficialCloseVerified: false,
    latestCandleFormation: latestFormation,
    latestCandleFormationLabel: latestLabel,
    hasAdjCloseSeries: true,
    isSplitAdjustedOnChart: true,
    isDividendAdjustedOnChart: false,
    priceAdjustmentBasis: 'SPLIT_ADJUSTED_UNADJUSTED_DIVIDEND',
    priceAdjustmentDisclosure:
      'FICTIONAL OFFLINE FIXTURE: Synthetic split-adjusted OHLC series with explicit adjClose ratio for deterministic unit testing.',
    fetchTimestamp: latestCandle ? latestCandle.timestamp + 3600_000 : Date.now(),
    fetchTimestampIST: formatISTTime(
      latestCandle ? latestCandle.timestamp + 3600_000 : Date.now()
    ),
    dataSource: OFFLINE_FIXTURE_PROVENANCE_LABEL,
    freshnessStatus: markLatestAsIncompleteIntraday ? 'LIVE_SESSION' : 'CLOSED_EOD',
  };
}
