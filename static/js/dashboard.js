// ═══════════════════════════════════════════════════════════════════════════
//  Live Market Dashboard — Client-side logic
// ═══════════════════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────────────────
let currentTicker = null;
let currentPeriod = '1mo';
let currentInterval = '1d';
let chartType = 'candlestick';
let chart = null;
let mainSeries = null;
let volumeSeries = null;
let countdownSeconds = 15 * 60;
let quotesCache = {};
let searchTimeout = null;
let activeTabId = 0;
let contextMenuTabId = null;

// User's timezone offset in seconds (positive = east of UTC)
var userTzOffsetSec = -(new Date().getTimezoneOffset()) * 60;

// Get short timezone name (e.g. "EST", "PST", "CST")
function getUserTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch(e) {
        return '';
    }
}

function getTimezoneAbbr() {
    try {
        // Try to get short abbreviation like "EST", "PST"
        var str = new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' });
        var parts = str.split(' ');
        return parts[parts.length - 1]; // last part is the tz abbr
    } catch(e) {
        return '';
    }
}

// Format time with timezone abbreviation
function formatLocalTime() {
    var time = new Date().toLocaleTimeString();
    var tz = getTimezoneAbbr();
    return tz ? time + ' ' + tz : time;
}

// ── Chart Setup ────────────────────────────────────────────────────────────

function initChart() {
    const container = document.getElementById('chart-container');
    if (!container) return;

    // Destroy old chart cleanly
    if (chart) {
        try { chart.remove(); } catch(e) {}
        chart = null;
        mainSeries = null;
        volumeSeries = null;
    }

    chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: {
            background: { type: 'solid', color: '#161922' },
            textColor: '#9ca3af',
            fontSize: 12,
            fontFamily: "'Inter', system-ui, sans-serif",
        },
        grid: {
            vertLines: { color: '#1c1f2e' },
            horzLines: { color: '#1c1f2e' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { color: '#3b82f6', width: 1, style: 2, labelBackgroundColor: '#3b82f6' },
            horzLine: { color: '#3b82f6', width: 1, style: 2, labelBackgroundColor: '#3b82f6' },
        },
        timeScale: {
            borderColor: '#252836',
            timeVisible: currentPeriod === '1d' || currentPeriod === '5d',
            secondsVisible: false,
        },
        rightPriceScale: {
            borderColor: '#252836',
        },
    });
}

