/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  TRADING_HOLIDAYS,
  SPECIAL_SESSIONS,
  HOLIDAY_METADATA,
  checkHolidayCoverage,
} from '../holidays.js';

export const TIMEZONE = 'Asia/Kolkata';
export const AUTHORITATIVE_TIMEZONE = TIMEZONE;

/**
 * CLOCK SOURCE SPECIFICATION:
 * ----------------------------
 * 1. Runtime: Client-side web application (No active server-side clock backend).
 * 2. Clock Source: Local Device Hardware Clock (`new Date()`).
 * 3. Timezone: Target calculations project client epoch timestamps into 'Asia/Kolkata' (IST, UTC+05:30).
 * 4. Critical Device-Clock Limitation:
 *    Because no backend server clock is active in this architecture, the engine derives
 *    its base time from the user's host device. A wrong or skewed device clock will produce
 *    incorrect dates and false market session calculations.
 */

export interface ISTDateTime {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hours: number; // 0-23
  minutes: number; // 0-59
  seconds: number; // 0-59
  dayOfWeek: number; // 0 (Sun) to 6 (Sat)
  dayName: string; // 'Monday', 'Tuesday', etc.
  dateString: string; // 'YYYY-MM-DD'
  timeString24: string; // 'HH:MM:SS'
  timeString12: string; // 'hh:mm:ss AM/PM'
  fullDisplayString: string; // 'Monday, 20 Oct 2026, 09:15:00 AM IST'
  timestamp: number; // epoch ms
  timezone: string; // 'Asia/Kolkata'
  isSimulated: boolean;
  clockSource: 'DEVICE_CLOCK' | 'SIMULATED_TIMESTAMP';
}

export type MarketStatusCode =
  | 'MARKET_OPEN'
  | 'PRE_OPEN'
  | 'POST_CLOSE'
  | 'CLOSED_WEEKEND'
  | 'CLOSED_HOLIDAY'
  | 'CLOSED_AFTER_HOURS'
  | 'CLOSED_BEFORE_HOURS'
  | 'SPECIAL_SESSION_ACTIVE'
  | 'SPECIAL_SESSION_SCHEDULED';

export interface MarketStatus {
  status: MarketStatusCode;
  label: string;
  isOpen: boolean;
  isTradingDay: boolean;
  currentSessionName: string;
  holidayName?: string;
  specialSessionName?: string;
  specialHours?: { open: string; close: string };
  currentTimeIST: string;
  exchange: string;
  isSimulated: boolean;
  clockSource: 'DEVICE_CLOCK' | 'SIMULATED_TIMESTAMP';
}

export interface SkippedDay {
  date: string; // 'YYYY-MM-DD'
  dayName: string;
  reason: string;
  type: 'WEEKEND' | 'HOLIDAY';
}

export interface NextTradingSessionResult {
  currentIST: ISTDateTime;
  isTodayTradingDay: boolean;
  isMarketCurrentlyOpen: boolean;
  marketStatus: MarketStatus;
  
  // The next session that will commence or is currently scheduled
  nextTradingDate: string; // 'YYYY-MM-DD'
  nextTradingDayName: string; // 'Monday', etc.
  nextTradingDateFormatted: string; // 'Monday, 26 Jan 2026'
  sessionStartTime: string; // '09:15'
  sessionStartTimeFormatted: string; // '09:15 AM IST'
  sessionCloseTime: string; // '15:30'
  targetTimestamp: number; // epoch ms when session starts
  isSpecialSession: boolean;
  specialSessionDetails?: {
    name: string;
    open: string;
    close: string;
    timingStatus: string;
    isCircularFinalized: boolean;
  };

  // Skip audit trail
  daysSkipped: SkippedDay[];

  // Verification & completeness checks (Requirement 8)
  isVerified: boolean;
  isHolidayDataComplete: boolean;
  warningMessage?: string;
  verificationBadge: {
    status: 'VERIFIED' | 'WARNING' | 'PROVISIONAL';
    text: string;
  };

  // Distinction of actual device clock from simulated time
  isSimulated: boolean;
  evaluationMode: 'LIVE_DEVICE_CLOCK' | 'SIMULATED';
  clockSource: 'DEVICE_CLOCK' | 'SIMULATED_TIMESTAMP';
}

