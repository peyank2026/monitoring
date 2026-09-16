let trafficChartInstance = null;
let opticalChartInstance = null;
let currentTrafficSelection = null;

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

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

function formatAxisBps(value) {
    const numericValue = Number(value) || 0;
    const sign = numericValue < 0 ? '-' : '';
    const absoluteValue = Math.abs(numericValue);

    if (absoluteValue >= 1000000000) return `${sign}${(absoluteValue / 1000000000).toFixed(1)}G`;
    if (absoluteValue >= 1000000) return `${sign}${(absoluteValue / 1000000).toFixed(0)}M`;
    if (absoluteValue >= 1000) return `${sign}${(absoluteValue / 1000).toFixed(0)}K`;
    return `${sign}${absoluteValue.toFixed(0)}`;
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

function niceTrafficLimit(value) {
    if (!Number.isFinite(value) || value <= 0) return 1000000;
    const exponent = Math.floor(Math.log10(value));
    const magnitude = 10 ** exponent;
    const normalized = value / magnitude;
    const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return niceNormalized * magnitude;
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
    
    // Scroll to chart section smoothly
    document.getElementById('chartSection').scrollIntoView({ behavior: 'smooth' });

    await loadTrafficChart(deviceId, ifIndex, ifName);
}

async function changeTrafficRange() {
    if (!currentTrafficSelection) return;
    const range = document.getElementById('trafficRange')?.value || '24h';
    toggleTrafficCustomRange(range === 'custom');
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
    const start = new Date(end.getTime() - (24 * 60 * 60 * 1000));
    startInput.value = formatWibDateTimeInput(start);
    endInput.value = formatWibDateTimeInput(end);
}

function toggleTrafficCustomRange(show) {
    const customRange = document.getElementById('trafficCustomRange');
    if (!customRange) return;
    customRange.classList.toggle('d-none', !show);
    if (show) setTrafficCustomDefaults();
    updateTrafficStat('trafficRangeError', '');
}

function getTrafficRangeRequest(range) {
    if (range !== 'custom') {
        return {
            query: `range=${encodeURIComponent(range)}`,
            label: TRAFFIC_RANGE_LABELS[range] || TRAFFIC_RANGE_LABELS['24h']
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
        label: `${startLabel} – ${endLabel}`
    };
}

async function applyTrafficCustomRange() {
    if (!currentTrafficSelection) return;
    const rangeRequest = getTrafficRangeRequest('custom');
    if (!rangeRequest) return;
    const { deviceId, ifIndex, ifName } = currentTrafficSelection;
    await loadTrafficChart(deviceId, ifIndex, ifName);
}

function formatTrafficTimestamp(value, range) {
    const date = new Date(value);
    if (['6h', '12h', '24h'].includes(range)) {
        return date.toLocaleTimeString('id-ID', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
        });
    }
    if (['1w', '2w'].includes(range)) {
        return date.toLocaleString('id-ID', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            timeZone: 'Asia/Jakarta'
        });
    }
    if (range === 'custom') {
        return date.toLocaleString('id-ID', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            timeZone: 'Asia/Jakarta'
        });
    }
    return date.toLocaleDateString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta'
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
        ctx.fillStyle = '#fffefe';
        ctx.fillRect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
        ctx.restore();
    },
    beforeDatasetsDraw(chart) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;

        const gridSize = chart.width < 620 ? 12 : 14;
        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
        ctx.clip();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.13)';
        ctx.lineWidth = 0.55;
        ctx.setLineDash([1, 2]);

        for (let x = chartArea.left + gridSize; x < chartArea.right; x += gridSize) {
            const alignedX = Math.round(x) + 0.5;
            ctx.beginPath();
            ctx.moveTo(alignedX, chartArea.top);
            ctx.lineTo(alignedX, chartArea.bottom);
            ctx.stroke();
        }

        for (let y = chartArea.top + gridSize; y < chartArea.bottom; y += gridSize) {
            const alignedY = Math.round(y) + 0.5;
            ctx.beginPath();
            ctx.moveTo(chartArea.left, alignedY);
            ctx.lineTo(chartArea.right, alignedY);
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
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(185, 28, 28, 0.72)';
        ctx.stroke();
        ctx.restore();
    }
};

async function loadTrafficChart(deviceId, ifIndex, ifName) {
    const rangeSelect = document.getElementById('trafficRange');
    const range = rangeSelect?.value || '24h';
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

        const labels = data.map(d => formatTrafficTimestamp(d.polled_at, range));
        const inData = data.map(d => parseFloat(d.in_traffic_bps) || 0);
        const outData = data.map(d => parseFloat(d.out_traffic_bps) || 0);
        const plottedOutData = outData.map(value => -value);

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

        const trafficLimit = niceTrafficLimit(Math.max(inMax, outMax) * 1.08);

        // MRTG/RRD-style chart: incoming above zero, outgoing below zero.
        trafficChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Incoming Traffic (In)',
                        data: inData,
                        borderColor: '#4d7c0f',
                        backgroundColor: 'rgba(132, 204, 22, 0.72)',
                        borderWidth: 1.25,
                        tension: 0.06,
                        fill: 'origin',
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHitRadius: 12
                    },
                    {
                        label: 'Outgoing Traffic (Out)',
                        data: plottedOutData,
                        borderColor: '#3f3f92',
                        backgroundColor: 'rgba(79, 70, 229, 0.58)',
                        borderWidth: 1.25,
                        tension: 0.06,
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
                        grid: {
                            color: 'rgba(239, 68, 68, 0.20)',
                            lineWidth: 0.8,
                            borderDash: [2, 3],
                            tickLength: 5
                        },
                        ticks: {
                            maxTicksLimit: 14,
                            color: '#4b5563',
                            maxRotation: 0,
                            autoSkipPadding: 16,
                            font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 10 }
                        },
                        border: { color: '#9ca3af' }
                    },
                    y: {
                        min: -trafficLimit,
                        max: trafficLimit,
                        grid: {
                            color: context => context.tick.value === 0
                                ? 'rgba(185, 28, 28, 0.58)'
                                : 'rgba(239, 68, 68, 0.20)',
                            lineWidth: context => context.tick.value === 0 ? 1.2 : 0.8,
                            borderDash: context => context.tick.value === 0 ? [] : [2, 3]
                        },
                        ticks: {
                            color: '#374151',
                            maxTicksLimit: 13,
                            callback: value => formatAxisBps(value),
                            font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 10 }
                        },
                        title: {
                            display: true,
                            text: 'bits per second',
                            color: '#6b7280',
                            font: { size: 11, weight: '600' }
                        },
                        border: { color: '#9ca3af' }
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
                                return `${context.dataset.label}: ${formatBps(Math.abs(context.raw))}`;
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
