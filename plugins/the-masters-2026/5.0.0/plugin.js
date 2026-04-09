// @bump: major
api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard for The Masters Tournament 2026",
  height: 520,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },

  render: async function(container, config) {
    const EVENT = '401811941'
    const BASE  = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga'
    const COMP  = `${BASE}/events/${EVENT}/competitions/${EVENT}`
    const max   = config.maxPlayers || 10
    const bg    = '#0a1f0a', card = '#0f2d0f', gold = '#f0c040'
    const green = '#4ade80', red = '#ff6b6b', gray = '#94a3b8'

    const rx = (text, key) => {
      const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`)  )
      return m ? m[1] : null
    }
    const rxNum = (text, key) => {
      const m = text.match(new RegExp(`"${key}"\\s*:\\s*(-?[\\d.]+)`))
      return m ? parseFloat(m[1]) : null
    }

    // Fetch as raw text, return empty string on any error
    const fetchText = async (url) => {
      try {
        const r = await api.fetch(url)
        return await r.text()
      } catch { return '' }
    }

    // Extract ALL competitor IDs from a page using global regex
    const extractIds = (text) => {
      const ids = [], orders = []
      // Match all competitor URLs in the text: /competitors/NNNN?
      const re = /\/competitors\/(\d+)\?/g
      let m
      const seen = new Set()
      while ((m = re.exec(text)) !== null) {
        if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]) }
      }
      // Extract orders: "order":N
      const ro = /"order"\s*:\s*(\d+)/g
      while ((m = ro.exec(text)) !== null) orders.push(parseInt(m[1]))
      return { ids, orders }
    }

    container.innerHTML = `
      <div style="background:${bg};height:100%;display:flex;align-items:center;justify-content:center;color:${gold};font-family:Georgia,serif;font-size:14px;">
        ⛳ Loading Masters leaderboard…
      </div>`

    try {
      // Step 1: Collect player IDs by fetching limit=1 per page for top N players
      const players = []
      for (let page = 1; page <= max; page++) {
        const url  = `${COMP}/competitors?limit=1&page=${page}`
        const text = await fetchText(url)
        if (!text) continue
        const { ids, orders } = extractIds(text)
        if (ids.length > 0) {
          players.push({ id: ids[0], order: orders[0] ?? page })
        }
      }

      if (players.length === 0) throw new Error('No players found')

      // Step 2: For each player fetch score, status, athlete in sequence
      // (sequential to avoid proxy rate limiting)
      const enriched = []
      for (const p of players) {
        const [scoreTxt, statusTxt, athleteTxt] = await Promise.all([
          fetchText(`${COMP}/competitors/${p.id}/score`),
          fetchText(`${COMP}/competitors/${p.id}/status`),
          fetchText(`${BASE}/seasons/2026/athletes/${p.id}`)
        ])

        const scoreVal  = rxNum(scoreTxt,   'value')
        const scoreDisp = rx(scoreTxt,      'displayValue') ?? (scoreVal != null ? (scoreVal > 0 ? `+${scoreVal}` : `${scoreVal}`) : 'E')
        const thru      = rxNum(statusTxt,  'thru')
        const hole      = rxNum(statusTxt,  'hole')
        const state     = rx(statusTxt,     'state')
        const posDisp   = rx(statusTxt,     'displayName') ?? `${p.order}`
        const isTie     = statusTxt.includes('"isTie":true')
        const fullName  = rx(athleteTxt,    'fullName')
                       ?? rx(athleteTxt,    'displayName')
                       ?? `Player ${p.id}`
        const country   = rx(athleteTxt,    'citizenship') ?? ''
        const movement  = rxNum(scoreTxt,   'movement') ?? 0

        enriched.push({
          id: p.id, order: p.order,
          name: fullName, country,
          scoreDisp, scoreVal: scoreVal ?? 0,
          thru: thru ?? hole ?? 0,
          state: state ?? 'pre',
          pos: posDisp, isTie,
          movement
        })
      }

      // Sort by order
      enriched.sort((a, b) => a.order - b.order)

      // Step 3: Render
      const scoreColor = (s) => {
        if (!s || s === 'E') return gray
        if (s.startsWith('-'))  return green
        if (s.startsWith('+'))  return red
        return gray
      }

      const thruStr = (p) => {
        if (p.state === 'post') return 'F'
        if (p.thru === 0)       return '-'
        return `${p.thru}`
      }

      const movStr = (m) => {
        if (m > 0) return `<span style="color:${green}">▲${m}</span>`
        if (m < 0) return `<span style="color:${red}">▼${Math.abs(m)}</span>`
        return `<span style="color:${gray}">–</span>`
      }

      const rows = enriched.map((p, i) => {
        const pos = p.isTie ? `T${p.pos}` : p.pos
        const bg2 = i % 2 === 0 ? card : bg
        return `
          <tr style="background:${bg2}">
            <td style="padding:7px 8px;color:${gold};font-weight:bold;text-align:center">${pos}</td>
            <td style="padding:7px 8px;color:#e2e8f0;font-weight:600">${p.name}</td>
            <td style="padding:7px 4px;color:${gray};font-size:11px;text-align:center">${p.country}</td>
            <td style="padding:7px 8px;color:${scoreColor(p.scoreDisp)};font-weight:bold;text-align:center;font-size:15px">${p.scoreDisp}</td>
            <td style="padding:7px 8px;color:${gray};text-align:center">${thruStr(p)}</td>
            <td style="padding:7px 8px;text-align:center;font-size:12px">${movStr(p.movement)}</td>
          </tr>`
      }).join('')

      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

      container.innerHTML = `
        <div style="background:${bg};height:100%;display:flex;flex-direction:column;font-family:Georgia,serif;overflow:hidden">
          <div style="background:linear-gradient(135deg,#1a3a1a,#2d5a1b);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:20px">⛳</span>
              <div>
                <div style="color:${gold};font-size:14px;font-weight:bold;letter-spacing:1px">THE MASTERS 2026</div>
                <div style="color:#86efac;font-size:10px">Augusta National · Live Leaderboard</div>
              </div>
            </div>
            <div style="color:${gray};font-size:10px">Updated ${now}</div>
          </div>
          <div style="overflow-y:auto;flex:1">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead>
                <tr style="background:#0d260d;position:sticky;top:0">
                  <th style="padding:6px 8px;color:${gold};font-size:11px;font-weight:600;text-align:center">POS</th>
                  <th style="padding:6px 8px;color:${gold};font-size:11px;font-weight:600;text-align:left">PLAYER</th>
                  <th style="padding:6px 4px;color:${gold};font-size:11px;font-weight:600;text-align:center">CTY</th>
                  <th style="padding:6px 8px;color:${gold};font-size:11px;font-weight:600;text-align:center">TOT</th>
                  <th style="padding:6px 8px;color:${gold};font-size:11px;font-weight:600;text-align:center">THRU</th>
                  <th style="padding:6px 8px;color:${gold};font-size:11px;font-weight:600;text-align:center">MOV</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`

      // Step 4: Auto-refresh
      const interval = setInterval(async () => {
        try { await this.render(container, config) } catch {}
      }, (config.refreshSeconds || 60) * 1000)

      container.__cleanup__ = () => clearInterval(interval)

    } catch (err) {
      container.innerHTML = `
        <div style="background:${bg};height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px">
          <div style="color:${red};font-size:14px">⚠️ Failed to load leaderboard</div>
          <div style="color:${gray};font-size:11px">${err.message}</div>
        </div>`
    }
  }
})