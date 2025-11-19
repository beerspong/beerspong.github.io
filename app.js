import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBAiHzBLpd4LQeSUXanpm4_MDZt71Ay9is",
  authDomain: "beer-pong-82587.firebaseapp.com",
  projectId: "beer-pong-82587",
  storageBucket: "beer-pong-82587.firebasestorage.app",
  messagingSenderId: "517207306268",
  appId: "1:517207306268:web:f2a8c70c56b05b0b71afd9",
};

const devMode = false;
const useLocalFallback = false;
const ACTIVE_TOURNAMENT_STORAGE_KEYS = {
  single: 'activeTournamentSingle',
  double: 'activeTournamentDouble',
};
const ACTIVE_TOURNAMENT_DOCS = {
  single: 'single',
  double: 'double',
};
const CUP_OPTIONS = ['unknown', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const BYE_SOURCE = { type: 'bye' };
const hideBYES = true; // toggle this flag to show/hide BYE matches in brackets

class DataStore {
  constructor() {
    this.playerKey = 'beerPongPlayers';
    this.eventKey = 'beerPongEvents';
    this.players = [];
    this.events = [];
    this.firebaseApp = null;
    this.db = null;
    this.auth = null;
    this.useLocal = useLocalFallback;
  }

  async init() {
    if (this.useLocal) {
      this.loadLocal();
      return;
    }
    try {
      if (!this.firebaseApp) {
        this.firebaseApp = initializeApp(firebaseConfig);
        this.db = getFirestore(this.firebaseApp);
        this.auth = getAuth(this.firebaseApp);
        await signInAnonymously(this.auth);
      }
      await this.refreshRemote();
    } catch (error) {
      console.error('Firebase init failed, falling back to local storage', error);
      this.useLocal = true;
      this.loadLocal();
    }
  }

  loadLocal() {
    this.players = this.read(this.playerKey);
    this.loadLocalEvents();
  }

  async refreshRemote() {
    if (this.useLocal) {
      this.loadLocal();
      return;
    }
    const [playerSnap, eventSnap] = await Promise.all([
      getDocs(collection(this.db, 'players')),
      getDocs(collection(this.db, 'events')),
    ]);
    this.players = playerSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.events = eventSnap.docs
      .map((docSnap) => deserializeEvent({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      console.error('Unable to parse stored data', error);
      return [];
    }
  }

  persist(key, value) {
    if (!this.useLocal) return;
    localStorage.setItem(key, JSON.stringify(value));
  }

  loadLocalEvents() {
    this.events = this.read(this.eventKey)
      .map(deserializeEvent)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  persistLocalEvents() {
    if (!this.useLocal) return;
    try {
      localStorage.setItem(this.eventKey, JSON.stringify(this.events));
    } catch (error) {
      console.error('Unable to persist events', error);
    }
  }

  async getPlayers() {
    return [...this.players];
  }

  async addPlayer(name) {
    const record = { name, createdAt: Date.now() };
    let player;
    if (this.useLocal) {
      player = { id: crypto.randomUUID(), ...record };
      this.players.push(player);
      this.players.sort((a, b) => a.name.localeCompare(b.name));
      this.persist(this.playerKey, this.players);
    } else {
      const playersRef = collection(this.db, 'players');
      const docRef = doc(playersRef);
      player = { id: docRef.id, ...record };
      await setDoc(docRef, player);
      this.players.push(player);
      this.players.sort((a, b) => a.name.localeCompare(b.name));
    }
    return player;
  }

  async deletePlayer(id) {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.useLocal) {
      this.persist(this.playerKey, this.players);
    } else {
      await deleteDoc(doc(this.db, 'players', id));
    }
  }

  async renamePlayer(id, newName) {
    const player = this.players.find((p) => p.id === id);
    if (!player) return;
    player.name = newName;
    if (this.useLocal) {
      this.persist(this.playerKey, this.players);
    } else {
      await setDoc(doc(this.db, 'players', id), player);
    }
    await this.updateEventsForRename(id);
  }

  async getEvents() {
    return [...this.events];
  }

  async addEvent(event) {
    const record = { ...event, createdAt: event.createdAt ?? Date.now() };
    if (!record.id) {
      record.id = crypto.randomUUID();
    }
    this.events.push(record);
    this.events.sort((a, b) => b.createdAt - a.createdAt);
    if (this.useLocal) {
      this.persistLocalEvents();
    } else if (this.db) {
      const eventsRef = doc(this.db, 'events', record.id);
      await setDoc(eventsRef, serializeEvent(record));
    }
    return record;
  }

  async updateEvent(eventId, updater) {
    const index = this.events.findIndex((e) => e.id === eventId);
    if (index === -1) return;
    const updated = updater(this.events[index]);
    this.events[index] = updated;
    this.events.sort((a, b) => b.createdAt - a.createdAt);
    if (this.useLocal) {
      this.persistLocalEvents();
    } else if (this.db) {
      const docRef = doc(this.db, 'events', eventId);
      await setDoc(docRef, serializeEvent(updated));
    }
  }

  async deleteEvent(event) {
    if (!event) return;
    const eventId = event.id;
    this.events = this.events.filter((entry) => entry.id !== eventId);
    if (this.useLocal) {
      this.persistLocalEvents();
    } else if (this.db) {
      try {
        await deleteDoc(doc(this.db, 'events', eventId));
      } catch (error) {
        console.error('Unable to delete event', error);
      }
      try {
        const backup = serializeEvent({
          ...event,
          deletedAt: Date.now(),
        });
        const docId = eventId || crypto.randomUUID();
        await setDoc(doc(this.db, 'deletedEvents', docId), backup);
      } catch (error) {
        console.error('Unable to archive deleted event', error);
      }
    } else {
      this.persistLocalEvents();
    }
  }

  async updateEventsForRename(playerId) {
    if (!this.events.length) return;
    const playerMap = new Map(this.players.map((player) => [player.id, player.name]));
    const changedEvents = [];
    this.events = this.events.map((event) => {
      const { changed, event: updated } = applyRenameToEvent(event, playerId, playerMap);
      if (changed) changedEvents.push(updated);
      return updated;
    });
    if (!changedEvents.length) return;
    if (this.useLocal) {
      this.persistLocalEvents();
      return;
    }
    if (!this.db) return;
    await Promise.all(
      changedEvents.map((event) => {
        const docRef = doc(this.db, 'events', event.id);
        return setDoc(docRef, serializeEvent(event));
      })
    );
  }
}

const store = new DataStore();
const tournamentListeners = {
  single: null,
  double: null,
};
let currentSoloSeedSelection = [];
let dragSlotContext = null;

function useLocalTournamentPersistence() {
  return devMode || store.useLocal;
}

function serializeEvent(event) {
  if (!event?.data?.tournament) return deepClone(event);
  const clone = deepClone(event);
  clone.data.tournament = serializeTournament(clone.data.tournament);
  return clone;
}

function deserializeEvent(event) {
  if (!event?.data?.tournament) return deepClone(event);
  return {
    ...event,
    data: {
      ...event.data,
      tournament: deserializeTournament(event.data.tournament),
    },
  };
}

function serializeTournament(tournament) {
  if (!tournament?.rounds) return tournament;
  const clone = deepClone(tournament);
  clone.rounds = serializeRounds(clone.rounds);
  clone.scores = clone.scores || {};
  clone.manualSlots = clone.manualSlots || {};
  return clone;
}

function deserializeTournament(tournament) {
  if (!tournament?.rounds) return tournament;
  const deserialized = {
    ...tournament,
    rounds: deserializeRounds(tournament.rounds),
    scores: tournament.scores || {},
    manualSlots: tournament.manualSlots || {},
  };
  return deserialized;
}

function serializeRounds(rounds) {
  const convert = (collection) => {
    if (!Array.isArray(collection)) return collection || {};
    const map = {};
    collection.forEach((round, index) => {
      map[index] = round;
    });
    return map;
  };
  return {
    winners: convert(rounds.winners || []),
    losers: convert(rounds.losers || []),
    final: convert(rounds.final || []),
  };
}

function deserializeRounds(rounds) {
  const convert = (value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => value[key]);
    }
    return [];
  };
  return {
    winners: convert(rounds.winners),
    losers: convert(rounds.losers),
    final: convert(rounds.final),
  };
}

function applyRenameToEvent(event, playerId, playerMap) {
  let changed = false;
  const clone = deepClone(event);
  if (clone.type === 'duel') {
    const { playerA, playerB } = clone.data || {};
    if (playerA === playerId || playerB === playerId) {
      const nameA = playerMap.get(playerA) || '?';
      const nameB = playerMap.get(playerB) || '?';
      clone.title = `${nameA} vs ${nameB}`;
      changed = true;
    }
  }
  const tournamentPlayers = clone.data?.tournament?.players;
  if (Array.isArray(tournamentPlayers)) {
    const updatedPlayers = tournamentPlayers.map((player) => {
      let next = player;
      if (player.id === playerId && player.name !== playerMap.get(playerId)) {
        next = { ...next, name: playerMap.get(playerId) };
        changed = true;
      }
      if (player.members?.length) {
        let memberChanged = false;
        const updatedMembers = player.members.map((member) => {
          if (member.playerId === playerId && member.name !== playerMap.get(playerId)) {
            memberChanged = true;
            return { ...member, name: playerMap.get(playerId) };
          }
          return member;
        });
        if (memberChanged) {
          next = { ...next, members: updatedMembers };
          changed = true;
        }
      }
      return next;
    });
    clone.data.tournament.players = updatedPlayers;
  }
  return { event: clone, changed };
}

function loadActiveTournamentState(format) {
  if (!useLocalTournamentPersistence()) return null;
  const key = ACTIVE_TOURNAMENT_STORAGE_KEYS[format];
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.state) return null;
    const state = deserializeTournament(parsed.state);
    if (!state) return null;
    return {
      state,
      title: parsed.title,
      createdAt: parsed.createdAt,
      eventId: parsed.eventId || null,
      style: parsed.style || 'solo',
    };
  } catch (error) {
    console.error('Unable to parse stored tournament state', error);
    localStorage.removeItem(key);
    return null;
  }
}

function persistActiveTournamentState(format) {
  const context = appState.activeTournaments[format];
  if (useLocalTournamentPersistence()) {
    const key = ACTIVE_TOURNAMENT_STORAGE_KEYS[format];
    if (!context || context.eventId) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(
      key,
      JSON.stringify({
        state: serializeTournament(context.state),
        title: context.title,
        createdAt: context.createdAt,
        eventId: context.eventId || null,
        style: context.style,
      })
    );
    return;
  }
  if (!store.db) return;
  const docRef = doc(store.db, 'activeTournaments', ACTIVE_TOURNAMENT_DOCS[format]);
  if (!context || context.eventId) {
    deleteDoc(docRef).catch((error) => console.error('Unable to clear active tournament', error));
    return;
  }
  const payload = {
    title: context.title,
    createdAt: context.createdAt,
    eventId: context.eventId || null,
    style: context.style,
    state: serializeTournament(context.state),
    updatedAt: Date.now(),
  };
  setDoc(docRef, payload).catch((error) => console.error('Unable to persist active tournament', error));
}

function clearActiveTournamentState(format) {
  appState.activeTournaments[format] = null;
  if (useLocalTournamentPersistence()) {
    localStorage.removeItem(ACTIVE_TOURNAMENT_STORAGE_KEYS[format]);
  } else if (store.db) {
    const docRef = doc(store.db, 'activeTournaments', ACTIVE_TOURNAMENT_DOCS[format]);
    deleteDoc(docRef).catch((error) => console.error('Unable to clear active tournament', error));
  }
}

function renamePlayerInActiveTournaments(playerId, newName) {
  ['single', 'double'].forEach((format) => {
    const context = appState.activeTournaments[format];
    if (!context) return;
    let changed = false;
    context.state.players = context.state.players.map((player) => {
      let next = player;
      if (player.id === playerId && player.name !== newName) {
        next = { ...next, name: newName };
        changed = true;
      }
      if (player.members?.length) {
        let memberChanged = false;
        const updatedMembers = player.members.map((member) => {
          if (member.playerId === playerId && member.name !== newName) {
            memberChanged = true;
            return { ...member, name: newName };
          }
          return member;
        });
        if (memberChanged) {
          next = { ...next, members: updatedMembers };
          changed = true;
        }
      }
      return next;
    });
    if (changed) {
      persistActiveTournamentState(format);
    }
  });
}

