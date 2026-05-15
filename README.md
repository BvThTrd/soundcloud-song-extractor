SC DOWNLOADER - Docker Setup
============================

A self-hosted web app to download SoundCloud tracks and playlists as
MP3/M4A/FLAC/WAV with embedded metadata. Protected by a password login.


QUICK START (local / docker compose)
-------------------------------------

1. Copy this folder to your machine.

2. Create a .env file from the example:
     cp .env.example .env

3. Edit .env and set your values:
     APP_PASSWORD=yourpassword
     PORT=5000

4. Build and start:
     docker compose up -d --build

5. Open http://localhost:5000 and log in with your APP_PASSWORD.


PORTAINER DEPLOYMENT
--------------------

1. Go to Stacks → Add stack.

2. Choose "Git repository" and point it to this repo.

3. Under "Environment variables" add:

     APP_PASSWORD   your password                                (required)
     PORT           5000  (or any free port on the host)        (optional)

4. Click Deploy. Portainer injects the values at deploy time.
   The .env file is gitignored and never committed.


ENVIRONMENT VARIABLES
---------------------

  APP_PASSWORD   Password required to access the app.                        (required)
  SECRET_KEY     Signs session cookies. Auto-generated if omitted —          (optional)
                 sessions reset on container restart without a fixed value.
  PORT           Host port exposed by the container.                          (default: 5000)


FEATURES
--------

Single track
  - Paste any SoundCloud track URL
  - Preview: fetches title, artist, duration, and cover art
  - Download as MP3, M4A, FLAC, or WAV

Playlist
  - Paste a SoundCloud /sets/ URL
  - A banner shows the playlist name and track count
  - "Download All (ZIP)" downloads every track in one archive

Metadata embedded in every file
  - Title:  track title from SoundCloud
  - Artist: uploader name from SoundCloud
  - Album:  download date (YYYYMMDD)
  - Cover:  thumbnail embedded

Filename format:  "Artist - Track Title.ext"
Playlist files:   "01 - Artist - Track Title.ext"


HOW IT WORKS
------------
- Frontend: HTML/CSS/JS single-page app
- Backend:  Flask (Python)
- Auth:     session cookie, password set via APP_PASSWORD env var
- Download: yt-dlp (SoundCloud support)
- Audio:    ffmpeg (conversion + metadata + thumbnail)


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
- Can't log in:          Check APP_PASSWORD matches what you set in .env / Portainer
- Track won't download:  May be private, geo-restricted, or requires a SoundCloud login
- Playlist download slow: Normal — each track is converted individually
- FLAC/WAV slow:         Normal, lossless conversion takes longer
- Port conflict:         Set PORT=8080 (or any free port) in .env or Portainer
