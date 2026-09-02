# Issues

Vendor-customer Feature 2 verification on 2 September 2026 found no new open
issues. The existing product-stock issue below remains queued and was not changed
as part of the isolated relationship backend work.

## Product stock rejects valid whole-piece quantities

Status: Open

In the web vendor product form, **Available stock (piece)** rejects a valid integer
such as `1`. The browser reports that the nearest valid values are `0.01` and `1.01`.
This indicates that the stock input's step base is offset by a decimal minimum (for
example, `min="0.01"` with `step="1"`).

Required correction:

- stock measured in pieces must accept whole non-negative integers (`0`, `1`, `2`,
  and so on) with aligned HTML `min`/`step` constraints;
- decimal validation should remain only on monetary fields such as price;
- frontend schema validation and backend validation must enforce the same integer
  stock rule and display a clear in-app message rather than the browser's mismatched
  nearest-value warning;
- verify create and edit product flows in desktop and mobile-width web layouts.