function getTournamentWinnerId(state) {
  if (!state?.rounds) return null;
  if (state.bracketType === 'double' && state.rounds.final?.length) {
    const finalRound = state.rounds.final[state.rounds.final.length - 1];
    if (finalRound?.length) {
      const finalMatchId = finalRound[finalRound.length - 1];
      return state.results[finalMatchId] || null;
    }
  }
  const winnersFinal = state.rounds.winners?.[state.rounds.winners.length - 1];
  if (winnersFinal?.length) {
    const finalMatchId = winnersFinal[winnersFinal.length - 1];
    return state.results[finalMatchId] || null;
  }
  return null;
}

function getMatchScoreValue(state, matchId, playerId, memberId) {
  if (!state?.scores || !matchId || !playerId) return 'unknown';
  const entry = state.scores?.[matchId]?.[playerId];
  if (!entry) return 'unknown';
  if (memberId) {
    if (typeof entry === 'object' && entry !== null) {
      return entry[memberId] || 'unknown';
    }
    if (typeof entry === 'string') {
      return entry;
    }
    return 'unknown';
  }
  if (typeof entry === 'object') {
    return entry.value ?? 'unknown';
  }
  return entry;
}

function getParticipantMembersList(participant) {
  if (!participant) return [];
  if (Array.isArray(participant.members) && participant.members.length) {
    return participant.members;
  }
  return [{ playerId: participant.id }];
}

function calculateParticipantScoreTotal(state, matchId, participant) {
  if (!participant) return null;
  const members = getParticipantMembersList(participant);
  if (!members.length) return null;
  let total = 0;
  for (const member of members) {
    const scoreValue = getMatchScoreValue(state, matchId, participant.id, member.playerId);
    const parsed = parseCupSelection(scoreValue);
    if (parsed === null) return null;
    total += parsed;
  }
  return total;
}

function attemptAutoSetTournamentWinner(format, matchId) {
  const context = appState.activeTournaments[format];
  if (!context) return;
  const match = context.state.matches[matchId];
  if (!match) return;
  const slot1 = TournamentEngine.getSlotInfo(context.state, match, 'source1');
  const slot2 = TournamentEngine.getSlotInfo(context.state, match, 'source2');
  if (!slot1.player || !slot2.player) return;
  const total1 = calculateParticipantScoreTotal(context.state, matchId, slot1.player);
  const total2 = calculateParticipantScoreTotal(context.state, matchId, slot2.player);
  if (total1 === null || total2 === null || total1 === total2) return;
  const winnerId = total1 > total2 ? slot1.player.id : slot2.player.id;
  if (context.state.results[matchId] === winnerId) return;
  updateTournamentWinner(format, matchId, winnerId);
}

function formatCupValue(value) {
  return !value || value === 'unknown' ? '?' : value;
}

function parseCupSelection(value) {
  if (value === undefined || value === null || value === '' || value === 'unknown') {
    return null;
  }
  const numeric = parseInt(value, 10);
  return Number.isNaN(numeric) ? null : numeric;
}

function populateCupSelect(select) {
  if (!select) return;
  const previous = select.value || 'unknown';
  select.innerHTML = '';
  CUP_OPTIONS.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value === 'unknown' ? '?' : value;
    select.appendChild(option);
  });
  select.value = previous;
}

function refreshDuelSelectors() {
  populatePlayerSelect(duelPlayerA, [duelPlayerB.value].filter(Boolean));
  populatePlayerSelect(duelPlayerB, [duelPlayerA.value].filter(Boolean));
  updateDuelWinnerOptions();
  autoSelectDuelWinner();
}

function refreshDoublesSelectors() {
  const current = {
    a1: doublesPlayers.a1.value,
    a2: doublesPlayers.a2.value,
    b1: doublesPlayers.b1.value,
    b2: doublesPlayers.b2.value,
  };
  Object.entries(doublesPlayers).forEach(([key, select]) => {
    const exclude = Object.entries(current)
      .filter(([otherKey]) => otherKey !== key)
      .map(([, value]) => value)
      .filter(Boolean);
    populatePlayerSelect(select, exclude);
  });
  updateDoublesWinnerOptions();
  autoSelectDoublesWinner();
}

function populatePlayerSelect(select, exclude = []) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '<option value="">Select player</option>';
  appState.players
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((player) => !exclude.includes(player.id))
    .forEach((player) => {
      const option = document.createElement('option');
      option.value = player.id;
      option.textContent = player.name;
      select.appendChild(option);
    });
  if (previous && appState.players.some((p) => p.id === previous)) {
    select.value = previous;
  }
}

const views = {
  players: document.getElementById('view-players'),
  duel: document.getElementById('view-duel'),
  doubles: document.getElementById('view-doubles'),
  tournament: document.getElementById('view-tournament'),
  history: document.getElementById('view-history'),
};

const navButtons = document.querySelectorAll('.nav-btn');
const playerForm = document.getElementById('player-form');
const playerInput = document.getElementById('player-name');
const playerList = document.getElementById('player-list');
const duelForm = document.getElementById('duel-form');
const duelPlayerA = document.getElementById('duel-player-a');
const duelPlayerB = document.getElementById('duel-player-b');
const duelScoreA = document.getElementById('duel-score-a');
const duelScoreB = document.getElementById('duel-score-b');
const duelWinner = document.getElementById('duel-winner');
const duelMessage = document.getElementById('duel-message');
const doublesForm = document.getElementById('doubles-form');
const doublesPlayers = {
  a1: document.getElementById('doubles-player-a1'),
  a2: document.getElementById('doubles-player-a2'),
  b1: document.getElementById('doubles-player-b1'),
  b2: document.getElementById('doubles-player-b2'),
};
const doublesScores = {
  a1: document.getElementById('doubles-score-a1'),
  a2: document.getElementById('doubles-score-a2'),
  b1: document.getElementById('doubles-score-b1'),
  b2: document.getElementById('doubles-score-b2'),
};
const doublesWinner = document.getElementById('doubles-winner');
const doublesMessage = document.getElementById('doubles-message');
const historyList = document.getElementById('history-list');
const historyDetail = document.getElementById('history-detail');
const tournamentView = {
  builderPanel: document.getElementById('tournament-builder-panel'),
  bracketPanel: document.querySelector('#view-tournament .bracket-panel'),
  bracketType: document.getElementById('tournament-bracket-type'),
  styleToggle: document.getElementById('tournament-style-toggle'),
  styleButtons: document.querySelectorAll('#tournament-style-toggle .toggle-btn'),
  playerPanel: document.getElementById('tournament-player-panel'),
  playerGrid: document.getElementById('tournament-player-grid'),
  seedPanel: document.getElementById('tournament-seed-panel'),
  nameInput: document.getElementById('tournament-name'),
  teamPanel: document.getElementById('tournament-team-panel'),
  teamList: document.getElementById('tournament-team-list'),
  addTeamBtn: document.getElementById('tournament-team-add'),
  removeTeamBtn: document.getElementById('tournament-team-remove'),
  buildBtn: document.getElementById('tournament-build'),
  resetBtn: document.getElementById('tournament-reset'),
  recordBtn: document.getElementById('tournament-record'),
  bracket: document.getElementById('tournament-bracket'),
  champion: document.getElementById('tournament-champion'),
};

const appState = {
  players: [],
  events: [],
  activeView: 'players',
  activeTournaments: {
    single: null,
    double: null,
  },
  tournamentConfig: {
    bracketType: 'double',
    style: 'solo',
    teams: [],
    name: '',
    seedOrder: [],
  },
  playerStats: {},
  historySelection: null,
};

async function init() {
  await store.init();
  appState.players = await store.getPlayers();
  appState.events = (await store.getEvents()).sort((a, b) => b.createdAt - a.createdAt);
  rebuildPlayerStats();
  hydrateActiveTournaments();
  const initialContext = appState.activeTournaments[appState.tournamentConfig.bracketType];
  if (initialContext?.style) {
    setTournamentStyle(initialContext.style);
  }
  renderPlayers();
  renderPlayerControls();
  renderTournaments();
  renderHistoryList();
  attachListeners();
}

function hydrateActiveTournaments() {
  if (useLocalTournamentPersistence()) {
    ['single', 'double'].forEach((format) => {
      const context = loadActiveTournamentState(format);
      if (context && !context.style) {
        context.style = 'solo';
      }
      appState.activeTournaments[format] = context;
    });
    return;
  }
  ['single', 'double'].forEach((format) => subscribeToActiveTournament(format));
}

function subscribeToActiveTournament(format) {
  if (!store.db || store.useLocal) return;
  const docRef = doc(store.db, 'activeTournaments', ACTIVE_TOURNAMENT_DOCS[format]);
  if (tournamentListeners[format]) {
    tournamentListeners[format]();
  }
  tournamentListeners[format] = onSnapshot(
    docRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        appState.activeTournaments[format] = null;
        if (appState.tournamentConfig.bracketType === format) {
          renderTournaments();
        }
        updateTournamentBuilderState();
        return;
      }
      const data = snapshot.data();
      if (!data?.state) {
        appState.activeTournaments[format] = null;
      } else {
        const state = deserializeTournament(data.state);
        state.scores = state.scores || {};
        appState.activeTournaments[format] = {
          state,
          title: data.title,
          createdAt: data.createdAt,
          eventId: data.eventId || null,
          style: data.style || 'solo',
        };
      }
      if (appState.tournamentConfig.bracketType === format) {
        renderTournaments();
      }
      updateTournamentBuilderState();
    },
    (error) => {
      console.error('Unable to subscribe to tournament updates', error);
    }
  );
}

function attachListeners() {
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  playerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = playerInput.value.trim();
    if (!name) return;
    const exists = appState.players.some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      alert('That name already exists.');
      return;
    }
    await store.addPlayer(name);
    appState.players = await store.getPlayers();
    playerInput.value = '';
    renderPlayers();
    renderPlayerControls();
  });

  playerList.addEventListener('click', async (event) => {
    const manageBtn = event.target.closest('button[data-action="toggle-player-menu"]');
    if (manageBtn) {
      const controls = manageBtn.nextElementSibling;
      if (controls) {
        const isHidden = controls.hasAttribute('hidden');
        document.querySelectorAll('.player-menu').forEach((menu) => menu.setAttribute('hidden', 'true'));
        if (isHidden) controls.removeAttribute('hidden');
        else controls.setAttribute('hidden', 'true');
      }
      return;
    }
    const button = event.target.closest('button[data-player-id]');
    if (!button) return;
    const { playerId, action } = button.dataset;
    if (action === 'remove') {
      if (!confirm('Remove this player? This does not remove historical games.')) return;
      await store.deletePlayer(playerId);
      appState.players = await store.getPlayers();
      renderPlayers();
      renderPlayerControls();
      appState.events = (await store.getEvents()).sort((a, b) => b.createdAt - a.createdAt);
      rebuildPlayerStats();
      renderPlayers();
      renderTournaments();
      renderHistoryList();
      renderHistoryDetail();
      return;
    }
    if (action === 'rename') {
      const current = getPlayerById(playerId);
      if (!current) return;
      const newName = prompt('Enter a new name', current.name)?.trim();
      if (!newName || newName === current.name) return;
      const exists = appState.players.some(
        (p) => p.id !== playerId && p.name.toLowerCase() === newName.toLowerCase()
      );
      if (exists) {
        alert('That name is already taken.');
        return;
      }
      await store.renamePlayer(playerId, newName);
      appState.players = await store.getPlayers();
      appState.events = (await store.getEvents()).sort((a, b) => b.createdAt - a.createdAt);
      rebuildPlayerStats();
      renamePlayerInActiveTournaments(playerId, newName);
      renderPlayers();
      renderPlayerControls();
      renderTournaments();
      renderHistoryList();
      renderHistoryDetail();
    }
  });

  duelForm.addEventListener('submit', handleDuelSubmit);
  doublesForm.addEventListener('submit', handleDoublesSubmit);

  tournamentView.bracketType.addEventListener('change', (event) => {
    handleTournamentFormatChange(event.target.value);
  });
  tournamentView.styleButtons.forEach((button) => {
    button.addEventListener('click', () => setTournamentStyle(button.dataset.tournamentStyle));
  });
  if (tournamentView.addTeamBtn) {
    tournamentView.addTeamBtn.addEventListener('click', () => addTournamentTeam());
  }
  if (tournamentView.removeTeamBtn) {
    tournamentView.removeTeamBtn.addEventListener('click', () => removeTournamentTeam());
  }
  if (tournamentView.teamList) {
    tournamentView.teamList.addEventListener('change', (event) => {
      const select = event.target.closest('select[data-team-id]');
      if (!select) return;
      handleTournamentTeamChange(select.dataset.teamId, Number(select.dataset.slot), select.value);
      updateTournamentNamePlaceholder();
    });
  }
  if (tournamentView.buildBtn) {
    tournamentView.buildBtn.addEventListener('click', buildTournament);
  }
  if (tournamentView.resetBtn) {
    tournamentView.resetBtn.addEventListener('click', () => resetTournament(appState.tournamentConfig.bracketType));
  }
  if (tournamentView.recordBtn) {
    tournamentView.recordBtn.addEventListener('click', handleTournamentActionButton);
  }
  if (tournamentView.nameInput) {
    tournamentView.nameInput.addEventListener('input', (event) => {
      appState.tournamentConfig.name = event.target.value;
    });
  }

  historyList.addEventListener('click', async (event) => {
    const item = event.target.closest('.history-item');
    if (!item) return;
    const id = item.dataset.eventId;
    const record = appState.events.find((evt) => evt.id === id);
    if (!record) return;
    appState.historySelection = record;
    historyList.querySelectorAll('.history-item.active').forEach((node) => node.classList.remove('active'));
    item.classList.add('active');
    renderHistoryDetail();
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('.player-menu') || event.target.closest('button[data-action="toggle-player-menu"]')) {
      return;
    }
    document.querySelectorAll('.player-menu').forEach((menu) => menu.setAttribute('hidden', 'true'));
  });
}

