const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'trips.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const sseClients = new Map();

const ISLAND_CONNECTION_COST = {
  Bali: { Bali: 0, 'Nusa Penida': 1, Gili: 2, Lombok: 2, Java: 2, Flores: 3, Komodo: 3, Sumatra: 4, Borneo: 4, Sulawesi: 4, RajaAmpat: 5, Other: 3 },
  'Nusa Penida': { Bali: 1, 'Nusa Penida': 0, Gili: 2, Lombok: 3, Java: 2, Flores: 3, Komodo: 4, Sumatra: 4, Borneo: 4, Sulawesi: 4, RajaAmpat: 5, Other: 3 },
  Gili: { Bali: 2, 'Nusa Penida': 2, Gili: 0, Lombok: 1, Java: 3, Flores: 2, Komodo: 3, Sumatra: 5, Borneo: 5, Sulawesi: 4, RajaAmpat: 5, Other: 3 },
  Lombok: { Bali: 2, 'Nusa Penida': 3, Gili: 1, Lombok: 0, Java: 3, Flores: 2, Komodo: 3, Sumatra: 5, Borneo: 5, Sulawesi: 4, RajaAmpat: 5, Other: 3 },
  Java: { Bali: 2, 'Nusa Penida': 2, Gili: 3, Lombok: 3, Java: 0, Flores: 4, Komodo: 4, Sumatra: 2, Borneo: 3, Sulawesi: 3, RajaAmpat: 5, Other: 3 },
  Flores: { Bali: 3, 'Nusa Penida': 3, Gili: 2, Lombok: 2, Java: 4, Flores: 0, Komodo: 1, Sumatra: 6, Borneo: 5, Sulawesi: 4, RajaAmpat: 4, Other: 3 },
  Komodo: { Bali: 3, 'Nusa Penida': 4, Gili: 3, Lombok: 3, Java: 4, Flores: 1, Komodo: 0, Sumatra: 6, Borneo: 5, Sulawesi: 4, RajaAmpat: 4, Other: 3 },
  Sumatra: { Bali: 4, 'Nusa Penida': 4, Gili: 5, Lombok: 5, Java: 2, Flores: 6, Komodo: 6, Sumatra: 0, Borneo: 2, Sulawesi: 4, RajaAmpat: 5, Other: 3 },
  Borneo: { Bali: 4, 'Nusa Penida': 4, Gili: 5, Lombok: 5, Java: 3, Flores: 5, Komodo: 5, Sumatra: 2, Borneo: 0, Sulawesi: 3, RajaAmpat: 4, Other: 3 },
  Sulawesi: { Bali: 4, 'Nusa Penida': 4, Gili: 4, Lombok: 4, Java: 3, Flores: 4, Komodo: 4, Sumatra: 4, Borneo: 3, Sulawesi: 0, RajaAmpat: 3, Other: 3 },
  RajaAmpat: { Bali: 5, 'Nusa Penida': 5, Gili: 5, Lombok: 5, Java: 5, Flores: 4, Komodo: 4, Sumatra: 5, Borneo: 4, Sulawesi: 3, RajaAmpat: 0, Other: 3 },
  Other: { Bali: 3, 'Nusa Penida': 3, Gili: 3, Lombok: 3, Java: 3, Flores: 3, Komodo: 3, Sumatra: 3, Borneo: 3, Sulawesi: 3, RajaAmpat: 3, Other: 0 }
};

const MEMBER_COLORS = [
  '#0B8C88', '#0E7490', '#D9480F', '#A61E4D', '#2B8A3E', '#5F3DC4', '#DD6B20', '#1C7ED6'
];

let db = { trips: {} };
let saveTimer = null;

function createId(length = 8) {
  return crypto.randomBytes(length).toString('hex').slice(0, length).toUpperCase();
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeMemberName(name) {
  return String(name || '').trim().slice(0, 30);
}

function sanitizeText(value, maxLength = 140) {
  return String(value || '').trim().slice(0, maxLength);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function ensureDataFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(DATA_FILE);
  } catch {
    await fsp.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
  }
}

async function loadDb() {
  await ensureDataFile();
  const raw = await fsp.readFile(DATA_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.trips) {
      db = parsed;
    }
  } catch {
    db = { trips: {} };
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await fsp.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
  }, 120);
}

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function errorJson(res, code, message) {
  json(res, code, { error: message });
}

function getTrip(tripId) {
  return db.trips[tripId] || null;
}

function getVoteCounts(idea) {
  const votes = Object.values(idea.votes || {});
  return {
    like: votes.filter((v) => v === 'like').length,
    maybe: votes.filter((v) => v === 'maybe').length,
    no: votes.filter((v) => v === 'no').length
  };
}

