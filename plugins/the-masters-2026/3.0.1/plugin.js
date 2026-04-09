// @bump: patch
api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard from ESPN for the Masters Tournament",
  height: 520,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },
  hiddenConfig: { cachedPlayers: null, cachedAt: null },

  render: async function(container, config) {
    const BASE = 'http://sports.core.api.espn.com/v2/sports/golf/leagues/pga'
    const EVENT = '401811941'
    const COMP = `${BASE}/events/${EVENT}/competitions/${EVENT}`

    const green = '#4ade80', red = '#ff6b6b', gold = '#f5c842'
    const bg1 = '#070d1a', bg2 = '#0f172a', bg3 = '#1e293b'
    const textPri = '#e2e8f0', textSec = '#94a3b8'

    container.innerHTML = `
      <style>
        .masters-wrap { font-family: Georgia, serif; background: ${bg1}; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
        .masters-header { background: linear-gradient(135deg, #1a3a1a, #2d5a1b); padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .masters-title { color: ${gold}; font-size: 15px; font-weight: bold; letter-spacing: 1px; }
        .masters-status { color: ${textSec}; font-size: 11px; }
        .masters-table { flex: 1; overflow-y: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { background: ${bg3}; color: ${textSec}; padding: 5px 6px; text-align: center; position: sticky; top: 0; font-weight: normal; font-family: sans-serif; font-size: 11px; }
        th.left { text-align: left; }
        td { padding: 5px 6px; border-bottom: 1px solid #1e293b; color: ${textPri}; text-align: center; }
        td.left { text-align: left; }
        tr:hover { background: ${bg3}; }
        .pos { color: ${textSec}; width: 28px; }
        .name { font-weight: bold; }
        .score-under { color: ${green}; font-weight: bold; }
        .score-over { color: ${red}; font-weight: bold; }
        .score-even { color: ${textPri}; }
        .move-up { color: ${green}; font-size: 10px; }
        .move-dn { color: ${red}; font-size: 10px; }
        .move-flat { color: ${textSec}; font-size: 10px; }
        .round-score { font-family: monospace; font-size: 11px; color: ${textSec}; }
        .loading { color: ${textSec}; text-align: center; padding: 40px; font-family: sans-serif; }
        .error { color: ${red}; text-align: center; padding: 20px; font-family: sans-serif; font-size: 12px; }
        .eagle { color: #e879f9; }
        .birdie { color: ${green}; }
        .bogey { color: ${red}; }
        .dbl { color: #f97316; }
      </style>
      <div class="masters-wrap">
        <div class="masters-header">
          <span class="masters-title">⛳ The Masters 2026</span>
          <span class="masters-status" id="ms-status">Loading…</span>
        </div>
        <div class="masters-table" id="ms-table">
          <div class="loading">Fetching leaderboard…</div>
        </div>
      </div>`

    let refreshTimer = null

    const fetchJSON = async url => {
      const r = await api.fetch(url)
      return r.json()
    }

    const fetchText = async url => {
      const r = await api.fetch(url)
      return r.text()
    }

    const extractRegex = (text, key) => {
      const m = text.match(new RegExp(`"${key}":"([^"]*)"`) )
      return m ? m[1] : null
    }

    const scoreClass = val => {
      if (val === null || val === undefined) return 'score-even'
      if (val < 0) return 'score-under'
      if (val > 0) return 'score-over'
      return 'score-even'
    }

    const formatScore = val => {
      if (val === null || val === undefined || val === 0) return 'E'
      return val > 0 ? `+${val}` : `${val}`
    }

    const moveArrow = m => {
      if (!m || m === 0) return `<span class="move-flat">—</span>`
      if (m > 0) return `<span class="move-up">▲${m}</span>`
      return `<span class="move-dn">▼${Math.abs(m)}</span>`
    }

    const roundScoreClass = stype => {
      if (!stype) return ''
      const n = stype.toUpperCase()
      if (n === 'EAGLE' || n === 'DOUBLE_EAGLE') return 'eagle'
      if (n === 'BIRDIE') return 'birdie'
      if (n === 'BOGEY') return 'bogey'
      if (n === 'DOUBLE_BOGEY' || n === 'TRIPLE_BOGEY') return 'dbl'
      return ''
    }

    const load = async () => {
      try {
        const maxP = config.maxPlayers || 10

        // Fetch competitors in small batches of 3 to avoid truncation
        let players = []
        let page = 1
        while (players.length < maxP) {
          const url = `${COMP}/competitors?limit=3&page=${page}`
          const data = await fetchJSON(url)
          if (!data.items || data.items.length === 0) break
          for (const item of data.items) {
            if (players.length >= maxP) break
            players.push({ id: item.id, order: item.order, movement: item.movement || 0 })
          }
          if (page >= data.pageCount) break
          page++
        }

        // Sort by order (position)
        players.sort((a, b) => a.order - b.order)

        // Fetch score + status + athlete name in parallel for each player
        await Promise.all(players.map(async p => {
          try {
            const [scoreData, statusData, athleteText] = await Promise.all([
              fetchJSON(`${COMP}/competitors/${p.id}/score`),
              fetchJSON(`${COMP}/competitors/${p.id}/status`),
              fetchText(`${BASE}/seasons/2026/athletes/${p.id}`)
            ])
            p.score = scoreData.value ?? null
            p.scoreDisplay = scoreData.displayValue ?? 'E'
            p.thru = statusData.thru ?? 0
            p.hole = statusData.hole ?? 0
            p.state = statusData.type?.state ?? ''
            p.completed = statusData.type?.completed ?? false
            p.position = statusData.position?.displayName ?? String(p.order)
            p.isTie = statusData.position?.isTie ?? false
            p.period = statusData.period ?? 1
            p.name = extractRegex(athleteText, 'shortName') || extractRegex(athleteText, 'fullName') || `Player ${p.id}`
            p.country = extractRegex(athleteText, 'abbreviation') || ''
          } catch (e) {
            p.name = p.name || `Player ${p.id}`
          }
        }))

        renderTable(players)

        // Load linescores async (non-blocking)
        players.forEach(async p => {
          try {
            const ls = await fetchJSON(`${COMP}/competitors/${p.id}/linescores`)
            if (ls.items) {
              p.rounds = ls.items.map(r => ({
                display: r.displayValue,
                value: r.value,
                period: r.period,
                scoreType: r.linescores?.[0]?.scoreType?.name ?? ''
              }))
              updatePlayerRow(p)
            }
          } catch (_) {}
        })

      } catch (e) {
        document.getElementById('ms-table').innerHTML = `<div class="error">⚠️ Failed to load leaderboard<br><small>${e.message}</small></div>`
      }
    }

    const renderTable = players => {
      const statusEl = document.getElementById('ms-status')
      const tableEl = document.getElementById('ms-table')
      if (!statusEl || !tableEl) return

      statusEl.textContent = `Updated ${new Date().toLocaleTimeString()}`

      let rows = players.map(p => {
        const pos = p.isTie ? `T${p.position}` : p.position
        const thruStr = p.completed ? 'F' : p.state === 'pre' ? '-' : `${p.thru}`
        const sc = scoreClass(p.score)
        return `<tr id="row-${p.id}">
          <td class="pos left">${pos}</td>
          <td class="left name">${p.name}</td>
          <td class="${sc}">${formatScore(p.score)}</td>
          <td class="round-score" id="r1-${p.id}">—</td>
          <td class="round-score" id="r2-${p.id}">—</td>
          <td class="round-score" id="r3-${p.id}">—</td>
          <td class="round-score" id="r4-${p.id}">—</td>
          <td>${thruStr}</td>
          <td>${moveArrow(p.movement)}</td>
        </tr>`
      }).join('')

      tableEl.innerHTML = `
        <table>
          <thead>
            <tr>
              <th class="left">Pos</th>
              <th class="left">Player</th>
              <th>Tot</th>
              <th>R1</th><th>R2</th><th>R3</th><th>R4</th>
              <th>Thru</th>
              <th>Mv</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`
    }

    const updatePlayerRow = p => {
      if (!p.rounds) return
      p.rounds.forEach(r => {
        const cell = document.getElementById(`r${r.period}-${p.id}`)
        if (cell) {
          const cls = roundScoreClass(r.scoreType)
          cell.innerHTML = `<span class="${cls}">${r.display}</span>`
        }
      })
    }

    await load()

    const interval = (config.refreshSeconds || 60) * 1000
    refreshTimer = setInterval(load, interval)

    container.__cleanup__ = () => {
      if (refreshTimer) clearInterval(refreshTimer)
    }
  }
})