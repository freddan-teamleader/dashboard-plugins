// @bump: patch
api.registerService({
  type: 'weconnect-agent',
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30
  },
  hiddenConfig: {
    accessToken: null,
    refreshToken: null,
    tokenExpiry: null,
    vin: null
  },

  events: {
    'reading:new': {
      description: 'New vehicle reading (odometer + level)',
      schema: { vin: 'string', odometer: 'number', level: 'number', level_type: 'string', recorded_at: 'string' }
    },
    'auth:error': {
      description: 'Authentication failed',
      schema: { message: 'string' }
    }
  },

  create(config) {
    const CLIENT_ID    = 'a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com'
    const REDIRECT_URI = 'weconnect://authenticated'
    const AUTH_BASE    = 'https://identity.vwgroup.io'
    const API_BASE     = 'https://mobileapi.apps.emea.vwapps.io'

    let _token    = config.accessToken  || null
    let _refresh  = config.refreshToken || null
    let _expiry   = config.tokenExpiry  ? new Date(config.tokenExpiry) : null
    let _vin      = config.vin          || null
    let _timer    = null

    // ── helpers ──────────────────────────────────────────────────────────────
    function parseFormAction(html) {
      const m = html.match(/action="([^"]+)"/)
      return m ? m[1].replace(/&amp;/g, '&') : null
    }
    function parseMeta(html, name) {
      const m = html.match(new RegExp(`name="${name}"[^>]*value="([^"]+)"`))
      return m ? m[1] : null
    }
    function extractCode(location) {
      const m = location.match(/[?&]code=([^&]+)/)
      return m ? m[1] : null
    }

    // ── auth ─────────────────────────────────────────────────────────────────
    async function authenticate() {
      if (!config.email || !config.password) throw new Error('No credentials configured')

      // 1. Start authorize flow
      const authUrl = `${AUTH_BASE}/oidc/v1/authorize?` + new URLSearchParams({
        response_type: 'code',
        client_id:     CLIENT_ID,
        redirect_uri:  REDIRECT_URI,
        scope:         'openid profile address cars email birthdate badge mbb',
        state:         Math.random().toString(36).slice(2),
        nonce:         Math.random().toString(36).slice(2),
        prompt:        'login',
        ui_locales:    'en'
      })

      const r1   = await api.fetch(authUrl)
      const html1 = await r1.text()
      const loginAction = parseFormAction(html1)
      if (!loginAction) throw new Error('Could not parse login form')

      const csrf  = parseMeta(html1, '_csrf')
      const relay = parseMeta(html1, 'relayState') || parseMeta(html1, 'relay_state')
      const hmac  = parseMeta(html1, 'hmac')

      // 2. POST email
      const emailUrl = loginAction.startsWith('http') ? loginAction : AUTH_BASE + loginAction
      const body1 = new URLSearchParams({ email: config.email, _csrf: csrf || '', relayState: relay || '', hmac: hmac || '' })
      const r2    = await api.fetch(emailUrl, { method: 'POST', body: body1.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'follow' })
      const html2 = await r2.text()

      // 3. POST password
      const pwAction = parseFormAction(html2)
      const csrf2    = parseMeta(html2, '_csrf')
      const relay2   = parseMeta(html2, 'relayState') || parseMeta(html2, 'relay_state')
      const hmac2    = parseMeta(html2, 'hmac')
      const pwUrl    = pwAction ? (pwAction.startsWith('http') ? pwAction : AUTH_BASE + pwAction) : emailUrl
      const body2    = new URLSearchParams({ password: config.password, _csrf: csrf2 || '', relayState: relay2 || '', hmac: hmac2 || '' })
      const r3       = await api.fetch(pwUrl, { method: 'POST', body: body2.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual' })

      // 4. Follow redirects manually until we get the code
      let code = null
      let location = r3.headers.get('location') || ''
      for (let i = 0; i < 8 && location && !code; i++) {
        code = extractCode(location)
        if (code) break
        const rN = await api.fetch(location.startsWith('http') ? location : AUTH_BASE + location, { redirect: 'manual' })
        location = rN.headers.get('location') || ''
        code = extractCode(location)
      }
      if (!code) throw new Error('Auth redirect loop did not yield a code')

      // 5. Exchange code for tokens
      const tokenRes  = await api.fetch(`${AUTH_BASE}/oidc/v1/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID }).toString()
      })
      const tokens = await tokenRes.json()
      if (!tokens.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(tokens)}`)

      _token   = tokens.access_token
      _refresh = tokens.refresh_token
      _expiry  = new Date(Date.now() + (tokens.expires_in || 3600) * 1000)
      api.updateConfig({ accessToken: _token, refreshToken: _refresh, tokenExpiry: _expiry.toISOString() })
    }

    async function refreshTokens() {
      if (!_refresh) return authenticate()
      const res  = await api.fetch(`${AUTH_BASE}/oidc/v1/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: _refresh, client_id: CLIENT_ID }).toString()
      })
      const data = await res.json()
      if (!data.access_token) return authenticate()
      _token  = data.access_token
      _refresh = data.refresh_token || _refresh
      _expiry  = new Date(Date.now() + (data.expires_in || 3600) * 1000)
      api.updateConfig({ accessToken: _token, refreshToken: _refresh, tokenExpiry: _expiry.toISOString() })
    }

    async function ensureToken() {
      if (!_token || !_expiry || _expiry - Date.now() < 60_000) {
        if (_refresh) await refreshTokens()
        else          await authenticate()
      }
    }

    // ── vehicle data ──────────────────────────────────────────────────────────
    async function resolveVin() {
      if (_vin) return _vin
      const res  = await api.fetch(`${API_BASE}/vehicles`, { headers: { Authorization: `Bearer ${_token}`, 'User-Agent': 'WeConnect/5 CFNetwork/1206 Darwin/20.1.0' } })
      const data = await res.json()
      const vehicles = data?.data || data?.vehicles || []
      if (!vehicles.length) throw new Error('No vehicles found on account')
      _vin = config.vin || vehicles[0].vin
      api.updateConfig({ vin: _vin })
      return _vin
    }

    async function fetchVehicleStatus(vin) {
      const headers = { Authorization: `Bearer ${_token}`, 'User-Agent': 'WeConnect/5 CFNetwork/1206 Darwin/20.1.0', Accept: 'application/json' }

      // Try mileage / odometer
      let odometer  = null
      let level     = null
      let levelType = 'soc'

      try {
        const r = await api.fetch(`${API_BASE}/vehicles/${vin}/selectivestatus?jobs=measurements`, { headers })
        const d = await r.json()
        const meas = d?.data?.measurements
        odometer   = meas?.mileageKm?.value ?? meas?.odometerMeasurement?.value ?? null
        const soc  = meas?.fuelLevelStatus?.value?.currentSOC_pct ?? meas?.batteryStatus?.value?.currentSOC_pct ?? null
        const fuel = meas?.fuelLevelStatus?.value?.currentFuelLevel_pct ?? null
        if (soc  != null) { level = soc;  levelType = 'soc' }
        if (fuel != null) { level = fuel; levelType = 'fuel' }
      } catch (_) { /* fall through to legacy endpoint */ }

      if (odometer == null) {
        try {
          const r = await api.fetch(`${API_BASE}/vehicles/${vin}/status`, { headers })
          const d = await r.json()
          odometer = d?.data?.mileageKm ?? d?.data?.odometer ?? null
          level    = level ?? d?.data?.batteryStatus?.stateOfCharge ?? d?.data?.fuelLevel ?? null
        } catch (_) { /* ignore */ }
      }

      return { odometer, level, levelType }
    }

    // ── poll ──────────────────────────────────────────────────────────────────
    async function poll() {
      try {
        await ensureToken()
        const vin = await resolveVin()
        const { odometer, level, levelType } = await fetchVehicleStatus(vin)
        if (odometer == null && level == null) throw new Error('No data returned from API')

        const reading = {
          vin,
          odometer:   odometer ?? 0,
          level:      level    ?? 0,
          level_type: levelType,
          recorded_at: new Date().toISOString()
        }

        try { await api.db.insert(reading) } catch (e) { console.warn('[WeConnect] db insert failed:', e.message) }

        api.emit('weconnect-agent:reading:new', reading)
        api.updateConfig({ lastReading: reading })
      } catch (err) {
        console.error('[WeConnect agent] poll error:', err)
        api.emit('weconnect-agent:auth:error', { message: err.message })
      }
    }

    // ── schedule ──────────────────────────────────────────────────────────────
    function schedule() {
      const mins = Math.max(5, Number(config.pollIntervalMinutes) || 30)
      _timer = setInterval(poll, mins * 60_000)
      poll() // immediate first poll
    }

    schedule()

    // ── public API — poll MUST be returned here ───────────────────────────────
    return {
      poll
    }
  }
})