function getIdeaScore(idea) {
  const counts = getVoteCounts(idea);
  return counts.like * 2 + counts.maybe - counts.no * 2;
}

function deriveIslandLabel(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Other';
  const map = {
    bali: 'Bali',
    nusa: 'Nusa Penida',
    'nusa penida': 'Nusa Penida',
    gili: 'Gili',
    lombok: 'Lombok',
    java: 'Java',
    flores: 'Flores',
    komodo: 'Komodo',
    sumatra: 'Sumatra',
    borneo: 'Borneo',
    sulawesi: 'Sulawesi',
    'raja ampat': 'RajaAmpat'
  };
  const lowered = normalized.toLowerCase();
  return map[lowered] || normalized;
}

function getMoveCost(fromIsland, toIsland) {
  if (!fromIsland || !toIsland) return 3;
  const from = deriveIslandLabel(fromIsland);
  const to = deriveIslandLabel(toIsland);
  return ISLAND_CONNECTION_COST[from]?.[to] ?? 3;
}

function chooseIslandOrder(islandScores) {
  const islands = Object.keys(islandScores);
  if (islands.length < 2) return islands;

  const ordered = [];
  islands.sort((a, b) => islandScores[b] - islandScores[a]);
  ordered.push(islands.shift());

  while (islands.length) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestTotal = Number.POSITIVE_INFINITY;

    for (let i = 0; i < islands.length; i += 1) {
      const island = islands[i];
      const moveCost = getMoveCost(last, island);
      const scoreBonus = islandScores[island] * -0.2;
      const total = moveCost + scoreBonus;
      if (total < bestTotal) {
        bestTotal = total;
        bestIdx = i;
      }
    }

    ordered.push(islands[bestIdx]);
    islands.splice(bestIdx, 1);
  }

  return ordered;
}

function allocateDaysByWeight(orderedKeys, weights, totalDays) {
  const allocation = {};
  const safeDays = Math.max(1, totalDays);

  if (!orderedKeys.length) return allocation;
  orderedKeys.forEach((key) => { allocation[key] = 0; });

  const totalWeight = orderedKeys.reduce((sum, key) => sum + (weights[key] || 1), 0) || 1;

  for (const key of orderedKeys) {
    allocation[key] = Math.floor((safeDays * (weights[key] || 1)) / totalWeight);
  }

  let assigned = Object.values(allocation).reduce((a, b) => a + b, 0);
  while (assigned < safeDays) {
    const key = orderedKeys.reduce((best, current) => {
      const bestRatio = allocation[best] / (weights[best] || 1);
      const currentRatio = allocation[current] / (weights[current] || 1);
      return currentRatio < bestRatio ? current : best;
    }, orderedKeys[0]);
    allocation[key] += 1;
    assigned += 1;
  }

  for (const key of orderedKeys) {
    if (allocation[key] < 1 && safeDays >= orderedKeys.length) {
      allocation[key] = 1;
    }
  }

  assigned = Object.values(allocation).reduce((a, b) => a + b, 0);
  while (assigned > safeDays) {
    const key = orderedKeys
      .filter((k) => allocation[k] > 1)
      .sort((a, b) => allocation[b] - allocation[a])[0];
    if (!key) break;
    allocation[key] -= 1;
    assigned -= 1;
  }

  return allocation;
}