async function loadChart(ticker, period, interval) {
    if (!chart) initChart();
    if (!chart) return;

    // Remove existing series safely
    try { if (mainSeries) chart.removeSeries(mainSeries); } catch(e) {}
    try { if (volumeSeries) chart.removeSeries(volumeSeries); } catch(e) {}
    mainSeries = null;
    volumeSeries = null;

    try {
        const resp = await fetch('/api/chart/' + ticker + '?period=' + period + '&interval=' + interval);
        const rawData = await resp.json();
        if (!rawData || !rawData.length) return;

        // Determine if this is an intraday interval
        var isIntraday = ['1m','2m','5m','15m','30m','60m','90m','1h'].indexOf(interval) !== -1;

        // Adjust timestamps from UTC to user's local timezone
        var data = rawData.map(function(d) {
            var adjusted = Object.assign({}, d);
            if (isIntraday) {
                // For intraday: shift UTC unix timestamp by user's tz offset
                adjusted.time = d.time + userTzOffsetSec;
            } else {
                // For daily+: convert UTC timestamp to local YYYY-MM-DD string
                // This prevents date shifting (e.g. Feb 24 UTC showing as Feb 23 in US timezones)
                var localDate = new Date(d.time * 1000);
                var y = localDate.getFullYear();
                var m = ('0' + (localDate.getMonth() + 1)).slice(-2);
                var day = ('0' + localDate.getDate()).slice(-2);
                adjusted.time = y + '-' + m + '-' + day;
            }
            return adjusted;
        });

        // Deduplicate daily data (in case timezone conversion creates duplicate dates)
        if (!isIntraday) {
            var seen = {};
            data = data.filter(function(d) {
                if (seen[d.time]) return false;
                seen[d.time] = true;
                return true;
            });
        }

        const lastClose = data[data.length - 1].close;
        const firstOpen = data[0].open;
        const isGain = lastClose >= firstOpen;
        const upColor = '#22c55e';
        const downColor = '#ef4444';

        if (chartType === 'candlestick') {
            mainSeries = chart.addCandlestickSeries({
                upColor: upColor,
                downColor: downColor,
                borderUpColor: upColor,
                borderDownColor: downColor,
                wickUpColor: upColor,
                wickDownColor: downColor,
            });
            mainSeries.setData(data);
        } else {
            mainSeries = chart.addAreaSeries({
                topColor: isGain ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                bottomColor: isGain ? 'rgba(34, 197, 94, 0.02)' : 'rgba(239, 68, 68, 0.02)',
                lineColor: isGain ? upColor : downColor,
                lineWidth: 2,
            });
            mainSeries.setData(data.map(function(d) { return { time: d.time, value: d.close }; }));
        }

        // Volume
        volumeSeries = chart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
        });
        volumeSeries.setData(data.map(function(d) {
            return {
                time: d.time,
                value: d.volume,
                color: d.close >= d.open ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
            };
        }));

        chart.applyOptions({
            timeScale: { timeVisible: period === '1d' || period === '5d' }
        });

        chart.timeScale().fitContent();

    } catch (err) {
        console.error('Chart load error:', err);
    }
}

// ── Ticker Selection ───────────────────────────────────────────────────────

function selectTicker(ticker) {
    currentTicker = ticker;

    // Update active card styling
    document.querySelectorAll('.ticker-card').forEach(function(c) {
        c.classList.remove('active');
        c.style.boxShadow = '';
    });
    var card = document.getElementById('card-' + ticker);
    if (card) {
        card.classList.add('active');
        card.style.boxShadow = '0 0 0 2px #3b82f6';
    }

    // Update chart header
    var q = quotesCache[ticker];
    document.getElementById('chart-ticker').textContent = ticker;
    document.getElementById('chart-name').textContent = q ? q.name : ticker;

    // Update detail stats
    updateDetailStats(q);

    // Load chart
    initChart();
    loadChart(ticker, currentPeriod, currentInterval);
}

function updateDetailStats(q) {
    if (!q) return;
    document.getElementById('stat-open').textContent = '$' + q.price.toFixed(2);
    document.getElementById('stat-high').textContent = '$' + q.high.toFixed(2);
    document.getElementById('stat-low').textContent = '$' + q.low.toFixed(2);
    document.getElementById('stat-prev').textContent = '$' + q.prev_close.toFixed(2);
    document.getElementById('stat-volume').textContent = formatVolume(q.volume);

    var changeEl = document.getElementById('stat-change');
    var sign = q.change >= 0 ? '+' : '';
    changeEl.textContent = sign + q.change.toFixed(2) + ' (' + sign + q.change_pct.toFixed(2) + '%)';
    changeEl.className = 'mono text-sm ' + (q.change >= 0 ? 'text-gain' : 'text-loss');

    // 52-week high/low
    var el52h = document.getElementById('stat-52h');
    var el52l = document.getElementById('stat-52l');
    if (el52h) {
        el52h.textContent = q.week52_high != null ? '$' + q.week52_high.toFixed(2) : '-';
        // Color: red if current price is near 52w low, green if near 52w high
        if (q.week52_high != null && q.price >= q.week52_high * 0.97) {
            el52h.className = 'mono text-sm text-gain';
        } else {
            el52h.className = 'mono text-sm text-gray-200';
        }
    }
    if (el52l) {
        el52l.textContent = q.week52_low != null ? '$' + q.week52_low.toFixed(2) : '-';
        if (q.week52_low != null && q.price <= q.week52_low * 1.03) {
            el52l.className = 'mono text-sm text-loss';
        } else {
            el52l.className = 'mono text-sm text-gray-200';
        }
    }

    // P/E Ratio
    var elPe = document.getElementById('stat-pe');
    if (elPe) {
        elPe.textContent = q.pe_ratio != null ? q.pe_ratio.toFixed(2) : 'N/A';
    }

    // Extended hours stats
    updateExtendedHoursStats(q);
}

