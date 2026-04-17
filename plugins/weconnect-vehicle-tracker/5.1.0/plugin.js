// @bump: minor
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
        <div style="
          display:flex; flex-direction:column; align-items:center;
          justify-content:center; height:100%; gap:12px;
          color:var(--text-secondary); font-family:sans-serif;
        ">
          <span style="font-size:2rem">🚗</span>
          <p style="margin:0; font-size:0.9rem; text-align:center">WeConnect Agent is not running.<br>Please install and start it first.</p>
        </div>`;
      return;
    }

    // Show loading state
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-family:sans-serif;">Loading vehicle data…</div>`;

    // Dump raw output from all three methods for diagnostics
    let lastReading, status;
    try { lastReading = await svc.getLastReading(); } catch(e) { lastReading = `ERROR: ${e.message}`; }
    try { status = await svc.getStatus(); } catch(e) { status = `ERROR: ${e.message}`; }

    container.innerHTML = `
      <div style="padding:16px; font-family:monospace; font-size:0.75rem; color:var(--text-primary); overflow:auto; height:100%; box-sizing:border-box;">
        <div style="color:var(--accent-green); margin-bottom:8px; font-size:0.85rem;">✅ Service connected!</div>

        <div style="color:var(--accent-blue); margin-bottom:4px;">getStatus():</div>
        <pre style="background:var(--bg-tertiary); padding:8px; border-radius:6px; margin:0 0 12px 0; white-space:pre-wrap; word-break:break-all;">${JSON.stringify(status, null, 2)}</pre>

        <div style="color:var(--accent-blue); margin-bottom:4px;">getLastReading():</div>
        <pre style="background:var(--bg-tertiary); padding:8px; border-radius:6px; margin:0 0 12px 0; white-space:pre-wrap; word-break:break-all;">${JSON.stringify(lastReading, null, 2)}</pre>

        <div style="color:var(--text-muted);">VIN from config: ${config.vin || '(not set)'}</div>
      </div>`;
  }
});