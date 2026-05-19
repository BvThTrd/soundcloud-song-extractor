// -- DOM CACHE --
const _dom = {
  urlInput:     document.getElementById('urlInput'),
  playlistBar:  document.getElementById('playlistBar'),
  playlistLabel:document.getElementById('playlistLabel'),
  dlAllBtn:     document.getElementById('dlAllBtn'),
  dlQueue:      document.getElementById('dlQueue'),
  status:       document.getElementById('status'),
  fmtRow:       document.getElementById('fmtRow'),
  pasteBtn:      document.getElementById('pasteBtn'),
  dlBtn:         document.getElementById('dlBtn'),
  waveform:      document.getElementById('waveform'),
  platformBadge: document.getElementById('platformBadge'),
};

// -- SVG ICONS --
const _SVG_CHECK =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">' +
  '<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const _SVG_X =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">' +
  '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

// -- PLATFORM DETECTION --
const _SC_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'on.soundcloud.com', 'm.soundcloud.com']);
const _YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com']);

function _detectPlatform(url) {
  try {
    const host = new URL(url).hostname;
    if (_SC_HOSTS.has(host)) return 'sc';
    if (_YT_HOSTS.has(host)) return 'yt';
  } catch {}
  return null;
}

function _updatePlatformBadge(url) {
  const badge = _dom.platformBadge;
  const p = _detectPlatform(url);
  if (p === 'sc') {
    badge.textContent = 'SoundCloud';
    badge.style.cssText = 'display:inline-block;color:#FF5500;background:rgba(255,85,0,0.1);border-color:rgba(255,85,0,0.25)';
  } else if (p === 'yt') {
    badge.textContent = 'YouTube';
    badge.style.cssText = 'display:inline-block;color:#FF0000;background:rgba(255,0,0,0.1);border-color:rgba(255,0,0,0.25)';
  } else {
    badge.style.display = 'none';
  }
}

// -- CONCURRENCY POOL --
const MAX_CONCURRENT = 5;
let _activeCount = 0;
const _pending = []; // { type:'track'|'playlist', url, fmt, qid }

function _getItem(id) {
  return document.querySelector('[data-dlid="' + id + '"]');
}

function _updatePendingBadges() {
  _pending.forEach((job, i) => {
    const el = _getItem(job.qid);
    if (el) el.querySelector('.dl-badge').textContent = '#' + (i + 1) + ' in queue';
  });
}

function _onJobFinish(qid, state) {
  if (state) dlUpdate(qid, state);
  _activeCount--;
  if (_pending.length > 0) {
    const job = _pending.shift();
    _updatePendingBadges();
    if (job.type === 'track') _runTrack(job.url, job.fmt, job.qid);
    else _runPlaylist(job.url, job.fmt, job.qid);
  }
}

function _setItemLive(qid, state, badge) {
  const el = _getItem(qid);
  if (!el) return;
  el.className = 'dl-item ' + state;
  el.querySelector('.dl-badge').textContent = badge;
  el.querySelector('.dl-spinner').style.display = '';
}

async function _runTrack(url, fmt, qid) {
  _activeCount++;
  _setItemLive(qid, 'fetching', 'Fetching…');

  try {
    const infoRes = await guardedFetch('/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = infoRes && infoRes.ok ? await infoRes.json().catch(() => null) : null;
    if (data && !data.error) dlSetInfo(qid, data);
    else dlSetFallback(qid, _labelFromUrl(url));
  } catch {
    dlSetFallback(qid, _labelFromUrl(url));
  }

  try {
    const res = await guardedFetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: fmt })
    });
    if (!res) { _onJobFinish(qid, 'error'); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      setStatus(data.error || 'Download failed.', 'error');
      _onJobFinish(qid, 'error');
      return;
    }
    dlSetReady(qid, data.token, data.filename);
    _onJobFinish(qid, null);
  } catch (err) {
    setStatus('Network error: ' + err.message, 'error');
    _onJobFinish(qid, 'error');
  }
}

async function _runPlaylist(url, fmt, qid) {
  _activeCount++;
  _setItemLive(qid, 'downloading', 'Converting…');

  try {
    const res = await guardedFetch('/download-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: fmt })
    });
    if (!res) { _onJobFinish(qid, 'error'); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      setStatus(data.error || 'Playlist download failed.', 'error');
      _onJobFinish(qid, 'error');
      return;
    }
    dlSetReady(qid, data.token, data.filename);
    _onJobFinish(qid, null);
  } catch (err) {
    setStatus('Network error: ' + err.message, 'error');
    _onJobFinish(qid, 'error');
  }
}

function enqueueTrack(url, fmt) {
  const qid = dlAdd(url, fmt);
  if (_activeCount < MAX_CONCURRENT) {
    _runTrack(url, fmt, qid);
  } else {
    _pending.push({ type: 'track', url, fmt, qid });
    dlSetQueued(qid, _pending.length);
  }
}

