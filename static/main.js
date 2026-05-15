// -- DOWNLOAD QUEUE --
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

function _makeItem(id, thumbContent, title, meta, badge, state) {
  const list = document.getElementById('dlQueue');
  const item = document.createElement('div');
  item.className = 'dl-item ' + state;
  item.dataset.dlid = id;
  item.innerHTML =
    '<div class="dl-thumb">' + thumbContent + '</div>' +
    '<div class="dl-info">' +
      '<div class="dl-title">' + _esc(title) + '</div>' +
      '<div class="dl-meta">' + _esc(meta) + '</div>' +
    '</div>' +
    '<div class="dl-status-col">' +
      '<div class="dl-spinner"></div>' +
      '<div class="dl-item-icon" style="display:none"></div>' +
      '<div class="dl-badge">' + badge + '</div>' +
    '</div>' +
    '<button class="dl-item-close" title="Dismiss">\xd7</button>';
  item.querySelector('.dl-item-close').addEventListener('click', () => {
    item.remove();
    if (!list.children.length) list.classList.remove('has-items');
  });
  list.insertBefore(item, list.firstChild);
  list.classList.add('has-items');
  return item;
}

// Create a queue entry for a single track (starts in "fetching" state)
function dlAdd() {
  const id = ++_dlId;
  _makeItem(id, _THUMB_PH, 'Loading…', '', 'Fetching…', 'fetching');
  return id;
}

// Create a queue entry for a playlist (starts directly in "downloading" state)
function dlAddPlaylist(title, meta) {
  const id = ++_dlId;
  const thumbSvg =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none">' +
    '<path d="M3 6h18M3 12h18M3 18h12" stroke="#FF5500" stroke-width="2" stroke-linecap="round"/></svg>';
  _makeItem(id, thumbSvg, title, meta, 'Downloading…', 'downloading');
  return id;
}

// Update a queue entry with fetched track info, transition to "downloading"
function dlSetInfo(id, info) {
  const item = document.querySelector('[data-dlid="' + id + '"]');
  if (!item) return;
  item.className = 'dl-item downloading';
  item.querySelector('.dl-title').textContent = info.title || 'Unknown';
  const parts = [];
  if (info.uploader) parts.push(info.uploader);
  if (info.duration) parts.push(fmtDuration(info.duration));
  item.querySelector('.dl-meta').textContent = parts.join(' · ');
  item.querySelector('.dl-badge').textContent = 'Downloading…';
  if (info.thumbnail) {
    const img = document.createElement('img');
    img.src = info.thumbnail;
    img.alt = '';
    const thumb = item.querySelector('.dl-thumb');
    thumb.innerHTML = '';
    thumb.appendChild(img);
  }
}

// Fallback when info fetch fails: show URL slug as title, transition to "downloading"
function dlSetFallback(id, label) {
  const item = document.querySelector('[data-dlid="' + id + '"]');
  if (!item) return;
  item.className = 'dl-item downloading';
  item.querySelector('.dl-title').textContent = label;
  item.querySelector('.dl-badge').textContent = 'Downloading…';
}

// Transition a queue entry to done or error state
function dlUpdate(id, state) {
  const item = document.querySelector('[data-dlid="' + id + '"]');
  if (!item) return;
  item.className = 'dl-item ' + state;
  item.querySelector('.dl-badge').textContent = state === 'done' ? 'Done' : 'Failed';
  item.querySelector('.dl-spinner').style.display = 'none';
  const icon = item.querySelector('.dl-item-icon');
  icon.style.display = 'flex';
  icon.innerHTML = state === 'done'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
}

// -- WAVEFORM BARS --
const wv = document.getElementById('waveform');
const HEIGHTS = [8,14,20,28,22,16,24,30,18,12,26,20,14,22,16,10,24,20,14,18];
HEIGHTS.forEach((h, i) => {
  const b = document.createElement('div');
  b.className = 'bar';
  b.style.height = h + 'px';
  b.style.animationDelay = (i * 0.06) + 's';
  wv.appendChild(b);
});

// -- STATE --
let selectedFormat = 'mp3';

// -- FORMAT BUTTONS --
document.getElementById('fmtRow').addEventListener('click', e => {
  const btn = e.target.closest('.fmt-btn');
  if (!btn) return;
  document.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedFormat = btn.dataset.fmt;
});

// -- PASTE BUTTON --
document.getElementById('pasteBtn').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    document.getElementById('urlInput').value = text.trim();
  } catch {
    document.getElementById('urlInput').focus();
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
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status visible ' + type;
}
function clearStatus() {
  document.getElementById('status').className = 'status';
}
function setProgress(visible, label) {
  const w = document.getElementById('progressWrap');
  w.className = visible ? 'progress-wrap visible' : 'progress-wrap';
  if (label) document.getElementById('progressLabel').textContent = label;
}
function fmtDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m + ':' + String(s).padStart(2, '0');
}
function getURL() {
  return document.getElementById('urlInput').value.trim();
}

