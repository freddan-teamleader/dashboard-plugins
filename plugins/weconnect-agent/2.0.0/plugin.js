// @bump: major
api.registerService({
  type: 'weconnect-agent',
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30
  },
  hiddenConfig: {
    _cachedTokens: null
  },
  events: {
    'reading:new':   { description: 'New odometer/level reading stored', schema: { vin: 'string', odometer: 'number', level: 'number', levelType: 'string', timestamp: 'string' } },
    'status:change': { description: 'Agent status update',              schema: { status: 'string', message: 'string' } }
  },
  create() {
    // ---- Constants (match WeConnect-python main) ----
    const SESSION    = 'weconnect-agent:auth'
    const CLIENT_ID  = 'a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com'
    const REDIRECT   = 'weconnect://authenticated'
    const SCOPE      = 'openid profile badge cars dealers vin'
    const BFF        = 'https://emea.bff.cariad.digital'
    const IDENTITY   = 'https://identity.vwgroup.io'
    const AUTHZ_URL  = `${BFF}/user-login/v1/authorize`
    const TOKEN_URL  = `${BFF}/user-login/login/v1`
    const REFRESH_URL= `${BFF}/login/v1/idk/token`
    const UA         = 'Volkswagen/3.51.1-android/14'

    const cfg = () => api.config || {}
    let tokens      = null   // { access_token, refresh_token, id_token, expires_at }
    let pollTimer   = null
    let lastReading = null
    let lastStatus  = { status: 'idle', message: 'Not started' }

    // ---- Helpers ----
    function emit(event, data) {
      api.emit(`weconnect-agent:${event}`, data)
      if (event === 'status:change') lastStatus = data
    }
    function setStatus(status, message) {
      console.log(`[weconnect-agent] ${status}: ${message}`)
      emit('status:change', { status, message })
    }
    function traceId() {
      const h = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2,'0')).join('')
      return (`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`).toUpperCase()
    }
    function pickHidden(html, name) {
      const patterns = [
        new RegExp(`name="${name}"\\s+value="([^"]+)"`),
        new RegExp(`value="([^"]+)"\\s+name="${name}"`),
        new RegExp(`name='${name}'\\s+value='([^']+)'`),
      ]
      for (const re of patterns) { const m = html.match(re); if (m) return m[1] }
      return null
    }
    function parseUrlQueryAndFragment(url) {
      // Handle weconnect://authenticated#state=...&id_token=...&...
      const hashIdx = url.indexOf('#')
      const qIdx    = url.indexOf('?')
      const out = {}
      const addPairs = (s) => new URLSearchParams(s).forEach((v,k) => out[k] = v)
      if (qIdx    !== -1) addPairs(url.slice(qIdx+1, hashIdx === -1 ? undefined : hashIdx))
      if (hashIdx !== -1) addPairs(url.slice(hashIdx+1))
      return out
    }

    // ---- Auth (mirrors WeConnect-python login flow) ----
    async function login() {
      const { email, password } = cfg()
      if (!email || !password) throw new Error('Email and password not configured')

      setStatus('polling', 'Authenticating…')

      // Clear any stale cookies in the proxy session
      try { await api.fetch(`${BFF}/`, { session: SESSION, method: 'GET' }) } catch {}

      // --- Step 1: GET BFF authorize → 302 to identity.vwgroup.io with state in query ---
      const authUrl = `${AUTHZ_URL}?` + new URLSearchParams({
        redirect_uri: REDIRECT,
        nonce: crypto.randomUUID()
      })
      const r1 = await api.fetch(authUrl, { session: SESSION, headers: { 'User-Agent': UA } })
      console.log('[weconnect-agent] Step 1 authorize → final URL:', r1.url, 'status:', r1.status)

      const html1 = await r1.text()

      // If we landed on the identity signin page, the form will be present.
      // If we got the "new auth flow" page we must handle state extraction differently.
      let csrf       = pickHidden(html1, '_csrf')
      let relayState = pickHidden(html1, 'relayState')
      let hmac1      = pickHidden(html1, 'hmac')

      // Extract state from the final URL (identity redirects include it)
      const finalUrlObj = (() => { try { return new URL(r1.url) } catch { return null } })()
      let state = finalUrlObj?.searchParams.get('state') || pickHidden(html1, 'state')

      console.log('[weconnect-agent] Form fields:', { csrf: !!csrf, relayState: !!relayState, hmac: !!hmac1, state: !!state })

      if (!csrf || !relayState || !hmac1) {
        // Dump a snippet so we can debug
        console.warn('[weconnect-agent] Login page snippet:', html1.slice(0, 500))
        throw new Error('Could not parse login form fields (legacy form missing)')
      }

      // --- Step 2: POST email → password form (new hmac) ---
      const r2 = await api.fetch(
        `${IDENTITY}/signin-service/v1/${CLIENT_ID}/login/identifier`,
        { method: 'POST', session: SESSION,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: new URLSearchParams({ _csrf: csrf, relayState, email, hmac: hmac1 }).toString()
        }
      )
      const html2 = await r2.text()
      console.log('[weconnect-agent] Step 2 email → status:', r2.status)

      const hmac2 = pickHidden(html2, 'hmac')
      if (!hmac2) {
        console.warn('[weconnect-agent] Password page snippet:', html2.slice(0, 500))
        throw new Error('Could not parse password form — wrong email?')
      }

      // --- Step 3: POST password → proxy follows redirects, ends at weconnect://authenticated#… ---
      const r3 = await api.fetch(
        `${IDENTITY}/signin-service/v1/${CLIENT_ID}/login/authenticate`,
        { method: 'POST', session: SESSION,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: new URLSearchParams({ _csrf: csrf, relayState, email, password, hmac: hmac2 }).toString()
        }
      )
      console.log('[weconnect-agent] Step 3 password → final URL:', r3.url, 'status:', r3.status)

      const finalUrl = r3.url || ''
      if (!finalUrl.startsWith('weconnect://authenticated')) {
        throw new Error(`Expected weconnect:// callback, got: ${finalUrl.slice(0, 200)}`)
      }

      const frag = parseUrlQueryAndFragment(finalUrl)
      if (!frag.state || !frag.id_token || !frag.access_token || !frag.code) {
        throw new Error(`Callback missing tokens. Got keys: ${Object.keys(frag).join(',')}`)
      }

      // --- Step 4: Exchange for final tokens via BFF login endpoint ---
      const r4 = await api.fetch(TOKEN_URL, {
        method: 'POST', session: SESSION,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({
          state:              frag.state,
          id_token:           frag.id_token,
          redirect_uri:       REDIRECT,
          region:             'emea',
          access_token:       frag.access_token,
          authorizationCode:  frag.code
        })
      })
      const tok = await r4.json()
      console.log('[weconnect-agent] Token exchange keys:', Object.keys(tok))

      // Python normalises camelCase → snake_case
      const access  = tok.accessToken  || tok.access_token
      const refresh = tok.refreshToken || tok.refresh_token
      const idTok   = tok.idToken      || tok.id_token
      if (!access) throw new Error(`Token exchange failed: ${JSON.stringify(tok).slice(0, 300)}`)

      tokens = {
        access_token:  access,
        refresh_token: refresh,
        id_token:      idTok,
        expires_at:    Date.now() + (tok.expires_in || tok.expiresIn || 3600) * 1000
      }
      api.updateConfig({ _cachedTokens: tokens })
      console.log('[weconnect-agent] Authenticated ✓')
    }

    async function refreshTokens() {
      if (!tokens?.refresh_token) { tokens = null; return }
      try {
        const r = await api.fetch(REFRESH_URL, {
          method: 'POST', session: SESSION,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: new URLSearchParams({
            grant_type:    'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id:     CLIENT_ID
          }).toString()
        })
        if (r.status === 401) { tokens = null; return }
        const tok = await r.json()
        const access  = tok.accessToken  || tok.access_token
        const refresh = tok.refreshToken || tok.refresh_token || tokens.refresh_token
        const idTok   = tok.idToken      || tok.id_token      || tokens.id_token
        if (!access) throw new Error('Refresh failed')
        tokens = {
          access_token:  access,
          refresh_token: refresh,
          id_token:      idTok,
          expires_at:    Date.now() + (tok.expires_in || tok.expiresIn || 3600) * 1000
        }
        api.updateConfig({ _cachedTokens: tokens })
        console.log('[weconnect-agent] Token refreshed ✓')
      } catch (e) {
        console.warn('[weconnect-agent] Refresh failed, will re-login:', e.message)
        tokens = null
      }
    }

    async function bffGet(path) {
      if (!tokens || Date.now() > tokens.expires_at - 60_000) await refreshTokens()
      if (!tokens) await login()
      const res = await api.fetch(`${BFF}${path}`, {
        headers: {
          Authorization:         `Bearer ${tokens.access_token}`,
          Accept:                '*/*',
          'Content-Type':        'application/json',
          'Content-Version':     '1',
          'User-Agent':          UA,
          'Accept-Language':     'de-de',
          'x-newrelic-id':       'VgAEWV9QDRAEXFlRAAYPUA==',
          'weconnect-trace-id':  traceId(),
          'x-android-package-name': 'com.volkswagen.weconnect'
        }
      })
      if (res.status === 401) { tokens = null; await login(); return bffGet(path) }
      if (!res.ok) throw new Error(`BFF ${path} returned ${res.status}`)
      return res.json()
    }

    // ---- Poll ----
    async function poll() {
      const { vin, email, password } = cfg()
      if (!email || !password) { setStatus('error', 'Email and password not configured'); return schedule() }

      try {
        setStatus('polling', 'Fetching vehicle data…')
        if (!tokens) await login()

        // Get vehicle list if VIN not pinned
        let activeVin = vin
        if (!activeVin) {
          const vdata = await bffGet('/vehicle/v1/vehicles')
          console.log('[weconnect-agent] Vehicles:', JSON.stringify(vdata).slice(0, 300))
          activeVin = vdata?.data?.[0]?.vin
          if (!activeVin) throw new Error('No VIN found — set one in Settings')
          api.updateConfig({ vin: activeVin })
        }

        // Fetch selective status (odometer + fuel/SoC + range)
        const jobs = ['fuelStatus','measurements','charging']
        const status = await bffGet(`/vehicle/v1/vehicles/${activeVin}/selectivestatus?jobs=${jobs.join(',')}`)
        console.log('[weconnect-agent] selectivestatus keys:', Object.keys(status || {}))

        // Parse odometer
        const odometer = status?.measurements?.odometerStatus?.value?.odometer
                      ?? status?.measurements?.odometerStatus?.value?.odometer_km
                      ?? null

        // Parse level — prefer SoC for EVs, else fuel level
        let level = null, levelType = 'fuel'
        const fl = status?.measurements?.fuelLevelStatus?.value
        if (fl) {
          if (fl.currentSOC_pct != null) { level = fl.currentSOC_pct; levelType = 'soc' }
          else if (fl.currentFuelLevel_pct != null) { level = fl.currentFuelLevel_pct; levelType = 'fuel' }
        }
        // Fallback to charging domain
        if (level == null) {
          const soc = status?.charging?.batteryStatus?.value?.currentSOC_pct
          if (soc != null) { level = soc; levelType = 'soc' }
        }

        const reading = {
          vin:       activeVin,
          odometer:  odometer == null ? null : Number(odometer),
          level:     level    == null ? null : Number(level),
          levelType,
          timestamp: new Date().toISOString()
        }
        lastReading = reading

        try {
          await api.db.insert({
            vin:         activeVin,
            odometer:    reading.odometer,
            level:       reading.level,
            level_type:  reading.levelType,
            recorded_at: reading.timestamp
          })
        } catch (e) { console.warn('[weconnect-agent] DB insert failed:', e.message) }

        emit('reading:new', reading)
        setStatus('idle', `Updated ${new Date().toLocaleTimeString()} — ${reading.odometer ?? '?'} km, ${reading.level ?? '?'}% ${reading.levelType}`)

      } catch (e) {
        console.error('[weconnect-agent] Poll error:', e)
        setStatus('error', e.message)
        tokens = null // force re-auth next tick
      }
      schedule()
    }

    function schedule() {
      const mins = Math.max(5, cfg().pollIntervalMinutes || 30)
      clearTimeout(pollTimer)
      pollTimer = setTimeout(poll, mins * 60 * 1000)
    }

    // Restore cached tokens if still valid
    const cached = cfg()._cachedTokens
    if (cached?.access_token && cached?.expires_at > Date.now()) {
      tokens = cached
      console.log('[weconnect-agent] Restored cached tokens ✓')
    }

    // Kick off
    setTimeout(poll, 2000)

    return {
      getLastReading: () => lastReading,
      getStatus:      () => lastStatus,
      pollNow:        () => { clearTimeout(pollTimer); setTimeout(poll, 0) }
    }
  }
})