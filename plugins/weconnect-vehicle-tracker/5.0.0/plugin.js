// @bump: major
const svc = await api.getService('weconnect-agent')

api.registerWidget({
  type: 'weconnect-vehicle-tracker',
  title: 'WeConnect Vehicle Tracker',
  description: 'Live odometer, battery/fuel level and historical sparkline from WeConnect',
  height: 320,
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30,
  },

  render: async function(container, config) {
    // ── Save credentials so they persist across reloads ──────────────────────
    // (api.updateConfig is only called when values actually change)
    // Push config to agent whenever render is called (covers first load + settings change)
    if (svc) {
      svc.setConfig({
        email:               config.email,
        password:            config.password,
        vin:                 config.vin,
        pollIntervalMinutes: config.pollIntervalMinutes,
      })
    }

    // ── Guard: no credentials ─────────────────────────────────────────────────
    if (!config.email || !config.password) {
      container.innerHTML = `
        <div style="padding:20px;color:var(--text-secondary);text-align:center;font-family:sans-serif">
          <div style="font-size:32px;margin-bottom:8px">🚗</div>
          <div style="color:var(--text-primary);font-weight:600;margin-bottom:4px">WeConnect Tracker</div>
          <div style="font-size:13px">Open Settings and enter your WeConnect email, password and VIN.</div>
        </div>`
      return
    }

    // ── Guard: no service ─────────────────────────────────────────────────────
    if (!svc) {
      container.innerHTML = `
        <div style="padding:20px;color:var(--accent-red);text-align:center;font-family:sans-serif;font-size:13px">
          ⚠️ WeConnect Agent service not installed.<br>Install it first, then reload.
        </div>`
      return
    }

    // ── Load history from DB ──────────────────────────────────────────────────
    let history = []
    try {
      history = await api.db.query(
        config.vin ? { vin: config.vin } : {},
        { orderBy: 'ts', ascending: false, limit: 30 }
      )
      history = history.reverse()
    } catch (e) {
      console.warn('[weconnect-widget] db.query failed:', e.message)
    }

    // ── Render shell ──────────────────────────────────────────────────────────
    container.innerHTML = `
      <div id="wc-root" style="
        font-family: sans-serif;
        padding: 14px;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: var(--bg-secondary);
        border-radius: 10px;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:700;color:var(--text-primary);font-size:15px">🚗 WeConnect</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span id="wc-status" style="font-size:11px;color:var(--text-muted)">Loading…</span>
            <button id="wc-poll-btn" style="
              font-size:11px;padding:3px 8px;border-radius:5px;cursor:pointer;
              background:var(--bg-tertiary);color:var(--text-secondary);
              border:1px solid var(--border)
            ">↻ Poll</button>
          </div>
        </div>

        <div id="wc-error" style="display:none;background:#ff6b6b22;border:1px solid var(--accent-red);
          border-radius:6px;padding:8px;font-size:12px;color:var(--accent-red)"></div>

        <div style="display:flex;gap:10px">
          <div style="flex:1;background:var(--bg-tertiary);border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">ODOMETER</div>
            <div id="wc-odo" style="font-size:22px;font-weight:700;color:var(--text-primary)">—</div>
            <div style="font-size:10px;color:var(--text-muted)">km</div>
          </div>
          <div style="flex:1;background:var(--bg-tertiary);border-radius:8px;padding:10px;text-align:center">
            <div id="wc-level-label" style="font-size:11px;color:var(--text-muted);margin-bottom:2px">BATTERY</div>
            <div id="wc-level" style="font-size:22px;font-weight:700;color:var(--accent-green)">—</div>
            <div style="font-size:10px;color:var(--text-muted)">%</div>
          </div>
          <div style="flex:1;background:var(--bg-tertiary);border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">LAST UPDATE</div>
            <div id="wc-age" style="font-size:16px;font-weight:700;color:var(--text-primary)">—</div>
          </div>
        </div>

        <div style="flex:1;min-height:80px;background:var(--bg-tertiary);border-radius:8px;padding:8px">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">ODOMETER TREND (last 30 readings)</div>
          <canvas id="wc-chart" style="width:100%;height:70px;display:block"></canvas>
        </div>
      </div>
    `

    // ── Helpers ───────────────────────────────────────────────────────────────
    function timeAgo(isoTs) {
      const diff = Math.floor((Date.now() - new Date(isoTs)) / 1000)
      if (diff < 60)   return `${diff}s ago`
      if (diff < 3600) return `${Math.floor(diff/60)}m ago`
      if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
      return `${Math.floor(diff/86400)}d ago`
    }

    function updateStats(reading) {
      if (!reading) return
      const odo   = container.querySelector('#wc-odo')
      const level = container.querySelector('#wc-level')
      const label = container.querySelector('#wc-level-label')
      const age   = container.querySelector('#wc-age')
      if (odo)   odo.textContent   = reading.odometer != null ? reading.odometer.toLocaleString() : '—'
      if (level) level.textContent = reading.level     != null ? reading.level : '—'
      if (label) label.textContent = (reading.levelType === 'fuel' ? 'FUEL' : 'BATTERY')
      if (age)   age.textContent   = reading.ts ? timeAgo(reading.ts) : '—'
    }

    function updateStatus(s) {
      const el  = container.querySelector('#wc-status')
      const err = container.querySelector('#wc-error')
      if (!el) return
      const map = { ok: '🟢 Live', polling: '🔄 Polling…', authenticating: '🔑 Auth…', idle: '⏸ Idle', error: '🔴 Error' }
      el.textContent = map[s.status] || s.status
      if (err) {
        if (s.status === 'error') { err.style.display = 'block'; err.textContent = s.message }
        else                       { err.style.display = 'none' }
      }
    }

    function drawSparkline(readings) {
      const canvas = container.querySelector('#wc-chart')
      if (!canvas) return
      const ctx    = canvas.getContext('2d')
      const vals   = readings.map(r => r.odometer).filter(v => v != null)
      if (vals.length < 2) {
        ctx.fillStyle = 'var(--text-muted)'
        ctx.font = '11px sans-serif'
        ctx.fillText('Not enough data yet', 10, 40)
        return
      }
      const W    = canvas.offsetWidth  || 300
      const H    = canvas.offsetHeight || 70
      canvas.width  = W
      canvas.height = H
      ctx.clearRect(0, 0, W, H)

      const min  = Math.min(...vals)
      const max  = Math.max(...vals)
      const rng  = max - min || 1
      const padX = 4, padY = 6

      const x = (i) => padX + (i / (vals.length - 1)) * (W - padX * 2)
      const y = (v) => H - padY - ((v - min) / rng) * (H - padY * 2)

      // Gradient fill
      const grad = ctx.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, 'rgba(96,165,250,0.35)')
      grad.addColorStop(1, 'rgba(96,165,250,0.02)')
      ctx.beginPath()
      ctx.moveTo(x(0), y(vals[0]))
      vals.forEach((v, i) => { if (i > 0) ctx.lineTo(x(i), y(v)) })
      ctx.lineTo(x(vals.length - 1), H)
      ctx.lineTo(x(0), H)
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()

      // Line
      ctx.beginPath()
      ctx.moveTo(x(0), y(vals[0]))
      vals.forEach((v, i) => { if (i > 0) ctx.lineTo(x(i), y(v)) })
      ctx.strokeStyle = '#60a5fa'
      ctx.lineWidth   = 2
      ctx.stroke()

      // Latest dot
      const last = vals.length - 1
      ctx.beginPath()
      ctx.arc(x(last), y(vals[last]), 4, 0, Math.PI * 2)
      ctx.fillStyle = '#60a5fa'
      ctx.fill()
    }

    // ── Initial render ────────────────────────────────────────────────────────
    const latest = history.length ? history[history.length - 1] : null
    updateStats(latest)
    drawSparkline(history)
    updateStatus(svc.getStatus())

    if (!latest) {
      const ageEl = container.querySelector('#wc-age')
      if (ageEl) ageEl.textContent = 'Pending'
    }

    // ── Age ticker ────────────────────────────────────────────────────────────
    let lastReading = latest
    const ageTicker = setInterval(() => {
      if (lastReading?.ts) {
        const ageEl = container.querySelector('#wc-age')
        if (ageEl) ageEl.textContent = timeAgo(lastReading.ts)
      }
    }, 30000)

    // ── Live event subscriptions ──────────────────────────────────────────────
    const unsubReading = api.on('weconnect-agent:reading:new', (reading) => {
      lastReading = reading
      history.push(reading)
      if (history.length > 30) history.shift()
      updateStats(reading)
      drawSparkline(history)
    })

    const unsubStatus = api.on('weconnect-agent:status:change', (s) => {
      updateStatus(s)
    })

    // ── Poll button ───────────────────────────────────────────────────────────
    const btn = container.querySelector('#wc-poll-btn')
    if (btn) {
      btn.addEventListener('click', () => {
        btn.disabled = true
        btn.textContent = '…'
        svc.pollNow().finally(() => {
          btn.disabled = false
          btn.textContent = '↻ Poll'
        })
      })
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    container.__cleanup__ = () => {
      clearInterval(ageTicker)
      unsubReading()
      unsubStatus()
    }
  }
})