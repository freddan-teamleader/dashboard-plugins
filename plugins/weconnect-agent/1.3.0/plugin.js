api.registerService({
  type: 'weconnect-agent',
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30
  },
  events: {
    'reading:new':    { description: 'New odometer + level reading', schema: { vin: 'string', odometer: 'number', level: 'number', levelType: 'string', timestamp: 'string' } },
    'status:change':  { description: 'Agent status update',          schema: { status: 'string', message: 'string' } },
  },
  create() {
    const CLIENT_ID   = 'a24fba63-34a3-4d54-a7f2-4f8db34d8927@apps_vw-dilab_com';
    const REDIRECT    = 'weconnect://authenticated';
    const SCOPE       = 'openid profile address email phone cars dealers mbb';

    let accessToken   = null;
    let refreshToken  = null;
    let tokenExpiry   = 0;
    let pollTimer     = null;
    let lastStatus    = { status: 'idle', message: 'Not started' };
    let lastReading   = null;

    function cfg() {
      const c = api.config || {};
      return {
        email:    c.email    || '',
        password: c.password || '',
        vin:      c.vin      || '',
        interval: Math.max(5, Number(c.pollIntervalMinutes) || 30)
      };
    }

    function setStatus(status, message) {
      lastStatus = { status, message };
      api.emit('weconnect-agent:status:change', { status, message });
      console.log(`[weconnect-agent] ${status}: ${message}`);
    }

    // ── Step 1: GET login page HTML, extract form fields ────────────────────
    async function getLoginForm() {
      const url = `https://identity.vwgroup.io/oidc/v1/authorize` +
        `?client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&scope=${encodeURIComponent(SCOPE)}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
        `&nonce=${Math.random().toString(36).slice(2)}` +
        `&state=${Math.random().toString(36).slice(2)}`;

      const res  = await api.fetch(url, { redirect: 'follow' });
      const html = await res.text();
      console.log('[weconnect-agent] authorize page status:', res.status, 'len:', html.length);

      // Extract hidden form fields
      const csrf       = (html.match(/name="_csrf"\s+value="([^"]+)"/)       || [])[1];
      const relayState = (html.match(/name="relayState"\s+value="([^"]+)"/)  || [])[1];
      const hmac       = (html.match(/name="hmac"\s+value="([^"]+)"/)        || [])[1];
      // Extract form action
      const action     = (html.match(/<form[^>]+action="([^"]+)"/)           || [])[1];

      console.log('[weconnect-agent] form fields — csrf:', !!csrf, 'relay:', !!relayState, 'hmac:', !!hmac, 'action:', action);

      if (!csrf || !relayState || !hmac) {
        throw new Error(`Login form parse failed. Got ${html.length} bytes. Fields: csrf=${!!csrf} relay=${!!relayState} hmac=${!!hmac}`);
      }
      return { csrf, relayState, hmac, action };
    }

    // ── Step 2: POST email only (VW does a two-step login) ──────────────────
    async function submitEmail(form, email) {
      const action = form.action || `https://identity.vwgroup.io/signin-service/v1/signin/${CLIENT_ID}`;
      const body   = new URLSearchParams({
        email,
        relayState: form.relayState,
        hmac:       form.hmac,
        _csrf:      form.csrf,
      });

      const res  = await api.fetch(action, {
        method:   'POST',
        headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:     body.toString(),
        redirect: 'follow'
      });
      const html = await res.text();
      console.log('[weconnect-agent] email step status:', res.status, 'len:', html.length);

      // Extract updated hmac/csrf for password step
      const hmac2  = (html.match(/name="hmac"\s+value="([^"]+)"/)        || [])[1];
      const csrf2  = (html.match(/name="_csrf"\s+value="([^"]+)"/)       || [])[1];
      const relay2 = (html.match(/name="relayState"\s+value="([^"]+)"/)  || [])[1];
      const userId = (html.match(/name="identifier"\s+value="([^"]+)"/)  ||
                      html.match(/\/signin-service\/v1\/[^/]+\/([^/]+)\/login\/identifier/) || [])[1];
      const pwdAction = (html.match(/<form[^>]+action="([^"]+)"/) || [])[1];

      console.log('[weconnect-agent] password form — hmac:', !!hmac2, 'action:', pwdAction);

      return { hmac: hmac2 || form.hmac, csrf: csrf2 || form.csrf, relayState: relay2 || form.relayState, userId, pwdAction };
    }

    // ── Step 3: POST password, capture auth code from redirect ─────────────
    async function submitPassword(emailResult, password) {
      const action = emailResult.pwdAction ||
        `https://identity.vwgroup.io/signin-service/v1/signin/${CLIENT_ID}`;

      const params = {
        password,
        relayState: emailResult.relayState,
        hmac:       emailResult.hmac,
        _csrf:      emailResult.csrf,
      };
      if (emailResult.userId) params.identifier = emailResult.userId;

      const res = await api.fetch(action, {
        method:   'POST',
        headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:     new URLSearchParams(params).toString(),
        redirect: 'manual'   // we want to catch the redirect ourselves
      });

      console.log('[weconnect-agent] password step status:', res.status);

      // The redirect URL contains ?code= or #code=
      const location = res.headers?.get?.('location') || res.url || '';
      console.log('[weconnect-agent] redirect location:', location.slice(0, 120));

      let code = (location.match(/[?&#]code=([^&]+)/) || [])[1];

      // If redirect didn't come back (proxy may auto-follow), try reading body
      if (!code) {
        const html = await res.text().catch(() => '');
        code = (html.match(/[?&#]code=([^&"]+)/) || [])[1];
        // Also check for JS redirect
        const jsLoc = (html.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/) || [])[1];
        if (!code && jsLoc) code = (jsLoc.match(/[?&#]code=([^&]+)/) || [])[1];
        console.log('[weconnect-agent] code from body:', !!code, 'body len:', html.length);
      }

      if (!code) throw new Error(`No auth code in redirect. Location: "${location.slice(0,200)}"`);
      return code;
    }

    // ── Step 4: Exchange code for tokens ────────────────────────────────────
    async function exchangeCode(code) {
      const res  = await api.fetch('https://identity.vwgroup.io/oidc/v1/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:   'authorization_code',
          code,
          redirect_uri:  REDIRECT,
          client_id:     CLIENT_ID,
        }).toString()
      });
      const data = await res.json();
      console.log('[weconnect-agent] token exchange status:', res.status, 'keys:', Object.keys(data));
      if (!data.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
      return data;
    }

    // ── Step 5: Refresh access token ─────────────────────────────────────── 
    async function refreshAccessToken() {
      const res  = await api.fetch('https://identity.vwgroup.io/oidc/v1/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: refreshToken,
          client_id:     CLIENT_ID,
        }).toString()
      });
      const data = await res.json();
      if (!data.access_token) throw new Error('Refresh failed: ' + JSON.stringify(data));
      accessToken  = data.access_token;
      refreshToken = data.refresh_token || refreshToken;
      tokenExpiry  = Date.now() + (data.expires_in || 3600) * 1000 - 60000;
      console.log('[weconnect-agent] token refreshed, expires in', data.expires_in, 's');
    }

    // ── Full auth flow ───────────────────────────────────────────────────────
    async function authenticate() {
      const { email, password } = cfg();
      if (!email || !password) throw new Error('Email and password not set in config');

      setStatus('polling', 'Authenticating…');
      const form        = await getLoginForm();
      const emailResult = await submitEmail(form, email);
      const code        = await submitPassword(emailResult, password);
      const tokens      = await exchangeCode(code);

      accessToken  = tokens.access_token;
      refreshToken = tokens.refresh_token;
      tokenExpiry  = Date.now() + (tokens.expires_in || 3600) * 1000 - 60000;
      console.log('[weconnect-agent] authenticated ✓');
    }

    // ── Ensure valid token ───────────────────────────────────────────────────
    async function ensureToken() {
      if (accessToken && Date.now() < tokenExpiry) return;
      if (refreshToken) {
        try { await refreshAccessToken(); return; } catch (e) {
          console.warn('[weconnect-agent] refresh failed, re-authenticating:', e.message);
        }
      }
      await authenticate();
    }

    // ── Fetch vehicles list ──────────────────────────────────────────────────
    async function getVehicles() {
      const res  = await api.fetch('https://mobileapi.apps.emea.vwapps.io/vehicles', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      console.log('[weconnect-agent] vehicles response:', JSON.stringify(data).slice(0, 300));
      return data.data || data.vehicles || data || [];
    }

    // ── Fetch vehicle status ─────────────────────────────────────────────────
    async function getVehicleStatus(vin) {
      // Try WeConnect API v1 first
      const urls = [
        `https://mobileapi.apps.emea.vwapps.io/vehicles/${vin}/selectivestatus?jobs=measurements,charging`,
        `https://mobileapi.apps.emea.vwapps.io/vehicles/${vin}/status`,
      ];
      for (const url of urls) {
        try {
          const res  = await api.fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
          if (!res.ok) continue;
          const data = await res.json();
          console.log('[weconnect-agent] status from', url.split('/').slice(-2).join('/'), ':', JSON.stringify(data).slice(0, 400));
          return data;
        } catch (e) { console.warn('[weconnect-agent] status endpoint failed:', e.message); }
      }
      throw new Error('All vehicle status endpoints failed');
    }

    // ── Parse odometer + level from API response ─────────────────────────────
    function parseReading(data, vin) {
      let odometer  = null;
      let level     = null;
      let levelType = 'soc';

      // measurements.mileageKm (selectivestatus)
      const m = data.measurements;
      if (m) {
        odometer = m.mileageInKm?.currentStaticValue
                || m.mileageKm?.currentStaticValue
                || m.odometer?.currentStaticValue
                || null;
      }

      // charging block (EV)
      const ch = data.charging || data.batteryStatus;
      if (ch) {
        level     = ch.batteryStatus?.value?.currentSOC_pct
                 ?? ch.currentSOC_pct
                 ?? ch.stateOfChargeInPercent
                 ?? null;
        levelType = 'soc';
      }

      // fuelStatus (ICE / PHEV)
      if (level == null) {
        const f = data.fuelStatus || data.fuelLevels;
        if (f) {
          level     = f.rangeStatus?.value?.primaryFuelRange?.currentFuelLevel_pct
                   ?? f.currentFuelLevel_pct
                   ?? f.fuelLevelInPercent
                   ?? null;
          levelType = 'fuel';
        }
      }

      // Flat structure fallback
      if (odometer == null) odometer = data.mileageKm ?? data.odometer ?? data.mileageInKm ?? null;
      if (level    == null) level    = data.currentSOC_pct ?? data.fuelLevelInPercent ?? null;

      console.log('[weconnect-agent] parsed — odo:', odometer, 'level:', level, 'type:', levelType);
      return { vin, odometer, level, levelType, timestamp: new Date().toISOString() };
    }

    // ── Main poll function ───────────────────────────────────────────────────
    async function poll() {
      const { vin } = cfg();
      try {
        setStatus('polling', 'Fetching vehicle data…');
        await ensureToken();

        let targetVin = vin;
        if (!targetVin) {
          const vehicles = await getVehicles();
          if (!vehicles.length) throw new Error('No vehicles found on account');
          targetVin = vehicles[0].vin || vehicles[0].id;
          console.log('[weconnect-agent] auto-detected VIN:', targetVin);
        }

        const statusData = await getVehicleStatus(targetVin);
        const reading    = parseReading(statusData, targetVin);
        lastReading      = reading;

        // Store in DB
        try {
          await api.db.insert({
            vin:         reading.vin,
            odometer:    reading.odometer,
            level:       reading.level,
            level_type:  reading.levelType,
            recorded_at: reading.timestamp
          });
          console.log('[weconnect-agent] reading stored in DB ✓');
        } catch (e) {
          console.warn('[weconnect-agent] DB insert failed:', e.message);
        }

        api.emit('weconnect-agent:reading:new', reading);
        setStatus('idle', `Updated ${new Date().toLocaleTimeString()}`);

      } catch (e) {
        console.error('[weconnect-agent] poll error:', e.message);
        setStatus('error', e.message);
      }
    }

    // ── Schedule polling ─────────────────────────────────────────────────────
    function schedulePoll() {
      if (pollTimer) clearInterval(pollTimer);
      const ms = cfg().interval * 60 * 1000;
      pollTimer = setInterval(poll, ms);
      console.log('[weconnect-agent] polling every', cfg().interval, 'min');
    }

    // Start after short delay to let loader settle
    setTimeout(() => {
      poll();
      schedulePoll();
    }, 2000);

    return {
      pollNow:   () => poll(),
      getStatus: () => ({ ...lastStatus }),
      getLastReading: () => lastReading,
    };
  }
});