const config = window.SHAKE_CONFIG;
const stateText = {
  waiting: '等待开始',
  playing: '比赛进行中',
  ended: '比赛结束'
};

const els = {
  status: document.querySelector('#status'),
  countdown: document.querySelector('#countdown'),
  count: document.querySelector('#count'),
  statusCard: document.querySelector('#statusCard'),
  rank: document.querySelector('#rank'),
  nickname: document.querySelector('#nickname'),
  avatar: document.querySelector('#avatar'),
  hint: document.querySelector('#hint'),
  ranking: document.querySelector('#ranking'),
  enableMotion: document.querySelector('#enableMotion'),
  mockShake: document.querySelector('#mockShake'),
  sensorStatus: document.querySelector('#sensorStatus'),
  sensorDebug: document.querySelector('#sensorDebug')
};

let ws;
let snapshot = null;
let player = loadPlayer();
let localCount = 0;
let lastShakeAt = 0;
let lastMotion = null;
let countdownTimer = null;
let redirectScheduled = false;
let motionDetected = false;
let clockOffsetMs = 0;
let currentRoundId = null;
let motionListenerStarted = false;
let accelerometer = null;

init();

async function init() {
  await ensureProfile();
  renderProfile();
  renderSensorDebug('页面加载');
  connect();
  bindEvents();
  startMotionListening();
  startGenericAccelerometer();
}

async function ensureProfile() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');

  if (player?.id && player?.nickname) return;

  if (code) {
    try {
      const response = await fetch(`${resolveApiBaseUrl()}/api/wechat/user?code=${encodeURIComponent(code)}`);
      if (response.ok) {
        const user = await response.json();
        player = {
          id: user.openid || makeId(),
          nickname: user.nickname || '微信用户',
          avatar: user.avatar || ''
        };
        savePlayer(player);
        url.searchParams.delete('code');
        history.replaceState(null, '', url.toString());
        return;
      }
    } catch (error) {
      console.warn('WeChat user request failed, fallback to guest.', error);
    }
  }

  if (isWechat() && !url.searchParams.has('mock')) {
    try {
      const response = await fetch(`${resolveApiBaseUrl()}/api/wechat/authorize-url?redirectUri=${encodeURIComponent(location.href)}`);
      if (response.ok) {
        const data = await response.json();
        location.replace(data.url);
        return;
      }
    } catch (error) {
      console.warn('WeChat authorize-url request failed, fallback to guest.', error);
    }
  }

  player = {
    id: localStorage.getItem('shake_guest_id') || makeId(),
    nickname: `现场玩家${Math.floor(Math.random() * 900 + 100)}`,
    avatar: ''
  };
  localStorage.setItem('shake_guest_id', player.id);
  savePlayer(player);
}

function connect() {
  const wsUrl = resolveWsUrl();
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    els.hint.textContent = '实时服务已连接，等待比赛开始。';
    ws.send(JSON.stringify({ type: 'join_player', player }));
  });

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'joined') {
      player.id = message.playerId;
      savePlayer(player);
      snapshot = message.data;
      syncFromSnapshot();
    }

    if (message.type === 'snapshot') {
      snapshot = message.data;
      syncFromSnapshot();
    }

    if (message.type === 'join_rejected') {
      els.hint.textContent = message.reason;
    }
  });

  ws.addEventListener('close', () => {
    els.hint.textContent = `连接已断开，正在重连：${wsUrl}`;
    setTimeout(connect, 1200);
  });

  ws.addEventListener('error', () => {
    els.hint.textContent = `实时连接失败，请确认手机能访问 ${resolveApiBaseUrl()}/health`;
  });
}

function bindEvents() {
  els.enableMotion.addEventListener('click', requestMotionPermission);
  els.mockShake.addEventListener('click', () => onShake());
}

function startMotionListening() {
  if (motionListenerStarted) return;
  motionListenerStarted = true;
  window.addEventListener('devicemotion', (event) => {
    const acc = getAcceleration(event);
    if (!acc) return;

    motionDetected = true;
    const now = Date.now();
    const current = { x: acc.x || 0, y: acc.y || 0, z: acc.z || 0, time: now };

    handleMotionVector(current, 'DeviceMotion');
  }, { passive: true });
}

