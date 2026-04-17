// @bump: major
const _svc = api.getService('weconnect-agent')

api.registerWidget({
  type: 'weconnect-vehicle-tracker',
  title: 'WeConnect Vehicle Tracker',
  description: 'Live odometer, battery/fuel level and trend from VW WeConnect',
  height: 320,
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30
  },

  render(container, config) {
    const svc = _svc

    // Push credentials to agent whenever widget renders
    if (svc) {
      svc.setConfig({
        email: config.email,
        password: config.password,
        vin: config.vin,
        pollIntervalMinutes: config.pollIntervalMinutes
      })
    }

    // ── Styles ────────────────────────────────────────────────────────────────
    container.innerHTML = `
      <style>
        .wc-wrap { font-family: system-ui, sans-serif; padding: 16px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; background: var(--bg-secondary); color: var(--text-primary); }
        .wc-error { background: rgba(255,107,107,0.15); border: 1px solid var(--accent-red); border-radius: 8px; padding: 10px 14px; color: var(--accent-red); font-size: 13px; }
        .wc-status { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
        .wc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-green); flex-shrink: 0; }
        .wc-dot.error { background: var(--accent-red); }
        .wc-dot.polling { background: var(--accent-orange); }
        .wc-dot.idle,.wc-dot.authenticating { background: var(--accent-blue); }
        .wc-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .wc-card { background: var(--bg-tertiary); border-radius: 10px; padding: 12px 14px; }
        .wc-card-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: .05em; }
        .wc-card-value { font-size: 26px; font-weight: 700; color: var(--text-primary); line-height: 1; }
        .wc-card-unit { font-size: 13px; color: var(--text-secondary); margin-left: 3px; }
        .wc-chart-wrap { flex: 1; min-height: 0; }
        .wc-chart-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: .05em; }
        canvas.wc-canvas { width: 100% !important; height: 100%; border-radius: 8px; }
        .wc-footer { display: flex; align-items: center; justify-content: space-between; }
        .wc-btn { background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-secondary); border-radius: 6px; padding: 4px 10px; font-size: 11px; cursor: pointer; }
        .wc-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
        .wc-no-svc { text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: 13px; }
      </style>
      <div class="wc-wrap" id="wc-root">
        <div class="wc-no-svc">Loading…</div>
      </div>
    `

    if (!svc) {
      container.querySelector('#wc-root').innerHTML =
        '<div class="wc-no-svc">⚠️ WeConnect Agent not installed.<br>Install the agent service first.</div>'
      return
    }

    if (!config.email || !config.password) {
      container.querySelector('#wc-root').innerHTML =
        '<div class="wc-error">⚙️ Enter your WeConnect <strong>email</strong> and <strong>password</strong> in Settings (⋮ menu).</div>'
      return
    }

    let chart = null
    let readings = []

    // ── Build UI ──────────────────────────────────────────────────────────────
    const root = container.querySelector('#wc-root')
    root.innerHTML = `
      <div class="wc-status">
        <div class="wc-dot idle" id="wc-dot"></div>
        <span id="wc-status-txt">Connecting…</span>
      </div>
      <div id="wc-error-box" style="display:none" class="wc-error"></div>
      <div class="wc-stats">
        <div class="wc-card">
          <div class="wc-card-label">Odometer</div>
          <div><span class="wc-card-value" id="wc-odo">—</span><span class="wc-card-unit">km</span></div>
        </div>
        <div class="wc-card">
          <div class="wc-card-label" id="wc-level-label">Battery</div>
          <div><span class="wc-card-value" id="wc-level">—</span><span class="wc-card-unit">%</span></div>
        </div>
      </div>
      <div class="wc-chart-wrap">
        <div class="wc-chart-label" id="wc-chart-label">Last readings</div>
        <canvas id="wc-canvas" class="wc-canvas" height="80"></canvas>
      </div>
      <div class="wc-footer">
        <span class="wc-status" id="wc-ts" style="color:var(--text-muted);font-size:11px">No readings yet</span>
        <button class="wc-btn" id="wc-poll-btn">↻ Poll now</button>
      </div>
    `

    // ── Helpers ───────────────────────────────────────────────────────────────
    function setStatusUI(s) {
      const dot = root.querySelector('#wc-dot')
      const txt = root.querySelector('#wc-status-txt')
      const err = root.querySelector('#wc-error-box')
      dot.className = 'wc-dot ' + (s.status || 'idle')
      txt.textContent = s.message || s.status
      if (s.status === 'error') {
        err.style.display = ''
        err.textContent = '⚠️ ' + s.message
      } else {
        err.style.display = 'none'
      }
    }

    function updateCards(r) {
      if (!r) return
      const odo   = root.querySelector('#wc-odo')
      const level = root.querySelector('#wc-level')
      const lbl   = root.querySelector('#wc-level-label')
      const ts    = root.querySelector('#wc-ts')
      if (r.odometer != null) odo.textContent = Number(r.odometer).toLocaleString()
      if (r.level     != null) level.textContent = Math.round(r.level)
      lbl.textContent = r.levelType === 'fuel' ? 'Fuel' : 'Battery'
      if (r.ts) {
        const d = new Date(r.ts)
        const diff = Math.round((Date.now() - d) / 60000)
        ts.textContent = diff < 1 ? 'Just now' : diff < 60 ? `${diff} min ago` : `${Math.round(diff/60)}h ago`
      }
    }

    async function drawChart(data) {
      if (!data || data.length === 0) return
      const { default: Chart } = await import('https://esm.sh/chart.js/auto')
      const canvas = root.querySelector('#wc-canvas')
      if (!canvas) return
      if (chart) { chart.destroy(); chart = null }

      const sorted  = [...data].sort((a, b) => new Date(a.ts) - new Date(b.ts))
      const labels  = sorted.map(r => {
        const d = new Date(r.ts)
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      })
      const odoVals   = sorted.map(r => r.odometer)
      const levelVals = sorted.map(r => r.level)

      const style = getComputedStyle(document.documentElement)
      const green  = style.getPropertyValue('--accent-green').trim()  || '#4ade80'
      const blue   = style.getPropertyValue('--accent-blue').trim()   || '#60a5fa'
      const muted  = style.getPropertyValue('--text-muted').trim()    || '#64748b'

      chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Odometer (km)',
              data: odoVals,
              borderColor: blue,
              backgroundColor: blue + '22',
              yAxisID: 'y',
              tension: 0.3,
              pointRadius: 2,
              fill: true
            },
            {
              label: sorted[0]?.levelType === 'fuel' ? 'Fuel %' : 'Battery %',
              data: levelVals,
              borderColor: green,
              backgroundColor: green + '22',
              yAxisID: 'y1',
              tension: 0.3,
              pointRadius: 2,
              fill: true
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { labels: { color: muted, font: { size: 10 }, boxWidth: 10 } } },
          scales: {
            x:  { display: false },
            y:  { display: true, position: 'left',  ticks: { color: muted, font: { size: 9 }, maxTicksLimit: 4 }, grid: { color: muted + '22' } },
            y1: { display: true, position: 'right', ticks: { color: muted, font: { size: 9 }, maxTicksLimit: 4 }, grid: { display: false }, min: 0, max: 100 }
          }
        }
      })

      const chartLabel = root.querySelector('#wc-chart-label')
      if (chartLabel) chartLabel.textContent = `Last ${sorted.length} readings`
    }

    // ── Load history from DB ──────────────────────────────────────────────────
    svc.getHistory(30).then(rows => {
      if (rows && rows.length > 0) {
        readings = rows
        updateCards(rows[0]) // newest first
        drawChart(rows)
      }
    })

    // ── Live status ───────────────────────────────────────────────────────────
    setStatusUI(svc.getStatus())
    const unsubStatus = api.on('weconnect-agent:status:change', s => setStatusUI(s))

    // ── Live readings ─────────────────────────────────────────────────────────
    const unsubReading = api.on('weconnect-agent:reading:new', r => {
      readings.unshift(r)
      if (readings.length > 30) readings.pop()
      updateCards(r)
      drawChart(readings)
    })

    // ── Poll now button ───────────────────────────────────────────────────────
    root.querySelector('#wc-poll-btn').addEventListener('click', () => {
      svc.pollNow().catch(() => {})
    })

    container.__cleanup__ = () => {
      unsubStatus()
      unsubReading()
      if (chart) { chart.destroy(); chart = null }
    }
  }
})