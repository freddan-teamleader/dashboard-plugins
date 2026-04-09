api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard for The Masters Tournament 2026",
  height: 520,
  defaultConfig: {
    apiKey: '',
    maxPlayers: 15
  },
  hiddenConfig: {
    cachedLeaderboard: null,
    lastFetched: null
  },
  render: async function(container, config) {
    const MAX = config.maxPlayers || 15;

    const styles = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .masters-board {
        background: #070d1a;
        color: #e2e8f0;
        font-family: 'Georgia', serif;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .masters-header {
        background: linear-gradient(135deg, #1a3a1a 0%, #0d2b0d 60%, #1a3a1a 100%);
        border-bottom: 3px solid #c9a84c;
        padding: 10px 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
      }
      .masters-logo {
        width: 40px; height: 40px;
        background: #c9a84c;
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; flex-shrink: 0;
      }
      .masters-title-block { flex: 1; }
      .masters-title { font-size: 16px; font-weight: bold; color: #c9a84c; letter-spacing: 1px; }
      .masters-subtitle { font-size: 10px; color: #94a3b8; letter-spacing: 2px; text-transform: uppercase; margin-top: 1px; }
      .masters-round-badge {
        background: #c9a84c;
        color: #0d2b0d;
        font-size: 11px;
        font-weight: bold;
        padding: 3px 8px;
        border-radius: 4px;
        text-align: center;
        line-height: 1.4;
      }
      .table-header {
        display: grid;
        grid-template-columns: 36px 28px 1fr 44px 44px 44px 44px 44px;
        padding: 5px 10px;
        background: #0f172a;
        border-bottom: 1px solid #1e293b;
        font-size: 9px;
        color: #64748b;
        letter-spacing: 1px;
        text-transform: uppercase;
        flex-shrink: 0;
      }
      .table-header span { text-align: center; }
      .table-header .name-col { text-align: left; }
      .leaderboard { flex: 1; overflow-y: auto; }
      .leaderboard::-webkit-scrollbar { width: 4px; }
      .leaderboard::-webkit-scrollbar-track { background: #070d1a; }
      .leaderboard::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
      .player-row {
        display: grid;
        grid-template-columns: 36px 28px 1fr 44px 44px 44px 44px 44px;
        padding: 6px 10px;
        border-bottom: 1px solid rgba(30,41,59,0.5);
        align-items: center;
        transition: background 0.15s;
      }
      .player-row:hover { background: rgba(30,41,59,0.5); }
      .player-row.cut { opacity: 0.4; }
      .player-row.leader { background: rgba(201,168,76,0.07); }
      .pos { font-size: 12px; font-weight: bold; color: #94a3b8; text-align: center; }
      .pos.t { font-size: 10px; }
      .movement { text-align: center; font-size: 11px; }
      .mv-up   { color: #4ade80; }
      .mv-down { color: #ff6b6b; }
      .mv-same { color: #475569; }
      .player-info { display: flex; flex-direction: column; gap: 1px; }
      .player-name { font-size: 12px; color: #e2e8f0; font-weight: 600; }
      .player-country { font-size: 9px; color: #64748b; letter-spacing: 0.5px; }
      .player-row.leader .player-name { color: #c9a84c; }
      .score { text-align: center; font-size: 13px; font-weight: bold; }
      .score.under  { color: #4ade80; }
      .score.over   { color: #ff6b6b; }
      .score.even   { color: #94a3b8; }
      .score.cut-mark { color: #f97316; }
      .round-score  { text-align: center; font-size: 11px; color: #94a3b8; }
      .round-score.active { color: #60a5fa; font-weight: 600; }
      .round-score.empty  { color: #334155; }
      .thru { text-align: center; font-size: 10px; color: #64748b; }
      .thru.active { color: #60a5fa; font-weight: 600; }
      .footer {
        background: #0f172a;
        border-top: 1px solid #1e293b;
        padding: 5px 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }
      .footer-left  { font-size: 9px; color: #475569; }
      .footer-right { font-size: 9px; color: #475569; }
      .augusta { color: #c9a84c; }
      .error-msg { padding: 20px; text-align: center; color: #ff6b6b; font-size: 12px; }
      .loading { padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; }
    `;

    const sampleData = {
      round: 3,
      status: "In Progress",
      course: "Augusta National",
      par: 72,
      players: [
        { pos: 1,  tied: false, name: "Scottie Scheffler",   country: "USA", total: -14, r1: 66, r2: 68, r3: 70, r4: null, thru: 14, move: 0 },
        { pos: 2,  tied: false, name: "Rory McIlroy",        country: "NIR", total: -11, r1: 68, r2: 69, r3: 70, r4: null, thru: 13, move: 2 },
        { pos: 3,  tied: true,  name: "Xander Schauffele",   country: "USA", total: -10, r1: 67, r2: 71, r3: 72, r4: null, thru: 12, move: -1 },
        { pos: 3,  tied: true,  name: "Collin Morikawa",     country: "USA", total: -10, r1: 70, r2: 68, r3: 72, r4: null, thru: 18, move: 1 },
        { pos: 5,  tied: true,  name: "Jon Rahm",            country: "ESP", total: -9,  r1: 69, r2: 70, r3: 72, r4: null, thru: 16, move: -2 },
        { pos: 5,  tied: true,  name: "Ludvig Åberg",        country: "SWE", total: -9,  r1: 71, r2: 67, r3: 73, r4: null, thru: 18, move: 3 },
        { pos: 7,  tied: false, name: "Brooks Koepka",       country: "USA", total: -8,  r1: 70, r2: 69, r3: 73, r4: null, thru: 15, move: 0 },
        { pos: 8,  tied: true,  name: "Viktor Hovland",      country: "NOR", total: -7,  r1: 72, r2: 69, r3: 72, r4: null, thru: 18, move: 2 },
        { pos: 8,  tied: true,  name: "Tommy Fleetwood",     country: "ENG", total: -7,  r1: 71, r2: 70, r3: 72, r4: null, thru: 14, move: -1 },
        { pos: 10, tied: true,  name: "Patrick Cantlay",     country: "USA", total: -6,  r1: 73, r2: 69, r3: 72, r4: null, thru: 18, move: 1 },
        { pos: 10, tied: true,  name: "Shane Lowry",         country: "IRL", total: -6,  r1: 70, r2: 72, r3: 72, r4: null, thru: 11, move: 0 },
        { pos: 12, tied: true,  name: "Justin Thomas",       country: "USA", total: -5,  r1: 71, r2: 72, r3: 72, r4: null, thru: 18, move: -3 },
        { pos: 12, tied: true,  name: "Max Homa",            country: "USA", total: -5,  r1: 74, r2: 69, r3: 72, r4: null, thru: 17, move: 2 },
        { pos: 14, tied: true,  name: "Adam Scott",          country: "AUS", total: -4,  r1: 73, r2: 71, r3: 72, r4: null, thru: 18, move: 0 },
        { pos: 14, tied: true,  name: "Tony Finau",          country: "USA", total: -4,  r1: 72, r2: 72, r3: 72, r4: null, thru: 18, move: 1 },
      ]
    };

    function fmtScore(n, par) {
      if (n === null || n === undefined) return '';
      const rel = n - par;
      if (rel === 0) return 'E';
      return rel > 0 ? `+${rel}` : `${rel}`;
    }

    function scoreClass(total, par) {
      if (total === null || total === undefined) return 'even';
      const rel = total - (par * /* rounds completed estimate */ 1);
      // total is already relative in our sample
      if (typeof total === 'string') return 'even';
      if (total < 0) return 'under';
      if (total > 0) return 'over';
      return 'even';
    }

    function fmtTotal(total) {
      if (total === null || total === undefined) return '-';
      if (total === 0) return 'E';
      return total > 0 ? `+${total}` : `${total}`;
    }

    function totalClass(total) {
      if (total < 0) return 'under';
      if (total > 0) return 'over';
      return 'even';
    }

    function roundScoreClass(score, par, isActive) {
      if (score === null) return 'round-score empty';
      return isActive ? 'round-score active' : 'round-score';
    }

    function fmtRound(score) {
      if (score === null) return '-';
      return score;
    }

    function movementHTML(move) {
      if (move > 0) return `<span class="movement mv-up">▲${move}</span>`;
      if (move < 0) return `<span class="movement mv-down">▼${Math.abs(move)}</span>`;
      return `<span class="movement mv-same">—</span>`;
    }

    function thruDisplay(thru, round) {
      if (thru === 18) return 'F';
      return thru === 0 ? '-' : thru;
    }

    function buildBoard(data) {
      const players = data.players.slice(0, MAX);
      const rows = players.map((p, i) => {
        const isLeader  = p.pos === 1;
        const r3Active  = data.round === 3 && p.thru < 18;
        const r4Active  = data.round === 4 && p.thru < 18;
        const posLabel  = p.tied ? `T${p.pos}` : `${p.pos}`;
        const isTied    = p.tied;

        return `
          <div class="player-row${isLeader ? ' leader' : ''}">
            <div class="pos${isTied ? ' t' : ''}">${posLabel}</div>
            ${movementHTML(p.move)}
            <div class="player-info">
              <div class="player-name">${p.name}</div>
              <div class="player-country">${p.country}</div>
            </div>
            <div class="score ${totalClass(p.total)}">${fmtTotal(p.total)}</div>
            <div class="${roundScoreClass(p.r1, 72, false)}">${fmtRound(p.r1)}</div>
            <div class="${roundScoreClass(p.r2, 72, false)}">${fmtRound(p.r2)}</div>
            <div class="${roundScoreClass(p.r3, 72, data.round === 3)}">${fmtRound(p.r3)}</div>
            <div class="thru${data.round === 3 && p.thru < 18 ? ' active' : ''}">${thruDisplay(p.thru, data.round)}</div>
          </div>`;
      }).join('');

      return `
        <style>${styles}</style>
        <div class="masters-board">
          <div class="masters-header">
            <div class="masters-logo">⛳</div>
            <div class="masters-title-block">
              <div class="masters-title">THE MASTERS 2026</div>
              <div class="masters-subtitle">Augusta National · Par 72 · 7,510 yds</div>
            </div>
            <div class="masters-round-badge">
              RD ${data.round}<br>
              <span style="font-size:9px;font-weight:normal">${data.status}</span>
            </div>
          </div>

          <div class="table-header">
            <span>POS</span>
            <span></span>
            <span class="name-col">PLAYER</span>
            <span>TOT</span>
            <span>R1</span>
            <span>R2</span>
            <span>R3</span>
            <span>THRU</span>
          </div>

          <div class="leaderboard">${rows}</div>

          <div class="footer">
            <div class="footer-left">April 9–12, 2026 · <span class="augusta">Augusta, Georgia</span></div>
            <div class="footer-right">⚠ Sample Data</div>
          </div>
        </div>`;
    }

    // Try live data if API key is provided (sportradar golf API format)
    let data = sampleData;

    if (config.apiKey) {
      try {
        container.innerHTML = '<div class="masters-board"><div class="loading">Fetching live data…</div></div>';
        const res = await api.fetch(
          `https://api.sportradar.com/golf/trial/v3/en/tournaments/masters-2026/leaderboard.json?api_key=${config.apiKey}`
        );
        if (res.ok) {
          const json = await res.json();
          // Map sportradar response — adjust field names as needed
          // data = mapSportradar(json);
        }
      } catch (e) {
        // Fall through to sample data
      }
    }

    container.innerHTML = buildBoard(data);

    container.__cleanup__ = () => {
      container.innerHTML = '';
    };
  }
});