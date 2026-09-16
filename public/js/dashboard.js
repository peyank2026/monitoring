document.addEventListener('DOMContentLoaded', () => {
    const REFRESH_SECONDS = 30;
    const numberAnimations = new WeakMap();
    const searchInput = document.getElementById('switchSearch');
    const statusFilter = document.getElementById('statusFilter');
    const visibleDeviceCount = document.getElementById('visibleDeviceCount');
    const filteredEmptyRow = document.getElementById('filteredEmptyRow');
    const countdownElement = document.getElementById('refreshCountdown');
    const syncStatus = document.getElementById('syncStatus');
    const clockElement = document.getElementById('wibClock');
    let secondsUntilRefresh = REFRESH_SECONDS;
    let refreshing = false;

    const numberFormatter = new Intl.NumberFormat('id-ID');
    const wibDateFormatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const wibClockFormatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    function animateNumber(element, target) {
        if (!element) return;

        const previousFrame = numberAnimations.get(element);
        if (previousFrame) cancelAnimationFrame(previousFrame);

        const start = Number(String(element.textContent).replace(/[^0-9.-]/g, '')) || 0;
        const end = Number(target) || 0;
        const startedAt = performance.now();
        const duration = 550;

        const update = (now) => {
            const progress = Math.min((now - startedAt) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = numberFormatter.format(Math.round(start + ((end - start) * eased)));

            if (progress < 1) {
                numberAnimations.set(element, requestAnimationFrame(update));
            }
        };

        numberAnimations.set(element, requestAnimationFrame(update));
    }

    function getDeviceStatus(device) {
        const isActive = device.is_active === true || Number(device.is_active) === 1;
        if (!isActive) return 'disabled';
        if (Number(device.last_poll_success) === 1) return 'online';
        if (Number(device.last_poll_success) === 0) return 'offline';
        return 'pending';
    }

    function updateStatusCell(cell, device, status) {
        if (!cell) return;

        const badge = document.createElement('span');
        const dot = document.createElement('span');
        badge.className = `device-status status-${status}`;
        badge.title = device.last_poll_error || '';
        dot.className = 'device-status-dot';
        dot.setAttribute('aria-hidden', 'true');
        badge.append(dot, status.charAt(0).toUpperCase() + status.slice(1));
        cell.replaceChildren(badge);
    }

    function updateInterfaceCell(cell, device) {
        if (!cell) return;

        const up = Number(device.up_count || 0);
        const total = Number(device.interface_count || 0);
        const percent = total > 0 ? Math.round((up / total) * 100) : 0;
        const wrapper = document.createElement('div');
        const label = document.createElement('span');
        const strong = document.createElement('strong');
        const progress = document.createElement('div');
        const progressBar = document.createElement('span');

        wrapper.className = 'interface-summary';
        strong.textContent = numberFormatter.format(up);
        label.append(strong, ` / ${numberFormatter.format(total)} up`);
        progress.className = 'interface-progress';
        progress.setAttribute('aria-hidden', 'true');
        progressBar.style.width = `${Math.max(0, Math.min(percent, 100))}%`;
        progress.append(progressBar);
        wrapper.append(label, progress);
        cell.replaceChildren(wrapper);
    }

    function updateAlarmCell(cell, alarmCount) {
        if (!cell) return;

        const count = Number(alarmCount || 0);
        const badge = document.createElement('span');
        const icon = document.createElement('i');
        badge.className = `alarm-count${count > 0 ? ' has-alarm' : ''}`;
        icon.className = 'fas fa-triangle-exclamation';
        icon.setAttribute('aria-hidden', 'true');
        badge.append(icon, numberFormatter.format(count));
        cell.replaceChildren(badge);
    }

    function updateDeviceRows(devices) {
        const rows = Array.from(document.querySelectorAll('#deviceTableBody tr[data-device-id]'));
        if (rows.length !== devices.length) {
            window.location.reload();
            return false;
        }

        const rowsById = new Map(rows.map(row => [String(row.dataset.deviceId), row]));
        for (const device of devices) {
            const row = rowsById.get(String(device.id));
            if (!row) {
                window.location.reload();
                return false;
            }

            const status = getDeviceStatus(device);
            row.dataset.status = status;
            row.dataset.search = [device.name, device.ip_address, device.vendor, device.location || '']
                .join(' ')
                .toLowerCase();
            updateStatusCell(row.querySelector('[data-field="status"]'), device, status);
            updateInterfaceCell(row.querySelector('[data-field="interfaces"]'), device);
            updateAlarmCell(row.querySelector('[data-field="alarms"]'), device.alarm_count);

            const lastPoll = row.querySelector('[data-field="lastPoll"] .last-poll-time');
            if (lastPoll) {
                lastPoll.textContent = device.last_polled
                    ? wibDateFormatter.format(new Date(device.last_polled))
                    : 'Never';
            }
        }

        applyFilters();
        return true;
    }

    function applyFilters() {
        const query = (searchInput?.value || '').trim().toLowerCase();
        const status = statusFilter?.value || 'all';
        const rows = Array.from(document.querySelectorAll('#deviceTableBody tr[data-device-id]'));
        let visible = 0;

        rows.forEach((row) => {
            const matchesQuery = !query || row.dataset.search.includes(query);
            const matchesStatus = status === 'all' || row.dataset.status === status;
            const show = matchesQuery && matchesStatus;
            row.classList.toggle('d-none', !show);
            if (show) visible += 1;
        });

        if (visibleDeviceCount) visibleDeviceCount.textContent = numberFormatter.format(visible);
        if (filteredEmptyRow) filteredEmptyRow.classList.toggle('d-none', visible > 0 || rows.length === 0);
    }

    async function refreshDashboard() {
        if (refreshing) return;
        refreshing = true;
        if (syncStatus) syncStatus.textContent = 'Refreshing network data…';

        try {
            const response = await fetch('/api/dashboard-summary', {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'Dashboard refresh failed');

            ['totalDevices', 'onlineDevices', 'offlineDevices', 'totalAlarms'].forEach((key) => {
                animateNumber(document.querySelector(`[data-stat="${key}"]`), result[key]);
            });
            updateDeviceRows(result.devices);
            if (syncStatus) syncStatus.textContent = `Synced ${wibClockFormatter.format(new Date(result.synced_at))} WIB`;
        } catch (error) {
            console.error(error);
            if (syncStatus) syncStatus.textContent = 'Live update unavailable · retrying';
        } finally {
            secondsUntilRefresh = REFRESH_SECONDS;
            if (countdownElement) countdownElement.textContent = secondsUntilRefresh;
            refreshing = false;
        }
    }

    document.querySelectorAll('.stat-number').forEach((element) => {
        const value = Number(element.textContent.trim()) || 0;
        element.textContent = '0';
        animateNumber(element, value);
    });

    searchInput?.addEventListener('input', applyFilters);
    statusFilter?.addEventListener('change', applyFilters);

    const manualPollButton = document.getElementById('manualGlobalPollBtn');
    manualPollButton?.addEventListener('click', async () => {
        const originalHtml = manualPollButton.innerHTML;
        manualPollButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Polling…';
        manualPollButton.disabled = true;

        try {
            const response = await fetch('/api/poll-all', { method: 'POST' });
            if (!response.ok) throw new Error('Poll failed');
            await refreshDashboard();
        } catch (error) {
            console.error(error);
            if (syncStatus) syncStatus.textContent = 'Manual poll failed · please retry';
        } finally {
            manualPollButton.innerHTML = originalHtml;
            manualPollButton.disabled = false;
        }
    });

    setInterval(() => {
        if (clockElement) clockElement.textContent = `${wibClockFormatter.format(new Date())} WIB`;
    }, 1000);

    setInterval(() => {
        if (document.hidden || refreshing) return;
        secondsUntilRefresh -= 1;
        if (countdownElement) countdownElement.textContent = Math.max(secondsUntilRefresh, 0);
        if (secondsUntilRefresh <= 0) refreshDashboard();
    }, 1000);

    clockElement.textContent = `${wibClockFormatter.format(new Date())} WIB`;
    applyFilters();
});
