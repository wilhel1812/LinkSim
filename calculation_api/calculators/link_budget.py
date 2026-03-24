from math import asin, cos, log10, radians, sin, sqrt

from calculation_api.models import LinkBudgetInput, LinkBudgetResult, Node


def _haversine_km(a: Node, b: Node) -> float:
    lat1 = radians(a.lat)
    lon1 = radians(a.lon)
    lat2 = radians(b.lat)
    lon2 = radians(b.lon)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    hav = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 6371 * (2 * asin(sqrt(hav)))


def _fspl_db(distance_km: float, frequency_mhz: float) -> float:
    return 32.44 + (20 * log10(max(0.001, distance_km))) + (20 * log10(frequency_mhz))


def _lookup_node(nodes: list[Node], name: str) -> Node | None:
    normalized = name.strip().lower()
    return next((node for node in nodes if node.name.strip().lower() == normalized), None)


def calculate_link_budget(payload: LinkBudgetInput) -> LinkBudgetResult:
    from_node = _lookup_node(payload.nodes, payload.from_site)
    if from_node is None:
        raise LookupError(f"Site not found: {payload.from_site}")

    to_node = _lookup_node(payload.nodes, payload.to_site)
    if to_node is None:
        raise LookupError(f"Site not found: {payload.to_site}")

    distance_km = _haversine_km(from_node, to_node)
    path_loss_db = _fspl_db(distance_km, payload.frequency_mhz)
    eirp_dbm = from_node.tx_power_dbm + from_node.tx_gain_dbi - from_node.cable_loss_db
    rx_dbm = eirp_dbm + to_node.rx_gain_dbi - path_loss_db

    verdict = "PASS" if rx_dbm >= payload.rx_target_dbm else "FAIL"

    return LinkBudgetResult(
        from_site=from_node.name,
        to_site=to_node.name,
        distance_km=distance_km,
        path_loss_db=path_loss_db,
        rx_dbm=rx_dbm if payload.include_rx_dbm else None,
        verdict=verdict if payload.include_verdict else None,
    )
