document.addEventListener('DOMContentLoaded', () => {
    // --- GLOBAL STATE ---
    let historicalData = [], weeklyData = [], latestMonthData = [], modalChartInstance = null, ytdModalChartInstance = null;
    const loader = document.getElementById('loader');
    const monthOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    const kpiIcons = { 
        "Registered Customers": "bi-person-badge-fill", "Active Customers": "bi-person-walking", 
        "Delivered Orders": "bi-box-seam", "Volume UC": "bi-truck", "Digital Order Share %": "bi-pie-chart-fill", 
        "Digital Volume Share %": "bi-pie-chart-fill", "Fulfillment Rate %": "bi-check-circle-fill", 
        "Order Frequency": "bi-arrow-repeat", "UC per Order": "bi-basket2-fill" 
    };
    
    const chartColors = ['#fe001a', '#005cbf', '#28a745', '#ffc107', '#6f42c1', '#fd7e14'];
    
    const cumulativeKpis = ["Registered Customers"];
    const nonTargetKpis = ["Digital Order Share %", "Digital Volume Share %", "Fulfillment Rate %", "Order Frequency", "UC per Order"];
    const coreKpis = ["Registered Customers", "Active Customers", "Delivered Orders", "Volume UC"];
    const ytdKpis = ["Volume UC", "Delivered Orders"]; 

    // --- MAIN EXECUTION SCRIPT ---
    async function main() {
        loader.style.display = 'flex';
        try {
            const [historicalResult, weeklyResult] = await Promise.allSettled([
                fetch('historical_log.csv').then(res => res.ok ? res.text() : Promise.reject(new Error('Failed to load historical_log.csv'))),
                fetch('live_progress.csv').then(res => res.ok ? res.text() : Promise.reject(new Error('Failed to load live_progress.csv')))
            ]);

            if (historicalResult.status === 'fulfilled') historicalData = parseCSV(historicalResult.value);
            if (weeklyResult.status === 'fulfilled') weeklyData = parseCSV(weeklyResult.value);
            
            Chart.register(ChartDataLabels);
            initializeTabs();
            initializeModals();
            
            if (weeklyData.length > 0) renderWeeklyPulse();
            if (historicalData.length > 0) {
                latestMonthData = getLatestMonthData();
                renderAtAGlance();
                initializeTrends();
            }
            
            document.querySelector('.tab-link:not([style*="display: none"])')?.click();

        } catch (error) {
            console.error("Initialization failed:", error);
            document.querySelector('main').innerHTML = `<div class="card">${error.message}</div>`;
        } finally {
            loader.style.display = 'none';
        }
    }
    
    // --- DATA PARSING & HELPERS ---
    function parseCSV(csvText) {
        if (!csvText || csvText.trim() === '') return [];
        const lines = csvText.trim().split(/\r?\n/);
        if (lines.length < 2) return [];
        const headers = lines.shift().split(',').map(h => h.trim());
        return lines.map(line => {
            const values = line.split(',');
            if (values.length !== headers.length) return null; 
            const entry = {};
            headers.forEach((header, i) => entry[header] = values[i]?.trim() || null);
            return entry;
        }).filter(Boolean);
    }

    function formatValue(kpiName, value, isForChart = false) {
        const num = parseFloat(value);
        if (value === null || isNaN(num)) return 'N/A';
        const lowerKpi = kpiName.toLowerCase();
        if (lowerKpi.includes('share') || lowerKpi.includes('rate')) return `${num.toFixed(1)}%`;
        if (lowerKpi.includes('frequency') || lowerKpi.includes('uc per order')) return num.toFixed(1);
        if (isForChart && num >= 1000) return (num / 1000).toFixed(num >= 10000 ? 0 : 1) + 'K';
        return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    function getLatestMonthData() {
        if (historicalData.length === 0) return [];
        const latestYear = Math.max(...historicalData.map(d => parseInt(d.Year)).filter(y => !isNaN(y)));
        const dataForLatestYear = historicalData.filter(d => parseInt(d.Year) === latestYear);
        const latestMonthIndex = Math.max(...dataForLatestYear.map(d => monthOrder.indexOf(d.Month)).filter(i => i > -1));
        return dataForLatestYear.filter(d => d.Month === monthOrder[latestMonthIndex]);
    }
    
    // --- UI INITIALIZERS ---
    function initializeTabs() {
        const tabs = document.querySelector('.tabs');
        tabs.addEventListener('click', (e) => {
            if (e.target.matches('.tab-link')) {
                tabs.querySelector('.active')?.classList.remove('active');
                e.target.classList.add('active');
                document.querySelector('.tab-content.active')?.classList.remove('active');
                document.getElementById(e.target.dataset.tab)?.classList.add('active');
            }
        });
    }

    function initializeModals() {
        document.querySelectorAll('.modal-container').forEach(modal => {
            const closeBtn = modal.querySelector('.modal-close');
            if(closeBtn) closeBtn.addEventListener('click', () => modal.classList.remove('visible'));
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('visible'); });
        });
    }

    // --- RENDER FUNCTIONS ---
    function renderWeeklyPulse() {
        const container = document.getElementById('weekly-pulse-body');
        const { Days_Passed: daysPassed = 0, Total_Days_in_Month: totalDays = 1 } = weeklyData[0] || {};
        document.getElementById('weekly-title').textContent = `Pacing by KPI (Day ${daysPassed} of ${totalDays})`;
        
        const kpis = [...new Set(weeklyData.map(d => d.KPI))].filter(Boolean);
        container.innerHTML = kpis.map(kpi => {
            const isCumulative = cumulativeKpis.includes(kpi);
            let groupHtml = `<tr class="kpi-group-header"><td colspan="5">${kpi}</td></tr>`;
            
            const renderPlatformRow = (platform) => {
                const platformData = weeklyData.filter(d => d.KPI === kpi && d.Platform === platform);
                if (platformData.length === 0) return '';
                
                const actual = platformData.reduce((sum, item) => sum + (parseFloat(item.MTD_Actual) || 0), 0);
                const fullTarget = platformData.reduce((sum, item) => sum + (parseFloat(item.Full_Month_Target) || 0), 0);
                
                let focusIndicatorHtml = '';
                if (platform === 'Customer Portal' && coreKpis.includes(kpi) && platformData.length > 1) {
                    const worstChannel = platformData.map(d => {
                        const proratedTarget = (parseFloat(d.Full_Month_Target) || 0) * (isCumulative ? 1 : daysPassed / totalDays);
                        return { name: d.Channel, gap: proratedTarget > 0 ? ((parseFloat(d.MTD_Actual) || 0) / proratedTarget) - 1 : 0 };
                    }).sort((a,b) => a.gap - b.gap)[0];
                    if (worstChannel && worstChannel.gap < -0.05) focusIndicatorHtml = `<span class="focus-indicator">(Focus: ${worstChannel.name} behind by ${Math.abs(worstChannel.gap * 100).toFixed(0)}%)</span>`;
                }

                const cells = isCumulative ? `<td></td><td></td>` : (() => {
                    const proratedTarget = fullTarget * (daysPassed / totalDays);
                    const pacingValue = proratedTarget > 0 ? actual / proratedTarget : 0;
                    const pBarClass = pacingValue >= 1 ? 'good' : (pacingValue >= 0.9 ? 'ok' : 'bad');
                    return `<td class="value-cell">${formatValue(kpi, proratedTarget, true)}</td>
                            <td><div class="pacing-cell"><div class="progress-bar-container"><div class="progress-bar ${pBarClass}" style="width: ${Math.min(pacingValue * 100, 100)}%;"></div></div><span class="performance-text">${(pacingValue * 100).toFixed(0)}%</span></div></td>`;
                })();

                const isClickable = platform === 'Customer Portal' ? 'clickable' : '';
                return `<tr class="platform-row ${isClickable}" data-kpi="${kpi}">
                    <td class="kpi-cell"><i class="bi ${kpiIcons[kpi] || 'bi-bar-chart-line-fill'}"></i><span>${platform} ${focusIndicatorHtml}</span></td>
                    <td class="value-cell">${formatValue(kpi, actual)}</td>${cells}<td class="value-cell">${formatValue(kpi, fullTarget)}</td>
                </tr>`;
            };

            groupHtml += renderPlatformRow('Customer Portal');
            groupHtml += renderPlatformRow('Chatbot');
            return groupHtml;
        }).join('');

        container.addEventListener('click', (e) => {
            const row = e.target.closest('tr.clickable');
            if (row) openBreakdownModal(row.dataset.kpi, 'weekly');
        });
    }

    function renderAtAGlance() {
        document.getElementById('header-subtitle').textContent = `Monthly Closing: ${latestMonthData[0]?.Month || ''} ${latestMonthData[0]?.Year || ''} (Snapshot as of ${new Date().toDateString()})`;
        renderCoreKpiTable(latestMonthData);
        renderAnalyticalCards(latestMonthData);
    }

    function renderCoreKpiTable(data) {
        const container = document.getElementById('at-a-glance-body-core');
        container.innerHTML = coreKpis.map(kpi => {
            const cpData = data.find(d => d.KPI === kpi && d.Platform === 'Customer Portal' && d.Channel === 'Total');
            const cbData = data.find(d => d.KPI === kpi && d.Platform === 'Chatbot');
            const totalActual = (parseFloat(cpData?.Actual) || 0) + (parseFloat(cbData?.Actual) || 0);
            const totalTarget = (parseFloat(cpData?.Target) || 0) + (parseFloat(cbData?.Target) || 0);
            const perfHtml = (totalTarget > 0) ? (p => `<td><div class="pacing-cell"><div class="progress-bar-container"><div class="progress-bar ${p >= 1 ? 'good' : p >= 0.9 ? 'ok' : 'bad'}" style="width: ${Math.min(p * 100, 100)}%;"></div></div><span class="performance-text">${(p * 100).toFixed(0)}%</span></div></td>`)(totalActual / totalTarget) : '<td></td>';
            const ytdTrigger = ytdKpis.includes(kpi) ? `<i class="bi bi-calendar-range ytd-trigger" title="View YTD Performance"></i>` : '';

            return `<tr class="clickable" data-kpi="${kpi}">
                <td class="kpi-cell"><i class="bi ${kpiIcons[kpi]}"></i><span>${kpi}</span>${ytdTrigger}</td>
                <td class="value-cell">${formatValue(kpi, totalActual)}</td><td class="value-cell">${formatValue(kpi, totalTarget)}</td>${perfHtml}
                <td class="breakdown-cell">CP: ${formatValue(kpi, cpData?.Actual)} | CB: ${formatValue(kpi, cbData?.Actual)}</td>
                <td class="breakdown-cell">CP: ${formatValue(kpi, cpData?.Target)} | CB: ${formatValue(kpi, cbData?.Target)}</td>
            </tr>`;
        }).join('');

        container.addEventListener('click', (e) => {
            const row = e.target.closest('tr.clickable');
            if (row) e.target.closest('.ytd-trigger') ? openYtdModal(row.dataset.kpi) : openBreakdownModal(row.dataset.kpi, 'monthly');
        });
    }

    function renderAnalyticalCards(data) {
        const container = document.getElementById('at-a-glance-analytical');
        container.innerHTML = nonTargetKpis.map(kpi => {
            const cpData = data.find(d => d.KPI === kpi && d.Platform === 'Customer Portal' && d.Channel === 'Total');
            const cbData = data.find(d => d.KPI === kpi && d.Platform === 'Chatbot');
            if (!cpData && !cbData) return '';
            
            return `<div class="analytical-card clickable" data-kpi="${kpi}">
                <h4><i class="bi ${kpiIcons[kpi] || ''}"></i> ${kpi}</h4>
                <div class="values-grid">
                    <div class="platform-metric">
                        <div class="platform-label">Customer Portal</div>
                        <div class="platform-value">${formatValue(kpi, cpData?.Actual)}</div>
                    </div>
                    <div class="platform-metric">
                        <div class="platform-label">Chatbot</div>
                        <div class="platform-value">${formatValue(kpi, cbData?.Actual)}</div>
                    </div>
                </div>
            </div>`;
        }).join('');
        container.addEventListener('click', (e) => {
            const card = e.target.closest('.analytical-card.clickable');
            if (card) openBreakdownModal(card.dataset.kpi, 'monthly');
        });
    }

    // --- MODAL & INTERACTIVITY FUNCTIONS ---
    function openYtdModal(kpi) {
        const modal = document.getElementById('ytd-modal');
        document.getElementById('ytd-modal-title').textContent = `YTD Performance: ${kpi}`;
        
        const ytdDataByMonth = historicalData.filter(d => d.KPI === kpi && (d.Channel === 'Total' || d.Platform === 'Chatbot'))
            .reduce((acc, d) => {
                acc[d.Month] = acc[d.Month] || { Actual: 0, Target: 0, MonthIndex: monthOrder.indexOf(d.Month) };
                acc[d.Month].Actual += parseFloat(d.Actual) || 0;
                acc[d.Month].Target += parseFloat(d.Target) || 0;
                return acc;
            }, {});
        
        const ytdData = Object.values(ytdDataByMonth).sort((a,b) => a.MonthIndex - b.MonthIndex);
        const ytdActual = ytdData.reduce((sum, item) => sum + item.Actual, 0);
        const ytdTarget = ytdData.reduce((sum, item) => sum + item.Target, 0);
        const ytdPerf = ytdTarget > 0 ? ytdActual / ytdTarget : 0;
        
        document.getElementById('ytd-actual').textContent = formatValue(kpi, ytdActual);
        document.getElementById('ytd-target').textContent = formatValue(kpi, ytdTarget);
        const perfEl = document.getElementById('ytd-performance');
        perfEl.textContent = `${(ytdPerf * 100).toFixed(0)}%`;
        perfEl.className = ytdPerf >= 1 ? 'good' : 'bad';

        const ctx = document.getElementById('ytdModalChart').getContext('2d');
        if (ytdModalChartInstance) ytdModalChartInstance.destroy();

        ytdModalChartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels: ytdData.map(d => monthOrder[d.MonthIndex]), datasets: [
                    { label: 'Actual', data: ytdData.map(d => d.Actual), borderColor: 'var(--coke-red)', tension: 0.1 },
                    { label: 'Target', data: ytdData.map(d => d.Target), borderColor: 'var(--coke-black)', borderDash: [5, 5], tension: 0.1 }
            ]},
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true }, datalabels: { display: false } }, scales: { y: { ticks: { callback: value => formatValue(kpi, value, true) } } } }
        });
        
        modal.classList.add('visible');
    }
    
    function openBreakdownModal(kpi, type) {
        const modal = document.getElementById('kpi-modal');
        const modalTitle = document.getElementById('modal-title');
        modalTitle.textContent = `Channel Breakdown: ${kpi}`;
        
        try {
            const isNonTarget = nonTargetKpis.includes(kpi);
            let labels = [], actuals = [], targets = [];
            const channels = ["LKA", "DSD", "WHS", "Horeca"];
            
            if (type === 'monthly') {
                labels = [...channels, "Chatbot"];
                channels.forEach(ch => {
                    const entry = latestMonthData.find(d => d.KPI === kpi && d.Channel.toLowerCase() === ch.toLowerCase());
                    actuals.push(parseFloat(entry?.Actual) || 0);
                    if (!isNonTarget) targets.push(parseFloat(entry?.Target) || 0);
                });
                const cbEntry = latestMonthData.find(d => d.KPI === kpi && d.Platform === 'Chatbot');
                actuals.push(parseFloat(cbEntry?.Actual) || 0);
                if (!isNonTarget) targets.push(parseFloat(cbEntry?.Target) || 0);
            } else { // weekly
                labels = channels;
                const { Days_Passed: daysPassed = 0, Total_Days_in_Month: totalDays = 1 } = weeklyData[0] || {};
                const multiplier = daysPassed / totalDays;
                channels.forEach(ch => {
                    const entry = weeklyData.find(d => d.KPI === kpi && d.Channel.toLowerCase() === ch.toLowerCase());
                    actuals.push(parseFloat(entry?.MTD_Actual) || 0);
                    if (!isNonTarget) {
                        const proratedTarget = (parseFloat(entry?.Full_Month_Target) || 0) * multiplier;
                        targets.push(proratedTarget);
                    }
                });
            }

            const ctx = document.getElementById('modalChart').getContext('2d');
            if (modalChartInstance) modalChartInstance.destroy();
            
            modalChartInstance = new Chart(ctx, {
                type: 'bar',
                data: { labels, datasets: isNonTarget 
                    ? [{ label: 'Actual', data: actuals, backgroundColor: 'rgba(254, 0, 26, 0.7)' }]
                    : [{ label: 'Actual', data: actuals, backgroundColor: 'rgba(254, 0, 26, 0.7)' }, { label: 'Target', data: targets, backgroundColor: 'rgba(45, 45, 45, 0.7)' }]
                },
                options: {
                    indexAxis: isNonTarget ? 'y' : 'x',
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: !isNonTarget }, datalabels: { anchor: 'end', align: 'end', formatter: (value) => formatValue(kpi, value), color: '#444' }},
                    scales: { y: { beginAtZero: true } }
                }
            });
        } catch (error) {
            console.error(`Failed to build breakdown chart for ${kpi}:`, error);
            if (modalChartInstance) modalChartInstance.destroy();
        } finally {
            modal.classList.add('visible');
        }
    }

    function initializeTrends() {
        const platformFilter = document.getElementById('platform-filter');
        const channelFilter = document.getElementById('channel-filter');
        const chartsContainer = document.getElementById('trend-charts-container');
        if (!platformFilter) return;

        renderMasterTrendChart();
        platformFilter.innerHTML = [...new Set(historicalData.map(d => d.Platform))].map(p => `<option value="${p}">${p}</option>`).join('');
        
        const updateChannelsAndRender = () => {
            const selectedPlatform = platformFilter.value;
            channelFilter.innerHTML = [...new Set(historicalData.filter(d => d.Platform === selectedPlatform).map(d => d.Channel))]
                .map(c => `<option value="${c}">${c === 'N/A' ? 'Total' : c}</option>`).join('');
            renderTrendCharts();
        };

        const renderTrendCharts = () => {
            chartsContainer.innerHTML = '';
            const selectedPlatform = platformFilter.value;
            const selectedChannel = channelFilter.value;
            if(!selectedPlatform || !selectedChannel) return;

            const kpisInSelection = [...new Set(historicalData.filter(d=>d.Platform === selectedPlatform && d.Channel === selectedChannel).map(d => d.KPI))];
            kpisInSelection.forEach((kpi, index) => {
                const kpiData = historicalData.filter(d => d.Platform === selectedPlatform && d.Channel === selectedChannel && d.KPI === kpi).sort((a, b) => monthOrder.indexOf(a.Month) - monthOrder.indexOf(b.Month));
                if (kpiData.length === 0) return;
                const canvas = document.createElement('canvas');
                chartsContainer.appendChild(document.createElement('div')).className = 'trend-chart-card';
                chartsContainer.lastChild.innerHTML = `<h3>${kpi}</h3><div class="trend-chart-container"></div>`;
                chartsContainer.lastChild.querySelector('.trend-chart-container').appendChild(canvas);

                new Chart(canvas.getContext('2d'), {
                    type: 'line', data: { labels: kpiData.map(d => d.Month), datasets: [
                        { label: 'Actual', data: kpiData.map(d => parseFloat(d.Actual)), borderColor: chartColors[index % chartColors.length], tension: 0.1 },
                        { label: 'Target', data: kpiData.map(d => parseFloat(d.Target)), borderColor: 'var(--coke-black)', borderDash: [5, 5], tension: 0.1 }]
                    }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true }, datalabels: { display: false } }, scales: { y: { ticks: { callback: (value) => formatValue(kpi, value, true) } } } }
                });
            });
        };
        platformFilter.addEventListener('change', updateChannelsAndRender);
        channelFilter.addEventListener('change', renderTrendCharts);
        if (historicalData.length > 0) updateChannelsAndRender();
    }

    function renderMasterTrendChart() {
        const chartElement = document.getElementById('masterTrendChart');
        if (!chartElement) return;

        const totalVolumeByMonth = historicalData.filter(d => d.KPI === 'Volume UC' && (d.Channel === 'Total' || d.Platform === 'Chatbot'))
            .reduce((acc, d) => {
                acc[d.Month] = acc[d.Month] || { Actual: 0, Target: 0, MonthIndex: monthOrder.indexOf(d.Month) };
                acc[d.Month].Actual += parseFloat(d.Actual) || 0;
                acc[d.Month].Target += parseFloat(d.Target) || 0;
                return acc;
            }, {});

        const chartData = Object.values(totalVolumeByMonth).sort((a,b) => a.MonthIndex - b.MonthIndex);

        new Chart(chartElement.getContext('2d'), { type: 'line', data: {
            labels: chartData.map(d => monthOrder[d.MonthIndex]), datasets: [
                { label: 'Total Digital Volume', data: chartData.map(d => d.Actual), borderColor: 'var(--coke-red)', backgroundColor: 'rgba(254, 0, 26, 0.1)', tension: 0.1, fill: true },
                { label: 'Total Target', data: chartData.map(d => d.Target), borderColor: 'var(--coke-black)', borderDash: [5, 5], tension: 0.1, fill: false }
            ]}, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true }, datalabels: { display: false } }, scales: { y: { ticks: { callback: (value) => formatValue('Volume UC', value, true) } } } }
        });
    }
    main();
});