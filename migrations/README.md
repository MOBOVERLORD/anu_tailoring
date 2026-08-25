# Vastrivo database migrations

Run migrations from the repository root:

```text
python -m alembic upgrade head
```

The initial revision is deliberately idempotent so it can adopt the existing
pre-Alembic database without deleting application data. All schema changes
after that baseline must be added as a new revision; application startup never
creates or alters tables.
