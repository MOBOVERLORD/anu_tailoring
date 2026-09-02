"""Small read-only API smoke test for the vendor product shop."""

from decimal import Decimal

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import settings
from app.main import app
from app.schemas import ProductCreate, ProductUpdate


def verify_stock_contract() -> None:
    base = {
        "title": "Stock validation product",
        "description": "Validates product inventory quantities.",
        "product_type": "ready_made",
        "category": "women",
        "garment_type": "kurta",
        "price": "999.50",
        "unit": "piece",
        "sizes": ["M"],
        "colors": [],
    }
    assert ProductCreate(**base, stock_quantity=0).stock_quantity == 0
    assert ProductUpdate(**base, stock_quantity=1).stock_quantity == 1
    for schema in (ProductCreate, ProductUpdate):
        try:
            schema(**base, stock_quantity="1.5")
        except ValidationError as exc:
            assert "must be a whole number" in str(exc)
        else:
            raise AssertionError(
                f"Fractional piece stock was accepted by {schema.__name__}"
            )

    fabric = {
        **base,
        "product_type": "fabric",
        "unit": "metre",
        "sizes": [],
        "stock_quantity": "1.5",
    }
    assert ProductCreate(**fabric).stock_quantity == Decimal("1.5")


def main() -> None:
    verify_stock_contract()
    assert settings.ADMIN_EMAIL and settings.ADMIN_PASSWORD, "Admin credentials are required"
    with TestClient(app) as client:
        request_headers = {"X-Requested-With": "VastrivoUI"}
        login = client.post(
            "/api/auth/login",
            json={"email": str(settings.ADMIN_EMAIL), "password": settings.ADMIN_PASSWORD},
            headers=request_headers,
        )
        assert login.status_code == 200, login.text
        auth_headers = {
            **request_headers,
            "Authorization": f"Bearer {login.json()['access_token']}",
        }
        products = client.get("/api/admin/products?status=submitted", headers=auth_headers)
        assert products.status_code == 200, products.text
        assert isinstance(products.json(), list)
        orders = client.get("/api/admin/product-orders?limit=1&offset=0", headers=auth_headers)
        assert orders.status_code == 200, orders.text
        assert {"items", "total", "limit", "offset"} <= set(orders.json())
        logout = client.post("/api/auth/logout", headers=auth_headers)
        assert logout.status_code == 204, logout.text
    print("Product shop schema and administrator APIs passed")


if __name__ == "__main__":
    main()
