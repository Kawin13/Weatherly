/**
 * Nimbus Weather Dashboard — script.js
 * API: Open-Meteo (no key required) + Open-Meteo Geocoding
 * Features: async/await, fetch, DOM manipulation, localStorage,
 *           geolocation, unit toggle, dark/light theme, auto-refresh
 */

'use strict';

/* ══════════════════════════════════════════
   Configuration
   ══════════════════════════════════════════ */

const CONFIG = {
  GEO_API:       'https://geocoding-api.open-meteo.com/v1/search',
  WEATHER_API:   'https://api.open-meteo.com/v1/forecast',
  REFRESH_MS:    5 * 60 * 1000,   // Auto-refresh every 5 min
  MAX_RECENT:    5,                // Max recent searches stored
  STORAGE_KEYS: {
    RECENT:  'nimbus_recent',
    THEME:   'nimbus_theme',
    UNIT:    'nimbus_unit',
  },
};

/* ══════════════════════════════════════════
   State
   ══════════════════════════════════════════ */

const state = {
  currentCity:    null,   // { name, lat, lon, country, countryCode }
  currentData:    null,   // raw API response
  unit:           'C',    // 'C' | 'F'
  theme:          'dark', // 'dark' | 'light'
  refreshTimer:   null,
  clockTimer:     null,
};

/* ══════════════════════════════════════════
   DOM references
   ══════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

const DOM = {
  body:          document.body,
  cityInput:     $('city-input'),
  searchBtn:     $('search-btn'),
  geoBtn:        $('geo-btn'),
  errorBanner:   $('error-banner'),
  errorText:     $('error-text'),
  skeleton:      $('skeleton'),
  dashboard:     $('dashboard'),
  emptyState:    $('empty-state'),
  recentSection: $('recent-searches'),
  recentChips:   $('recent-chips'),
  clearRecent:   $('clear-recent'),
  themeToggle:   $('theme-toggle'),
  themeIcon:     $('theme-toggle').querySelector('.theme-icon'),
  btnCelsius:    $('btn-celsius'),
  btnFahr:       $('btn-fahrenheit'),
  refreshBtn:    $('refresh-btn'),
  refreshInfo:   $('refresh-info'),
  // Hero
  cityName:      $('city-name'),
  countryFlag:   $('country-flag'),
  cityDate:      $('city-date'),
  cityTime:      $('city-time'),
  weatherIcon:   $('weather-icon'),
  conditionMain: $('condition-main'),
  conditionDesc: $('condition-desc'),
  tempValue:     $('temp-value'),
  tempUnit:      $('temp-unit'),
  feelsLike:     $('feels-like'),
  tempMin:       $('temp-min'),
  tempMax:       $('temp-max'),
  tempBarFill:   $('temp-bar-fill'),
  // Metrics
  humidity:      $('humidity'),
  humidityBar:   $('humidity-bar'),
  windSpeed:     $('wind-speed'),
  pressure:      $('pressure'),
  visibility:    $('visibility'),
  sunrise:       $('sunrise'),
  sunset:        $('sunset'),
};

/* ══════════════════════════════════════════
   Utility helpers
   ══════════════════════════════════════════ */

/**
 * Convert Celsius to Fahrenheit
 * @param {number} c
 * @returns {number}
 */
const toFahrenheit = (c) => Math.round(c * 9 / 5 + 32);

/**
 * Format a temperature value according to the current unit
 * @param {number} c - temp in Celsius
 * @returns {string}
 */
const formatTemp = (c) =>
  state.unit === 'C' ? `${Math.round(c)}°C` : `${toFahrenheit(c)}°F`;

/**
 * Convert Unix timestamp (seconds) to local time string using timezone offset
 * @param {number} unix - seconds
 * @param {number} offsetSec - UTC offset in seconds
 * @returns {string} e.g. "06:42 AM"
 */
