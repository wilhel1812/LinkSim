import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from calculation_api.calculators.link_budget import calculate_link_budget
from calculation_api.main import create_app
from calculation_api.limits import BoundedCalculationBodyMiddleware
from calculation_api.models import LinkBudgetInput


client = TestClient(create_app())


def _node(name: str, lat: float, lon: float) -> dict:
    return {
        "name": name,
        "lat": lat,
        "lon": lon,
        "antenna_height_m": 10,
        "tx_power_dbm": 27,
        "tx_gain_dbi": 2,
        "rx_gain_dbi": 2,
        "cable_loss_db": 1,
    }


def test_health_endpoint_reports_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_link_budget_returns_pass_and_dbm_by_default() -> None:
    response = client.post(
        "/api/v1/calculate",
        json={
            "calculation": "link_budget",
            "input": {
                "from_node": "Site A",
                "to_node": "Site B",
                "frequency_mhz": 868,
                "rx_target_dbm": -110,
                "nodes": [
                    _node("Site A", 59.9139, 10.7522),
                    _node("Site B", 59.9170, 10.7600),
                ],
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["calculation"] == "link_budget"
    assert body["result"]["from_site"] == "Site A"
    assert body["result"]["to_site"] == "Site B"
    assert body["result"]["verdict"] == "PASS"
    assert isinstance(body["result"]["rx_dbm"], float)


def test_link_budget_can_return_only_dbm() -> None:
    response = client.post(
        "/api/v1/calculate",
        json={
            "calculation": "link_budget",
            "input": {
                "from_node": "Site A",
                "to_node": "Site B",
                "frequency_mhz": 868,
                "rx_target_dbm": -95,
                "include_verdict": False,
                "nodes": [
                    _node("Site A", 59.9139, 10.7522),
                    _node("Site B", 60.3913, 5.3221),
                ],
            },
        },
    )

    assert response.status_code == 200
    result = response.json()["result"]
    assert result["verdict"] is None
    assert isinstance(result["rx_dbm"], float)


def test_link_budget_can_return_only_verdict() -> None:
    response = client.post(
        "/api/v1/calculate",
        json={
            "calculation": "link_budget",
            "input": {
                "from_node": "Site A",
                "to_node": "Site B",
                "frequency_mhz": 868,
                "rx_target_dbm": -95,
                "include_rx_dbm": False,
                "nodes": [
                    _node("Site A", 59.9139, 10.7522),
                    _node("Site B", 60.3913, 5.3221),
                ],
            },
        },
    )

    assert response.status_code == 200
    result = response.json()["result"]
    assert result["verdict"] == "FAIL"
    assert result["rx_dbm"] is None


def test_link_budget_returns_404_for_missing_node_name() -> None:
    response = client.post(
        "/api/v1/calculate",
        json={
            "calculation": "link_budget",
            "input": {
                "from_node": "Site A",
                "to_node": "Site C",
                "frequency_mhz": 868,
                "nodes": [
                    _node("Site A", 59.9139, 10.7522),
                    _node("Site B", 59.9170, 10.7600),
                ],
            },
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Site not found: Site C"


def test_rate_limit_returns_429_after_limit_is_exceeded() -> None:
    rate_limited_client = TestClient(create_app(rate_limit_per_min=2, rate_limit_window_sec=60))
    payload = {
        "calculation": "link_budget",
        "input": {
            "from_site": "Site A",
            "to_site": "Site B",
            "frequency_mhz": 868,
            "nodes": [
                _node("Site A", 59.9139, 10.7522),
                _node("Site B", 59.9170, 10.7600),
            ],
        },
    }

    first = rate_limited_client.post("/api/v1/calculate", json=payload)
    second = rate_limited_client.post("/api/v1/calculate", json=payload)
    third = rate_limited_client.post("/api/v1/calculate", json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    assert third.json()["detail"] == "Rate limit exceeded"
    assert int(third.headers["Retry-After"]) > 0


def test_rate_limit_does_not_trust_spoofed_forwarded_addresses() -> None:
    rate_limited_client = TestClient(create_app(rate_limit_per_min=2, rate_limit_window_sec=60))
    payload = {
        "calculation": "link_budget",
        "input": {
            "from_site": "Site A",
            "to_site": "Site B",
            "frequency_mhz": 868,
            "nodes": [
                _node("Site A", 59.9139, 10.7522),
                _node("Site B", 59.9170, 10.7600),
            ],
        },
    }

    first = rate_limited_client.post(
        "/api/v1/calculate", json=payload, headers={"X-Forwarded-For": "198.51.100.1"}
    )
    second = rate_limited_client.post(
        "/api/v1/calculate", json=payload, headers={"X-Forwarded-For": "198.51.100.2"}
    )
    third = rate_limited_client.post(
        "/api/v1/calculate", json=payload, headers={"X-Forwarded-For": "198.51.100.3"}
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429


def test_request_body_and_depth_limits() -> None:
    oversized = client.post("/api/v1/calculate", content=b"{" + b" " * 65536 + b"}", headers={"content-type": "application/json"})
    assert oversized.status_code == 413
    too_deep = client.post("/api/v1/calculate", content=("[" * 11 + "0" + "]" * 11), headers={"content-type": "application/json"})
    assert too_deep.status_code == 422


def test_chunked_body_exact_size_and_depth_boundaries() -> None:
    async def status_for(body: bytes, chunk_size: int) -> tuple[int, int]:
        sent = []
        chunks = [body[index:index + chunk_size] for index in range(0, len(body), chunk_size)] or [b""]
        receive_calls = 0

        async def receive():
            nonlocal receive_calls
            receive_calls += 1
            chunk = chunks.pop(0)
            return {"type": "http.request", "body": chunk, "more_body": bool(chunks)}

        async def send(message):
            sent.append(message)

        async def inner(scope, receive_inner, send_inner):
            await receive_inner()
            await send_inner({"type": "http.response.start", "status": 204, "headers": []})
            await send_inner({"type": "http.response.body", "body": b""})

        middleware = BoundedCalculationBodyMiddleware(inner)
        await middleware({"type": "http", "method": "POST", "path": "/api/v1/calculate", "headers": []}, receive, send)
        status = next(message["status"] for message in sent if message["type"] == "http.response.start")
        return status, receive_calls

    base = b'{"value":""}'
    exact = base[:-2] + b"x" * (65536 - len(base)) + b'"}'
    assert asyncio.run(status_for(exact, 997))[0] == 204
    assert asyncio.run(status_for(exact + b" ", 997))[0] == 413
    oversized_status, oversized_reads = asyncio.run(status_for(exact + b" " * 5000, 997))
    assert oversized_status == 413
    assert oversized_reads < (len(exact) + 5000 + 996) // 997
    assert asyncio.run(status_for((b"[" * 10) + b"0" + (b"]" * 10), 3))[0] == 204
    assert asyncio.run(status_for((b"[" * 11) + b"0" + (b"]" * 11), 3))[0] == 422


def test_node_count_name_and_finite_number_limits() -> None:
    base = {
        "calculation": "link_budget",
        "input": {"from_site": "A", "to_site": "B", "frequency_mhz": 868,
                  "nodes": [_node("A", 1, 1), _node("B", 2, 2)]},
    }
    base["input"]["nodes"] += [_node(f"extra-{index}", 1, 1) for index in range(18)]
    assert client.post("/api/v1/calculate", json=base).status_code == 200
    base["input"]["nodes"].append(_node("node-21", 1, 1))
    assert client.post("/api/v1/calculate", json=base).status_code == 422
    base["input"]["from_site"] = "A" * 80
    base["input"]["nodes"] = [_node("A" * 80, 1, 1), _node("B", 2, 2)]
    assert client.post("/api/v1/calculate", json=base).status_code == 200
    base["input"]["from_site"] = "A"
    base["input"]["nodes"] = [_node("A" * 81, 1, 1), _node("B", 2, 2)]
    long_error = client.post("/api/v1/calculate", json=base)
    assert long_error.status_code == 422
    assert isinstance(long_error.json()["detail"], list)

    base["input"]["from_site"] = "😀" * 80
    base["input"]["nodes"] = [_node("😀" * 80, 1, 1), _node("B", 2, 2)]
    assert client.post("/api/v1/calculate", json=base).status_code == 200
    base["input"]["from_site"] += "😀"
    base["input"]["nodes"][0]["name"] += "😀"
    assert client.post("/api/v1/calculate", json=base).status_code == 422
    base["input"]["nodes"] = [_node("A", 1, 1), _node("B", 2, 2)]
    base["input"]["frequency_mhz"] = "NaN"
    non_finite_json = json.dumps(base).replace('"NaN"', "NaN")
    assert client.post("/api/v1/calculate", content=non_finite_json, headers={"content-type": "application/json"}).status_code == 422


def test_strings_trim_and_numeric_fields_do_not_coerce_strings_or_bools() -> None:
    payload = {
        "calculation": "link_budget",
        "input": {"from_site": " A ", "to_site": " B ", "frequency_mhz": 868,
                  "nodes": [_node(" A ", 1, 1), _node(" B ", 2, 2)]},
    }
    accepted = client.post("/api/v1/calculate", json=payload)
    assert accepted.status_code == 200
    assert accepted.json()["result"]["from_site"] == "A"
    payload["input"]["from_site"] = "   "
    assert client.post("/api/v1/calculate", json=payload).status_code == 422
    payload["input"]["from_site"] = "A"
    payload["input"]["frequency_mhz"] = "868"
    assert client.post("/api/v1/calculate", json=payload).status_code == 422
    payload["input"]["frequency_mhz"] = 868
    payload["input"]["nodes"][0]["lat"] = True
    assert client.post("/api/v1/calculate", json=payload).status_code == 422


def test_all_fastapi_numeric_inputs_are_strict() -> None:
    for input_field in ["frequency_mhz", "rx_target_dbm"]:
        for invalid in ["1", True]:
            payload = {"calculation": "link_budget", "input": {"from_site": "A", "to_site": "B", "frequency_mhz": 868,
                       "nodes": [_node("A", 1, 1), _node("B", 2, 2)]}}
            payload["input"][input_field] = invalid
            assert client.post("/api/v1/calculate", json=payload).status_code == 422
    for node_field in ["lat", "lon", "antenna_height_m", "tx_power_dbm", "tx_gain_dbi", "rx_gain_dbi", "cable_loss_db"]:
        for invalid in ["1", True]:
            payload = {"calculation": "link_budget", "input": {"from_site": "A", "to_site": "B", "frequency_mhz": 868,
                       "nodes": [_node("A", 1, 1), _node("B", 2, 2)]}}
            payload["input"]["nodes"][0][node_field] = invalid
            assert client.post("/api/v1/calculate", json=payload).status_code == 422


def test_sync_distance_limit_is_500_km() -> None:
    exact_longitude = 500 / 6371 * 180 / 3.141592653589793
    exact = client.post("/api/v1/calculate", json={
        "calculation": "link_budget",
        "input": {"from_site": "A", "to_site": "B", "frequency_mhz": 868,
                  "nodes": [_node("A", 0, 0), _node("B", 0, exact_longitude)]},
    })
    assert exact.status_code == 200
    response = client.post("/api/v1/calculate", json={
        "calculation": "link_budget",
        "input": {"from_site": "A", "to_site": "B", "frequency_mhz": 868,
                  "nodes": [_node("A", 0, 0), _node("B", 0, 5)]},
    })
    assert response.status_code == 400
    assert "maximum sync distance of 500 km" in response.json()["detail"]

    with pytest.raises(ValueError, match="maximum sync distance of 500 km"):
        calculate_link_budget(LinkBudgetInput.model_validate({
            "from_site": "A", "to_site": "B", "frequency_mhz": 868,
            "nodes": [_node("A", 0, 0), _node("B", 0, 5)],
        }))