/**
 * EXACT FUNCTION: Calculates current IST date and time.
 * Timezone: "Asia/Kolkata" (UTC+05:30).
 * Source: Client device hardware clock (or injected simulation Date).
 *
 * @param date - Optional Date to evaluate (defaults to dynamically evaluated new Date())
 * @param isSimulated - Optional flag explicitly denoting if the invocation is from simulation
 * @returns {ISTDateTime} IST Date and Time object
 * @throws {TypeError} If an invalid Date (NaN timestamp) is provided
 */
export function getCurrentISTDate(date?: Date, isSimulated = false): ISTDateTime {
  if (date !== undefined) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      throw new TypeError('Invalid Date provided to getCurrentISTDate: timestamp is NaN or invalid time value');
    }
  }

  const evalDate = date || new Date();
  const simulatedFlag = isSimulated;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'long',
  });

  const parts = formatter.formatToParts(evalDate);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10);
  const day = parseInt(partMap.day, 10);
  const hours = parseInt(partMap.hour, 10);
  const minutes = parseInt(partMap.minute, 10);
  const seconds = parseInt(partMap.second, 10);
  const dayName = partMap.weekday || '';

  const dayOfWeekNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayOfWeek = dayOfWeekNames.indexOf(dayName) !== -1 ? dayOfWeekNames.indexOf(dayName) : 0;

  const pad = (n: number) => n.toString().padStart(2, '0');
  const dateString = `${year}-${pad(month)}-${pad(day)}`;
  const timeString24 = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  // 12-hour formatted time with AM/PM
  const h12 = hours % 12 || 12;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const timeString12 = `${pad(h12)}:${pad(minutes)}:${pad(seconds)} ${ampm}`;

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const fullDisplayString = `${dayName}, ${pad(day)} ${monthNames[month - 1]} ${year}, ${timeString12} IST`;

  return {
    year,
    month,
    day,
    hours,
    minutes,
    seconds,
    dayOfWeek,
    dayName,
    dateString,
    timeString24,
    timeString12,
    fullDisplayString,
    timestamp: evalDate.getTime(),
    timezone: TIMEZONE,
    isSimulated: simulatedFlag,
    clockSource: simulatedFlag ? 'SIMULATED_TIMESTAMP' : 'DEVICE_CLOCK',
  };
}

/**
 * Creates an exact Date object for a specific IST date and time.
 * Converts IST (UTC+05:30) to epoch milliseconds independently of client timezone.
 */
export function createDateFromIST(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0
): Date {
  const utcMillis = Date.UTC(year, month - 1, day, hours - 5, minutes - 30, seconds);
  return new Date(utcMillis);
}

/**
 * Checks if a date string 'YYYY-MM-DD' falls on a weekend in IST.
 */
export function isWeekendIST(dateStr: string): { isWeekend: boolean; dayOfWeek: number; dayName: string } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = createDateFromIST(year, month, day, 12, 0, 0);
  const ist = getCurrentISTDate(d, true);
  return {
    isWeekend: ist.dayOfWeek === 0 || ist.dayOfWeek === 6,
    dayOfWeek: ist.dayOfWeek,
    dayName: ist.dayName,
  };
}

/**
 * Checks if a given date is a configured trading holiday in holidays.js.
 */
export function getHolidayInfo(
  dateStr: string,
  exchange = 'ALL'
): { isHoliday: boolean; holidayName?: string; holiday?: (typeof TRADING_HOLIDAYS)[0] } {
  const found = TRADING_HOLIDAYS.find(
    (h) =>
      h.date === dateStr &&
      (exchange === 'ALL' || h.exchange === 'ALL' || h.exchange === exchange)
  );

  if (found) {
    return {
      isHoliday: true,
      holidayName: found.name,
      holiday: found,
    };
  }

  return { isHoliday: false };
}

/**
 * Checks if a given date has a special trading session (e.g. Muhurat Trading).
 */
