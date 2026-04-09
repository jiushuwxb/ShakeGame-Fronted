const config = window.SHAKE_CONFIG;
const stateText = {
  waiting: '等待开始',
  playing: '比赛进行中',
  ended: '比赛结束'
};

const els = {
  title: document.querySelector('#title'),
  brandLine: document.querySelector('#brandLine'),
  status: document.querySelector('#status'),
  timer: document.querySelector('#timer'),
  total: document.querySelector('#total'),
  leaderboard: document.querySelector('#leaderboard'),
  adminToken: document.querySelector('#adminToken'),
  qrcode: document.querySelector('#qrcode'),
  start: document.querySelector('#start'),
  end: document.querySelector('#end'),
  reset: document.querySelector('#reset')
};

let ws;
let snapshot = null;
let countdownTimer = null;

init();

function init() {
  const url = new URL(location.href);
  els.title.textContent = config.activityTitle;
  els.brandLine.textContent = config.brandLine;
  els.adminToken.value = url.searchParams.get('adminToken') || localStorage.getItem('shake_admin_token') || '';
  renderQrCode(new URL('../user/index.html', location.href).toString());
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
  els.adminToken.addEventListener('change', () => {
    localStorage.setItem('shake_admin_token', els.adminToken.value.trim());
  });
  els.start.addEventListener('click', () => sendAdmin('admin_start'));
  els.end.addEventListener('click', () => sendAdmin('admin_end'));
  els.reset.addEventListener('click', () => {
    if (confirm('确认重置活动并清空所有玩家？')) sendAdmin('admin_reset');
  });
}

function sendAdmin(type) {
  localStorage.setItem('shake_admin_token', els.adminToken.value.trim());
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, token: els.adminToken.value.trim() }));
  }
}

function render() {
  const onlinePlayers = snapshot.players.filter((player) => player.online);

  els.status.textContent = stateText[snapshot.status] || snapshot.status;
  els.total.textContent = `${onlinePlayers.length}/${snapshot.maxPlayers}`;
  renderLeaderboard(onlinePlayers.slice(0, 10));
  startCountdown();
}

function renderLeaderboard(players) {
  if (!players.length) {
    els.leaderboard.innerHTML = '<div class="empty">等待玩家扫码加入</div>';
    return;
  }

  const max = Math.max(...players.map((item) => item.count), 1);
  els.leaderboard.innerHTML = players.map((item, index) => `
    <div class="leader-row">
      <div class="rank-no">#${index + 1}</div>
      <img class="avatar" src="${item.avatar || makeAvatar(item.nickname)}" alt="">
      <div>
        <h2>${escapeHtml(item.nickname)}</h2>
        <div class="bar"><span style="width:${Math.max(3, item.count / max * 100)}%"></span></div>
      </div>
      <div class="score">${item.count}</div>
    </div>
  `).join('');
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 250);
}

function updateCountdown() {
  if (!snapshot || snapshot.status !== 'playing' || !snapshot.endsAt) {
    els.timer.textContent = snapshot?.status === 'ended' ? '00' : String(Math.round((snapshot?.durationMs || 60000) / 1000));
    return;
  }

  const remaining = Math.max(0, snapshot.endsAt - Date.now());
  els.timer.textContent = String(Math.ceil(remaining / 1000)).padStart(2, '0');
}

function renderQrCode(text) {
  const encoded = encodeURIComponent(text);
  els.qrcode.innerHTML = `<img width="130" height="130" alt="手机扫码入口" src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encoded}">`;
}

function makeAvatar(name) {
  const label = encodeURIComponent((name || '玩').slice(0, 1));
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop stop-color='%231479ff'/%3E%3Cstop offset='1' stop-color='%2330d5ff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='120' height='120' rx='28' fill='url(%23g)'/%3E%3Ctext x='50%25' y='58%25' dominant-baseline='middle' text-anchor='middle' font-size='54' fill='white' font-family='Arial'%3E${label}%3C/text%3E%3C/svg%3E`;
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
