let trafficChartInstance = null;
let opticalChartInstance = null;
let currentTrafficSelection = null;

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const TRAFFIC_RANGE_LABELS = {
    '6h': '6 Jam',
    '12h': '12 Jam',
    '24h': '24 Jam',
    '1w': '1 Minggu',
    '2w': '2 Minggu',
    '1mo': '1 Bulan',
    '2mo': '2 Bulan',
    '3mo': '3 Bulan',
    '6mo': '6 Bulan',
    '1y': '1 Tahun',
    '2y': '2 Tahun'
};

// Format bps into readable format
function formatBps(bps) {
    if (bps === null || bps === undefined) return '0 bps';
    bps = parseFloat(bps);
    if (bps >= 1000000000) return (bps / 1000000000).toFixed(2) + ' Gbps';
    if (bps >= 1000000) return (bps / 1000000).toFixed(2) + ' Mbps';
    if (bps >= 1000) return (bps / 1000).toFixed(2) + ' Kbps';
    return bps.toFixed(0) + ' bps';
}

function getTrafficYScale(inMax, outMax) {
    const peak = Math.max(inMax, outMax, 1);
    const upper = Math.max(inMax * 1.18, peak * 0.1, 1);
    const lower = Math.max(outMax * 1.18, peak * 0.1, 1);
    const targetStep = (upper + lower) / 26;
    const magnitude = 10 ** Math.floor(Math.log10(targetStep));
    const step = Math.max(1, [1, 2, 2.5, 5, 10]
        .map(factor => factor * magnitude)
        .find(candidate => candidate >= targetStep));
    const max = Math.ceil(upper / step) * step;
    const min = -Math.ceil(lower / step) * step;
    const limit = Math.max(max, -min);
    const [unit, suffix] = limit >= 1e9 ? [1e9, 'G']
        : limit >= 1e6 ? [1e6, 'M']
        : limit >= 1e3 ? [1e3, 'K'] : [1, ''];
    const decimals = (step / unit).toFixed(3).replace(/0+$/, '').split('.')[1]?.length || 0;

    return { min, max, step, unit, suffix, decimals };
}

function formatAxisBps(value, scale) {
    return `${((Number(value) || 0) / scale.unit).toFixed(scale.decimals)}${scale.suffix ? ` ${scale.suffix}` : ''}`;
}

