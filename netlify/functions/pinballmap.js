// Minimal proxy for the Pinball Map API (it requires an api token, which must stay server-side).
// One read-only action, backed by a single upstream endpoint (locations.json), which returns
// each matching venue together with its machine lineup:
//   /api/pinballmap?name=ground+kontrol
const API = 'https://pinballmap.com/api/v1';
const MAX_RESULTS = 25;

const json = (body, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    },
  });

function toVenue(l) {
  return {
    id: l.id,
    name: l.name,
    city: [l.city, l.state].filter(Boolean).join(', ') || null,
    link: `https://pinballmap.com/map?by_location_id=${l.id}`,
    machines: (l.location_machine_xrefs ?? [])
      .filter((x) => x.machine?.name && !x.deleted_at)
      .map((x) => ({ name: x.machine.name, manufacturer: x.machine.manufacturer ?? null, year: x.machine.year ?? null })),
  };
}

export default async function handler(req) {
  const name = (new URL(req.url).searchParams.get('name') ?? '').trim();
  if (name.length < 2 || name.length > 80) return json({ error: 'Search with 2-80 characters.' }, 400);

  const token = process.env.PINBALLMAP_API_TOKEN;
  if (!token) return json({ error: 'Pinball Map is not configured on this server (missing PINBALLMAP_API_TOKEN).' }, 503);

  try {
    const res = await fetch(`${API}/locations.json?by_location_name=${encodeURIComponent(name)}`, {
      headers: { 'X-Api-Token': token, Accept: 'application/json', 'User-Agent': 'PinballMissions/0.1' },
    });
    if (!res.ok) return json({ error: `Pinball Map returned ${res.status}.` }, 502);
    const data = await res.json();
    const locations = data.locations ?? [];
    return json(
      { results: locations.slice(0, MAX_RESULTS).map(toVenue), total: locations.length },
      200,
      3600, // lineups change slowly; also keeps request volume to Pinball Map low
    );
  } catch {
    return json({ error: 'Could not reach Pinball Map.' }, 502);
  }
}

export const config = { path: '/api/pinballmap' };
