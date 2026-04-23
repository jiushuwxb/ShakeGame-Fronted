const config = window.SHAKE_CONFIG;
const stateText = {
  waiting: '等待开始',
  playing: '比赛进行中',
  ended: '比赛结束'
};

const els = {
  landingScreen: document.querySelector('#landingScreen'),
  gameScreen: document.querySelector('#gameScreen'),
  startEntry: document.querySelector('#startEntry'),
  startLayer: document.querySelector('#startLayer'),
  startCountdownValue: document.querySelector('#startCountdownValue'),
  playStatus: document.querySelector('#playStatus'),
  playCountdown: document.querySelector('#playCountdown'),
  playCount: document.querySelector('#playCount'),
  playRank: document.querySelector('#playRank'),
  playNickname: document.querySelector('#playNickname'),
  playAvatar: document.querySelector('#playAvatar'),
  playHint: document.querySelector('#playHint'),
  resultOverlay: document.querySelector('#resultOverlay'),
  rankResultClose: document.querySelector('#rankResultClose'),
  prizeResultClose: document.querySelector('#prizeResultClose'),
  resultTestButton: document.querySelector('#resultTestButton'),
  rankResultCard: document.querySelector('#rankResultCard'),
  prizeResultCard: document.querySelector('#prizeResultCard'),
  resultTitle: document.querySelector('#resultTitle'),
  resultRankList: document.querySelector('#resultRankList'),
  resultAvatar: document.querySelector('#resultAvatar'),
  prizeAvatar: document.querySelector('#prizeAvatar'),
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
let lastRotation = null;
let preStartActive = false;
let preStartTimer = null;
let resultShownForRound = null;
let prizePendingForRound = null;
let prizeSwitchTimer = null;

init();

async function init() {
  await ensureProfile();
  showGameScreen(new URL(location.href).searchParams.get('start') === '1');
  renderProfile();
  connect();
  bindEvents();
  prepareStartEntry();
  startMotionListening();
  startGenericAccelerometer();
}

async function ensureProfile() {
  const phoneNickname = resolvePhoneNickname(new URL(location.href));

  if (phoneNickname) {
    player = {
      id: player?.id || localStorage.getItem('shake_guest_id') || makeId(),
      nickname: phoneNickname,
      avatar: player?.avatar || '',
      source: 'phone'
    };
    localStorage.setItem('shake_guest_id', player.id);
    savePlayer(player);
    return;
  }
  // 微信授权逻辑已按要求注释，当前统一使用本地测试玩家身份。
  /*
  /*
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const needsWechatOAuth = isWechat() && !url.searchParams.has('mock');

  if (player?.id && player?.nickname && (!needsWechatOAuth || player.source === 'wechat')) return;

  if (code) {
    try {
      const response = await fetch(`${resolveApiBaseUrl()}/api/wechat/user?code=${encodeURIComponent(code)}`);
      if (response.ok) {
        const user = await response.json();
        player = {
          id: user.openid || makeId(),
          nickname: user.nickname || '微信用户',
          avatar: user.avatar || '',
          source: 'wechat'
        };
        savePlayer(player);
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        history.replaceState(null, '', url.toString());
        return;
      }
    } catch (error) {
      console.warn('WeChat user request failed, fallback to guest.', error);
    }
  }

  if (needsWechatOAuth) {
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
  */

  if (player?.id && player?.nickname) return;

  player = {
    id: localStorage.getItem('shake_guest_id') || makeId(),
    nickname: `现场玩家${Math.floor(Math.random() * 900 + 100)}`,
    avatar: '',
    source: 'guest'
  };
  localStorage.setItem('shake_guest_id', player.id);
  savePlayer(player);
}

function connect() {
  const wsUrl = resolveWsUrl();
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    setTextContent([els.hint], '实时服务已连接，等待比赛开始。');
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
      setTextContent([els.hint], message.reason);
      if (String(message.reason || '').includes('满')) {
        setTimeout(() => alert('房间人数已满'), 0);
        setTimeout(() => location.replace('./index.html'), 0);
      }
    }
  });

  ws.addEventListener('close', () => {
    setTextContent([els.hint], `连接已断开，正在重连：${wsUrl}`);
    setTimeout(connect, 1200);
  });

  ws.addEventListener('error', () => {
    setTextContent([els.hint], `实时连接失败，请确认手机能访问 ${resolveApiBaseUrl()}/health`);
  });
}

