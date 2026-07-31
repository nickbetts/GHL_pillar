export const BUSINESS_TIME_ZONE = 'Europe/London';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function londonDateKey(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateFormatter.format(date);
}

function localParts(date) {
  return Object.fromEntries(partsFormatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
}

export function londonMidnight(dateKey, dayOffset = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const targetDate = new Date(Date.UTC(year, month - 1, day + dayOffset));
  const target = {
    year: targetDate.getUTCFullYear(),
    month: targetDate.getUTCMonth() + 1,
    day: targetDate.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
  const targetPseudoUtc = Date.UTC(target.year, target.month - 1, target.day);
  let guess = new Date(targetPseudoUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = localParts(guess);
    const actualPseudoUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess = new Date(guess.getTime() + targetPseudoUtc - actualPseudoUtc);
  }
  return guess;
}

export function londonDayRange(dateKey) {
  const start = londonMidnight(dateKey);
  const endExclusive = londonMidnight(dateKey, 1);
  return start && endExclusive ? { start, endExclusive } : null;
}

export function londonDefaultRange(days = 30, now = new Date()) {
  const todayKey = londonDateKey(now);
  const endExclusive = londonMidnight(todayKey, 1);
  const start = londonMidnight(todayKey, -(days - 1));
  return { start, endExclusive };
}
