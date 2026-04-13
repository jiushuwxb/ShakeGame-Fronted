const config = window.SHAKE_CONFIG;
const stateText = {
  waiting: '等待开始',
  playing: '比赛进行中',
  ended: '比赛结束'
};

const els = {
  screenReady: document.querySelector('#screenReady'),
  screenLive: document.querySelector('#screenLive'),
  screenEnd: document.querySelector('#screenEnd'),
  readyTotal: document.querySelector('#readyTotal'),
  readyPlayers: document.querySelector('#readyPlayers'),
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

  els.liveStart?.addEventListener('click', () => sendAdmin('admin_start'));
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
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, token }));
  }
}

function render() {
  if (!snapshot) return;

  const status = snapshot.status || 'waiting';
  const players = status === 'ended'
    ? (snapshot.players || [])
    : (snapshot.players || []).filter((player) => player.online);

  els.screenReady?.classList.toggle('hidden', status !== 'waiting');
  els.screenLive?.classList.toggle('hidden', status !== 'playing');
  els.screenEnd?.classList.toggle('hidden', status !== 'ended');

  renderReadyPlayers(players);
  renderLiveRace(players.slice(0, 10), status === 'playing');
  renderEndLeaderboard(players.slice(0, 5), status === 'ended');

  if (els.liveStatus) els.liveStatus.textContent = stateText[status] || status;
  if (els.liveTotal) {
    els.liveTotal.textContent = `${players.length}/${snapshot.maxPlayers || 10}`;
  }

  startCountdown();
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

  const filledPlayers = Array.from({ length: 10 }, (_, index) => players[index] || {
    nickname: `${123 + index}用户`,
    count: 0
  });

  els.liveLeaderboard.innerHTML = filledPlayers.map((item) => {
    const displayCount = Math.max(0, Number(item.count) || 0);
    const ratioCount = Math.min(LANE_SCORE_MAX, displayCount);
    const fillHeight = displayCount > 0
      ? Math.max(LANE_FILL_MIN_HEIGHT, Math.round((ratioCount / LANE_SCORE_MAX) * LANE_FILL_MAX_HEIGHT))
      : 0;

    return `
      <div class="live-lane">
        <div class="live-lane-score">+${displayCount}</div>
        <div class="live-lane-track">
          <div class="live-lane-fill" style="height:${fillHeight}px"></div>
        </div>
        <div class="live-lane-player">
          <img src="./assets/touxiang.png" alt="">
          <span>${escapeHtml(item.nickname || '现场玩家')}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderEndLeaderboard(players, isEnded) {
  if (!els.endLeaderboard) return;

  if (!isEnded) {
    els.endLeaderboard.innerHTML = '';
    return;
  }

  const rankedPlayers = players.slice().sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
  const winners = Array.from({ length: 5 }, (_, index) => rankedPlayers[index] || {
    nickname: `${123 + index}用户`,
    count: 0
  });

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