export function getSpecialSessionInfo(
  dateStr: string,
  exchange = 'ALL'
): { isSpecialSession: boolean; session?: (typeof SPECIAL_SESSIONS)[0] } {
  const found = SPECIAL_SESSIONS.find(
    (s) =>
      s.date === dateStr &&
      (exchange === 'ALL' || s.exchange === 'ALL' || s.exchange === exchange)
  );

  if (found) {
    return {
      isSpecialSession: true,
      session: found,
    };
  }

  return { isSpecialSession: false };
}

/**
 * EXACT FUNCTION: Determines current market status (Open, Pre-open, Closed, Holiday, etc.)
 * Sub-second exact boundary handling around 09:00:00, 09:15:00, 15:30:00, 16:00:00 IST.
 */
export function getMarketStatus(date?: Date, exchange = 'ALL', isSimulated = false): MarketStatus {
  if (date !== undefined) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      throw new TypeError('Invalid Date provided to getMarketStatus: timestamp is NaN or invalid time value');
    }
  }

  const evalDate = date || new Date();
  const simulatedFlag = isSimulated;
  const ist = getCurrentISTDate(evalDate, simulatedFlag);
  const { isWeekend, dayName } = isWeekendIST(ist.dateString);
  const holiday = getHolidayInfo(ist.dateString, exchange);
  const specialSession = getSpecialSessionInfo(ist.dateString, exchange);

  // Exact second of the day (0 to 86399) for sub-second precision
  const currentTotalSeconds = ist.hours * 3600 + ist.minutes * 60 + ist.seconds;
  const preOpenStartSec = 9 * 3600; // 09:00:00
  const marketOpenSec = 9 * 3600 + 15 * 60; // 09:15:00 (33300 sec)
  const marketCloseSec = 15 * 3600 + 30 * 60; // 15:30:00 (55800 sec)
  const postCloseSec = 16 * 3600; // 16:00:00 (57600 sec)

  const clockSource = simulatedFlag ? 'SIMULATED_TIMESTAMP' : 'DEVICE_CLOCK';

  // 1. Check special session (e.g. Diwali Muhurat trading)
  if (specialSession.isSpecialSession && specialSession.session) {
    const [openH, openM] = specialSession.session.open.split(':').map(Number);
    const [closeH, closeM] = specialSession.session.close.split(':').map(Number);
    const specOpenSec = openH * 3600 + openM * 60;
    const specCloseSec = closeH * 3600 + closeM * 60;

    if (currentTotalSeconds >= specOpenSec && currentTotalSeconds < specCloseSec) {
      return {
        status: 'SPECIAL_SESSION_ACTIVE',
        label: `Special Session Live: ${specialSession.session.name}`,
        isOpen: true,
        isTradingDay: true,
        currentSessionName: specialSession.session.name,
        specialSessionName: specialSession.session.name,
        specialHours: { open: specialSession.session.open, close: specialSession.session.close },
        currentTimeIST: ist.timeString12,
        exchange,
        isSimulated: simulatedFlag,
        clockSource,
      };
    } else if (currentTotalSeconds < specOpenSec) {
      return {
        status: 'SPECIAL_SESSION_SCHEDULED',
        label: `Special Session Scheduled: ${specialSession.session.name} (${specialSession.session.open} - ${specialSession.session.close} IST)`,
        isOpen: false,
        isTradingDay: true,
        currentSessionName: specialSession.session.name,
        specialSessionName: specialSession.session.name,
        specialHours: { open: specialSession.session.open, close: specialSession.session.close },
        currentTimeIST: ist.timeString12,
        exchange,
        isSimulated: simulatedFlag,
        clockSource,
      };
    }
  }

  // 2. Regular holiday
  if (holiday.isHoliday) {
    return {
      status: 'CLOSED_HOLIDAY',
      label: `Market Closed (Holiday: ${holiday.holidayName})`,
      isOpen: false,
      isTradingDay: false,
      currentSessionName: 'Holiday',
      holidayName: holiday.holidayName,
      currentTimeIST: ist.timeString12,
      exchange,
      isSimulated: simulatedFlag,
      clockSource,
    };
  }

  // 3. Weekend
  if (isWeekend) {
    return {
      status: 'CLOSED_WEEKEND',
      label: `Market Closed (Weekend: ${dayName})`,
      isOpen: false,
      isTradingDay: false,
      currentSessionName: 'Weekend Closed',
      currentTimeIST: ist.timeString12,
      exchange,
      isSimulated: simulatedFlag,
      clockSource,
    };
  }

  // 4. Regular weekday trading hours
  if (currentTotalSeconds >= preOpenStartSec && currentTotalSeconds < marketOpenSec) {
    return {
      status: 'PRE_OPEN',
      label: 'Pre-Open Session (09:00 - 09:15 IST)',
      isOpen: false,
      isTradingDay: true,
      currentSessionName: 'NSE/BSE Pre-Open',
      currentTimeIST: ist.timeString12,
      exchange,
      isSimulated: simulatedFlag,
      clockSource,
    };
  }

  // Exact 09:15:00 up to 15:29:59 IST
  if (currentTotalSeconds >= marketOpenSec && currentTotalSeconds < marketCloseSec) {
    return {
      status: 'MARKET_OPEN',
      label: 'Market Open (Normal Trading)',
      isOpen: true,
      isTradingDay: true,
      currentSessionName: 'NSE/BSE Normal Trading Session',
      currentTimeIST: ist.timeString12,
      exchange,
      isSimulated: simulatedFlag,
      clockSource,
    };
  }

  // Exact 15:30:00 up to 15:59:59 IST
  if (currentTotalSeconds >= marketCloseSec && currentTotalSeconds < postCloseSec) {
    return {
      status: 'POST_CLOSE',
      label: 'Post-Market Closing Session (15:30 - 16:00 IST)',
      isOpen: false,
      isTradingDay: true,
      currentSessionName: 'NSE/BSE Post-Close',
      currentTimeIST: ist.timeString12,
      exchange,
      isSimulated: simulatedFlag,
      clockSource,
    };
  }

  if (currentTotalSeconds >= postCloseSec) {
    return {
      status: 'CLOSED_AFTER_HOURS',
      label: 'Market Closed (After Hours)',
      isOpen: false,
      isTradingDay: true,
      currentSessionName: 'Normal Session Closed',
      currentTimeIST: ist.timeString12,
      exchange,
      isSimulated: simulatedFlag,
      clockSource,
    };
  }

  // Before 09:00:00 IST (including Midnight 00:00:00) on a normal trading day
  return {
    status: 'CLOSED_BEFORE_HOURS',
    label: 'Market Closed (Opens at 09:15 IST)',
    isOpen: false,
    isTradingDay: true,
    currentSessionName: 'Pre-Trading Hours',
    currentTimeIST: ist.timeString12,
    exchange,
    isSimulated: simulatedFlag,
    clockSource,
  };
}

