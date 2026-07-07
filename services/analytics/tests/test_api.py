"""API-level tests: auth, validation, problem+json shape, endpoint wiring.

Uses an in-memory AnalyticsRepository fake - no live database.
"""

from datetime import date
from uuid import UUID

import httpx
import pytest

from analytics import __version__
from analytics.core.types import MonthlyValue, PressureReading, TreadReading, TyreRecordRow
from analytics.main import create_app
from tests.conftest import SERVICE_KEY, TEST_ORG, make_tread_series, make_tyre_row


class FakeRepository:
    """In-memory AnalyticsRepository. Records the org id of every call so
    tests can assert org scoping reaches the data layer."""

    def __init__(self) -> None:
        self.readings: list[TreadReading] = []
        self.monthly_costs: list[MonthlyValue] = []
        self.monthly_units: list[MonthlyValue] = []
        self.tyre_rows: list[TyreRecordRow] = []
        self.pressures: list[PressureReading] = []
        self.active_count = 0
        self.avg_cost: float | None = None
        self.seen_org_ids: list[UUID] = []
        self.healthy = True

    async def ping(self) -> bool:
        return self.healthy

    async def fetch_tread_history(self, organisation_id, **_) -> list[TreadReading]:
        self.seen_org_ids.append(organisation_id)
        return self.readings

    async def fetch_monthly_costs(self, organisation_id, **_) -> list[MonthlyValue]:
        self.seen_org_ids.append(organisation_id)
        return self.monthly_costs

    async def fetch_monthly_replacement_units(self, organisation_id, **_) -> list[MonthlyValue]:
        self.seen_org_ids.append(organisation_id)
        return self.monthly_units

    async def fetch_tyre_rows(self, organisation_id, **_) -> list[TyreRecordRow]:
        self.seen_org_ids.append(organisation_id)
        return self.tyre_rows

    async def fetch_pressure_readings(self, organisation_id, **_) -> list[PressureReading]:
        self.seen_org_ids.append(organisation_id)
        return self.pressures

    async def fetch_active_tyre_count(self, organisation_id, **_) -> int:
        self.seen_org_ids.append(organisation_id)
        return self.active_count

    async def fetch_avg_tyre_cost(self, organisation_id, **_) -> float | None:
        self.seen_org_ids.append(organisation_id)
        return self.avg_cost


@pytest.fixture
def repo() -> FakeRepository:
    return FakeRepository()


@pytest.fixture
def client(repo: FakeRepository) -> httpx.AsyncClient:
    app = create_app()
    app.state.repository = repo
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://testserver")


AUTH = {"x-service-key": SERVICE_KEY}


class TestHealth:
    async def test_health_ok(self, client: httpx.AsyncClient) -> None:
        async with client:
            res = await client.get("/health")
        assert res.status_code == 200
        body = res.json()
        assert body == {"status": "ok", "version": __version__, "database": "ok"}
        assert res.headers["x-request-id"]
        assert float(res.headers["x-response-time-ms"]) >= 0

    async def test_health_degraded_when_db_down(
        self, client: httpx.AsyncClient, repo: FakeRepository
    ) -> None:
        repo.healthy = False
        async with client:
            res = await client.get("/health")
        assert res.status_code == 200
        assert res.json()["status"] == "degraded"


class TestAuth:
    async def test_missing_key_rejected(self, client: httpx.AsyncClient) -> None:
        async with client:
            res = await client.post(
                "/v1/forecast/cost", json={"organisation_id": str(TEST_ORG)}
            )
        assert res.status_code == 401
        assert res.headers["content-type"].startswith("application/problem+json")
        body = res.json()
        assert body["title"] == "Unauthorized"
        assert body["status"] == 401

    async def test_wrong_key_rejected(self, client: httpx.AsyncClient) -> None:
        async with client:
            res = await client.post(
                "/v1/forecast/cost",
                json={"organisation_id": str(TEST_ORG)},
                headers={"x-service-key": "wrong-key-wrong-key"},
            )
        assert res.status_code == 401


