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
        return await asyncio.get_event_loop().run_in_executor(None, _do)
    except Exception as e:
        return 0, str(e)


async def send_sms_free_mobile(user: str, api_key: str, message: str) -> bool:
    """Send SMS via Free Mobile API (France only, free for subscribers)."""
    import urllib.parse
    url = f"https://smsapi.free-mobile.fr/sendmsg?user={user}&pass={api_key}&msg={urllib.parse.quote(message)}"
    # Free Mobile API uses GET
    import urllib.request
    try:
        def _do():
            try:
                with urllib.request.urlopen(url, timeout=10) as resp:
                    return resp.status
            except Exception as e:
                print(f"[THEIA-SMS] Free Mobile error: {e}")
                return 0
        status = await asyncio.get_event_loop().run_in_executor(None, _do)
        ok = status == 200
        if ok:
            print(f"[THEIA-SMS] Free Mobile SMS sent")
        else:
            print(f"[THEIA-SMS] Free Mobile SMS failed (status={status})")
        return ok
    except Exception as e:
        print(f"[THEIA-SMS] Free Mobile error: {e}")
        return False


async def send_sms_twilio(account_sid: str, auth_token: str, from_number: str, to_number: str, message: str) -> bool:
    """Send SMS via Twilio API."""
    import base64
    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    auth = base64.b64encode(f"{account_sid}:{auth_token}".encode()).decode()
    data = f"To={to_number}&From={from_number}&Body={message}"
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


async def send_ntfy(topic: str, title: str, message: str, server: str = "https://ntfy.sh") -> bool:
    """Send notification via ntfy.sh (or self-hosted ntfy)."""
    url = f"{server}/{topic}"
    status, body = await _http_post(url, data=message, headers={"Title": title})
    ok = 200 <= status < 300
    if ok:
        print(f"[THEIA-SMS] ntfy notification sent to {topic}")
    else:
        print(f"[THEIA-SMS] ntfy error (status={status}): {body[:200]}")
    return ok


async def send_sms(message: str, config: dict) -> bool:
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
            title="THEIA Detection",
            message=message,
            server=config.get("ntfy_server", "https://ntfy.sh"),
        )
    else:
        print(f"[THEIA-SMS] Unknown provider: {provider}")
        return False
