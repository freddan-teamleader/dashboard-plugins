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

    container.innerHTML = `
      <div style="padding:16px; font-family:sans-serif; color:var(--text-primary)">
        <p style="color:var(--text-secondary)">Connecting to WeConnect Agent…</p>
      </div>`;

    try {
      const data = await svc.getVehicleData(config.vin);

      if (!data) {
        container.innerHTML = `
          <div style="padding:16px; font-family:sans-serif; color:var(--text-secondary)">
            No vehicle data found. Check your VIN in settings.
          </div>`;
        return;
      }

      const km = data.odometer ?? data.mileage ?? "—";
      const battery = data.batteryLevel ?? data.soc ?? null;
      const range = data.range ?? data.electricRange ?? "—";
      const charging = data.charging ?? data.isCharging ?? false;
      const locked = data.locked ?? data.doorLocked ?? null;

      container.innerHTML = `
        <div style="padding:16px; font-family:sans-serif; display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:1.5rem">🚗</span>
            <div>
              <div style="font-size:1rem; font-weight:600; color:var(--text-primary)">${data.name ?? data.vin ?? config.vin ?? "Your Vehicle"}</div>
              <div style="font-size:0.75rem; color:var(--text-muted)">${data.model ?? ""}</div>
            </div>
            ${locked !== null ? `<span style="margin-left:auto; font-size:1.2rem">${locked ? "🔒" : "🔓"}</span>` : ""}
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div style="background:var(--bg-tertiary); border-radius:8px; padding:12px;">
              <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:.05em">Odometer</div>
              <div style="font-size:1.2rem; font-weight:600; color:var(--text-primary); margin-top:4px">${km} ${config.unit}</div>
            </div>
            <div style="background:var(--bg-tertiary); border-radius:8px; padding:12px;">
              <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:.05em">Range</div>
              <div style="font-size:1.2rem; font-weight:600; color:var(--text-primary); margin-top:4px">${range} ${config.unit}</div>
            </div>
            ${battery !== null ? `
            <div style="background:var(--bg-tertiary); border-radius:8px; padding:12px; grid-column: span 2;">
              <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:.05em">Battery ${charging ? "⚡ Charging" : ""}</div>
              <div style="margin-top:6px; background:var(--bg-secondary); border-radius:4px; height:8px; overflow:hidden;">
                <div style="height:100%; width:${battery}%; background:${battery > 20 ? "var(--accent-green)" : "var(--accent-red)"}; border-radius:4px; transition:width .4s;"></div>
              </div>
              <div style="font-size:1rem; font-weight:600; color:var(--text-primary); margin-top:4px">${battery}%</div>
            </div>` : ""}
          </div>

          <div style="font-size:0.7rem; color:var(--text-muted); text-align:right">
            Updated: ${new Date().toLocaleTimeString()}
          </div>
        </div>`;
    } catch (err) {
      container.innerHTML = `
        <div style="padding:16px; color:var(--accent-red); font-family:sans-serif; font-size:0.85rem">
          ⚠️ Error: ${err.message}
        </div>`;
    }
  }
});