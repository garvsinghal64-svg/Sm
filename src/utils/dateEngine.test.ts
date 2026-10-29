/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCurrentISTDate,
  createDateFromIST,
  getMarketStatus,
  calculateNextTradingSession,
  isWeekendIST,
  getHolidayInfo,
} from './dateEngine.ts';
import { checkHolidayCoverage } from '../holidays.js';

// ---------------------------------------------------------------------------
// TEST 1: Normal Weekday
// ---------------------------------------------------------------------------
test('Normal Weekday - Wednesday during trading hours (11:30 AM IST)', () => {
  const wednesdayDate = createDateFromIST(2026, 10, 21, 11, 30, 0);
  const ist = getCurrentISTDate(wednesdayDate);

  assert.equal(ist.dateString, '2026-10-21');
  assert.equal(ist.dayName, 'Wednesday');
  assert.equal(ist.hours, 11);
  assert.equal(ist.minutes, 30);
  assert.equal(ist.dayOfWeek, 3); // Wednesday

  const status = getMarketStatus(wednesdayDate);
  assert.equal(status.status, 'MARKET_OPEN');
  assert.equal(status.isOpen, true);
  assert.equal(status.isTradingDay, true);
});

test('Normal Weekday - Wednesday before market open (08:30 AM IST)', () => {
  const wedMorning = createDateFromIST(2026, 10, 21, 8, 30, 0);
  const session = calculateNextTradingSession(wedMorning);

  assert.equal(session.nextTradingDate, '2026-10-21');
  assert.equal(session.nextTradingDayName, 'Wednesday');
  assert.equal(session.sessionStartTime, '09:15');
  assert.equal(session.isTodayTradingDay, true);
  assert.equal(session.isMarketCurrentlyOpen, false);
});

test('Normal Weekday - Wednesday after market close (16:30 IST) advances to Thursday', () => {
  const wedEvening = createDateFromIST(2026, 10, 21, 16, 30, 0);
  const session = calculateNextTradingSession(wedEvening);

  assert.equal(session.nextTradingDate, '2026-10-22');
  assert.equal(session.nextTradingDayName, 'Thursday');
  assert.equal(session.sessionStartTime, '09:15');
});

// ---------------------------------------------------------------------------
// TEST 2: Friday & Friday-to-Monday Transition (Audit Item 5)
// ---------------------------------------------------------------------------
test('Friday - During market hours (10:00 AM IST)', () => {
  const fridayMarket = createDateFromIST(2026, 10, 16, 10, 0, 0);
  const status = getMarketStatus(fridayMarket);

  assert.equal(status.status, 'MARKET_OPEN');
  assert.equal(status.isOpen, true);
});

test('Friday 16 Oct 2026 (16:00 IST) correctly advances to Monday 19 Oct 2026', () => {
  const fridayClose = createDateFromIST(2026, 10, 16, 16, 0, 0);
  const session = calculateNextTradingSession(fridayClose);

  // Must skip Saturday (2026-10-17) and Sunday (2026-10-18)
  assert.equal(session.nextTradingDate, '2026-10-19');
  assert.equal(session.nextTradingDayName, 'Monday');
  assert.equal(session.sessionStartTime, '09:15');

  const skippedDates = session.daysSkipped.map((s) => s.date);
  assert.ok(skippedDates.includes('2026-10-17'), 'Must skip Saturday');
  assert.ok(skippedDates.includes('2026-10-18'), 'Must skip Sunday');
});

// ---------------------------------------------------------------------------
// TEST 3: Saturday
// ---------------------------------------------------------------------------
test('Saturday - Correctly detected as weekend and calculates next Monday session', () => {
  const saturday = createDateFromIST(2026, 10, 17, 14, 0, 0);
  const ist = getCurrentISTDate(saturday);

  assert.equal(ist.dayName, 'Saturday');
  const weekend = isWeekendIST(ist.dateString);
  assert.equal(weekend.isWeekend, true);

  const status = getMarketStatus(saturday);
  assert.equal(status.status, 'CLOSED_WEEKEND');
  assert.equal(status.isOpen, false);

  const session = calculateNextTradingSession(saturday);
  assert.equal(session.nextTradingDate, '2026-10-19');
  assert.equal(session.nextTradingDayName, 'Monday');
  assert.equal(session.sessionStartTime, '09:15');
});

