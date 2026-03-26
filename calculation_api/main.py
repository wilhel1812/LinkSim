import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from calculation_api.calculators import calculate_link_budget
from calculation_api.engine import CalculationEngine
from calculation_api.models import CalculationRequest, CalculationResponse
from calculation_api.rate_limit import InMemoryRateLimiter


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI, limiter: InMemoryRateLimiter) -> None:
        super().__init__(app)
        self._limiter = limiter

    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)

        client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")
        client_key = client_ip.split(",", 1)[0].strip() or "unknown"
        allowed, retry_after = self._limiter.allow(client_key)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded"},
                headers={"Retry-After": str(retry_after)},
            )

        return await call_next(request)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def create_app(*, rate_limit_per_min: int | None = None, rate_limit_window_sec: int | None = None) -> FastAPI:
    app = FastAPI(title="LinkSim Calculation API", version="0.1.0")

    engine = CalculationEngine()
    engine.register("link_budget", calculate_link_budget)

    per_min = rate_limit_per_min if rate_limit_per_min is not None else _env_int("CALC_API_RATE_LIMIT_PER_MIN", 60)
    window_sec = rate_limit_window_sec if rate_limit_window_sec is not None else _env_int("CALC_API_RATE_LIMIT_WINDOW_SEC", 60)
    if per_min > 0:
        app.add_middleware(
            RateLimitMiddleware,
            limiter=InMemoryRateLimiter(limit=per_min, window_sec=max(1, window_sec)),
        )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/v1/calculate", response_model=CalculationResponse)
    def calculate(request: CalculationRequest) -> CalculationResponse:
        try:
            result = engine.calculate(request.calculation, request.input)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except KeyError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        return CalculationResponse(calculation=request.calculation, result=result)

    return app


app = create_app()
