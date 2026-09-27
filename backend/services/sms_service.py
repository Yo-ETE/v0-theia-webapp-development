"""
THEIA - SMS Notification Service
Supports multiple providers:
  - free_mobile: Free Mobile SMS API (gratuit pour abonnes Free France)
  - twilio: Twilio SMS API (payant)
  - ntfy: ntfy.sh push notifications (gratuit, auto-hebergeable)
"""
import json
import asyncio
from typing import Any


async def _http_post(url: str, data: Any = None, headers: dict | None = None, json_data: Any = None) -> tuple[int, str]:
    """Simple async HTTP POST using asyncio."""
    import urllib.request
    import urllib.error

    req_data = None
    req_headers = headers or {}
    if json_data is not None:
        req_data = json.dumps(json_data).encode()
        req_headers["Content-Type"] = "application/json"
    elif data is not None:
        if isinstance(data, str):
            req_data = data.encode()
        elif isinstance(data, bytes):
            req_data = data

    req = urllib.request.Request(url, data=req_data, headers=req_headers, method="POST")
    try:
        def _do():
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    return resp.status, resp.read().decode()
            except urllib.error.HTTPError as e:
                return e.code, e.read().decode() if e.fp else str(e)
            except Exception as e:
                return 0, str(e)
        return await asyncio.get_running_loop().run_in_executor(None, _do)
    except Exception as e:
        return 0, str(e)


async def send_sms_free_mobile(user: str, api_key: str, message: str) -> bool:
    """Send SMS via Free Mobile API (France only, free for subscribers)."""
    import urllib.parse
    query = urllib.parse.urlencode({"user": user, "pass": api_key, "msg": message})
    url = f"https://smsapi.free-mobile.fr/sendmsg?{query}"
    # Free Mobile API uses GET
    import urllib.request
    try:
        def _do():
            try:
                with urllib.request.urlopen(url, timeout=10) as resp:
                    return resp.status
            except Exception as e:
                # Never print the exception text: urllib errors can embed the URL (with the API key)
                print(f"[THEIA-SMS] Free Mobile error: {type(e).__name__}")
                return 0
        status = await asyncio.get_running_loop().run_in_executor(None, _do)
        ok = status == 200
        if ok:
            print(f"[THEIA-SMS] Free Mobile SMS sent")
        else:
            print(f"[THEIA-SMS] Free Mobile SMS failed (status={status})")
        return ok
    except Exception as e:
        print(f"[THEIA-SMS] Free Mobile error: {type(e).__name__}")
        return False


async def send_sms_twilio(account_sid: str, auth_token: str, from_number: str, to_number: str, message: str) -> bool:
    """Send SMS via Twilio API."""
    import base64
    import urllib.parse
    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    auth = base64.b64encode(f"{account_sid}:{auth_token}".encode()).decode()
    # urlencode: a raw "+" (E.164) would become a space, "&" / "=" in the body would inject fields
    data = urllib.parse.urlencode({"To": to_number, "From": from_number, "Body": message})
    status, body = await _http_post(url, data=data, headers={
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/x-www-form-urlencoded",
    })
    ok = 200 <= status < 300
    if ok:
        print(f"[THEIA-SMS] Twilio SMS sent to {to_number}")
    else:
        print(f"[THEIA-SMS] Twilio error (status={status}): {body[:200]}")
    return ok


def _header_value(value: str) -> str:
    """
    HTTP headers are ASCII. Mission names are not -- "Forcene" is fine, "Operation" with an
    accent is not, and urllib encodes headers as latin-1, so anything outside it raises
    before the request is even sent. RFC 2047 is what ntfy documents for this.
    """
    if all(ord(c) < 128 for c in value):
        return value
    import base64
    return "=?UTF-8?B?" + base64.b64encode(value.encode("utf-8")).decode("ascii") + "?="


async def send_ntfy(
    topic: str,
    title: str,
    message: str,
    server: str = "https://ntfy.sh",
    priority: str = "high",
    tags: str = "rotating_light",
) -> bool:
    """
    Send notification via ntfy.sh (or self-hosted ntfy).

    Priority defaults to high: these are detections during an incident, and at the default
    priority iOS is free to batch them quietly, which is the opposite of the point. It is
    still below `urgent`, which bypasses Do Not Disturb -- that is the operator's call to
    make on their phone, not ours to force.
    """
    import urllib.parse
    if urllib.parse.urlparse(server).scheme not in ("http", "https"):
        print("[THEIA-SMS] ntfy server must be http(s)")
        return False
    url = f"{server.rstrip('/')}/{urllib.parse.quote(topic, safe='')}"
    status, body = await _http_post(url, data=message, headers={
        "Title": _header_value(title),
        "Priority": priority,
        "Tags": tags,
    })
    ok = 200 <= status < 300
    if ok:
        print(f"[THEIA-SMS] ntfy notification sent to {topic}")
    else:
        print(f"[THEIA-SMS] ntfy error (status={status}): {body[:200]}")
    return ok


async def send_sms(message: str, config: dict, title: str = "THEIA", priority: str | None = None) -> bool:
    """
    Send SMS/notification using configured provider.
    config should contain:
      provider: "free_mobile" | "twilio" | "ntfy"
      + provider-specific fields
    """
    provider = config.get("provider", "")

    if provider == "free_mobile":
        return await send_sms_free_mobile(
            user=config.get("free_user", ""),
            api_key=config.get("free_api_key", ""),
            message=message,
        )
    elif provider == "twilio":
        recipients = config.get("sms_recipients", [])
        ok = True
        for to in recipients:
            result = await send_sms_twilio(
                account_sid=config.get("twilio_sid", ""),
                auth_token=config.get("twilio_token", ""),
                from_number=config.get("twilio_from", ""),
                to_number=to,
                message=message,
            )
            ok = ok and result
        return ok
    elif provider == "ntfy":
        return await send_ntfy(
            topic=config.get("ntfy_topic", "theia"),
            # The mission name, not a constant: on a lock screen "THEIA Detection" is the
            # same line whichever operation it came from.
            title=title,
            message=message,
            server=config.get("ntfy_server", "https://ntfy.sh"),
            priority=priority or str(config.get("ntfy_priority", "high")),
        )
    else:
        print(f"[THEIA-SMS] Unknown provider: {provider}")
        return False
