let trafficChartInstance = null;
let opticalChartInstance = null;
let currentTrafficSelection = null;

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
    const { deviceId, ifIndex, ifName } = currentTrafficSelection;
    await loadTrafficChart(deviceId, ifIndex, ifName);
}

function formatTrafficTimestamp(value, range) {
    const date = new Date(value);
    if (['6h', '12h', '24h'].includes(range)) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (['1w', '2w'].includes(range)) {
        return date.toLocaleString([], {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        });
    }
    return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

async function loadTrafficChart(deviceId, ifIndex, ifName) {
    const rangeSelect = document.getElementById('trafficRange');
    const range = rangeSelect?.value || '24h';
    const title = document.getElementById('trafficChartTitle');

    if (title) title.textContent = `Traffic History - ${ifName} (${TRAFFIC_RANGE_LABELS[range]})`;
    if (rangeSelect) rangeSelect.disabled = true;

    try {
        const res = await fetch(`/api/traffic-history/${deviceId}/${ifIndex}?range=${encodeURIComponent(range)}`);
        let data = [];
        if (res.ok) {
            const json = await res.json();
            data = Array.isArray(json) ? json : (json.data || []);
        }
        
        if (!Array.isArray(data)) data = [];

        const labels = data.map(d => formatTrafficTimestamp(d.polled_at, range));
        const inData = data.map(d => parseFloat(d.in_traffic_bps) || 0);
        const outData = data.map(d => parseFloat(d.out_traffic_bps) || 0);

        // Update MRTG Statistics Summary, including ranges with no data.
        const inCurr = inData[inData.length - 1] || 0;
        const inMax = Math.max(...inData, 0);
        const inAvg = data.length ? inData.reduce((a, b) => a + b, 0) / data.length : 0;

        const outCurr = outData[outData.length - 1] || 0;
        const outMax = Math.max(...outData, 0);
        const outAvg = data.length ? outData.reduce((a, b) => a + b, 0) / data.length : 0;

        const elInCurr = document.getElementById('mrtgInCurr');
        const elInAvg = document.getElementById('mrtgInAvg');
        const elInMax = document.getElementById('mrtgInMax');
        const elOutCurr = document.getElementById('mrtgOutCurr');
        const elOutAvg = document.getElementById('mrtgOutAvg');
        const elOutMax = document.getElementById('mrtgOutMax');

        if (elInCurr) elInCurr.textContent = formatBps(inCurr);
        if (elInAvg) elInAvg.textContent = formatBps(inAvg);
        if (elInMax) elInMax.textContent = formatBps(inMax);
        if (elOutCurr) elOutCurr.textContent = formatBps(outCurr);
        if (elOutAvg) elOutAvg.textContent = formatBps(outAvg);
        if (elOutMax) elOutMax.textContent = formatBps(outMax);

        const ctx = document.getElementById('trafficChart').getContext('2d');
        
        if (trafficChartInstance) {
            trafficChartInstance.destroy();
        }

        // MRTG Style Chart Configuration
        trafficChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Incoming Traffic (In)',
                        data: inData,
                        borderColor: '#00e676', // MRTG Green
                        backgroundColor: 'rgba(0, 230, 118, 0.45)',
                        borderWidth: 2,
                        tension: 0.1,
                        fill: true,
                        pointRadius: 2,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Outgoing Traffic (Out)',
                        data: outData,
                        borderColor: '#2979ff', // MRTG Blue
                        backgroundColor: 'rgba(41, 121, 255, 0.25)',
                        borderWidth: 2,
                        tension: 0.1,
                        fill: true,
                        pointRadius: 2,
                        pointHoverRadius: 5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.08)'
                        },
                        ticks: {
                            maxTicksLimit: 12
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            callback: function(value) {
                                return formatBps(value);
                            }
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            font: {
                                weight: 'bold'
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + formatBps(context.raw);
                            }
                        }
                    }
                }
            }
        });
    } catch (e) {
        console.error('Failed to load MRTG traffic chart', e);
    } finally {
        if (rangeSelect) rangeSelect.disabled = false;
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
