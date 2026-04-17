// @bump: patch
const svc = api.getService('weconnect-agent')

api.registerWidget({
  type: "weconnect-vehicle-tracker",
  title: "WeConnect Vehicle Tracker",
  description: "Live odometer, battery/fuel level and historical sparkline from WeConnect",
  height: 280,
  defaultConfig: { vin: '' },

  render: async function(container, config) {
    // ── Styles ────────────────────────────────────────────────────────────────
    container.innerHTML = `
      <style>
        .wc-root { font-family: sans-serif; padding: 14px 16px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; }
        .wc-header { display: flex; justify-content: space-between; align-items: center; }
        .wc-title { color: var(--text-secondary); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
        .wc-btn { background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-secondary); font-size: 11px; padding: 3px 9px; border-radius: 5px; cursor: pointer; }
        .wc-btn:hover { color: var(--text-primary); }
        .wc-stats { display: flex; gap: 12px; }
        .wc-stat { flex: 1; background: var(--bg-tertiary); border-radius: 8px; padding: 10px 12px; }
        .wc-stat-label { font-size: 10px; color: var(--text-muted); margin-bottom: 3px; }
        .wc-stat-value { font-size: 22px; font-weight: 700; color: var(--text-primary); }
        .wc-stat-unit { font-size: 11px; color: var(--text-secondary); margin-left: 2px; }
        .wc-chart-wrap { flex: 1; min-height: 0; }
        .wc-footer { font-size: 10px; color: var(--text-muted); text-align: right; }
        .wc-error { color: var(--accent-red); font-size: 12px; padding: 8px; background: var(--bg-tertiary); border-radius: 6px; }
      </style>
      <div class="wc-root">
        <div class="wc-header">
          <span class="wc-title">WeConnect</span>
          <button class="wc-btn" id="wc-poll">↻ Poll now</button>
        </div>
        <div class="wc-stats">
          <div class="wc-stat">
            <div class="wc-stat-label">Odometer</div>
            <div><span class="wc-stat-value" id="wc-odo">—</span><span class="wc-stat-unit">km</span></div>
          </div>
          <div class="wc-stat">
            <div class="wc-stat-label" id="wc-level-label">Battery</div>
            <div><span class="wc-stat-value" id="wc-level">—</span><span class="wc-stat-unit">%</span></div>
          </div>
        </div>
        <div class="wc-chart-wrap">
          <canvas id="wc-canvas" style="width:100%;height:100%"></canvas>
        </div>
        <div class="wc-footer" id="wc-footer">Waiting for data…</div>
      </div>
    `

    const elOdo    = container.querySelector('#wc-odo')
    const elLevel  = container.querySelector('#wc-level')
    const elLabel  = container.querySelector('#wc-level-label')
    const elFooter = container.querySelector('#wc-footer')
    const canvas   = container.querySelector('#wc-canvas')
    const btnPoll  = container.querySelector('#wc-poll')

    let chart = null
    const { Chart, registerables } = await import('https://esm.sh/chart.js')
    Chart.register(...registerables)

    // ── Chart setup ───────────────────────────────────────────────────────────
    function initChart(rows) {
      if (chart) { chart.destroy(); chart = null }
      const labels  = rows.map(r => new Date(r.recorded_at).toLocaleDateString())
      const odoData = rows.map(r => r.odometer)
      const lvlData = rows.map(r => r.level)

      const ctx = canvas.getContext('2d')
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Odometer (km)',
              data: odoData,
              borderColor: '#60a5fa',
              backgroundColor: 'rgba(96,165,250,0.08)',
              borderWidth: 2,
              pointRadius: 2,
              tension: 0.3,
              yAxisID: 'yOdo'
            },
            {
              label: 'Level (%)',
              data: lvlData,
              borderColor: '#4ade80',
              backgroundColor: 'rgba(74,222,128,0.08)',
              borderWidth: 2,
              pointRadius: 2,
              tension: 0.3,
              yAxisID: 'yLvl'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x:    { display: false },
            yOdo: { display: false, position: 'left' },
            yLvl: { display: false, position: 'right', min: 0, max: 100 }
          }
        }
      })
    }

    // ── Update UI ─────────────────────────────────────────────────────────────
    function applyReading(r, rows) {
      if (!r) return
      elOdo.textContent   = r.odometer ? r.odometer.toLocaleString() : '—'
      elLevel.textContent = r.level    != null ? r.level : '—'
      elLabel.textContent = r.level_type === 'fuel' ? 'Fuel' : 'Battery'
      const ago = Math.round((Date.now() - new Date(r.recorded_at)) / 60000)
      elFooter.textContent = `Updated ${ago < 1 ? 'just now' : ago + ' min ago'} · VIN: ${r.vin || '—'}`
      if (rows?.length) initChart(rows)
    }

    function showError(msg) {
      elFooter.innerHTML = `<span class="wc-error">⚠ ${msg}</span>`
    }

    // ── Load history from api.db ──────────────────────────────────────────────
    let rows = []
    try {
      rows = await api.db.query({}, { orderBy: 'recorded_at', ascending: true, limit: 30 })
    } catch (e) {
      showError('DB unavailable: ' + e.message)
    }

    if (rows.length > 0) {
      applyReading(rows[rows.length - 1], rows)
    } else {
      // No history yet — check hiddenConfig for last reading from agent
      const last = config.lastReading
      if (last) {
        applyReading(last, [])
        elFooter.textContent = 'No DB history yet — showing cached reading'
      } else {
        elOdo.textContent   = '—'
        elLevel.textContent = '—'
        elFooter.textContent = svc
          ? 'No data yet — click ↻ Poll now to fetch'
          : '⚠ WeConnect Agent not installed'
      }
    }

    // ── Live updates from agent ───────────────────────────────────────────────
    const unsub = api.on('weconnect-agent:reading:new', async (reading) => {
      try {
        rows = await api.db.query({}, { orderBy: 'recorded_at', ascending: true, limit: 30 })
      } catch (_) {
        rows = [...rows, reading].slice(-30)
      }
      applyReading(reading, rows)
    })

    // ── Poll button ───────────────────────────────────────────────────────────
    btnPoll.addEventListener('click', async () => {
      if (!svc) { showError('WeConnect Agent not installed'); return }
      btnPoll.textContent = '…'
      btnPoll.disabled = true
      try {
        await svc.poll()
      } catch (e) {
        showError(e.message)
      } finally {
        btnPoll.textContent = '↻ Poll now'
        btnPoll.disabled = false
      }
    })

    // ── Cleanup ───────────────────────────────────────────────────────────────
    container.__cleanup__ = () => {
      unsub()
      if (chart) chart.destroy()
    }
  }
})