const unixToLocal = (unix, offsetSec) => {
  const ms   = (unix + offsetSec) * 1000;
  const date = new Date(ms);
  const h    = date.getUTCHours();
  const m    = String(date.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m} ${ampm}`;
};

/**
 * Derive a country flag emoji from a 2-letter country code
 * @param {string} code - e.g. "IN"
 * @returns {string} emoji flag
 */
const countryFlag = (code) => {
  if (!code || code.length !== 2) return '';
  return code.toUpperCase().split('').map(
    (c) => String.fromCodePoint(c.charCodeAt(0) + 127397)
  ).join('');
};

/**
 * Map WMO weather code → emoji icon + label
 * https://open-meteo.com/en/docs#weathervariables
 * @param {number} code
 * @param {boolean} isDay
 * @returns {{ icon: string, label: string }}
 */
const interpretWeatherCode = (code, isDay = true) => {
  const day   = isDay;
  const table = {
    0:  { icon: day ? '☀️' : '🌙',  label: 'Clear sky'           },
    1:  { icon: day ? '🌤️' : '🌙',  label: 'Mainly clear'        },
    2:  { icon: '⛅',               label: 'Partly cloudy'        },
    3:  { icon: '☁️',               label: 'Overcast'             },
    45: { icon: '🌫️',               label: 'Foggy'                },
    48: { icon: '🌫️',               label: 'Icy fog'              },
    51: { icon: '🌦️',               label: 'Light drizzle'        },
    53: { icon: '🌦️',               label: 'Drizzle'              },
    55: { icon: '🌦️',               label: 'Heavy drizzle'        },
    61: { icon: '🌧️',               label: 'Slight rain'          },
    63: { icon: '🌧️',               label: 'Rain'                 },
    65: { icon: '🌧️',               label: 'Heavy rain'           },
    71: { icon: '🌨️',               label: 'Slight snowfall'      },
    73: { icon: '❄️',               label: 'Snowfall'             },
    75: { icon: '❄️',               label: 'Heavy snowfall'       },
    77: { icon: '🌨️',               label: 'Snow grains'          },
    80: { icon: '🌦️',               label: 'Rain showers'         },
    81: { icon: '🌧️',               label: 'Moderate showers'     },
    82: { icon: '⛈️',               label: 'Violent showers'      },
    85: { icon: '🌨️',               label: 'Snow showers'         },
    86: { icon: '🌨️',               label: 'Heavy snow showers'   },
    95: { icon: '⛈️',               label: 'Thunderstorm'         },
    96: { icon: '⛈️',               label: 'Thunderstorm w/ hail' },
    99: { icon: '⛈️',               label: 'Heavy thunderstorm'   },
  };
  return table[code] ?? { icon: '🌡️', label: 'Unknown' };
};

/* ══════════════════════════════════════════
   API layer
   ══════════════════════════════════════════ */

/**
 * Geocode a city name → { name, lat, lon, country, countryCode }
 * @param {string} city
 * @returns {Promise<Object>}
 */
async function geocodeCity(city) {
  const url = `${CONFIG.GEO_API}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const res  = await fetch(url);

  if (!res.ok) throw new Error(`Geocoding error: ${res.status}`);

  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error('CITY_NOT_FOUND');
  }

  const r = data.results[0];
  return {
    name:        r.name,
    lat:         r.latitude,
    lon:         r.longitude,
    country:     r.country,
    countryCode: r.country_code,
    timezone:    r.timezone,
  };
}

/**
 * Fetch weather from Open-Meteo for a given location
 * @param {number} lat
 * @param {number} lon
 * @param {string} timezone
 * @returns {Promise<Object>}
 */
async function fetchWeatherData(lat, lon, timezone) {
  const params = new URLSearchParams({
    latitude:              lat,
    longitude:             lon,
    timezone:              timezone || 'auto',
    current:               [
      'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
      'weather_code', 'wind_speed_10m', 'surface_pressure',
      'visibility', 'is_day',
    ].join(','),
    daily:                 'temperature_2m_max,temperature_2m_min,sunrise,sunset',
    wind_speed_unit:       'kmh',
    forecast_days:         1,
  });

  const url = `${CONFIG.WEATHER_API}?${params}`;
  const res  = await fetch(url);

  if (!res.ok) throw new Error(`Weather API error: ${res.status}`);

  return res.json();
}

/**
 * Master function: geocode + fetch weather
 * @param {string} city
 */
