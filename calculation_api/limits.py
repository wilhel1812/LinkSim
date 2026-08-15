import json

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_CALCULATION_BODY_BYTES = 64 * 1024
MAX_CALCULATION_JSON_DEPTH = 10
MAX_NODES = 20
MAX_NAME_LENGTH = 80
MAX_SYNC_DISTANCE_KM = 500


def json_depth(raw: bytes) -> int:
    depth = maximum = 0
    in_string = escaped = False
    for byte in raw:
        char = chr(byte)
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in "[{":
            depth += 1
            maximum = max(maximum, depth)
        elif char in "]}":
            depth -= 1
    return maximum


def _reject_non_finite(value: str):
    raise ValueError(value)


class BoundedCalculationBodyMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != "/api/v1/calculate":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        declared = headers.get(b"content-length")
        if declared:
            try:
                if int(declared) > MAX_CALCULATION_BODY_BYTES:
                    await JSONResponse(status_code=413, content={"detail": f"Request body exceeds {MAX_CALCULATION_BODY_BYTES} bytes."})(scope, receive, send)
                    return
            except ValueError:
                pass

        chunks: list[bytes] = []
        total = 0
        more = True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            total += len(chunk)
            more = bool(message.get("more_body", False))
            if total > MAX_CALCULATION_BODY_BYTES:
                await JSONResponse(status_code=413, content={"detail": f"Request body exceeds {MAX_CALCULATION_BODY_BYTES} bytes."})(scope, receive, send)
                return
            chunks.append(chunk)

        body = b"".join(chunks)
        if json_depth(body) > MAX_CALCULATION_JSON_DEPTH:
            await JSONResponse(status_code=422, content={"detail": f"JSON nesting may not exceed {MAX_CALCULATION_JSON_DEPTH} levels."})(scope, receive, send)
            return
        try:
            json.loads(body, parse_constant=_reject_non_finite)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            await JSONResponse(status_code=422, content={"detail": "Request body must be valid finite-number JSON."})(scope, receive, send)
            return

        delivered = False

        async def replay_receive() -> Message:
            nonlocal delivered
            if delivered:
                return {"type": "http.disconnect"}
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay_receive, send)