function updateExtendedHoursStats(q) {
    if (!q) return;

    var extBar = document.getElementById('ext-stats-bar');
    var pmBox = document.getElementById('stat-pm-box');
    var ahBox = document.getElementById('stat-ah-box');
    var hasPM = q.pre_market_price != null;
    var hasAH = q.post_market_price != null;

    if (!hasPM && !hasAH) {
        if (extBar) extBar.classList.add('hidden');
        return;
    }

    if (extBar) extBar.classList.remove('hidden');

    // Pre-market
    if (hasPM && pmBox) {
        pmBox.classList.remove('hidden');
        document.getElementById('stat-pm-price').textContent = '$' + q.pre_market_price.toFixed(2);
        var pmSign = q.pre_market_change >= 0 ? '+' : '';
        var pmChangeEl = document.getElementById('stat-pm-change');
        pmChangeEl.textContent = pmSign + q.pre_market_change.toFixed(2) + ' (' + pmSign + q.pre_market_change_pct.toFixed(2) + '%)';
        pmChangeEl.className = 'mono text-[10px] truncate ' + (q.pre_market_change >= 0 ? 'text-gain' : 'text-loss');
    } else if (pmBox) {
        pmBox.classList.add('hidden');
    }

    // After hours
    if (hasAH && ahBox) {
        ahBox.classList.remove('hidden');
        document.getElementById('stat-ah-price').textContent = '$' + q.post_market_price.toFixed(2);
        var ahSign = q.post_market_change >= 0 ? '+' : '';
        var ahChangeEl = document.getElementById('stat-ah-change');
        ahChangeEl.textContent = ahSign + q.post_market_change.toFixed(2) + ' (' + ahSign + q.post_market_change_pct.toFixed(2) + '%)';
        ahChangeEl.className = 'mono text-[10px] truncate ' + (q.post_market_change >= 0 ? 'text-gain' : 'text-loss');
    } else if (ahBox) {
        ahBox.classList.add('hidden');
    }
}

function updateExtendedHoursCard(ticker, q) {
    var extRow = document.getElementById('ext-' + ticker);
    if (!extRow) return;

    var hasPM = q.pre_market_price != null;
    var hasAH = q.post_market_price != null;

    if (!hasPM && !hasAH) {
        extRow.classList.add('hidden');
        return;
    }

    extRow.classList.remove('hidden');

    var labelEl = document.getElementById('ext-label-' + ticker);
    var priceEl = document.getElementById('ext-price-' + ticker);
    var changeEl = document.getElementById('ext-change-' + ticker);

    // Prefer after-hours if available, otherwise show pre-market
    if (hasAH) {
        labelEl.textContent = 'AH:';
        priceEl.textContent = '$' + q.post_market_price.toFixed(2);
        var sign = q.post_market_change >= 0 ? '+' : '';
        changeEl.textContent = sign + q.post_market_change.toFixed(2) + ' (' + sign + q.post_market_change_pct.toFixed(2) + '%)';
        priceEl.className = 'mono text-[9px] ' + (q.post_market_change >= 0 ? 'text-gain' : 'text-loss');
        changeEl.className = 'mono text-[9px] ' + (q.post_market_change >= 0 ? 'text-gain' : 'text-loss');
    } else if (hasPM) {
        labelEl.textContent = 'PM:';
        priceEl.textContent = '$' + q.pre_market_price.toFixed(2);
        var sign = q.pre_market_change >= 0 ? '+' : '';
        changeEl.textContent = sign + q.pre_market_change.toFixed(2) + ' (' + sign + q.pre_market_change_pct.toFixed(2) + '%)';
        priceEl.className = 'mono text-[9px] ' + (q.pre_market_change >= 0 ? 'text-gain' : 'text-loss');
        changeEl.className = 'mono text-[9px] ' + (q.pre_market_change >= 0 ? 'text-gain' : 'text-loss');
    }
}

