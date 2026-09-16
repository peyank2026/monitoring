let latencyChartInstance = null;
let currentLatencyHost = null;

const LATENCY_TIMEZONE = 'Asia/Jakarta';

const LATENCY_RANGE_LABELS = {
    '6h': '6 Jam',
    '24h': '24 Jam',
    '7d': '7 Hari',
    '30d': '30 Hari'
};

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.latency-chart-btn').forEach(button => {
        button.addEventListener('click', () => {
            showLatencyChart(button.dataset.hostId, button.dataset.hostName);
        });
    });

    setTimeout(() => {
        const section = document.getElementById('latencyChartSection');
        if (!section || section.classList.contains('d-none')) {
            window.location.reload();
        }
    }, 60000);
});

function formatLatencyTimestamp(value, range) {
    const date = new Date(value);
    if (range === '6h' || range === '24h') {
        return date.toLocaleTimeString('id-ID', {
            hour: '2-digit', minute: '2-digit', timeZone: LATENCY_TIMEZONE
        });
    }
    if (range === '7d') {
        return date.toLocaleString('id-ID', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            timeZone: LATENCY_TIMEZONE
        });
    }
    return date.toLocaleDateString('id-ID', {
        day: '2-digit', month: 'short', timeZone: LATENCY_TIMEZONE
    });
}

function formatLatencyTimestampFull(value) {
    return new Date(value).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: LATENCY_TIMEZONE, timeZoneName: 'short'
    });
}

function numericValues(values) {
    return values.filter(value => Number.isFinite(value));
}

function average(values) {
    const validValues = numericValues(values);
    return validValues.length
        ? validValues.reduce((sum, value) => sum + value, 0) / validValues.length
        : null;
}

function median(values) {
    const sorted = numericValues(values).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values) {
    const validValues = numericValues(values);
    const mean = average(validValues);
    if (!validValues.length || mean === null) return null;
    const variance = validValues.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / validValues.length;
    return Math.sqrt(variance);
}

function formatLatencyValue(value) {
    return Number.isFinite(value) ? `${value.toFixed(2)} ms` : 'N/A';
}

function updateLatencyText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function latencyScale(maxValue) {
    const safeMax = Math.max(Number(maxValue) || 0, 1);
    const rawStep = safeMax / 6;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalized = rawStep / magnitude;
    const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    const step = niceNormalized * magnitude;
    return { step, max: Math.ceil((safeMax * 1.08) / step) * step };
}

const latencyChartAreaPlugin = {
    id: 'latencyChartArea',
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
    }
};

function showLatencyChart(hostId, hostName) {
    currentLatencyHost = { hostId, hostName };
    const section = document.getElementById('latencyChartSection');
    section.classList.remove('d-none');
    section.scrollIntoView({ behavior: 'smooth' });
    loadLatencyChart();
}

function hideLatencyChart() {
    document.getElementById('latencyChartSection').classList.add('d-none');
}

function changeLatencyRange() {
    if (currentLatencyHost) loadLatencyChart();
}

