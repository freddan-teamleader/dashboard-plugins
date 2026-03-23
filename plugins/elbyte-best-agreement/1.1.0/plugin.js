api.registerWidget({
  type: "el-avtal-jamforelse",
  title: "Elbyte – Bästa avtalet",
  description: "Jämför elavtal baserat på din förbrukning och postnummer",
  height: 600,
  defaultConfig: { postNummer: "38695" },
  hiddenConfig: { forbrukning: null, currentAvtalId: null, currentLeverantorId: null },

  render: async function(container, config) {
    const forbrukning = config.forbrukning || null;
    const currentAvtalId = config.currentAvtalId || null;
    const currentLeverantorId = config.currentLeverantorId || null;

    const s = {
      wrap: `font-family:sans-serif;padding:12px;background:#0f172a;color:#e2e8f0;height:100%;box-sizing:border-box;overflow-y:auto;`,
      row: `display:flex;gap:8px;align-items:center;margin-bottom:10px;`,
      input: `background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:6px 10px;border-radius:6px;font-size:13px;width:110px;`,
      select: `background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:6px 10px;border-radius:6px;font-size:13px;flex:1;`,
      btn: `background:#334155;border:none;color:#e2e8f0;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap;`,
      btnGreen: `background:#166534;border:none;color:#4ade80;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;`,
      label: `font-size:12px;color:#94a3b8;margin-bottom:3px;`,
      info: `font-size:12px;color:#94a3b8;margin-bottom:8px;`,
      table: `width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;`,
      th: `text-align:left;padding:6px 8px;border-bottom:1px solid #1e293b;color:#94a3b8;font-weight:600;`,
      td: `padding:6px 8px;border-bottom:1px solid #1e293b;vertical-align:middle;`,
    };

    container.innerHTML = `<div id="root" style="${s.wrap}"></div>`;
    const root = container.querySelector('#root');

    function buildUI(agreements, suppliers) {
      const selectedLev = currentLeverantorId
        ? suppliers.find(s => s.id === currentLeverantorId)
        : suppliers.find(s => s.name.toLowerCase().includes('tibber')) || suppliers[0];

      const selectedLevId = selectedLev ? selectedLev.id : (suppliers[0] ? suppliers[0].id : null);

      const myAgreements = agreements.filter(a => a.ElLeverantorId === selectedLevId);
      const selectedAvtal = currentAvtalId
        ? myAgreements.find(a => a.AvtalId === currentAvtalId)
        : myAgreements[0];
      const selectedAvtalId = selectedAvtal ? selectedAvtal.AvtalId : (myAgreements[0] ? myAgreements[0].AvtalId : null);
      const myPrice = selectedAvtal ? selectedAvtal.AvtalJamforPris : null;

      root.innerHTML = `
        <div style="${s.row}">
          <div>
            <div style="${s.label}">Postnummer</div>
            <input id="zip" style="${s.input}" value="${config.postNummer || ''}" placeholder="38695"/>
          </div>
          <div style="flex:1">
            <div style="${s.label}">CSV-fil</div>
            <div style="${s.row};margin-bottom:0">
              <input type="file" id="csvFile" accept=".csv" style="display:none"/>
              <button id="csvBtn" style="${s.btn}">📂 Ladda CSV</button>
              <span id="csvStatus" style="font-size:12px;color:#94a3b8">${forbrukning ? `✅ ${Math.round(forbrukning).toLocaleString('sv')} kWh/år` : 'Ingen fil laddad'}</span>
            </div>
          </div>
        </div>

        ${agreements.length > 0 ? `
        <div style="${s.label}">Din nuvarande leverantör</div>
        <div style="${s.row}">
          <select id="leverantor" style="${s.select}">
            ${suppliers.map(s => `<option value="${s.id}" ${s.id === selectedLevId ? 'selected' : ''}>${s.name}</option>`).join('')}
          </select>
        </div>
        <div style="${s.label}">Ditt nuvarande avtal</div>
        <div style="${s.row}">
          <select id="avtal" style="${s.select}">
            ${myAgreements.map(a => `<option value="${a.AvtalId}" ${a.AvtalId === selectedAvtalId ? 'selected' : ''}>${a.AvtalBenamning}</option>`).join('')}
          </select>
        </div>
        ` : ''}

        <div style="${s.row}">
          <button id="fetchBtn" style="${s.btnGreen}">🔍 Sök avtal</button>
          ${myPrice ? `<span style="font-size:12px;color:#94a3b8">Ditt pris: <strong style="color:#f97316">${Math.round(myPrice).toLocaleString('sv')} kr/år</strong></span>` : ''}
        </div>

        <div id="status" style="${s.info}"></div>
        <div id="results"></div>
      `;

      // CSV file picker
      const csvBtn = root.querySelector('#csvBtn');
      const csvFile = root.querySelector('#csvFile');
      const csvStatus = root.querySelector('#csvStatus');
      csvBtn.onclick = () => csvFile.click();
      csvFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const text = ev.target.result;
          const parsed = parseCSV(text);
          if (parsed !== null) {
            csvStatus.textContent = `✅ ${Math.round(parsed).toLocaleString('sv')} kWh/år`;
            api.updateConfig({ forbrukning: parsed });
          } else {
            csvStatus.textContent = '❌ Kunde inte läsa CSV';
          }
        };
        reader.readAsText(file, 'utf-8');
      };

      // Zip input save
      root.querySelector('#zip').onchange = (e) => {
        api.updateConfig({ postNummer: e.target.value.trim() });
      };

      // Leverantör dropdown → update avtal dropdown
      if (agreements.length > 0) {
        root.querySelector('#leverantor').onchange = (e) => {
          const levId = parseInt(e.target.value);
          api.updateConfig({ currentLeverantorId: levId, currentAvtalId: null });
        };
        root.querySelector('#avtal').onchange = (e) => {
          api.updateConfig({ currentAvtalId: parseInt(e.target.value) });
        };
      }

      // Fetch button
      root.querySelector('#fetchBtn').onclick = async () => {
        const zip = root.querySelector('#zip').value.trim();
        const forb = config.forbrukning || forbrukning || 10000;
        if (!zip) { root.querySelector('#status').textContent = 'Ange postnummer!'; return; }
        api.updateConfig({ postNummer: zip });
        root.querySelector('#status').textContent = '⏳ Hämtar avtal…';
        root.querySelector('#results').innerHTML = '';
        try {
          const url = `https://www1.ei.se/elinservices/api/json/SokAvtal?postNummer=${zip}&forbrukning=${Math.round(forb)}`;
          const res = await api.fetch(url);
          const data = await res.json();
          root.querySelector('#status').textContent = `${data.length} avtal hittade`;
          renderResults(data, myPrice, selectedAvtalId);
          // rebuild supplier list
          const newSuppliers = buildSupplierList(data);
          api.updateConfig({ _agreements: null }); // trigger re-render via fetch
          showResults(data, newSuppliers, myPrice, selectedAvtalId);
        } catch(err) {
          root.querySelector('#status').textContent = `❌ Fel: ${err.message}`;
        }
      };

      if (agreements.length > 0 && myPrice !== null) {
        renderResults(agreements, myPrice, selectedAvtalId);
      }
    }

    function showResults(agreements, suppliers, myPrice, myAvtalId) {
      const resultsEl = root.querySelector('#results');
      if (!resultsEl) return;
      renderResultsInto(resultsEl, agreements, myPrice, myAvtalId);
      // rebuild dropdowns
      const levSel = root.querySelector('#leverantor');
      const avtalSel = root.querySelector('#avtal');
      if (!levSel) return;
      const selectedLevId = parseInt(levSel.value);
      // repopulate supplier dropdown
      levSel.innerHTML = suppliers.map(s => `<option value="${s.id}" ${s.id === selectedLevId ? 'selected' : ''}>${s.name}</option>`).join('');
      const myAgreements = agreements.filter(a => a.ElLeverantorId === selectedLevId);
      avtalSel.innerHTML = myAgreements.map(a => `<option value="${a.AvtalId}" ${a.AvtalId === myAvtalId ? 'selected' : ''}>${a.AvtalBenamning}</option>`).join('');
    }

    function renderResults(agreements, myPrice, myAvtalId) {
      const el = root.querySelector('#results');
      if (!el) return;
      renderResultsInto(el, agreements, myPrice, myAvtalId);
    }

    function renderResultsInto(el, agreements, myPrice, myAvtalId) {
      const sorted = [...agreements].sort((a, b) => a.AvtalJamforPris - b.AvtalJamforPris);
      const medals = ['🥇','🥈','🥉'];

      const rows = sorted.map((a, i) => {
        const isMine = a.AvtalId === myAvtalId;
        const saving = myPrice !== null ? Math.round(myPrice - a.AvtalJamforPris) : null;
        const savingColor = saving > 0 ? '#4ade80' : saving < 0 ? '#ff6b6b' : '#94a3b8';
        const savingText = saving !== null
          ? (saving > 0 ? `+${saving.toLocaleString('sv')} kr/år` : saving < 0 ? `${saving.toLocaleString('sv')} kr/år` : '±0 kr/år')
          : '–';
        const bg = isMine ? '#1e293b' : i === 0 ? 'rgba(74,222,128,0.07)' : 'transparent';
        const sources = [
          a.Sol ? '☀️' : '', a.Vind ? '💨' : '', a.Vatten ? '💧' : '',
          a.Bio ? '🌿' : '', a.Karnkraft ? '⚛️' : ''
        ].filter(Boolean).join('');

        const typMap = { 1: 'Fast pris', 2: 'Rörligt pris', 3: 'Mixpris', 4: 'Timpris', 5: 'Fast pris lång' };
        const typ = typMap[a.AvtalTypId] || `Typ ${a.AvtalTypId}`;

        return `<tr style="background:${bg}">
          <td style="${s.td}font-weight:bold">${medals[i] || (i+1)+'.'} ${isMine ? '👤' : ''}</td>
          <td style="${s.td}">${a.ElLeverantorNamn}</td>
          <td style="${s.td}">${a.AvtalBenamning}</td>
          <td style="${s.td}color:#94a3b8">${typ}</td>
          <td style="${s.td}font-size:11px">${sources}</td>
          <td style="${s.td}text-align:right;color:#60a5fa">${Math.round(a.AvtalJamforPris).toLocaleString('sv')} kr</td>
          <td style="${s.td}text-align:right;color:${savingColor};font-weight:${isMine?'normal':'600'}">${isMine ? '← ditt avtal' : savingText}</td>
        </tr>`;
      }).join('');

      el.innerHTML = `
        <table style="${s.table}">
          <thead><tr>
            <th style="${s.th}">#</th>
            <th style="${s.th}">Leverantör</th>
            <th style="${s.th}">Avtal</th>
            <th style="${s.th}">Typ</th>
            <th style="${s.th}">Källa</th>
            <th style="${s.th}text-align:right">Kr/år</th>
            <th style="${s.th}text-align:right">Besparing</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="font-size:11px;color:#475569;margin-top:6px">
          Jämförpris inkl. rörliga kostnader, påslag och årsavgift för ${Math.round(config.forbrukning || 10000).toLocaleString('sv')} kWh/år.
          Källa: Energimarknadsinspektionen
        </div>`;
    }

    function buildSupplierList(agreements) {
      const map = {};
      agreements.forEach(a => { map[a.ElLeverantorId] = a.ElLeverantorNamn; });
      return Object.entries(map).map(([id, name]) => ({ id: parseInt(id), name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    }

    function parseCSV(text) {
      try {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        let dataStart = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('Starttidpunkt;Sluttidpunkt;Energiriktning')) { dataStart = i + 1; break; }
        }
        if (dataStart === -1) return null;
        let total = 0, count = 0;
        let minTime = Infinity, maxTime = -Infinity;
        const dataLines = lines.slice(dataStart);
        dataLines.forEach(line => {
          const parts = line.split(';');
          if (parts.length < 5) return;
          const dir = parts[2].trim();
          if (dir !== 'Förbrukning') return;
          const qty = parseFloat(parts[4].replace(',', '.'));
          if (isNaN(qty)) return;
          const startStr = parts[0].trim();
          const t = new Date(startStr.replace(' ', 'T')).getTime();
          if (!isNaN(t)) { minTime = Math.min(minTime, t); maxTime = Math.max(maxTime, t); }
          total += qty;
          count++;
        });
        if (count === 0) return null;
        // extrapolate to yearly
        const spanHours = (maxTime - minTime) / 3600000 || (count * 0.25);
        const hoursPerYear = 8760;
        const yearly = total * (hoursPerYear / Math.max(spanHours, 1));
        return Math.round(yearly);
      } catch(e) { return null; }
    }

    // Initial load — try to fetch if we have zip + consumption
    if (config.postNummer && config.forbrukning) {
      try {
        const url = `https://www1.ei.se/elinservices/api/json/SokAvtal?postNummer=${config.postNummer}&forbrukning=${Math.round(config.forbrukning)}`;
        const res = await api.fetch(url);
        const data = await res.json();
        const suppliers = buildSupplierList(data);
        buildUI(data, suppliers);
      } catch(e) {
        buildUI([], []);
      }
    } else {
      buildUI([], []);
    }

    container.__cleanup__ = () => { container.innerHTML = ''; };
  }
});