function switchView(view) {
  if (!views[view]) return;
  appState.activeView = view;
  Object.entries(views).forEach(([key, section]) => {
    section.classList.toggle('active', key === view);
  });
  navButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
  if (view === 'history') {
    renderHistoryDetail();
  }
}

function renderPlayers() {
  playerList.innerHTML = '';
  if (!appState.players.length) {
    const empty = document.createElement('p');
    empty.className = 'placeholder';
    empty.textContent = 'No players yet. Add one above to get started.';
    playerList.appendChild(empty);
    return;
  }
  const entries = appState.players
    .map((player) => {
      const stats =
        appState.playerStats[player.id] || {
          cupsFor: 0,
          cupsAgainst: 0,
          wins: 0,
          losses: 0,
          soloTitles: 0,
          doublesTitles: 0,
        };
      return {
        player,
        kdRaw: computeRatioValue(stats.cupsFor, stats.cupsAgainst),
        wlRaw: computeRatioValue(stats.wins, stats.losses),
      };
    })
    .sort((a, b) => a.player.name.localeCompare(b.player.name));
  const kdValues = entries
    .map((entry) => entry.kdRaw)
    .filter((value) => Number.isFinite(value));
  const wlValues = entries
    .map((entry) => entry.wlRaw)
    .filter((value) => Number.isFinite(value));
  const bestKd = kdValues.length ? Math.max(...kdValues) : null;
  const worstKd = kdValues.length ? Math.min(...kdValues) : null;
  const bestWl = wlValues.length ? Math.max(...wlValues) : null;
  const worstWl = wlValues.length ? Math.min(...wlValues) : null;
  entries.forEach(({ player, kdRaw, wlRaw }) => {
      const li = document.createElement('li');
      const info = document.createElement('div');
      info.className = 'player-info';
      const name = document.createElement('span');
      name.textContent = player.name;
      info.appendChild(name);
      const stats =
        appState.playerStats[player.id] || {
          cupsFor: 0,
          cupsAgainst: 0,
          wins: 0,
          losses: 0,
          soloTitles: 0,
          doublesTitles: 0,
        };
      const kdValue = formatRatio(stats.cupsFor, stats.cupsAgainst);
      const wlValue = formatRatio(stats.wins, stats.losses);
      const nameRow = document.createElement('div');
      nameRow.className = 'player-name-row';
      nameRow.appendChild(name);
      if (stats.soloTitles) {
        nameRow.appendChild(createWinPill('🍺', stats.soloTitles));
      }
      if (stats.doublesTitles) {
        nameRow.appendChild(createWinPill('🍻', stats.doublesTitles, 'doubles'));
      }
      info.appendChild(nameRow);
      const meta = document.createElement('div');
      meta.className = 'player-meta';
      const kdSpan = document.createElement('span');
      kdSpan.textContent = `K/D ${kdValue}`;
      if (Number.isFinite(kdRaw)) {
        if (bestKd !== null && kdRaw === bestKd) kdSpan.classList.add('highlight');
        if (worstKd !== null && kdRaw === worstKd) kdSpan.classList.add('lowlight');
      }
      const wlSpan = document.createElement('span');
      wlSpan.textContent = `W/L ${wlValue}`;
      if (Number.isFinite(wlRaw)) {
        if (bestWl !== null && wlRaw === bestWl) wlSpan.classList.add('highlight');
        if (worstWl !== null && wlRaw === worstWl) wlSpan.classList.add('lowlight');
      }
      meta.append(kdSpan, wlSpan);
      info.appendChild(meta);
      const actions = document.createElement('div');
      actions.className = 'player-actions';
      const manageBtn = document.createElement('button');
      manageBtn.textContent = '⋯';
      manageBtn.dataset.action = 'toggle-player-menu';
      const menu = document.createElement('div');
      menu.className = 'player-menu';
      menu.setAttribute('hidden', 'true');
      const renameBtn = document.createElement('button');
      renameBtn.textContent = 'Rename';
      renameBtn.dataset.playerId = player.id;
      renameBtn.dataset.action = 'rename';
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.dataset.playerId = player.id;
      removeBtn.dataset.action = 'remove';
      removeBtn.classList.add('danger');
      menu.append(renameBtn, removeBtn);
      actions.append(manageBtn, menu);
      li.append(info, actions);
      playerList.appendChild(li);
    });
}

function formatRatio(numerator = 0, denominator = 0) {
  if (!numerator && !denominator) return '—';
  const safeDenominator = denominator || 1;
  const value = numerator / safeDenominator;
  if (!Number.isFinite(value)) return '—';
  const fixed = value.toFixed(2);
  return parseFloat(fixed).toString();
}

function createWinPill(emoji, count, variant) {
  const pill = document.createElement('span');
  pill.className = 'win-pill';
  if (variant) {
    pill.classList.add(`win-pill-${variant}`);
  }
  pill.textContent = `${emoji} ${count}`;
  return pill;
}

function computeRatioValue(numerator = 0, denominator = 0) {
  if (!numerator && !denominator) return null;
  const value = numerator / (denominator || 1);
  return Number.isFinite(value) ? value : null;
}

function renderPlayerControls() {
  refreshDuelSelectors();
  [duelScoreA, duelScoreB].forEach((select) => populateCupSelect(select));
  Object.values(doublesScores).forEach((select) => populateCupSelect(select));
  refreshDoublesSelectors();
  renderTournamentSelectors();
}

function updateTournamentNamePlaceholder() {
  if (!tournamentView.nameInput) return;
  const style = appState.tournamentConfig.style;
  const format = appState.tournamentConfig.bracketType;
  const count = getProspectiveEntryCount(style);
  const defaultTitle = getTournamentDefaultTitle(style, format, count);
  tournamentView.nameInput.placeholder = `Default: ${defaultTitle}`;
}

function getProspectiveEntryCount(style) {
  if (style === 'doubles') {
    return appState.tournamentConfig.teams.filter((team) => {
      const members = team.members || [];
      return members.filter(Boolean).length === 2;
    }).length;
  }
  if (!tournamentView.playerGrid) return 0;
  return tournamentView.playerGrid.querySelectorAll('input[type=\"checkbox\"]:checked').length;
}

function getTournamentDefaultTitle(style, format, count) {
  const styleLabel = style === 'doubles' ? '2v2' : '1v1';
  const bracketLabel = format === 'double' ? 'Double elimination' : 'Single elimination';
  const unit = style === 'doubles' ? 'teams' : 'players';
  return `${styleLabel} ${bracketLabel.toLowerCase()} (${count} ${unit})`;
}

function getTournamentDescriptor(format, style) {
  const bracketLabel = format === 'double' ? 'Double elimination' : 'Single elimination';
  const styleLabel = style === 'doubles' ? '2v2' : '1v1';
  return `${bracketLabel} • ${styleLabel}`;
}

function inferEventStyle(record) {
  if (record.data?.style) return record.data.style;
  const players = record.data?.tournament?.players || [];
  const hasTeams = players.some((player) => Array.isArray(player.members) && player.members.length > 1);
  return hasTeams ? 'doubles' : 'solo';
}

function renderTournamentSelectors() {
  if (tournamentView.bracketType) {
    tournamentView.bracketType.value = appState.tournamentConfig.bracketType;
  }
  tournamentView.styleButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tournamentStyle === appState.tournamentConfig.style);
  });
  if (tournamentView.nameInput) {
    tournamentView.nameInput.value = appState.tournamentConfig.name;
  }
  const isSolo = appState.tournamentConfig.style === 'solo';
  setPanelVisibility(tournamentView.playerPanel, !isSolo);
  if (!isSolo) {
    ensureMinimumTeams(2);
  }
  setPanelVisibility(tournamentView.teamPanel, isSolo);
  if (isSolo) {
    renderTournamentPlayerGrid();
  } else {
    renderTournamentTeams();
  }
  if (tournamentView.removeTeamBtn) {
    const minTeams = appState.tournamentConfig.style === 'doubles' ? 2 : 0;
    tournamentView.removeTeamBtn.disabled =
      appState.tournamentConfig.teams.length <= minTeams;
  }
  if (tournamentView.seedPanel) {
    if (devMode && isSolo) {
      tournamentView.seedPanel.hidden = false;
      tournamentView.seedPanel.style.display = '';
    } else {
      tournamentView.seedPanel.hidden = true;
      tournamentView.seedPanel.style.display = 'none';
      tournamentView.seedPanel.innerHTML = '';
    }
  }
  updateTournamentNamePlaceholder();
}

function setPanelVisibility(element, hidden) {
  if (!element) return;
  if (hidden) {
    element.setAttribute('hidden', 'true');
    element.classList.add('hidden-panel');
    element.style.display = 'none';
  } else {
    element.removeAttribute('hidden');
    element.classList.remove('hidden-panel');
    element.style.display = '';
  }
}

function renderTournamentPlayerGrid() {
  const grid = tournamentView.playerGrid;
  if (!grid) return;
  grid.innerHTML = '';
  if (!appState.players.length) {
    const empty = document.createElement('p');
    empty.className = 'placeholder';
    empty.textContent = 'Add players before building a bracket.';
    grid.appendChild(empty);
    return;
  }
  appState.players
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = player.id;
      label.append(checkbox, document.createTextNode(player.name));
      grid.appendChild(label);
      checkbox.addEventListener('change', handleSoloSelectionChange);
    });
  handleSoloSelectionChange();
}

function renderTournamentTeams() {
  const list = tournamentView.teamList;
  if (!list) return;
  list.innerHTML = '';
  if (!appState.players.length) {
    const empty = document.createElement('p');
    empty.className = 'placeholder';
    empty.textContent = 'Add players to start building teams.';
    list.appendChild(empty);
    return;
  }
  if (!appState.tournamentConfig.teams.length) {
    const empty = document.createElement('p');
    empty.className = 'placeholder';
    empty.textContent = 'Use + to add teams.';
    list.appendChild(empty);
    return;
  }
  appState.tournamentConfig.teams.forEach((team, index) => {
    team.members = (team.members || []).slice(0, 2);
    while (team.members.length < 2) {
      team.members.push('');
    }
    team.members = team.members.map((memberId) =>
      appState.players.some((player) => player.id === memberId) ? memberId : ''
    );
    const card = document.createElement('div');
    card.className = 'team-card';
    const header = document.createElement('div');
    header.className = 'team-card-header';
    header.innerHTML = `<span>Team ${index + 1}</span>`;
     if (devMode) {
       const controls = document.createElement('div');
       controls.className = 'team-card-controls';
       const up = document.createElement('button');
       up.type = 'button';
       up.textContent = '↑';
       up.disabled = index === 0;
       up.addEventListener('click', () => moveTeam(index, -1));
       const down = document.createElement('button');
       down.type = 'button';
       down.textContent = '↓';
       down.disabled = index === appState.tournamentConfig.teams.length - 1;
       down.addEventListener('click', () => moveTeam(index, 1));
       controls.append(up, down);
       header.appendChild(controls);
     }
    card.appendChild(header);
    team.members.forEach((memberId, slot) => {
      const row = document.createElement('div');
      row.className = 'team-member-row';
      const select = document.createElement('select');
      select.dataset.teamId = team.id;
      select.dataset.slot = slot;
      const exclude = getTournamentExcludedPlayers(team.id, slot);
      populatePlayerSelect(select, exclude);
      select.value = memberId || '';
      row.appendChild(select);
      card.appendChild(row);
    });
    list.appendChild(card);
  });
  updateTournamentNamePlaceholder();
}