function formatBytes(bytes) {
    const numericValue = Math.max(Number(bytes) || 0, 0);
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    if (numericValue === 0) return '0 B';

    const unitIndex = Math.min(
        Math.floor(Math.log(numericValue) / Math.log(1000)),
        units.length - 1
    );
    return `${(numericValue / (1000 ** unitIndex)).toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function percentile95(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function estimateTransferredBytes(values, points) {
    if (!values.length || !points.length) return 0;

    const timestamps = points.map(point => new Date(point.polled_at).getTime());
    const intervals = timestamps
        .slice(1)
        .map((timestamp, index) => (timestamp - timestamps[index]) / 1000)
        .filter(seconds => Number.isFinite(seconds) && seconds > 0);
    const fallbackInterval = intervals.length
        ? intervals.slice().sort((a, b) => a - b)[Math.floor(intervals.length / 2)]
        : 0;

    const totalBits = values.reduce((total, value, index) => {
        const interval = intervals[index] || fallbackInterval;
        return total + (value * interval);
    }, 0);

    return totalBits / 8;
}

function formatSpeed(speed) {
    if (!speed) return '0';
    let s = parseFloat(speed);
    if (s >= 1000000000) return (s / 1000000000).toFixed(0) + 'G';
    if (s >= 1000000) return (s / 1000000).toFixed(0) + 'M';
    if (s >= 1000) return (s / 1000).toFixed(0) + 'K';
    return s.toString();
}

document.addEventListener('DOMContentLoaded', () => {
    // Format traffic cells
    document.querySelectorAll('.traffic-val').forEach(el => {
        const bps = el.getAttribute('data-bps');
        el.textContent = formatBps(bps);
    });

    document.querySelectorAll('.speed-val').forEach(el => {
        const speed = el.getAttribute('data-speed');
        el.textContent = formatSpeed(speed);
    });

    // Auto refresh device page every 60 seconds
    setTimeout(() => {
        const chartSection = document.getElementById('chartSection');
        if (!chartSection || chartSection.classList.contains('d-none')) {
            window.location.reload();
        }
    }, 60000);
});

async function pollDevice(deviceId) {
    const btn = document.getElementById('manualPollBtn');
    if (!btn) return;
    
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Polling...';
    btn.disabled = true;
    
    try {
        const res = await fetch(`/api/poll/${deviceId}`, { method: 'POST' });
        if (res.ok) {
            window.location.reload();
        } else {
            alert('Error polling device.');
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    } catch (e) {
        console.error(e);
        alert('Network error during polling.');
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}

function hideCharts() {
    document.getElementById('chartSection').classList.add('d-none');
}

async function showCharts(deviceId, ifIndex, ifName) {
    currentTrafficSelection = { deviceId, ifIndex, ifName };
    document.getElementById('chartSection').classList.remove('d-none');
    setTrafficCustomDefaults();
    
    // Scroll to chart section smoothly
    document.getElementById('chartSection').scrollIntoView({ behavior: 'smooth' });

    await loadTrafficChart(deviceId, ifIndex, ifName);
}

async function changeTrafficRange() {
    if (!currentTrafficSelection) return;
    const range = document.getElementById('trafficRange')?.value || 'custom';
    if (range === 'custom') return;

    const { deviceId, ifIndex, ifName } = currentTrafficSelection;
    await loadTrafficChart(deviceId, ifIndex, ifName);
}

function formatWibDateTimeInput(date) {
    return new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 16);
}

function setTrafficCustomDefaults() {
    const startInput = document.getElementById('trafficStartAt');
    const endInput = document.getElementById('trafficEndAt');
    if (!startInput || !endInput || (startInput.value && endInput.value)) return;

    const end = new Date();
    end.setSeconds(0, 0);
    const yesterday = new Date(end.getTime() - (24 * 60 * 60 * 1000));
    if (!startInput.value) {
        startInput.value = `${formatWibDateTimeInput(yesterday).slice(0, 10)}T07:00`;
    }
    if (!endInput.value) endInput.value = formatWibDateTimeInput(end);
}

function getTrafficRangeRequest(range) {
    if (range !== 'custom') {
        const endMs = Date.now();
        const startDate = new Date(endMs);
        const fixedDurations = {
            '6h': 6 * HOUR_MS, '12h': 12 * HOUR_MS, '24h': DAY_MS,
            '1w': 7 * DAY_MS, '2w': 14 * DAY_MS
        };
        const calendarMonths = {
            '1mo': 1, '2mo': 2, '3mo': 3, '6mo': 6, '1y': 12, '2y': 24
        };
        if (fixedDurations[range] || !calendarMonths[range]) {
            startDate.setTime(endMs - (fixedDurations[range] || DAY_MS));
        } else {
            const day = startDate.getUTCDate();
            startDate.setUTCDate(1);
            startDate.setUTCMonth(startDate.getUTCMonth() - calendarMonths[range]);
            const lastDay = new Date(Date.UTC(
                startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0
            )).getUTCDate();
            startDate.setUTCDate(Math.min(day, lastDay));
        }
        return {
            query: `range=${encodeURIComponent(range)}`,
            label: TRAFFIC_RANGE_LABELS[range] || TRAFFIC_RANGE_LABELS['24h'],
            startMs: startDate.getTime(),
            endMs
        };
    }

    const start = document.getElementById('trafficStartAt')?.value;
    const end = document.getElementById('trafficEndAt')?.value;
    if (!start || !end) {
        updateTrafficStat('trafficRangeError', 'Tanggal dan jam mulai serta selesai wajib diisi.');
        return null;
    }
    if (end <= start) {
        updateTrafficStat('trafficRangeError', 'Waktu selesai harus setelah waktu mulai.');
        return null;
    }

    updateTrafficStat('trafficRangeError', '');
    const labelOptions = {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
    };
    const startLabel = new Date(`${start}:00+07:00`).toLocaleString('id-ID', labelOptions);
    const endLabel = new Date(`${end}:00+07:00`).toLocaleString('id-ID', labelOptions);
    return {
        query: `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        label: `${startLabel} – ${endLabel}`,
        startMs: new Date(`${start}:00+07:00`).getTime(),
        endMs: new Date(`${end}:00+07:00`).getTime()
    };
}

