// @bump: patch
const svc = await api.getService('weconnect-agent');

api.registerWidget({
  type: 'weconnect-vehicle-tracker',
  title: 'WeConnect Vehicle Tracker',
  description: 'Live odometer, battery/fuel level and history from Volkswagen WeConnect',
  height: 320,
  defaultConfig: { vin: '' },
  dependencies: ['weconnect-agent'],

  render: async function(container, config) {
    container.innerHTML = `
      <style>
        .wc-wrap { font-family: system-ui, sans-serif; padding: 14px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
        .wc-status { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
        .wc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-green); flex-shrink: 0; }
        .wc-dot.error   { background: var(--accent-red); }
        .wc-dot.polling { background: var(--accent-orange); animation: wc-pulse 1s infinite; }
        @keyframes wc-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        .wc-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .wc-card { background: var(--bg-tertiary); border-radius: 10px; padding: 10px 14px; border: 1px solid var(--border); }
        .wc-card-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
        .wc-card-value { font-size: 22px; font-weight: 700; color: var(--text-primary); line-height: 1; }
        .wc-card-unit  { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
        .wc-chart-wrap { flex: 1; min-height: 0; background: var(--bg-tertiary); border-radius: 10px; border: 1px solid var(--border); padding: 8px; }
        .wc-chart-title { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
        .wc-error { color: var(--accent-red); font-size: 11px; padding: 6px 10px; background: var(--bg-tertiary); border-radius: 8px; border: 1px solid var(--accent-red); word-break: break-word; max-height: 56px; overflow: auto; }
        .wc-btn { font-size: 11px; color: var(--accent-blue); background: none; border: 1px solid var(--accent-blue); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
        .wc-btn:hover { background: var(--bg-hover); }
        .wc-row { display: flex; align-items: center; justify-content: space-between; }
        .wc-bridge-note { font-size: 10px; color: var(--text-muted); background: var(--bg-tertiary); border-radius: 6px; padding: 5px 8px; border: 1px solid var(--border); }
        .wc-bridge-note a { color: var(--accent-blue); }
      </style>
      <div class="wc-wrap">
        <div class="wc-row">
          <div class="wc-status"><div class="wc-dot" id="wc-dot"></div><span id="wc-status-text">Starting…</span></div>
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
            <div class="wc-card-unit">%</div>
          </div>
        </div>
        <div class="wc-chart-wrap">
          <div class="wc-chart-title">Last 30 readings — <span id="wc-chart-label">level %</span> & odometer</div>
          <canvas id="wc-canvas" style="width:100%;height:calc(100% - 20px);display:block"></canvas>
        </div>
      </div>`;

    const dot        = container.querySelector('#wc-dot')
    const statusText = container.querySelector('#wc-status-text')
    const errorBox   = container.querySelector('#wc-error-box')
    const odoEl      = container.querySelector('#wc-odo')
    const levelEl    = container.querySelector('#wc-level')
    const levelLabel = container.querySelector('#wc-level-label')
    const chartLabel = container.querySelector('#wc-chart-label')
    const canvas     = container.querySelector('#wc-canvas')
    const pollBtn    = container.querySelector('#wc-poll-btn')

    let chartInstance = null
    let chartHistory  = []

    function setStatus(status, message) {
      dot.className = 'wc-dot' + (status === 'error' ? ' error' : status === 'polling' ? ' polling' : '')
      statusText.textContent = message
      if (status === 'error') { errorBox.style.display = 'block'; errorBox.textContent = '⚠ ' + message }
      else errorBox.style.display = 'none'
    }

    function updateCards(r) {
      if (!r) return
      odoEl.textContent   = r.odometer != null ? Number(r.odometer).toLocaleString() : '—'
      levelEl.textContent = r.level    != null ? r.level : '—'
      const isSOC = (r.levelType || r.level_type) !== 'fuel'
      levelLabel.textContent = isSOC ? 'Battery' : 'Fuel'
      chartLabel.textContent = isSOC ? 'battery %' : 'fuel %'
      levelEl.style.color = r.level == null ? 'var(--text-primary)'
        : r.level < 20 ? 'var(--accent-red)'
        : r.level < 50 ? 'var(--accent-orange)'
        : 'var(--accent-green)'
    }

    async function drawChart(rows) {
      if (!rows.length) return
      const { Chart, registerables } = await import('https://esm.sh/chart.js')
      Chart.register(...registerables)
      if (chartInstance) { chartInstance.destroy(); chartInstance = null }

      const labels = rows.map(r => {
        const d = new Date(r.recorded_at || r.timestamp)
        return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
      })
      const levels = rows.map(r => r.level  ?? null)
      const odoms  = rows.map(r => r.odometer ?? null)

      chartInstance = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets: [
          { label: 'Level %',  data: levels, borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.1)', tension: 0.4, pointRadius: 2, yAxisID: 'yL' },
          { label: 'Odo (km)', data: odoms,  borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.05)', tension: 0.4, pointRadius: 2, yAxisID: 'yO' }
        ]},
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x:  { display: false },
            yL: { position: 'left',  min: 0, max: 100, ticks: { color: '#4ade80', font: { size: 9 }, maxTicksLimit: 4 }, grid: { color: 'rgba(255,255,255,0.05)' } },
            yO: { position: 'right', ticks: { color: '#60a5fa', font: { size: 9 }, maxTicksLimit: 4 }, grid: { display: false } }
          }
        }
      })
    }

    if (!svc) { setStatus('error', 'WeConnect Agent not installed'); return }

    // Load history from DB immediately
    try {
      const rows = await api.db.query({}, { orderBy: 'recorded_at', ascending: false, limit: 30 })
      if (rows?.length) {
        chartHistory = [...rows].reverse()
        const latest = chartHistory[chartHistory.length - 1]
        updateCards({ ...latest, levelType: latest.level_type })
        await drawChart(chartHistory)
        setStatus('idle', `Last reading: ${new Date(latest.recorded_at).toLocaleTimeString()}`)
      } else {
        const live = svc.getLastReading?.()
        if (live) { updateCards(live); setStatus('idle', 'Live (no DB history yet)') }
        else setStatus('polling', 'Waiting for first poll…')
      }
    } catch (e) {
      console.warn('[weconnect-widget] DB load error:', e.message)
      const live = svc.getLastReading?.()
      if (live) updateCards(live)
      setStatus('idle', 'DB unavailable — using live data')
    }

    const agentStatus = svc.getStatus?.()
    if (agentStatus?.status === 'error')   setStatus('error',   agentStatus.message)
    else if (agentStatus?.status === 'polling') setStatus('polling', agentStatus.message)

    const unsubR = api.on('weconnect-agent:reading:new', async (r) => {
      updateCards(r)
      chartHistory.push({ ...r, level_type: r.levelType, recorded_at: r.timestamp })
      if (chartHistory.length > 30) chartHistory.shift()
      await drawChart(chartHistory)
      setStatus('idle', `Updated ${new Date().toLocaleTimeString()}`)
    })
    const unsubS = api.on('weconnect-agent:status:change', ({ status, message }) => setStatus(status, message))

    pollBtn.addEventListener('click', () => { setStatus('polling', 'Fetching…'); svc.pollNow?.() })

    container.__cleanup__ = () => { unsubR(); unsubS(); if (chartInstance) chartInstance.destroy() }
  }
})