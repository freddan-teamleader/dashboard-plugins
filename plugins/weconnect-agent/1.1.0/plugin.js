api.registerWidget({
  type: 'weconnect-vehicle-tracker',
  title: 'WeConnect Vehicle Tracker',
  description: 'Odometer, battery/fuel, and 30-reading history from VW WeConnect',
  height: 280,
  dependencies: ['weconnect-agent'],
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30
  },
  render: async function(container, config) {
    const svc = await api.getService('weconnect-agent')
    container.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;height:100%;gap:10px;color:var(--text-primary);font-family:system-ui,sans-serif">
        <div id="wc-status" style="font-size:12px;color:var(--text-secondary)">Loading…</div>
        <div id="wc-error" style="display:none;background:rgba(255,107,107,0.1);border:1px solid var(--accent-red);color:var(--accent-red);padding:8px;border-radius:6px;font-size:12px"></div>
        <div style="display:flex;gap:16px">
          <div style="flex:1">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Odometer</div>
            <div id="wc-km" style="font-size:24px;font-weight:600">—</div>
          </div>
          <div style="flex:1">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Battery / Fuel</div>
            <div id="wc-pct" style="font-size:24px;font-weight:600">—</div>
          </div>
        </div>
        <svg id="wc-spark" width="100%" height="40" style="margin-top:4px"></svg>
        <div style="display:flex;gap:8px;margin-top:auto">
          <button id="wc-poll" style="padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-tertiary);color:var(--text-primary);cursor:pointer;font-size:12px">↻ Poll now</button>
          <div id="wc-ago" style="font-size:11px;color:var(--text-muted);align-self:center"></div>
        </div>
      </div>
    `

    const $ = (id) => container.querySelector('#' + id)
    let history = []

    function renderReading(r) {
      if (!r) { $('wc-km').textContent = '—'; $('wc-pct').textContent = '—'; return }
      $('wc-km').textContent  = r.km != null ? `${Math.round(r.km).toLocaleString()} km` : '—'
      const pct = r.batteryPct ?? r.fuelPct
      $('wc-pct').textContent = pct != null ? `${Math.round(pct)} %` : '—'
      updateAgo(r.recorded_at)
    }

    function updateAgo(iso) {
      if (!iso) { $('wc-ago').textContent = ''; return }
      const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
      const txt = s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s/60)}m ago` : `${Math.floor(s/3600)}h ago`
      $('wc-ago').textContent = `Updated ${txt}`
    }

    function renderSpark() {
      const svg = $('wc-spark')
      svg.innerHTML = ''
      const pts = history.filter(r => r.km != null).slice(-30).reverse()
      if (pts.length < 2) return
      const w = svg.clientWidth || 200, h = 40
      const xs = pts.map(p => new Date(p.recorded_at).getTime())
      const ys = pts.map(p => p.km)
      const xMin = Math.min(...xs), xMax = Math.max(...xs)
      const yMin = Math.min(...ys), yMax = Math.max(...ys)
      const xr = xMax - xMin || 1, yr = yMax - yMin || 1
      const d = pts.map((p, i) => {
        const x = ((xs[i] - xMin) / xr) * (w - 4) + 2
        const y = h - 2 - ((ys[i] - yMin) / yr) * (h - 4)
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')
      svg.innerHTML = `<path d="${d}" fill="none" stroke="var(--accent-green)" stroke-width="2"/>`
    }

    function renderStatus(s) {
      $('wc-status').textContent = s.status === 'ok' ? 'Live' :
                                   s.status === 'polling' ? 'Polling…' :
                                   s.status === 'authenticating' ? 'Authenticating…' :
                                   s.status === 'error' ? 'Error' : s.status
      const err = $('wc-error')
      if (s.status === 'error') { err.style.display = 'block'; err.textContent = s.message || 'Unknown error' }
      else err.style.display = 'none'
    }

    async function loadHistory() {
      if (!svc) return
      history = await svc.getHistory(30)
      renderSpark()
    }

    if (!svc) {
      $('wc-status').textContent = 'Agent not installed'
      $('wc-error').style.display = 'block'
      $('wc-error').textContent = 'Install "WeConnect Agent" plugin first, then reload.'
      return
    }

    renderStatus(svc.getStatus())
    renderReading(svc.getLastReading())
    await loadHistory()

    const unsubReading = api.on('weconnect-agent:reading:new', (r) => {
      renderReading(r)
      history.unshift(r)
      history = history.slice(0, 30)
      renderSpark()
    })
    const unsubStatus = api.on('weconnect-agent:status:change', renderStatus)

    $('wc-poll').addEventListener('click', () => svc.poll())

    const agoTimer = setInterval(() => {
      const r = svc.getLastReading()
      if (r) updateAgo(r.recorded_at)
    }, 15000)

    container.__cleanup__ = () => {
      unsubReading(); unsubStatus(); clearInterval(agoTimer)
    }
  }
})