"""Verify the Resend request contract without making a network call."""

import asyncio
import json

import httpx

from app import email_service
from app.config import settings


async def verify() -> None:
    original_client = email_service.httpx.AsyncClient
    original_values = {
        "EMAIL_PROVIDER": settings.EMAIL_PROVIDER,
        "RESEND_API_KEY": settings.RESEND_API_KEY,
        "EMAIL_FROM_ADDRESS": settings.EMAIL_FROM_ADDRESS,
        "EMAIL_FROM_NAME": settings.EMAIL_FROM_NAME,
    }
    captured: dict[str, object] = {}

    def handle(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["authorization"] = request.headers.get("Authorization")
        captured["idempotency_key"] = request.headers.get("Idempotency-Key")
        captured["payload"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "test-email-id"})

    class MockAsyncClient:
        def __init__(self, **kwargs) -> None:
            self.client = original_client(
                transport=httpx.MockTransport(handle),
                timeout=kwargs.get("timeout"),
            )

        async def __aenter__(self):
            return await self.client.__aenter__()

        async def __aexit__(self, exc_type, exc, traceback):
            return await self.client.__aexit__(exc_type, exc, traceback)

    try:
        settings.EMAIL_PROVIDER = "resend"
        settings.RESEND_API_KEY = "re_test_key"
        settings.EMAIL_FROM_ADDRESS = "no-reply@updates.example.com"
        settings.EMAIL_FROM_NAME = "Vastrivo"
        email_service.httpx.AsyncClient = MockAsyncClient

        await email_service.send_email(
            "customer@example.com",
            "Order update",
            "Your order changed.",
            "<p>Your order changed.</p>",
            idempotency_key="vastrivo-outbox-42",
        )

        assert captured["url"] == "https://api.resend.com/emails"
        assert captured["authorization"] == "Bearer re_test_key"
        assert captured["idempotency_key"] == "vastrivo-outbox-42"
        assert captured["payload"] == {
            "from": "Vastrivo <no-reply@updates.example.com>",
            "to": ["customer@example.com"],
            "subject": "Order update",
            "text": "Your order changed.",
            "html": "<p>Your order changed.</p>",
        }
    finally:
        email_service.httpx.AsyncClient = original_client
        for name, value in original_values.items():
            setattr(settings, name, value)

    print("Resend request contract passed")


if __name__ == "__main__":
    asyncio.run(verify())
