api.registerWidget({
  type: "espn-golf-probe",
  title: "ESPN Golf API Probe",
  height: 320,
  render: async function(container, config) {
    container.innerHTML = '<p style="color:#94a3b8;font-family:monospace;padding:12px">Probing ESPN API…</p>'

    const endpoints = [
      'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
      'https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga',
      'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events?limit=5',
    ]

    const style = `font-family:monospace;font-size:11px;color:#e2e8f0;background:#0f172a;padding:12px;border-radius:8px;overflow:auto;height:260px`
    let html = `<pre style="${style}">`

    for (const url of endpoints) {
      html += `\n🔍 GET ${url}\n`
      try {
        const res  = await api.fetch(url)
        const data = await res.json()

        if (data?.events?.length) {
          html += `✅ OK — ${data.events.length} event(s) found\n`
          data.events.slice(0, 2).forEach(e => {
            html += `   📅 ${e.name} | status: ${e.status?.type?.description ?? '?'}\n`
          })
        } else if (data?.sports) {
          const events = data.sports?.[0]?.leagues?.[0]?.events ?? []
          html += `✅ OK — sports wrapper, ${events.length} event(s)\n`
          events.slice(0, 2).forEach(e => {
            html += `   📅 ${e.name ?? e.shortName} | status: ${e.status?.type?.description ?? '?'}\n`
          })
        } else {
          html += `⚠️  OK but unexpected shape — keys: ${Object.keys(data).join(', ')}\n`
          html += `   ${JSON.stringify(data).slice(0, 120)}…\n`
        }
      } catch (err) {
        html += `❌ FAILED — ${err.message}\n`
      }
      html += '\n'
    }

    html += '</pre>'
    container.innerHTML = html
  }
})