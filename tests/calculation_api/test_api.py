from fastapi.testclient import TestClient

from calculation_api.main import app


client = TestClient(app)


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