function bindEvents() {
  els.startEntry?.addEventListener('click', () => {
    els.hint.textContent = '正在开启传感器，请准备进入游戏。';
    const entryHint = document.querySelector('#entryHint');
    if (entryHint) entryHint.textContent = '正在开启传感器，请稍候...';
    showGameScreen(true);
    requestMotionPermission();
  });
  els.enableMotion?.addEventListener('click', requestMotionPermission);
  els.mockShake?.addEventListener('click', () => onShake());
  // els.resultTestButton?.addEventListener('click', showTestResultCards);
  els.rankResultClose?.addEventListener('click', closeRankResultCard);
  // 暂时关闭中奖弹窗，仅保留排名列表弹窗。
  // els.prizeResultClose?.addEventListener('click', closePrizeResultCard);
}

function showGameScreen(visible) {
  els.landingScreen?.classList.toggle('hidden', visible);
  els.gameScreen?.classList.toggle('hidden', !visible);
}

function setTextContent(nodes, value) {
  nodes.filter(Boolean).forEach((node) => {
    node.textContent = value;
  });
}

function setImageSource(nodes, value) {
  nodes.filter(Boolean).forEach((node) => {
    node.src = value;
  });
}

function formatScore(value) {
  return `+${value}分`;
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function hideResultOverlay() {
  if (prizeSwitchTimer) {
    clearTimeout(prizeSwitchTimer);
    prizeSwitchTimer = null;
  }
  els.resultOverlay?.classList.add('hidden');
  els.rankResultCard?.classList.add('hidden');
  els.prizeResultCard?.classList.add('hidden');
}

function syncResultOverlayVisibility() {
  const hasVisibleCard =
    !els.rankResultCard?.classList.contains('hidden') ||
    !els.prizeResultCard?.classList.contains('hidden');

  els.resultOverlay?.classList.toggle('hidden', !hasVisibleCard);
}

function closeRankResultCard() {
  // 暂时关闭中奖弹窗，仅关闭当前排名列表弹窗。
  // if (prizePendingForRound === snapshot?.endsAt || prizePendingForRound === 'test') {
  //   prizePendingForRound = null;
  //   showPrizeResultCard();
  // }
  els.rankResultCard?.classList.add('hidden');
  syncResultOverlayVisibility();
}

function closePrizeResultCard() {
  if (prizeSwitchTimer) {
    clearTimeout(prizeSwitchTimer);
    prizeSwitchTimer = null;
  }
  prizePendingForRound = null;
  els.prizeResultCard?.classList.add('hidden');
  syncResultOverlayVisibility();
}

function showRankResultCard(players, rank) {
  if (els.resultTitle) {
    els.resultTitle.textContent = `恭喜，您获得第 ${rank} 名！`;
  }
  if (els.resultRankList) {
    els.resultRankList.innerHTML = players.slice(0, 10).map((item, index) => `
      <div class="result-rank-row">
        <span>${index + 1}</span>
        <div class="result-rank-player">
          <img src="./assets/touxiang.png" alt="">
          <span>${escapeHtml(getPlayerDisplayName(item))}</span>
        </div>
        <span class="result-rank-score">${item.count}</span>
      </div>
    `).join('');
  }
  els.rankResultCard?.classList.remove('hidden');
  els.resultOverlay?.classList.remove('hidden');
}

function showPrizeResultCard() {
  if (prizeSwitchTimer) {
    clearTimeout(prizeSwitchTimer);
    prizeSwitchTimer = null;
  }
  els.prizeResultCard?.classList.remove('hidden');
  els.rankResultCard?.classList.remove('hidden');
  els.resultOverlay?.classList.remove('hidden');
}

function showResultOverlay(players, rank) {
  if (!snapshot?.endsAt) return;
  if (resultShownForRound === snapshot.endsAt) return;
  resultShownForRound = snapshot.endsAt;

  // 暂时关闭中奖弹窗，仅更新排名弹窗头像。
  setImageSource([els.resultAvatar], './assets/touxiang.png');
  showRankResultCard(players, rank > 0 ? rank : players.length + 1);

  // 暂时关闭中奖弹窗切换逻辑。
  // if (rank > 0 && rank <= 10) {
  //   prizePendingForRound = snapshot.endsAt;
  //   prizeSwitchTimer = setTimeout(() => {
  //     if (prizePendingForRound === snapshot?.endsAt) {
  //       showPrizeResultCard();
  //       prizePendingForRound = null;
  //     }
  //   }, 2200);
  //   return;
  // }
  prizePendingForRound = null;
}

// function showTestResultCards() {
//   showGameScreen(true);
//   prizePendingForRound = 'test';
//   if (prizeSwitchTimer) {
//     clearTimeout(prizeSwitchTimer);
//     prizeSwitchTimer = null;
//   }
//
//   const demoPlayers = Array.from({ length: 10 }, (_, index) => ({
//     nickname: `187****43${String(50 + index).padStart(2, '0')}`,
//     count: 88888 - index * 111,
//     online: true
//   }));
//
//   setImageSource([els.resultAvatar, els.prizeAvatar], './assets/touxiang.png');
//   showRankResultCard(demoPlayers, 1);
//
//   prizeSwitchTimer = setTimeout(() => {
//     if (prizePendingForRound === 'test') {
//       showPrizeResultCard();
//       prizePendingForRound = null;
//     }
//   }, 1800);
// }

function maskName(name) {
  const value = String(name || '');
  if (value.length <= 2) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function prepareStartEntry() {
  if (!els.startEntry || els.gameScreen && !els.gameScreen.classList.contains('hidden')) return;
  const replacement = els.startEntry.cloneNode(true);
  els.startEntry.replaceWith(replacement);
  els.startEntry = replacement;
  els.startEntry.addEventListener('click', startPreGameSequence);
}

function startPreGameSequence() {
  if (preStartActive) return;
  preStartActive = true;

  const entryHint = document.querySelector('#entryHint');
  if (els.startEntry) els.startEntry.disabled = true;
  els.landingScreen?.classList.add('is-starting');
  els.startLayer?.setAttribute('aria-hidden', 'false');
  updatePreStartCountdown(3);

  setTextContent([els.hint], '正在开启传感器，请准备开始游戏。');
  if (entryHint) entryHint.textContent = '3';

  requestMotionPermission().catch(() => {});

  const steps = [3, 2, 1, 0];
  let index = 0;

  if (preStartTimer) clearInterval(preStartTimer);
  preStartTimer = setInterval(() => {
    index += 1;
    const value = steps[index];

    if (typeof value !== 'number') {
      clearInterval(preStartTimer);
      preStartTimer = null;
      finishPreGameSequence();
      return;
    }

    updatePreStartCountdown(value);
    if (entryHint) entryHint.textContent = value === 0 ? 'GO' : String(value);
  }, 1000);
}

function updatePreStartCountdown(value) {
  if (!els.startCountdownValue) return;
  const isGo = value === 0;
  els.startCountdownValue.textContent = isGo ? 'GO' : String(value);
  els.startCountdownValue.classList.toggle('is-go', isGo);
}

function finishPreGameSequence() {
  const entryHint = document.querySelector('#entryHint');
  els.startLayer?.setAttribute('aria-hidden', 'true');
  els.landingScreen?.classList.remove('is-starting');
  if (entryHint) entryHint.textContent = '游戏开始';
  showGameScreen(true);
}

function startMotionListening() {
  if (motionListenerStarted) return;
  motionListenerStarted = true;
  window.addEventListener('devicemotion', (event) => {
    const acc = getAcceleration(event);
    const now = Date.now();
    const rotation = getRotationRate(event);

    if (!acc && !rotation) return;

    motionDetected = true;

    if (acc) {
      const current = { x: acc.x || 0, y: acc.y || 0, z: acc.z || 0, time: now };
      handleMotionVector(current, 'DeviceMotion');
    }

    if (rotation) {
      handleRotationRate(rotation, now);
    }
  }, { passive: true });
}

async function requestMotionPermission() {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    const result = await DeviceMotionEvent.requestPermission();
    setTextContent([els.hint], result === 'granted' ? '传感器已开启，比赛开始后用力摇动手机。' : '未获得传感器权限，可尝试刷新或使用安卓/微信环境。');
    if (result === 'granted') {
      startMotionListening();
      startGenericAccelerometer();
      watchMotionProbe();
    }
    return;
  }

  setTextContent([els.hint], window.isSecureContext
    ? '传感器监听已开启，比赛开始后用力摇动手机。'
    : '当前是非 HTTPS 局域网页面，部分手机浏览器会直接禁用运动传感器且不弹授权。');
  startMotionListening();
  startGenericAccelerometer();
  watchMotionProbe();
}

function onShake() {
  if (snapshot?.status !== 'playing') return;
  if (getRemainingGameMs() <= 0) return;

  const now = Date.now();
  if (now - lastShakeAt < 150) return;
  lastShakeAt = now;

  localCount += 1;
  setTextContent([els.count, els.playCount], formatScore(localCount));
  if (els.playRank) {
    els.playRank.textContent = formatScore(localCount);
  }

  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'shake', delta: 1 }));
  }
}

