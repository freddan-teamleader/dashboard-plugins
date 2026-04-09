// @bump: patch
api.registerWidget({
  type: "espn-golf-probe",
  title: "ESPN Golf — Enable Probe",
  height: 500,
  defaultConfig: {},
  render: async function(container, config) {
    const BASE = 'http://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941'
    const s = (o) => JSON.stringify(o, null, 2)
    let html = '<div style="font:11px monospace;color:#e2e8f0;padding:8px;overflow:auto;height:100%">'

    try {
      // Fetch competitor 9938 with ?enable=
      const url = `${BASE}/competitors/9938?enable=athlete,score,status,linescores`
      html += `<b>🔍 ?enable= response for competitor 9938</b><br>`
      const res = await api.fetch(url)
      const data = await res.json()
      html += `Keys: ${Object.keys(data).join(', ')}<br><br>`

      // Score
      if (data.score) {
        html += `<b>SCORE:</b><br><pre>${s(data.score)}</pre>`
      }
      // Status
      if (data.status) {
        html += `<b>STATUS keys:</b> ${Object.keys(data.status).join(', ')}<br>`
        html += `<pre>${s(data.status)}</pre>`
      }
      // Athlete
      if (data.athlete) {
        html += `<b>ATHLETE keys:</b> ${Object.keys(data.athlete).join(', ')}<br>`
        html += `<pre>${s(data.athlete)}</pre>`
      }
      // Linescores
      if (data.linescores) {
        html += `<b>LINESCORES:</b><br><pre>${s(data.linescores)}</pre>`
      }
    } catch(e) {
      html += `❌ ERROR: ${e.message}`
    }

    html += '</div>'
    container.innerHTML = html
  }
})