function handleSoloSelectionChange() {
  const selected = getSelectedSoloIds();
  currentSoloSeedSelection = selected;
  updateTournamentNamePlaceholder();
  if (devMode && appState.tournamentConfig.style === 'solo') {
    syncSeedOrder(selected);
    renderSeedPanel(selected);
  } else if (tournamentView.seedPanel) {
    tournamentView.seedPanel.hidden = true;
    tournamentView.seedPanel.innerHTML = '';
  }
}

function getSelectedSoloIds() {
  if (!tournamentView.playerGrid) return [];
  return Array.from(
    tournamentView.playerGrid.querySelectorAll('input[type="checkbox"]:checked')
  ).map((input) => input.value);
}

function syncSeedOrder(selectedIds) {
  const order = appState.tournamentConfig.seedOrder || [];
  const filtered = order.filter((id) => selectedIds.includes(id));
  selectedIds.forEach((id) => {
    if (!filtered.includes(id)) filtered.push(id);
  });
  appState.tournamentConfig.seedOrder = filtered;
}

function renderSeedPanel(selectedIds) {
  const panel = tournamentView.seedPanel;
  if (!panel) return;
  if (!devMode || selectedIds.length < 2) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  panel.hidden = false;
  panel.innerHTML = '<h4>Seed order</h4>';
  const list = document.createElement('ol');
  list.className = 'seed-order';
  const order = appState.tournamentConfig.seedOrder || [];
  const display = order.filter((id) => selectedIds.includes(id));
  display.forEach((playerId, index) => {
    const player = getPlayerById(playerId);
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = player ? player.name : 'Unknown';
    const controls = document.createElement('div');
    controls.className = 'seed-controls';
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.disabled = index === 0;
    up.addEventListener('click', () => moveSeed(index, -1));
    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.disabled = index === display.length - 1;
    down.addEventListener('click', () => moveSeed(index, 1));
    controls.append(up, down);
    item.append(label, controls);
    list.appendChild(item);
  });
  panel.appendChild(list);
}

function moveSeed(index, delta) {
  const order = appState.tournamentConfig.seedOrder || [];
  const target = index + delta;
  if (target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target], order[index]];
  appState.tournamentConfig.seedOrder = order;
  renderSeedPanel(currentSoloSeedSelection);
}

function moveTeam(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= appState.tournamentConfig.teams.length) return;
  const swapped = [...appState.tournamentConfig.teams];
  [swapped[index], swapped[target]] = [swapped[target], swapped[index]];
  appState.tournamentConfig.teams = swapped;
  renderTournamentSelectors();
}

function applyCustomSeeding(entries) {
  const order = appState.tournamentConfig.seedOrder || [];
  if (!order.length) return;
  const positions = new Map();
  order.forEach((id, idx) => positions.set(id, idx));
  let fallback = order.length;
  entries.forEach((entry) => {
    if (!positions.has(entry.id)) {
      positions.set(entry.id, fallback++);
    }
  });
  entries.sort((a, b) => positions.get(a.id) - positions.get(b.id));
}

function handleSlotDragStart(event) {
  const target = event.currentTarget;
  if (!target?.dataset?.playerId) return;
  dragSlotContext = {
    format: target.dataset.format,
    matchId: target.dataset.matchId,
    slotKey: target.dataset.slotKey,
    playerId: target.dataset.playerId,
    style: target.dataset.style,
  };
  event.dataTransfer.effectAllowed = 'move';
}

function handleSlotDragEnd() {
  dragSlotContext = null;
}

function handleSlotDragOver(event) {
  if (canAcceptSlotDrop(event.currentTarget)) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }
}

function handleSlotDrop(event) {
  const target = event.currentTarget;
  if (!canAcceptSlotDrop(target)) return;
  event.preventDefault();
  swapManualPlayers(
    target.dataset.format,
    dragSlotContext,
    {
      format: target.dataset.format,
      matchId: target.dataset.matchId,
      slotKey: target.dataset.slotKey,
      playerId: target.dataset.playerId,
    }
  );
  dragSlotContext = null;
}

function canAcceptSlotDrop(target) {
  if (!devMode || !dragSlotContext) return false;
  if (!target?.dataset?.playerId) return false;
  if (target.dataset.style !== 'solo') return false;
  if (dragSlotContext.format !== target.dataset.format) return false;
  if (!dragSlotContext.playerId || !target.dataset.playerId) return false;
  if (
    dragSlotContext.matchId === target.dataset.matchId &&
    dragSlotContext.slotKey === target.dataset.slotKey
  ) {
    return false;
  }
  return true;
}

function swapManualPlayers(format, source, target) {
  const context = appState.activeTournaments[format];
  if (!context?.state || context.style !== 'solo') return;
  const state = context.state;
  if (!source?.playerId || !target?.playerId) return;
  setManualSlot(state, source.matchId, source.slotKey, target.playerId);
  setManualSlot(state, target.matchId, target.slotKey, source.playerId);
  resetMatchTree(state, source.matchId);
  resetMatchTree(state, target.matchId);
  TournamentEngine.autoAdvanceByes(state);
  renderTournaments();
  persistActiveTournamentState(format);
}

function setManualSlot(state, matchId, slotKey, playerId) {
  state.manualSlots = state.manualSlots || {};
  if (!playerId) {
    if (state.manualSlots[matchId]) {
      delete state.manualSlots[matchId][slotKey];
      if (!Object.keys(state.manualSlots[matchId]).length) {
        delete state.manualSlots[matchId];
      }
    }
    return;
  }
  state.manualSlots[matchId] = state.manualSlots[matchId] || {};
  state.manualSlots[matchId][slotKey] = playerId;
}

function getTournamentExcludedPlayers(teamId, slot) {
  const ids = [];
  appState.tournamentConfig.teams.forEach((team) => {
    team.members?.forEach((memberId, memberSlot) => {
      if (!memberId) return;
      if (team.id === teamId && memberSlot === slot) return;
      ids.push(memberId);
    });
  });
  return ids;
}

function resetMatchTree(state, rootMatchId) {
  if (!state?.matches || !rootMatchId) return;
  const dependents = buildMatchDependents(state);
  const queue = [rootMatchId];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    if (state.results && current in state.results) {
      state.results[current] = null;
    }
    if (state.scores && state.scores[current]) {
      delete state.scores[current];
    }
    const nextMatches = dependents.get(current) || [];
    nextMatches.forEach((matchId) => queue.push(matchId));
  }
}

function buildMatchDependents(state) {
  const map = new Map();
  if (!state?.matches) return map;
  Object.values(state.matches).forEach((match) => {
    if (!match?.id) return;
    ['source1', 'source2'].forEach((key) => {
      const source = match[key];
      if (!source) return;
      if (
        source.type === 'match' ||
        source.type === 'matchWinner' ||
        source.type === 'matchLoser'
      ) {
        const list = map.get(source.value) || [];
        list.push(match.id);
        map.set(source.value, list);
      }
    });
  });
  return map;
}

function createTournamentTeam() {
  return {
    id: crypto.randomUUID(),
    members: ['', ''],
  };
}

function addTournamentTeam() {
  appState.tournamentConfig.teams.push(createTournamentTeam());
  renderTournamentSelectors();
}

function removeTournamentTeam() {
  const minTeams = appState.tournamentConfig.style === 'doubles' ? 2 : 0;
  if (appState.tournamentConfig.teams.length > minTeams) {
    appState.tournamentConfig.teams.pop();
    renderTournamentSelectors();
  }
}

function handleTournamentTeamChange(teamId, slot, playerId) {
  const team = appState.tournamentConfig.teams.find((entry) => entry.id === teamId);
  if (!team) return;
  team.members = team.members || ['', ''];
  team.members[slot] = playerId;
  renderTournamentTeams();
}

function ensureMinimumTeams(min = 2) {
  const teams = appState.tournamentConfig.teams;
  while (teams.length < min) {
    teams.push(createTournamentTeam());
  }
}

function setTournamentStyle(style, { forceRender = false } = {}) {
  const nextStyle = style || 'solo';
  const changed = appState.tournamentConfig.style !== nextStyle;
  appState.tournamentConfig.style = nextStyle;
  if (nextStyle === 'doubles') {
    ensureMinimumTeams(2);
  }
  if (changed || forceRender) {
    renderTournamentSelectors();
  }
}

function handleTournamentFormatChange(format) {
  const validFormat = format === 'double' ? 'double' : 'single';
  appState.tournamentConfig.bracketType = validFormat;
  const context = appState.activeTournaments[validFormat];
  const nextStyle = context?.style || appState.tournamentConfig.style;
  setTournamentStyle(nextStyle, { forceRender: true });
  renderTournaments();
}

function updateDuelWinnerOptions() {
  const selected = new Set([duelPlayerA.value, duelPlayerB.value].filter(Boolean));
  duelWinner.innerHTML = '<option value="">Select winner</option>';
  appState.players
    .filter((p) => selected.has(p.id))
    .forEach((player) => {
      const option = document.createElement('option');
      option.value = player.id;
      option.textContent = player.name;
      duelWinner.appendChild(option);
    });
}

function updateDoublesWinnerOptions() {
  doublesWinner.innerHTML = '<option value="">Select winner</option>';
  const teamASelected = doublesPlayers.a1.value && doublesPlayers.a2.value;
  const teamBSelected = doublesPlayers.b1.value && doublesPlayers.b2.value;
  if (teamASelected) {
    const option = document.createElement('option');
    option.value = 'teamA';
    option.textContent = `${getPlayerName(doublesPlayers.a1.value)} & ${getPlayerName(
      doublesPlayers.a2.value
    )}`;
    doublesWinner.appendChild(option);
  }
  if (teamBSelected) {
    const option = document.createElement('option');
    option.value = 'teamB';
    option.textContent = `${getPlayerName(doublesPlayers.b1.value)} & ${getPlayerName(
      doublesPlayers.b2.value
    )}`;
    doublesWinner.appendChild(option);
  }
}

duelPlayerA.addEventListener('change', refreshDuelSelectors);
duelPlayerB.addEventListener('change', refreshDuelSelectors);
Object.values(doublesPlayers).forEach((select) => {
  select.addEventListener('change', refreshDoublesSelectors);
});
duelScoreA.addEventListener('change', autoSelectDuelWinner);
duelScoreB.addEventListener('change', autoSelectDuelWinner);
Object.values(doublesScores).forEach((select) => {
  select.addEventListener('change', autoSelectDoublesWinner);
});

async function handleDuelSubmit(event) {
  event.preventDefault();
  const playerA = duelPlayerA.value;
  const playerB = duelPlayerB.value;
  const winner = duelWinner.value;
  const scoreA = duelScoreA.value || 'unknown';
  const scoreB = duelScoreB.value || 'unknown';
  if (!playerA || !playerB || !winner) {
    duelMessage.textContent = 'Select both players and the winner.';
    duelMessage.style.color = 'var(--danger)';
    return;
  }
  if (playerA === playerB) {
    duelMessage.textContent = 'Choose two different players.';
    duelMessage.style.color = 'var(--danger)';
    return;
  }
  const eventRecord = {
    id: crypto.randomUUID(),
    type: 'duel',
    title: `${getPlayerName(playerA)} vs ${getPlayerName(playerB)}`,
    createdAt: Date.now(),
    data: {
      playerA,
      playerB,
      winner,
      scoreA,
      scoreB,
    },
  };
  await store.addEvent(eventRecord);
  appState.events = (await store.getEvents()).sort((a, b) => b.createdAt - a.createdAt);
  rebuildPlayerStats();
  renderPlayers();
  duelForm.reset();
  updateDuelWinnerOptions();
  duelMessage.textContent = 'Match logged!';
  duelMessage.style.color = 'var(--success)';
  renderHistoryList();
}

