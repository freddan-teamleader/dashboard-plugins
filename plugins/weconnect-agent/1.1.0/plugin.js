// @bump: minor
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
    const cfg = () => api.config || {};

    const CLIENT_ID    = '9496060d-ea5b-4b1e-84f3-7cd67e8d6a5b@apps_vw-dilab_com';
    const REDIRECT_URI = 'weconnect://authenticated';
    const AUTH_BASE    = 'https://identity.vwgroup.io';
    const API_BASE     = 'https://mobileapi.apps.emea.vwapps.io';
    const TOKEN_URL    = `${AUTH_BASE}/oidc/v1/token`;

    let accessToken  = null;
    let refreshToken = null;
    let tokenExpiry  = 0;
    let pollTimer    = null;
    let lastReading  = null;
    let agentStatus  = 'idle';
    let lastError    = null;

    function emit(event, data) { api.emit(`weconnect-agent:${event}`, data); }
    function setStatus(status, message = '') {
      agentStatus = status;
      lastError   = status === 'error' ? message : lastError;
      emit('status:change', { status, message });
      console.log(`[weconnect-agent] ${status}: ${message}`);
    }

    // ── Auth: Step 1 — get the sign-in page and extract form fields ──────────
    async function getAuthCode() {
      // Step 1: Hit the authorize endpoint to get redirected to the login page
      const authorizeUrl = `${AUTH_BASE}/oidc/v1/authorize?` + new URLSearchParams({
        response_type: 'code',
        client_id:     CLIENT_ID,
        redirect_uri:  REDIRECT_URI,
        scope:         'openid profile address email phone mbb offline_access',
        state:         crypto.randomUUID(),
        nonce:         crypto.randomUUID(),
        prompt:        'login'
      });

      console.log('[weconnect-agent] Fetching authorize page…');
      const r1 = await api.fetch(authorizeUrl, { redirect: 'follow' });
      const html1 = await r1.text();
      console.log('[weconnect-agent] Auth page status:', r1.status, '— HTML length:', html1.length);

      if (html1.length < 100) throw new Error(`Auth page too short (${r1.status}): ${html1.slice(0,200)}`);

      // Parse the login form action and hidden fields
      const actionMatch = html1.match(/action="([^"]+)"/);
      const csrfMatch   = html1.match(/name="_csrf"\s+value="([^"]+)"/);
      const relayMatch  = html1.match(/name="relayState"\s+value="([^"]+)"/);
      const hmacMatch   = html1.match(/name="hmac"\s+value="([^"]+)"/);

      if (!actionMatch) {
        console.error('[weconnect-agent] Could not find form action in HTML:', html1.slice(0, 500));
        throw new Error('Could not parse WeConnect login form — check console for HTML');
      }

      const loginAction = actionMatch[1].startsWith('http')
        ? actionMatch[1]
        : `${AUTH_BASE}${actionMatch[1]}`;

      console.log('[weconnect-agent] Login action URL:', loginAction);
      console.log('[weconnect-agent] CSRF:', csrfMatch?.[1], 'relay:', relayMatch?.[1], 'hmac:', hmacMatch?.[1]);

      const body = new URLSearchParams({
        email:    cfg().email    || '',
        password: cfg().password || '',
        ...(csrfMatch  ? { _csrf:      csrfMatch[1]  } : {}),
        ...(relayMatch ? { relayState: relayMatch[1] } : {}),
        ...(hmacMatch  ? { hmac:       hmacMatch[1]  } : {})
      });

      // Step 2: POST credentials
      console.log('[weconnect-agent] POSTing credentials to login form…');
      const r2 = await api.fetch(loginAction, {
        method:   'POST',
        headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:     body.toString(),
        redirect: 'manual'
      });

      console.log('[weconnect-agent] Login POST status:', r2.status);
      let location = r2.headers?.get?.('location') || r2.headers?.location;
      console.log('[weconnect-agent] Location header:', location);

      // Step 3: Follow redirects until weconnect:// URI
      let code = null;
      let hops = 0;
      while (location && hops++ < 10) {
        console.log(`[weconnect-agent] Redirect hop ${hops}: ${location}`);
        if (location.startsWith('weconnect://')) {
          const u = new URL(location.replace('weconnect://', 'https://weconnect/'));
          code = u.searchParams.get('code');
          console.log('[weconnect-agent] Got auth code:', code?.slice(0, 10) + '…');
          break;
        }
        const nextUrl = location.startsWith('http') ? location : `${AUTH_BASE}${location}`;
        const rN = await api.fetch(nextUrl, { redirect: 'manual' });
        console.log(`[weconnect-agent] Hop ${hops} status:`, rN.status);
        location = rN.headers?.get?.('location') || rN.headers?.location;
      }

      if (!code) throw new Error('Could not extract auth code — wrong credentials or VW changed their login flow. Check browser console.');
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
      const text = await res.text();
      console.log('[weconnect-agent] Token exchange status:', res.status, text.slice(0, 200));
      if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 200)}`);
      const data = JSON.parse(text);
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
      console.log('[weconnect-agent] Token refreshed successfully');
    }

    async function ensureToken() {
      if (accessToken && Date.now() < tokenExpiry) return;
      if (refreshToken) {
        try { await doRefreshToken(); return; } catch (e) {
          console.warn('[weconnect-agent] Refresh failed, re-authenticating:', e.message);
        }
      }
      const code = await getAuthCode();
      await fetchTokens(code);
    }

    async function resolveVin() {
      const vinCfg = cfg().vin?.trim();
      if (vinCfg) return vinCfg;
      const r = await api.fetch(`${API_BASE}/vehicles`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
      });
      const text = await r.text();
      console.log('[weconnect-agent] Vehicles response:', r.status, text.slice(0, 300));
      if (!r.ok) throw new Error(`Vehicles list failed (${r.status}): ${text.slice(0,200)}`);
      const data = JSON.parse(text);
      const vehicles = data.data || data.vehicles || (Array.isArray(data) ? data : []);
      if (!vehicles.length) throw new Error('No vehicles found in account');
      const vin = vehicles[0].vin || vehicles[0].id;
      console.log('[weconnect-agent] Auto-detected VIN:', vin);
      return vin;
    }

    async function fetchReading() {
      await ensureToken();
      const vin = await resolveVin();

      let odometer = null;
      try {
        const r = await api.fetch(`${API_BASE}/vehicles/${vin}/measurements/odometers`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
        });
        const text = await r.text();
        console.log('[weconnect-agent] Odometer response:', r.status, text.slice(0, 300));
        if (r.ok) {
          const d = JSON.parse(text);
          const m = d.data?.[0] || d.measurements?.[0] || d;
          odometer = m?.odometer?.currentOdometer?.value
                  ?? m?.currentOdometer?.value
                  ?? m?.value
                  ?? null;
        }
      } catch (e) { console.warn('[weconnect-agent] Odometer fetch failed:', e.message); }

      let level = null, levelType = 'soc';
      try {
        const r = await api.fetch(`${API_BASE}/vehicles/${vin}/measurements/fuellevels`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
        });
        const text = await r.text();
        console.log('[weconnect-agent] Fuel/SOC response:', r.status, text.slice(0, 300));
        if (r.ok) {
          const d = JSON.parse(text);
          const m = d.data?.[0] || d.measurements?.[0] || d;
          level     = m?.batteryStatus?.currentSOC_pct
                   ?? m?.currentSOC_pct
                   ?? m?.fuelLevel?.value
                   ?? null;
          levelType = (m?.batteryStatus || m?.currentSOC_pct !== undefined) ? 'soc' : 'fuel';
        }
      } catch (e) { console.warn('[weconnect-agent] Fuel/SOC fetch failed:', e.message); }

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
        console.log('[weconnect-agent] Reading stored in DB:', reading);
      } catch (e) { console.warn('[weconnect-agent] db.insert failed:', e.message); }

      lastReading = reading;
      emit('reading:new', reading);
      setStatus('idle', `Last poll: ${new Date().toLocaleTimeString()}`);
      return reading;
    }

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
        console.error('[weconnect-agent] Poll error:', err);
      }
    }

    setTimeout(poll, 1000);
    const intervalMs = Math.max((cfg().pollIntervalMinutes || 30), 5) * 60 * 1000;
    pollTimer = setInterval(poll, intervalMs);

    return {
      getLastReading: () => lastReading,
      getStatus:      () => ({ status: agentStatus, lastError }),
      pollNow:        () => poll(),
      destroy()       { clearInterval(pollTimer); }
    };
  }
});