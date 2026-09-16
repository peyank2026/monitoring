let latencyChartInstance = null;
let currentLatencyHost = null;

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
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (range === '7d') {
        return date.toLocaleString([], {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        });
    }
    return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

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
    title.textContent = `Latency - ${currentLatencyHost.hostName} (${LATENCY_RANGE_LABELS[range]})`;
    rangeSelect.disabled = true;

    try {
        const response = await fetch(
            `/api/icmp-history/${currentLatencyHost.hostId}?range=${encodeURIComponent(range)}`
        );
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.error || 'Failed to load ICMP history');

        const data = Array.isArray(json.data) ? json.data : [];
        const labels = data.map(point => formatLatencyTimestamp(point.checked_at, range));
        const minData = data.map(point => point.min_latency_ms);
        const avgData = data.map(point => point.avg_latency_ms);
        const maxData = data.map(point => point.max_latency_ms);
        const lossData = data.map(point => Number(point.packet_loss || 0));

        if (latencyChartInstance) latencyChartInstance.destroy();

        const ctx = document.getElementById('latencyChart').getContext('2d');
        latencyChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Minimum latency',
                        data: minData,
                        borderColor: 'rgba(120, 120, 120, 0)',
                        backgroundColor: 'rgba(120, 120, 120, 0.18)',
                        pointRadius: 0,
                        spanGaps: true
                    },
                    {
                        label: 'Latency smoke (min–max)',
                        data: maxData,
                        borderColor: 'rgba(108, 117, 125, 0.35)',
                        backgroundColor: 'rgba(108, 117, 125, 0.22)',
                        fill: '-1',
                        pointRadius: 0,
                        spanGaps: true
                    },
                    {
                        label: 'Average latency',
                        data: avgData,
                        borderColor: '#00b894',
                        backgroundColor: 'rgba(0, 184, 148, 0.08)',
                        borderWidth: 2,
                        pointRadius: 1,
                        pointHoverRadius: 5,
                        tension: 0.15,
                        spanGaps: true
                    },
                    {
                        type: 'bar',
                        label: 'Packet loss',
                        data: lossData,
                        yAxisID: 'loss',
                        backgroundColor: lossData.map(value => (
                            value >= 50 ? 'rgba(220, 53, 69, 0.65)' : 'rgba(255, 193, 7, 0.45)'
                        )),
                        borderWidth: 0,
                        barPercentage: 1,
                        categoryPercentage: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { ticks: { maxTicksLimit: 12 } },
                    y: {
                        beginAtZero: true,
                        position: 'left',
                        title: { display: true, text: 'Latency (ms)' }
                    },
                    loss: {
                        beginAtZero: true,
                        min: 0,
                        max: 100,
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: 'Packet loss (%)' }
                    }
                },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                if (context.dataset.yAxisID === 'loss') {
                                    return `${context.dataset.label}: ${Number(context.raw || 0).toFixed(1)}%`;
                                }
                                const value = context.raw;
                                return `${context.dataset.label}: ${value === null ? 'N/A' : Number(value).toFixed(2) + ' ms'}`;
                            }
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Failed to load latency chart', error);
    } finally {
        rangeSelect.disabled = false;
    }
}