/**
 * EXACT FUNCTION: Calculates the next eligible trading session.
 * 
 * Rules:
 * 1. Checks current IST date and time.
 * 2. If today is a trading day and market has not yet opened (before 09:15:00 IST),
 *    the next eligible session is TODAY at 09:15 IST.
 * 3. If today is a trading day and market is currently active (09:15 - 15:30 IST),
 *    the active session is today; the NEXT upcoming session is the subsequent trading day.
 * 4. If today is after market close (>= 15:30:00 IST), or today is a weekend or holiday:
 *    Advances day-by-day skipping weekends and configured holidays until an eligible
 *    trading session is found.
 * 5. Handles Friday-to-Monday correctly (skips Sat & Sun, verifies if Monday is a trading day;
 *    if Monday is a holiday, continues to Tuesday).
 * 6. Handles year-end transitions (e.g. 31 Dec to 1 Jan), consecutive holidays, and exchange scopes.
 * 7. Evaluates completeness and verification of holiday data (Requirement 8).
 * 8. Explicitly marks whether calculation is from live device clock or simulation.
 *
 * @param fromDate - Starting Date (defaults to dynamically evaluated new Date())
 * @param exchange - 'NSE' | 'BSE' | 'ALL' (defaults to 'ALL')
 * @param isSimulated - Explicit simulation indicator
 * @returns {NextTradingSessionResult} Complete details of the next eligible session
 * @throws {TypeError} If an invalid Date (NaN timestamp) is provided
 */
