// @bump: patch
api.registerWidget({
  type: "espn-golf-probe",
  title: "ESPN Golf API Probe",
  height: 500,
  defaultConfig: {},
  render: async function(container, config) {
    const log = (msg) => {
      const p = document.createElement('pre')
      p.style.cssText = 'color:#e2e8f0;font-size:11px;margin:4px 0;white-space:pre-wrap;word-break:break-all;'
      p.textContent = msg
      container.appendChild(p)
    }

    container.innerHTML = '<div style="background:#0f172a;padding:12px;height:100%;overflow-y:auto;font-family:monospace;box-sizing:border-box;"></div>'
    const box = container.firstChild

    const addLog = (msg) => {
      const p = document.createElement('pre')
      p.style.cssText = 'color:#e2e8f0;font-size:11px;margin:4px 0;white-space:pre-wrap;word-break:break-all;'
      p.textContent = msg
      box.appendChild(p)
    }

    const fetchJson = async (url) => {
      const res = await api.fetch(url)
      return res.json()
    }

    try {
      // Probe 1: Check competition leaders key
      addLog('Step 1 — Fetching competition to inspect leaders...')
      const comp = await fetchJson('http://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941?lang=en&region=us')
      
      addLog(`leaders type: ${typeof comp.leaders}`)
      addLog(`leaders sample: ${JSON.stringify(comp.leaders).substring(0, 300)}`)

      // Probe 2: Try fetching a few competitors with ?limit param
      addLog('\nStep 2 — Try competitors with inline expand...')
      const compExpand = await fetchJson('http://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941/competitors?limit=3&lang=en&region=us')
      addLog(`Keys: ${Object.keys(compExpand).join(', ')}`)
      addLog(`Sample: ${JSON.stringify(compExpand).substring(0, 500)}`)

      // Probe 3: Fetch one athlete + one score + one status in parallel
      addLog('\nStep 3 — Fetching athlete, score, status for competitor 9938...')
      const [athlete, score, status, linescores] = await Promise.all([
        fetchJson('http://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2026/athletes/9938?lang=en&region=us'),
        fetchJson('http://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941/competitors/9938/score?lang=en&region=us'),
        fetchJson('http://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941/competitors/9938/status?lang=en&region=us'),
        fetchJson('http://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941/competitors/9938/linescores?lang=en&region=us'),
      ])

      addLog(`Athlete keys: ${Object.keys(athlete).join(', ')}`)
      addLog(`Athlete name: ${athlete.displayName || athlete.fullName || athlete.shortName}`)
      addLog(`Score keys: ${Object.keys(score).join(', ')}`)
      addLog(`Score sample: ${JSON.stringify(score).substring(0, 300)}`)
      addLog(`Status keys: ${Object.keys(status).join(', ')}`)
      addLog(`Status sample: ${JSON.stringify(status).substring(0, 300)}`)
      addLog(`Linescores keys: ${Object.keys(linescores).join(', ')}`)
      addLog(`Linescores sample: ${JSON.stringify(linescores).substring(0, 400)}`)

    } catch(e) {
      addLog(`❌ ERROR: ${e.message}`)
    }
  }
})