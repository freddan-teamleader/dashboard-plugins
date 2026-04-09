// @bump: major
api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard for The Masters Tournament 2026",
  height: 520,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },

  render: async function(container, config) {
    const MAX = config.maxPlayers || 10;
    const REFRESH = (config.refreshSeconds || 60) * 1000;
    const EVENT = '401811941';
    const BASE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga';
    const COMP = `${BASE}/events/${EVENT}/competitions/${EVENT}`;

    const s = document.createElement('style');
    s.textContent = `
      .gm-wrap { font-family: 'Georgia', serif; background: #0a1a0a; color: #e2e8f0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
      .gm-header { background: linear-gradient(135deg, #1a3a1a 0%, #0d2b0d 100%); border-bottom: 2px solid #d4af37; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
      .gm-title { display: flex; align-items: center; gap: 8px; }
      .gm-logo { font-size: 22px; }
      .gm-name { font-size: 15px; font-weight: bold; color: #d4af37; letter-spacing: 1px; text-transform: uppercase; }
      .gm-sub { font-size: 10px; color: #94a3b8; letter-spacing: 2px; text-transform: uppercase; }
      .gm-status { text-align: right; }
      .gm-status-badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: #4ade8033; color: #4ade80; border: 1px solid #4ade8066; }
      .gm-updated { font-size: 9px; color: #64748b; margin-top: 3px; }
      .gm-table-wrap { overflow-y: auto; flex: 1; }
      .gm-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .gm-table thead th { background: #0d2b0d; color: #d4af37; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; padding: 6px 8px; position: sticky; top: 0; text-align: center; border-bottom: 1px solid #d4af3744; }
      .gm-table thead th:nth-child(2) { text-align: left; }
      .gm-table tbody tr { border-bottom: 1px solid #1e3a1e; transition: background 0.2s; }
      .gm-table tbody tr:hover { background: #1a3a1a44; }
      .gm-table tbody td { padding: 7px 8px; text-align: center; vertical-align: middle; }
      .gm-table tbody td:nth-child(2) { text-align: left; }
      .gm-pos { color: #94a3b8; font-size: 11px; min-width: 28px; }
      .gm-pos.leader { color: #d4af37; font-weight: bold; }
      .gm-name-cell { display: flex; flex-direction: column; }
      .gm-player { font-weight: bold; color: #e2e8f0; font-size: 12px; }
      .gm-country { font-size: 9px; color: #64748b; margin-top: 1px; }
      .gm-score { font-weight: bold; font-size: 13px; min-width: 36px; }
      .gm-score.under { color: #4ade80; }
      .gm-score.over { color: #ff6b6b; }
      .gm-score.even { color: #e2e8f0; }
      .gm-round { font-size: 11px; color: #94a3b8; min-width: 28px; }
      .gm-round.active { color: #60a5fa; font-weight: bold; }
      .gm-round.eagle { color: #e879f9; }
      .gm-round.birdie { color: #4ade80; }
      .gm-round.bogey { color: #f97316; }
      .gm-round.double { color: #ff6b6b; }
      .gm-thru { font-size: 10px; color: #64748b; min-width: 32px; }
      .gm-thru.active { color: #60a5fa; }
      .gm-move { font-size: 10px; min-width: 20px; }
      .gm-move.up { color: #4ade80; }
      .gm-move.down { color: #ff6b6b; }
      .gm-move.same { color: #64748b; }
      .gm-loading { display: flex; align-items: center; justify-content: center; height: 100%; color: #94a3b8; font-size: 13px; gap: 8px; }
      .gm-spinner { width: 16px; height: 16px; border: 2px solid #1e3a1e; border-top-color: #d4af37; border-radius: 50%; animation: gm-spin 0.8s linear infinite; }
      @keyframes gm-spin { to { transform: rotate(360deg); } }
      .gm-error { color: #ff6b6b; text-align: center; padding: 20px; font-size: 12px; }
      .gm-footer { padding: 5px 12px; background: #0d2b0d; border-top: 1px solid #1e3a1e; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
      .gm-footer-txt { font-size: 9px; color: #475569; }
    `;
    container.innerHTML = '';
    container.appendChild(s);

    const wrap = document.createElement('div');
    wrap.className = 'gm-wrap';
    wrap.innerHTML = `
      <div class="gm-header">
        <div class="gm-title">
          <span class="gm-logo">⛳</span>
          <div>
            <div class="gm-name">The Masters</div>
            <div class="gm-sub">Augusta National · 2026</div>
          </div>
        </div>
        <div class="gm-status">
          <div class="gm-status-badge" id="gm-state">Loading…</div>
          <div class="gm-updated" id="gm-updated"></div>
        </div>
      </div>
      <div class="gm-table-wrap">
        <div class="gm-loading"><div class="gm-spinner"></div>Fetching leaderboard…</div>
      </div>
      <div class="gm-footer">
        <span class="gm-footer-txt">ESPN · No API key required</span>
        <span class="gm-footer-txt" id="gm-count"></span>
      </div>
    `;
    container.appendChild(wrap);

    const tableWrap = wrap.querySelector('.gm-table-wrap');
    const stateEl   = wrap.querySelector('#gm-state');
    const updatedEl = wrap.querySelector('#gm-updated');
    const countEl   = wrap.querySelector('#gm-count');

    function extractName(text) {
      const fn = (text.match(/"firstName":"([^"]+)"/) || [])[1] || '';
      const ln = (text.match(/"lastName":"([^"]+)"/)  || [])[1] || '';
      const full = (text.match(/"fullName":"([^"]+)"/) || [])[1] || '';
      return full || (fn && ln ? `${fn} ${ln}` : null);
    }

    function scoreClass(val) {
      if (val === null || val === undefined || val === 'E') return 'even';
      const n = parseFloat(val);
      if (isNaN(n) || n === 0) return 'even';
      return n < 0 ? 'under' : 'over';
    }

    function formatScore(displayValue) {
      if (!displayValue && displayValue !== 0) return '-';
      const v = String(displayValue);
      if (v === '0' || v === 'E') return 'E';
      return v;
    }

    function roundClass(scoreTypeName) {
      if (!scoreTypeName) return '';
      const n = scoreTypeName.toUpperCase();
      if (n.includes('EAGLE') || n.includes('DOUBLE_EAGLE') || n.includes('HOLE_IN_ONE')) return 'eagle';
      if (n.includes('BIRDIE')) return 'birdie';
      if (n.includes('BOGEY') && !n.includes('DOUBLE') && !n.includes('TRIPLE')) return 'bogey';
      if (n.includes('DOUBLE') || n.includes('TRIPLE') || n.includes('WORSE')) return 'double';
      return '';
    }

    async function fetchJSON(url) {
      const res = await api.fetch(url);
      return res.json();
    }

    async function fetchText(url) {
      const res = await api.fetch(url);
      return res.text();
    }

    async function loadLeaderboard() {
      // Step 1: get top N competitor IDs ordered by position
      const pages = Math.ceil(MAX / 10);
      let competitors = [];
      for (let p = 1; p <= pages; p++) {
        const data = await fetchJSON(`${COMP}/competitors?limit=10&page=${p}`);
        competitors = competitors.concat(data.items || []);
        if (competitors.length >= MAX) break;
      }
      competitors = competitors.slice(0, MAX);

      // Step 2: fetch score + status + athlete name in parallel for each player
      const players = await Promise.all(competitors.map(async (c) => {
        const id = c.id;
        try {
          const [scoreData, statusData, athleteText] = await Promise.all([
            fetchJSON(`${COMP}/competitors/${id}/score`),
            fetchJSON(`${COMP}/competitors/${id}/status`),
            fetchText(`${BASE}/seasons/2026/athletes/${id}`)
          ]);

          const name = extractName(athleteText) || `Player ${id}`;

          // country
          const countryMatch = athleteText.match(/"citizenship":"([^"]+)"/);
          const country = countryMatch ? countryMatch[1] : '';

          const scoreDisplay = scoreData.displayValue || 'E';
          const scoreVal     = scoreData.value || 0;
          const pos          = statusData.position || {};
          const thru         = statusData.thru;
          const hole         = statusData.hole;
          const statusType   = statusData.type || {};
          const state        = statusType.state || '';
          const movement     = c.movement || 0;
          const order        = c.order || 0;

          return { id, name, country, scoreDisplay, scoreVal, pos, thru, hole, state, movement, order, rounds: [] };
        } catch (e) {
          return { id, name: `Player ${id}`, country: '', scoreDisplay: 'E', scoreVal: 0, pos: {}, thru: null, hole: null, state: '', movement: 0, order: c.order || 0, rounds: [] };
        }
      }));

      // Step 3: fetch linescores async (non-blocking, update after)
      players.forEach(async (p) => {
        try {
          const ls = await fetchJSON(`${COMP}/competitors/${p.id}/linescores`);
          p.rounds = (ls.items || []).map(r => ({
            display: r.displayValue,
            period:  r.period,
            active:  r.period === (ls.items.length)
          }));
          renderTable(players, stateEl.textContent);
        } catch(e) {}
      });

      return players;
    }

    function renderTable(players, eventState) {
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      updatedEl.textContent = `Updated ${now}`;
      countEl.textContent   = `${players.length} players`;

      const isLive = eventState === 'In Progress';
      stateEl.textContent  = eventState || 'In Progress';
      stateEl.style.background = isLive ? '#4ade8033' : '#d4af3733';
      stateEl.style.color      = isLive ? '#4ade80'   : '#d4af37';
      stateEl.style.borderColor = isLive ? '#4ade8066' : '#d4af3766';

      let html = `
        <table class="gm-table">
          <thead>
            <tr>
              <th>POS</th>
              <th>PLAYER</th>
              <th>TOTAL</th>
              <th>R1</th><th>R2</th><th>R3</th><th>R4</th>
              <th>THRU</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
      `;

      players.forEach(p => {
        const posDisplay = p.pos.isTie ? `T${p.pos.displayName}` : (p.pos.displayName || p.order);
        const isLeader   = p.order === 1;
        const sc         = scoreClass(p.scoreDisplay);

        const rounds = [1,2,3,4].map(r => {
          const rd = p.rounds.find(x => x.period === r);
          if (!rd) return `<td class="gm-round">-</td>`;
          return `<td class="gm-round ${rd.active ? 'active' : ''}">${rd.display}</td>`;
        }).join('');

        let thruDisplay = '-';
        if (p.state === 'in') thruDisplay = p.thru != null ? (p.thru === 18 ? 'F' : p.thru) : (p.hole || '-');
        else if (p.state === 'post') thruDisplay = 'F';
        else if (p.state === 'pre') thruDisplay = 'TBD';

        const thruActive = p.state === 'in' && p.thru !== 18;

        const mv = p.movement;
        const mvClass   = mv > 0 ? 'up' : mv < 0 ? 'down' : 'same';
        const mvDisplay = mv > 0 ? `▲${mv}` : mv < 0 ? `▼${Math.abs(mv)}` : '—';

        html += `
          <tr>
            <td class="gm-pos ${isLeader ? 'leader' : ''}">${posDisplay}</td>
            <td>
              <div class="gm-name-cell">
                <span class="gm-player">${p.name}</span>
                ${p.country ? `<span class="gm-country">${p.country}</span>` : ''}
              </div>
            </td>
            <td class="gm-score ${sc}">${formatScore(p.scoreDisplay)}</td>
            ${rounds}
            <td class="gm-thru ${thruActive ? 'active' : ''}">${thruDisplay}</td>
            <td class="gm-move ${mvClass}">${mvDisplay}</td>
          </tr>
        `;
      });

      html += '</tbody></table>';
      tableWrap.innerHTML = html;
    }

    async function refresh() {
      try {
        // Get event status
        const event = await fetchJSON(`${BASE}/events/${EVENT}`);
        const eventStatus = event.status?.type?.description || 'In Progress';

        const players = await loadLeaderboard();
        renderTable(players, eventStatus);
      } catch(e) {
        tableWrap.innerHTML = `<div class="gm-error">⚠️ Failed to load leaderboard<br><small>${e.message}</small></div>`;
      }
    }

    await refresh();
    const timer = setInterval(refresh, REFRESH);
    container.__cleanup__ = () => clearInterval(timer);
  }
});