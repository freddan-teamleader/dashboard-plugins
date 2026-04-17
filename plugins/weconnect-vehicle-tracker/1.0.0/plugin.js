// @bump: patch
api.registerWidget({
  type: 'weconnect-vehicle-tracker',
  title: 'WeConnect Vehicle Tracker',
  description: 'Live odometer, battery/fuel level, and historical sparkline from WeConnect',
  height: 300,
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30
  },
  hiddenConfig: { lastReading: null },

  render(container, config) {
    // ── styles ────────────────────────────────────────────────────────────────
    container.innerHTML = `
      <style>
        .wc-wrap {
          font-family: system-ui, sans-serif;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px;
          height: 100%;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .wc-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .wc-title {
          color: var(--text-primary);
          font-size: 14px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .wc-vin {
          color: var(--text-muted);
          font-size: 11px;
          font-family: monospace;
        }
        .wc-poll-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          color: var(--text-secondary);
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 12px;
          cursor: pointer;
          transition: background .15s;
        }
        .wc-poll-btn:hover { background: var(--bg-hover); }
        .wc-stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .wc-stat {
          background: var(--bg-tertiary);
          border-radius: 8px;
          padding: 10px 14px;
        }
        .wc-stat-label {
          color: var(--text-muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: .05em;
          margin-bottom: 4px;
        }
        .wc-stat-value {
          color: var(--text-primary);
          font-size: 24px;
          font-weight: 700;
          line-height: 1;
        }
        .wc-stat-unit {
          color: var(--text-secondary);
          font-size: 12px;
          margin-left: 3px;
        }
        .wc-spark-wrap {
          flex: 1;
          min-height: 0;
          position: relative;
        }
        .wc-spark-label {
          color: var(--text-muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: .05em;
          margin-bottom: 4px;
        }
        .wc-spark-svg { width: 100%; height: 60px; display: block; }
        .wc-footer {
          color: var(--text-muted);
          font-size: 11px;
          text-align: right;
        }
        .wc-notice {
          color: var(--accent-orange);
          font-size: 12px;
          text-align: center;
          padding: 20px;
        }
        .wc-err {
          color: var(--accent-red);
          font-size: 12px;
          padding: 8px;
          background: var(--bg-tertiary);
          border-radius: 6px;
        }
      </style>
      <div class="wc-wrap" id="wc-root">
        <div class="wc-notice">⏳ Loading vehicle data…</div>
      </div>
    `

    const root = container.querySelector('#wc-root')

    // ── sparkline renderer ────────────────────────────────────────────────────
    function sparkline(rows, key, color) {
      const vals = rows.map(r => Number(r[key])).filter(v => !isNaN(v))
      if (vals.length < 2) return '<svg class="wc-spark-svg"></svg>'
      const min = Math.min(...vals), max = Math.max(...vals)
      const range = max - min || 1
      const W = 400, H = 60, pad = 4
      const pts = vals.map((v, i) => {
        const x = pad + (i / (vals.length - 1)) * (W - pad * 2)
        const y = H - pad - ((v - min) / range) * (H - pad * 2)
        return `${x},${y}`
      })
      return `
        <svg class="wc-spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
          <polyline points="${pts.join(' ')}" fill="none"
            stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="${pts[pts.length - 1].split(',')[0]}"
                  cy="${pts[pts.length - 1].split(',')[1]}"
                  r="3" fill="${color}"/>
        </svg>`
    }

    // ── UI render ─────────────────────────────────────────────────────────────
    function renderUI(reading, history) {
      if (!config.email || !config.password) {
        root.innerHTML = `<div class="wc-notice">⚙️ Enter your WeConnect credentials in Settings to get started.</div>`
        return
      }

      const odometer  = reading?.odometer  != null ? Number(reading.odometer).toLocaleString() : '—'
      const level     = reading?.level     != null ? Math.round(reading.level) : '—'
      const levelType = reading?.level_type || reading?.levelType || 'soc'
      const levelLabel = levelType === 'fuel' ? '⛽ Fuel' : '🔋 Battery'
      const levelColor = level !== '—'
        ? (level > 50 ? 'var(--accent-green)' : level > 20 ? 'var(--accent-orange)' : 'var(--accent-red)')
        : 'var(--text-primary)'
      const vin    = reading?.vin || config.vin || '—'
      const tsText = reading?.ts || reading?.recorded_at
        ? (() => {
            const d   = new Date(reading.ts || reading.recorded_at)
            const ago = Math.round((Date.now() - d) / 60000)
            return ago < 2 ? 'just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago/60)}h ago`
          })()
        : 'no data yet'

      const odomSpark  = sparkline(history, 'odometer', 'var(--accent-blue)')
      const levelSpark = sparkline(history, 'level', 'var(--accent-green)')

      root.innerHTML = `
        <div class="wc-header">
          <div>
            <div class="wc-title">🚗 WeConnect</div>
            <div class="wc-vin">${vin}</div>
          </div>
          <button class="wc-poll-btn" id="wc-poll-btn">↻ Poll now</button>
        </div>
        <div class="wc-stats">
          <div class="wc-stat">
            <div class="wc-stat-label">Odometer</div>
            <div class="wc-stat-value">${odometer}<span class="wc-stat-unit">km</span></div>
          </div>
          <div class="wc-stat">
            <div class="wc-stat-label">${levelLabel}</div>
            <div class="wc-stat-value" style="color:${levelColor}">${level}<span class="wc-stat-unit">%</span></div>
          </div>
        </div>
        <div class="wc-spark-wrap">
          <div class="wc-spark-label">Odometer trend (last ${history.length} readings)</div>
          ${odomSpark}
        </div>
        <div class="wc-spark-wrap">
          <div class="wc-spark-label">Level trend</div>
          ${levelSpark}
        </div>
        <div class="wc-footer">Last updated: ${tsText}</div>
      `

      root.querySelector('#wc-poll-btn').addEventListener('click', async () => {
        const btn = root.querySelector('#wc-poll-btn')
        btn.disabled = true
        btn.textContent = '…'
        try {
          const svc = await api.getService('weconnect-agent')
          if (svc) await svc.poll()
          else root.insertAdjacentHTML('beforeend', `<div class="wc-err">Agent not installed — install Step 1 first.</div>`)
        } finally {
          btn.disabled = false
          btn.textContent = '↻ Poll now'
        }
      })
    }

    // ── load history + latest reading from db ─────────────────────────────────
    async function loadFromDb() {
      try {
        const vin = config.vin || null
        const filter = vin ? { vin } : {}
        const rows = await api.db.query(filter, { orderBy: 'recorded_at', ascending: true, limit: 30 })
        const latest = rows.length ? rows[rows.length - 1] : config.lastReading
        renderUI(latest, rows)
      } catch (err) {
        if (config.lastReading) {
          renderUI(config.lastReading, [config.lastReading])
        } else {
          root.innerHTML = `<div class="wc-err">DB unavailable: ${err.message}</div>`
        }
      }
    }

    // ── live event subscription ───────────────────────────────────────────────
    loadFromDb()

    const unsub = api.on('weconnect-agent:reading:new', async (reading) => {
      api.updateConfig({ lastReading: reading })
      await loadFromDb()
    })

    const unsubErr = api.on('weconnect-agent:auth:error', ({ message }) => {
      const errDiv = root.querySelector('.wc-err')
      const msg = `<div class="wc-err">⚠️ Agent error: ${message}</div>`
      if (errDiv) errDiv.outerHTML = msg
      else root.insertAdjacentHTML('beforeend', msg)
    })

    container.__cleanup__ = () => { unsub(); unsubErr() }
  }
})