/**
 * 格式化为带本地时区偏移的 ISO 时间。
 * @param {Date} date 时间
 * @returns {string} 形如 2026-10-31T15:48:05+08:00
 */
export function formatLocalIso(date) {
  const pad = (value) => String(Math.abs(value)).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetRemainder = Math.abs(offsetMinutes) % 60;

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offsetHours)}:${pad(offsetRemainder)}`
  );
}

/**
 * 生成适合目录名的本地时间戳。
 * @param {Date} date 时间
 * @returns {string} 形如 20261031-154805-123
 */
export function formatStamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` +
    `-${String(date.getMilliseconds()).padStart(3, '0')}`
  );
}
