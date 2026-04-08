// @bump: patch
api.registerWidget({
  type: "stock-ticker",
  title: "Stock Ticker",
  description: "Live stock prices with sparkline trends using Finnhub API",
  height: 260,
  defaultConfig: {
    symbols: ["AAPL", "MSFT", "GOOGL", "TSLA", "NVDA"],
    apiKey: "",
    refreshInterval: 60,
    currency: "USD"
  },

  render: async function(container, config) {
    const symbols = config.symbols || ["AAPL", "MSFT", "GOOGL", "TSLA", "NVDA"];
    const apiKey  = config.apiKey || "";
    const refreshSec = Math.max(60, config.refreshInterval || 60);

    // Built-in name lookup so we always have a friendly name
    const NAMES = {
      AAPL: "Apple Inc.", MSFT: "Microsoft Corp.", GOOGL: "Alphabet Inc.",
      TSLA: "Tesla Inc.", NVDA: "NVIDIA Corp.", AMZN: "Amazon.com Inc.",
      META: "Meta Platforms", NFLX: "Netflix Inc.", AMD: "AMD Inc.",
      INTC: "Intel Corp.", ORCL: "Oracle Corp.", CRM: "Salesforce Inc.",
      ADBE: "Adobe Inc.", PYPL: "PayPal Holdings", UBER: "Uber Technologies",
      SPOT: "Spotify Technology", SHOP: "Shopify Inc.", SNAP: "Snap Inc.",
    };

    container.innerHTML = `
      <style>
        .ticker-wrap {
          font-family: 'Inter', system-ui, sans-serif;
          background: #0f172a;
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-radius: 8px;
          padding: 10px 12px;
          box-sizing: border-box;
          color: #e2e8f0;
        }
        .ticker-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .ticker-title { font-size: 12px; color: #94a3b8; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
        .ticker-status { font-size: 10px; color: #94a3b8; display: flex; align-items: center; gap: 4px; }
        .dot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; animation: pulse 2s infinite; }
        .dot.error { background: #ff6b6b; animation: none; }
        .dot.demo  { background: #f97316; }
        .dot.rate  { background: #f97316; animation: none; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        .ticker-list {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ticker-list::-webkit-scrollbar { width: 3px; }
        .ticker-list::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
        .ticker-row {
          display: grid;
          grid-template-columns: 64px 1fr 70px 72px;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          background: #1e293b;
          border-radius: 6px;
          transition: background .2s;
        }
        .ticker-row:hover { background: #263348; }
        .sym  { font-size: 13px; font-weight: 700; color: #e2e8f0; line-height: 1.2; }
        .name { font-size: 10px; color: #94a3b8; margin-top: 1px; line-height: 1.2; }
        .sym-col { display: flex; flex-direction: column; }
        .spark { height: 28px; }
        .price { font-size: 13px; font-weight: 600; text-align: right; color: #e2e8f0; }
        .change {
          font-size: 11px; font-weight: 600;
          text-align: right;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .change.up   { color: #4ade80; background: rgba(74,222,128,.12); }
        .change.down { color: #ff6b6b; background: rgba(255,107,107,.12); }
        .change.flat { color: #94a3b8; background: rgba(148,163,184,.1); }
        .ticker-footer {
          margin-top: 6px;
          font-size: 10px;
          color: #475569;
          text-align: right;
        }
        .demo-banner {
          font-size: 10px;
          color: #f97316;
          text-align: center;
          padding: 2px 0 4px;
        }
      </style>
      <div class="ticker-wrap">
        <div class="ticker-header">
          <span class="ticker-title">📈 Stocks</span>
          <span class="ticker-status"><span class="dot" id="status-dot"></span><span id="status-text">Loading…</span></span>
        </div>
        ${!apiKey ? '<div class="demo-banner">⚠️ Demo mode — set apiKey in config for live data</div>' : ''}
        <div class="ticker-list" id="ticker-list">
          ${symbols.map(s => `
            <div class="ticker-row" id="row-${s}">
              <div class="sym-col">
                <div class="sym">${s}</div>
                <div class="name" id="name-${s}">${NAMES[s] || '—'}</div>
              </div>
              <div class="spark"><svg id="spark-${s}" width="70" height="28"></svg></div>
              <div style="text-align:right">
                <div class="price" id="price-${s}">…</div>
                <div class="change flat" id="change-${s}">…</div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="ticker-footer" id="ticker-footer">—</div>
      </div>
    `;

    const DEMO = {
      AAPL:  { c: 189.30, d: 1.24,  dp:  0.66, spark: [185,186,187,186,188,189,188,189] },
      MSFT:  { c: 415.50, d: -2.10, dp: -0.50, spark: [418,417,416,418,417,416,415,415] },
      GOOGL: { c: 175.80, d: 3.40,  dp:  1.97, spark: [171,172,173,174,173,175,176,175] },
      TSLA:  { c: 177.90, d: -5.60, dp: -3.05, spark: [184,182,181,180,179,179,178,177] },
      NVDA:  { c: 875.40, d: 22.30, dp:  2.62, spark: [850,855,860,858,865,870,872,875] },
      AMZN:  { c: 185.20, d: 0.85,  dp:  0.46, spark: [183,183,184,185,184,185,185,185] },
      META:  { c: 492.60, d: 7.20,  dp:  1.48, spark: [483,485,487,490,489,491,492,492] },
      NFLX:  { c: 628.90, d: -3.40, dp: -0.54, spark: [633,632,631,630,631,629,629,628] },
    };

    function demoDataFor(symbol) {
      return DEMO[symbol] || {
        c: +(100 + Math.random() * 400).toFixed(2),
        d: +((Math.random() - .5) * 10).toFixed(2),
        dp: +((Math.random() - .5) * 4).toFixed(2),
        spark: Array.from({length: 8}, (_, i) => 100 + i * (Math.random() - .4) * 3)
      };
    }

    function drawSparkline(svgEl, points, positive) {
      if (!points || points.length < 2) return;
      const W = 70, H = 28, pad = 2;
      const min = Math.min(...points), max = Math.max(...points);
      const range = max - min || 1;
      const scaleX = i => pad + (i / (points.length - 1)) * (W - pad * 2);
      const scaleY = v => H - pad - ((v - min) / range) * (H - pad * 2);
      const pts = points.map((v, i) => `${scaleX(i)},${scaleY(v)}`).join(' ');
      const color = positive ? '#4ade80' : '#ff6b6b';
      svgEl.innerHTML = `
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${scaleX(points.length-1)}" cy="${scaleY(points[points.length-1])}"
          r="2" fill="${color}"/>
      `;
    }

    function applyQuote(symbol, data) {
      const priceEl  = container.querySelector(`#price-${symbol}`);
      const changeEl = container.querySelector(`#change-${symbol}`);
      const nameEl   = container.querySelector(`#name-${symbol}`);
      const sparkEl  = container.querySelector(`#spark-${symbol}`);
      if (!priceEl) return;
      const up = data.dp > 0, down = data.dp < 0;
      const cls = up ? 'up' : down ? 'down' : 'flat';
      const sign = up ? '+' : '';
      priceEl.textContent  = `$${Number(data.c).toFixed(2)}`;
      changeEl.textContent = `${sign}${Number(data.dp).toFixed(2)}%`;
      changeEl.className   = `change ${cls}`;
      // Use profile name > NAMES lookup > existing content > symbol
      if (data.name && data.name !== symbol) nameEl.textContent = data.name;
      else if (NAMES[symbol]) nameEl.textContent = NAMES[symbol];
      if (data.spark) drawSparkline(sparkEl, data.spark, !down);
    }

    const cache = {};

    async function fetchFinnhub(symbol) {
      const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;
      const r = await api.fetch(url);
      if (r.status === 429) throw new Error('RATE_LIMIT');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.c) throw new Error('No data');
      const spark = [j.o, (j.o+j.h)/2, j.h, (j.h+j.c)/2, j.c, j.l, (j.l+j.c)/2, j.c];
      // Use NAMES lookup; profile fetch would cost an extra API call per symbol
      return { c: j.c, d: j.d, dp: j.dp, name: NAMES[symbol] || symbol, spark };
    }

    let destroyed = false;
    let timer = null;

    async function refresh() {
      const dot    = container.querySelector('#status-dot');
      const stat   = container.querySelector('#status-text');
      const footer = container.querySelector('#ticker-footer');
      if (!dot) return;

      if (!apiKey) {
        symbols.forEach(s => applyQuote(s, demoDataFor(s)));
        dot.className    = 'dot demo';
        stat.textContent = 'Demo';
        footer.textContent = 'Demo data — add Finnhub API key for live prices';
        return;
      }

      stat.textContent = 'Refreshing…';
      let rateLimited = false;
      let ok = 0, fail = 0;

      for (const sym of symbols) {
        if (destroyed) return;
        try {
          const data = await fetchFinnhub(sym);
          cache[sym] = data;
          applyQuote(sym, data);
          ok++;
        } catch(e) {
          if (e.message === 'RATE_LIMIT') {
            rateLimited = true;
            if (cache[sym]) applyQuote(sym, cache[sym]);
            break;
          }
          fail++;
          if (cache[sym]) {
            applyQuote(sym, cache[sym]);
          } else {
            const priceEl = container.querySelector(`#price-${sym}`);
            if (priceEl) priceEl.textContent = 'N/A';
          }
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      if (!destroyed) {
        const now = new Date().toLocaleTimeString();
        if (rateLimited) {
          dot.className    = 'dot rate';
          stat.textContent = 'Rate limited';
          footer.textContent = `⚠️ Finnhub rate limit hit — showing cached data · retries in ${refreshSec}s`;
        } else if (fail === symbols.length) {
          dot.className    = 'dot error';
          stat.textContent = 'Error';
          footer.textContent = `Failed to load · retrying in ${refreshSec}s`;
        } else {
          dot.className    = 'dot';
          stat.textContent = 'Live';
          footer.textContent = `Updated ${now} · refreshes every ${refreshSec}s`;
        }
      }
    }

    await refresh();
    timer = setInterval(refresh, refreshSec * 1000);

    container.__cleanup__ = () => {
      destroyed = true;
      if (timer) clearInterval(timer);
    };
  }
});