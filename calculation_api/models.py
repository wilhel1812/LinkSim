from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from calculation_api.limits import MAX_NAME_LENGTH, MAX_NODES


class FiniteModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, strict=True, str_strip_whitespace=True)


class Node(FiniteModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    antenna_height_m: float = Field(default=2, gt=0)
    tx_power_dbm: float = 14
    tx_gain_dbi: float = 2
    rx_gain_dbi: float = 2
    cable_loss_db: float = Field(default=1, ge=0)


class LinkBudgetInput(FiniteModel):
    from_site: str = Field(min_length=1, max_length=MAX_NAME_LENGTH, validation_alias=AliasChoices("from_site", "from_node"))
    to_site: str = Field(min_length=1, max_length=MAX_NAME_LENGTH, validation_alias=AliasChoices("to_site", "to_node"))
    frequency_mhz: float = Field(gt=0)
    rx_target_dbm: float = -100
    include_verdict: bool = True
    include_rx_dbm: bool = True
    nodes: list[Node] = Field(min_length=2, max_length=MAX_NODES)


class CalculationRequest(FiniteModel):
    calculation: Literal["link_budget"]
    input: LinkBudgetInput


class LinkBudgetResult(BaseModel):
    from_site: str
    to_site: str
    distance_km: float
    path_loss_db: float
    rx_dbm: float | None = None
    verdict: Literal["PASS", "FAIL"] | None = None


class CalculationResponse(BaseModel):
    calculation: Literal["link_budget"]
    result: LinkBudgetResult
