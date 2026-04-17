// @bump: patch
api.registerWidget({
  type: 'weconnect-vehicle-tracker',
  title: 'WeConnect Vehicle Tracker',
  description: 'Live odometer, battery/fuel level and historical sparkline from VW WeConnect',
  height: 320,
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30
  },
  dependencies: ['weconnect-agent'],
  render: async function(container, config) {
    const svc = await api.getService('weconnect-agent')

    const s = (prop) => `style="${prop}"`
    container.innerHTML = `
      <div id="wc-root" style="
        font-family: system-ui, sans-serif;
        padding: 16px;
        height: 100%;
        box-sizing: border-box;
        background: var(--bg-secondary);
        color: var(--text-primary);
        display: flex;
        flex-direction: column;
        gap: 12px;
      ">
        <div id="wc-error" style="display:none; background:#ff6b6b22; border:1px solid #ff6b6b; color:#ff6b6b; padding:8px 12px; border-radius:8px; font-size:13px;"></div>
        <div style="display:flex; gap:16px;">
          <div style="flex:1; background:var(--bg-tertiary); border-radius:10px; padding:12px; text-align:center;">
            <div style="color:var(--text-muted); font-size:11px; text-transform:uppercase; letter-spacing:.05em;">Odometer</div>
            <div id="wc-odo" style="font-size:26px; font-weight:700; color:var(--accent-blue); margin-top:4px;">—</div>
            <div style="color:var(--text-muted); font-size:11px;">km</div>
          </div>
          <div style="flex:1; background:var(--bg-tertiary); border-radius:10px; padding:12px; text-align:center;">
            <div style="color:var(--text-muted); font-size:11px; text-transform:uppercase; letter-spacing:.05em;" id="wc-level-label">Battery</div>
            <div id="wc-level" style="font-size:26px; font-weight:700; color:var(--accent-green); margin-top:4px;">—</div>
            <div style="color:var(--text-muted); font-size:11px;">%</div>
          </div>
        </div>
        <div style="background:var(--bg-tertiary); border-radius:10px; padding:12px; flex:1; min-height:0;">
          <div style="color:var(--text-muted); font-size:11px; margin-bottom:6px;">Last 30 readings</div>
          <canvas id="wc-chart" style="width:100%; height:80px; display:block;"></canvas>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div id="wc-status" style="font-size:11px; color:var(--text-muted);">Initialising…</div>
          <button id="wc-poll-btn" style="
            background:var(--accent-blue);
            color:#000;
            border:none;
            border-radius:6px;
            padding:4px 12px;
            font-size:12px;
            cursor:pointer;
            font-weight:600;
          ">↻ Poll now</button>
        </div>
      </div>
    `

    const errEl = container.querySelector('#wc-error')
    const odoEl = container.querySelector('#wc-odo')
    const levelEl = container.querySelector('#wc-level')
    const labelEl = container.querySelector('#wc-level-label')
    const statusEl = container.querySelector('#wc-status')
    const pollBtn = container.querySelector('#wc-poll-btn')
    const canvas = container.querySelector('#wc-chart')

    function showError(msg) {
      errEl.style.display = msg ? 'block' : 'none'
      errEl.textContent = msg || ''
    }

    function applyReading(r) {
      if (!r) return
      if (r.odometer != null) odoEl.textContent = r.odometer.toLocaleString()
      if (r.soc != null) {
        levelEl.textContent = r.soc
        labelEl.textContent = 'Battery'
        levelEl.style.color = r.soc < 20 ? 'var(--accent-red)' : r.soc < 50 ? 'var(--accent-orange)' : 'var(--accent-green)'
      } else if (r.fuelLevel != null) {
        levelEl.textContent = r.fuelLevel
        labelEl.textContent = 'Fuel'
        levelEl.style.color = r.fuelLevel < 20 ? 'var(--accent-red)' : r.fuelLevel < 50 ? 'var(--accent-orange)' : 'var(--accent-green)'
      }
      const ago = Math.round((Date.now() - new Date(r.ts)) / 60000)
      statusEl.textContent = ago < 1 ? 'Updated just now' : `Updated ${ago}m ago`
    }

    // Draw sparkline on canvas manually (no lib needed)
    function drawSparkline(rows, key) {
      const ctx = canvas.getContext('2d')
      const W = canvas.offsetWidth || 300
      const H = canvas.offsetHeight || 80
      canvas.width = W
      canvas.height = H
      ctx.clearRect(0, 0, W, H)

      const vals = rows.map(r => r[key]).filter(v => v != null)
      if (vals.length < 2) {
        ctx.fillStyle = 'var(--text-muted)'
        ctx.font = '12px system-ui'
        ctx.fillText('Not enough data yet', 10, H / 2)
        return
      }

      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const range = max - min || 1
      const pad = 6

      const points = vals.map((v, i) => ({
        x: pad + (i / (vals.length - 1)) * (W - pad * 2),
        y: pad + (1 - (v - min) / range) * (H - pad * 2)
      }))

      // Gradient fill
      const grad = ctx.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, 'rgba(96,165,250,0.35)')
      grad.addColorStop(1, 'rgba(96,165,250,0)')
      ctx.beginPath()
      ctx.moveTo(points[0].x, H)
      points.forEach(p => ctx.lineTo(p.x, p.y))
      ctx.lineTo(points[points.length - 1].x, H)
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()

      // Line
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      points.forEach(p => ctx.lineTo(p.x, p.y))
      ctx.strokeStyle = '#60a5fa'
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.stroke()

      // Last dot
      const last = points[points.length - 1]
      ctx.beginPath()
      ctx.arc(last.x, last.y, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#60a5fa'
      ctx.fill()
    }

    async function loadHistory() {
      try {
        const vin = config.vin || null
        const filters = vin ? { vin } : {}
        const rows = await api.db.query(filters, { orderBy: 'recorded_at', ascending: true, limit: 30 })
        if (rows && rows.length > 0) {
          applyReading({
            odometer: rows[rows.length - 1].odometer,
            soc: rows[rows.length - 1].soc,
            fuelLevel: rows[rows.length - 1].fuel_level,
            ts: rows[rows.length - 1].recorded_at
          })
          const key = rows.some(r => r.soc != null) ? 'soc' : 'fuel_level'
          drawSparkline(rows, key)
          return true
        }
      } catch (e) {
        console.warn('[weconnect-widget] db load failed', e.message)
      }
      return false
    }

    // Guard: no credentials
    if (!config.email || !config.password) {
      showError('Enter your WeConnect email & password in widget Settings (⚙)')
      statusEl.textContent = 'Not configured'
      pollBtn.style.display = 'none'
      return
    }

    // Guard: no service
    if (!svc) {
      showError('WeConnect Agent service not found — please install it first')
      statusEl.textContent = 'No agent'
      return
    }

    // Push credentials to agent
    svc.setConfig({
      email: config.email,
      password: config.password,
      vin: config.vin,
      pollIntervalMinutes: config.pollIntervalMinutes
    })

    // Load from DB first (immediate data while agent polls)
    const hadHistory = await loadHistory()
    if (!hadHistory) statusEl.textContent = 'No readings yet — polling…'

    // Show current agent status
    const agentStatus = svc.getStatus()
    if (agentStatus.lastReading) applyReading(agentStatus.lastReading)
    if (agentStatus.status === 'error') showError(agentStatus.message)

    // Live updates from agent events
    const unsubReading = api.on('weconnect-agent:reading:new', async (reading) => {
      showError('')
      applyReading(reading)
      await loadHistory() // refresh sparkline from DB
    })

    const unsubStatus = api.on('weconnect-agent:status:change', ({ status, message }) => {
      if (status === 'error') showError(message)
      else { showError(''); statusEl.textContent = message }
    })

    pollBtn.addEventListener('click', () => {
      statusEl.textContent = 'Polling…'
      svc.pollNow()
    })

    container.__cleanup__ = () => {
      unsubReading()
      unsubStatus()
    }
  }
})