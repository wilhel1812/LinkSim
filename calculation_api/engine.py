from collections.abc import Callable
from typing import Any


Calculator = Callable[[Any], Any]


class CalculationEngine:
    def __init__(self) -> None:
        self._registry: dict[str, Calculator] = {}

    def register(self, calculation_name: str, calculator: Calculator) -> None:
        self._registry[calculation_name] = calculator

    def calculate(self, calculation_name: str, payload: Any) -> Any:
        calculator = self._registry.get(calculation_name)
        if calculator is None:
            raise KeyError(f"Unsupported calculation type: {calculation_name}")
        return calculator(payload)