async function applyTrafficCustomRange() {
    if (!currentTrafficSelection) return;
    const rangeRequest = getTrafficRangeRequest('custom');
    if (!rangeRequest) return;
    const rangeSelect = document.getElementById('trafficRange');
    if (rangeSelect) rangeSelect.value = 'custom';
    const { deviceId, ifIndex, ifName } = currentTrafficSelection;
    await loadTrafficChart(deviceId, ifIndex, ifName);
}

function getTrafficTimeGrid(durationMs) {
    if (durationMs <= 2 * DAY_MS) return { minorMs: 10 * MINUTE_MS, majorMs: HOUR_MS };
    if (durationMs <= 14 * DAY_MS) return { minorMs: HOUR_MS, majorMs: 6 * HOUR_MS };
    if (durationMs <= 90 * DAY_MS) return { minorMs: 6 * HOUR_MS, majorMs: DAY_MS };
    if (durationMs <= 365 * DAY_MS) return { minorMs: DAY_MS, majorMs: 7 * DAY_MS };
    return { minorMs: 7 * DAY_MS, majorMs: 28 * DAY_MS };
}

function formatTrafficAxisTick(timestamp, durationMs, startMs) {
    const wibTime = new Date(timestamp + WIB_OFFSET_MS).toISOString().slice(11, 16);
    if (durationMs <= 2 * DAY_MS) {
        if (timestamp === startMs || wibTime === '00:00') {
            const dateLabel = new Date(timestamp).toLocaleDateString('id-ID', {
                day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta'
            });
            return [wibTime, dateLabel];
        }
        return wibTime;
    }
    if (durationMs <= 14 * DAY_MS) {
        return new Date(timestamp).toLocaleDateString('id-ID', {
            day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta'
        }) + ` ${wibTime}`;
    }
    return new Date(timestamp).toLocaleDateString('id-ID', {
        day: '2-digit', month: 'short', year: durationMs > 365 * DAY_MS ? 'numeric' : undefined,
        timeZone: 'Asia/Jakarta'
    });
}

function formatTrafficTimestampFull(value) {
    return new Date(value).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Asia/Jakarta', timeZoneName: 'short'
    });
}

function updateTrafficStat(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

const trafficChartAreaPlugin = {
    id: 'trafficChartArea',
    beforeDraw(chart) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        ctx.save();
        ctx.fillStyle = '#fcfefd';
        ctx.fillRect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
        ctx.restore();
    },
    beforeDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.x) return;

        const xScale = scales.x;
        const { minorMs, majorMs } = getTrafficTimeGrid(xScale.max - xScale.min);
        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
        ctx.clip();
        ctx.strokeStyle = 'rgba(105, 128, 143, 0.11)';
        ctx.lineWidth = 0.6;
        ctx.setLineDash([2, 3]);

        for (let timestamp = Math.ceil(xScale.min / minorMs) * minorMs;
            timestamp <= xScale.max; timestamp += minorMs) {
            const alignedX = Math.round(xScale.getPixelForValue(timestamp)) + 0.5;
            const isMajor = timestamp % majorMs === 0;
            ctx.strokeStyle = isMajor ? 'rgba(105, 128, 143, 0.23)' : 'rgba(105, 128, 143, 0.11)';
            ctx.lineWidth = isMajor ? 0.9 : 0.6;
            ctx.beginPath();
            ctx.moveTo(alignedX, chartArea.top);
            ctx.lineTo(alignedX, chartArea.bottom);
            ctx.stroke();
        }

        ctx.restore();
    },
    afterDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.y) return;
        const zeroY = scales.y.getPixelForValue(0);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(chartArea.left, zeroY);
        ctx.lineTo(chartArea.right, zeroY);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(89, 109, 123, 0.62)';
        ctx.stroke();
        ctx.restore();
    }
};

