'use strict';
// UK local time. Evolution workflows and the old Google Sheet record times as UK wall-clock time (GMT in
// winter, BST in summer) with no zone; the database stores UTC.

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?$/;
const london = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Minutes London is ahead of UTC at this instant (0 in winter, 60 in summer). */
function londonOffset(ms) {
  const f = Object.fromEntries(london.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return (Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute, +f.second) - Math.floor(ms / 1000) * 1000) / 60000;
}

/** UK wall-clock time to a UTC Date. */
function fromLondon(y, mo, d, h = 0, mi = 0, s = 0, ms = 0) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  let utc = wall - londonOffset(wall) * 60000;
  utc = wall - londonOffset(utc) * 60000; // second pass settles the hour the clocks change
  return new Date(utc);
}

/** ISO text: with a zone (Z, +01:00) taken as given; without one, UK local time. Null when empty or invalid. */
function parseWhen(v) {
  if (!v) return null;
  const m = LOCAL.exec(String(v).trim());
  const d = m ? fromLondon(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0) : new Date(v);
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2015 ? null : d;
}

module.exports = { fromLondon, parseWhen };
