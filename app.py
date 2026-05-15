from os import environ
from re import sub
from uuid import uuid4
from subprocess import run, TimeoutExpired
from json import loads
from secrets import token_hex
from shutil import rmtree, make_archive
from datetime import date
from functools import wraps
from pathlib import Path
from flask import Flask, request, jsonify, send_file, render_template, after_this_request, session, redirect, url_for
from bcrypt import checkpw

app = Flask(__name__)
app.secret_key = token_hex(32)
_raw_pw = environ.get("APP_PASSWORD", "")
PASSWORD_HASH = _raw_pw.encode() if _raw_pw.startswith("$2") else None

DOWNLOAD_DIR = Path("/tmp/soundcloud-dl")
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("authenticated"):
            if request.is_json:
                return jsonify({"error": "Not authenticated"}), 401
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated


def sanitize_filename(name: str) -> str:
    """Remove characters that are unsafe for filenames."""
    name = sub(r'[\\/*?:"<>|]', "", name)
    name = sub(r"\s+", " ", name).strip()
    return name[:180]  # cap length


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        pwd = (request.form.get("password") or "").strip()
        if PASSWORD_HASH and checkpw(pwd.encode(), PASSWORD_HASH):
            session["authenticated"] = True
            return redirect(url_for("index"))
        error = "Wrong password."
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    return render_template("index.html")


@app.route("/info", methods=["POST"])
@login_required
def get_info():
    """Fetch track metadata without downloading."""
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    try:
        result = run(
            ["yt-dlp", "--dump-json", "--no-playlist", url],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return jsonify({"error": "Could not fetch track info. Check the URL."}), 400

        info = loads(result.stdout)
        return jsonify({
            "title": info.get("title", "Unknown"),
            "uploader": info.get("uploader", info.get("artist", "Unknown")),
            "duration": info.get("duration", 0),
            "thumbnail": info.get("thumbnail", ""),
            "description": (info.get("description") or "")[:300],
        })
    except TimeoutExpired:
        return jsonify({"error": "Request timed out. Try again."}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/download", methods=["POST"])
@login_required
def download():
    """Download a SoundCloud track as MP3 with embedded metadata."""
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    fmt = (data.get("format") or "mp3").strip().lower()

    if fmt not in ("mp3", "m4a", "flac", "wav"):
        fmt = "mp3"

    if not url:
        return jsonify({"error": "No URL provided"}), 400

    session_id = uuid4().hex
    session_dir = DOWNLOAD_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    today = date.today().strftime("%Y%m%d")
    output_template = str(session_dir / "%(uploader,artist)s - %(title)s.%(ext)s")

    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--extract-audio",
        "--audio-format", fmt,
        "--audio-quality", "0",
        "--embed-thumbnail",
        "--embed-metadata",
        "--add-metadata",
        "--parse-metadata", "%(uploader)s:%(artist)s",
        "--parse-metadata", f"{today}:%(album)s",
        "--output", output_template,
        "--ffmpeg-location", "/usr/bin/ffmpeg",
        url,
    ]

    try:
        result = run(cmd, capture_output=True, text=True, timeout=120)

        if result.returncode != 0:
            # Fallback: try without thumbnail embedding (some tracks fail)
            cmd_fallback = [c for c in cmd if c != "--embed-thumbnail"]
            result = run(cmd_fallback, capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                return jsonify({"error": "Download failed. The track may be private or geo-restricted."}), 400

        # Find the downloaded file
        files = list(session_dir.glob(f"*.{fmt}"))
        if not files:
            # Try any audio file
            files = list(session_dir.glob("*.*"))

        if not files:
            return jsonify({"error": "Download produced no file."}), 500

        filepath = files[0]
        safe_name = sanitize_filename(filepath.stem) + filepath.suffix

        @after_this_request
        def cleanup(response):
            try:
                rmtree(session_dir, ignore_errors=True)
            except Exception:
                pass
            return response

        return send_file(
            filepath,
            as_attachment=True,
            download_name=safe_name,
            mimetype="audio/mpeg" if fmt == "mp3" else "application/octet-stream",
        )

    except TimeoutExpired:
        return jsonify({"error": "Download timed out. Track may be too long or connection is slow."}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/playlist-info", methods=["POST"])
@login_required
def playlist_info():
    """Fetch playlist metadata (title + track count) without downloading."""
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    try:
        result = run(
            ["yt-dlp", "--flat-playlist", "--dump-single-json", url],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            return jsonify({"error": "Could not fetch playlist info."}), 400

        info = loads(result.stdout)
        entries = info.get("entries") or []
        return jsonify({
            "title": info.get("title", "Playlist"),
            "track_count": len(entries),
            "uploader": info.get("uploader", info.get("channel", "")),
        })
    except TimeoutExpired:
        return jsonify({"error": "Request timed out."}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/download-playlist", methods=["POST"])
@login_required
def download_playlist():
    """Download all tracks in a SoundCloud playlist and return as a ZIP."""
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    fmt = (data.get("format") or "mp3").strip().lower()

    if fmt not in ("mp3", "m4a", "flac", "wav"):
        fmt = "mp3"

    if not url:
        return jsonify({"error": "No URL provided"}), 400

    session_id = uuid4().hex
    session_dir = DOWNLOAD_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    today = date.today().strftime("%Y%m%d")
    output_template = str(session_dir / "%(playlist_index)02d - %(uploader,artist)s - %(title)s.%(ext)s")

    cmd = [
        "yt-dlp",
        "--extract-audio",
        "--audio-format", fmt,
        "--audio-quality", "0",
        "--embed-thumbnail",
        "--embed-metadata",
        "--add-metadata",
        "--parse-metadata", "%(uploader)s:%(artist)s",
        "--parse-metadata", f"{today}:%(album)s",
        "--output", output_template,
        "--ffmpeg-location", "/usr/bin/ffmpeg",
        url,
    ]

    try:
        result = run(cmd, capture_output=True, text=True, timeout=600)

        if result.returncode != 0:
            cmd_fallback = [c for c in cmd if c != "--embed-thumbnail"]
            result = run(cmd_fallback, capture_output=True, text=True, timeout=600)
            if result.returncode != 0:
                return jsonify({"error": "Download failed. The playlist may be private or geo-restricted."}), 400

        files = list(session_dir.glob(f"*.{fmt}"))
        if not files:
            files = list(session_dir.glob("*.*"))

        if not files:
            return jsonify({"error": "Download produced no files."}), 500

        zip_base = str(DOWNLOAD_DIR / session_id)
        make_archive(zip_base, "zip", session_dir)
        zip_path = Path(zip_base + ".zip")

        @after_this_request
        def cleanup(response):
            try:
                rmtree(session_dir, ignore_errors=True)
                zip_path.unlink(missing_ok=True)
            except Exception:
                pass
            return response

        return send_file(
            zip_path,
            as_attachment=True,
            download_name="playlist.zip",
            mimetype="application/zip",
        )

    except TimeoutExpired:
        return jsonify({"error": "Download timed out. Playlist may be too large."}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