// ---------------------------------------------------------------------------
// TEST 4: Sunday
// ---------------------------------------------------------------------------
test('Sunday - Correctly detected as weekend and calculates next Monday session', () => {
  const sunday = createDateFromIST(2026, 10, 18, 20, 0, 0);
  const ist = getCurrentISTDate(sunday);

  assert.equal(ist.dayName, 'Sunday');
  const status = getMarketStatus(sunday);
  assert.equal(status.status, 'CLOSED_WEEKEND');
  assert.equal(status.isOpen, false);

  const session = calculateNextTradingSession(sunday);
  assert.equal(session.nextTradingDate, '2026-10-19');
  assert.equal(session.nextTradingDayName, 'Monday');
  assert.equal(session.sessionStartTime, '09:15');
});

// ---------------------------------------------------------------------------
// TEST 5: Configured Holiday & Long Weekend Handling
// ---------------------------------------------------------------------------
test('Configured Holiday - Republic Day (2026-01-26 is a Monday)', () => {
  const repDay = createDateFromIST(2026, 1, 26, 10, 0, 0);
  const holiday = getHolidayInfo('2026-01-26');
  assert.equal(holiday.isHoliday, true);
  assert.equal(holiday.holidayName, 'Republic Day');

  const status = getMarketStatus(repDay);
  assert.equal(status.status, 'CLOSED_HOLIDAY');
  assert.equal(status.isOpen, false);

  const session = calculateNextTradingSession(repDay);
  assert.equal(session.nextTradingDate, '2026-01-27');
  assert.equal(session.nextTradingDayName, 'Tuesday');
});

test('Friday before a Monday Holiday - Skips Saturday, Sunday, AND Monday Holiday to Tuesday', () => {
  const fridayBeforeRepDay = createDateFromIST(2026, 1, 23, 16, 30, 0);
  const session = calculateNextTradingSession(fridayBeforeRepDay);

  assert.equal(session.nextTradingDate, '2026-01-27');
  assert.equal(session.nextTradingDayName, 'Tuesday');
  assert.equal(session.sessionStartTime, '09:15');

  const skippedReasons = session.daysSkipped.map((s) => s.reason);
  assert.ok(skippedReasons.some((r) => r.includes('Saturday')));
  assert.ok(skippedReasons.some((r) => r.includes('Sunday')));
  assert.ok(skippedReasons.some((r) => r.includes('Republic Day')));
});

// ---------------------------------------------------------------------------
// TEST 6: Browser Timezone Independence (Asia/Kolkata Projection)
// ---------------------------------------------------------------------------
test('Browser Timezone Independence - Device in New York / PST vs Asia/Kolkata', () => {
  const utcMillis = Date.UTC(2026, 9, 21, 4, 45, 0);
  const testDate = new Date(utcMillis);

  const ist = getCurrentISTDate(testDate);

  assert.equal(ist.dateString, '2026-10-21', 'Must be Wednesday in IST even if Tuesday in US');
  assert.equal(ist.dayName, 'Wednesday');
  assert.equal(ist.hours, 10);
  assert.equal(ist.minutes, 15);

  const status = getMarketStatus(testDate);
  assert.equal(status.status, 'MARKET_OPEN');
  assert.equal(status.isOpen, true);
});

test('Browser Timezone Independence - Identical IST output regardless of timestamp origin', () => {
  const marketOpenUTC = Date.UTC(2026, 3, 15, 3, 45, 0);
  const d = new Date(marketOpenUTC);
  const ist = getCurrentISTDate(d);

  assert.equal(ist.dateString, '2026-04-15');
  assert.equal(ist.hours, 9);
  assert.equal(ist.minutes, 15);
  assert.equal(ist.seconds, 0);
  assert.equal(ist.timezone, 'Asia/Kolkata');
});

// ---------------------------------------------------------------------------
// TEST 7: Incomplete or Outdated Holiday Coverage Warning (Requirement 8)
// ---------------------------------------------------------------------------
test('Holiday Coverage - Verified year (2026) has isVerified = true', () => {
  const coverage2026 = checkHolidayCoverage(2026);
  assert.equal(coverage2026.isVerified, true);
  assert.equal(coverage2026.isComplete, true);

  const d = createDateFromIST(2026, 5, 10, 10, 0, 0);
  const session = calculateNextTradingSession(d);
  assert.equal(session.isVerified, true);
  assert.equal(session.warningMessage, undefined);
  assert.equal(session.verificationBadge.status, 'VERIFIED');
});