async function getWeather(city) {
  try {
    showLoading(true);
    hideError();

    // 1. Geocode
    const location = await geocodeCity(city);
    state.currentCity = location;

    // 2. Fetch weather
    const weather = await fetchWeatherData(location.lat, location.lon, location.timezone);
    state.currentData = { location, weather };

    // 3. Render
    renderDashboard(location, weather);

    // 4. Save to recent + start auto-refresh
    addToRecent(location.name);
    scheduleAutoRefresh();

  } catch (err) {
    handleError(err);
  } finally {
    showLoading(false);
  }
}

/**
 * Refresh using the currently cached city
 */
async function refreshWeather() {
  if (!state.currentCity) return;

  DOM.refreshBtn.classList.add('spinning');

  try {
    const weather = await fetchWeatherData(
      state.currentCity.lat,
      state.currentCity.lon,
      state.currentCity.timezone,
    );
    state.currentData = { location: state.currentCity, weather };
    renderDashboard(state.currentCity, weather);
  } catch (err) {
    handleError(err);
  } finally {
    setTimeout(() => DOM.refreshBtn.classList.remove('spinning'), 800);
  }
}

/* ══════════════════════════════════════════
   Rendering
   ══════════════════════════════════════════ */

/**
 * Populate the dashboard with weather data
 * @param {Object} location
 * @param {Object} weather
 */
function renderDashboard(location, weather) {
  const c   = weather.current;
  const d   = weather.daily;
  const wc  = interpretWeatherCode(c.weather_code, c.is_day === 1);

  // ── Hero ──
  DOM.cityName.textContent      = location.name;
  DOM.countryFlag.textContent   = `${countryFlag(location.countryCode)} ${location.country}`;
  DOM.weatherIcon.textContent   = wc.icon;
  DOM.conditionMain.textContent = wc.label;
  DOM.conditionDesc.textContent = `Observed at ${c.time.slice(11, 16)}`;

  updateTemperatures(c, d);

  // ── Date & clock ──
  startClock(location.timezone);

  // ── Metrics ──
  DOM.humidity.textContent  = `${c.relative_humidity_2m}%`;
  DOM.humidityBar.style.width = `${c.relative_humidity_2m}%`;
  DOM.windSpeed.textContent = `${c.wind_speed_10m} km/h`;
  DOM.pressure.textContent  = `${Math.round(c.surface_pressure)} hPa`;
  DOM.visibility.textContent = c.visibility >= 1000
    ? `${(c.visibility / 1000).toFixed(1)} km`
    : `${c.visibility} m`;

  // Sunrise / Sunset — Open-Meteo returns ISO strings like "2025-06-22T05:32"
  const parseTime = (iso) => {
    if (!iso) return '—';
    const t    = iso.slice(11, 16); // "HH:MM"
    const [hh, mm] = t.split(':').map(Number);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    return `${hh % 12 || 12}:${String(mm).padStart(2,'0')} ${ampm}`;
  };
  DOM.sunrise.textContent = parseTime(d?.sunrise?.[0]);
  DOM.sunset.textContent  = parseTime(d?.sunset?.[0]);

  // ── Refresh stamp ──
  DOM.refreshInfo.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  // ── Show dashboard ──
  showSection('dashboard');
}

/**
 * Update temperature fields (called also on unit switch)
 * @param {Object} c - current weather object
 * @param {Object} d - daily weather object
 */
function updateTemperatures(c, d) {
  const rawTemp   = c.temperature_2m;
  const rawFeels  = c.apparent_temperature;
  const rawMin    = d?.temperature_2m_min?.[0] ?? rawTemp - 2;
  const rawMax    = d?.temperature_2m_max?.[0] ?? rawTemp + 2;

  if (state.unit === 'C') {
    DOM.tempValue.textContent    = Math.round(rawTemp);
    DOM.tempUnit.textContent     = '°C';
    DOM.feelsLike.textContent    = `${Math.round(rawFeels)}°C`;
    DOM.tempMin.textContent      = `${Math.round(rawMin)}°C`;
    DOM.tempMax.textContent      = `${Math.round(rawMax)}°C`;
  } else {
    DOM.tempValue.textContent    = toFahrenheit(rawTemp);
    DOM.tempUnit.textContent     = '°F';
    DOM.feelsLike.textContent    = `${toFahrenheit(rawFeels)}°F`;
    DOM.tempMin.textContent      = `${toFahrenheit(rawMin)}°F`;
    DOM.tempMax.textContent      = `${toFahrenheit(rawMax)}°F`;
  }

  // Temperature bar — position fill between min and max
  const range = rawMax - rawMin || 1;
  const pct   = Math.max(0, Math.min(100, ((rawTemp - rawMin) / range) * 100));
  DOM.tempBarFill.style.width = `${pct}%`;
}