async function requestMotionPermission() {
  renderSensorDebug('点击授权');

  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    const result = await DeviceMotionEvent.requestPermission();
    els.hint.textContent = result === 'granted' ? '传感器已开启，比赛开始后用力摇动手机。' : '未获得传感器权限，可尝试刷新或使用安卓/微信环境。';
    els.sensorStatus.textContent = result === 'granted' ? '传感器状态：已授权，等待数据' : '传感器状态：未授权';
    if (result === 'granted') {
      startMotionListening();
      startGenericAccelerometer();
      watchMotionProbe();
    }
    return;
  }

  els.hint.textContent = window.isSecureContext
    ? '传感器监听已开启，比赛开始后用力摇动手机。'
    : '当前是非 HTTPS 局域网页面，部分手机浏览器会直接禁用运动传感器且不弹授权。';
  els.sensorStatus.textContent = '传感器状态：监听中，等待数据';
  startMotionListening();
  startGenericAccelerometer();
  watchMotionProbe();
}

function onShake() {
  if (snapshot?.status !== 'playing') return;

  const now = Date.now();
  if (now - lastShakeAt < 150) return;
  lastShakeAt = now;

  localCount += 1;
  els.count.textContent = localCount;

  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'shake', delta: 1 }));
  }
}

function syncFromSnapshot() {
  if (typeof snapshot.serverTime === 'number') {
    clockOffsetMs = snapshot.serverTime - Date.now();
  }

  const nextRoundId = snapshot.status === 'playing' ? snapshot.startedAt : null;
  const current = snapshot.players.find((item) => item.id === player.id);

  if (nextRoundId && nextRoundId !== currentRoundId) {
    currentRoundId = nextRoundId;
    localCount = current?.count || 0;
    lastShakeAt = 0;
  }

  if (snapshot.status !== 'playing' && currentRoundId) {
    currentRoundId = null;
  }

  if (current) {
    localCount = snapshot.status === 'playing' ? Math.max(localCount, current.count) : current.count;
    els.rank.textContent = current.rank ? `第 ${current.rank} 名` : '--';
  }

  els.status.textContent = stateText[snapshot.status] || snapshot.status;
  els.count.textContent = localCount;
  els.statusCard.classList.toggle('is-ended', snapshot.status === 'ended');
  els.hint.textContent = getHint(snapshot.status);

  renderRanking(snapshot.players.slice(0, 5));
  startCountdown();

  if (snapshot.status === 'ended') {
    if (redirectScheduled) return;
    if (hasRedirectedForCurrentRound()) return;
    redirectScheduled = true;
    setTimeout(() => {
      markRedirectedForCurrentRound();
      if (config.questionnaireUrl) location.href = config.questionnaireUrl;
    }, 5000);
  } else {
    redirectScheduled = false;
  }
}

function renderProfile() {
  els.nickname.textContent = player.nickname;
  els.avatar.src = player.avatar || makeAvatar(player.nickname);
}

