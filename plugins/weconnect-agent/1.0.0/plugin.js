api.registerService({
  type: 'weconnect-agent',
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30
  },
  hiddenConfig: {
    _cachedTokens: null,
    _lastReading: null
  },
  events: {
    'reading:new':   { description: 'New vehicle reading', schema: { vin: 'string', km: 'number', batteryPct: 'number', fuelPct: 'number', recorded_at: 'string' } },
    'status:change': { description: 'Agent status changed', schema: { status: 'string', message: 'string' } }
  },
  create() {
    const CLIENT_ID    = 'a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com'
    const REDIRECT_URI = 'weconnect://authenticated'
    const IDENTITY     = 'https://identity.vwgroup.io'
    const API_HOSTS    = [
      'https://mobileapi.apps.emea.vwapps.io',
      'https://msg.volkswagen.de/fs-car',
      'https://emea.bff.cariad.digital'
    ]
    const SESSION_ID   = 'weconnect-agent:oauth'
    const log = (...args) => console.log('[weconnect-agent]', ...args)
    const cfg = () => api.config || {}

    let state = { status: 'idle', message: '', lastReading: null }
    let pollTimer = null

    function setStatus(status, message = '') {
      state.status = status
      state.message = message
      log(`status: ${status}${message ? ' — ' + message : ''}`)
      api.emit('weconnect-agent:status:change', { status, message })
    }

    async function generatePKCE() {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      const verifier = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
      return { verifier, challenge }
    }

    async function followRedirects(location, depth = 0) {
      if (depth > 10) throw new Error('Too many redirects')
      if (location.startsWith('weconnect://')) {
        const u = new URL(location.replace('weconnect://', 'https://dummy/'))
        const code = u.searchParams.get('code')
        if (!code) throw new Error('No code in weconnect:// redirect')
        log(`Got auth code at depth ${depth}`)
        return code
      }
      const url = location.startsWith('http') ? location : `${IDENTITY}${location}`
      log(`Follow redirect depth=${depth}: ${url.slice(0, 120)}`)
      const r = await api.fetch(url, { session: SESSION_ID, redirect: 'manual' })
      const loc = r.headers.get('location')
      if (loc) return followRedirects(loc, depth + 1)
      const body = await r.text()
      const m = body.match(/weconnect:\/\/authenticated\?[^"'\s]+/)
      if (m) return followRedirects(m[0], depth + 1)
      throw new Error(`Redirect chain dead-end at depth ${depth}, status ${r.status}`)
    }

    async function authenticate() {
      const c = cfg()
      if (!c.email || !c.password) throw new Error('Set email and password in widget Settings')

      setStatus('authenticating', 'Starting OAuth flow')
      const { verifier, challenge } = await generatePKCE()

      const authUrl = `${IDENTITY}/oidc/v1/authorize?` + new URLSearchParams({
        client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI,
        scope: 'openid profile address phone email mbb offline_access',
        code_challenge: challenge, code_challenge_method: 'S256',
        state: crypto.randomUUID()
      })

      log('Step 1: GET authorize')
      const r1 = await api.fetch(authUrl, { session: SESSION_ID })
      if (r1.status !== 200) throw new Error(`Authorize returned ${r1.status}`)
      const html1 = await r1.text()
      const ulpState = html1.match(/name="state"\s+value="([^"]+)"/)?.[1]
      if (!ulpState) throw new Error('Could not find ULP state token in login page')
      log(`Step 1 ulpState: len=${ulpState.length}`)

      log('Step 2: POST /u/login')
      const r2 = await api.fetch(`${IDENTITY}/u/login?state=${encodeURIComponent(ulpState)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          state: ulpState, username: c.email, password: c.password, action: 'default'
        }).toString(),
        session: SESSION_ID,
        redirect: 'manual'
      })
      log(`Step 2 status: ${r2.status}`)
      const loc = r2.headers.get('location')

      let code
      if (loc) {
        code = await followRedirects(loc)
      } else {
        const body = await r2.text()
        const m = body.match(/weconnect:\/\/authenticated\?[^"'\s]+/)
        if (m) code = await followRedirects(m[0])
        else {
          const err = body.match(/class="[^"]*error[^"]*"[^>]*>([^<]+)</)?.[1]
          throw new Error(`Login failed${err ? ': ' + err.trim() : ' — no redirect, no code'}`)
        }
      }

      log('Step 3: Exchange code for tokens')
      const r3 = await api.fetch(`${IDENTITY}/oidc/v1/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code,
          redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: verifier
        }).toString()
      })
      const tokens = await r3.json()
      if (!tokens.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(tokens)}`)
      log(`Got access_token (expires in ${tokens.expires_in}s)`)

      tokens.expires_at = Date.now() + (tokens.expires_in - 60) * 1000
      await api.updateConfig({ _cachedTokens: tokens })
      setStatus('authenticated')
      return tokens
    }

    async function getValidTokens() {
      let tokens = cfg()._cachedTokens
      if (tokens && tokens.expires_at > Date.now()) return tokens
      if (tokens?.refresh_token) {
        log('Refreshing token')
        try {
          const r = await api.fetch(`${IDENTITY}/oidc/v1/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: tokens.refresh_token,
              client_id: CLIENT_ID
            }).toString()
          })
          const fresh = await r.json()
          if (fresh.access_token) {
            fresh.expires_at = Date.now() + (fresh.expires_in - 60) * 1000
            fresh.refresh_token = fresh.refresh_token || tokens.refresh_token
            await api.updateConfig({ _cachedTokens: fresh })
            return fresh
          }
        } catch (e) { log('Refresh failed:', e.message) }
      }
      return authenticate()
    }

    async function apiGet(path, token) {
      for (const host of API_HOSTS) {
        try {
          const r = await api.fetch(`${host}${path}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
          })
          if (r.ok) return { host, data: await r.json() }
          log(`${host}${path} → ${r.status}`)
        } catch (e) { log(`${host} threw: ${e.message}`) }
      }
      throw new Error(`All API hosts failed for ${path}`)
    }

    async function poll() {
      try {
        setStatus('polling')
        const tokens = await getValidTokens()

        let vin = cfg().vin?.trim()
        if (!vin) {
          const { data } = await apiGet('/vehicles', tokens.access_token)
          vin = data?.data?.[0]?.vin || data?.vehicles?.[0]?.vin || data?.[0]?.vin
          if (!vin) throw new Error('No VIN found in vehicles response')
          log(`Auto-detected VIN: ${vin}`)
        }

        const { data: status } = await apiGet(`/vehicles/${vin}/status`, tokens.access_token)

        const findNum = (obj, keys) => {
          if (!obj || typeof obj !== 'object') return null
          for (const k of keys) if (typeof obj[k] === 'number') return obj[k]
          for (const v of Object.values(obj)) {
            const found = findNum(v, keys)
            if (found !== null) return found
          }
          return null
        }

        const km         = findNum(status, ['mileageKm', 'mileage', 'odometer', 'km'])
        const batteryPct = findNum(status, ['currentSOC_pct', 'stateOfCharge', 'batteryLevel', 'soc'])
        const fuelPct    = findNum(status, ['currentFuelLevel_pct', 'fuelLevel', 'tankLevel'])

        const reading = {
          vin, km, batteryPct, fuelPct,
          recorded_at: new Date().toISOString()
        }
        log('Reading:', reading)

        try { await api.db.insert(reading) } catch (e) { log('DB insert failed:', e.message) }

        state.lastReading = reading
        await api.updateConfig({ _lastReading: reading })
        api.emit('weconnect-agent:reading:new', reading)
        setStatus('ok', `${km ?? '?'} km`)
      } catch (e) {
        setStatus('error', e.message)
        log('Poll failed:', e.message)
      }
    }

    function schedule() {
      if (pollTimer) clearInterval(pollTimer)
      const mins = Math.max(5, cfg().pollIntervalMinutes || 30)
      pollTimer = setInterval(poll, mins * 60 * 1000)
      log(`Scheduled every ${mins} min`)
    }

    state.lastReading = cfg()._lastReading || null
    setTimeout(() => { schedule(); poll() }, 2000)

    return {
      poll,
      getStatus: () => ({ ...state }),
      getLastReading: () => state.lastReading,
      async getHistory(limit = 30) {
        try {
          return await api.db.query({}, { orderBy: 'recorded_at', ascending: false, limit })
        } catch { return [] }
      }
    }
  }
})