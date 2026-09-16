const snmp = require('net-snmp');
const pool = require('../config/database');
const { calculateBps } = require('./traffic-calculator');

// ===========================================
// SNMP OID Definitions
// ===========================================
const OIDS = {
  // Standard IF-MIB
  ifDescr: '1.3.6.1.2.1.2.2.1.2',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifName: '1.3.6.1.2.1.31.1.1.1.1',
  ifAlias: '1.3.6.1.2.1.31.1.1.1.18',
  ifHCInOctets: '1.3.6.1.2.1.31.1.1.1.6',
  ifHCOutOctets: '1.3.6.1.2.1.31.1.1.1.10',
  ifInOctets: '1.3.6.1.2.1.2.2.1.10',
  ifOutOctets: '1.3.6.1.2.1.2.2.1.16',
  ifSpeed: '1.3.6.1.2.1.2.2.1.5',
  ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15',
  entAliasMappingIdentifier: '1.3.6.1.2.1.47.1.3.2.1.2',

  // Vendor-specific optical power OIDs
  optical: {
    mikrotik: {
      opticalName: '1.3.6.1.4.1.14988.1.1.19.1.1.2',
      rxPower: '1.3.6.1.4.1.14988.1.1.19.1.1.9',
      txPower: '1.3.6.1.4.1.14988.1.1.19.1.1.10',
      rxPowerAlt: '1.3.6.1.4.1.14988.1.1.19.1.1.6',
      txPowerAlt: '1.3.6.1.4.1.14988.1.1.19.1.1.7'
    },
    huawei: {
      rxPower: '1.3.6.1.4.1.2011.5.25.31.1.1.3.1.9',
      txPower: '1.3.6.1.4.1.2011.5.25.31.1.1.3.1.10'
    },
    cisco: {
      rxPower: '1.3.6.1.4.1.9.9.91.1.1.1.1.4',
      txPower: '1.3.6.1.4.1.9.9.91.1.1.1.1.4'
    },
    juniper: {
      rxPower: '1.3.6.1.4.1.2636.3.60.1.1.1.1.8',
      txPower: '1.3.6.1.4.1.2636.3.60.1.1.1.1.7'
    }
  }
};

// ===========================================
// Helper Functions
// ===========================================

/**
 * Safely parse SNMP counter values (including Counter64 8-byte Buffers) to BigInt
 */
function parseCounterValue(val) {
  if (val === null || val === undefined) return 0n;
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number') return BigInt(Math.floor(val));
  if (Buffer.isBuffer(val)) {
    if (val.length === 8) {
      return val.readBigUInt64BE(0);
    } else if (val.length === 4) {
      return BigInt(val.readUInt32BE(0));
    } else {
      const hex = val.toString('hex');
      return hex ? BigInt('0x' + hex) : 0n;
    }
  }
  if (typeof val === 'string') {
    const cleanStr = val.replace(/[^0-9]/g, '');
    return cleanStr ? BigInt(cleanStr) : 0n;
  }
  return 0n;
}

/**
 * Wrap SNMP subtree walk in a Promise
 */
function snmpWalk(session, oid) {
  return new Promise((resolve) => {
    const results = [];
    session.subtree(oid, 20, (varbinds) => {
      for (const vb of varbinds) {
        if (!snmp.isVarbindError(vb)) {
          results.push(vb);
        }
      }
    }, (error) => {
      if (error) {
        resolve([]);
      } else {
        resolve(results);
      }
    });
  });
}

/**
 * Create SNMP session for a device
 */
function createSession(device) {
  const version = device.snmp_version === 1 ? snmp.Version1 : snmp.Version2c;
  return snmp.createSession(device.ip_address, device.snmp_community || 'public', {
    version,
    timeout: 10000,
    retries: 1
  });
}

/**
 * Convert raw SNMP optical power values to dBm based on vendor
 */
