/**
 * Calculate traffic in bits per second from octet counters
 * Safely handles BigInt, Number, string, and counter wrap-around
 * 
 * @param {BigInt|number|string} currentOctets - Current octet counter value
 * @param {BigInt|number|string} previousOctets - Previous octet counter value  
 * @param {number} intervalSeconds - Time interval in seconds
 * @returns {number} Traffic in bits per second
 */
function calculateBps(currentOctets, previousOctets, intervalSeconds) {
  const secs = Number(intervalSeconds);
  if (!secs || secs <= 0) return 0;

  try {
    const cur = BigInt(currentOctets || 0);
    const prev = BigInt(previousOctets || 0);

    if (prev === 0n || cur <= prev) {
      return 0;
    }

    let delta = cur - prev;
    const deltaNum = Number(delta);
    if (isNaN(deltaNum) || deltaNum < 0) return 0;

    return Math.round((deltaNum * 8) / secs);
  } catch (err) {
    return 0;
  }
}

/**
 * Format bps to human readable string
 */
function formatBps(bps) {
  if (bps === null || bps === undefined || isNaN(bps)) return '0 bps';
  const val = Number(bps);
  if (val >= 1000000000) return (val / 1000000000).toFixed(2) + ' Gbps';
  if (val >= 1000000) return (val / 1000000).toFixed(2) + ' Mbps';
  if (val >= 1000) return (val / 1000).toFixed(2) + ' Kbps';
  return val.toFixed(0) + ' bps';
}

/**
 * Classify optical power level
 * @returns 'good' | 'warning' | 'critical' | 'unknown'
 */
function classifyOpticalPower(dbm) {
  if (dbm === null || dbm === undefined || isNaN(dbm)) return 'unknown';
  const val = Number(dbm);
  if (val >= -20) return 'good';       // Normal/Strong
  if (val >= -25) return 'warning';    // Getting weak
  return 'critical';                   // Too weak
}

module.exports = { calculateBps, formatBps, classifyOpticalPower };