function generateItinerary(trip, daysInput) {
  const days = Math.max(1, Number(daysInput || trip.days || 14));
  const scored = trip.ideas
    .map((idea) => {
      const counts = getVoteCounts(idea);
      const score = getIdeaScore(idea);
      return { ...idea, counts, score };
    })
    .filter((idea) => idea.counts.like + idea.counts.maybe + idea.counts.no > 0)
    .sort((a, b) => b.score - a.score);

  const selected = scored.filter((idea) => idea.score > 0 && idea.counts.like >= idea.counts.no);
  const fallback = scored.slice(0, Math.min(scored.length, days * 2));
  const candidates = selected.length ? selected : fallback;

  if (!candidates.length) {
    return {
      generatedAt: nowIso(),
      days,
      summary: 'Ajoutez des idees puis des votes pour generer un itineraire.',
      suggestions: ['Proposez au moins 6 a 10 idees pour un voyage de 14 jours.'],
      plan: []
    };
  }

  const byIsland = {};
  for (const idea of candidates) {
    const island = deriveIslandLabel(idea.island || idea.location || 'Other');
    if (!byIsland[island]) byIsland[island] = [];
    byIsland[island].push(idea);
  }

  const islandScores = {};
  for (const [island, ideas] of Object.entries(byIsland)) {
    islandScores[island] = ideas.reduce((sum, idea) => sum + Math.max(idea.score, 1), 0);
  }

  const orderedIslands = chooseIslandOrder(islandScores);
  const islandDayAllocation = allocateDaysByWeight(orderedIslands, islandScores, days);

  const plan = [];
  let dayNumber = 1;
  let previousIsland = null;

  for (const island of orderedIslands) {
    const islandIdeas = byIsland[island]
      .sort((a, b) => b.score - a.score)
      .map((idea) => ({
        ideaId: idea.id,
        title: idea.title,
        type: idea.type,
        location: idea.location,
        zone: idea.zone,
        notes: idea.notes,
        score: idea.score,
        votes: idea.counts
      }));

    const islandDays = islandDayAllocation[island] || 1;
    const buckets = Array.from({ length: islandDays }, () => []);

    islandIdeas.forEach((idea, index) => {
      buckets[index % islandDays].push(idea);
    });

    for (let i = 0; i < islandDays && dayNumber <= days; i += 1) {
      const dayIdeas = buckets[i].slice(0, 4);
      const moveNote = previousIsland && previousIsland !== island
        ? `Trajet recommande: ${previousIsland} -> ${island}`
        : null;
      const zoneHint = dayIdeas[0]?.zone || dayIdeas[0]?.location || island;

      plan.push({
        day: dayNumber,
        island,
        zoneHint,
        moveNote,
        items: dayIdeas,
        intensity: dayIdeas.length >= 4 ? 'Soutenu' : dayIdeas.length >= 2 ? 'Equilibre' : 'Relax'
      });

      previousIsland = island;
      dayNumber += 1;
    }
  }

  while (plan.length < days) {
    const previous = plan[plan.length - 1];
    plan.push({
      day: plan.length + 1,
      island: previous?.island || 'Libre',
      zoneHint: 'Buffer / repos',
      moveNote: null,
      items: [],
      intensity: 'Relax'
    });
  }

  const islandCount = orderedIslands.length;
  const suggestions = [];
  if (islandCount > 3 && days <= 14) {
    suggestions.push('Vous avez beaucoup d\'iles: reduire a 2-3 iles limitera les trajets fatigants.');
  }
  suggestions.push('Conservez 1 jour tampon avant le vol retour pour limiter le risque logistique.');
  suggestions.push('Regroupez les activites marines les jours de meteo stable et gardez une alternative terre.');

  return {
    generatedAt: nowIso(),
    days,
    summary: `${candidates.length} idees retenues, ${orderedIslands.length} zone(s) principale(s).`,
    suggestions,
    plan
  };
}

function toClientTrip(trip) {
  return {
    id: trip.id,
    name: trip.name,
    days: trip.days,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    members: trip.members,
    ideas: trip.ideas.map((idea) => ({
      ...idea,
      counts: getVoteCounts(idea),
      score: getIdeaScore(idea)
    })),
    itinerary: trip.itinerary || null
  };
}

function broadcastTripUpdate(tripId) {
  const trip = getTrip(tripId);
  if (!trip) return;

  const payload = JSON.stringify({ type: 'trip-update', trip: toClientTrip(trip) });
  const clients = sseClients.get(tripId);
  if (!clients) return;

  for (const res of clients) {
    res.write(`event: trip-update\n`);
    res.write(`data: ${payload}\n\n`);
  }
}