class TestValidation:
    async def test_missing_org_id_is_422_problem(self, client: httpx.AsyncClient) -> None:
        async with client:
            res = await client.post("/v1/predict/tyre-life", json={}, headers=AUTH)
        assert res.status_code == 422
        body = res.json()
        assert body["title"] == "Validation Error"
        assert any("organisation_id" in e["loc"] for e in body["errors"])

    async def test_out_of_bounds_horizon_rejected(self, client: httpx.AsyncClient) -> None:
        async with client:
            res = await client.post(
                "/v1/forecast/cost",
                json={"organisation_id": str(TEST_ORG), "months_ahead": 99},
                headers=AUTH,
            )
        assert res.status_code == 422

    async def test_unknown_fields_rejected(self, client: httpx.AsyncClient) -> None:
        async with client:
            res = await client.post(
                "/v1/forecast/cost",
                json={"organisation_id": str(TEST_ORG), "sql": "drop table"},
                headers=AUTH,
            )
        assert res.status_code == 422


class TestEndpoints:
    async def test_predict_tyre_life(
        self, client: httpx.AsyncClient, repo: FakeRepository
    ) -> None:
        repo.readings = make_tread_series("SER-1")
        async with client:
            res = await client.post(
                "/v1/predict/tyre-life",
                json={"organisation_id": str(TEST_ORG), "avg_daily_km": 250},
                headers=AUTH,
            )
        assert res.status_code == 200
        body = res.json()
        assert body["organisation_id"] == str(TEST_ORG)
        assert body["fleet"]["tyre_count"] == 1
        assert body["fleet"]["modelled_count"] == 1
        pred = body["predictions"][0]
        assert pred["method"] == "regression"
        assert pred["remaining_km"] == pytest.approx(pred["remaining_days"] * 250)
        assert repo.seen_org_ids == [TEST_ORG]

    async def test_forecast_cost(
        self,
        client: httpx.AsyncClient,
        repo: FakeRepository,
        trending_monthly_costs: list[MonthlyValue],
    ) -> None:
        repo.monthly_costs = trending_monthly_costs
        async with client:
            res = await client.post(
                "/v1/forecast/cost",
                json={"organisation_id": str(TEST_ORG), "months_ahead": 3},
                headers=AUTH,
            )
        assert res.status_code == 200
        body = res.json()
        assert body["method"] == "holt_linear"
        assert len(body["forecast"]) == 3
        assert body["forecast"][0]["lower"] <= body["forecast"][0]["expected"]

    async def test_detect_anomalies(
        self, client: httpx.AsyncClient, repo: FakeRepository
    ) -> None:
        repo.tyre_rows = [
            make_tyre_row("d1", serial_no="SN-1", issue=date(2026, 3, 1)),
            make_tyre_row("d2", serial_no="SN-1", issue=date(2026, 3, 1)),
        ]
        async with client:
            res = await client.post(
                "/v1/detect/anomalies",
                json={"organisation_id": str(TEST_ORG)},
                headers=AUTH,
            )
        assert res.status_code == 200
        body = res.json()
        assert body["summary"]["total"] == 1
        assert body["anomalies"][0]["type"] == "DUPLICATE_ENTRY"
        assert body["anomalies"][0]["severity"] == "high"

    async def test_forecast_demand(
        self, client: httpx.AsyncClient, repo: FakeRepository
    ) -> None:
        repo.monthly_units = [MonthlyValue(f"2025-{m:02d}", 6.0) for m in range(1, 13)]
        repo.active_count = 40
        repo.avg_cost = 1350.0
        async with client:
            res = await client.post(
                "/v1/forecast/demand",
                json={"organisation_id": str(TEST_ORG), "months_ahead": 4},
                headers=AUTH,
            )
        assert res.status_code == 200
        body = res.json()
        assert body["method"] == "baseline_run_rate"
        assert len(body["forecast"]) == 4
        assert body["forecast"][0]["projected_units"] == 6
        assert body["forecast"][0]["estimated_cost"] == pytest.approx(6 * 1350.0)

    async def test_db_unavailable_returns_503_problem(self, repo: FakeRepository) -> None:
        app = create_app()
        app.state.repository = None
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            res = await c.post(
                "/v1/forecast/cost",
                json={"organisation_id": str(TEST_ORG)},
                headers=AUTH,
            )
        assert res.status_code == 503
        assert res.headers["content-type"].startswith("application/problem+json")
