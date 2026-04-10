const config = window.SHAKE_CONFIG || {};

const els = {
  startButton: document.querySelector('.start-button')
};

let player = loadPlayer();

init();

async function init() {
  setStartButtonReady(false);
  bindEvents();
  await ensureProfile();
  setStartButtonReady(canEnterGame());
}

function bindEvents() {
  els.startButton?.addEventListener('click', () => {
    if (!canEnterGame()) return;
    location.href = './game.html';
  });

  els.startButton?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!canEnterGame()) return;
    location.href = './game.html';
  });
}

async function ensureProfile() {
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
      const response = await fetch(
        `${resolveApiBaseUrl()}/api/wechat/authorize-url?redirectUri=${encodeURIComponent(location.href)}`
      );
      if (response.ok) {
        const data = await response.json();
        if (data.url) {
          location.replace(data.url);
          return;
        }
      }
    } catch (error) {
      console.warn('WeChat authorize-url request failed, fallback to guest.', error);
    }
  }

  player = {
    id: localStorage.getItem('shake_guest_id') || makeId(),
    nickname: `现场玩家${Math.floor(Math.random() * 900 + 100)}`,
    avatar: '',
    source: 'guest'
  };
  localStorage.setItem('shake_guest_id', player.id);
  savePlayer(player);
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

function canEnterGame() {
  return Boolean(player?.id && player?.nickname);
}

function setStartButtonReady(ready) {
  if (!els.startButton) return;
  els.startButton.classList.toggle('is-locked', !ready);
  els.startButton.setAttribute('aria-disabled', ready ? 'false' : 'true');
  els.startButton.tabIndex = ready ? 0 : -1;
}

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `guest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
