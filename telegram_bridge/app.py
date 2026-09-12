import asyncio
import os
import re
import tempfile
import time
import uuid
from pathlib import Path
from flask import Flask, jsonify, request, send_file
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import SessionPasswordNeededError

app = Flask(__name__)
BRIDGE_SECRET = os.environ.get("BRIDGE_SECRET", "")
TMP_DIR = Path(os.environ.get("BRIDGE_TMP_DIR", "/tmp/telegram-bridge"))
TMP_DIR.mkdir(parents=True, exist_ok=True)
FILES = {}


def authorized():
    return bool(BRIDGE_SECRET) and request.headers.get("x-bridge-secret") == BRIDGE_SECRET


@app.before_request
def auth_guard():
    if request.path == "/health":
        return None
    if not authorized():
        return jsonify({"error": "unauthorized"}), 401


@app.get("/health")
def health():
    return jsonify({"ok": True})


def run(coro):
    return asyncio.run(coro)


async def make_client(api_id, api_hash, session=""):
    client = TelegramClient(StringSession(session or ""), int(api_id), str(api_hash))
    await client.connect()
    return client


@app.post("/send-code")
def send_code():
    body = request.get_json(force=True) or {}
    api_id = int(body.get("api_id") or 0)
    api_hash = str(body.get("api_hash") or "").strip()
    phone = str(body.get("phone") or "").strip()
    if not api_id or not api_hash or not phone:
        return jsonify({"error": "missing_credentials"}), 400

    async def _do():
        client = await make_client(api_id, api_hash)
        try:
            sent = await client.send_code_request(phone)
            return {
                "temp_session": client.session.save(),
                "phone_code_hash": sent.phone_code_hash,
                "via_app": getattr(sent, "is_code_via_app", None),
            }
        finally:
            await client.disconnect()

    try:
        return jsonify(run(_do()))
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.post("/verify-code")
def verify_code():
    body = request.get_json(force=True) or {}
    api_id = int(body.get("api_id") or 0)
    api_hash = str(body.get("api_hash") or "")
    phone = str(body.get("phone") or "")
    code = str(body.get("code") or "").strip()
    phone_code_hash = str(body.get("phone_code_hash") or "")
    session = str(body.get("temp_session") or "")

    async def _do():
        client = await make_client(api_id, api_hash, session)
        try:
            try:
                await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
            except SessionPasswordNeededError:
                return {"needs_password": True, "temp_session": client.session.save()}
            me = await client.get_me()
            name = " ".join(x for x in [getattr(me, "first_name", None), getattr(me, "last_name", None)] if x) or getattr(me, "username", None) or phone
            return {"connected": True, "session": client.session.save(), "account_name": name}
        finally:
            await client.disconnect()

    try:
        return jsonify(run(_do()))
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.post("/verify-password")
def verify_password():
    body = request.get_json(force=True) or {}
    api_id = int(body.get("api_id") or 0)
    api_hash = str(body.get("api_hash") or "")
    password = str(body.get("password") or "")
    phone = str(body.get("phone") or "")
    session = str(body.get("temp_session") or "")

    async def _do():
        client = await make_client(api_id, api_hash, session)
        try:
            await client.sign_in(password=password)
            me = await client.get_me()
            name = " ".join(x for x in [getattr(me, "first_name", None), getattr(me, "last_name", None)] if x) or getattr(me, "username", None) or phone
            return {"connected": True, "session": client.session.save(), "account_name": name}
        finally:
            await client.disconnect()

    try:
        return jsonify(run(_do()))
    except Exception as e:
        return jsonify({"error": str(e)}), 400


def media_type(msg):
    if getattr(msg, "photo", None):
        return "image"
    doc = getattr(msg, "document", None)
    mime = getattr(doc, "mime_type", "") if doc else ""
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("image/"):
        return "image"
    return None


def extension_for(msg, kind):
    doc = getattr(msg, "document", None)
    mime = getattr(doc, "mime_type", "") if doc else ""
    if "mp4" in mime:
        return ".mp4"
    if "webm" in mime:
        return ".webm"
    if "png" in mime:
        return ".png"
    if "webp" in mime:
        return ".webp"
    return ".mp4" if kind == "video" else ".jpg"


async def find_entity(client, internal_id):
    async for dialog in client.iter_dialogs(limit=1000):
        entity = dialog.entity
        if str(getattr(entity, "id", "")) == str(internal_id):
            return entity
    return None


async def message_set(client, entity, msg_id):
    msg = await client.get_messages(entity, ids=msg_id)
    if not msg:
        return []
    gid = getattr(msg, "grouped_id", None)
    if not gid:
        return [msg]
    ids = [i for i in range(max(1, msg_id - 10), msg_id + 11)]
    nearby = await client.get_messages(entity, ids=ids)
    return [m for m in nearby if m and getattr(m, "grouped_id", None) == gid]


def cleanup_files():
    cutoff = time.time() - 1800
    for token, meta in list(FILES.items()):
        if meta[1] < cutoff:
            try:
                Path(meta[0]).unlink(missing_ok=True)
            except Exception:
                pass
            FILES.pop(token, None)


@app.post("/scrape")
def scrape():
    cleanup_files()
    body = request.get_json(force=True) or {}
    link = str(body.get("url") or "")
    m = re.match(r"^https?://(?:www\.)?t\.me/c/(\d+)/(\d+)", link, re.I)
    if not m:
        return jsonify({"error": "not_private_link"}), 400
    internal_id, post_raw = m.groups()
    post_id = int(post_raw)
    api_id = int(body.get("api_id") or 0)
    api_hash = str(body.get("api_hash") or "")
    session = str(body.get("session") or "")
    if not api_id or not api_hash or not session:
        return jsonify({"error": "not_connected"}), 409

    async def _do():
        client = await make_client(api_id, api_hash, session)
        try:
            if not await client.is_user_authorized():
                return {"error": "not_connected"}
            entity = await find_entity(client, internal_id)
            if not entity:
                return {"error": "channel_not_found"}
            messages = await message_set(client, entity, post_id)
            original = next((x for x in messages if getattr(x, "id", None) == post_id), messages[0] if messages else None)
            description = getattr(original, "message", None) if original else None
            media_messages = [x for x in messages if media_type(x)]
            media_from = None
            if not media_messages:
                for offset in range(1, 13):
                    candidate = post_id - offset
                    if candidate <= 0:
                        break
                    prev = await message_set(client, entity, candidate)
                    found = [x for x in prev if media_type(x)]
                    if found:
                        media_messages = found
                        media_from = candidate
                        break
            media = []
            for msg in media_messages[:20]:
                kind = media_type(msg)
                if not kind:
                    continue
                ext = extension_for(msg, kind)
                token = uuid.uuid4().hex + ext
                path = TMP_DIR / token
                await client.download_media(msg, file=str(path))
                if path.exists():
                    FILES[token] = (str(path), time.time())
                    media.append({"type": kind, "token": token})
            title = getattr(entity, "title", None) or f"Telegram private • {internal_id}"
            return {
                "title": title,
                "description": description,
                "channel_name": title,
                "media": media,
                "media_from_post_id": str(media_from) if media_from else None,
            }
        finally:
            await client.disconnect()

    try:
        result = run(_do())
        status = 409 if result.get("error") else 200
        return jsonify(result), status
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/media/<token>")
def media(token):
    cleanup_files()
    meta = FILES.get(token)
    if not meta:
        return jsonify({"error": "not_found"}), 404
    return send_file(meta[0], as_attachment=False)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