function syncFromSnapshot() {
  if (typeof snapshot.serverTime === 'number') {
    clockOffsetMs = snapshot.serverTime - Date.now();
  }

  const onlinePlayers = snapshot.players.filter((item) => item.online);
  const nextRoundId = snapshot.status === 'playing' ? snapshot.startedAt : null;
  const current = snapshot.players.find((item) => item.id === player.id);
  const onlineRank = onlinePlayers.findIndex((item) => item.id === player.id) + 1;
  const maxPlayers = snapshot.maxPlayers || Number.MAX_SAFE_INTEGER;

  if (snapshot.status === 'waiting' && !current && onlinePlayers.length >= maxPlayers) {
    setTimeout(() => alert('房间人数已满'), 0);
    location.replace('./index.html');
    return;
  }

  if (snapshot.status === 'waiting' && !current) {
    resetPlayerGameState();
    location.replace('./index.html');
    return;
  }

  if (nextRoundId && nextRoundId !== currentRoundId) {
    currentRoundId = nextRoundId;
    localCount = current?.count || 0;
    lastShakeAt = 0;
    prizePendingForRound = null;
    hideResultOverlay();
  }

  if (snapshot.status !== 'playing' && currentRoundId) {
    currentRoundId = null;
  }

  if (current) {
    localCount = snapshot.status === 'playing' ? Math.max(localCount, current.count) : current.count;
    if (els.rank) {
      els.rank.textContent = onlineRank > 0 ? `第 ${onlineRank} 名` : '--';
    }
    if (els.playRank) {
      els.playRank.textContent = formatScore(localCount);
    }
  }

  setTextContent([els.status, els.playStatus], stateText[snapshot.status] || snapshot.status);
  setTextContent([els.count, els.playCount], formatScore(localCount));
  if (els.playRank) {
    els.playRank.textContent = formatScore(localCount);
  }
  els.statusCard.classList.toggle('is-ended', snapshot.status === 'ended');
  setTextContent([els.hint, els.playHint], getHint(snapshot.status));

  renderRanking(onlinePlayers.slice(0, 5));
  startCountdown();

  if (snapshot.status === 'ended') {
    showResultOverlay(onlinePlayers, onlineRank);
    if (redirectScheduled) return;
    if (hasRedirectedForCurrentRound()) return;
    redirectScheduled = true;
    // setTimeout(() => {
    //   markRedirectedForCurrentRound();
    //   if (config.questionnaireUrl) location.href = config.questionnaireUrl;
    // }, 5000);
  } else {
    redirectScheduled = false;
    if (snapshot.status === 'waiting') {
      resultShownForRound = null;
      prizePendingForRound = null;
      hideResultOverlay();
    }
  }
}