// ── Period & Chart Type ────────────────────────────────────────────────────

function setPeriod(period, interval) {
    currentPeriod = period;
    currentInterval = interval;

    document.querySelectorAll('[data-period]').forEach(function(btn) {
        btn.classList.remove('active');
        btn.classList.add('text-gray-400');
    });
    var activeBtn = document.querySelector('[data-period="' + period + '"]');
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.classList.remove('text-gray-400');
    }

    if (currentTicker) {
        initChart();
        loadChart(currentTicker, period, interval);
    }
}

function setChartType(type) {
    chartType = type;

    document.getElementById('btn-candlestick').classList.toggle('active', type === 'candlestick');
    document.getElementById('btn-area').classList.toggle('active', type === 'area');
    document.getElementById('btn-candlestick').classList.toggle('text-gray-400', type !== 'candlestick');
    document.getElementById('btn-area').classList.toggle('text-gray-400', type !== 'area');

    if (currentTicker) {
        initChart();
        loadChart(currentTicker, currentPeriod, currentInterval);
    }
}

// ── Refresh / Auto-refresh ─────────────────────────────────────────────────

async function refreshAll() {
    var btn = document.getElementById('refresh-btn');
    var icon = document.getElementById('refresh-icon');
    if (btn) btn.disabled = true;
    if (icon) icon.style.animation = 'spin 0.8s linear infinite';

    try {
        var resp = await fetch('/api/quotes?tab_id=' + activeTabId);
        var quotes = await resp.json();
        quotesCache = quotes;
        updateAllCards(quotes);
        updateSummary(quotes);

        if (currentTicker && quotes[currentTicker]) {
            updateDetailStats(quotes[currentTicker]);
        }
        if (currentTicker) {
            loadChart(currentTicker, currentPeriod, currentInterval);
        }

        document.getElementById('summary-updated').textContent = formatLocalTime();

    } catch (err) {
        console.error('Refresh error:', err);
    } finally {
        if (btn) btn.disabled = false;
        if (icon) icon.style.animation = '';
        countdownSeconds = 15 * 60;
    }
}

function updateAllCards(quotes) {
    for (var ticker in quotes) {
        var q = quotes[ticker];
        var priceEl = document.getElementById('price-' + ticker);
        var changeEl = document.getElementById('change-' + ticker);

        if (priceEl) {
            var oldPrice = priceEl.textContent.trim();
            var newPrice = '$' + q.price.toFixed(2);

            priceEl.textContent = newPrice;
            priceEl.className = 'mono text-xs font-semibold ' + (q.change >= 0 ? 'text-gain' : 'text-loss');

            if (oldPrice !== newPrice && oldPrice !== '-') {
                var card = document.getElementById('card-' + ticker);
                if (card) {
                    card.classList.remove('flash-green', 'flash-red');
                    void card.offsetWidth;
                    card.classList.add(q.change >= 0 ? 'flash-green' : 'flash-red');
                }
            }
        }

        if (changeEl) {
            var sign = q.change >= 0 ? '+' : '';
            changeEl.textContent = sign + q.change.toFixed(2) + ' (' + sign + q.change_pct.toFixed(2) + '%)';
            changeEl.className = 'mono text-[10px] ' + (q.change >= 0 ? 'text-gain' : 'text-loss');
        }

        // Update company name tooltip with full long_name
        var card = document.getElementById('card-' + ticker);
        if (card) {
            var nameEl = card.querySelector('.truncate');
            if (nameEl) {
                nameEl.setAttribute('title', q.long_name || q.name || ticker);
            }
        }

        // Update extended hours on each card
        updateExtendedHoursCard(ticker, q);
    }
}

