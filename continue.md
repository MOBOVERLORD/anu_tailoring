## Resume prompt

“Continue from `continue.md` one feature at a time. once it is completed move it to progress.md and remove from here
Only work on Future enhancements if asked else Continue the remaining
work `progress.md` and `issues.md` after verification. and add any milestones or anything needs to be done in future in continue.md

# Continuation plan: 

# Mobile:
  1. menu bar should be constant in any screen to make navigation easier
  2. Check the UI & UX for the mobile view
  3. create a document or plan for deploying in both andorid and ios stores and make plan for testing in ios 
# overall:
  1. check on loading symbols reequirements and places that would require loading
  2. Check on the Pop up message and thier format  in both mobile and web view

## Future enhancements

### Feature 1 — Standalone customer invoices and private PDFs

**Deferred at the user's request.** Keep the specification below for future work.
Do not implement standalone customer invoices, their native/web UI, PDF generation,
download, or sharing during the current continuation. Related invoice requirements
in the API proposal, implementation order, verification, and acceptance criteria
below are also deferred. Existing marketplace order invoices remain supported.

These invoices are independent of marketplace orders. A vendor can create multiple
invoices for a customer and see the complete invoice history under that customer.

Recommended tables:

- `vendor_customer_invoices` — vendor/customer relationship, invoice number,
  status (`draft`, `finalized`, `void`), issue/due dates, currency, seller/customer
  snapshots, subtotal, discount, tax, grand total, notes, payment note, PDF object
  metadata, and timestamps;
- `vendor_customer_invoice_lines` — description, quantity, unit, unit price, line
  total, sort order, and optional service/product classification.

Important rules:

- calculate all totals on the backend using decimal/NUMERIC values;
- assign invoice numbers transactionally and uniquely per vendor;
- draft invoices are editable; finalized invoice financial fields are immutable;
- voiding preserves history and audit data rather than deleting the invoice;
- the invoice list shows status, number, issue date, total, and download action;
- invoice detail can be opened from the customer record.

#### PDF download and sharing

- Generate the PDF on the backend using a Cloud Run-friendly library such as
  ReportLab; do not depend on client-side browser printing.
- Include Vastrivo/vendor branding, shop logo and contact details, customer details,
  invoice number/dates, line items, totals, optional GST/tax data, notes, and payment
  terms.
- Store finalized PDFs privately in GCS using a stable path similar to
  `vendors/{vendor_id}/customers/{relationship_id}/invoices/{invoice_id}/invoice.pdf`,
  or generate them deterministically on demand.
- Expose only an authenticated, ownership-checked PDF endpoint. Do not make the
  bucket or invoice URLs public.
- Web: Download PDF action. Native: download to app cache and open the operating
  system share sheet so the vendor can share it through WhatsApp, email, etc.


