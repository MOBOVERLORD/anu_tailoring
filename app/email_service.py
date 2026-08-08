import html
import logging
from datetime import datetime, timedelta, timezone
from email.utils import formataddr
from urllib.parse import quote

import httpx
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import EmailOutbox, Notification, User


logger = logging.getLogger(__name__)


def _absolute_app_link(path: str | None) -> str | None:
    if not path or not path.startswith("/") or path.startswith("//"):
        return None
    return f"{settings.PUBLIC_APP_URL.rstrip('/')}{path}"


def _message_html(title: str, message: str, link: str | None = None) -> str:
    safe_title = html.escape(title)
    safe_message = html.escape(message).replace("\n", "<br>")
    action = ""
    if link:
        safe_link = html.escape(link, quote=True)
        action = (
            '<p style="margin:24px 0"><a href="'
            f'{safe_link}" style="background:#df7b55;color:#171310;padding:12px 18px;'
            'border-radius:10px;text-decoration:none;font-weight:700">Open update</a></p>'
        )
    return f"""<!doctype html>
<html><body style="margin:0;background:#f5f1ec;color:#211a16;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px">
    <div style="background:#fff;border:1px solid #e3d8cf;border-radius:18px;padding:28px">
      <p style="margin:0 0 8px;color:#b95837;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">{html.escape(settings.APP_NAME)}</p>
      <h1 style="margin:0 0 14px;font-size:26px;line-height:1.25">{safe_title}</h1>
      <p style="margin:0;line-height:1.65;color:#5c5049">{safe_message}</p>
      {action}
      <p style="margin:26px 0 0;padding-top:18px;border-top:1px solid #eee4dd;color:#82746c;font-size:12px">This is an account or order update from {html.escape(settings.APP_NAME)}.</p>
    </div>
  </div>
</body></html>"""


def _provider_ready() -> bool:
    provider = settings.EMAIL_PROVIDER.strip().lower()
    if provider == "console":
        return settings.is_development
    return bool(
        provider == "resend"
        and settings.RESEND_API_KEY
        and settings.EMAIL_FROM_ADDRESS
    )


async def send_email(
    recipient: str,
    subject: str,
    text_body: str,
    html_body: str,
    *,
    idempotency_key: str | None = None,
) -> None:
    """Send one transactional message without exposing provider credentials."""
    provider = settings.EMAIL_PROVIDER.strip().lower()
    if provider == "console" and settings.is_development:
        logger.info(
            "Development email\nTo: %s\nSubject: %s\n%s",
            recipient,
            subject,
            text_body,
        )
        return
    if provider != "resend":
        raise RuntimeError("Transactional email is not configured")
    if not settings.RESEND_API_KEY or not settings.EMAIL_FROM_ADDRESS:
        raise RuntimeError("Resend credentials or sender address are missing")

    payload = {
        "from": formataddr(
            (
                settings.EMAIL_FROM_NAME or settings.APP_NAME,
                str(settings.EMAIL_FROM_ADDRESS),
            )
        ),
        "to": [recipient],
        "subject": subject,
        "text": text_body,
        "html": html_body,
    }
    headers = {
        "Authorization": f"Bearer {settings.RESEND_API_KEY}",
        "Content-Type": "application/json",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    async with httpx.AsyncClient(timeout=settings.EMAIL_HTTP_TIMEOUT_SECONDS) as client:
        response = await client.post(
            "https://api.resend.com/emails",
            headers=headers,
            json=payload,
        )
    if not 200 <= response.status_code < 300:
        raise RuntimeError(f"Email provider rejected the request ({response.status_code})")


async def send_email_safely(
    recipient: str,
    subject: str,
    text_body: str,
    html_body: str,
) -> None:
    try:
        await send_email(recipient, subject, text_body, html_body)
    except Exception:
        logger.exception("Transactional email delivery failed for %s", recipient)


async def send_password_reset_email(recipient: str, full_name: str, token: str) -> None:
    reset_link = _absolute_app_link(f"/reset-password?token={quote(token, safe='')}")
    if not reset_link:
        logger.error("PUBLIC_APP_URL is not configured for password reset email")
        return
    title = "Reset your password"
    message = (
        f"Hi {full_name}, use the link below within "
        f"{settings.PASSWORD_RESET_EXPIRE_MINUTES} minutes to choose a new password. "
        "If you did not request this, you can ignore this email."
    )
    text_body = f"{message}\n\nReset password: {reset_link}"
    await send_email_safely(
        recipient,
        f"Reset your {settings.APP_NAME} password",
        text_body,
        _message_html(title, message, reset_link),
    )


async def send_welcome_email(recipient: str, full_name: str) -> None:
    home_link = _absolute_app_link("/login")
    message = (
        f"Hi {full_name}, your customer account is ready. Sign in to save designs, "
        "manage measurements, and follow your orders."
    )
    await send_email_safely(
        recipient,
        f"Welcome to {settings.APP_NAME}",
        message,
        _message_html("Your account is ready", message, home_link),
    )


async def send_password_changed_email(recipient: str, full_name: str) -> None:
    message = (
        f"Hi {full_name}, the password for your account was changed. "
        "All existing sessions were closed. If this was not you, contact support immediately."
    )
    await send_email_safely(
        recipient,
        f"Your {settings.APP_NAME} password was changed",
        message,
        _message_html("Password changed", message),
    )


@event.listens_for(Session, "before_flush")
def enqueue_notification_email(session: Session, _flush_context, _instances) -> None:
    """Create email work atomically for every new in-app notification."""
    if not settings.EMAIL_NOTIFICATIONS_ENABLED:
        return
    for item in tuple(session.new):
        if not isinstance(item, Notification) or getattr(item, "_email_queued", False):
            continue
        item._email_queued = True
        link = _absolute_app_link(item.link)
        message = item.message
        text_body = message + (f"\n\nOpen update: {link}" if link else "")
        session.add(
            EmailOutbox(
                user_id=item.user_id,
                subject=f"{settings.APP_NAME}: {item.title}",
                text_body=text_body,
                html_body=_message_html(item.title, message, link),
            )
        )


async def deliver_pending_notification_emails(batch_size: int = 10) -> None:
    """Deliver a small outbox batch after a successful mutating API request."""
    if not settings.EMAIL_NOTIFICATIONS_ENABLED or not _provider_ready():
        return
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(EmailOutbox)
                .where(
                    EmailOutbox.status.in_(("pending", "retry")),
                    EmailOutbox.next_attempt_at <= now,
                )
                .order_by(EmailOutbox.created_at)
                .limit(batch_size)
                .with_for_update(skip_locked=True)
            )
        ).scalars().all()
        for row in rows:
            recipient = row.recipient_email
            if not recipient and row.user_id:
                user = await db.get(User, row.user_id)
                recipient = user.email if user and user.is_active else None
            if not recipient:
                row.status = "skipped"
                row.last_error = "Recipient is unavailable or inactive"
                continue
            try:
                await send_email(
                    recipient,
                    row.subject,
                    row.text_body,
                    row.html_body or _message_html(row.subject, row.text_body),
                    idempotency_key=f"vastrivo-outbox-{row.id}",
                )
                row.status = "sent"
                row.sent_at = datetime.now(timezone.utc)
                row.last_error = None
            except Exception as exc:
                row.attempts += 1
                row.status = "failed" if row.attempts >= 5 else "retry"
                row.next_attempt_at = datetime.now(timezone.utc) + timedelta(
                    minutes=min(60, 2 ** row.attempts)
                )
                row.last_error = str(exc)[:1000]
                logger.warning("Queued email delivery failed: %s", exc)
        if rows:
            await db.commit()