/* ══════════════════════════════════════════
   Live clock
   ══════════════════════════════════════════ */

/**
 * Start a live clock for the searched city using its IANA timezone
 * @param {string} timezone e.g. "Asia/Kolkata"
 */
function startClock(timezone) {
  clearInterval(state.clockTimer);
  const tick = () => {
    const now = new Date();
    try {
      DOM.cityDate.textContent = now.toLocaleDateString('en-US', {
        timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      DOM.cityTime.textContent = now.toLocaleTimeString('en-US', {
        timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch {
      DOM.cityDate.textContent = now.toDateString();
      DOM.cityTime.textContent = now.toLocaleTimeString();
    }
  };
  tick();
  state.clockTimer = setInterval(tick, 1000);
}

/* ══════════════════════════════════════════
   Auto-refresh
   ══════════════════════════════════════════ */

function scheduleAutoRefresh() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    if (state.currentCity) refreshWeather();
  }, CONFIG.REFRESH_MS);
}

/* ══════════════════════════════════════════
   UI State helpers
   ══════════════════════════════════════════ */

function showLoading(loading) {
  DOM.searchBtn.classList.toggle('loading', loading);
  DOM.searchBtn.disabled = loading;
  if (loading) {
    hideError();
    DOM.skeleton.hidden  = false;
    DOM.dashboard.hidden = true;
    DOM.emptyState.hidden = true;
  } else {
    DOM.skeleton.hidden = true;
  }
}

function showSection(section) {
  DOM.dashboard.hidden  = section !== 'dashboard';
  DOM.emptyState.hidden = section !== 'empty';
  DOM.skeleton.hidden   = true;
}

function showError(message) {
  DOM.errorText.textContent = message;
  DOM.errorBanner.hidden    = false;
}

function hideError() {
  DOM.errorBanner.hidden = true;
}

function handleError(err) {
  showSection('empty');

  const messages = {
    CITY_NOT_FOUND:  'City not found. Check the spelling and try again.',
    'Failed to fetch': 'Network error. Check your internet connection.',
    NetworkError:    'Network error. Check your internet connection.',
  };

  const msg = Object.entries(messages).find(([k]) => err.message.includes(k));
  showError(msg ? msg[1] : `Unable to fetch weather data. (${err.message})`);
}

/* ══════════════════════════════════════════
   Recent searches (localStorage)
   ══════════════════════════════════════════ */

function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.RECENT)) ?? [];
  } catch { return []; }
}

function setRecent(list) {
  try { localStorage.setItem(CONFIG.STORAGE_KEYS.RECENT, JSON.stringify(list)); } catch {}
}

function addToRecent(cityName) {
  let list = getRecent().filter((c) => c.toLowerCase() !== cityName.toLowerCase());
  list.unshift(cityName);
  if (list.length > CONFIG.MAX_RECENT) list = list.slice(0, CONFIG.MAX_RECENT);
  setRecent(list);
  renderRecent();
}

function renderRecent() {
  const list = getRecent();
  if (list.length === 0) {
    DOM.recentSection.hidden = true;
    return;
  }
  DOM.recentSection.hidden = false;
  DOM.recentChips.innerHTML = '';
  list.forEach((city) => {
    const btn = document.createElement('button');
    btn.className = 'recent-chip';
    btn.textContent = city;
    btn.addEventListener('click', () => {
      DOM.cityInput.value = city;
      getWeather(city);
    });
    DOM.recentChips.appendChild(btn);
  });
}