async function loadTrafficChart(deviceId, ifIndex, ifName) {
    const rangeSelect = document.getElementById('trafficRange');
    const range = rangeSelect?.value || 'custom';
    const rangeRequest = getTrafficRangeRequest(range);
    if (!rangeRequest) return;
    const title = document.getElementById('trafficChartTitle');

    const chartEmpty = document.getElementById('trafficChartEmpty');
    const chartMeta = document.getElementById('trafficChartMeta');
    if (title) title.textContent = `Traffic ${ifName}`;
    if (chartMeta) chartMeta.textContent = `${rangeRequest.label} · waktu WIB`;
    if (chartEmpty) {
        chartEmpty.textContent = 'Memuat histori trafik…';
        chartEmpty.classList.remove('d-none', 'is-error');
    }
    if (rangeSelect) rangeSelect.disabled = true;
    ['trafficStartAt', 'trafficEndAt', 'trafficCustomUpdate'].forEach(id => {
        const control = document.getElementById(id);
        if (control) control.disabled = true;
    });

    try {
        const res = await fetch(`/api/traffic-history/${deviceId}/${ifIndex}?${rangeRequest.query}`);
        let data = [];
        if (res.ok) {
            const json = await res.json();
            data = Array.isArray(json) ? json : (json.data || []);
        } else {
            const json = await res.json().catch(() => ({}));
            throw new Error(json.error || 'Failed to load traffic history');
        }
        
        if (!Array.isArray(data)) data = [];

        const timestamps = data.map(d => new Date(d.polled_at).getTime());
        const inData = data.map(d => parseFloat(d.in_traffic_bps) || 0);
        const outData = data.map(d => parseFloat(d.out_traffic_bps) || 0);
        const plottedInData = inData.map((value, index) => ({ x: timestamps[index], y: value }));
        const plottedOutData = outData.map((value, index) => ({ x: timestamps[index], y: -value }));
        const durationMs = rangeRequest.endMs - rangeRequest.startMs;
        const { majorMs } = getTrafficTimeGrid(durationMs);

        // Update MRTG Statistics Summary, including ranges with no data.
        const inCurr = inData[inData.length - 1] || 0;
        const inMax = Math.max(...inData, 0);
        const inAvg = data.length ? inData.reduce((a, b) => a + b, 0) / data.length : 0;
        const in95 = percentile95(inData);

        const outCurr = outData[outData.length - 1] || 0;
        const outMax = Math.max(...outData, 0);
        const outAvg = data.length ? outData.reduce((a, b) => a + b, 0) / data.length : 0;
        const out95 = percentile95(outData);
        const totalIn = estimateTransferredBytes(inData, data);
        const totalOut = estimateTransferredBytes(outData, data);

        updateTrafficStat('mrtgInCurr', formatBps(inCurr));
        updateTrafficStat('mrtgInAvg', formatBps(inAvg));
        updateTrafficStat('mrtgInMax', formatBps(inMax));
        updateTrafficStat('mrtgIn95', formatBps(in95));
        updateTrafficStat('mrtgOutCurr', formatBps(outCurr));
        updateTrafficStat('mrtgOutAvg', formatBps(outAvg));
        updateTrafficStat('mrtgOutMax', formatBps(outMax));
        updateTrafficStat('mrtgOut95', formatBps(out95));
        updateTrafficStat('mrtgTotalIn', formatBytes(totalIn));
        updateTrafficStat('mrtgTotalOut', formatBytes(totalOut));
        updateTrafficStat('mrtgSampleCount', `${data.length} titik data`);
        updateTrafficStat(
            'mrtgUpdatedAt',
            data.length ? `Update terakhir ${formatTrafficTimestampFull(data[data.length - 1].polled_at)}` : 'Belum ada data'
        );

        const ctx = document.getElementById('trafficChart').getContext('2d');
        
        if (trafficChartInstance) {
            trafficChartInstance.destroy();
        }

        if (chartEmpty) {
            chartEmpty.classList.toggle('d-none', data.length > 0);
            chartEmpty.textContent = data.length ? '' : 'Belum ada histori trafik pada rentang ini.';
        }

        const yScale = getTrafficYScale(inMax, outMax);

        // Keep In above zero and Out below zero, but size each side to its own traffic.
        trafficChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Incoming Traffic (In)',
                        data: plottedInData,
                        borderColor: '#4c8a3f',
                        backgroundColor: 'rgba(113, 178, 92, 0.55)',
                        borderWidth: 1.6,
                        cubicInterpolationMode: 'monotone',
                        tension: 0.18,
                        fill: 'origin',
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHitRadius: 12
                    },
                    {
                        label: 'Outgoing Traffic (Out)',
                        data: plottedOutData,
                        borderColor: '#447eac',
                        backgroundColor: 'rgba(101, 155, 197, 0.47)',
                        borderWidth: 1.6,
                        cubicInterpolationMode: 'monotone',
                        tension: 0.18,
                        fill: 'origin',
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHitRadius: 12
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                normalized: true,
                animation: data.length < 160 ? { duration: 320 } : false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    x: {
                        type: 'linear',
                        min: rangeRequest.startMs,
                        max: rangeRequest.endMs,
                        grid: {
                            display: false,
                            tickLength: 5
                        },
                        ticks: {
                            stepSize: majorMs,
                            maxTicksLimit: durationMs <= 2 * DAY_MS ? 30 : 16,
                            color: '#536574',
                            maxRotation: 0,
                            autoSkipPadding: 4,
                            callback: value => formatTrafficAxisTick(value, durationMs, rangeRequest.startMs),
                            font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 10 }
                        },
                        border: { color: '#a6b5bd' }
                    },
                    y: {
                        min: yScale.min,
                        max: yScale.max,
                        grid: {
                            color: context => context.tick.value === 0
                                ? 'rgba(89, 109, 123, 0.48)'
                                : 'rgba(105, 128, 143, 0.17)',
                            lineWidth: context => context.tick.value === 0 ? 1.1 : 0.7,
                            borderDash: context => context.tick.value === 0 ? [] : [3, 3]
                        },
                        ticks: {
                            color: '#536574',
                            stepSize: yScale.step,
                            maxTicksLimit: 30,
                            padding: 2,
                            callback: value => formatAxisBps(value, yScale),
                            font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 10 }
                        },
                        title: {
                            display: true,
                            text: 'bits per second',
                            color: '#667788',
                            font: { size: 11, weight: '600' }
                        },
                        border: { color: '#a6b5bd' }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(17, 24, 39, 0.94)',
                        padding: 11,
                        displayColors: true,
                        callbacks: {
                            title(items) {
                                const point = data[items[0]?.dataIndex];
                                return point ? formatTrafficTimestampFull(point.polled_at) : '';
                            },
                            label(context) {
                                return `${context.dataset.label}: ${formatBps(Math.abs(context.parsed.y))}`;
                            }
                        }
                    }
                }
            },
            plugins: [trafficChartAreaPlugin]
        });
    } catch (e) {
        console.error('Failed to load MRTG traffic chart', e);
        if (range === 'custom') updateTrafficStat('trafficRangeError', e.message);
        if (chartEmpty) {
            chartEmpty.textContent = 'Histori trafik gagal dimuat. Silakan coba lagi.';
            chartEmpty.classList.remove('d-none');
            chartEmpty.classList.add('is-error');
        }
    } finally {
        if (rangeSelect) rangeSelect.disabled = false;
        ['trafficStartAt', 'trafficEndAt', 'trafficCustomUpdate'].forEach(id => {
            const control = document.getElementById(id);
            if (control) control.disabled = false;
        });
    }
}