test('Holiday Coverage - Outdated or unlisted future year (2030) triggers warning', () => {
  const coverage2030 = checkHolidayCoverage(2030);
  assert.equal(coverage2030.isVerified, false);
  assert.equal(coverage2030.isComplete, false);

  const futureDate = createDateFromIST(2030, 6, 15, 18, 0, 0);
  const session = calculateNextTradingSession(futureDate);

  assert.equal(session.isVerified, false);
  assert.ok(session.warningMessage, 'Must provide warning message when holiday data is unverified');
  assert.ok(session.warningMessage.includes('Warning'));
  assert.equal(session.verificationBadge.status, 'WARNING');
});

// ---------------------------------------------------------------------------
// TEST 8: Special Session Timing Status (Audit Item 8)
// ---------------------------------------------------------------------------
test('Special Session - Diwali Muhurat Trading detection and tentative timing flag', () => {
  const diwaliMuhuratActive = createDateFromIST(2026, 11, 9, 18, 30, 0);
  const status = getMarketStatus(diwaliMuhuratActive);

  assert.equal(status.status, 'SPECIAL_SESSION_ACTIVE');
  assert.equal(status.isOpen, true);
  assert.ok(status.specialSessionName?.includes('Muhurat'));

  const session = calculateNextTradingSession(diwaliMuhuratActive);
  assert.equal(session.isSpecialSession, true);
  assert.equal(session.specialSessionDetails?.timingStatus, 'CUSTOMARY_TENTATIVE');
});

// ---------------------------------------------------------------------------
// TEST 9: Exact Boundary Conditions (Audit Item 9)
// ---------------------------------------------------------------------------
test('Boundary Edge Case - Exactly 09:14:59 IST (1 second before market open)', () => {
  const tBeforeOpen = createDateFromIST(2026, 10, 21, 9, 14, 59);
  const status = getMarketStatus(tBeforeOpen);
  assert.equal(status.status, 'PRE_OPEN');
  assert.equal(status.isOpen, false);

  const nextSession = calculateNextTradingSession(tBeforeOpen);
  assert.equal(nextSession.nextTradingDate, '2026-10-21');
  assert.equal(nextSession.sessionStartTime, '09:15');
});

test('Boundary Edge Case - Exactly 09:15:00 IST (Opening Bell moment)', () => {
  const tOpen = createDateFromIST(2026, 10, 21, 9, 15, 0);
  const status = getMarketStatus(tOpen);
  assert.equal(status.status, 'MARKET_OPEN');
  assert.equal(status.isOpen, true);
});

test('Boundary Edge Case - Exactly 15:29:59 IST (1 second before market close)', () => {
  const tBeforeClose = createDateFromIST(2026, 10, 21, 15, 29, 59);
  const status = getMarketStatus(tBeforeClose);
  assert.equal(status.status, 'MARKET_OPEN');
  assert.equal(status.isOpen, true);
});

test('Boundary Edge Case - Exactly 15:30:00 IST (Closing Bell moment)', () => {
  const tClose = createDateFromIST(2026, 10, 21, 15, 30, 0);
  const status = getMarketStatus(tClose);
  assert.equal(status.status, 'POST_CLOSE');
  assert.equal(status.isOpen, false);

  const nextSession = calculateNextTradingSession(tClose);
  assert.equal(nextSession.nextTradingDate, '2026-10-22');
  assert.equal(nextSession.nextTradingDayName, 'Thursday');
});

test('Boundary Edge Case - Midnight 00:00:00 IST on a normal weekday', () => {
  const midnightWed = createDateFromIST(2026, 10, 21, 0, 0, 0);
  const status = getMarketStatus(midnightWed);
  assert.equal(status.status, 'CLOSED_BEFORE_HOURS');
  assert.equal(status.isOpen, false);

  const nextSession = calculateNextTradingSession(midnightWed);
  assert.equal(nextSession.nextTradingDate, '2026-10-21');
  assert.equal(nextSession.sessionStartTime, '09:15');
});