function clearRecent() {
  try { localStorage.removeItem(CONFIG.STORAGE_KEYS.RECENT); } catch {}
  DOM.recentSection.hidden = true;
}

/* ══════════════════════════════════════════
   Theme & unit persistence
   ══════════════════════════════════════════ */

function applyTheme(theme) {
  state.theme = theme;
  DOM.body.className = `${theme}-theme`;
  DOM.themeIcon.textContent = theme === 'dark' ? '☽' : '☀';
  try { localStorage.setItem(CONFIG.STORAGE_KEYS.THEME, theme); } catch {}
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

function applyUnit(unit) {
  state.unit = unit;
  DOM.btnCelsius.classList.toggle('active', unit === 'C');
  DOM.btnFahr.classList.toggle('active', unit === 'F');
  try { localStorage.setItem(CONFIG.STORAGE_KEYS.UNIT, unit); } catch {}

  // Re-render temperatures if data is loaded
  if (state.currentData) {
    updateTemperatures(
      state.currentData.weather.current,
      state.currentData.weather.daily,
    );
  }
}

function loadPreferences() {
  try {
    const theme = localStorage.getItem(CONFIG.STORAGE_KEYS.THEME) ?? 'dark';
    const unit  = localStorage.getItem(CONFIG.STORAGE_KEYS.UNIT)  ?? 'C';
    applyTheme(theme);
    applyUnit(unit);
  } catch {}
}

/* ══════════════════════════════════════════
   Geolocation
   ══════════════════════════════════════════ */

async function searchByGeolocation() {
  if (!navigator.geolocation) {
    showError('Geolocation is not supported by your browser.');
    return;
  }

  showLoading(true);
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      try {
        // Reverse geocode via Open-Meteo's geocoding isn't available,
        // so we'll use lat/lon directly with a "nearby" label
        const weather = await fetchWeatherData(coords.latitude, coords.longitude, 'auto');
        const location = {
          name:        'My Location',
          lat:         coords.latitude,
          lon:         coords.longitude,
          country:     '',
          countryCode: '',
          timezone:    weather.timezone ?? 'auto',
        };
        state.currentCity  = location;
        state.currentData  = { location, weather };
        DOM.cityInput.value = 'My Location';
        renderDashboard(location, weather);
        scheduleAutoRefresh();
      } catch (err) {
        handleError(err);
      } finally {
        showLoading(false);
      }
    },
    (err) => {
      showLoading(false);
      const msgs = {
        1: 'Location access denied. Please allow location access and try again.',
        2: 'Could not determine your location. Try again.',
        3: 'Location request timed out.',
      };
      showError(msgs[err.code] ?? 'Could not get your location.');
    },
    { timeout: 10000 }
  );
}

/* ══════════════════════════════════════════
   Search trigger
   ══════════════════════════════════════════ */

function triggerSearch() {
  const city = DOM.cityInput.value.trim();
  if (!city) {
    showError('Please enter a city name.');
    DOM.cityInput.focus();
    return;
  }
  hideError();
  getWeather(city);
}

/* ══════════════════════════════════════════
   Event listeners
   ══════════════════════════════════════════ */

DOM.searchBtn.addEventListener('click', triggerSearch);

DOM.cityInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') triggerSearch();
});

DOM.geoBtn.addEventListener('click', searchByGeolocation);

DOM.themeToggle.addEventListener('click', toggleTheme);

DOM.btnCelsius.addEventListener('click', () => applyUnit('C'));
DOM.btnFahr.addEventListener('click',    () => applyUnit('F'));

DOM.clearRecent.addEventListener('click', clearRecent);

DOM.refreshBtn.addEventListener('click', refreshWeather);

/* ══════════════════════════════════════════
   Init
   ══════════════════════════════════════════ */

function init() {
  loadPreferences();
  renderRecent();
  showSection('empty');
  DOM.cityInput.focus();

  // ── Demo: auto-load last searched city if present ──
  const recent = getRecent();
  if (recent.length > 0) {
    DOM.cityInput.value = recent[0];
    // Uncomment the line below to auto-load on page open:
    // getWeather(recent[0]);
  }
}

init();