function updateSummary(quotes) {
    var values = Object.values(quotes);
    var gainers = values.filter(function(q) { return q.change >= 0; }).length;
    var losers = values.filter(function(q) { return q.change < 0; }).length;

    document.getElementById('summary-count').textContent = values.length;
    document.getElementById('summary-gainers').textContent = gainers;
    document.getElementById('summary-losers').textContent = losers;
}

function startCountdown() {
    setInterval(function() {
        countdownSeconds--;
        if (countdownSeconds <= 0) {
            refreshAll();
            countdownSeconds = 15 * 60;
        }
        var mins = Math.floor(countdownSeconds / 60);
        var secs = countdownSeconds % 60;
        var timeStr = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
        document.getElementById('countdown').textContent = timeStr;
        // Update mobile countdown too
        var mobileCountdown = document.getElementById('countdown-mobile');
        if (mobileCountdown) mobileCountdown.textContent = timeStr;
    }, 1000);
}

// ── Search Modal ───────────────────────────────────────────────────────────

function openSearchModal() {
    var modal = document.getElementById('search-modal');
    modal.style.display = 'flex';
    setTimeout(function() { document.getElementById('search-input').focus(); }, 100);
}

function closeSearchModal() {
    var modal = document.getElementById('search-modal');
    modal.style.display = 'none';
    document.getElementById('search-input').value = '';
    document.getElementById('search-results').innerHTML =
        '<div class="text-center text-gray-500 text-sm py-8">Type to search for stocks, ETFs...</div>';
}

// ESC to close modal
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeSearchModal();
});

function handleSearchInput() {
    var input = document.getElementById('search-input');
    if (!input) return;

    input.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        var query = input.value.trim();
        if (query.length < 1) {
            document.getElementById('search-results').innerHTML =
                '<div class="text-center text-gray-500 text-sm py-8">Type to search for stocks, ETFs...</div>';
            return;
        }

        document.getElementById('search-spinner').classList.remove('hidden');

        searchTimeout = setTimeout(async function() {
            try {
                var resp = await fetch('/api/search?q=' + encodeURIComponent(query));
                var results = await resp.json();
                renderSearchResults(results);
            } catch (err) {
                console.error('Search error:', err);
            } finally {
                document.getElementById('search-spinner').classList.add('hidden');
            }
        }, 300);
    });
}

