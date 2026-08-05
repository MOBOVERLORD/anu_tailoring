"""Small read-only API smoke test for the vendor product shop."""

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def main() -> None:
    assert settings.ADMIN_EMAIL and settings.ADMIN_PASSWORD, "Admin credentials are required"
    with TestClient(app) as client:
        request_headers = {"X-Requested-With": "AnuTailoringUI"}
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