async function handleDoublesSubmit(event) {
  event.preventDefault();
  const players = {
    a1: doublesPlayers.a1.value,
    a2: doublesPlayers.a2.value,
    b1: doublesPlayers.b1.value,
    b2: doublesPlayers.b2.value,
  };
  const winnerTeam = doublesWinner.value;
  if (Object.values(players).some((id) => !id)) {
    doublesMessage.textContent = 'Select all four players.';
    doublesMessage.style.color = 'var(--danger)';
    return;
  }
  const unique = new Set(Object.values(players));
  if (unique.size < 4) {
    doublesMessage.textContent = 'Each slot must have a different player.';
    doublesMessage.style.color = 'var(--danger)';
    return;
  }
  if (!winnerTeam) {
    doublesMessage.textContent = 'Select the winning team.';
    doublesMessage.style.color = 'var(--danger)';
    return;
  }
  const scores = {
    a1: doublesScores.a1.value || 'unknown',
    a2: doublesScores.a2.value || 'unknown',
    b1: doublesScores.b1.value || 'unknown',
    b2: doublesScores.b2.value || 'unknown',
  };
  const eventRecord = {
    id: crypto.randomUUID(),
    type: 'doubles',
    title: `${getPlayerName(players.a1)} & ${getPlayerName(players.a2)} vs ${getPlayerName(
      players.b1
    )} & ${getPlayerName(players.b2)}`,
    createdAt: Date.now(),
    data: {
      teamA: [
        { playerId: players.a1, score: scores.a1 },
        { playerId: players.a2, score: scores.a2 },
      ],
      teamB: [
        { playerId: players.b1, score: scores.b1 },
        { playerId: players.b2, score: scores.b2 },
      ],
      winnerTeam,
    },
  };
  await store.addEvent(eventRecord);
  appState.events = (await store.getEvents()).sort((a, b) => b.createdAt - a.createdAt);
  rebuildPlayerStats();
  renderPlayers();
  doublesForm.reset();
  renderPlayerControls();
  doublesMessage.textContent = 'Match logged!';
  doublesMessage.style.color = 'var(--success)';
  renderHistoryList();
}

function getPlayerName(id) {
  return appState.players.find((p) => p.id === id)?.name || '?';
}

function shuffleArray(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function autoSelectDuelWinner() {
  const playerA = duelPlayerA.value;
  const playerB = duelPlayerB.value;
  if (!playerA || !playerB) {
    duelWinner.value = '';
    return;
  }
  const scoreA = parseCupSelection(duelScoreA.value);
  const scoreB = parseCupSelection(duelScoreB.value);
  if (scoreA === null || scoreB === null || scoreA === scoreB) {
    duelWinner.value = '';
    return;
  }
  duelWinner.value = scoreA > scoreB ? playerA : playerB;
}

function autoSelectDoublesWinner() {
  const ready =
    doublesPlayers.a1.value &&
    doublesPlayers.a2.value &&
    doublesPlayers.b1.value &&
    doublesPlayers.b2.value;
  if (!ready) {
    doublesWinner.value = '';
    return;
  }
  const a1 = parseCupSelection(doublesScores.a1.value);
  const a2 = parseCupSelection(doublesScores.a2.value);
  const b1 = parseCupSelection(doublesScores.b1.value);
  const b2 = parseCupSelection(doublesScores.b2.value);
  if ([a1, a2, b1, b2].some((score) => score === null)) {
    doublesWinner.value = '';
    return;
  }
  const totalA = a1 + a2;
  const totalB = b1 + b2;
  if (totalA === totalB) {
    doublesWinner.value = '';
    return;
  }
  doublesWinner.value = totalA > totalB ? 'teamA' : 'teamB';
}

function computePlayerStats(events = []) {
  const stats = new Map();
  const ensure = (playerId) => {
    if (!playerId) return null;
    if (!stats.has(playerId)) {
      stats.set(playerId, {
        cupsFor: 0,
        cupsAgainst: 0,
        wins: 0,
        losses: 0,
        soloTitles: 0,
        doublesTitles: 0,
      });
    }
    return stats.get(playerId);
  };
  const addWinLoss = (winners, losers) => {
    winners.forEach((id) => {
      const entry = ensure(id);
      if (entry) entry.wins += 1;
    });
    losers.forEach((id) => {
      const entry = ensure(id);
      if (entry) entry.losses += 1;
    });
  };
  const addTitles = (playerIds, type = 'solo') => {
    playerIds.forEach((id) => {
      const entry = ensure(id);
      if (entry) {
        if (type === 'doubles') entry.doublesTitles = (entry.doublesTitles || 0) + 1;
        else entry.soloTitles = (entry.soloTitles || 0) + 1;
      }
    });
  };
  const addCups = (playerId, scored, allowed) => {
    const entry = ensure(playerId);
    if (entry) {
      entry.cupsFor += scored;
      entry.cupsAgainst += allowed;
    }
  };
  const processDuelEvent = (data) => {
    const { playerA, playerB, winner, scoreA, scoreB } = data || {};
    if (!playerA || !playerB) return;
    if (winner === playerA) addWinLoss([playerA], [playerB]);
    else if (winner === playerB) addWinLoss([playerB], [playerA]);
    const cupsA = parseCupSelection(scoreA);
    const cupsB = parseCupSelection(scoreB);
    if (cupsA === null || cupsB === null) return;
    addCups(playerA, cupsA, cupsB);
    addCups(playerB, cupsB, cupsA);
  };
  const processDoublesEvent = (data) => {
    const { teamA = [], teamB = [], winnerTeam } = data || {};
    const teamAIds = teamA.map((entry) => entry.playerId).filter(Boolean);
    const teamBIds = teamB.map((entry) => entry.playerId).filter(Boolean);
    if (winnerTeam === 'teamA') addWinLoss(teamAIds, teamBIds);
    else if (winnerTeam === 'teamB') addWinLoss(teamBIds, teamAIds);
    const scores = [...teamA, ...teamB];
    if (!scores.length) return;
    const parsedScores = scores.map((entry) => parseCupSelection(entry.score));
    if (parsedScores.some((value) => value === null)) return;
    const teamAValues = teamA.map((entry) => parseCupSelection(entry.score));
    const teamBValues = teamB.map((entry) => parseCupSelection(entry.score));
    const totalA = teamAValues.reduce((sum, value) => sum + value, 0);
    const totalB = teamBValues.reduce((sum, value) => sum + value, 0);
    const perAgainstA = teamBIds.length ? totalB / teamBIds.length : 0;
    const perAgainstB = teamAIds.length ? totalA / teamAIds.length : 0;
    teamA.forEach((entry, index) => {
      const value = teamAValues[index];
      addCups(entry.playerId, value, perAgainstA);
    });
    teamB.forEach((entry, index) => {
      const value = teamBValues[index];
      addCups(entry.playerId, value, perAgainstB);
    });
  };
  const getTournamentChampionParticipant = (state) => {
    if (!state?.rounds) return null;
    let finalMatchId = null;
    if (state.bracketType === 'double' && state.rounds.final?.length) {
      const finalRound = state.rounds.final[state.rounds.final.length - 1];
      finalMatchId = finalRound?.[finalRound.length - 1] ?? null;
    } else {
      const finalRound = state.rounds.winners?.[state.rounds.winners.length - 1];
      finalMatchId = finalRound?.[finalRound.length - 1] ?? null;
    }
    if (!finalMatchId) return null;
    const championId = state.results?.[finalMatchId];
    if (!championId) return null;
    return state.players?.find((player) => player.id === championId) || null;
  };

  const processTournamentEvent = (event) => {
    const state = event?.data?.tournament;
    if (!state?.matches) return;
    Object.values(state.matches).forEach((match) => {
      const slot1 = TournamentEngine.getSlotInfo(state, match, 'source1');
      const slot2 = TournamentEngine.getSlotInfo(state, match, 'source2');
      if (!slot1?.player || !slot2?.player || slot1.isBye || slot2.isBye) return;
      const participants = [
        { slot: slot1, player: slot1.player },
        { slot: slot2, player: slot2.player },
      ];
      const winnerId = state.results?.[match.id];
      if (winnerId) {
        const winner = participants.find((entry) => entry.player.id === winnerId);
        const loser = participants.find((entry) => entry.player.id !== winnerId);
        if (winner && loser) {
          const winnerMembers = getParticipantMembersList(winner.player).map((member) => member.playerId);
          const loserMembers = getParticipantMembersList(loser.player).map((member) => member.playerId);
          addWinLoss(winnerMembers, loserMembers);
        }
      }
      const teamStats = participants.map((entry) => {
        const members = getParticipantMembersList(entry.player);
        if (!members.length) {
          return { valid: false, entries: [], total: 0, size: 0 };
        }
        const records = [];
        let total = 0;
        let valid = true;
        members.forEach((member) => {
          const raw = getMatchScoreValue(state, match.id, entry.player.id, member.playerId);
          const parsed = parseCupSelection(raw);
          if (parsed === null) {
            valid = false;
            return;
          }
          records.push({ playerId: member.playerId, value: parsed });
          total += parsed;
        });
        return { valid, entries: records, total, size: members.length };
      });
      const cupsValid = teamStats.every((team) => team.valid);
      if (!cupsValid) return;
      teamStats.forEach((team, index) => {
        const opponent = teamStats[index ? 0 : 1];
        const against = opponent.size ? opponent.total / opponent.size : 0;
        team.entries.forEach((entry) => {
          addCups(entry.playerId, entry.value, against);
        });
      });
    });
    const champion = getTournamentChampionParticipant(state);
    if (champion) {
      const members = getParticipantMembersList(champion).map((member) => member.playerId);
      const style = event.data?.style || (champion.members?.length > 1 ? 'doubles' : 'solo');
      addTitles(members, style === 'doubles' ? 'doubles' : 'solo');
    }
  };

  events.forEach((event) => {
    if (!event) return;
    if (event.type === 'duel') {
      processDuelEvent(event.data);
    } else if (event.type === 'doubles') {
      processDoublesEvent(event.data);
    } else if (event.type === 'single' || event.type === 'double') {
      processTournamentEvent(event);
    }
  });

  const summary = {};
  stats.forEach((value, key) => {
    summary[key] = value;
  });
  return summary;
}

function rebuildPlayerStats() {
  appState.playerStats = computePlayerStats(appState.events);
}

function renderTournaments() {
  const format = appState.tournamentConfig.bracketType;
  const context = appState.activeTournaments[format];
  setPanelVisibility(tournamentView.bracketPanel, !context?.state);
  if (context?.state) {
    TournamentRenderer.render(tournamentView.bracket, tournamentView.champion, context.state, {
      format,
      style: context.style,
      readOnly: false,
      onWinner: (matchId, winnerId) => updateTournamentWinner(format, matchId, winnerId),
      onScoreChange: (matchId, playerId, score, memberId) =>
        updateMatchScore(format, matchId, playerId, score, memberId),
    });
  } else {
    tournamentView.bracket.innerHTML =
      '<p class="placeholder">Select players and build a bracket to get started.</p>';
    tournamentView.champion.hidden = true;
  }
  updateTournamentBuilderState();
}

function updateTournamentBuilderState() {
  const format = appState.tournamentConfig.bracketType;
  const context = appState.activeTournaments[format];
  const hasActive = Boolean(context?.state);
  setPanelVisibility(tournamentView.builderPanel, hasActive);
  if (tournamentView.buildBtn) {
    tournamentView.buildBtn.disabled = hasActive;
  }
  if (tournamentView.recordBtn) {
    const hasChampion = hasActive && getTournamentWinnerId(context.state);
    tournamentView.recordBtn.disabled = !hasActive;
    tournamentView.recordBtn.textContent = hasChampion ? 'Record tournament' : 'Save tournament';
  }
}

async function buildTournament() {
  const format = appState.tournamentConfig.bracketType;
  const style = appState.tournamentConfig.style;
  let entries = [];
  if (style === 'doubles') {
    const completeTeams = appState.tournamentConfig.teams
      .map((team) => ({
        ...team,
        members: (team.members || []).filter(Boolean),
      }))
      .filter((team) => team.members.length === 2);
    if (completeTeams.length < 2) {
      alert('Add at least two teams with two players each.');
      return;
    }
    entries = completeTeams.map((team) => {
      const members = team.members.map((playerId) => {
        const player = getPlayerById(playerId);
        return { playerId, name: player?.name || '?' };
      });
      return {
        id: team.id,
        name: members.map((member) => member.name).join(' & '),
        members,
      };
    });
  } else {
    const checkboxes = Array.from(
      tournamentView.playerGrid.querySelectorAll('input[type="checkbox"]:checked')
    );
    if (checkboxes.length < 2) {
      alert('Select at least two players.');
      return;
    }
    const selected = checkboxes.map((input) => getPlayerById(input.value)).filter(Boolean);
    if (selected.length < 2) {
      alert('Unable to resolve selected players. Please refresh and try again.');
      return;
    }
    entries = selected.map((player) => ({
      id: player.id,
      name: player.name,
      members: [{ playerId: player.id, name: player.name }],
    }));
  }
  if (devMode) {
    if (style === 'solo') {
      applyCustomSeeding(entries);
    }
  } else {
    entries = shuffleArray(entries);
  }
  const tournamentState = TournamentEngine.createTournament(entries, format);
  TournamentEngine.autoAdvanceByes(tournamentState);
  const defaultTitle = getTournamentDefaultTitle(style, format, entries.length);
  const customName = (tournamentView.nameInput?.value || '').trim();
  const eventTitle = customName || defaultTitle;
  appState.activeTournaments[format] = {
    eventId: null,
    state: deepClone(tournamentState),
    createdAt: Date.now(),
    title: eventTitle,
    style,
  };
  persistActiveTournamentState(format);
  renderTournaments();
}

function getPlayerById(id) {
  return appState.players.find((p) => p.id === id);
}

function resetTournament(format) {
  if (!confirm('Reset this bracket?')) return;
  clearActiveTournamentState(format);
  renderTournaments();
}

async function updateTournamentWinner(format, matchId, winnerId) {
  const context = appState.activeTournaments[format];
  if (!context) return;
  TournamentEngine.recordWinner(context.state, matchId, winnerId);
  TournamentEngine.autoAdvanceByes(context.state);
  renderTournaments();
  persistActiveTournamentState(format);
}

function updateMatchScore(format, matchId, playerId, score, memberId) {
  const context = appState.activeTournaments[format];
  if (!context) return;
  if (!context.state.scores) {
    context.state.scores = {};
  }
  if (!context.state.scores[matchId]) {
    context.state.scores[matchId] = {};
  }
  if (memberId) {
    if (typeof context.state.scores[matchId][playerId] !== 'object' || !context.state.scores[matchId][playerId]) {
      context.state.scores[matchId][playerId] = {};
    }
    context.state.scores[matchId][playerId][memberId] = score;
  } else {
    context.state.scores[matchId][playerId] = score;
  }
  persistActiveTournamentState(format);
  attemptAutoSetTournamentWinner(format, matchId);
}

async function saveActiveTournament(format) {
  await persistTournamentEvent(format, { unfinished: true });
}

async function recordActiveTournament(format) {
  await persistTournamentEvent(format, { requireChampion: true, unfinished: false });
}

function handleTournamentActionButton() {
  const format = appState.tournamentConfig.bracketType;
  const context = appState.activeTournaments[format];
  if (!context?.state) {
    alert('No tournament is currently active.');
    return;
  }
  if (getTournamentWinnerId(context.state)) {
    recordActiveTournament(format);
  } else {
    saveActiveTournament(format);
  }
}

async function persistTournamentEvent(format, { requireChampion = false, unfinished = false } = {}) {
  const context = appState.activeTournaments[format];
  if (!context?.state) {
    alert('No tournament is currently active.');
    return false;
  }
  const championId = getTournamentWinnerId(context.state);
  if (requireChampion && !championId) {
    alert('Finish the tournament before recording.');
    return false;
  }
  const record = {
    id: context.eventId || crypto.randomUUID(),
    type: format,
    title: context.title,
    createdAt: context.createdAt,
    data: {
      tournament: context.state,
      style: context.style,
      unfinished: Boolean(unfinished),
    },
  };
  try {
    if (context.eventId) {
      await store.updateEvent(context.eventId, () => record);
    } else {
      const savedEvent = await store.addEvent(record);
      context.eventId = savedEvent.id;
    }
    persistActiveTournamentState(format);
    appState.events = (await store.getEvents()).sort((a, b) => b.createdAt - a.createdAt);
    rebuildPlayerStats();
    renderPlayers();
    renderHistoryList();
    updateTournamentBuilderState();
    return true;
  } catch (error) {
    console.error('Failed to save the tournament event', error);
    alert('Unable to save the tournament yet. Progress is kept locally.');
    return false;
  }
}

async function handleDeleteEvent(eventId) {
  const record = appState.events.find((event) => event.id === eventId);
  if (!record) return;
  if (!confirm('Delete this event permanently?')) return;
  await store.deleteEvent(record);
  appState.events = (await store.getEvents()).sort((a, b) => b.createdAt - a.createdAt);
  rebuildPlayerStats();
  renderPlayers();
  if (appState.historySelection?.id === eventId) {
    appState.historySelection = null;
  }
  Object.keys(appState.activeTournaments).forEach((format) => {
    if (appState.activeTournaments[format]?.eventId === eventId) {
      clearActiveTournamentState(format);
    }
  });
  renderHistoryList();
  renderHistoryDetail();
  renderTournaments();
}

function renderHistoryList() {
  historyList.innerHTML = '';
  if (!appState.events.length) {
    historyList.innerHTML = '<p class="placeholder">No events logged yet.</p>';
    historyDetail.innerHTML = '<p class="placeholder">Select an event to view its details.</p>';
    return;
  }
  appState.events.forEach((event) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.dataset.eventId = event.id;
    if (appState.historySelection?.id === event.id) {
      item.classList.add('active');
    }
    const strong = document.createElement('strong');
    strong.textContent = formatEventTitle(event);
    item.append(strong);
    if (event.data?.unfinished) {
      const subtitle = document.createElement('span');
      subtitle.className = 'history-subtitle';
      subtitle.textContent = 'Unfinished';
      item.append(subtitle);
    }
    historyList.appendChild(item);
  });
}