export function calculateNextTradingSession(
  fromDate?: Date,
  exchange = 'ALL',
  isSimulated = false
): NextTradingSessionResult {
  if (fromDate !== undefined) {
    if (!(fromDate instanceof Date) || isNaN(fromDate.getTime())) {
      throw new TypeError('Invalid Date provided to calculateNextTradingSession: timestamp is NaN or invalid time value');
    }
  }

  const evalDate = fromDate || new Date();
  const simulatedFlag = isSimulated;
  const currentIST = getCurrentISTDate(evalDate, simulatedFlag);
  const currentMarketStatus = getMarketStatus(evalDate, exchange, simulatedFlag);

  const currentTotalSeconds = currentIST.hours * 3600 + currentIST.minutes * 60 + currentIST.seconds;
  const marketOpenSec = 9 * 3600 + 15 * 60; // 09:15:00 IST

  const daysSkipped: SkippedDay[] = [];

  let candidateDateStr = currentIST.dateString;
  let targetSessionStartTime = '09:15';
  let targetSessionCloseTime = '15:30';
  let isSpecial = false;
  let specialDetails: NextTradingSessionResult['specialSessionDetails'];

  const todayWeekend = isWeekendIST(currentIST.dateString);
  const todayHoliday = getHolidayInfo(currentIST.dateString, exchange);
  const todaySpecial = getSpecialSessionInfo(currentIST.dateString, exchange);

  // Check if today has an upcoming session today
  let useTodaySession = false;

  if (todaySpecial.isSpecialSession && todaySpecial.session) {
    const [specCloseH, specCloseM] = todaySpecial.session.close.split(':').map(Number);
    const specCloseSec = specCloseH * 3600 + specCloseM * 60;

    if (currentTotalSeconds < specCloseSec) {
      useTodaySession = true;
      targetSessionStartTime = todaySpecial.session.open;
      targetSessionCloseTime = todaySpecial.session.close;
      isSpecial = true;
      specialDetails = {
        name: todaySpecial.session.name,
        open: todaySpecial.session.open,
        close: todaySpecial.session.close,
        timingStatus: todaySpecial.session.timingStatus || 'CUSTOMARY_TENTATIVE',
        isCircularFinalized: todaySpecial.session.isCircularFinalized || false,
      };
    }
  } else if (!todayWeekend.isWeekend && !todayHoliday.isHoliday) {
    // Normal trading day before 09:15:00 IST
    if (currentTotalSeconds < marketOpenSec) {
      useTodaySession = true;
    }
  }

  if (!useTodaySession) {
    // If today is a weekend or holiday, log to skip audit trail
    if (todayWeekend.isWeekend) {
      daysSkipped.push({
        date: currentIST.dateString,
        dayName: todayWeekend.dayName,
        reason: `Weekend (${todayWeekend.dayName})`,
        type: 'WEEKEND',
      });
    } else if (todayHoliday.isHoliday) {
      daysSkipped.push({
        date: currentIST.dateString,
        dayName: todayWeekend.dayName,
        reason: `Exchange Holiday: ${todayHoliday.holidayName}`,
        type: 'HOLIDAY',
      });
    }

    // Step forward day-by-day starting from tomorrow
    let [year, month, day] = currentIST.dateString.split('-').map(Number);
    let found = false;
    let lookaheadCount = 0;
    const MAX_LOOKAHEAD = 90;

    while (!found && lookaheadCount < MAX_LOOKAHEAD) {
      lookaheadCount++;
      const nextDayDate = createDateFromIST(year, month, day + 1, 12, 0, 0);
      const nextDayIST = getCurrentISTDate(nextDayDate, true);

      year = nextDayIST.year;
      month = nextDayIST.month;
      day = nextDayIST.day;
      const dateStr = nextDayIST.dateString;

      // 1. Check if next day has a special session configured
      const specialCheck = getSpecialSessionInfo(dateStr, exchange);
      if (specialCheck.isSpecialSession && specialCheck.session) {
        found = true;
        candidateDateStr = dateStr;
        targetSessionStartTime = specialCheck.session.open;
        targetSessionCloseTime = specialCheck.session.close;
        isSpecial = true;
        specialDetails = {
          name: specialCheck.session.name,
          open: specialCheck.session.open,
          close: specialCheck.session.close,
          timingStatus: specialCheck.session.timingStatus || 'CUSTOMARY_TENTATIVE',
          isCircularFinalized: specialCheck.session.isCircularFinalized || false,
        };
        break;
      }

      // 2. Check if weekend
      const weekendCheck = isWeekendIST(dateStr);
      if (weekendCheck.isWeekend) {
        daysSkipped.push({
          date: dateStr,
          dayName: weekendCheck.dayName,
          reason: `Weekend (${weekendCheck.dayName})`,
          type: 'WEEKEND',
        });
        continue;
      }

      // 3. Check if holiday
      const holidayCheck = getHolidayInfo(dateStr, exchange);
      if (holidayCheck.isHoliday) {
        daysSkipped.push({
          date: dateStr,
          dayName: weekendCheck.dayName,
          reason: `Exchange Holiday: ${holidayCheck.holidayName}`,
          type: 'HOLIDAY',
        });
        continue;
      }

      // Valid regular trading day found!
      found = true;
      candidateDateStr = dateStr;
      targetSessionStartTime = '09:15';
      targetSessionCloseTime = '15:30';
      isSpecial = false;
      break;
    }
  }

  // Parse candidate date details
  const [cYear, cMonth, cDay] = candidateDateStr.split('-').map(Number);
  const [startH, startM] = targetSessionStartTime.split(':').map(Number);
  const targetDateObj = createDateFromIST(cYear, cMonth, cDay, startH, startM, 0);
  const targetIST = getCurrentISTDate(targetDateObj, true);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const nextTradingDateFormatted = `${targetIST.dayName}, ${targetIST.day} ${monthNames[targetIST.month - 1]} ${targetIST.year}`;

  const startH12 = startH % 12 || 12;
  const startAmPm = startH >= 12 ? 'PM' : 'AM';
  const sessionStartTimeFormatted = `${startH12.toString().padStart(2, '0')}:${startM.toString().padStart(2, '0')} ${startAmPm} IST`;

  // Requirement 8: Check completeness & verification of holiday data
  const coverage = checkHolidayCoverage(cYear, exchange);
  let warningMessage: string | undefined;
  let verificationBadge: NextTradingSessionResult['verificationBadge'];

  if (coverage.isComplete && coverage.isVerified) {
    verificationBadge = {
      status: 'VERIFIED',
      text: `Verified against official ${exchange === 'ALL' ? 'NSE & BSE' : exchange} holiday calendar`,
    };
  } else if (!coverage.isVerified && HOLIDAY_METADATA.provisionalYears.includes(cYear)) {
    warningMessage = `⚠️ Notice: Holiday calendar for ${cYear} is provisional. Dates have been projected based on preliminary notifications and weekend rules, pending final exchange gazette.`;
    verificationBadge = {
      status: 'PROVISIONAL',
      text: `Provisional ${cYear} Calendar (Unfinalized)`,
    };
  } else {
    warningMessage = `⚠️ Warning: Holiday database for year ${cYear} is unverified or incomplete. The calculated session (${nextTradingDateFormatted}) accounts for weekends but may not reflect unannounced exchange holidays.`;
    verificationBadge = {
      status: 'WARNING',
      text: `Unverified ${cYear} Calendar - Incomplete Data`,
    };
  }

  return {
    currentIST,
    isTodayTradingDay: currentMarketStatus.isTradingDay,
    isMarketCurrentlyOpen: currentMarketStatus.isOpen,
    marketStatus: currentMarketStatus,
    nextTradingDate: candidateDateStr,
    nextTradingDayName: targetIST.dayName,
    nextTradingDateFormatted,
    sessionStartTime: targetSessionStartTime,
    sessionStartTimeFormatted,
    sessionCloseTime: targetSessionCloseTime,
    targetTimestamp: targetDateObj.getTime(),
    isSpecialSession: isSpecial,
    specialSessionDetails: specialDetails,
    daysSkipped,
    isVerified: coverage.isVerified,
    isHolidayDataComplete: coverage.isComplete,
    warningMessage,
    verificationBadge,
    isSimulated: simulatedFlag,
    evaluationMode: simulatedFlag ? 'SIMULATED' : 'LIVE_DEVICE_CLOCK',
    clockSource: simulatedFlag ? 'SIMULATED_TIMESTAMP' : 'DEVICE_CLOCK',
  };
}
