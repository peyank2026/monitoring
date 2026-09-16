document.addEventListener('DOMContentLoaded', () => {
    // Auto-refresh dashboard every 60 seconds
    const REFRESH_INTERVAL = 60000;
    
    // Function to format numbers with commas
    const formatNumber = (num) => {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    };

    // Format any stat numbers if they are just raw digits
    document.querySelectorAll('.stat-number').forEach(el => {
        const val = parseInt(el.textContent.replace(/,/g, ''), 10);
        if (!isNaN(val)) {
            el.textContent = formatNumber(val);
        }
    });

    // Handle manual global poll button (if exists)
    const manualPollBtn = document.getElementById('manualGlobalPollBtn');
    if (manualPollBtn) {
        manualPollBtn.addEventListener('click', async () => {
            const originalHtml = manualPollBtn.innerHTML;
            manualPollBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Polling...';
            manualPollBtn.disabled = true;
            
            try {
                // Assuming an API endpoint exists for global poll
                const response = await fetch('/api/poll-all', { method: 'POST' });
                if (response.ok) {
                    window.location.reload();
                } else {
                    console.error('Poll failed');
                    manualPollBtn.innerHTML = originalHtml;
                    manualPollBtn.disabled = false;
                }
            } catch (err) {
                console.error(err);
                manualPollBtn.innerHTML = originalHtml;
                manualPollBtn.disabled = false;
            }
        });
    }

    // Auto reload for dashboard data freshness
    setTimeout(() => {
        window.location.reload();
    }, REFRESH_INTERVAL);
});
