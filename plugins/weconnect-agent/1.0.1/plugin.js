// @bump: patch
api.registerService({
  type: 'weconnect-agent',
  events: {
    'reading:new': {
      description: 'New odometer + battery/fuel reading fetched from WeConnect',
      schema: { vin: 'string', odometer: 'number', level: 'number', levelType: 'string', timestamp: 'string' }
    },
    'auth:error': {
      description: 'Authentication or fetch failure',
      schema: { message: 'string' }
    },
    'status:change': {
      description: 'Agent status changed (idle, polling, error)',
      schema: { status: 'string', message: 'string' }
    }
  },

  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30
  },

  create() {
    // ── Config accessor — read lazily so updates are picked up ───────────────
    // api.config is populated by the plugin loader from defaultConfig + stored config
    const cfg = () => api.config || {};

    // ── Constants ────────────────────────────────────────────────────────────
    const CLIENT_ID    = '9496060d-ea5b-4b1e-84f3-7cd67e8d6a5b@apps_vw-dilab_com';
    const REDIRECT_URI = 'weconnect://authenticated';
    const AUTH_BASE    = 'https://identity.vwgroup.io';
    const API_BASE     = 'https://mobileapi.apps.emea.vwapps.io';
    const TOKEN_URL    = `${AUTH_BASE}/oidc/v1/token`;

    // ── In-memory state ──────────────────────────────────────────────────────
    let accessToken = null;
    let refreshToken = null;
    let tokenExpiry  = 0;
    let pollTimer    = null;
    let lastReading  = null;
    let agentStatus  = 'idle';

    function emit(event, data) { api.emit(`weconnect-agent:${event}`, data); }
    function setStatus(status, message = '') {
      agentStatus = status;
      emit('status:change', { status, message });
    }

    // ── Auth helpers ─────────────────────────────────────────────────────────
    async function getAuthCode() {
      const authUrl = `${AUTH_BASE}/oidc/v1/authorize?` + new URLSearchParams({
        response_type: 'code',
        client_id:     CLIENT_ID,
        redirect_uri:  REDIRECT_URI,
        scope:         'openid profile address email phone mbb offline_access',
        state:         crypto.randomUUID(),
        nonce:         crypto.randomUUID(),
        prompt:        'login'
      });
      const r1 = await api.fetch(authUrl, { redirect: 'follow' });
      if (!r1.ok) throw new Error(`Auth page failed: ${r1.status}`);
      const html1 = await r1.text();

      const actionMatch = html1.match(/action="([^"]+)"/);
      const csrfMatch   = html1.match(/name="_csrf"\s+value="([^"]+)"/);
      const relayMatch  = html1.match(/name="relayState"\s+value="([^"]+)"/);
      const hmacMatch   = html1.match(/name="hmac"\s+value="([^"]+)"/);
      if (!actionMatch) throw new Error('Could not parse WeConnect login form');

      const loginAction = actionMatch[1].startsWith('http')
        ? actionMatch[1]
        : `${AUTH_BASE}${actionMatch[1]}`;

      const body = new URLSearchParams({
        email:    cfg().email    || '',
        password: cfg().password || '',
        ...(csrfMatch  ? { _csrf:      csrfMatch[1]  } : {}),
        ...(relayMatch ? { relayState: relayMatch[1] } : {}),
        ...(hmacMatch  ? { hmac:       hmacMatch[1]  } : {})
      });

      const r2 = await api.fetch(loginAction, {
        method:   'POST',
        headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:     body.toString(),
        redirect: 'manual'
      });

      let location = r2.headers?.get?.('location') || r2.headers?.location;
      let code = null;
      let hops = 0;
      while (location && hops++ < 10) {
        if (location.startsWith('weconnect://')) {
          const u = new URL(location.replace('weconnect://', 'https://weconnect'));
          code = u.searchParams.get('code');
          break;
        }
        const rN = await api.fetch(
          location.startsWith('http') ? location : `${AUTH_BASE}${location}`,
          { redirect: 'manual' }
        );
        location = rN.headers?.get?.('location') || rN.headers?.location;
      }
      if (!code) throw new Error('Could not extract auth code — check credentials');
      return code;
    }

    async function fetchTokens(code) {
      const res = await api.fetch(TOKEN_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:   'authorization_code',
          code,
          client_id:    CLIENT_ID,
          redirect_uri: REDIRECT_URI
        }).toString()
      });
      if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
      const data = await res.json();
      accessToken  = data.access_token;
      refreshToken = data.refresh_token;
      tokenExpiry  = Date.now() + (data.expires_in - 60) * 1000;
    }

    async function doRefreshToken() {
      const res = await api.fetch(TOKEN_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: refreshToken,
          client_id:     CLIENT_ID
        }).toString()
      });
      if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
      const data = await res.json();
      accessToken  = data.access_token;
      refreshToken = data.refresh_token || refreshToken;
      tokenExpiry  = Date.now() + (data.expires_in - 60) * 1000;
    }

    async function ensureToken() {
      if (accessToken && Date.now() < tokenExpiry) return;
      if (refreshToken) {
        try { await doRefreshToken(); return; } catch (_) {}
      }
      const code = await getAuthCode();
      await fetchTokens(code);
    }

    // ── Vehicle data fetch ───────────────────────────────────────────────────
    async function resolveVin() {
      const vinCfg = cfg().vin;
      if (vinCfg) return vinCfg;
      const r = await api.fetch(`${API_BASE}/vehicles`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
      });
      if (!r.ok) throw new Error(`Vehicles list failed: ${r.status}`);
      const data = await r.json();
      const vehicles = data.data || data.vehicles || data;
      if (!Array.isArray(vehicles) || vehicles.length === 0) throw new Error('No vehicles found');
      return vehicles[0].vin || vehicles[0].id;
    }

    async function fetchReading() {
      await ensureToken();
      const vin = await resolveVin();

      let odometer = null;
      try {
        const r = await api.fetch(`${API_BASE}/vehicles/${vin}/measurements/odometers`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
        });
        if (r.ok) {
          const d = await r.json();
          const m = d.data?.[0] || d.measurements?.[0] || d;
          odometer = m?.odometer?.currentOdometer?.value ?? m?.currentOdometer?.value ?? m?.value ?? null;
        }
      } catch (_) {}

      let level = null, levelType = 'soc';
      try {
        const r = await api.fetch(`${API_BASE}/vehicles/${vin}/measurements/fuellevels`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
        });
        if (r.ok) {
          const d = await r.json();
          const m = d.data?.[0] || d.measurements?.[0] || d;
          level     = m?.batteryStatus?.currentSOC_pct ?? m?.currentSOC_pct ?? m?.fuelLevel?.value ?? null;
          levelType = (level !== null && (m?.batteryStatus || m?.currentSOC_pct !== undefined)) ? 'soc' : 'fuel';
        }
      } catch (_) {}

      const reading = {
        vin,
        odometer: odometer !== null ? Number(odometer) : null,
        level:    level    !== null ? Number(level)    : null,
        levelType,
        timestamp: new Date().toISOString()
      };

      try {
        await api.db.insert({
          vin,
          odometer:    reading.odometer,
          level:       reading.level,
          level_type:  levelType,
          recorded_at: reading.timestamp
        });
      } catch (e) { console.warn('[weconnect-agent] db.insert failed:', e.message); }

      lastReading = reading;
      emit('reading:new', reading);
      setStatus('idle', `Last poll: ${new Date().toLocaleTimeString()}`);
      return reading;
    }

    // ── Polling loop ─────────────────────────────────────────────────────────
    async function poll() {
      const { email, password } = cfg();
      if (!email || !password) {
        setStatus('error', 'Missing email/password — open Settings to configure');
        return;
      }
      try {
        setStatus('polling', 'Fetching vehicle data…');
        await fetchReading();
      } catch (err) {
        accessToken = null;
        setStatus('error', err.message);
        emit('auth:error', { message: err.message });
        console.error('[weconnect-agent]', err);
      }
    }

    // Defer first poll by 1 s so the loader finishes before network calls start
    setTimeout(poll, 1000);
    const intervalMs = Math.max((cfg().pollIntervalMinutes || 30), 5) * 60 * 1000;
    pollTimer = setInterval(poll, intervalMs);

    return {
      getLastReading: () => lastReading,
      getStatus:      () => agentStatus,
      pollNow:        () => poll(),
      destroy()       { clearInterval(pollTimer); }
    };
  }
});