// -- DOWNLOAD (single track) --
document.getElementById('dlBtn').addEventListener('click', async () => {
  const url = getURL();
  if (!url) { setStatus('Paste a SoundCloud URL first.', 'error'); return; }
  clearStatus();

  const dlBtn = document.getElementById('dlBtn');
  dlBtn.disabled = true;
  dlBtn.textContent = 'Working...';

  const qid = dlAdd();

  // Step 1: fetch track info for the queue preview
  setProgress(true, 'Fetching track info...');
  try {
    const infoRes = await guardedFetch('/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (infoRes && infoRes.ok) {
      const data = await infoRes.json();
      if (data && !data.error) {
        dlSetInfo(qid, data);
      } else {
        dlSetFallback(qid, _labelFromUrl(url));
      }
    } else {
      dlSetFallback(qid, _labelFromUrl(url));
    }
  } catch {
    dlSetFallback(qid, _labelFromUrl(url));
  }

  // Step 2: download
  setProgress(true, 'Downloading & converting...');
  try {
    const res = await guardedFetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: selectedFormat })
    });

    setProgress(false);
    dlBtn.disabled = false;
    dlBtn.textContent = 'Download';

    if (!res) { dlUpdate(qid, 'error'); return; }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      dlUpdate(qid, 'error');
      setStatus(data.error || 'Download failed.', 'error');
      return;
    }

    const disp = res.headers.get('Content-Disposition') || '';
    let filename = 'track.' + selectedFormat;
    const match = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
    if (match) filename = decodeURIComponent(match[1].replace(/['"]/g, ''));

    const blob = await res.blob();
    const objURL = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objURL;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objURL);

    dlUpdate(qid, 'done');
  } catch (err) {
    setProgress(false);
    dlBtn.disabled = false;
    dlBtn.textContent = 'Download';
    dlUpdate(qid, 'error');
    setStatus('Network error: ' + err.message, 'error');
  }
});

// -- PLAYLIST HELPERS --
function isPlaylistURL(url) {
  return /soundcloud\.com\/[^/]+\/sets\//.test(url);
}

async function fetchPlaylistInfo(url) {
  const bar = document.getElementById('playlistBar');
  bar.classList.add('visible');
  document.getElementById('playlistLabel').textContent = 'Loading playlist info...';

  try {
    const res = await guardedFetch('/playlist-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.error) {
      document.getElementById('playlistLabel').textContent = 'Playlist detected';
      return;
    }
    const n = data.track_count;
    document.getElementById('playlistLabel').textContent =
      `${data.title} — ${n} track${n !== 1 ? 's' : ''}`;
  } catch {
    document.getElementById('playlistLabel').textContent = 'Playlist detected';
  }
}

// -- URL INPUT + PLAYLIST DETECTION --
document.getElementById('urlInput').addEventListener('input', () => {
  const v = document.getElementById('urlInput').value.trim();
  if (!/soundcloud\.com/.test(v)) {
    document.getElementById('playlistBar').classList.remove('visible');
    document.getElementById('dlAllBtn').style.display = 'none';
  } else if (isPlaylistURL(v)) {
    document.getElementById('dlAllBtn').style.display = '';
    fetchPlaylistInfo(v);
  } else {
    document.getElementById('playlistBar').classList.remove('visible');
    document.getElementById('dlAllBtn').style.display = 'none';
  }
  clearStatus();
});

// -- DOWNLOAD ALL (playlist) --
document.getElementById('dlAllBtn').addEventListener('click', async () => {
  const url = getURL();
  if (!url) { setStatus('Paste a SoundCloud playlist URL first.', 'error'); return; }
  clearStatus();

  const labelText = document.getElementById('playlistLabel').textContent;
  const countMatch = labelText.match(/(\d+)\s+track/);
  const count = countMatch ? parseInt(countMatch[1]) : 0;
  const plTitle = labelText.replace(/\s*—.*$/, '').trim() || 'Playlist';
  const plMeta = 'Playlist · ' + (count ? count + ' tracks · ' : '') + 'ZIP';

  setProgress(true, `Downloading playlist${count ? ` (${count} tracks)` : ''}… this may take a while.`);
  const btn = document.getElementById('dlAllBtn');
  btn.disabled = true;
  btn.textContent = 'Working...';

  const qid = dlAddPlaylist(plTitle, plMeta);

  try {
    const res = await guardedFetch('/download-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: selectedFormat })
    });

    setProgress(false);
    btn.disabled = false;
    btn.textContent = 'Download All (ZIP)';

    if (!res) { dlUpdate(qid, 'error'); return; }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      dlUpdate(qid, 'error');
      setStatus(data.error || 'Playlist download failed.', 'error');
      return;
    }

    const blob = await res.blob();
    const objURL = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objURL;
    a.download = 'playlist.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objURL);

    dlUpdate(qid, 'done');
  } catch (err) {
    setProgress(false);
    btn.disabled = false;
    btn.textContent = 'Download All (ZIP)';
    dlUpdate(qid, 'error');
    setStatus('Network error: ' + err.message, 'error');
  }
});
