const state = {
  trip: null,
  member: null,
  eventSource: null,
  deferredInstallPrompt: null
};

const onboardingEl = document.getElementById('onboarding');
const workspaceEl = document.getElementById('workspace');
const createTripForm = document.getElementById('createTripForm');
const joinTripForm = document.getElementById('joinTripForm');
const ideaForm = document.getElementById('ideaForm');
const membersList = document.getElementById('membersList');
const ideasList = document.getElementById('ideasList');
const itineraryBlock = document.getElementById('itineraryBlock');
const tripTitle = document.getElementById('tripTitle');
const tripMeta = document.getElementById('tripMeta');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const generateBtn = document.getElementById('generateBtn');
const daysInput = document.getElementById('daysInput');
const toastEl = document.getElementById('toast');
const installBtn = document.getElementById('installBtn');

const voteLabels = {
  like: '✅ Je veux',
  maybe: '🤷 Pourquoi pas',
  no: '❌ Non'
};

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastEl.__timer);
  toastEl.__timer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || 'Erreur reseau');
  }
  return payload;
}

function memberStorageKey(tripId) {
  return `indotrip_member_${tripId}`;
}

function saveMemberLocally(tripId, member) {
  localStorage.setItem(memberStorageKey(tripId), JSON.stringify(member));
}

function loadMemberLocally(tripId) {
  const raw = localStorage.getItem(memberStorageKey(tripId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setTrip(trip, member) {
  state.trip = trip;
  state.member = member;
  saveMemberLocally(trip.id, member);

  const next = new URL(window.location.href);
  next.searchParams.set('trip', trip.id);
  history.replaceState({}, '', next);

  render();
  connectEvents();
}

function renderMembers() {
  membersList.innerHTML = '';
  state.trip.members.forEach((member) => {
    const chip = document.createElement('div');
    chip.className = 'member-chip';
    chip.innerHTML = `
      <span class="member-dot" style="background:${member.color}"></span>
      <span>${member.name}${member.id === state.member.id ? ' (toi)' : ''}</span>
    `;
    membersList.appendChild(chip);
  });
}

function scoreClass(score) {
  if (score >= 3) return 'var(--good)';
  if (score <= -1) return 'var(--bad)';
  return 'var(--meh)';
}

function renderIdeas() {
  ideasList.innerHTML = '';

  if (!state.trip.ideas.length) {
    ideasList.innerHTML = '<p class="sub">Aucune idee pour le moment. Lancez la premiere proposition.</p>';
    return;
  }

  const sorted = [...state.trip.ideas].sort((a, b) => b.score - a.score);

  sorted.forEach((idea) => {
    const myVote = idea.votes?.[state.member.id] || null;

    const card = document.createElement('article');
    card.className = 'idea-card';
    card.innerHTML = `
      <div class="idea-head">
        <div>
          <p class="idea-title">${escapeHtml(idea.title)}</p>
          <p class="idea-meta">${escapeHtml(idea.type)} • ${escapeHtml(idea.island || 'Autre')} • ${escapeHtml(idea.zone || idea.location || 'zone libre')} • propose par ${escapeHtml(idea.createdByName)}</p>
          ${idea.notes ? `<p class="idea-meta">${escapeHtml(idea.notes)}</p>` : ''}
        </div>
        <span class="score-pill" style="color:${scoreClass(idea.score)};">Score ${idea.score}</span>
      </div>
      <div class="vote-row" data-idea-id="${idea.id}">
        <button class="vote-btn ${myVote === 'like' ? 'active like' : ''}" data-choice="like">${voteLabels.like} (${idea.counts.like})</button>
        <button class="vote-btn ${myVote === 'maybe' ? 'active maybe' : ''}" data-choice="maybe">${voteLabels.maybe} (${idea.counts.maybe})</button>
        <button class="vote-btn ${myVote === 'no' ? 'active no' : ''}" data-choice="no">${voteLabels.no} (${idea.counts.no})</button>
      </div>
    `;

    ideasList.appendChild(card);
  });
}

function renderItinerary() {
  itineraryBlock.innerHTML = '';
  const itinerary = state.trip.itinerary;
  if (!itinerary) {
    itineraryBlock.innerHTML = '<p class="sub">Pas encore genere. Cliquez sur "Generer automatiquement" quand les votes sont prets.</p>';
    return;
  }

  const head = document.createElement('div');
  head.className = 'day-card';
  head.innerHTML = `
    <p class="day-title">Plan ${itinerary.days} jours</p>
    <p class="day-meta">${escapeHtml(itinerary.summary)} • genere le ${new Date(itinerary.generatedAt).toLocaleString('fr-FR')}</p>
    <ul class="item-list">${(itinerary.suggestions || []).map((s) => `<li><span>💡</span><span>${escapeHtml(s)}</span></li>`).join('')}</ul>
  `;
  itineraryBlock.appendChild(head);

  (itinerary.plan || []).forEach((day) => {
    const card = document.createElement('article');
    card.className = 'day-card';
    const itemsHtml = (day.items || []).length
      ? `<ul class="item-list">${day.items.map((item) => `<li><span>•</span><span>${escapeHtml(item.title)} <span class="badge">${escapeHtml(item.type || 'idee')}</span> <span class="badge">${escapeHtml(item.zone || item.location || day.island)}</span></span></li>`).join('')}</ul>`
      : '<p class="day-meta">Jour leger: repos, transferts, impro.</p>';

    card.innerHTML = `
      <div class="day-head">
        <p class="day-title">Jour ${day.day} • ${escapeHtml(day.island)}</p>
        <span class="badge">${escapeHtml(day.intensity || 'Equilibre')}</span>
      </div>
      <p class="day-meta">Base: ${escapeHtml(day.zoneHint || day.island)}${day.moveNote ? ` • ${escapeHtml(day.moveNote)}` : ''}</p>
      ${itemsHtml}
    `;
    itineraryBlock.appendChild(card);
  });
}

function render() {
  if (!state.trip || !state.member) {
    onboardingEl.classList.add('show');
    workspaceEl.classList.remove('show');
    return;
  }

  onboardingEl.classList.remove('show');
  workspaceEl.classList.add('show');

  tripTitle.textContent = state.trip.name;
  tripMeta.textContent = `${state.trip.days} jours • code ${state.trip.id} • ${state.trip.ideas.length} idee(s)`;
  daysInput.value = state.trip.days;

  renderMembers();
  renderIdeas();
  renderItinerary();
}

function connectEvents() {
  if (!state.trip) return;
  if (state.eventSource) {
    state.eventSource.close();
  }

  state.eventSource = new EventSource(`/api/trips/${state.trip.id}/events`);
  state.eventSource.addEventListener('trip-update', (event) => {
    const payload = JSON.parse(event.data);
    if (payload?.trip?.id === state.trip.id) {
      state.trip = payload.trip;
      render();
    }
  });

  state.eventSource.onerror = () => {
    setTimeout(async () => {
      if (!state.trip) return;
      try {
        const data = await api('GET', `/api/trips/${state.trip.id}`);
        state.trip = data.trip;
        render();
      } catch {
        // no-op
      }
      connectEvents();
    }, 1500);
  };
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function bootstrapFromUrl() {
  const tripId = new URL(window.location.href).searchParams.get('trip')?.toUpperCase();
  if (!tripId) {
    render();
    return;
  }

  try {
    const data = await api('GET', `/api/trips/${tripId}`);
    const localMember = loadMemberLocally(tripId);

    if (localMember && data.trip.members.some((m) => m.id === localMember.id)) {
      setTrip(data.trip, localMember);
      toast('Voyage charge');
      return;
    }

    joinTripForm.tripCode.value = tripId;
    render();
    toast('Entrez votre prenom pour rejoindre ce voyage');
  } catch (err) {
    toast(err.message);
  }
}

createTripForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(createTripForm);

  try {
    const payload = await api('POST', '/api/trips', {
      name: formData.get('tripName'),
      days: Number(formData.get('days')),
      creatorName: formData.get('creatorName')
    });
    setTrip(payload.trip, payload.member);
    toast('Voyage cree. Partage le lien avec tes amis.');
  } catch (err) {
    toast(err.message);
  }
});

joinTripForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(joinTripForm);
  const tripCode = String(formData.get('tripCode')).trim().toUpperCase();
  const joinName = String(formData.get('joinName')).trim();

  if (!tripCode || !joinName) {
    toast('Code et prenom requis');
    return;
  }

  try {
    const payload = await api('POST', `/api/trips/${tripCode}/join`, { name: joinName });
    setTrip(payload.trip, payload.member);
    toast('Connexion reussie');
  } catch (err) {
    toast(err.message);
  }
});

ideaForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.trip || !state.member) return;

  const formData = new FormData(ideaForm);
  try {
    await api('POST', `/api/trips/${state.trip.id}/ideas`, {
      memberId: state.member.id,
      title: formData.get('title'),
      type: formData.get('type'),
      island: formData.get('island'),
      zone: formData.get('zone'),
      notes: formData.get('notes')
    });

    ideaForm.reset();
    ideaForm.island.value = 'Bali';
    ideaForm.type.value = 'Lieu';
    toast('Idee ajoutee');
  } catch (err) {
    toast(err.message);
  }
});

ideasList.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-choice]');
  if (!btn || !state.trip || !state.member) return;

  const row = btn.closest('[data-idea-id]');
  if (!row) return;
  const ideaId = row.getAttribute('data-idea-id');
  const choice = btn.getAttribute('data-choice');

  try {
    await api('POST', `/api/trips/${state.trip.id}/votes`, {
      memberId: state.member.id,
      ideaId,
      choice
    });
  } catch (err) {
    toast(err.message);
  }
});

generateBtn.addEventListener('click', async () => {
  if (!state.trip) return;
  const days = Number(daysInput.value || state.trip.days || 14);

  try {
    const payload = await api('POST', `/api/trips/${state.trip.id}/itinerary/generate`, { days });
    state.trip = payload.trip;
    render();
    toast('Itineraire genere');
  } catch (err) {
    toast(err.message);
  }
});

copyLinkBtn.addEventListener('click', async () => {
  if (!state.trip) return;
  const shareLink = `${window.location.origin}?trip=${state.trip.id}`;
  try {
    await navigator.clipboard.writeText(shareLink);
    toast('Lien copie');
  } catch {
    toast(shareLink);
  }
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (!state.deferredInstallPrompt) {
    toast('Sur iPhone: Safari > Partager > Sur l\'ecran d\'accueil');
    return;
  }

  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  installBtn.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}

bootstrapFromUrl();
