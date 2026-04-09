// @bump: patch
api.registerWidget({
  type: "espn-golf-probe",
  title: "ESPN Golf Probe — Competitor Detail",
  height: 500,
  defaultConfig: {},
  render: async function(container, config) {
    const BASE = "http://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941";
    const log = [];
    const out = () => { container.innerHTML = `<pre style="color:#e2e8f0;font-size:11px;padding:12px;white-space:pre-wrap;overflow:auto;height:100%;margin:0;background:#0f172a">${log.join('\n')}</pre>`; };

    container.innerHTML = '<pre style="color:#e2e8f0;font-size:11px;padding:12px;background:#0f172a;height:100%;margin:0">Probing competitor sub-endpoints...</pre>';

    // Use competitor ID 9938 (first in list, order:1 = leader)
    const playerId = "9938";

    try {
      // Fetch score, status, athlete, linescores in parallel
      log.push(`Fetching 4 sub-endpoints in parallel for competitor ${playerId}...`);
      out();

      const [scoreRes, statusRes, athleteRes, linesRes] = await Promise.all([
        api.fetch(`${BASE}/competitors/${playerId}/score?lang=en&region=us`),
        api.fetch(`${BASE}/competitors/${playerId}/status?lang=en&region=us`),
        api.fetch(`http://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2026/athletes/${playerId}?lang=en&region=us`),
        api.fetch(`${BASE}/competitors/${playerId}/linescores?lang=en&region=us`),
      ]);

      // Score
      try {
        const score = await scoreRes.json();
        log.push(`\n✅ SCORE keys: ${Object.keys(score).join(', ')}`);
        log.push(`Score sample: ${JSON.stringify(score, null, 2).slice(0, 400)}`);
      } catch(e) { log.push(`❌ SCORE parse error: ${e.message}`); }

      // Status
      try {
        const status = await statusRes.json();
        log.push(`\n✅ STATUS keys: ${Object.keys(status).join(', ')}`);
        log.push(`Status sample: ${JSON.stringify(status, null, 2).slice(0, 400)}`);
      } catch(e) { log.push(`❌ STATUS parse error: ${e.message}`); }

      // Athlete
      try {
        const athlete = await athleteRes.json();
        log.push(`\n✅ ATHLETE keys: ${Object.keys(athlete).join(', ')}`);
        log.push(`Athlete sample: ${JSON.stringify(athlete, null, 2).slice(0, 400)}`);
      } catch(e) { log.push(`❌ ATHLETE parse error: ${e.message}`); }

      // Linescores
      try {
        const lines = await linesRes.json();
        log.push(`\n✅ LINESCORES keys: ${Object.keys(lines).join(', ')}`);
        log.push(`Linescores sample: ${JSON.stringify(lines, null, 2).slice(0, 600)}`);
      } catch(e) { log.push(`❌ LINESCORES parse error: ${e.message}`); }

    } catch(e) {
      log.push(`\n❌ Fatal error: ${e.message}`);
    }

    out();
  }
})