function resetPlayerGameState() {
  localCount = 0;
  lastShakeAt = 0;
  currentRoundId = null;
  redirectScheduled = false;
  resultShownForRound = null;
  prizePendingForRound = null;
  setTextContent([els.count, els.playCount], formatScore(0));
  if (els.rank) els.rank.textContent = '--';
  if (els.playRank) els.playRank.textContent = formatScore(0);
  hideResultOverlay();
}

function renderProfile() {
  setTextContent([els.nickname, els.playNickname], getPlayerDisplayName(player));
  if (els.rank) {
    els.rank.textContent = '--';
  }
  if (els.playRank) {
    els.playRank.textContent = formatScore(localCount);
  }
  setImageSource([els.avatar, els.playAvatar], './assets/touxiang.png');
}

function renderRanking(players) {
  if (!players.length) {
    els.ranking.innerHTML = '<div class="empty">等待玩家扫码加入</div>';
    return;
  }

  const max = Math.max(...players.map((item) => item.count), 1);
  els.ranking.innerHTML = players.map((item, index) => `
    <div class="rank-row">
      <div class="rank-no">${index + 1}</div>
      <img class="avatar" src="${item.avatar || makeAvatar(getPlayerDisplayName(item))}" alt="">
      <div>
        <strong>${escapeHtml(getPlayerDisplayName(item))}</strong>
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
    const idleValue = snapshot?.status === 'ended' ? '00:00' : '--:--';
    setTextContent([els.countdown, els.playCountdown], idleValue);
    return;
  }

  const remaining = getRemainingGameMs();
  setTextContent([els.countdown, els.playCountdown], formatCountdown(remaining));
}

function getServerNow() {
  return Date.now() + clockOffsetMs;
}

function getRemainingGameMs() {
  if (!snapshot?.endsAt) return 0;
  return Math.max(0, snapshot.endsAt - getServerNow());
}

function getHint(status) {
  if (status === 'waiting') return '游戏还未开始，请稍后！';
  if (status === 'playing') return '游戏进行中！';
  return '游戏已结束！';
}

function watchMotionProbe() {
  motionDetected = false;
  setTimeout(() => {
    if (!motionDetected) {
      setTextContent([els.hint], '还没有检测到传感器数据。微信/浏览器可能要求 HTTPS 或系统运动权限，请先用“测试摇一次”确认链路。');
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
    accelerometer.addEventListener('error', () => {});
    accelerometer.start();
  } catch {}
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

  if (diff > 3.2 || peak > 1.8 || speed > 180) onShake();
}

function handleRotationRate(rotation, now) {
  const current = {
    alpha: Math.abs(rotation.alpha || 0),
    beta: Math.abs(rotation.beta || 0),
    gamma: Math.abs(rotation.gamma || 0),
    time: now
  };

  if (!lastRotation) {
    lastRotation = current;
    return;
  }

  const da = Math.abs(current.alpha - lastRotation.alpha);
  const db = Math.abs(current.beta - lastRotation.beta);
  const dg = Math.abs(current.gamma - lastRotation.gamma);
  const diff = da + db + dg;
  const peak = Math.max(da, db, dg, current.alpha, current.beta, current.gamma);
  lastRotation = current;

  if (diff > 60 || peak > 100) {
    onShake();
  }
}

function getAcceleration(event) {
  const gravity = event.accelerationIncludingGravity;
  const linear = event.acceleration;

  if (hasAxisValue(gravity)) return gravity;
  if (hasAxisValue(linear)) return linear;
  return null;
}

function getRotationRate(event) {
  return hasRotationValue(event.rotationRate) ? event.rotationRate : null;
}

function hasAxisValue(value) {
  return value && [value.x, value.y, value.z].some((axis) => typeof axis === 'number' && !Number.isNaN(axis));
}

function hasRotationValue(value) {
  return value && [value.alpha, value.beta, value.gamma].some((axis) => typeof axis === 'number' && !Number.isNaN(axis));
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

function resolvePhoneNickname(url) {
  return maskPhone(url.searchParams.get('phone'));
}

function maskPhone(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{11}$/.test(text)) return `${text.slice(0, 3)}****${text.slice(-4)}`;
  if (/^\d{3}\*{4}\d{4}$/.test(text)) return text;
  return text;
}

function getPlayerDisplayName(value) {
  return value?.phone || value?.nickname || '现场玩家';
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