async function loadLatencyChart() {
    if (!currentLatencyHost) return;

    const rangeSelect = document.getElementById('latencyRange');
    const range = rangeSelect?.value || '24h';
    const title = document.getElementById('latencyChartTitle');
    const meta = document.getElementById('latencyChartMeta');
    const emptyState = document.getElementById('latencyChartEmpty');
    title.textContent = `Latency ${currentLatencyHost.hostName}`;
    if (meta) meta.textContent = `${LATENCY_RANGE_LABELS[range]} · waktu WIB`;
    if (emptyState) {
        emptyState.textContent = 'Memuat histori latency…';
        emptyState.classList.remove('d-none', 'is-error');
    }
    rangeSelect.disabled = true;

    try {
        const response = await fetch(
            `/api/icmp-history/${currentLatencyHost.hostId}?range=${encodeURIComponent(range)}`
        );
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.error || 'Failed to load ICMP history');

        const data = Array.isArray(json.data) ? json.data : [];
        const labels = data.map(point => formatLatencyTimestamp(point.checked_at, range));
        const minData = data.map(point => (
            point.min_latency_ms !== null && Number.isFinite(Number(point.min_latency_ms))
                ? Number(point.min_latency_ms)
                : null
        ));
        const avgData = data.map(point => (
            point.avg_latency_ms !== null && Number.isFinite(Number(point.avg_latency_ms))
                ? Number(point.avg_latency_ms)
                : null
        ));
        const maxData = data.map(point => (
            point.max_latency_ms !== null && Number.isFinite(Number(point.max_latency_ms))
                ? Number(point.max_latency_ms)
                : null
        ));
        const lossData = data.map(point => Number(point.packet_loss || 0));
        const innerLowData = avgData.map((value, index) => {
            if (value === null || minData[index] === null) return null;
            return value - ((value - minData[index]) * 0.48);
        });
        const innerHighData = avgData.map((value, index) => {
            if (value === null || maxData[index] === null) return null;
            return value + ((maxData[index] - value) * 0.48);
        });

        const validMin = numericValues(minData);
        const validAverage = numericValues(avgData);
        const validMax = numericValues(maxData);
        const latestAverage = [...avgData].reverse().find(value => value !== null);
        const latestLoss = lossData.length ? lossData[lossData.length - 1] : 0;

        updateLatencyText('latencyMedian', formatLatencyValue(median(validAverage)));
        updateLatencyText('latencyAverage', formatLatencyValue(average(validAverage)));
        updateLatencyText('latencyMaximum', formatLatencyValue(validMax.length ? Math.max(...validMax) : null));
        updateLatencyText('latencyMinimum', formatLatencyValue(validMin.length ? Math.min(...validMin) : null));
        updateLatencyText('latencyNow', formatLatencyValue(latestAverage));
        updateLatencyText('latencyDeviation', formatLatencyValue(standardDeviation(validAverage)));
        updateLatencyText('latencyLossAverage', `${(average(lossData) || 0).toFixed(2)}% avg`);
        updateLatencyText('latencyLossMaximum', `${Math.max(...lossData, 0).toFixed(2)}% max`);
        updateLatencyText('latencyLossNow', `${latestLoss.toFixed(2)}% now`);
        updateLatencyText('latencySampleCount', `${data.length} titik data`);
        updateLatencyText(
            'latencyUpdatedAt',
            data.length ? `Update terakhir ${formatLatencyTimestampFull(data[data.length - 1].checked_at)}` : 'Belum ada data'
        );

        if (latencyChartInstance) latencyChartInstance.destroy();

        if (emptyState) {
            emptyState.classList.toggle('d-none', data.length > 0);
            emptyState.textContent = data.length ? '' : 'Belum ada histori latency pada rentang ini.';
        }

        const ctx = document.getElementById('latencyChart').getContext('2d');
        const scale = latencyScale(validMax.length ? Math.max(...validMax) : 1);
        latencyChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Minimum latency',
                        data: minData,
                        borderColor: 'rgba(71, 85, 105, 0)',
                        backgroundColor: 'rgba(100, 116, 139, 0.10)',
                        pointRadius: 0,
                        spanGaps: true,
                        order: 4
                    },
                    {
                        label: 'Latency smoke (min–max)',
                        data: maxData,
                        borderColor: 'rgba(71, 85, 105, 0.18)',
                        backgroundColor: 'rgba(100, 116, 139, 0.20)',
                        fill: '-1',
                        pointRadius: 0,
                        spanGaps: true,
                        order: 4
                    },
                    {
                        label: 'Inner latency minimum',
                        data: innerLowData,
                        borderColor: 'rgba(51, 65, 85, 0)',
                        backgroundColor: 'rgba(51, 65, 85, 0)',
                        pointRadius: 0,
                        spanGaps: true,
                        order: 3
                    },
                    {
                        label: 'Typical latency spread',
                        data: innerHighData,
                        borderColor: 'rgba(51, 65, 85, 0.18)',
                        backgroundColor: 'rgba(51, 65, 85, 0.28)',
                        fill: '-1',
                        pointRadius: 0,
                        spanGaps: true,
                        order: 3
                    },
                    {
                        label: 'Average latency',
                        data: avgData,
                        borderColor: '#22c55e',
                        backgroundColor: 'rgba(34, 197, 94, 0.08)',
                        borderWidth: 2.2,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        pointHitRadius: 12,
                        tension: 0.12,
                        spanGaps: true,
                        order: 1
                    },
                    {
                        type: 'bar',
                        label: 'Packet loss',
                        data: lossData,
                        yAxisID: 'loss',
                        backgroundColor: lossData.map(value => (
                            value >= 20 ? 'rgba(220, 38, 38, 0.62)'
                                : value >= 5 ? 'rgba(249, 115, 22, 0.52)'
                                    : 'rgba(168, 85, 247, 0.34)'
                        )),
                        borderWidth: 0,
                        barPercentage: 1,
                        categoryPercentage: 1,
                        order: 5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                normalized: true,
                animation: data.length < 160 ? { duration: 320 } : false,
                interaction: { mode: 'index', intersect: false },
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
                        beginAtZero: true,
                        max: scale.max,
                        position: 'left',
                        grid: {
                            color: 'rgba(239, 68, 68, 0.20)',
                            lineWidth: 0.8,
                            borderDash: [2, 3]
                        },
                        ticks: {
                            stepSize: scale.step,
                            color: '#374151',
                            callback: value => `${Number(value).toFixed(scale.step < 1 ? 1 : 0)} ms`,
                            font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 10 }
                        },
                        title: { display: true, text: 'Latency (ms)', color: '#6b7280' },
                        border: { color: '#9ca3af' }
                    },
                    loss: {
                        beginAtZero: true,
                        min: 0,
                        max: 100,
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: {
                            color: '#9ca3af',
                            maxTicksLimit: 5,
                            callback: value => `${value}%`,
                            font: { size: 9 }
                        },
                        title: { display: true, text: 'Packet loss (%)', color: '#9ca3af' },
                        border: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(17, 24, 39, 0.94)',
                        padding: 11,
                        filter(item) {
                            return ['Average latency', 'Packet loss'].includes(item.dataset.label);
                        },
                        callbacks: {
                            title(items) {
                                const point = data[items[0]?.dataIndex];
                                return point ? formatLatencyTimestampFull(point.checked_at) : '';
                            },
                            label(context) {
                                if (context.dataset.yAxisID === 'loss') {
                                    return `${context.dataset.label}: ${Number(context.raw || 0).toFixed(1)}%`;
                                }
                                const value = context.raw;
                                return `${context.dataset.label}: ${value === null ? 'N/A' : Number(value).toFixed(2) + ' ms'}`;
                            },
                            afterBody(items) {
                                const index = items[0]?.dataIndex;
                                if (index === undefined) return [];
                                return [
                                    `Minimum: ${formatLatencyValue(minData[index])}`,
                                    `Maximum: ${formatLatencyValue(maxData[index])}`
                                ];
                            }
                        }
                    }
                }
            },
            plugins: [latencyChartAreaPlugin]
        });
    } catch (error) {
        console.error('Failed to load latency chart', error);
        if (emptyState) {
            emptyState.textContent = 'Histori latency gagal dimuat. Silakan coba lagi.';
            emptyState.classList.remove('d-none');
            emptyState.classList.add('is-error');
        }
    } finally {
        rangeSelect.disabled = false;
    }
}
