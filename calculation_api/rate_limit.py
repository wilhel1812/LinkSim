from collections import defaultdict, deque
from collections.abc import Callable
from threading import Lock
from time import monotonic


class InMemoryRateLimiter:
    def __init__(self, limit: int, window_sec: int, now_provider: Callable[[], float] | None = None) -> None:
        self._limit = max(1, limit)
        self._window_sec = max(1, window_sec)
        self._now_provider = now_provider or monotonic
        self._entries: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> tuple[bool, int]:
        now = self._now_provider()
        with self._lock:
            bucket = self._entries[key]
            threshold = now - self._window_sec
            while bucket and bucket[0] <= threshold:
                bucket.popleft()

            if len(bucket) >= self._limit:
                retry_after = max(1, int(bucket[0] + self._window_sec - now))
                return False, retry_after

            bucket.append(now)
            return True, 0
