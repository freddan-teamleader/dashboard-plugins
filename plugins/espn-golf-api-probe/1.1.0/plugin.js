api.registerWidget({
  type: "espn-golf-probe",
  title: "ESPN Golf API Probe",
  description: "Probes ESPN Golf API endpoints to validate data availability",
  height: 420,
  defaultConfig: {},
  render: async function(container, config) {
    const s = {
      wrap: 'font-family:monospace;font-size:12px;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;height:100%;overflow-y:auto;box-sizing:border-box;',
      ok: 'color:#4ade80', warn: 'color:#f97316', err: 'color:#ff6b6b', dim: 'color:#94a3b8', bold: 'color:#60a5fa;font-weight:bold'
    }
    container.innerHTML = `<div id="log" style="${s.wrap}"><span style="${s.bold}">🔍 ESPN Deep Probe v2</span>\n\n</div>`
    const log = container.querySelector('#log')

    const append = (msg) => { log.innerHTML += msg + '\n'; log.scrollTop = log.scrollHeight }

    const fetchJSON = async (url) => {
      const res = await api.fetch(url)
      const text = await res.text()
      return JSON.parse(text)
    }

    try {
      // Step 1: get event list
      append(`<span style="${s.dim}">Step 1 — Fetching event list...</span>`)
      const eventsData = await fetchJSON('https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events?limit=5')
      append(`<span style="${s.ok}">✅ Events found: ${eventsData.count}</span>`)

      if (!eventsData.items?.length) { append(`<span style="${s.err}">No items in response</span>`); return }

      // Step 2: follow first event link
      const eventUrl = eventsData.items[0].$ref
      append(`\n<span style="${s.dim}">Step 2 — Following event: ${eventUrl}</span>`)
      const event = await fetchJSON(eventUrl)
      append(`<span style="${s.ok}">✅ Event name: ${event.name || event.shortName || '(no name)'}</span>`)
      append(`<span style="${s.dim}">   Status: ${event.status?.type?.description || '?'} | Date: ${event.date || '?'}</span>`)
      append(`<span style="${s.dim}">   Keys: ${Object.keys(event).join(', ')}</span>`)

      // Step 3: look for competitions/leaderboard
      append(`\n<span style="${s.dim}">Step 3 — Looking for competitions...</span>`)
      const compUrl = event.competitions?.$ref || event.leaderboard?.$ref
      if (compUrl) {
        append(`<span style="${s.dim}">   Following: ${compUrl}</span>`)
        const comp = await fetchJSON(compUrl)
        append(`<span style="${s.ok}">✅ Competitions keys: ${Object.keys(comp).join(', ')}</span>`)

        const firstComp = comp.items?.[0]?.$ref
        if (firstComp) {
          append(`\n<span style="${s.dim}">Step 4 — Following competition: ${firstComp}</span>`)
          const detail = await fetchJSON(firstComp)
          append(`<span style="${s.ok}">✅ Detail keys: ${Object.keys(detail).join(', ')}</span>`)
          const lbRef = detail.leaderboard?.$ref || detail.competitors?.$ref
          if (lbRef) {
            append(`\n<span style="${s.dim}">Step 5 — Fetching leaderboard: ${lbRef}</span>`)
            const lb = await fetchJSON(lbRef)
            append(`<span style="${s.ok}">✅ Leaderboard keys: ${Object.keys(lb).join(', ')}</span>`)
            const first = lb.items?.[0]
            if (first) {
              append(`\n<span style="${s.bold}">🏆 First competitor sample:</span>`)
              append(`<span style="${s.warn}">${JSON.stringify(first, null, 2).slice(0, 600)}</span>`)
            }
          } else {
            append(`<span style="${s.warn}">⚠️ No leaderboard/$ref in detail. Keys: ${Object.keys(detail).join(', ')}</span>`)
            // Show full detail sample
            append(`<span style="${s.warn}">${JSON.stringify(detail, null, 2).slice(0, 800)}</span>`)
          }
        }
      } else {
        // No competitions ref — show full event to see what we have
        append(`<span style="${s.warn}">⚠️ No competitions/$ref. Showing event shape:</span>`)
        append(`<span style="${s.warn}">${JSON.stringify(event, null, 2).slice(0, 1000)}</span>`)
      }

    } catch(err) {
      append(`<span style="${s.err}">❌ Error: ${err.message}</span>`)
    }
  }
})