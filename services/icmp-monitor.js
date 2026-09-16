const { execFile } = require('child_process');
const { promisify } = require('util');
const net = require('net');
const pool = require('../config/database');

const execFileAsync = promisify(execFile);

function isValidHostAddress(value) {
  const address = String(value || '').trim();
  if (!address || address.length > 253) return false;
  if (net.isIP(address)) return true;

  return address.split('.').every(label => (
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-zA-Z0-9-]+$/.test(label) &&
    !label.startsWith('-') &&
    !label.endsWith('-')
  ));
}

function parsePingOutput(output) {
  const text = String(output || '');
  const lossMatch = text.match(/([\d.]+)%\s*packet loss/i);
  const summaryMatch = text.match(/(?:round-trip|rtt).*?=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/i);
  const timeMatch = text.match(/time[=<]([\d.]+)\s*ms/i);

  const packetLoss = lossMatch ? Number(lossMatch[1]) : 100;
  const fallbackLatency = timeMatch ? Number(timeMatch[1]) : null;
  const minLatencyMs = summaryMatch ? Number(summaryMatch[1]) : fallbackLatency;
  const latencyMs = summaryMatch ? Number(summaryMatch[2]) : fallbackLatency;
  const maxLatencyMs = summaryMatch ? Number(summaryMatch[3]) : fallbackLatency;

  return {
    success: packetLoss < 100,
    minLatencyMs: Number.isFinite(minLatencyMs) ? minLatencyMs : null,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    maxLatencyMs: Number.isFinite(maxLatencyMs) ? maxLatencyMs : null,
    packetLoss: Number.isFinite(packetLoss) ? packetLoss : 100
  };
}

async function pingHost(address) {
  if (!isValidHostAddress(address)) {
    throw new Error('Invalid IP address or hostname');
  }

  const timeoutValue = process.platform === 'darwin' ? '1000' : '1';
  const args = ['-n', '-q', '-c', '3', '-W', timeoutValue, address];

  try {
    const { stdout, stderr } = await execFileAsync('ping', args, {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    return parsePingOutput(`${stdout}\n${stderr}`);
  } catch (error) {
    const parsed = parsePingOutput(`${error.stdout || ''}\n${error.stderr || ''}`);
    return {
      ...parsed,
      success: false,
      error: error.killed ? 'ICMP check timed out' : 'Host did not reply'
    };
  }
}

async function checkHost(host) {
  const checkedAt = new Date();
  let result;

  try {
    result = await pingHost(host.address);
  } catch (error) {
    result = {
      success: false,
      minLatencyMs: null,
      latencyMs: null,
      maxLatencyMs: null,
      packetLoss: 100,
      error: error.message
    };
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query(
      `UPDATE hosts
       SET status = ?, latency_ms = ?, packet_loss = ?,
           last_check_at = ?, last_error = ?
       WHERE id = ?`,
      [
        result.success ? 'up' : 'down',
        result.latencyMs,
        result.packetLoss,
        checkedAt,
        result.success ? null : (result.error || 'Host did not reply'),
        host.id
      ]
    );
    await conn.query(
      `INSERT INTO icmp_data
       (host_id, status, min_latency_ms, avg_latency_ms, max_latency_ms, packet_loss, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        host.id,
        result.success ? 'up' : 'down',
        result.minLatencyMs,
        result.latencyMs,
        result.maxLatencyMs,
        result.packetLoss,
        checkedAt
      ]
    );
    await conn.commit();
  } catch (error) {
    if (conn) await conn.rollback();
    throw error;
  } finally {
    if (conn) conn.release();
  }

  return { ...result, hostId: host.id, checkedAt };
}

async function checkAllHosts() {
  let conn;
  try {
    conn = await pool.getConnection();
    const hosts = await conn.query('SELECT id, address FROM hosts WHERE is_active = 1');
    conn.release();
    conn = null;

    const results = [];
    const batchSize = 10;
    for (let offset = 0; offset < hosts.length; offset += batchSize) {
      const batch = hosts.slice(offset, offset + batchSize);
      const batchResults = await Promise.all(batch.map(host => checkHost(host)));
      results.push(...batchResults);
    }

    return {
      count: results.length,
      up: results.filter(result => result.success).length,
      down: results.filter(result => !result.success).length,
      results
    };
  } finally {
    if (conn) conn.release();
  }
}

module.exports = {
  isValidHostAddress,
  parsePingOutput,
  pingHost,
  checkHost,
  checkAllHosts
};
