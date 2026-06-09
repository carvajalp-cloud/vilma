import geoip from 'geoip-lite';

// "Home" location used for internal/private IPs (configurable via env).
export const HOME = {
  lat: Number(process.env.HOME_LAT ?? 4.7),     // default ~Bogotá (Latin America)
  lon: Number(process.env.HOME_LON ?? -74.07),
  label: process.env.HOME_LABEL || 'Internal Network',
};

const PRIVATE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^::1$|^fe80:|^fc00:|^fd/i;

let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* older runtime */ }
function countryName(code) {
  if (!code) return 'Unknown';
  try { return (regionNames && regionNames.of(code)) || code; } catch { return code; }
}

// Returns { internal, country, country_name, lat, lon } or null if not locatable.
export function geoFor(ip) {
  if (!ip) return null;
  if (PRIVATE.test(ip)) {
    return { internal: true, country: 'LAN', country_name: HOME.label, lat: HOME.lat, lon: HOME.lon };
  }
  const g = geoip.lookup(ip);
  if (!g || !g.ll || g.ll[0] == null || !g.country) return null;
  return { internal: false, country: g.country, country_name: countryName(g.country), lat: g.ll[0], lon: g.ll[1] };
}