function formatEventTitle(event) {
  if (event.type === 'duel') {
    const { playerA, playerB } = event.data;
    return `${getPlayerName(playerA)} vs ${getPlayerName(playerB)}`;
  }
  if (event.type === 'doubles') {
    const [a1, a2] = event.data.teamA || [];
    const [b1, b2] = event.data.teamB || [];
    return `${getPlayerName(a1?.playerId)} & ${getPlayerName(a2?.playerId)} vs ${getPlayerName(
      b1?.playerId
    )} & ${getPlayerName(b2?.playerId)}`;
  }
  return event.title;
}

function renderHistoryDetail() {
  const record = appState.historySelection;
  if (!record) {
    historyDetail.innerHTML = '<p class="placeholder">Select an event to view its details.</p>';
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'history-card';
  if (record.data?.unfinished) {
    wrapper.classList.add('unfinished');
  }
  if (record.type === 'duel') {
    const scoreA = formatCupValue(record.data.scoreA);
    const scoreB = formatCupValue(record.data.scoreB);
    wrapper.innerHTML = `
      <div>
        <h3>${formatEventTitle(record)}</h3>
        <p>${scoreA} - ${scoreB} cups</p>
        <p><small>${new Date(record.createdAt).toLocaleString()}</small></p>
      </div>`;
    const winnerCard = document.createElement('div');
    winnerCard.className = 'champion-card';
    winnerCard.innerHTML = `
      <p class="eyebrow small">${record.type === 'doubles' ? 'Winners' : 'Winner'}</p>
      <h2>${getPlayerName(record.data.winner)}</h2>`;
    wrapper.appendChild(winnerCard);
    wrapper.appendChild(createHistoryDeleteButton(record.id));
    historyDetail.innerHTML = '';
    historyDetail.appendChild(wrapper);
    return;
  }
  if (record.type === 'doubles') {
    const meta = document.createElement('div');
    meta.innerHTML = `
      <h3>${formatEventTitle(record)}</h3>
      <p><small>${new Date(record.createdAt).toLocaleString()}</small></p>`;
    const matchLayout = document.createElement('div');
    matchLayout.className = 'doubles-match readonly';
    matchLayout.appendChild(createHistoryTeamColumn(record.data.teamA, 'Team A'));
    matchLayout.appendChild(createHistoryTeamColumn(record.data.teamB, 'Team B'));
    wrapper.appendChild(meta);
    wrapper.appendChild(matchLayout);
    const winnerCard = document.createElement('div');
    winnerCard.className = 'champion-card';
    const winningTeam = record.data.winnerTeam === 'teamA' ? record.data.teamA : record.data.teamB;
    const winnerNames = winningTeam.map((entry) => getPlayerName(entry.playerId)).join(' & ');
    winnerCard.innerHTML = `
      <p class="eyebrow small">Winners</p>
      <h2>${winnerNames}</h2>`;
    wrapper.appendChild(winnerCard);
    wrapper.appendChild(createHistoryDeleteButton(record.id));
    historyDetail.innerHTML = '';
    historyDetail.appendChild(wrapper);
    return;
  }
  const container = document.createElement('div');
  const isTournament = record.type === 'single' || record.type === 'double';
  const isUnfinished = Boolean(record.data?.unfinished);
  let descriptorText = '';
  if (isTournament) {
    const participants = record.data?.tournament?.players?.length || 0;
    const eventStyle = inferEventStyle(record);
    const defaultTitle = getTournamentDefaultTitle(eventStyle, record.type, participants);
    if (record.title !== defaultTitle) {
      descriptorText = getTournamentDescriptor(record.type, eventStyle);
    }
  }
  const header = document.createElement('div');
  header.className = 'history-card-header';
  const titleGroup = document.createElement('div');
  titleGroup.className = 'history-card-title';
  const titleEl = document.createElement('h3');
  titleEl.textContent = record.title;
  titleGroup.appendChild(titleEl);
  if (descriptorText) {
    const descriptorEl = document.createElement('p');
    descriptorEl.className = 'hint';
    descriptorEl.textContent = descriptorText;
    titleGroup.appendChild(descriptorEl);
  }
  const dateEl = document.createElement('p');
  dateEl.innerHTML = `<small>${new Date(record.createdAt).toLocaleString()}</small>`;
  titleGroup.appendChild(dateEl);
  if (isTournament && isUnfinished) {
    const warning = document.createElement('p');
    warning.className = 'hint warning';
    warning.textContent = 'Unfinished tournament';
    titleGroup.appendChild(warning);
  }
  header.appendChild(titleGroup);
  if (isTournament) {
    const actions = document.createElement('div');
    actions.className = 'history-card-header-actions';
    const renameBtn = document.createElement('button');
    renameBtn.className = 'ghost small';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => renameTournamentEvent(record));
    actions.appendChild(renameBtn);
    if (isUnfinished) {
      const loadBtn = document.createElement('button');
      loadBtn.className = 'primary small';
      loadBtn.textContent = 'Load tournament';
      loadBtn.addEventListener('click', () => loadUnfinishedTournament(record));
      actions.appendChild(loadBtn);
    }
    header.appendChild(actions);
  }
  container.appendChild(header);
  const championCard = document.createElement('div');
  championCard.className = 'champion-card';
  championCard.innerHTML = `
    <p class="eyebrow small">${record.data?.style === 'doubles' ? 'Champions' : 'Champion'}</p>
    <h2 data-field="name"></h2>
    <p data-field="subtext"></p>`;
  const bracketWrapper = document.createElement('div');
  bracketWrapper.className = 'bracket';
  container.appendChild(championCard);
  container.appendChild(bracketWrapper);
  wrapper.appendChild(container);
  wrapper.appendChild(createHistoryDeleteButton(record.id));
  historyDetail.innerHTML = '';
  historyDetail.appendChild(wrapper);
  TournamentRenderer.render(bracketWrapper, championCard, record.data.tournament, {
    format: record.type,
    style: record.data?.style || 'solo',
    readOnly: true,
  });
}

function createHistoryDeleteButton(eventId) {
  const button = document.createElement('button');
  button.className = 'history-delete';
  button.textContent = 'Delete';
  button.addEventListener('click', async () => {
    await handleDeleteEvent(eventId);
  });
  return button;
}

function createHistoryTeamColumn(entries, title) {
  const column = document.createElement('div');
  column.className = 'team-column';
  const heading = document.createElement('h3');
  heading.textContent = title;
  column.appendChild(heading);
  (entries || []).forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'team-row readonly';
    const playerChip = document.createElement('div');
    playerChip.className = 'player-chip';
    playerChip.textContent = getPlayerName(entry.playerId);
    const scoreRow = document.createElement('div');
    scoreRow.className = 'score-row';
    const label = document.createElement('span');
    label.className = 'score-label';
    label.textContent = 'Cups';
    const value = document.createElement('span');
    value.className = 'score-value';
    value.textContent = formatCupValue(entry.score);
    scoreRow.append(label, value);
    row.append(playerChip, scoreRow);
    column.appendChild(row);
  });
  return column;
}

