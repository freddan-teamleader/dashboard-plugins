// @bump: patch
api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard from Augusta National",
  height: 500,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },
  hiddenConfig: { cachedRoster: null },

  render: async function(container, config) {
    const max = Math.min(config.maxPlayers || 10, 20)
    const BASE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941'

    const fetchText = async (url) => { const r = await api.fetch(url); return r.text() }
    const rx    = (t, k) => { const m = t.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*?)"`)); return m ? m[1] : null }
    const rxNum = (t, k) => { const m = t.match(new RegExp(`"${k}"\\s*:\\s*(-?[\\d.]+)`)); return m ? parseFloat(m[1]) : null }
    const sleep = ms => new Promise(r => setTimeout(r, ms))

    console.log('=== RENDER CALLED ===')
    console.log('cachedRoster:', config.cachedRoster?.length ?? 'null')

    let players = null

    if (config.cachedRoster?.length) {
      console.log('✅ Restoring from cache — skipping Phase 1')
      players = config.cachedRoster.map(p => ({ ...p, totVal: 0, totDisp: 'E', thruDisp: '-', mov: 0 }))
    } else {
      console.log('❌ No cache — will run Phase 1')
    }

    const loadRoster = async () => {
      console.log('📋 Phase 1: loading roster...')
      const players = []
      for (let page = 1; page <= max; page++) {
        const t = await fetchText(`${BASE}/competitors?limit=1&page=${page}&lang=en&region=us`)
        const id = rx(t, 'id')
        if (!id || id === '401811941') continue
        const order = rxNum(t, 'order') ?? page
        console.log(`  Page ${page}: id=${id} order=${order}`)
        players.push({ id, order })
        await sleep(100)
      }
      for (const p of players) {
        const t = await fetchText(`https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2026/athletes/${p.id}?lang=en&region=us`)
        p.name    = rx(t, 'fullName') || rx(t, 'displayName') || `Player ${p.id}`
        p.country = rx(t, 'citizenship') || ''
        await sleep(100)
      }
      console.log(`📋 Phase 1 done: ${players.length} players`)
      return players
    }

    const loadScores = async (players) => {
      console.log(`📊 Phase 2: loading scores for ${players.length} players...`)
      let reqCount = 0
      for (const p of players) {
        try {
          const scoreTxt = await fetchText(`${BASE}/competitors/${p.id}/score?lang=en&region=us`)
          reqCount++
          p.totDisp = rx(scoreTxt, 'completedRoundsDisplayValue') || rx(scoreTxt, 'displayValue') || 'E'
          p.totVal  = rxNum(scoreTxt, 'completedRoundsValue') ?? rxNum(scoreTxt, 'value') ?? 0
          await sleep(100)

          const statusTxt = await fetchText(`${BASE}/competitors/${p.id}/status?lang=en&region=us`)
          reqCount++
          const thru  = rxNum(statusTxt, 'thru')
          const hole  = rxNum(statusTxt, 'hole')
          const state = rx(statusTxt, 'name') || ''
          const done  = state.includes('COMPLETE') || state.includes('completed') || rx(statusTxt, 'completed') === 'true'
          p.thruDisp  = done ? 'F' : thru != null ? `${thru}` : hole != null ? `*${hole}` : '-'
          await sleep(100)
        } catch(e) {
          console.warn(`Failed player ${p.id}:`, e)
        }
      }
      console.log(`📊 Phase 2 done: ${reqCount} requests made`)
    }

    // ... rest of widget
  }
})