function renderSearchResults(results) {
    var container = document.getElementById('search-results');

    if (!results.length) {
        container.innerHTML = '<div class="text-center text-gray-500 text-sm py-8">No results found</div>';
        return;
    }

    var html = '';
    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var safeName = (r.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        var safeLongName = (r.long_name || r.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        html += '<button onclick="addTickerFromSearch(\'' + r.ticker + '\', \'' + safeName + '\')"' +
            ' class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-surface-3 transition text-left group">' +
            '<div>' +
            '<span class="font-semibold text-white text-sm">' + r.ticker + '</span>' +
            '<span class="text-xs text-gray-500 ml-2">' + (r.exchange || '') + '</span>' +
            '<div class="text-xs text-gray-400 truncate max-w-[280px]" title="' + safeLongName + '">' + (r.name || '') + '</div>' +
            '</div>' +
            '<div class="flex items-center gap-1 text-accent opacity-0 group-hover:opacity-100 transition text-xs font-medium">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
            ' Add' +
            '</div>' +
            '</button>';
    }
    container.innerHTML = html;
}

// ── Watchlist Management ───────────────────────────────────────────────────

async function addTickerFromSearch(ticker, name) {
    try {
        var resp = await fetch('/api/watchlist/' + activeTabId + '/' + ticker, {
            method: 'POST',
        });

        if (resp.ok) {
            closeSearchModal();
            window.location.href = '/?tab=' + activeTabId;
        } else {
            closeSearchModal();
            selectTicker(ticker);
        }
    } catch (err) {
        console.error('Add ticker error:', err);
    }
}

async function removeTicker(ticker) {
    try {
        var resp = await fetch('/api/watchlist/' + activeTabId + '/' + ticker, { method: 'DELETE' });
        if (resp.ok) {
            var card = document.getElementById('card-' + ticker);
            if (card) {
                card.style.transition = 'all 0.3s ease';
                card.style.opacity = '0';
                card.style.transform = 'translateX(-20px)';
                setTimeout(function() {
                    card.remove();
                    var remaining = document.querySelectorAll('.ticker-card').length;
                    document.getElementById('card-count').textContent = remaining + ' tickers';
                    document.getElementById('summary-count').textContent = remaining;

                    if (currentTicker === ticker) {
                        var first = document.querySelector('.ticker-card');
                        if (first) {
                            var newTicker = first.id.replace('card-', '');
                            selectTicker(newTicker);
                        }
                    }
                }, 300);
            }
        }
    } catch (err) {
        console.error('Remove ticker error:', err);
    }
}

// ── Utility ────────────────────────────────────────────────────────────────

function formatVolume(vol) {
    if (!vol) return '-';
    if (vol >= 1e9) return (vol / 1e9).toFixed(1) + 'B';
    if (vol >= 1e6) return (vol / 1e6).toFixed(1) + 'M';
    if (vol >= 1e3) return (vol / 1e3).toFixed(1) + 'K';
    return vol.toString();
}

// ── Drag & Drop Reorder ─────────────────────────────────────────────────────

var dragSrcEl = null;

function initDragAndDrop() {
    var list = document.getElementById('ticker-list');
    if (!list) return;

    list.addEventListener('dragstart', function(e) {
        var card = e.target.closest('.ticker-card');
        if (!card) return;
        dragSrcEl = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.getAttribute('data-ticker'));
    });

    list.addEventListener('dragend', function(e) {
        var card = e.target.closest('.ticker-card');
        if (card) card.classList.remove('dragging');
        // Remove all drag-over styling
        list.querySelectorAll('.ticker-card').forEach(function(c) {
            c.classList.remove('drag-over');
        });
        dragSrcEl = null;
    });

    list.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        var card = e.target.closest('.ticker-card');
        if (!card || card === dragSrcEl) return;

        // Remove drag-over from all, add to current target
        list.querySelectorAll('.ticker-card').forEach(function(c) {
            c.classList.remove('drag-over');
        });
        card.classList.add('drag-over');
    });

    list.addEventListener('dragleave', function(e) {
        var card = e.target.closest('.ticker-card');
        if (card) card.classList.remove('drag-over');
    });

    list.addEventListener('drop', function(e) {
        e.preventDefault();
        var targetCard = e.target.closest('.ticker-card');
        if (!targetCard || !dragSrcEl || targetCard === dragSrcEl) return;

        targetCard.classList.remove('drag-over');

        // Determine drop position: before or after target
        var rect = targetCard.getBoundingClientRect();
        var midY = rect.top + rect.height / 2;
        var insertBefore = e.clientY < midY;

        if (insertBefore) {
            targetCard.parentNode.insertBefore(dragSrcEl, targetCard);
        } else {
            targetCard.parentNode.insertBefore(dragSrcEl, targetCard.nextSibling);
        }

        // Persist new order to backend
        saveTickerOrder();
    });
}

function saveTickerOrder() {
    var list = document.getElementById('ticker-list');
    if (!list) return;

    var tickers = [];
    list.querySelectorAll('.ticker-card').forEach(function(card) {
        var ticker = card.getAttribute('data-ticker');
        if (ticker) tickers.push(ticker);
    });

    fetch('/api/watchlist/' + activeTabId + '/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: tickers }),
    })
    .catch(function(err) { console.error('Reorder error:', err); });
}

// ── Tab Management ─────────────────────────────────────────────────────────

function switchTab(tabId) {
    window.location.href = '/?tab=' + tabId;
}

