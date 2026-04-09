// @bump: patch
api.registerWidget({
  type: "espn-golf-probe",
  title: "ESPN Golf API Probe",
  height: 500,
  render: async function(container, config) {
    const log = (msg, color='#e2e8f0') => {
      container.innerHTML += `<div style="margin:4px 0;color:${color};font-size:12px;font-family:monospace;white-space:pre-wrap">${msg}</div>`
    }

    container.innerHTML = `<div style="background:#0f172a;padding:12px;height:100%;overflow-y:auto;box-sizing:border-box">`

    const compUrl = 'http://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941?lang=en&region=us'

    log('Fetching competition...')
    try {
      const res = await api.fetch(compUrl)
      const data = await res.json()
      log(`✅ Competition keys: ${Object.keys(data).join(', ')}`, '#4ade80')

      // Check competitors
      if (data.competitors) {
        log(`\ncompetitors is array: ${Array.isArray(data.competitors)}, length: ${data.competitors?.length}`)
        const first = data.competitors[0]
        if (first?.$ref) {
          log(`First competitor is $ref: ${first.$ref}`)
          log('Fetching first competitor...')
          const cres = await api.fetch(first.$ref)
          const cdata = await cres.json()
          log(`\n✅ Competitor keys: ${Object.keys(cdata).join(', ')}`, '#4ade80')
          log(`\nFull competitor sample:\n${JSON.stringify(cdata, null, 2).slice(0, 2000)}`, '#94a3b8')
        } else {
          log(`\nFirst competitor (inline):\n${JSON.stringify(first, null, 2).slice(0, 2000)}`, '#94a3b8')
        }
      } else {
        log(`\nNo competitors field. Full response:\n${JSON.stringify(data, null, 2).slice(0, 3000)}`, '#94a3b8')
      }
    } catch(e) {
      log(`❌ ${e.message}`, '#ff6b6b')
    }
  }
})