function enqueuePlaylist(url, fmt, title, meta) {
  const qid = dlAddPlaylist(url, title, meta, fmt);
  if (_activeCount < MAX_CONCURRENT) {
    _runPlaylist(url, fmt, qid);
  } else {
    _pending.push({ type: 'playlist', url, fmt, qid });
    dlSetQueued(qid, _pending.length);
  }
}

// -- DOWNLOAD QUEUE UI --
let _dlId = 0;

function _esc(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _labelFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || url);
  } catch { return url; }
}

const _THUMB_PH =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none">' +
  '<circle cx="12" cy="12" r="10" stroke="#2E3D52" stroke-width="1.5"/>' +
  '<path d="M9 8l8 4-8 4V8z" fill="#5A6880"/></svg>';

function _platformQueueBadge(platform) {
  if (platform === 'sc') return '<span class="dl-platform sc">SC</span>';
  if (platform === 'yt') return '<span class="dl-platform yt">YT</span>';
  return '';
}

function _makeItem(id, thumbContent, title, meta, badge, state, fmt, platform) {
  const item = document.createElement('div');
  item.className = 'dl-item ' + state;
  item.dataset.dlid = id;
  item.innerHTML =
    '<div class="dl-thumb">' + thumbContent + '</div>' +
    '<div class="dl-info">' +
      '<div class="dl-title">' + _esc(title) + '</div>' +
      '<div class="dl-meta-row">' +
        '<span class="dl-meta">' + _esc(meta) + '</span>' +
        _platformQueueBadge(platform) +
        (fmt ? '<span class="dl-fmt">' + _esc(fmt.toUpperCase()) + '</span>' : '') +
      '</div>' +
    '</div>' +
    '<div class="dl-status-col">' +
      '<div class="dl-spinner"></div>' +
      '<div class="dl-item-icon" style="display:none"></div>' +
      '<div class="dl-badge">' + badge + '</div>' +
      '<a class="dl-download-btn" style="display:none" target="_blank">Download</a>' +
    '</div>' +
    '<button class="dl-item-close" title="Dismiss">\xd7</button>';

  item.querySelector('.dl-item-close').addEventListener('click', () => {
    const idx = _pending.findIndex(j => j.qid === id);
    if (idx !== -1) {
      _pending.splice(idx, 1);
      _updatePendingBadges();
    }
    item.remove();
    if (!_dom.dlQueue.children.length) _dom.dlQueue.classList.remove('has-items');
  });

  _dom.dlQueue.insertBefore(item, _dom.dlQueue.firstChild);
  _dom.dlQueue.classList.add('has-items');
  return item;
}

function dlAdd(url, fmt) {
  const id = ++_dlId;
  _makeItem(id, _THUMB_PH, 'Loading…', '', 'Fetching…', 'fetching', fmt, _detectPlatform(url));
  return id;
}

function dlAddPlaylist(url, title, meta, fmt) {
  const id = ++_dlId;
  const thumbSvg =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none">' +
    '<path d="M3 6h18M3 12h18M3 18h12" stroke="#FF5500" stroke-width="2" stroke-linecap="round"/></svg>';
  _makeItem(id, thumbSvg, title, meta, 'Converting…', 'downloading', fmt, _detectPlatform(url));
  return id;
}

function dlSetQueued(id, pos) {
  const item = _getItem(id);
  if (!item) return;
  item.className = 'dl-item queued';
  item.querySelector('.dl-badge').textContent = '#' + pos + ' in queue';
  item.querySelector('.dl-spinner').style.display = 'none';
}

function dlSetInfo(id, info) {
  const item = _getItem(id);
  if (!item) return;
  item.className = 'dl-item downloading';
  item.querySelector('.dl-title').textContent = info.title || 'Unknown';
  const parts = [];
  if (info.uploader) parts.push(info.uploader);
  if (info.duration) parts.push(fmtDuration(info.duration));
  item.querySelector('.dl-meta').textContent = parts.join(' \xb7 ');
  item.querySelector('.dl-badge').textContent = 'Converting…';
  if (info.thumbnail) {
    const img = document.createElement('img');
    img.src = info.thumbnail;
    img.alt = '';
    const thumb = item.querySelector('.dl-thumb');
    thumb.innerHTML = '';
    thumb.appendChild(img);
  }
}

function dlSetFallback(id, label) {
  const item = _getItem(id);
  if (!item) return;
  item.className = 'dl-item downloading';
  item.querySelector('.dl-title').textContent = label;
  item.querySelector('.dl-badge').textContent = 'Converting…';
}

function dlUpdate(id, state) {
  const item = _getItem(id);
  if (!item) return;
  item.className = 'dl-item ' + state;
  item.querySelector('.dl-badge').textContent = state === 'done' ? 'Done' : 'Failed';
  item.querySelector('.dl-spinner').style.display = 'none';
  const icon = item.querySelector('.dl-item-icon');
  icon.style.display = 'flex';
  icon.innerHTML = state === 'done' ? _SVG_CHECK : _SVG_X;
}