function renderRanking(players) {
  if (!players.length) {
    els.ranking.innerHTML = '<div class="empty">等待玩家扫码加入</div>';
    return;
  }

  const max = Math.max(...players.map((item) => item.count), 1);
  els.ranking.innerHTML = players.map((item) => `
    <div class="rank-row">
      <div class="rank-no">${item.rank}</div>
      <img class="avatar" src="${item.avatar || makeAvatar(item.nickname)}" alt="">
      <div>
        <strong>${escapeHtml(item.nickname)}</strong>
        <div class="bar"><span style="width:${Math.max(4, item.count / max * 100)}%"></span></div>
      </div>
      <strong>${item.count}</strong>
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
    els.countdown.textContent = snapshot?.status === 'ended' ? '00' : '--';
    return;
  }

  const serverNow = Date.now() + clockOffsetMs;
  const remaining = Math.max(0, snapshot.endsAt - serverNow);
  els.countdown.textContent = String(Math.ceil(remaining / 1000)).padStart(2, '0');
}

function getHint(status) {
  if (status === 'waiting') return '等待大屏开始比赛。请先点击“开启摇一摇权限”。';
  if (status === 'playing') return '全力摇动手机，每一次有效摇动都会实时回传到大屏。';
  if (hasRedirectedForCurrentRound()) return '比赛结束，已完成本轮问卷跳转，返回后不会重复跳转。';
  return '比赛结束，5 秒后自动跳转问卷星领奖页面。';
}

function watchMotionProbe() {
  motionDetected = false;
  setTimeout(() => {
    if (!motionDetected) {
      els.hint.textContent = '还没有检测到传感器数据。微信/浏览器可能要求 HTTPS 或系统运动权限，请先用“测试摇一次”确认链路。';
      els.sensorStatus.textContent = '传感器状态：未收到数据';
      renderSensorDebug('未收到数据');
    }
  }, 2500);
}

function startGenericAccelerometer() {
  if (accelerometer || !('Accelerometer' in window)) return;

  try {
    accelerometer = new Accelerometer({ frequency: 30 });
    accelerometer.addEventListener('reading', () => {
      motionDetected = true;
      const current = {
        x: accelerometer.x || 0,
        y: accelerometer.y || 0,
        z: accelerometer.z || 0,
        time: Date.now()
      };

      handleMotionVector(current, 'Accelerometer');
    });
    accelerometer.addEventListener('error', (event) => {
      els.sensorStatus.textContent = `传感器状态：Accelerometer 错误 ${event.error?.name || 'unknown'}`;
      renderSensorDebug(`Accelerometer ${event.error?.name || 'error'}`);
    });
    accelerometer.start();
  } catch (error) {
    els.sensorStatus.textContent = `传感器状态：Accelerometer 不可用 ${error.name || ''}`;
    renderSensorDebug(`Accelerometer unavailable`);
  }
}

function handleMotionVector(current, source) {
  if (!lastMotion) {
    lastMotion = current;
    return;
  }

  const dx = Math.abs(current.x - lastMotion.x);
  const dy = Math.abs(current.y - lastMotion.y);
  const dz = Math.abs(current.z - lastMotion.z);
  const diff = dx + dy + dz;
  const peak = Math.max(dx, dy, dz);
  const elapsed = Math.max(16, current.time - lastMotion.time);
  const speed = (diff / elapsed) * 1000;
  lastMotion = current;
  els.sensorStatus.textContent = `传感器状态：${source} 已收到数据，变化量 ${diff.toFixed(1)}，速度 ${speed.toFixed(0)}`;

  if (diff > 3.2 || peak > 1.8 || speed > 180) onShake();
}

function getAcceleration(event) {
  const gravity = event.accelerationIncludingGravity;
  const linear = event.acceleration;

  if (hasAxisValue(gravity)) return gravity;
  if (hasAxisValue(linear)) return linear;
  return null;
}

function renderSensorDebug(reason) {
  const hasPermissionApi = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  const hasDeviceMotion = 'DeviceMotionEvent' in window;
  const hasAccelerometer = 'Accelerometer' in window;
  const secure = window.isSecureContext ? '安全' : '非安全';
  els.sensorDebug.textContent = `传感器诊断：${reason}；${secure}上下文；DeviceMotion=${hasDeviceMotion ? '支持' : '不支持'}；授权API=${hasPermissionApi ? '支持' : '不支持'}；Accelerometer=${hasAccelerometer ? '支持' : '不支持'}`;
}

function hasAxisValue(value) {
  return value && [value.x, value.y, value.z].some((axis) => typeof axis === 'number' && !Number.isNaN(axis));
}

function loadPlayer() {
  try {
    return JSON.parse(localStorage.getItem('shake_player') || 'null');
  } catch {
    return null;
  }
}

function savePlayer(value) {
  localStorage.setItem('shake_player', JSON.stringify(value));
}

function isWechat() {
  return /MicroMessenger/i.test(navigator.userAgent);
}

function resolveApiBaseUrl() {
  if (config.apiBaseUrl && !config.apiBaseUrl.includes('localhost')) return config.apiBaseUrl;
  return `${location.protocol}//${location.hostname}:3000`;
}

function resolveWsUrl() {
  if (config.wsUrl && !config.wsUrl.includes('localhost')) return config.wsUrl;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.hostname}:3000`;
}

function currentRoundRedirectKey() {
  return `shake_questionnaire_redirected_${snapshot?.endsAt || 'waiting'}_${player?.id || 'guest'}`;
}

function hasRedirectedForCurrentRound() {
  if (!snapshot?.endsAt) return false;
  return sessionStorage.getItem(currentRoundRedirectKey()) === '1';
}

function markRedirectedForCurrentRound() {
  if (snapshot?.endsAt) sessionStorage.setItem(currentRoundRedirectKey(), '1');
}

function makeAvatar(name) {
  const label = encodeURIComponent((name || '玩').slice(0, 1));
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop stop-color='%231479ff'/%3E%3Cstop offset='1' stop-color='%2330d5ff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='120' height='120' rx='28' fill='url(%23g)'/%3E%3Ctext x='50%25' y='58%25' dominant-baseline='middle' text-anchor='middle' font-size='54' fill='white' font-family='Arial'%3E${label}%3C/text%3E%3C/svg%3E`;
}

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `guest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
