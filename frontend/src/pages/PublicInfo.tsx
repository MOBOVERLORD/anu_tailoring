import { useEffect, useState } from "react"
import { CircleDollarSign, Clock3, Mail, MapPin, PackageCheck, RefreshCcw, ShieldCheck, Truck } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { api } from "@/lib/api"

interface PublicConfig {
  support_email: string
  business_legal_name: string
  business_address: string | null
  support_phone: string | null
}

const updatedOn = "17 August 2026"

const PublicInfo = () => {
  const { pathname } = useLocation()
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({ support_email: "support@vastrivo.in", business_legal_name: "Vastrivo", business_address: null, support_phone: null })

  useEffect(() => {
    void api<PublicConfig>("/api/public/config")
      .then(setPublicConfig)
      .catch(() => undefined)
  }, [])

  const supportEmail = publicConfig.support_email
  const contactLink = <a href={`mailto:${supportEmail}`}>{supportEmail}</a>

  const pages: Record<string, { eyebrow: string; title: string; summary: string; content: React.ReactNode }> = {
    "/contact": {
      eyebrow: "Customer care",
      title: "Contact Vastrivo",
      summary: "Get help with your account, tailoring order, product purchase, payment, refund, or delivery.",
      content: <>
        <div className="policy-highlight"><Mail size={22} /><div><strong>Email support</strong><p>{contactLink}</p><small>Include your registered email and order number. Never send passwords, OTPs, card numbers, or UPI PINs.</small></div></div>
        <section><h2>Business contact</h2><p><strong>{publicConfig.business_legal_name}</strong>{publicConfig.business_address ? <><br />{publicConfig.business_address}</> : null}{publicConfig.support_phone ? <><br /><a href={`tel:${publicConfig.support_phone}`}>{publicConfig.support_phone}</a></> : null}<br />{contactLink}</p></section>
        <section><h2>How we can help</h2><div className="policy-card-grid"><article><PackageCheck size={20} /><h3>Orders and vendors</h3><p>Questions about an invoice, tailoring stage, cloth requirement, product, cancellation, or vendor conversation.</p></article><article><CircleDollarSign size={20} /><h3>Payments and refunds</h3><p>Share the Vastrivo order number and Razorpay payment ID shown on your receipt, if available.</p></article><article><Truck size={20} /><h3>Delivery support</h3><p>Share the tracking number and delivery status. Delivery agents should be contacted only through approved Vastrivo channels.</p></article></div></section>
        <section><h2>Response and escalation</h2><p>We aim to acknowledge support emails within two business days. Payment, safety, and account-access concerns are prioritised. If your issue relates to a vendor, we may contact that vendor to investigate and resolve it.</p></section>
      </>,
    },
    "/pricing": {
      eyebrow: "Clear order totals",
      title: "Pricing details",
      summary: "Your payable amount is shown before you approve an invoice or place an order.",
      content: <>
        <div className="policy-highlight"><CircleDollarSign size={22} /><div><strong>Prices are displayed in Indian rupees (₹)</strong><p>Vastrivo does not ask you to enter or alter the payable amount inside Razorpay Checkout.</p></div></div>
        <section><h2>What may be included</h2><div className="policy-card-grid"><article><h3>Tailoring service</h3><p>The vendor’s service price for each selected design or custom garment.</p></article><article><h3>Products and cloth</h3><p>Ready-made products, fabrics, agreed additions, and vendor-supplied cloth may be itemised separately.</p></article><article><h3>Delivery</h3><p>The chosen fulfilment method may add a platform-calculated or vendor delivery charge. Self-pickup and eligible self-delivery options do not add a platform delivery fee.</p></article></div></section>
        <section><h2>Invoice and payment stages</h2><p>A vendor-supplied cloth advance may be payable after the vendor attaches supporting purchase proof. The remaining approved order balance becomes payable when tailoring is completed. Any cloth advance already paid is deducted from the final balance.</p></section>
        <section><h2>Taxes and payment-provider charges</h2><p>Applicable taxes, if any, must be shown in the invoice or checkout total. Vastrivo does not add an undisclosed fee after checkout. Your bank or payment provider may apply charges under its own terms.</p></section>
      </>,
    },
    "/shipping": {
      eyebrow: "Pickup to doorstep",
      title: "Shipping and delivery policy",
      summary: "Delivery begins after the order is completed, fully paid where required, and marked ready by the vendor.",
      content: <>
        <div className="policy-highlight"><Truck size={22} /><div><strong>One fulfilment method per vendor order</strong><p>Items ordered together from one vendor use one delivery selection and one applicable delivery charge.</p></div></div>
        <section><h2>Fulfilment options</h2><ul><li><strong>Platform delivery:</strong> a delivery agent may be assigned after the vendor marks the package ready.</li><li><strong>Vendor delivery:</strong> the vendor fulfils delivery under the agreed order terms.</li><li><strong>Customer self-pickup:</strong> the customer collects the packed order from the vendor’s verified pickup point.</li><li><strong>Customer self-delivery:</strong> used where the customer and vendor agree that platform delivery is unnecessary.</li></ul></section>
        <section><h2>Tracking and timing</h2><p>A tracking number is generated when an eligible delivery is booked. Status moves from booked to picked up, in transit, and delivered. Estimates depend on tailoring completion, vendor readiness, distance, traffic, weather, service availability, and the selected fulfilment method; they are estimates rather than guaranteed delivery dates.</p></section>
        <section><h2>Address and receipt</h2><p>Customers must provide an accurate delivery pin and recipient details. Inspect the package at handoff where practical and report missing, damaged, or incorrect items promptly to {contactLink} with the order number and supporting photos.</p></section>
      </>,
    },
    "/cancellation-refunds": {
      eyebrow: "Order changes and money back",
      title: "Cancellation and refund policy",
      summary: "Cancellation availability depends on whether a vendor invoice has been accepted and whether work or fulfilment has begun.",
      content: <>
        <div className="policy-highlight"><RefreshCcw size={22} /><div><strong>Refunds return to the original payment source</strong><p>Approved Razorpay refunds are initiated against the original captured payment and tracked by payment ID.</p></div></div>
        <section><h2>Before invoice acceptance</h2><p>A customer may cancel an eligible order from the order screen before accepting a vendor invoice. A vendor may reject an order before invoice acceptance and must provide a reason.</p></section>
        <section><h2>After invoice acceptance</h2><p>Acceptance confirms the customer’s approval of the vendor’s itemised work and costs. Automatic cancellation is then disabled because cloth purchasing, stock reservation, cutting, or tailoring may have begun. Contact {contactLink} if fulfilment becomes impossible, an amount was charged incorrectly, or the delivered order materially differs from the approved invoice.</p></section>
        <section><h2>Refund eligibility</h2><p>Refunds may be full or partial depending on unfulfilled work, returned products, consumed or custom-cut materials, delivery already performed, and applicable law. Custom-made or altered garments are generally not returnable solely for change of mind, but verified defects, non-delivery, duplicate charges, and incorrect items will be reviewed.</p></section>
        <section><h2>Processing time</h2><p>After Vastrivo approves and submits a refund, Razorpay and the customer’s bank control the final processing time. The refund status and reference are recorded by Vastrivo. Customers should retain the payment and refund IDs until the credit appears.</p></section>
      </>,
    },
    "/privacy": {
      eyebrow: "Your information",
      title: "Privacy policy",
      summary: "This policy explains the information Vastrivo processes to provide tailoring, commerce, payments, and delivery services.",
      content: <>
        <div className="policy-highlight"><ShieldCheck size={22} /><div><strong>Measurements and addresses are private account data</strong><p>They are shared only with authorised participants and service providers when needed to fulfil your order.</p></div></div>
        <section><h2>Information we collect</h2><p>Account identity and contact details; profile and shop images; garment measurements; saved recipients and precise delivery coordinates; designs, products, invoices, order messages, payment references, delivery tracking, device/session security data, and support communications.</p></section>
        <section><h2>How it is used</h2><p>We use information to authenticate accounts, connect customers with vendors, create and fulfil orders, calculate delivery, process and reconcile payments, prevent misuse, send transactional messages, comply with legal obligations, and resolve support requests.</p></section>
        <section><h2>Service providers and disclosure</h2><p>Data may be processed by infrastructure, storage, mapping, email, payment, and delivery providers strictly for operating Vastrivo. Razorpay processes checkout and payment data under its own privacy terms. Vastrivo does not receive or store the customer’s card number, CVV, UPI PIN, or banking password.</p></section>
        <section><h2>Retention and choices</h2><p>We retain records for account operation, order history, fraud prevention, accounting, dispute resolution, and legal compliance. You may update most profile information in settings and request access, correction, or deletion assistance through {contactLink}. Some transaction records must be retained where law requires.</p></section>
        <section><h2>Security and updates</h2><p>We use access controls, short-lived sessions, private object storage, encrypted transport, server-side provider credentials, and audit records. No online service can guarantee absolute security. Material policy changes will be posted here with an updated date.</p></section>
      </>,
    },
    "/terms": {
      eyebrow: "Using Vastrivo",
      title: "Terms and conditions",
      summary: "These terms govern customer, vendor, administrator, and delivery-agent use of Vastrivo.",
      content: <>
        <section><h2>Marketplace role</h2><p>Vastrivo provides software for discovering designs and products, saving measurements, communicating with vendors, approving invoices, processing payments, and coordinating delivery. Vendors remain responsible for their listings, quotations, workmanship, legal compliance, and agreed fulfilment.</p></section>
        <section><h2>Accounts and acceptable use</h2><p>Provide accurate details, keep credentials private, and use only accounts and roles assigned to you. Do not upload unlawful, misleading, infringing, unsafe, or unrelated content; manipulate prices or payment records; misuse another person’s measurements or address; or interfere with platform security.</p></section>
        <section><h2>Orders and approval</h2><p>Listings and initial prices may not be a final custom-work quote. The binding order amount is the itemised invoice the customer reviews and accepts. Tailoring begins only after the applicable cloth and payment conditions are satisfied. Changes must be documented in the order conversation and may require a revised invoice.</p></section>
        <section><h2>Payments</h2><p>Online payments are processed through Razorpay. Vastrivo validates the provider order, captured amount, currency, and payment identity before marking an invoice paid. Customers must not make payment to an unverified personal account presented outside the approved checkout flow.</p></section>
        <section><h2>Content and suspension</h2><p>Users retain rights in content they upload and grant Vastrivo permission to store and display it as required to operate the service. Submitted marketplace listings may be reviewed, rejected, or removed. Accounts may be restricted for fraud, abuse, legal risk, repeated non-fulfilment, or violation of these terms.</p></section>
        <section><h2>Issues and contact</h2><p>Report order, payment, safety, or intellectual-property concerns to {contactLink}. These terms operate together with the Privacy, Shipping, and Cancellation and Refund policies and applicable Indian law.</p></section>
      </>,
    },
  }

  const page = pages[pathname] || pages["/terms"]

  return <div className="public-policy-page">
    <header className="policy-hero"><div><p className="eyebrow">{page.eyebrow}</p><h1>{page.title}</h1><p>{page.summary}</p><small>Last updated: {updatedOn}</small></div></header>
    <div className="policy-layout"><aside><strong>{publicConfig.business_legal_name}</strong><nav aria-label="Policy pages"><Link to="/contact">Contact</Link><Link to="/pricing">Pricing</Link><Link to="/shipping">Shipping</Link><Link to="/cancellation-refunds">Cancellation & refunds</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav><div><MapPin size={16} /><span>{publicConfig.business_address || "Online tailoring and clothing marketplace serving India"}</span></div><div><Clock3 size={16} /><span>Support: {supportEmail}</span></div></aside><article className="policy-content">{page.content}</article></div>
  </div>
}

export default PublicInfo
