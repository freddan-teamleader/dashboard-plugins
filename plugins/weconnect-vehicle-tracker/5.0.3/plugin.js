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
        <div style="
          display:flex; flex-direction:column; align-items:center;
          justify-content:center; height:100%; gap:12px;
          color:var(--text-secondary); font-family:sans-serif;
        ">
          <span style="font-size:2rem">🚗</span>
          <p style="margin:0; font-size:0.9rem">WeConnect Agent is not running.<br>Please install and start it first.</p>
        </div>`;
      return;
    }

    // 🔍 Diagnostic: dump all keys on the service object
    const keys = Object.getOwnPropertyNames(svc)
      .concat(Object.getOwnPropertyNames(Object.getPrototypeOf(svc) || {}))
      .filter((k, i, a) => a.indexOf(k) === i);

    container.innerHTML = `
      <div style="padding:16px; font-family:monospace; font-size:0.8rem; color:var(--text-primary); overflow:auto; height:100%;">
        <div style="color:var(--accent-green); margin-bottom:8px;">✅ Service found! Available keys:</div>
        ${keys.map(k => `
          <div style="padding:3px 0; border-bottom:1px solid var(--border);">
            <span style="color:var(--accent-blue)">${k}</span>
            <span style="color:var(--text-muted)"> — ${typeof svc[k]}</span>
          </div>`).join('')}
        <div style="margin-top:12px; color:var(--text-muted);">VIN from config: ${config.vin || '(not set)'}</div>
      </div>`;
  }
});