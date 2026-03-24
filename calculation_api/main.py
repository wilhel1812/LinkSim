from fastapi import FastAPI, HTTPException

from calculation_api.calculators import calculate_link_budget
from calculation_api.engine import CalculationEngine
from calculation_api.models import CalculationRequest, CalculationResponse


app = FastAPI(title="LinkSim Calculation API", version="0.1.0")

engine = CalculationEngine()
engine.register("link_budget", calculate_link_budget)


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
