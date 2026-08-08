from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def main() -> None:
    with TestClient(app) as client:
        ui_headers = {"X-Requested-With": "VastrivoUI"}
        login = client.post(
            "/api/auth/login",
            json={"email": str(settings.ADMIN_EMAIL), "password": settings.ADMIN_PASSWORD},
            headers=ui_headers,
        )
        assert login.status_code == 200, login.text
        auth_headers = {
            **ui_headers,
            "Authorization": f"Bearer {login.json()['access_token']}",
        }
        page = client.get("/api/admin/orders?limit=1&offset=0", headers=auth_headers)
        assert page.status_code == 200, page.text
        orders = page.json()["items"]
        if orders and orders[0]["order_items"]:
            item_id = orders[0]["order_items"][0]["id"]
            ticket = client.post(
                f"/api/orders/items/{item_id}/chat-ticket",
                headers=auth_headers,
            )
            assert ticket.status_code == 200, ticket.text
            with client.websocket_connect(
                f"/api/orders/items/{item_id}/chat"
                f"?ticket={ticket.json()['ticket']}&after_id=0"
            ) as socket:
                assert socket.receive_json()["type"] == "ready"
            print("Chat ticket and WebSocket handshake passed")
        else:
            print("No existing order item; chat ticket route compile-checked")
        assert client.post("/api/auth/logout", headers=auth_headers).status_code == 204


if __name__ == "__main__":
    main()