function attachSse(req, res, tripId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  if (!sseClients.has(tripId)) {
    sseClients.set(tripId, new Set());
  }

  const clients = sseClients.get(tripId);
  clients.add(res);

  res.write('event: ping\n');
  res.write(`data: ${JSON.stringify({ at: nowIso() })}\n\n`);

  const keepAlive = setInterval(() => {
    res.write('event: ping\n');
    res.write(`data: ${JSON.stringify({ at: nowIso() })}\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
    if (!clients.size) sseClients.delete(tripId);
  });
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (indexErr, data) => {
        if (indexErr) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.webmanifest': 'application/manifest+json'
    };

    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApi(req, res, pathname) {
  const parts = pathname.split('/').filter(Boolean);

  if (req.method === 'POST' && pathname === '/api/trips') {
    const body = await parseBody(req);
    const name = sanitizeText(body.name || 'Roadtrip Indonesie', 50) || 'Roadtrip Indonesie';
    const days = Math.max(3, Math.min(30, Number(body.days || 14)));
    const creatorName = sanitizeMemberName(body.creatorName || 'Voyageur');

    if (!creatorName) {
      errorJson(res, 400, 'Nom createur requis.');
      return;
    }

    let tripId = createId(6);
    while (db.trips[tripId]) tripId = createId(6);

    const memberId = createId(10);
    const trip = {
      id: tripId,
      name,
      days,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      members: [{
        id: memberId,
        name: creatorName,
        color: MEMBER_COLORS[0]
      }],
      ideas: [],
      itinerary: null
    };

    db.trips[tripId] = trip;
    scheduleSave();

    json(res, 201, {
      trip: toClientTrip(trip),
      member: trip.members[0],
      inviteCode: tripId
    });
    return;
  }

  if (parts.length >= 3 && parts[0] === 'api' && parts[1] === 'trips') {
    const tripId = parts[2].toUpperCase();
    const trip = getTrip(tripId);
    if (!trip) {
      errorJson(res, 404, 'Trip introuvable.');
      return;
    }

    if (req.method === 'GET' && parts.length === 3) {
      json(res, 200, { trip: toClientTrip(trip) });
      return;
    }

    if (req.method === 'GET' && parts.length === 4 && parts[3] === 'events') {
      attachSse(req, res, tripId);
      return;
    }

    if (req.method === 'POST' && parts.length === 4 && parts[3] === 'join') {
      const body = await parseBody(req);
      const name = sanitizeMemberName(body.name || 'Voyageur');
      if (!name) {
        errorJson(res, 400, 'Nom requis.');
        return;
      }

      const existing = trip.members.find((m) => m.name.toLowerCase() === name.toLowerCase());
      let member = existing;

      if (!member) {
        member = {
          id: createId(10),
          name,
          color: MEMBER_COLORS[trip.members.length % MEMBER_COLORS.length]
        };
        trip.members.push(member);
        trip.updatedAt = nowIso();
        scheduleSave();
        broadcastTripUpdate(trip.id);
      }

      json(res, 200, { member, trip: toClientTrip(trip) });
      return;
    }

    if (req.method === 'POST' && parts.length === 4 && parts[3] === 'ideas') {
      const body = await parseBody(req);
      const memberId = sanitizeText(body.memberId, 20);
      const member = trip.members.find((m) => m.id === memberId);
      if (!member) {
        errorJson(res, 403, 'Membre inconnu.');
        return;
      }

      const title = sanitizeText(body.title, 100);
      const type = sanitizeText(body.type, 40) || 'Activite';
      const island = sanitizeText(body.island, 40) || 'Bali';
      const location = sanitizeText(body.location, 80);
      const zone = sanitizeText(body.zone, 80);
      const notes = sanitizeText(body.notes, 240);

      if (!title) {
        errorJson(res, 400, 'Titre requis.');
        return;
      }

      const idea = {
        id: createId(10),
        title,
        type,
        island,
        location,
        zone,
        notes,
        createdBy: member.id,
        createdByName: member.name,
        createdAt: nowIso(),
        votes: {}
      };

      trip.ideas.unshift(idea);
      trip.updatedAt = nowIso();
      scheduleSave();
      broadcastTripUpdate(trip.id);
      json(res, 201, { idea });
      return;
    }

    if (req.method === 'POST' && parts.length === 4 && parts[3] === 'votes') {
      const body = await parseBody(req);
      const memberId = sanitizeText(body.memberId, 20);
      const ideaId = sanitizeText(body.ideaId, 20);
      const choice = sanitizeText(body.choice, 10);
      if (!['like', 'maybe', 'no'].includes(choice)) {
        errorJson(res, 400, 'Vote invalide.');
        return;
      }

      const member = trip.members.find((m) => m.id === memberId);
      if (!member) {
        errorJson(res, 403, 'Membre inconnu.');
        return;
      }

      const idea = trip.ideas.find((i) => i.id === ideaId);
      if (!idea) {
        errorJson(res, 404, 'Idee introuvable.');
        return;
      }

      idea.votes[member.id] = choice;
      trip.updatedAt = nowIso();
      scheduleSave();
      broadcastTripUpdate(trip.id);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && parts.length === 5 && parts[3] === 'itinerary' && parts[4] === 'generate') {
      const body = await parseBody(req);
      const days = Math.max(1, Math.min(30, Number(body.days || trip.days || 14)));
      trip.days = days;
      trip.itinerary = generateItinerary(trip, days);
      trip.updatedAt = nowIso();
      scheduleSave();
      broadcastTripUpdate(trip.id);
      json(res, 200, { itinerary: trip.itinerary, trip: toClientTrip(trip) });
      return;
    }
  }

  errorJson(res, 404, 'Endpoint introuvable.');
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    if (pathname === '/healthz') {
      json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
      return;
    }

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      errorJson(res, 500, 'Erreur interne serveur.');
    } else {
      res.end();
    }
  }
});

(async () => {
  await loadDb();
  server.listen(PORT, HOST, () => {
    console.log(`IndoTrip app running on http://${HOST}:${PORT}`);
  });
})();