async function loadUnfinishedTournament(record) {
  const activeSingle = appState.activeTournaments.single?.state;
  const activeDouble = appState.activeTournaments.double?.state;
  if (activeSingle || activeDouble) {
    alert('Finish or reset the current tournament before loading another.');
    return;
  }
  const format = record.type === 'double' ? 'double' : 'single';
  const state = deserializeTournament(record.data?.tournament);
  if (!state) {
    alert('Unable to load this tournament.');
    return;
  }
  state.scores = state.scores || {};
  appState.activeTournaments[format] = {
    state,
    title: record.title,
    createdAt: record.createdAt,
    eventId: record.id,
    style: record.data?.style || 'solo',
  };
  appState.tournamentConfig.bracketType = format;
  setTournamentStyle(record.data?.style || 'solo', { forceRender: true });
  appState.tournamentConfig.name = record.title;
  if (tournamentView.nameInput) {
    tournamentView.nameInput.value = record.title;
  }
  renderTournamentSelectors();
  renderTournaments();
  updateTournamentBuilderState();
  persistActiveTournamentState(format);
  switchView('tournament');
}

async function renameTournamentEvent(record) {
  const currentName = record.title || '';
  const nextName = prompt('Enter a tournament name', currentName);
  if (!nextName) return;
  const trimmed = nextName.trim();
  if (!trimmed || trimmed === currentName) return;
  await store.updateEvent(record.id, (event) => ({
    ...event,
    title: trimmed,
  }));
  appState.events = (await store.getEvents()).sort((a, b) => b.createdAt - a.createdAt);
  rebuildPlayerStats();
  renderPlayers();
  const format = record.type;
  const context = appState.activeTournaments[format];
  if (context?.eventId === record.id) {
    context.title = trimmed;
    appState.tournamentConfig.name = trimmed;
    if (tournamentView.nameInput) {
      tournamentView.nameInput.value = trimmed;
    }
    renderTournaments();
  }
  appState.historySelection = appState.events.find((evt) => evt.id === record.id) || null;
  renderHistoryList();
  renderHistoryDetail();
}

const TournamentEngine = (() => {
  function createTournament(entries, format) {
    const players = entries.map((entry, index) => ({
      id: entry.id,
      name: entry.name,
      seed: index + 1,
      members: Array.isArray(entry.members) && entry.members.length
        ? entry.members.map((member) => ({
            playerId: member.playerId,
            name: member.name,
          }))
        : [{ playerId: entry.id, name: entry.name }],
    }));
    const base = buildSingleEliminationStructure(players.length);
    const baseState = {
      players,
      matches: base.matches,
      results: base.results,
    };
    if (format === 'double') {
      const doubleStructure = buildDoubleEliminationStructure({
        winnersRounds: base.rounds,
        matches: base.matches,
        results: base.results,
        startMatchId: base.nextMatchId,
        playerCount: players.length,
      });
      return {
        bracketType: 'double',
        players,
        matches: doubleStructure.matches,
        results: doubleStructure.results,
        rounds: {
          winners: base.rounds,
          losers: doubleStructure.losersRounds,
          final: doubleStructure.finalRound.length ? [doubleStructure.finalRound] : [],
        },
        scores: {},
        manualSlots: {},
      };
    }
    return {
      bracketType: 'single',
      players,
      matches: base.matches,
      results: base.results,
      rounds: {
        winners: base.rounds,
        losers: [],
        final: [],
      },
      scores: {},
      manualSlots: {},
    };
  }

  function buildSingleEliminationStructure(playerCount, { startMatchId = 1 } = {}) {
    const safeCount = Math.max(playerCount, 2);
    const totalSlots = 1 << Math.ceil(Math.log2(safeCount));
    const seeding = generateSeeding(totalSlots);
    const matches = {};
    const rounds = [];
    const results = {};
    let matchCounter = startMatchId;

    const firstRound = [];
    for (let i = 0; i < seeding.length; i += 2) {
      const matchId = `m${matchCounter++}`;
      matches[matchId] = {
        id: matchId,
        source1: { type: 'seed', value: seeding[i] },
        source2: { type: 'seed', value: seeding[i + 1] },
      };
      results[matchId] = null;
      firstRound.push(matchId);
    }
    rounds.push(firstRound);

    let prevRound = firstRound;
    while (prevRound.length > 1) {
      const currentRound = [];
      for (let i = 0; i < prevRound.length; i += 2) {
        const matchId = `m${matchCounter++}`;
        matches[matchId] = {
          id: matchId,
          source1: { type: 'matchWinner', value: prevRound[i] },
          source2: { type: 'matchWinner', value: prevRound[i + 1] },
        };
        results[matchId] = null;
        currentRound.push(matchId);
      }
      rounds.push(currentRound);
      prevRound = currentRound;
    }

    return { matches, rounds, results, nextMatchId: matchCounter };
  }

  function buildDoubleEliminationStructure({
    winnersRounds,
    matches,
    results,
    startMatchId,
    playerCount,
  }) {
    const losersRounds = [];
    let nextMatchId = startMatchId;
    let carry = [];
    const sourcePotential = new Map();
    const winnerPotential = new Map();
    const twoPlayerPotential = new Map();

    const registerMatch = (bracket, source1, source2) => {
      const matchId = `m${nextMatchId++}`;
      matches[matchId] = {
        id: matchId,
        bracket,
        source1: source1 || BYE_SOURCE,
        source2: source2 || BYE_SOURCE,
      };
      results[matchId] = null;
      return matchId;
    };

    const sourceKey = (source) => {
      if (!source) return 'null';
      return `${source.type}:${source.value ?? ''}`;
    };

    const sourceHasPlayer = (source) => {
      if (!source) return false;
      const key = sourceKey(source);
      if (sourcePotential.has(key)) return sourcePotential.get(key);
      let has = false;
      if (source.type === 'bye') {
        has = false;
      } else if (source.type === 'seed') {
        has = source.value <= playerCount;
      } else if (source.type === 'matchWinner') {
        has = matchHasAnyPlayer(source.value);
      } else if (source.type === 'matchLoser') {
        has = matchHasTwoPlayers(source.value);
      }
      sourcePotential.set(key, has);
      return has;
    };

    const matchHasAnyPlayer = (matchId) => {
      if (winnerPotential.has(matchId)) return winnerPotential.get(matchId);
      const match = matches[matchId];
      if (!match) return false;
      const has = sourceHasPlayer(match.source1) || sourceHasPlayer(match.source2);
      winnerPotential.set(matchId, has);
      return has;
    };

    const matchHasTwoPlayers = (matchId) => {
      if (twoPlayerPotential.has(matchId)) return twoPlayerPotential.get(matchId);
      const match = matches[matchId];
      if (!match) return false;
      const has = sourceHasPlayer(match.source1) && sourceHasPlayer(match.source2);
      twoPlayerPotential.set(matchId, has);
      return has;
    };

    const playLosersRound = (sources) => {
      if (!sources.length) return [];
      const roundIds = [];
      const winners = [];
      for (let i = 0; i < sources.length; i += 2) {
        const source1 = sources[i] || BYE_SOURCE;
        const source2 = sources[i + 1] || BYE_SOURCE;
        const has1 = sourceHasPlayer(source1);
        const has2 = sourceHasPlayer(source2);
        if (!has1 && !has2) {
          continue;
        }
        if (has1 && !has2) {
          winners.push(source1);
          continue;
        }
        if (!has1 && has2) {
          winners.push(source2);
          continue;
        }
        const matchId = registerMatch('losers', source1, source2);
        roundIds.push(matchId);
        winners.push({ type: 'matchWinner', value: matchId });
      }
      if (roundIds.length) {
        losersRounds.push(roundIds);
      }
      return winners;
    };

    const rotateSources = (list, offset = 1) => {
      if (!list.length) return list;
      const normalized = ((offset % list.length) + list.length) % list.length;
      if (!normalized) return list.slice();
      return list.slice(normalized).concat(list.slice(0, normalized));
    };

    winnersRounds.forEach((roundMatches, index) => {
      const baseLosers = roundMatches.map((matchId) => ({ type: 'matchLoser', value: matchId }));
      if (!baseLosers.length) return;
      const roundNumber = index + 1;
      const losers = roundNumber === 1
        ? baseLosers
        : roundNumber % 2 === 0
          ? [...baseLosers].reverse()
          : baseLosers;

      if (index === 0) {
        carry = playLosersRound(losers);
        return;
      }

      if (!carry.length) {
        carry = playLosersRound(losers);
      } else {
        const mixSources = [];
        const matchCount = Math.max(carry.length, losers.length);
        const adjustedLosers =
          losers.length > 1 ? rotateSources(losers, Math.ceil(losers.length / 2)) : losers;
        for (let i = 0; i < matchCount; i += 1) {
          mixSources.push(carry[i] || BYE_SOURCE);
          mixSources.push(adjustedLosers[i] || BYE_SOURCE);
        }
        carry = playLosersRound(mixSources);
      }

      if (carry.length > 1 || index < winnersRounds.length - 1) {
        carry = playLosersRound(carry);
      }
    });

    const finalRound = [];
    if (carry.length) {
      if (carry.length > 1) {
        carry = playLosersRound(carry);
      }
      if (carry.length) {
        const winnersFinal = winnersRounds[winnersRounds.length - 1][0];
        const finalMatchId = registerMatch(
          'final',
          { type: 'matchWinner', value: winnersFinal },
          carry[0] || BYE_SOURCE
        );
        finalRound.push(finalMatchId);
      }
    }

    return { matches, results, losersRounds, finalRound, nextMatchId };
  }

  function generateSeeding(size) {
    let seeds = [1];
    while (seeds.length < size) {
      const next = [];
      const roundSize = seeds.length * 2;
      seeds.forEach((seed) => {
        next.push(seed);
        next.push(roundSize + 1 - seed);
      });
      seeds = next;
    }
    return seeds;
  }

  function recordWinner(state, matchId, winnerId) {
    if (!state || !winnerId) return;
    if (state.results[matchId] === winnerId) {
      state.results[matchId] = null;
    } else {
      state.results[matchId] = winnerId;
    }
    clearDependents(state, matchId);
  }

  function clearDependents(state, matchId) {
    const queue = findDependents(state, matchId);
    const visited = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      if (state.results[current.id]) {
        state.results[current.id] = null;
      }
      if (state.scores?.[current.id]) {
        delete state.scores[current.id];
      }
      findDependents(state, current.id).forEach((match) => queue.push(match));
    }
  }

  function findDependents(state, targetId) {
    return Object.values(state.matches).filter((match) => {
      return matchesSource(match.source1, targetId) || matchesSource(match.source2, targetId);
    });
  }

  function matchesSource(source, targetId) {
    if (!source) return false;
    if (source.type === 'match' || source.type === 'matchWinner' || source.type === 'matchLoser') {
      return source.value === targetId;
    }
    return false;
  }

  function autoAdvanceByes(state) {
    if (!state) return;
    const allRounds = [...state.rounds.winners, ...state.rounds.losers, ...state.rounds.final];
    let progress = true;
    while (progress) {
      progress = false;
      allRounds.forEach((round) => {
        round.forEach((matchId) => {
          if (state.results[matchId]) return;
          const match = state.matches[matchId];
          if (!match) return;
          const slot1 = getSlotInfo(state, match, 'source1');
          const slot2 = getSlotInfo(state, match, 'source2');
          if (slot1.player && slot2.isBye) {
            state.results[matchId] = slot1.player.id;
            progress = true;
          } else if (slot2.player && slot1.isBye) {
            state.results[matchId] = slot2.player.id;
            progress = true;
          }
        });
      });
    }
  }

  function getSlotInfo(state, match, sourceKey) {
    const manualId = state.manualSlots?.[match?.id]?.[sourceKey];
    if (manualId) {
      const player = state.players?.find((p) => p.id === manualId) || null;
      return { player, isBye: false };
    }
    const source = match?.[sourceKey];
    const player = resolveSource(state, source);
    if (!source) {
      return { player: null, isBye: false };
    }
    if (source.type === 'bye') {
      return { player: null, isBye: true };
    }
    if (source.type === 'seed') {
      const isBye = source.value > state.players.length;
      return { player, isBye };
    }
    return { player, isBye: false };
  }

  function resolveSource(state, source) {
    if (!state || !source) return null;
    if (source.type === 'bye') return null;
    if (source.type === 'seed') {
      const player = state.players[source.value - 1];
      return player || null;
    }
    if (source.type === 'match' || source.type === 'matchWinner') {
      const winnerId = state.results[source.value];
      return winnerId ? state.players.find((p) => p.id === winnerId) ?? null : null;
    }
    if (source.type === 'matchLoser') {
      const match = state.matches[source.value];
      if (!match) return null;
      const winnerId = state.results[source.value];
      if (!winnerId) return null;
      const playerA = resolveSource(state, match.source1);
      const playerB = resolveSource(state, match.source2);
      if (playerA?.id && playerA.id !== winnerId) return playerA;
      if (playerB?.id && playerB.id !== winnerId) return playerB;
      return null;
    }
    return null;
  }

  return {
    createTournament,
    recordWinner,
    autoAdvanceByes,
    getSlotInfo,
  };
})();

