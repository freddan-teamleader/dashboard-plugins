// @bump: minor
const svc = await api.getService('weconnect-agent');

api.registerWidget({
  type: 'weconnect-vehicle-tracker',
  title: 'WeConnect Vehicle Tracker',
  description: 'Live odometer, battery/fuel level and history from Volkswagen WeConnect',
  height: 320,
  defaultConfig: { vin: '' },
  dependencies: ['weconnect-agent'],

  render: async function(container, config) {
    // ── Styles ───────────────────────────────────────────────────────────────
    container.innerHTML = `
      <style>
        .wc-wrap { font-family: system-ui, sans-serif; padding: 14px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; }
        .wc-status { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
        .wc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-green); flex-shrink: 0; }
        .wc-dot.error { background: var(--accent-red); }
        .wc-dot.polling { background: var(--accent-orange); animation: wc-pulse 1s infinite; }
        @keyframes wc-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        .wc-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .wc-card { background: var(--bg-tertiary); border-radius: 10px; padding: 10px 14px; border: 1px solid var(--border); }
        .wc-card-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
        .wc-card-value { font-size: 22px; font-weight: 700; color: var(--text-primary); line-height: 1; }
        .wc-card-unit { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
        .wc-chart-wrap { flex: 1; min-height: 0; background: var(--bg-tertiary); border-radius: 10px; border: 1px solid var(--border); padding: 8px; position: relative; }
        .wc-chart-title { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
        .wc-error { color: var(--accent-red); font-size: 12px; padding: 8px; background: var(--bg-tertiary); border-radius: 8px; border: 1px solid var(--border); word-break: break-word; }
        .wc-btn { font-size: 11px; color: var(--accent-blue); background: none; border: 1px solid var(--accent-blue); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
        .wc-btn:hover { background: var(--bg-hover); }
        .wc-row { display: flex; align-items: center; justify-content: space-between; }
      </style>
      <div class="wc-wrap">
        <div class="wc-row">
          <div class="wc-status"><div class="wc-dot" id="wc-dot"></div><span id="wc-status-text">Connecting…</span></div>
          <button class="wc-btn" id="wc-poll-btn">↻ Poll now</button>
        </div>
        <div id="wc-error-box" style="display:none" class="wc-error"></div>
        <div class="wc-cards">
          <div class="wc-card">
            <div class="wc-card-label">Odometer</div>
            <div class="wc-card-value" id="wc-odo">—</div>
            <div class="wc-card-unit">km</div>
          </div>
          <div class="wc-card">
            <div class="wc-card-label" id="wc-level-label">Battery</div>
            <div class="wc-card-value" id="wc-level">—</div>
            <div class="wc-card-unit" id="wc-level-unit">%</div>
          </div>
        </div>
        <div class="wc-chart-wrap">
          <div class="wc-chart-title">Last 30 readings — <span id="wc-chart-label">battery %</span></div>
          <canvas id="wc-canvas" style="width:100%;height:calc(100% - 20px);display:block"></canvas>
        </div>
      </div>
    `;

    const dot        = container.querySelector('#wc-dot');
    const statusText = container.querySelector('#wc-status-text');
    const errorBox   = container.querySelector('#wc-error-box');
    const odoEl      = container.querySelector('#wc-odo');
    const levelEl    = container.querySelector('#wc-level');
    const levelLabel = container.querySelector('#wc-level-label');
    const levelUnit  = container.querySelector('#wc-level-unit');
    const chartLabel = container.querySelector('#wc-chart-label');
    const canvas     = container.querySelector('#wc-canvas');
    const pollBtn    = container.querySelector('#wc-poll-btn');

    let chartHistory = [];

    // ── Render sparkline with Chart.js ───────────────────────────────────────
    let chartInstance = null;
    async function drawChart(rows) {
      const { Chart, registerables } = await import('https://esm.sh/chart.js');
      Chart.register(...registerables);
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      if (!rows.length) return;

      const isSOC = rows[0].level_type !== 'fuel';
      chartLabel.textContent = isSOC ? 'battery %' : 'fuel %';

      const labels = rows.map(r => {
        const d = new Date(r.recorded_at || r.timestamp);
        return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
      });
      const levelData = rows.map(r => r.level ?? r.level);
      const odoData   = rows.map(r => r.odometer);

      chartInstance = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: isSOC ? 'SOC %' : 'Fuel %',
              data: levelData,
              borderColor: '#4ade80',
              backgroundColor: 'rgba(74,222,128,0.1)',
              tension: 0.4,
              pointRadius: 2,
              yAxisID: 'yLevel'
            },
            {
              label: 'Odometer (km)',
              data: odoData,
              borderColor: '#60a5fa',
              backgroundColor: 'rgba(96,165,250,0.05)',
              tension: 0.4,
              pointRadius: 2,
              yAxisID: 'yOdo'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { display: false },
            yLevel: {
              position: 'left',
              ticks: { color: '#4ade80', font: { size: 9 }, maxTicksLimit: 4 },
              grid:  { color: 'rgba(255,255,255,0.05)' },
              min: 0, max: 100
            },
            yOdo: {
              position: 'right',
              ticks: { color: '#60a5fa', font: { size: 9 }, maxTicksLimit: 4 },
              grid:  { display: false }
            }
          }
        }
      });
    }

    // ── Update cards ─────────────────────────────────────────────────────────
    function updateCards(reading) {
      if (!reading) return;
      odoEl.textContent   = reading.odometer != null ? reading.odometer.toLocaleString() : '—';
      levelEl.textContent = reading.level     != null ? reading.level : '—';
      const isSOC = reading.levelType === 'soc' || reading.level_type === 'soc';
      levelLabel.textContent = isSOC ? 'Battery' : 'Fuel';
      levelUnit.textContent  = '%';
      // Color-code battery level
      levelEl.style.color = reading.level == null ? 'var(--text-primary)'
        : reading.level < 20 ? 'var(--accent-red)'
        : reading.level < 50 ? 'var(--accent-orange)'
        : 'var(--accent-green)';
    }

    function setStatus(status, message) {
      dot.className = 'wc-dot' + (status === 'error' ? ' error' : status === 'polling' ? ' polling' : '');
      statusText.textContent = message || status;
      if (status === 'error') {
        errorBox.style.display = 'block';
        errorBox.textContent   = '⚠ ' + message;
      } else {
        errorBox.style.display = 'none';
      }
    }

    // ── No service guard ─────────────────────────────────────────────────────
    if (!svc) {
      setStatus('error', 'WeConnect Agent service not installed');
      return;
    }

    // ── Load historical data from DB ─────────────────────────────────────────
    try {
      const rows = await api.db.query({}, { orderBy: 'recorded_at', ascending: false, limit: 30 });
      if (rows && rows.length) {
        chartHistory = rows.reverse();
        updateCards({ ...rows[rows.length - 1], levelType: rows[rows.length - 1].level_type });
        await drawChart(chartHistory);
        const lastTs = new Date(rows[rows.length-1].recorded_at);
        setStatus('idle', `Last reading: ${lastTs.toLocaleTimeString()}`);
      } else {
        setStatus('idle', 'No readings yet — waiting for first poll…');
      }
    } catch (e) {
      console.warn('[weconnect-widget] DB load failed:', e.message);
      setStatus('idle', 'No cached data — waiting for agent…');
    }

    // ── Show current agent status ────────────────────────────────────────────
    const agentStatus = svc.getStatus?.();
    if (agentStatus?.status === 'error') {
      setStatus('error', agentStatus.lastError || 'Agent error');
    } else if (agentStatus?.status === 'polling') {
      setStatus('polling', 'Fetching…');
    }

    // ── Subscribe to live events ─────────────────────────────────────────────
    const unsubReading = api.on('weconnect-agent:reading:new', async (reading) => {
      updateCards(reading);
      chartHistory.push({ ...reading, level_type: reading.levelType, recorded_at: reading.timestamp });
      if (chartHistory.length > 30) chartHistory.shift();
      await drawChart(chartHistory);
      setStatus('idle', `Last poll: ${new Date().toLocaleTimeString()}`);
    });

    const unsubStatus = api.on('weconnect-agent:status:change', ({ status, message }) => {
      setStatus(status, message);
    });

    pollBtn.addEventListener('click', () => {
      setStatus('polling', 'Fetching…');
      svc.pollNow?.();
    });

    container.__cleanup__ = () => {
      unsubReading();
      unsubStatus();
      if (chartInstance) chartInstance.destroy();
    };
  }
});