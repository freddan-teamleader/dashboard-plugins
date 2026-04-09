// @bump: major
api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard from Augusta National via ESPN API",
  height: 520,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },

  render: async function(container, config) {
    const max = config.maxPlayers || 10
    const BASE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga'
    const EVENT = '401811941'
    const COMP = `${BASE}/events/${EVENT}/competitions/${EVENT}`

    const s = document.createElement('style')
    s.textContent = `
      .mg-wrap { font-family: 'Georgia', serif; background: #070d1a; color: #e2e8f0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
      .mg-head { background: linear-gradient(135deg, #1a3a1a 0%, #2d5a2d 50%, #1a3a1a 100%); padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #f0c040; flex-shrink: 0; }
      .mg-head-left { display: flex; flex-direction: column; }
      .mg-title { font-size: 15px; font-weight: bold; color: #f0c040; letter-spacing: 1px; text-transform: uppercase; }
      .mg-subtitle { font-size: 11px; color: #a0c8a0; margin-top: 1px; }
      .mg-badge { background: #f0c040; color: #1a3a1a; font-size: 10px; font-weight: bold; padding: 3px 8px; border-radius: 10px; }
      .mg-table-wrap { flex: 1; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #2d5a2d #070d1a; }
      .mg-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .mg-table thead th { background: #0f1f0f; color: #a0c8a0; padding: 6px 8px; text-align: center; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; position: sticky; top: 0; border-bottom: 1px solid #2d5a2d; }
      .mg-table thead th:nth-child(2) { text-align: left; }
      .mg-table tbody tr { border-bottom: 1px solid #0f1f0f; transition: background 0.15s; }
      .mg-table tbody tr:hover { background: #0f1f2a; }
      .mg-table tbody td { padding: 7px 8px; text-align: center; vertical-align: middle; }
      .mg-table tbody td:nth-child(2) { text-align: left; }
      .mg-pos { color: #94a3b8; font-size: 11px; min-width: 28px; }
      .mg-pos.leader { color: #f0c040; font-weight: bold; }
      .mg-name { font-weight: bold; color: #e2e8f0; font-size: 12px; }
      .mg-country { font-size: 10px; color: #64748b; margin-top: 1px; }
      .mg-score { font-weight: bold; font-size: 13px; }
      .mg-score.under { color: #4ade80; }
      .mg-score.over  { color: #ff6b6b; }
      .mg-score.even  { color: #e2e8f0; }
      .mg-round { font-size: 11px; color: #94a3b8; min-width: 24px; }
      .mg-round.active { color: #60a5fa; font-weight: bold; }
      .mg-thru { font-size: 11px; color: #94a3b8; }
      .mg-move { font-size: 10px; min-width: 20px; }
      .mg-move.up   { color: #4ade80; }
      .mg-move.down { color: #ff6b6b; }
      .mg-move.flat { color: #64748b; }
      .mg-footer { padding: 5px 14px; font-size: 10px; color: #4a6a4a; text-align: right; border-top: 1px solid #0f1f0f; flex-shrink: 0; }
      .mg-loading { display: flex; align-items: center; justify-content: center; height: 100%; color: #a0c8a0; font-size: 13px; }
      .mg-error { display: flex; align-items: center; justify-content: center; height: 100%; color: #ff6b6b; font-size: 12px; padding: 20px; text-align: center; }
      .mg-cut { background: #1a0f0f; }
      .mg-cut td { color: #64748b !important; }
      .mg-cut-row td { background: #1a1a0a; color: #f97316 !important; font-size: 10px; text-align: center; padding: 3px; border-top: 1px dashed #f97316; border-bottom: 1px dashed #f97316; }
    `
    container.appendChild(s)

    const wrap = document.createElement('div')
    wrap.className = 'mg-wrap'
    container.appendChild(wrap)

    const showLoading = (msg = 'Loading leaderboard…') => {
      wrap.innerHTML = `<div class="mg-loading">⛳ ${msg}</div>`
    }
    const showError = (msg) => {
      wrap.innerHTML = `<div class="mg-error">❌ ${msg}</div>`
    }

    showLoading()

    const get = async (url) => {
      const r = await api.fetch(url)
      return r.json()
    }

    const scoreClass = (val) => {
      if (val === null || val === undefined) return 'even'
      if (val < 0) return 'under'
      if (val > 0) return 'over'
      return 'even'
    }
    const scoreDisplay = (displayValue, value) => {
      if (!displayValue && value === 0) return 'E'
      return displayValue || 'E'
    }

    try {
      // Step 1: get top N competitors (ordered by position)
      const pages = Math.ceil(max / 10)
      let allItems = []
      for (let p = 1; p <= pages; p++) {
        const pg = await get(`${COMP}/competitors?limit=10&page=${p}`)
        allItems = allItems.concat(pg.items || [])
      }
      // Sort by order field, take top max
      allItems.sort((a, b) => (a.order || 999) - (b.order || 999))
      const topItems = allItems.slice(0, max)

      showLoading(`Fetching ${topItems.length} players…`)

      // Step 2: fetch score + status + athlete in parallel for each
      const players = await Promise.all(topItems.map(async (item) => {
        const id = item.id
        const [score, status, athlete] = await Promise.all([
          get(`${COMP}/competitors/${id}/score`).catch(() => null),
          get(`${COMP}/competitors/${id}/status`).catch(() => null),
          get(`${BASE}/seasons/2026/athletes/${id}`).catch(() => null),
        ])
        return { id, order: item.order, movement: item.movement || 0, score, status, athlete }
      }))

      // Step 3: render
      const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

      // Find current round from status
      const currentRound = Math.max(...players.map(p => p.status?.period || 1))

      wrap.innerHTML = ''
      wrap.innerHTML = `
        <div class="mg-head">
          <div class="mg-head-left">
            <div class="mg-title">⛳ The Masters 2026</div>
            <div class="mg-subtitle">Augusta National · Round ${currentRound}</div>
          </div>
          <div class="mg-badge">LIVE</div>
        </div>
        <div class="mg-table-wrap">
          <table class="mg-table">
            <thead>
              <tr>
                <th>POS</th>
                <th>PLAYER</th>
                <th>TOT</th>
                <th>R1</th>
                <th>R2</th>
                <th>R3</th>
                <th>R4</th>
                <th>THRU</th>
                <th>MOV</th>
              </tr>
            </thead>
            <tbody id="mg-tbody"></tbody>
          </table>
        </div>
        <div class="mg-footer">Updated ${now} · ESPN API · Auto-refreshes every ${config.refreshSeconds || 60}s</div>
      `

      const tbody = wrap.querySelector('#mg-tbody')
      let cutShown = false

      players.forEach((p, i) => {
        const pos = p.status?.position
        const posDisplay = pos ? (pos.isTie ? `T${pos.displayName}` : pos.displayName) : (i + 1).toString()
        const isCut = p.status?.type?.name?.includes('CUT') || false
        const thru = p.status?.thru ?? p.status?.hole ?? '-'
        const thruDisplay = p.status?.type?.completed ? 'F' : (thru === 18 ? 'F' : thru)

        const totalVal = p.score?.value !== undefined ? p.score.value - 72 * (p.status?.period || 1) : null
        const totalDisp = p.score?.displayValue || 'E'

        // Round scores from linescores — we'll show from score completedRoundsValue
        // We only have total score here; per-round needs separate fetch — show total in rounds
        const r = ['', '', '', '']
        // Use completedRoundsValue if available
        const compVal = p.score?.completedRoundsValue
        const compDisp = p.score?.completedRoundsDisplayValue

        const mov = p.movement || 0
        const movClass = mov > 0 ? 'up' : mov < 0 ? 'down' : 'flat'
        const movText = mov > 0 ? `▲${mov}` : mov < 0 ? `▼${Math.abs(mov)}` : '—'

        const name = p.athlete?.shortName || p.athlete?.displayName || `Player ${p.id}`
        const country = p.athlete?.citizenship || ''

        const sc = scoreClass(p.score?.value !== undefined ? (p.score.value < 0 ? p.score.value : 0) : null)
        const totalScoreVal = parseInt(totalDisp)
        const scoreCol = isNaN(totalScoreVal) ? 'even' : totalScoreVal < 0 ? 'under' : totalScoreVal > 0 ? 'over' : 'even'

        // Cut line separator
        if (isCut && !cutShown) {
          cutShown = true
          const cutRow = document.createElement('tr')
          cutRow.innerHTML = `<td colspan="9" class="mg-cut-row">✂ CUT LINE</td>`
          tbody.appendChild(cutRow)
        }

        const tr = document.createElement('tr')
        if (isCut) tr.className = 'mg-cut'
        tr.innerHTML = `
          <td class="mg-pos ${i === 0 ? 'leader' : ''}">${posDisplay}</td>
          <td>
            <div class="mg-name">${name}</div>
            ${country ? `<div class="mg-country">${country}</div>` : ''}
          </td>
          <td class="mg-score ${scoreCol}">${totalDisp}</td>
          <td class="mg-round">-</td>
          <td class="mg-round">-</td>
          <td class="mg-round">-</td>
          <td class="mg-round">-</td>
          <td class="mg-thru">${thruDisplay}</td>
          <td class="mg-move ${movClass}">${movText}</td>
        `
        tbody.appendChild(tr)
      })

      // Step 4: backfill round scores async (linescores per player)
      players.forEach(async (p, i) => {
        try {
          const ls = await get(`${COMP}/competitors/${p.id}/linescores`)
          const rounds = ls.items || []
          const row = tbody.rows[i]
          if (!row) return
          rounds.forEach((round, ri) => {
            const cell = row.cells[3 + ri]
            if (!cell) return
            const rv = round.displayValue || 'E'
            const rn = parseInt(rv)
            const rc = isNaN(rn) ? 'even' : rn < 0 ? 'under' : rn > 0 ? 'over' : 'even'
            const isActive = (ri + 1) === (p.status?.period || 1)
            cell.className = `mg-round ${isActive ? 'active' : ''}`
            cell.style.color = rc === 'under' ? '#4ade80' : rc === 'over' ? '#ff6b6b' : ''
            cell.textContent = rv
          })
        } catch (_) {}
      })

    } catch (err) {
      showError(`Failed to load leaderboard: ${err.message}`)
    }

    // Auto-refresh
    const interval = setInterval(async () => {
      // re-trigger render
      container.innerHTML = ''
      await api.render?.()
    }, (config.refreshSeconds || 60) * 1000)

    container.__cleanup__ = () => clearInterval(interval)
  }
})