// ---------------------------------------------------------------------------
// TEST 10: Year-Change Boundary & Consecutive Holidays (Audit Item 9)
// ---------------------------------------------------------------------------
test('Year-Change Edge Case - 31 Dec 2025 at 16:00 IST advances to 1 Jan 2026', () => {
  const yearEnd = createDateFromIST(2025, 12, 31, 16, 0, 0);
  const session = calculateNextTradingSession(yearEnd);

  assert.equal(session.nextTradingDate, '2026-01-01');
  assert.equal(session.nextTradingDayName, 'Thursday');
  assert.equal(session.sessionStartTime, '09:15');
});

test('Consecutive Holidays Edge Case - Multi-day sequential holidays', () => {
  const diwaliAfterHours = createDateFromIST(2026, 11, 9, 20, 0, 0);
  const session = calculateNextTradingSession(diwaliAfterHours);

  assert.equal(session.nextTradingDate, '2026-11-11');
  assert.equal(session.nextTradingDayName, 'Wednesday');
  const skipped = session.daysSkipped.map((s) => s.date);
  assert.ok(skipped.includes('2026-11-10'), 'Must skip Balipratipada consecutive holiday');
});

test('Exchange Calendar Difference - BSE-only holiday vs NSE trading day', () => {
  const bseHolidayDate = createDateFromIST(2026, 11, 17, 10, 0, 0);

  const nseStatus = getMarketStatus(bseHolidayDate, 'NSE');
  assert.equal(nseStatus.status, 'MARKET_OPEN');
  assert.equal(nseStatus.isOpen, true);

  const bseStatus = getMarketStatus(bseHolidayDate, 'BSE');
  assert.equal(bseStatus.status, 'CLOSED_HOLIDAY');
  assert.equal(bseStatus.isOpen, false);

  const bseSession = calculateNextTradingSession(bseHolidayDate, 'BSE');
  assert.equal(bseSession.nextTradingDate, '2026-11-18');
});

// ---------------------------------------------------------------------------
// TEST 11: Actual Time vs Simulated Time Distinction (Audit Item 4)
// ---------------------------------------------------------------------------
test('Distinction - Default dynamic call marks isSimulated = false and DEVICE_CLOCK', () => {
  const dynamicIST = getCurrentISTDate();
  assert.equal(dynamicIST.isSimulated, false);
  assert.equal(dynamicIST.clockSource, 'DEVICE_CLOCK');

  const dynamicSession = calculateNextTradingSession();
  assert.equal(dynamicSession.isSimulated, false);
  assert.equal(dynamicSession.evaluationMode, 'LIVE_DEVICE_CLOCK');
  assert.equal(dynamicSession.clockSource, 'DEVICE_CLOCK');
});

test('Distinction - Date-injected call marks isSimulated = true and SIMULATED_TIMESTAMP', () => {
  const simulatedDate = createDateFromIST(2026, 10, 21, 10, 0, 0);
  const simIST = getCurrentISTDate(simulatedDate, true);
  assert.equal(simIST.isSimulated, true);
  assert.equal(simIST.clockSource, 'SIMULATED_TIMESTAMP');

  const simSession = calculateNextTradingSession(simulatedDate, 'ALL', true);
  assert.equal(simSession.isSimulated, true);
  assert.equal(simSession.evaluationMode, 'SIMULATED');
  assert.equal(simSession.clockSource, 'SIMULATED_TIMESTAMP');
});

// ---------------------------------------------------------------------------
// TEST 12: NEW AUDIT REQUIREMENTS (Invalid Date Input & Explicit Clock Source)
// ---------------------------------------------------------------------------
test('Input Validation - Invalid Date input throws descriptive TypeError', () => {
  const invalidDate = new Date('invalid-date-string');
  assert.ok(isNaN(invalidDate.getTime()));

  assert.throws(
    () => getCurrentISTDate(invalidDate),
    /Invalid Date provided to getCurrentISTDate/
  );

  assert.throws(
    () => getMarketStatus(invalidDate),
    /Invalid Date provided to getMarketStatus/
  );

  assert.throws(
    () => calculateNextTradingSession(invalidDate),
    /Invalid Date provided to calculateNextTradingSession/
  );
});

test('Clock Source Audit - Verifies client device clock mode is explicitly reported', () => {
  const ist = getCurrentISTDate();
  assert.equal(ist.clockSource, 'DEVICE_CLOCK');
  assert.equal(typeof ist.timestamp, 'number');
  assert.ok(ist.timestamp > 0);

  const market = getMarketStatus();
  assert.equal(market.clockSource, 'DEVICE_CLOCK');
});
