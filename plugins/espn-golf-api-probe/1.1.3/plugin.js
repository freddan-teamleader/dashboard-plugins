// @bump: patch
api.registerWidget({
  type: "espn-golf-probe",
  title: "ESPN Golf Probe — Leaders",
  height: 500,
  defaultConfig: {},
  render: async function(container, config) {
    const style = `background:#0f172a;color:#e2e8f0;font-family:monospace;font-size:11px;padding:12px;overflow:auto;height:100%;box-sizing:border-box;white-space:pre-wrap;word-break:break-all;`
    container.innerHTML = `<div id="log" style="${style}">Probing leaders endpoint…\n</div>`
    const log = t => { container.querySelector('#log').textContent += t + '\n' }

    try {
      const leadersUrl = 'http://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941/leaders?lang=en&region=us'
      log(`Fetching: ${leadersUrl}`)
      const r = await api.fetch(leadersUrl)
      const d = await r.json()
      log(`✅ Leaders keys: ${Object.keys(d).join(', ')}`)
      log(`\nFull leaders sample:\n${JSON.stringify(d, null, 2).slice(0, 3000)}`)

      // If there are categories/items, drill into first entry
      if (d.categories) {
        log(`\nCategories count: ${d.categories.length}`)
        const cat = d.categories[0]
        log(`First category keys: ${Object.keys(cat).join(', ')}`)
        if (cat.leaders) {
          log(`Leaders in first category: ${cat.leaders.length}`)
          log(`First leader: ${JSON.stringify(cat.leaders[0], null, 2).slice(0, 1000)}`)
        }
      }
      if (d.items) {
        log(`\nItems count: ${d.items.length}`)
        log(`First item: ${JSON.stringify(d.items[0], null, 2).slice(0, 1000)}`)
      }
    } catch(e) {
      log(`❌ ERROR: ${e.message}`)
    }
  }
})