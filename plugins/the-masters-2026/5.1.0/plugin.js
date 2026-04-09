api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard from ESPN for the Masters Tournament",
  height: 520,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },

  render: async function(container, config) {
    const BASE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga'
    const EVENT = '401811941'
    const COMP = `${BASE}/events/${EVENT}/competitions/${EVENT}`
    const max = config.maxPlayers || 10
    const rx = (text, key) => { const m = text.match(new RegExp(`"${key}":\\s*"([^"]*?)"`)); return m ? m[1] : null }
    const rxNum = (text, key) => { const m = text.match(new RegExp(`"${key}":\\s*([\\d.-]+)`)); return m ? parseFloat(m[1]) : null }

    const fetchText = async (url) => {
      const r = await api.fetch(url)
      return await r.text()
    }

    const style = `
      <style>
        .masters-wrap { font-family: 'Georgia', serif; background: #1a2a1a; color: #e2e8f0; height: 100%; display: flex; flex-direction: column; border-radius: 8px; overflow: hidden; }
        .masters-header { background: linear-gradient(135deg, #1a3a1a, #2d5a2d); padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #4ade80; }
        .masters-title { font-size: 15px; font-weight: bold; color: #ffd700; letter-spacing: 1px; }
        .masters-subtitle { font-size: 11px; color: #4ade80; }
        .masters-updated { font-size: 10px; color: #94a3b8; }
        .masters-table { flex: 1; overflow-y: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { background: #0f2010; color: #ffd700; padding: 5px 8px; text-align: center; font-size: 10px; letter-spacing: 0.5px; position: sticky; top: 0; z-index: 1; }
        th.left { text-align: left; }
        td { padding: 5px 8px; text-align: center; border-bottom: 1px solid #1e3a1e; }
        td.left { text-align: left; }
        tr:hover { background: #1e3a1e; }
        .pos { color: #94a3b8; font-size: 11px; min-width: 28px; }
        .name { font-weight: bold; color: #e2e8f0; }
        .country { font-size: 10px; color: #94a3b8; }
        .score-under { color: #4ade80; font-weight: bold; }
        .score-over  { color: #ff6b6b; font-weight: bold; }
        .score-even  { color: #e2e8f0; font-weight: bold; }
        .thru { color: #94a3b8; font-size: 11px; }
        .thru-active { color: #60a5fa; font-size: 11px; }
        .move-up   { color: #4ade80; font-size: 10px; }
        .move-down { color: #ff6b6b; font-size: 10px; }
        .move-flat { color: #94a3b8; font-size: 10px; }
        .round-score { font-size: 11px; color: #94a3b8; }
        .loading { display: flex; align-items: center; justify-content: center; height: 100%; color: #94a3b8; font-size: 13px; }
        .error { color: #ff6b6b; padding: 16px; text-align: center; font-size: 12px; }
      </style>
    `

    container.innerHTML = style + '<div class="masters-wrap"><div class="loading">⛳ Loading Masters leaderboard…</div></div>'

    const load = async () => {
      try {
        // Fetch player IDs one at a time (limit=1&page=N) to avoid truncation
        const entries = []
        for (let page = 1; page <= max; page++) {
          const t = await fetchText(`${COMP}/competitors?limit=1&page=${page}`)
          const ids = [...t.matchAll(/"id":"(\d+)"/g)].map(m => m[1])
          const orders = [...t.matchAll(/"order":(\d+)/g)].map(m => parseInt(m[1]))
          const movements = [...t.matchAll(/"movement":([-\d]+)/g)].map(m => parseInt(m[1]))
          if (ids.length === 0) break
          // Use the second id match (first is from $ref, second is the actual "id" field after type)
          // Actually extract the competitor id from the items array directly
          const idMatches = [...t.matchAll(/"id":"(\d+)"/g)]
          const competitorId = idMatches.length >= 2 ? idMatches[1][1] : idMatches[0]?.[1]
          if (!competitorId) break
          entries.push({ id: competitorId, order: orders[0] || page, movement: movements[0] || 0 })
        }

        // Fetch score, status, athlete for each player in parallel batches of 5
        const batchSize = 5
        const players = []
        for (let i = 0; i < entries.length; i += batchSize) {
          const batch = entries.slice(i, i + batchSize)
          const results = await Promise.all(batch.map(async (e) => {
            try {
              const [scoreText, statusText, athleteText] = await Promise.all([
                fetchText(`${COMP}/competitors/${e.id}/score`),
                fetchText(`${COMP}/competitors/${e.id}/status`),
                fetchText(`${BASE}/seasons/2026/athletes/${e.id}`)
              ])

              const scoreDisp = rx(scoreText, 'displayValue') || 'E'
              const scoreVal  = rxNum(scoreText, 'value') || 0
              const thru      = rxNum(statusText, 'thru')
              const hole      = rxNum(statusText, 'hole')
              const state     = rx(statusText, 'state') || 'pre'
              const posDisp   = rx(statusText, 'displayName') || String(e.order)
              const isTie     = statusText.includes('"isTie":true')
              const fullName  = rx(athleteText, 'fullName') || rx(athleteText, 'displayName') || `Player ${e.id}`
              const country   = rx(athleteText, 'citizenship') || ''

              return { id: e.id, order: e.order, movement: e.movement, scoreDisp, scoreVal, thru, hole, state, posDisp, isTie, fullName, country }
            } catch (err) {
              console.warn(`Failed player ${e.id}:`, err)
              return null
            }
          }))
          results.forEach(r => r && players.push(r))
        }

        if (players.length === 0) throw new Error('No player data loaded')

        // Sort by scoreVal ascending (lowest score = best)
        players.sort((a, b) => a.scoreVal - b.scoreVal)

        // Assign positions accounting for ties
        let pos = 1
        for (let i = 0; i < players.length; i++) {
          if (i > 0 && players[i].scoreVal === players[i - 1].scoreVal) {
            players[i].displayPos = players[i - 1].displayPos
            players[i].isTie = true
          } else {
            players[i].displayPos = String(pos)
            players[i].isTie = i < players.length - 1 && players[i + 1]?.scoreVal === players[i].scoreVal
          }
          pos = i + 2
        }

        const scoreClass = (d) => {
          if (d === 'E' || d === '0') return 'score-even'
          if (d.startsWith('-')) return 'score-under'
          return 'score-over'
        }

        const moveHtml = (m) => {
          if (m > 0) return `<span class="move-up">▲${m}</span>`
          if (m < 0) return `<span class="move-down">▼${Math.abs(m)}</span>`
          return `<span class="move-flat">—</span>`
        }

        const thruHtml = (p) => {
          if (p.state === 'pre') return `<span class="thru">${p.hole ? 'Tee' : '-'}</span>`
          if (p.state === 'post') return `<span class="thru">F</span>`
          const t = p.thru != null ? p.thru : (p.hole != null ? `*${p.hole}` : '-')
          return `<span class="thru-active">${t}</span>`
        }

        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        const rows = players.map(p => {
          const pos = p.isTie ? `T${p.displayPos}` : p.displayPos
          return `<tr>
            <td class="pos left">${pos}</td>
            <td class="left"><div class="name">${p.fullName}</div><div class="country">${p.country}</div></td>
            <td class="${scoreClass(p.scoreDisp)}">${p.scoreDisp}</td>
            <td>${thruHtml(p)}</td>
            <td>${moveHtml(p.movement)}</td>
          </tr>`
        }).join('')

        container.innerHTML = style + `
          <div class="masters-wrap">
            <div class="masters-header">
              <div>
                <div class="masters-title">⛳ THE MASTERS 2026</div>
                <div class="masters-subtitle">Augusta National • Live Leaderboard</div>
              </div>
              <div class="masters-updated">Updated ${now}</div>
            </div>
            <div class="masters-table">
              <table>
                <thead><tr>
                  <th class="left">POS</th>
                  <th class="left">PLAYER</th>
                  <th>SCORE</th>
                  <th>THRU</th>
                  <th>MOV</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>`
      } catch (err) {
        console.error(err)
        container.innerHTML = style + `<div class="masters-wrap"><div class="error">⚠️ Failed to load leaderboard<br><small>${err.message}</small></div></div>`
      }
    }

    await load()
    const interval = setInterval(load, (config.refreshSeconds || 60) * 1000)
    container.__cleanup__ = () => clearInterval(interval)
  }
})