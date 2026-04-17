// @bump: patch
api.registerWidget({
  type: "weconnect-vehicle-tracker",
  title: "WeConnect Vehicle Tracker",
  description: "Live vehicle data from the WeConnect Agent",
  height: 320,
  dependencies: ["weconnect-agent"],
  defaultConfig: {
    vin: "",
    unit: "km"
  },
  render: async function(container, config) {
    const svc = await api.getService("weconnect-agent");

    if (!svc) {
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--text-secondary);font-family:sans-serif;">
          <span style="font-size:2rem">🚗</span>
          <p style="margin:0;font-size:0.9rem;text-align:center">WeConnect Agent is not running.<br>Please install and start it first.</p>
        </div>`;
      return;
    }

    const refresh = async () => {
      btn.disabled = true;
      btn.textContent = "Polling…";
      try { await svc.pollNow(); } catch(e) {}
      let status, lastReading;
      try { status = await svc.getStatus(); } catch(e) { status = `ERROR: ${e.message}`; }
      try { lastReading = await svc.getLastReading(); } catch(e) { lastReading = `ERROR: ${e.message}`; }
      statusPre.textContent = JSON.stringify(status, null, 2);
      readingPre.textContent = JSON.stringify(lastReading, null, 2);
      btn.disabled = false;
      btn.textContent = "🔄 Poll Now";
    };

    container.innerHTML = `
      <div style="padding:16px;font-family:monospace;font-size:0.75rem;color:var(--text-primary);overflow:auto;height:100%;box-sizing:border-box;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="color:var(--accent-green);font-size:0.85rem;">✅ Service connected!</div>
          <button id="poll-btn" style="background:var(--accent-blue);color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:0.75rem;">🔄 Poll Now</button>
        </div>
        <div style="color:var(--accent-blue);margin-bottom:4px;">getStatus():</div>
        <pre id="status-pre" style="background:var(--bg-tertiary);padding:8px;border-radius:6px;margin:0 0 12px 0;white-space:pre-wrap;word-break:break-all;"></pre>
        <div style="color:var(--accent-blue);margin-bottom:4px;">getLastReading():</div>
        <pre id="reading-pre" style="background:var(--bg-tertiary);padding:8px;border-radius:6px;margin:0 0 12px 0;white-space:pre-wrap;word-break:break-all;"></pre>
        <div style="color:var(--text-muted);">VIN from config: ${config.vin || '(not set)'}</div>
      </div>`;

    const btn = container.querySelector('#poll-btn');
    const statusPre = container.querySelector('#status-pre');
    const readingPre = container.querySelector('#reading-pre');

    btn.addEventListener('click', refresh);
    await refresh();
  }
});