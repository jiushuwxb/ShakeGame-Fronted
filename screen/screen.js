const config = window.SHAKE_CONFIG;
const stateText = {
  waiting: '等待开始',
  playing: '比赛进行中',
  ended: '比赛结束'
};

const els = {
  screenHero: document.querySelector('#screenHero'),
  screenReady: document.querySelector('#screenReady'),
  screenCountdown: document.querySelector('#screenCountdown'),
  screenLive: document.querySelector('#screenLive'),
  screenEnd: document.querySelector('#screenEnd'),
  screenCountdownValue: document.querySelector('#screenCountdownValue'),
  readyTotal: document.querySelector('#readyTotal'),
  readyPlayers: document.querySelector('#readyPlayers'),
  readyStart: document.querySelector('#readyStart'),
  liveStatus: document.querySelector('#liveStatus'),
  liveTimer: document.querySelector('#liveTimer'),
  liveTotal: document.querySelector('#liveTotal'),
  liveLeaderboard: document.querySelector('#liveLeaderboard'),
  endLeaderboard: document.querySelector('#endLeaderboard'),
  liveAdminToken: document.querySelector('#liveAdminToken'),
  endReset: document.querySelector('#endReset'),
  liveStart: document.querySelector('#liveStart'),
  liveEnd: document.querySelector('#liveEnd'),
  liveReset: document.querySelector('#liveReset')
};

const LANE_SCORE_MAX = 999;
const LANE_FILL_MAX_HEIGHT = 174;
const LANE_FILL_MIN_HEIGHT = 16;

let ws;
let snapshot = null;
let countdownTimer = null;
let preGameCountdownTimer = null;
let preGameCountdownValue = null;
let startRequested = false;

init();

function init() {
  const url = new URL(location.href);
  const adminToken = url.searchParams.get('adminToken') || localStorage.getItem('shake_admin_token') || '';
  if (els.liveAdminToken) els.liveAdminToken.value = adminToken;

  connect();
  bindEvents();
}

function connect() {
  ws = new WebSocket(config.wsUrl);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'join_screen' }));
  });

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'snapshot') {
      snapshot = message.data;
      render();
    }
  });

  ws.addEventListener('close', () => {
    setTimeout(connect, 1200);
  });
}

function bindEvents() {
  els.liveAdminToken?.addEventListener('change', () => {
    localStorage.setItem('shake_admin_token', els.liveAdminToken.value.trim());
  });

  els.liveStart?.addEventListener('click', startGameWithCountdown);
  els.readyStart?.addEventListener('click', startGameWithCountdown);
  els.liveEnd?.addEventListener('click', () => sendAdmin('admin_end'));
  els.liveReset?.addEventListener('click', () => {
    if (confirm('确认重置活动并清空所有玩家？')) sendAdmin('admin_reset');
  });
  els.endReset?.addEventListener('click', () => {
    if (confirm('确认重置活动并让所有玩家返回首页？')) sendAdmin('admin_reset');
  });
}

function sendAdmin(type) {
  const token = (els.liveAdminToken?.value || '').trim();
  localStorage.setItem('shake_admin_token', token);
  if (type !== 'admin_start') {
    cancelPreGameCountdown();
  }
  if (type === 'admin_reset') {
    snapshot = {
      ...snapshot,
      status: 'waiting',
      players: [],
      endsAt: null,
      startedAt: null
    };
    render();
  }
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, token }));
  }
}

function render() {
  if (!snapshot) return;

  const status = snapshot.status || 'waiting';
  const allPlayers = snapshot.players || [];
  const onlinePlayers = allPlayers.filter((player) => player.online);
  const players = status === 'ended' ? allPlayers : onlinePlayers;
  const showHero = status !== 'playing' && onlinePlayers.length === 0;
  const showReady = status === 'waiting' && onlinePlayers.length > 0 && !isPreGameCountdownActive() && !startRequested;
  const showCountdown = status === 'waiting' && (isPreGameCountdownActive() || startRequested);

  if (status === 'playing' || status === 'ended') {
    cancelPreGameCountdown();
  }

  els.screenHero?.classList.toggle('hidden', !showHero);
  els.screenReady?.classList.toggle('hidden', !showReady);
  els.screenCountdown?.classList.toggle('hidden', !showCountdown);
  els.screenLive?.classList.toggle('hidden', status !== 'playing');
  els.screenEnd?.classList.toggle('hidden', status !== 'ended' || onlinePlayers.length === 0);

  renderReadyPlayers(onlinePlayers);
  renderLiveRace(players.slice(0, 10), status === 'playing');
  renderEndLeaderboard(players.slice(0, 5), status === 'ended' && onlinePlayers.length > 0);

  if (els.liveStatus) els.liveStatus.textContent = stateText[status] || status;
  if (els.liveTotal) {
    els.liveTotal.textContent = `${onlinePlayers.length}/${snapshot.maxPlayers || 10}`;
  }

  startCountdown();
}

function isPreGameCountdownActive() {
  return typeof preGameCountdownValue === 'number';
}