function promptNewTab() {
    var name = prompt('Enter a name for the new list:');
    if (!name || !name.trim()) return;

    fetch('/api/tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
    })
    .then(function(r) { return r.json(); })
    .then(function(tab) {
        window.location.href = '/?tab=' + tab.id;
    })
    .catch(function(err) { console.error('Create tab error:', err); });
}

function showTabMenu(tabId, event) {
    event.preventDefault();
    contextMenuTabId = tabId;
    var menu = document.getElementById('tab-context-menu');
    menu.style.display = 'block';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
}

function hideTabMenu() {
    var menu = document.getElementById('tab-context-menu');
    if (menu) menu.style.display = 'none';
    contextMenuTabId = null;
}

// Close context menu on click anywhere
document.addEventListener('click', function(e) {
    var menu = document.getElementById('tab-context-menu');
    if (menu && menu.style.display !== 'none' && !menu.contains(e.target)) {
        hideTabMenu();
    }
});

function renameCurrentTab() {
    var tabId = contextMenuTabId;
    hideTabMenu();
    if (!tabId && tabId !== 0) return;

    var tabBtn = document.querySelector('[data-tab-id="' + tabId + '"]');
    var currentName = tabBtn ? tabBtn.textContent.trim() : '';
    var newName = prompt('Rename list:', currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    fetch('/api/tabs/' + tabId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
    })
    .then(function(r) {
        if (r.ok && tabBtn) {
            tabBtn.textContent = newName.trim();
        }
    })
    .catch(function(err) { console.error('Rename tab error:', err); });
}

function deleteCurrentTab() {
    var tabId = contextMenuTabId;
    hideTabMenu();
    if (!tabId && tabId !== 0) return;

    if (!confirm('Delete this list and all its tickers?')) return;

    fetch('/api/tabs/' + tabId, { method: 'DELETE' })
    .then(function(r) {
        if (r.ok) {
            // Navigate to first remaining tab
            window.location.href = '/';
        } else {
            return r.json().then(function(data) {
                alert(data.message || 'Cannot delete this tab');
            });
        }
    })
    .catch(function(err) { console.error('Delete tab error:', err); });
}

// ── Responsive chart resize ────────────────────────────────────────────────

var resizeTimeout = null;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function() {
        if (chart) {
            var container = document.getElementById('chart-container');
            if (container) {
                chart.applyOptions({
                    width: container.clientWidth,
                    height: container.clientHeight,
                });
            }
        }
    }, 150);
});

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
    // Determine active tab from the highlighted tab button
    var activeBtn = document.querySelector('.tab-button.bg-accent');
    if (activeBtn) {
        activeTabId = parseInt(activeBtn.getAttribute('data-tab-id')) || 0;
    }

    // Show user's timezone
    var tzEl = document.getElementById('user-timezone');
    if (tzEl) {
        var tzName = getUserTimezone();
        if (tzName) tzEl.textContent = tzName;
    }

    // Setup drag-and-drop reorder
    initDragAndDrop();

    // Setup search handler
    handleSearchInput();

    // Load quotes into cache, then select first ticker
    fetch('/api/quotes?tab_id=' + activeTabId)
        .then(function(r) { return r.json(); })
        .then(function(quotes) {
            quotesCache = quotes;
            updateAllCards(quotes);
            updateSummary(quotes);
            document.getElementById('summary-updated').textContent = formatLocalTime();

            // Select first ticker card
            var firstCard = document.querySelector('.ticker-card');
            if (firstCard) {
                var ticker = firstCard.id.replace('card-', '');
                selectTicker(ticker);
            }
        })
        .catch(function(err) {
            console.error('Init error:', err);
            var firstCard = document.querySelector('.ticker-card');
            if (firstCard) {
                var ticker = firstCard.id.replace('card-', '');
                selectTicker(ticker);
            }
        });

    // Start auto-refresh countdown
    startCountdown();
});
