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
  const el = document.getElementById('status');
  el.className = 'status';
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

// -- PREVIEW --
document.getElementById('infoBtn').addEventListener('click', async () => {
  const url = getURL();
  if (!url) { setStatus('Paste a SoundCloud URL first.', 'error'); return; }
  clearStatus();
  setProgress(true, 'Fetching track info...');
  document.getElementById('infoBtn').disabled = true;

  try {
    const res = await guardedFetch('/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!res) return;
    const data = await res.json();
    setProgress(false);
    document.getElementById('infoBtn').disabled = false;

    if (!res.ok || data.error) {
      setStatus(data.error || 'Could not fetch track info.', 'error'); return;
    }

    document.getElementById('previewTitle').textContent = data.title;
    document.getElementById('previewArtist').textContent = data.uploader;
    document.getElementById('previewDuration').textContent = fmtDuration(data.duration);

    const thumb = document.getElementById('thumbImg');
    const placeholder = document.getElementById('thumbPlaceholder');
    if (data.thumbnail) {
      thumb.src = data.thumbnail;
      thumb.style.display = 'block';
      placeholder.style.display = 'none';
    } else {
      thumb.style.display = 'none';
      placeholder.style.display = 'flex';
    }

    document.getElementById('preview').classList.add('visible');
  } catch (err) {
    setProgress(false);
    document.getElementById('infoBtn').disabled = false;
    setStatus('Network error: ' + err.message, 'error');
  }
});

// -- DOWNLOAD --
document.getElementById('dlBtn').addEventListener('click', async () => {
  const url = getURL();
  if (!url) { setStatus('Paste a SoundCloud URL first.', 'error'); return; }
  clearStatus();
  setProgress(true, 'Downloading & processing track...');
  const dlBtn = document.getElementById('dlBtn');
  dlBtn.disabled = true;
  dlBtn.textContent = 'Working...';

  try {
    const res = await guardedFetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: selectedFormat })
    });

    setProgress(false);
    dlBtn.disabled = false;
    dlBtn.textContent = 'Download';

    if (!res) return;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
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

    setStatus('Download complete: ' + filename, 'success');
  } catch (err) {
    setProgress(false);
    dlBtn.disabled = false;
    dlBtn.textContent = 'Download';
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
    document.getElementById('preview').classList.remove('visible');
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

// -- DOWNLOAD ALL --
document.getElementById('dlAllBtn').addEventListener('click', async () => {
  const url = getURL();
  if (!url) { setStatus('Paste a SoundCloud playlist URL first.', 'error'); return; }
  clearStatus();

  const labelText = document.getElementById('playlistLabel').textContent;
  const countMatch = labelText.match(/(\d+)\s+track/);
  const count = countMatch ? parseInt(countMatch[1]) : 0;

  setProgress(true, `Downloading playlist${count ? ` (${count} tracks)` : ''}… this may take a while.`);
  const btn = document.getElementById('dlAllBtn');
  btn.disabled = true;
  btn.textContent = 'Working...';

  try {
    const res = await guardedFetch('/download-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: selectedFormat })
    });

    setProgress(false);
    btn.disabled = false;
    btn.textContent = 'Download All (ZIP)';

    if (!res) return;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
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

    setStatus('Playlist downloaded successfully!', 'success');
  } catch (err) {
    setProgress(false);
    btn.disabled = false;
    btn.textContent = 'Download All (ZIP)';
    setStatus('Network error: ' + err.message, 'error');
  }
});
