"""Bounded ASGI edge. The peer address is not taken from spoofable forwarded headers.
Deploy an ingress limiter for per-user limits behind a reverse proxy. No query-string
credentials, cookies, visitor analytics, or raw secret-bearing request logs.
"""

import asyncio
import json
import math
import secrets
import time
from collections import OrderedDict

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
    "worker-src 'self' blob:; object-src 'none'; base-uri 'self'"
)


class SecurityMiddleware:
    def __init__(self, app, config):
        self.app = app
        self.config = config
        self.clients = OrderedDict()
        self.inflight = 0

    async def reject(self, send, status, detail, retry=None):
        headers = [(b"content-type", b"application/json"), (b"cache-control", b"no-store")]
        if retry:
            headers.append((b"retry-after", str(retry).encode()))
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": json.dumps({"detail": detail}).encode()})

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def secured_send(message):
            if message["type"] == "http.response.start":
                h = list(message.get("headers", []))
                h.extend(
                    [
                        (b"x-content-type-options", b"nosniff"),
                        (b"referrer-policy", b"strict-origin-when-cross-origin"),
                        (b"permissions-policy", b"camera=(), microphone=(), geolocation=(self)"),
                        (b"x-request-id", secrets.token_hex(8).encode()),
                        (b"content-security-policy", CSP.encode()),
                    ]
                )
                # The framed live preview requires frame-ancestors to be an ingress decision.
                message = {**message, "headers": h}
            await send(message)

        path = scope.get("path", "")
        headers = dict(scope.get("headers", []))
        if path.startswith("/api/") and path not in ("/api/v1/health", "/api/v1/ready"):
            if self.config.auth_required:
                token = headers.get(b"x-atlas-key", b"")
                if len(token) > 256 or not secrets.compare_digest(token, self.config.api_key.encode()):
                    return await self.reject(
                        secured_send, 401, "Deployment access key required in X-Atlas-Key"
                    )
            peer = (scope.get("client") or ("unknown", 0))[0]
            now = time.monotonic()
            capacity = self.config.rate_limit_per_minute
            tokens, prev = self.clients.get(peer, (float(capacity), now))
            tokens = min(capacity, tokens + (now - prev) * capacity / 60)
            cost = 5 if path.endswith(("/location", "/aoi")) else 1
            if tokens < cost:
                return await self.reject(
                    secured_send,
                    429,
                    "Request budget exceeded; cached state remains available",
                    max(1, math.ceil((cost - tokens) * 60 / capacity)),
                )
            self.clients[peer] = (tokens - cost, now)
            self.clients.move_to_end(peer)
            while len(self.clients) > 2048:
                self.clients.popitem(last=False)
        if self.inflight >= 96:
            return await self.reject(secured_send, 503, "Server concurrency budget exceeded", 2)
        # Reserve BEFORE reading a possibly slow/chunked body. Every early return releases it.
        self.inflight += 1
        try:
            if scope.get("method") in ("POST", "PUT", "PATCH"):
                raw = headers.get(b"content-length", b"")
                if raw and (not raw.isdigit() or len(raw) > 8 or int(raw) > 65536):
                    return await self.reject(secured_send, 413, "Request body limit is 64 KiB")
                body = bytearray()
                try:
                    async with asyncio.timeout(10):
                        while True:
                            msg = await receive()
                            if msg["type"] == "http.disconnect":
                                return
                            body.extend(msg.get("body", b""))
                            if len(body) > 65536:
                                return await self.reject(secured_send, 413, "Request body limit is 64 KiB")
                            if not msg.get("more_body"):
                                break
                except TimeoutError:
                    return await self.reject(secured_send, 408, "Request body deadline exceeded")
                original = receive
                sent = False

                async def buffered_receive():
                    nonlocal sent
                    if not sent:
                        sent = True
                        return {"type": "http.request", "body": bytes(body), "more_body": False}
                    return await original()

                receive = buffered_receive
            await self.app(scope, receive, secured_send)
        finally:
            self.inflight -= 1