const TournamentRenderer = (() => {
  function render(container, championCard, state, { format, readOnly, onWinner, onScoreChange, style } = {}) {
    container.innerHTML = '';
    const groups = normalizeRounds(state.rounds);
    if (!groups.winners.length) {
      container.innerHTML = '<p class="placeholder">No bracket to show yet.</p>';
      championCard.hidden = true;
      return;
    }
    championCard.hidden = false;
    updateChampionCard(championCard, state, format, style);
    const matchNumbers = computeMatchNumbers(state);
    const renderOptions = { readOnly, onWinner, onScoreChange, format, style, matchNumbers };
    if (state.bracketType === 'double') {
      container.appendChild(
        buildSection('Winners bracket', groups.winners, state, renderOptions, 'winners')
      );
      if (groups.losers.length) {
        container.appendChild(
          buildSection('Losers bracket', groups.losers, state, renderOptions, 'losers')
        );
      }
      if (groups.final.length) {
        container.appendChild(
          buildSection('Grand final', groups.final, state, renderOptions, 'final')
        );
      }
    } else {
      container.appendChild(buildTrack(groups.winners, state, renderOptions, 'winners'));
    }
  }

  function buildSection(title, rounds, state, options, bracket) {
    const wrapper = document.createElement('div');
    const heading = document.createElement('h4');
    heading.textContent = title;
    wrapper.appendChild(heading);
    wrapper.appendChild(buildTrack(rounds, state, options, bracket));
    return wrapper;
  }

  function buildTrack(rounds, state, options, bracket = 'winners') {
    const track = document.createElement('div');
    track.className = 'round-track';
    rounds.forEach((roundMatches, index) => {
      track.appendChild(buildRound(roundMatches, index, state, options, bracket));
    });
    return track;
  }

  function buildRound(roundMatches, index, state, options, bracket) {
    const roundEl = document.createElement('div');
    roundEl.className = 'round';
    const title = document.createElement('h3');
    title.className = 'round-title';
    const matchCount = roundMatches.length * 2;
    const roundLabel = getRoundLabel(index, matchCount, bracket);
    if (roundLabel) {
      title.textContent = roundLabel;
      roundEl.appendChild(title);
    }
    roundMatches.forEach((matchId) => {
      const match = state.matches[matchId];
      if (!match) return;
      const slot1 = TournamentEngine.getSlotInfo(state, match, 'source1');
      const slot2 = TournamentEngine.getSlotInfo(state, match, 'source2');
      const isReady = Boolean(slot1.player && slot2.player);
      const isByeMatch = slot1.isBye || slot2.isBye;
      if (hideBYES && isByeMatch) {
        return;
      }
      const block = document.createElement('div');
      block.className = 'match';
      const label = document.createElement('div');
      label.className = 'match-label';
      const number = options.matchNumbers?.[matchId];
      label.textContent = number ? `Match ${number}` : 'Match';
      block.appendChild(label);
      if (isReady) block.classList.add('active');
      block.appendChild(createSlotElement(matchId, slot1, state, isReady, 'source1', options));
      block.appendChild(createSlotElement(matchId, slot2, state, isReady, 'source2', options));
      roundEl.appendChild(block);
    });
    return roundEl;
  }

  function getParticipantMembers(participant) {
    if (!participant) return [];
    if (Array.isArray(participant.members) && participant.members.length) {
      return participant.members.map((member) => ({
        playerId: member.playerId,
        name: member.name,
      }));
    }
    return [{ playerId: participant.id, name: participant.name }];
  }

  function createSlotElement(
    matchId,
    slotInfo,
    state,
    isReady,
    slotKey,
    { readOnly, onWinner, onScoreChange, format, style, matchNumbers } = {}
  ) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slot-wrapper';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot';
    const winnerId = state.results[matchId];
    if (slotInfo.player && winnerId === slotInfo.player.id) {
      btn.classList.add('winner');
    }
    if (slotInfo.isBye) {
      btn.textContent = 'Bye';
      btn.classList.add('waiting');
      btn.disabled = true;
      wrapper.appendChild(btn);
      return wrapper;
    }
    if (!slotInfo.player) {
      btn.textContent = describeWaitingState(state.matches[matchId]?.[slotKey], matchNumbers);
      btn.classList.add('waiting');
      btn.disabled = true;
      wrapper.appendChild(btn);
      return wrapper;
    }
    btn.innerHTML = `<strong>${slotInfo.player.name}</strong>`;
    btn.disabled = readOnly || !isReady;
    if (!readOnly && isReady && typeof onWinner === 'function') {
      btn.addEventListener('click', () => onWinner(matchId, slotInfo.player.id));
    }
    if (
      devMode &&
      !readOnly &&
      style === 'solo' &&
      slotInfo.player &&
      slotInfo.player.members?.length <= 1
    ) {
      btn.dataset.matchId = matchId;
      btn.dataset.slotKey = slotKey;
      btn.dataset.playerId = slotInfo.player.id;
      btn.dataset.format = format;
      btn.dataset.style = style;
      btn.draggable = true;
      btn.addEventListener('dragstart', handleSlotDragStart);
      btn.addEventListener('dragend', handleSlotDragEnd);
      btn.addEventListener('dragover', handleSlotDragOver);
      btn.addEventListener('drop', handleSlotDrop);
    }
    wrapper.appendChild(btn);
    if (slotInfo.player) {
      const members = getParticipantMembers(slotInfo.player);
      const isTeam = members.length > 1;
      if (readOnly) {
        if (isTeam) {
          const list = document.createElement('div');
          list.className = 'member-score-list';
          members.forEach((member) => {
            const row = document.createElement('span');
            row.className = 'score-label';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = member.name;
            const valueSpan = document.createElement('span');
            const memberScore = getMatchScoreValue(state, matchId, slotInfo.player.id, member.playerId);
            valueSpan.textContent = memberScore === 'unknown' ? '?' : memberScore;
            row.append(nameSpan, valueSpan);
            list.appendChild(row);
          });
          wrapper.appendChild(list);
        } else {
          const label = document.createElement('span');
          label.className = 'score-label score-value-only';
          const soloScore = getMatchScoreValue(state, matchId, slotInfo.player.id, members[0]?.playerId);
          label.textContent = soloScore === 'unknown' ? '?' : soloScore;
          wrapper.appendChild(label);
        }
      } else if (isReady) {
        if (isTeam) {
          members.forEach((member) => {
            const row = document.createElement('div');
            row.className = 'score-row team-member-score';
            const label = document.createElement('span');
            label.className = 'score-label';
            label.textContent = member.name;
            const select = document.createElement('select');
            select.className = 'score-select';
            CUP_OPTIONS.forEach((value) => {
              const option = document.createElement('option');
              option.value = value;
              option.textContent = value === 'unknown' ? '?' : value;
              select.appendChild(option);
            });
            select.value = getMatchScoreValue(state, matchId, slotInfo.player.id, member.playerId);
            select.addEventListener('change', () => {
              if (typeof onScoreChange === 'function') {
                onScoreChange(matchId, slotInfo.player.id, select.value, member.playerId);
              }
            });
            row.append(label, select);
            wrapper.appendChild(row);
          });
        } else {
          const select = document.createElement('select');
          select.className = 'score-select';
          CUP_OPTIONS.forEach((value) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value === 'unknown' ? '?' : value;
            select.appendChild(option);
          });
          select.value = getMatchScoreValue(state, matchId, slotInfo.player.id, members[0]?.playerId);
          select.addEventListener('change', () => {
            if (typeof onScoreChange === 'function') {
              onScoreChange(matchId, slotInfo.player.id, select.value, members[0]?.playerId);
            }
          });
          wrapper.appendChild(select);
        }
      }
    }
    return wrapper;
  }

  function updateChampionCard(card, state, format, style = 'solo') {
    const finalMatchId = getChampionMatchId(state);
    if (!finalMatchId) {
      card.hidden = true;
      return;
    }
    const winnerId = state.results[finalMatchId];
    const nameField = card.querySelector('[data-field="name"]');
    const labelField = card.querySelector('[data-field="champion-label"]');
    if (labelField) {
      labelField.textContent = style === 'doubles' ? 'Champions' : 'Champion';
    }
    const subField = card.querySelector('[data-field="subtext"]');
    if (!winnerId) {
      nameField.textContent = 'Waiting for results…';
      subField.textContent = '';
      return;
    }
    const winner = state.players.find((p) => p.id === winnerId);
    nameField.textContent = winner ? winner.name : '?';
    subField.textContent = '';
  }

  function getChampionMatchId(state) {
    if (state.bracketType === 'double' && state.rounds.final.length) {
      const finalRound = state.rounds.final[state.rounds.final.length - 1];
      return finalRound[finalRound.length - 1];
    }
    const finalWinners = state.rounds.winners[state.rounds.winners.length - 1];
    return finalWinners ? finalWinners[0] : null;
  }

  function getRoundLabel(index, playerCount, bracket) {
    if (bracket === 'final') return '';
    if (bracket === 'losers') {
      return `Losers Round ${index + 1}`;
    }
    if (playerCount === 2) return 'Final';
    if (playerCount === 4) return 'Semifinals';
    if (playerCount === 8) return 'Quarterfinals';
    if (playerCount > 8) return `Round of ${playerCount}`;
    return `Round ${index + 1}`;
  }

  function normalizeRounds(rounds) {
    if (Array.isArray(rounds)) {
      return { winners: rounds, losers: [], final: [] };
    }
    return rounds;
  }

  function computeMatchNumbers(state) {
    const numbers = {};
    let counter = 1;
    const winnersRounds = state.rounds?.winners || [];
    const losersRounds = state.rounds?.losers || [];
    const finalRounds = state.rounds?.final || [];

    const isByeSource = (source) => {
      if (!source) return false;
      if (source.type === 'bye') return true;
      if (source.type === 'seed') {
        return source.value > (state.players?.length || 0);
      }
      return false;
    };

    const isVisibleMatch = (matchId) => {
      const match = state.matches?.[matchId];
      if (!match) return false;
      return !(isByeSource(match.source1) || isByeSource(match.source2));
    };

    const isSourceResolved = (source) => {
      if (!source) return true;
      if (source.type === 'bye' || source.type === 'seed') return true;
      if (
        source.type === 'match' ||
        source.type === 'matchWinner' ||
        source.type === 'matchLoser'
      ) {
        return Boolean(numbers[source.value]);
      }
      return true;
    };

    const isMatchReady = (matchId) => {
      const match = state.matches?.[matchId];
      if (!match) return true;
      return isSourceResolved(match.source1) && isSourceResolved(match.source2);
    };

    const processRound = (roundMatches) => {
      (roundMatches || []).forEach((matchId) => {
        if (!numbers[matchId] && isVisibleMatch(matchId)) {
          numbers[matchId] = counter++;
        }
      });
    };

    let losersIndex = 0;
    const tryProcessLosers = () => {
      let progressed = true;
      while (progressed && losersIndex < losersRounds.length) {
        progressed = false;
        const roundMatches = losersRounds[losersIndex] || [];
        if (roundMatches.length && roundMatches.every((matchId) => isMatchReady(matchId))) {
          processRound(roundMatches);
          losersIndex += 1;
          progressed = true;
        }
      }
    };

    winnersRounds.forEach((roundMatches) => {
      processRound(roundMatches);
      tryProcessLosers();
    });

    while (losersIndex < losersRounds.length) {
      const roundMatches = losersRounds[losersIndex] || [];
      if (!roundMatches.length || roundMatches.every((matchId) => isMatchReady(matchId))) {
        processRound(roundMatches);
        losersIndex += 1;
      } else {
        break;
      }
    }

    finalRounds.forEach((roundMatches) => {
      processRound(roundMatches);
    });
    return numbers;
  }

  function describeWaitingState(source, matchNumbers) {
    if (!source) return 'Waiting';
    if (source.type === 'match' || source.type === 'matchWinner') {
      const matchLabel = matchNumbers?.[source.value];
      return matchLabel ? `Winner of ${matchLabel}` : 'Winner TBD';
    }
    if (source.type === 'matchLoser') {
      const matchLabel = matchNumbers?.[source.value];
      return matchLabel ? `Loser of ${matchLabel}` : 'Loser TBD';
    }
    if (source.type === 'seed') {
      return `Seed ${source.value}`;
    }
    if (source.type === 'bye') {
      return 'Waiting';
    }
    return 'Waiting';
  }

  return { render, computeMatchNumbers };
})();

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

init().catch((error) => {
  console.error('Unable to bootstrap the app', error);
});