async function loadOpticalChart(deviceId, ifIndex, ifName) {
    try {
        const res = await fetch(`/api/optical-history/${deviceId}/${ifIndex}`);
        let data = [];
        if (res.ok) {
            const json = await res.json();
            data = Array.isArray(json) ? json : (json.data || []);
        }
        
        if (!Array.isArray(data)) data = [];

        const labels = data.map(d => new Date(d.polled_at).toLocaleTimeString());
        const txData = data.map(d => parseFloat(d.tx_power));
        const rxData = data.map(d => parseFloat(d.rx_power));

        const ctx = document.getElementById('opticalChart').getContext('2d');
        
        if (opticalChartInstance) {
            opticalChartInstance.destroy();
        }

        // Warning and critical threshold lines can be added via a plugin, 
        // but for simplicity we'll just plot the data here.
        opticalChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'TX Power (dBm)',
                        data: txData,
                        borderColor: '#0f3460',
                        borderWidth: 2,
                        tension: 0.1,
                        pointRadius: 3
                    },
                    {
                        label: 'RX Power (dBm)',
                        data: rxData,
                        borderColor: '#00b894', // Green
                        borderWidth: 2,
                        tension: 0.1,
                        pointRadius: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        // Optical power is usually negative, e.g., -40 to 0
                        suggestedMax: 0,
                        suggestedMin: -40
                    }
                },
                plugins: {
                    annotation: {
                        // Assuming chartjs-plugin-annotation is not loaded,
                        // we won't draw horizontal lines natively unless loaded.
                    }
                }
            }
        });
    } catch (e) {
        console.error('Failed to load optical chart', e);
    }
}