function dlSetReady(id, token, filename) {
  const item = _getItem(id);
  if (!item) return;
  item.className = 'dl-item ready';
  item.querySelector('.dl-spinner').style.display = 'none';
  item.querySelector('.dl-item-icon').style.display = 'none';
  item.querySelector('.dl-badge').style.display = 'none';
  const btn = item.querySelector('.dl-download-btn');
  btn.href = '/get-file/' + token;
  btn.download = filename;
  btn.style.display = '';
  btn.addEventListener('click', () => {
    setTimeout(() => {
      btn.style.display = 'none';
      item.className = 'dl-item done';
      const icon = item.querySelector('.dl-item-icon');
      icon.style.display = 'flex';
      icon.innerHTML = _SVG_CHECK;
      const badge = item.querySelector('.dl-badge');
      badge.textContent = 'Downloaded';
      badge.style.display = '';
    }, 300);
  }, { once: true });
}

// -- WAVEFORM BARS --
const HEIGHTS = [8,14,20,28,22,16,24,30,18,12,26,20,14,22,16,10,24,20,14,18];
HEIGHTS.forEach((h, i) => {
  const b = document.createElement('div');
  b.className = 'bar';
  b.style.height = h + 'px';
  b.style.animationDelay = (i * 0.06) + 's';
  _dom.waveform.appendChild(b);
});

// -- STATE --
let selectedFormat = 'mp3';

// -- FORMAT BUTTONS --
_dom.fmtRow.addEventListener('click', e => {
  const btn = e.target.closest('.fmt-btn');
  if (!btn) return;
  document.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedFormat = btn.dataset.fmt;
});

// -- PASTE BUTTON --
if (!window.isSecureContext || !navigator.clipboard) {
  _dom.pasteBtn.title = 'Use Ctrl+V to paste';
}
_dom.pasteBtn.addEventListener('click', async () => {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      const text = await navigator.clipboard.readText();
      _dom.urlInput.value = text.trim();
      _dom.urlInput.dispatchEvent(new Event('input'));
    } catch {
      _dom.urlInput.select();
    }
  } else {
    _dom.urlInput.select();
    document.execCommand('paste');
  }
});

// -- AUTH GUARD --
async function guardedFetch(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) { window.location.href = '/login'; return null; }
  return res;
}

// -- HELPERS --
function setStatus(msg, type) {
  _dom.status.textContent = msg;
  _dom.status.className = 'status visible ' + type;
}
function clearStatus() {
  _dom.status.className = 'status';
}
function fmtDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m + ':' + String(s).padStart(2, '0');
}
function getURL() {
  return _dom.urlInput.value.trim();
}

// -- DOWNLOAD (single track) --
_dom.dlBtn.addEventListener('click', () => {
  const url = getURL();
  if (!url) { setStatus('Paste a SoundCloud or YouTube URL first.', 'error'); return; }
  clearStatus();
  enqueueTrack(url, selectedFormat);
});

// -- PLAYLIST HELPERS --
function isPlaylistURL(url) {
  if (/soundcloud\.com\/[^/]+\/sets\//.test(url)) return true;
  try {
    const u = new URL(url);
    if (_YT_HOSTS.has(u.hostname)) {
      return u.pathname === '/playlist' || u.searchParams.has('list');
    }
  } catch {}
  return false;
}

let _playlistInfoTimer = null;

async function fetchPlaylistInfo(url) {
  _dom.playlistBar.classList.add('visible');
  _dom.playlistLabel.textContent = 'Loading playlist info...';
  try {
    const res = await guardedFetch('/playlist-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.error) {
      _dom.playlistLabel.textContent = 'Playlist detected';
      return;
    }
    const n = data.track_count;
    _dom.playlistLabel.textContent = `${data.title} — ${n} track${n !== 1 ? 's' : ''}`;
  } catch {
    _dom.playlistLabel.textContent = 'Playlist detected';
  }
}

// -- URL INPUT + PLAYLIST DETECTION --
_dom.urlInput.addEventListener('input', () => {
  const v = _dom.urlInput.value.trim();
  clearStatus();
  _updatePlatformBadge(v);
  if (isPlaylistURL(v)) {
    _dom.dlAllBtn.style.display = '';
    clearTimeout(_playlistInfoTimer);
    _playlistInfoTimer = setTimeout(() => fetchPlaylistInfo(v), 400);
  } else {
    _dom.playlistBar.classList.remove('visible');
    _dom.dlAllBtn.style.display = 'none';
  }
});

// -- DOWNLOAD ALL (playlist) --
_dom.dlAllBtn.addEventListener('click', () => {
  const url = getURL();
  if (!url) { setStatus('Paste a SoundCloud or YouTube playlist URL first.', 'error'); return; }
  clearStatus();

  const labelText = _dom.playlistLabel.textContent;
  const countMatch = labelText.match(/(\d+)\s+track/);
  const count = countMatch ? parseInt(countMatch[1]) : 0;
  const plTitle = labelText.replace(/\s*—.*$/, '').trim() || 'Playlist';
  const plMeta = 'Playlist\xb7' + (count ? count + ' tracks\xb7' : '') + 'ZIP';

  enqueuePlaylist(url, selectedFormat, plTitle, plMeta);
});
