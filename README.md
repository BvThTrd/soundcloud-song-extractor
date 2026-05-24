MySoundTube - Docker Setup
==========================

A self-hosted web app to download SoundCloud and YouTube tracks and playlists as
MP3/M4A/FLAC/WAV with embedded metadata, and YouTube videos as MP4.
Protected by a password login.


QUICK START (local / docker compose)
-------------------------------------

1. Copy this folder to your machine.

2. Create a .env file from the example:
     cp .env.example .env

3. Generate a bcrypt hash for your password:
     python -c "import bcrypt; print(bcrypt.hashpw(b'yourpassword', bcrypt.gensalt()).decode())"

4. Edit .env and set your values:
     APP_PASSWORD=$$2b$$12$$<your_hash>   (escape every $ as $$)
     PORT=5000

5. Build and start:
     docker compose up -d --build

6. Open http://localhost:5000 and log in with your APP_PASSWORD.


PORTAINER DEPLOYMENT
--------------------

1. Go to Stacks → Add stack.

2. Choose "Git repository" and point it to this repo.

3. Under "Environment variables" add:

     APP_PASSWORD   bcrypt hash of your password ($ signs do NOT need escaping here)   (required)
     PORT           5000  (or any free port on the host)                                 (optional)

4. Click Deploy. Portainer injects the values at deploy time.
   The .env file is gitignored and never committed.


ENVIRONMENT VARIABLES
---------------------

  APP_PASSWORD   Bcrypt hash of the password to access the app.              (required)
                 Generate: python -c "import bcrypt; print(bcrypt.hashpw(b'pw', bcrypt.gensalt()).decode())"
                 In .env / docker-compose: escape every $ in the hash as $$ to prevent
                 Docker Compose from treating them as variable references.
  SECRET_KEY     Signs session cookies. Auto-generated if omitted —          (optional)
                 sessions reset on container restart without a fixed value.
  PORT           Host port exposed by the container.                          (default: 5000)


FEATURES
--------

Single track
  - Paste any SoundCloud or YouTube track URL
  - Auto-detects the platform and shows a badge (SoundCloud / YouTube)
  - Preview: fetches title, artist, duration, and cover art
  - Download as MP3, M4A, FLAC, or WAV
  - YouTube only: download as MP4 video (best video + audio, merged)
    The MP4 format button appears automatically when a YouTube URL is detected

Playlist
  - Paste a SoundCloud /sets/ URL or a YouTube playlist URL
  - A banner shows the playlist name and track count
  - "Convert All (ZIP)" downloads every track/video in one archive
  - MP4 is available for YouTube playlists (one MP4 per video, zipped)

Download queue
  - Up to 5 downloads run concurrently
  - Additional jobs wait in a visual queue showing their position
  - Queue drains automatically as slots free up

Metadata embedded in every file
  - Title:  track/video title from the source platform
  - Artist: uploader name from the source platform
  - Album:  download date (YYYYMMDD)
  - Cover:  thumbnail embedded (audio formats and MP4)

Filename format:  "Artist - Track Title.ext"
Playlist files:   "01 - Artist - Track Title.ext"


HOW IT WORKS
------------
- Frontend: HTML/CSS/JS single-page app
- Backend:  Flask (Python)
- Auth:     session cookie, bcrypt-hashed password via APP_PASSWORD env var
- Download: yt-dlp (SoundCloud and YouTube support)
- Audio:    ffmpeg (conversion + metadata + thumbnail)
- Video:    ffmpeg (mux best video + audio streams into MP4)


PORTS
-----
Host port is controlled by the PORT env var (default 5000).
To change it without editing docker-compose.yml, set PORT=8080 in .env
or in Portainer's environment variables panel.


STOP
----
  docker compose down


TROUBLESHOOTING
---------------

- FLAC/WAV slow:          Normal, lossless conversion takes longer
- MP4 slow:               Normal, yt-dlp fetches separate video and audio streams then merges them
- Port conflict:          Set PORT=8080 (or any free port) in .env or Portainer
- $ sign in hash broken:  In .env, escape every $ in the bcrypt hash as $$