function convertOpticalPower(rawVal, vendor) {
  if (rawVal === null || rawVal === undefined) return null;

  // Convert Buffer or Object to string
  let strVal = typeof rawVal === 'object' && rawVal.toString ? rawVal.toString() : String(rawVal);
  strVal = strVal.trim();
  if (!strVal || strVal === '0' || strVal === 'N/A' || strVal === 'null') return null;

  // 1. If raw string already contains floating point (e.g. "-9.566", "0.333 dBm", "-9.56dBm")
  const floatMatch = strVal.match(/([-+]?\d+\.\d+)/);
  if (floatMatch) {
    return parseFloat(parseFloat(floatMatch[1]).toFixed(3));
  }

  // 2. Extract integer number
  const intMatch = strVal.match(/([-+]?\d+)/);
  if (!intMatch) return null;
  const num = parseInt(intMatch[1], 10);
  const v = vendor ? vendor.toLowerCase() : '';
  if (isNaN(num) || num === 0 || (v === 'huawei' && num === -1)) return null;

  switch (v) {
    case 'mikrotik':
      // MikroTik RouterOS returns 0.001 dBm (e.g. 333 = 0.333 dBm, -9566 = -9.566 dBm)
      if (Math.abs(num) > 200) {
        return parseFloat((num / 1000).toFixed(3));
      } else {
        return parseFloat((num / 100).toFixed(3));
      }

    case 'huawei':
    case 'juniper':
      // Huawei & Juniper: value in 0.01 dBm (e.g., -956 = -9.56 dBm) or 0.001 dBm if |num| > 5000
      if (Math.abs(num) > 5000) {
        return parseFloat((num / 1000).toFixed(3));
      }
      return parseFloat((num / 100).toFixed(3));

    case 'cisco':
      if (Math.abs(num) > 100) {
        return parseFloat((num / 100).toFixed(3));
      }
      return parseFloat(num.toFixed(3));

    default:
      if (Math.abs(num) > 1000) return parseFloat((num / 1000).toFixed(3));
      if (Math.abs(num) > 100) return parseFloat((num / 100).toFixed(3));
      return parseFloat(num.toFixed(3));
  }
}

/**
 * Extract ifIndex from OID suffix
 * e.g. '1.3.6.1.2.1.31.1.1.1.1.5' → 5
 */
function getIfIndex(oid) {
  return parseInt(oid.split('.').pop(), 10);
}

/**
 * Map varbind array to a dictionary keyed by ifIndex
 */
function mapByIfIndex(varbinds, transform = (v) => v) {
  const map = {};
  for (const vb of varbinds) {
    const idx = getIfIndex(vb.oid);
    if (!isNaN(idx)) {
      map[idx] = transform(vb.value);
    }
  }
  return map;
}

// ===========================================
// Main Polling Functions
// ===========================================

/**
 * Poll a single device via SNMP and store results
 */