function startGameWithCountdown() {
  if (!snapshot || snapshot.status !== 'waiting' || startRequested || isPreGameCountdownActive()) return;
  if (ws?.readyState !== WebSocket.OPEN) return;

  preGameCountdownValue = 3;
  renderPreGameCountdown();
  render();

  preGameCountdownTimer = setInterval(() => {
    if (preGameCountdownValue === null) return;

    preGameCountdownValue -= 1;

    if (preGameCountdownValue <= 0) {
      cancelPreGameCountdown();
      startRequested = true;
      if (els.screenCountdownValue) {
        els.screenCountdownValue.textContent = 'GO';
        els.screenCountdownValue.classList.add('is-go');
      }
      render();
      sendAdmin('admin_start');
      return;
    }

    renderPreGameCountdown();
  }, 1000);
}

function cancelPreGameCountdown() {
  if (preGameCountdownTimer) {
    clearInterval(preGameCountdownTimer);
    preGameCountdownTimer = null;
  }
  preGameCountdownValue = null;
  startRequested = false;
}

function renderPreGameCountdown() {
  if (!els.screenCountdownValue) return;
  const value = Math.max(1, Number(preGameCountdownValue) || 1);
  els.screenCountdownValue.textContent = String(value);
  els.screenCountdownValue.classList.toggle('is-go', false);
}

function renderReadyPlayers(players) {
  if (!els.readyPlayers || !els.readyTotal) return;

  els.readyTotal.textContent = String(players.length);
  els.readyPlayers.innerHTML = players.map((player) => `
    <div class="screen-ready-player">
      <img src="./assets/touxiang.png" alt="">
      <span>${escapeHtml(player.nickname || '现场玩家')}</span>
    </div>
  `).join('');
}

function renderLiveRace(players, isPlaying) {
  if (!els.liveLeaderboard) return;

  if (!isPlaying) {
    els.liveLeaderboard.innerHTML = '';
    return;
  }

  const lanesById = new Map(
    Array.from(els.liveLeaderboard.querySelectorAll('.live-lane')).map((node) => [node.dataset.playerId, node])
  );

  const orderedNodes = players.map((item) => {
    const playerId = String(item.id || item.nickname || 'guest');
    const lane = lanesById.get(playerId) || createLiveLane(playerId);
    updateLiveLane(lane, item);
    lanesById.delete(playerId);
    return lane;
  });

  lanesById.forEach((lane) => lane.remove());
  els.liveLeaderboard.replaceChildren(...orderedNodes);
}

function createLiveLane(playerId) {
  const lane = document.createElement('div');
  lane.className = 'live-lane';
  lane.dataset.playerId = playerId;
  lane.innerHTML = `
    <div class="live-lane-score">+0</div>
    <div class="live-lane-track">
      <div class="live-lane-fill" style="height:0"></div>
    </div>
    <div class="live-lane-player">
      <img src="./assets/touxiang.png" alt="">
      <span></span>
    </div>
  `;
  return lane;
}

function updateLiveLane(lane, item) {
  const displayCount = Math.max(0, Number(item.count) || 0);
  const ratioCount = Math.min(LANE_SCORE_MAX, displayCount);
  const fillHeight = displayCount > 0
    ? Math.max(LANE_FILL_MIN_HEIGHT, Math.round((ratioCount / LANE_SCORE_MAX) * LANE_FILL_MAX_HEIGHT))
    : 0;

  const score = lane.querySelector('.live-lane-score');
  const fill = lane.querySelector('.live-lane-fill');
  const name = lane.querySelector('.live-lane-player span');

  if (score) score.textContent = `+${displayCount}`;
  if (fill) fill.style.height = `${fillHeight}px`;
  if (name) name.textContent = item.nickname || '现场玩家';
}

function renderEndLeaderboard(players, isEnded) {
  if (!els.endLeaderboard) return;

  if (!isEnded) {
    els.endLeaderboard.innerHTML = '';
    return;
  }

  const rankedPlayers = players.slice().sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
  const winners = rankedPlayers.slice(0, 5);

  els.endLeaderboard.innerHTML = winners.map((item, index) => {
    const rank = index + 1;
    const crown = rank === 1 ? './assets/crown.png' : rank <= 3 ? './assets/crown1.png' : '';

    return `
      <div class="end-player">
        <div class="end-player-avatar-wrap${rank <= 3 ? ' is-top-three' : ''}">
          ${crown ? `<img src="${crown}" alt="" class="end-player-crown">` : ''}
          <img src="./assets/touxiang.png" alt="" class="end-player-avatar">
        </div>
        <span class="end-player-name">${escapeHtml(item.nickname || '现场玩家')}</span>
      </div>
    `;
  }).join('');
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 250);
}

function updateCountdown() {
  if (!els.liveTimer) return;

  if (!snapshot || snapshot.status !== 'playing' || !snapshot.endsAt) {
    const idleSeconds = snapshot?.status === 'ended' ? 0 : Math.round((snapshot?.durationMs || 60000) / 1000);
    els.liveTimer.textContent = formatLiveTime(idleSeconds * 1000);
    return;
  }

  const remaining = Math.max(0, snapshot.endsAt - Date.now());
  els.liveTimer.textContent = formatLiveTime(remaining);
}

function formatLiveTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
