api.registerWidget({
  type: "weather-widget",
  title: "Weather Widget",
  description: "Current weather and 5-day forecast with city search",
  height: 420,
  defaultConfig: {
    apiKey: '',
    defaultCity: 'London',
  },
  hiddenConfig: {
    currentCity: '',
    unit: 'celsius',
  },

  render: async function(container, config) {
    const unit = config.unit || 'celsius'
    const tempSymbol = unit === 'celsius' ? '°C' : '°F'
    const toTemp = k => unit === 'celsius' ? Math.round(k - 273.15) : Math.round((k - 273.15) * 9/5 + 32)
    const accentColor = '#60a5fa'
    const currentCity = config.currentCity || config.defaultCity || 'London'

    container.innerHTML = `
      <style>
        .ww-wrap { font-family: sans-serif; color: #e2e8f0; background: #0f172a; height: 100%; display: flex; flex-direction: column; padding: 12px; box-sizing: border-box; gap: 10px; }
        .ww-search { display: flex; gap: 6px; }
        .ww-search input { flex: 1; background: #1e293b; border: 1px solid #334155; color: #e2e8f0; border-radius: 6px; padding: 6px 10px; font-size: 13px; outline: none; }
        .ww-search input:focus { border-color: ${accentColor}; }
        .ww-search button { background: ${accentColor}; color: #070d1a; border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-weight: 600; font-size: 13px; }
        .ww-current { display: flex; align-items: center; gap: 12px; background: #1e293b; border-radius: 10px; padding: 12px 16px; }
        .ww-current img { width: 64px; height: 64px; }
        .ww-current-info { flex: 1; }
        .ww-city { font-size: 18px; font-weight: 700; color: #e2e8f0; }
        .ww-desc { font-size: 13px; color: #94a3b8; text-transform: capitalize; }
        .ww-temp { font-size: 36px; font-weight: 800; color: ${accentColor}; line-height: 1; }
        .ww-meta { font-size: 12px; color: #94a3b8; margin-top: 4px; }
        .ww-forecast { display: flex; gap: 6px; }
        .ww-day { flex: 1; background: #1e293b; border-radius: 8px; padding: 8px 4px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .ww-day-name { font-size: 11px; font-weight: 600; color: #94a3b8; }
        .ww-day img { width: 36px; height: 36px; }
        .ww-day-hi { font-size: 13px; font-weight: 700; color: #e2e8f0; }
        .ww-day-lo { font-size: 11px; color: #64748b; }
        .ww-error { color: #ff6b6b; font-size: 13px; padding: 8px; }
        .ww-loading { color: #94a3b8; font-size: 13px; padding: 8px; }
      </style>
      <div class="ww-wrap">
        <div class="ww-search">
          <input id="ww-input" type="text" placeholder="Search city…" value="${currentCity}" />
          <button id="ww-btn">Go</button>
        </div>
        <div id="ww-current" class="ww-loading">Loading…</div>
        <div id="ww-forecast" class="ww-forecast"></div>
      </div>
    `

    const input = container.querySelector('#ww-input')
    const btn = container.querySelector('#ww-btn')
    const currentEl = container.querySelector('#ww-current')
    const forecastEl = container.querySelector('#ww-forecast')

    const fetchWeather = async (city) => {
      if (!config.apiKey) {
        currentEl.innerHTML = '<span class="ww-error">⚠️ Add your OpenWeatherMap API key in Settings</span>'
        return
      }
      try {
        const [curRes, frcRes] = await Promise.all([
          api.fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${config.apiKey}`),
          api.fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${config.apiKey}`)
        ])
        if (!curRes.ok) throw new Error(`City not found: ${city}`)
        const cur = await curRes.json()
        const frc = await frcRes.json()

        const icon = cur.weather[0].icon
        const desc = cur.weather[0].description
        const temp = toTemp(cur.main.temp)
        const feels = toTemp(cur.main.feels_like)
        const humidity = cur.main.humidity
        const wind = Math.round(cur.wind.speed * 3.6)

        currentEl.innerHTML = `
          <div class="ww-current">
            <img src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="${desc}" />
            <div class="ww-current-info">
              <div class="ww-city">${cur.name}, ${cur.sys.country}</div>
              <div class="ww-desc">${desc}</div>
              <div class="ww-temp">${temp}${tempSymbol}</div>
              <div class="ww-meta">Feels like ${feels}${tempSymbol} · 💧${humidity}% · 💨${wind} km/h</div>
            </div>
          </div>
        `

        const days = {}
        for (const slot of frc.list) {
          const date = slot.dt_txt.split(' ')[0]
          const hour = parseInt(slot.dt_txt.split(' ')[1])
          if (!days[date]) days[date] = slot
          else if (Math.abs(hour - 12) < Math.abs(parseInt(days[date].dt_txt.split(' ')[1]) - 12)) days[date] = slot
        }
        const dayKeys = Object.keys(days).slice(1, 6)
        const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

        forecastEl.innerHTML = dayKeys.map(d => {
          const s = days[d]
          const name = dayNames[new Date(d).getDay()]
          const hi = toTemp(s.main.temp_max)
          const lo = toTemp(s.main.temp_min)
          const ic = s.weather[0].icon
          return `
            <div class="ww-day">
              <div class="ww-day-name">${name}</div>
              <img src="https://openweathermap.org/img/wn/${ic}@2x.png" alt="" />
              <div class="ww-day-hi">${hi}${tempSymbol}</div>
              <div class="ww-day-lo">${lo}${tempSymbol}</div>
            </div>
          `
        }).join('')

        // Only persist if city actually changed — prevents infinite re-render loop
        if (city !== config.currentCity) {
          config.currentCity = city
          api.updateConfig({ currentCity: city })
        }

      } catch (err) {
        currentEl.innerHTML = `<span class="ww-error">❌ ${err.message}</span>`
      }
    }

    const search = () => {
      const city = input.value.trim()
      if (city) fetchWeather(city)
    }

    btn.addEventListener('click', search)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') search() })

    fetchWeather(currentCity)

    container.__cleanup__ = () => {}
  }
})