async function pollDevice(device) {
  let session = null;
  let conn = null;
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] 🔄 Polling device: ${device.name} (${device.ip_address})`);

  try {
    session = createSession(device);

    // Walk standard interface OIDs
    let [nameVbs, descrVbs, statusVbs, inOctetVbs, outOctetVbs, highSpeedVbs, legacySpeedVbs, aliasVbs] = await Promise.all([
      snmpWalk(session, OIDS.ifName),
      snmpWalk(session, OIDS.ifDescr),
      snmpWalk(session, OIDS.ifOperStatus),
      snmpWalk(session, OIDS.ifHCInOctets),
      snmpWalk(session, OIDS.ifHCOutOctets),
      snmpWalk(session, OIDS.ifHighSpeed),
      snmpWalk(session, OIDS.ifSpeed),
      snmpWalk(session, OIDS.ifAlias)
    ]);

    // Fallback to 32-bit octets if 64-bit HC counters return empty
    if (inOctetVbs.length === 0) {
      inOctetVbs = await snmpWalk(session, OIDS.ifInOctets);
    }
    if (outOctetVbs.length === 0) {
      outOctetVbs = await snmpWalk(session, OIDS.ifOutOctets);
    }

    // Walk vendor-specific optical power OIDs
    const vendorOids = OIDS.optical[device.vendor?.toLowerCase()];
    let rxPowerVbs = [];
    let txPowerVbs = [];
    let mikrotikOpticalNameVbs = [];
    let huaweiAliasVbs = [];

    if (vendorOids) {
      if (device.vendor?.toLowerCase() === 'mikrotik' && vendorOids.opticalName) {
        mikrotikOpticalNameVbs = await snmpWalk(session, vendorOids.opticalName);
      }
      [rxPowerVbs, txPowerVbs] = await Promise.all([
        snmpWalk(session, vendorOids.rxPower),
        snmpWalk(session, vendorOids.txPower)
      ]);

      if (device.vendor?.toLowerCase() === 'huawei') {
        huaweiAliasVbs = await snmpWalk(session, OIDS.entAliasMappingIdentifier);
      }

      if (device.vendor?.toLowerCase() === 'mikrotik') {
        if (rxPowerVbs.length === 0 && vendorOids.rxPowerAlt) {
          rxPowerVbs = await snmpWalk(session, vendorOids.rxPowerAlt);
        }
        if (txPowerVbs.length === 0 && vendorOids.txPowerAlt) {
          txPowerVbs = await snmpWalk(session, vendorOids.txPowerAlt);
        }
      }
    }

    // Build interface maps
    const names = mapByIfIndex(nameVbs.length > 0 ? nameVbs : descrVbs, v => v.toString());
    const descrs = mapByIfIndex(descrVbs, v => v.toString());
    const aliases = mapByIfIndex(aliasVbs, v => v.toString());
    const statuses = mapByIfIndex(statusVbs, v => Number(v));
    const inOctets = mapByIfIndex(inOctetVbs, v => parseCounterValue(v));
    const outOctets = mapByIfIndex(outOctetVbs, v => parseCounterValue(v));
    const highSpeeds = mapByIfIndex(highSpeedVbs, v => Number(v));
    const legacySpeeds = mapByIfIndex(legacySpeedVbs, v => Number(v));
    const rxPowers = mapByIfIndex(rxPowerVbs, v => convertOpticalPower(v, device.vendor));
    const txPowers = mapByIfIndex(txPowerVbs, v => convertOpticalPower(v, device.vendor));

    // Handle MikroTik Name-based Optical Sensor Matching
    const mikrotikOpticalMap = {};
    if (device.vendor?.toLowerCase() === 'mikrotik' && mikrotikOpticalNameVbs.length > 0) {
      for (const vb of mikrotikOpticalNameVbs) {
        const optIdx = getIfIndex(vb.oid);
        const optName = vb.value ? vb.value.toString().trim().toLowerCase() : '';
        if (optName) {
          const rx = rxPowers[optIdx] !== undefined ? rxPowers[optIdx] : null;
          const tx = txPowers[optIdx] !== undefined ? txPowers[optIdx] : null;
          mikrotikOpticalMap[optName] = { rx, tx };
        }
      }
    }

    // Huawei optical tables are indexed by entPhysicalIndex, not ifIndex.
    // ENTITY-MIB provides the authoritative entPhysicalIndex -> ifIndex mapping.
    const huaweiOpticalMap = {};
    if (device.vendor?.toLowerCase() === 'huawei' && huaweiAliasVbs.length > 0) {
      for (const vb of huaweiAliasVbs) {
        const suffix = vb.oid.slice(OIDS.entAliasMappingIdentifier.length + 1).split('.');
        const physicalIndex = parseInt(suffix[0], 10);
        const ifIndex = getIfIndex(vb.value?.toString() || '');

        if (!isNaN(physicalIndex) && !isNaN(ifIndex)) {
          huaweiOpticalMap[ifIndex] = {
            rx: rxPowers[physicalIndex] ?? null,
            tx: txPowers[physicalIndex] ?? null
          };
        }
      }
    }

    // Get all unique ifIndexes
    const allIndexes = new Set([
      ...Object.keys(names),
      ...Object.keys(statuses)
    ].map(Number).filter(n => !isNaN(n)));

    if (allIndexes.size === 0) {
      throw new Error('No interfaces returned by SNMP');
    }

    // Get previous poll data for traffic calculation
    conn = await pool.getConnection();
    const prevData = await conn.query(
      `SELECT if_index, in_octets, out_octets, polled_at
       FROM interface_data
       WHERE device_id = ?
         AND polled_at = (SELECT MAX(polled_at) FROM interface_data WHERE device_id = ?)`,
      [device.id, device.id]
    );

    const prevMap = {};
    for (const row of prevData) {
      prevMap[row.if_index] = row;
    }

    // Build insert values
    const polledAt = new Date();
    const insertRows = [];

    for (const ifIndex of allIndexes) {
      const ifName = names[ifIndex] || descrs[ifIndex] || `Interface ${ifIndex}`;
      const ifAlias = aliases[ifIndex] || null;
      const ifStatus = statuses[ifIndex] === 1 ? 'up' : 'down';
      const ifSpeed = highSpeeds[ifIndex] > 0
        ? highSpeeds[ifIndex] * 1000000 // ifHighSpeed is reported in Mbps
        : (legacySpeeds[ifIndex] || 0); // ifSpeed is already reported in bps
      const currentIn = inOctets[ifIndex] !== undefined ? inOctets[ifIndex] : 0n;
      const currentOut = outOctets[ifIndex] !== undefined ? outOctets[ifIndex] : 0n;

      // Determine TX/RX Power
      let txPower = txPowers[ifIndex] !== undefined ? txPowers[ifIndex] : null;
      let rxPower = rxPowers[ifIndex] !== undefined ? rxPowers[ifIndex] : null;

      // Match MikroTik optical sensor by interface name if available
      if (device.vendor?.toLowerCase() === 'mikrotik' && Object.keys(mikrotikOpticalMap).length > 0) {
        const nameKey = ifName.toLowerCase();
        const descrKey = (descrs[ifIndex] || '').toLowerCase();
        const matchedOpt = mikrotikOpticalMap[nameKey] || mikrotikOpticalMap[descrKey];

        if (matchedOpt) {
          txPower = matchedOpt.tx;
          rxPower = matchedOpt.rx;
        }
      }

      if (device.vendor?.toLowerCase() === 'huawei' && huaweiOpticalMap[ifIndex]) {
        txPower = huaweiOpticalMap[ifIndex].tx;
        rxPower = huaweiOpticalMap[ifIndex].rx;
      }

      // Calculate traffic bps from previous poll
      let inBps = 0;
      let outBps = 0;
      const prev = prevMap[ifIndex];
      if (prev && prev.polled_at) {
        const prevIn = parseCounterValue(prev.in_octets);
        const prevOut = parseCounterValue(prev.out_octets);
        const intervalSec = (polledAt.getTime() - new Date(prev.polled_at).getTime()) / 1000;

        if (intervalSec >= 1) {
          if (prevIn > 0n) inBps = calculateBps(currentIn, prevIn, intervalSec);
          if (prevOut > 0n) outBps = calculateBps(currentOut, prevOut, intervalSec);

          // Anomaly guard: max 100 Gbps
          if (inBps > 100000000000) inBps = 0;
          if (outBps > 100000000000) outBps = 0;
        }
      }

      insertRows.push([
        device.id, ifIndex, ifName, ifAlias, ifStatus, ifSpeed,
        txPower, rxPower,
        currentIn.toString(), currentOut.toString(),
        inBps, outBps,
        polledAt
      ]);
    }

    // Batch insert
    if (insertRows.length > 0) {
      const placeholders = insertRows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const flatValues = insertRows.flat();

      await conn.query(
        `INSERT INTO interface_data 
         (device_id, if_index, if_name, if_alias, if_status, if_speed,
          tx_power, rx_power, in_octets, out_octets,
          in_traffic_bps, out_traffic_bps, polled_at)
         VALUES ${placeholders}`,
        flatValues
      );
    }

    await conn.query(
      `UPDATE devices
       SET last_poll_at = ?, last_poll_success = 1, last_poll_error = NULL
       WHERE id = ?`,
      [polledAt, device.id]
    );

    console.log(`[${timestamp}] ✅ Polled ${device.name}: ${insertRows.length} interfaces`);
    return { success: true, deviceId: device.id, interfaceCount: insertRows.length };

  } catch (error) {
    console.error(`[${timestamp}] ❌ Error polling ${device.name} (${device.ip_address}):`, error.message);

    let statusConn = null;
    try {
      statusConn = await pool.getConnection();
      await statusConn.query(
        `UPDATE devices
         SET last_poll_at = NOW(), last_poll_success = 0, last_poll_error = ?
         WHERE id = ?`,
        [String(error.message || 'Unknown polling error').slice(0, 500), device.id]
      );
    } catch (statusError) {
      console.error(`[${timestamp}] Failed to save poll status for ${device.name}:`, statusError.message);
    } finally {
      if (statusConn) statusConn.release();
    }

    return { success: false, deviceId: device.id, error: error.message };
  } finally {
    if (session) {
      try { session.close(); } catch (e) { /* ignore */ }
    }
    if (conn) conn.release();
  }
}

/**
 * Poll all active devices sequentially
 */
async function pollAllDevices() {
  let conn = null;
  const timestamp = new Date().toISOString();

  try {
    console.log(`\n[${timestamp}] 🚀 Starting poll for all devices...`);

    conn = await pool.getConnection();
    const devices = await conn.query('SELECT * FROM devices WHERE is_active = 1');
    conn.release();
    conn = null;

    if (devices.length === 0) {
      console.log(`[${timestamp}] ℹ️  No active devices to poll`);
      return { success: true, count: 0, results: [] };
    }

    const results = [];
    for (const device of devices) {
      const result = await pollDevice(device);
      results.push(result);
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`[${timestamp}] 🏁 Poll complete: ${successCount}/${devices.length} devices successful`);

    return { success: true, count: results.length, results };
  } catch (error) {
    console.error(`[${timestamp}] ❌ pollAllDevices error:`, error.message);
    return { success: false, error: error.message };
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { pollDevice, pollAllDevices };
