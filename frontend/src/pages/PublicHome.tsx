import { ArrowRight, Check, PackageCheck, Ruler, ShieldCheck, Shirt, ShoppingBag, Sparkles, Store, UsersRound } from "lucide-react"
import { Link } from "react-router-dom"

const PublicHome = () => (
  <div className="public-home">
    <section className="public-hero">
      <div className="public-hero-copy">
        <p className="eyebrow"><Sparkles size={15} /> Clothing made around you</p>
        <h1>Tailoring, clothing, and the right fit in one place.</h1>
        <p className="public-hero-lead">Discover made-to-measure designs, work directly with verified tailoring vendors, or shop ready-to-buy garments for women and men.</p>
        <div className="public-hero-actions"><Link className="button" to="/register">Create your account <ArrowRight size={17} /></Link><Link className="button button-secondary" to="/login">Sign in</Link></div>
        <div className="public-trust-row"><span><Check size={14} /> Saved measurements</span><span><Check size={14} /> Verified listings</span><span><Check size={14} /> One order conversation</span></div>
      </div>
      <div className="public-hero-visual" aria-label="Vastrivo tailoring services">
        <div className="public-fit-card"><span><Ruler size={22} /></span><small>Your fit profile</small><strong>Measurements saved for every garment</strong></div>
        <div className="public-garment-mark"><Shirt size={92} strokeWidth={1.25} /><span /><span /><span /></div>
        <div className="public-vendor-card"><span><Store size={22} /></span><small>Tailoring partner</small><strong>Discuss, approve, and follow your order</strong></div>
      </div>
    </section>

    <section className="public-intro" aria-labelledby="public-intro-title">
      <p className="eyebrow">Made for real wardrobes</p>
      <h2 id="public-intro-title">Choose how you want to shop</h2>
      <p>Start with a design, select a trusted tailor, or buy clothing directly from an approved vendor.</p>
      <div className="public-service-grid">
        <article><span><Ruler size={24} /></span><h3>Made-to-measure designs</h3><p>Keep multiple measurement profiles and use the right fit for each tailored garment.</p></article>
        <article><span><UsersRound size={24} /></span><h3>Custom tailoring</h3><p>Find a tailoring vendor, share your requirements, discuss the job, and approve one clear invoice.</p></article>
        <article><span><ShoppingBag size={24} /></span><h3>Clothing marketplace</h3><p>Shop ready-made clothing and fabrics posted by vendors after administrator review.</p></article>
      </div>
    </section>

    <section className="public-how" aria-labelledby="public-how-title">
      <div><p className="eyebrow"><PackageCheck size={15} /> From idea to delivery</p><h2 id="public-how-title">A clearer tailoring experience</h2><p>Measurements, vendor messages, invoices, cloth choices, and progress stay together with your order.</p></div>
      <ol><li><span>01</span><div><strong>Save your fit</strong><p>Add measurement profiles for yourself or family members.</p></div></li><li><span>02</span><div><strong>Choose a vendor or design</strong><p>Compare approved work and send your tailoring requirements.</p></div></li><li><span>03</span><div><strong>Review before work starts</strong><p>Approve the complete invoice and follow progress through delivery.</p></div></li></ol>
    </section>

    <section className="public-safety"><ShieldCheck size={32} /><div><p className="eyebrow">Built around trust</p><h2>Vendor designs and products are reviewed before publication.</h2><p>Private measurements, addresses, order conversations, and account information remain available only after sign-in.</p></div></section>

    <section className="public-cta"><div><p className="eyebrow">Your next fit starts here</p><h2>Bring your wardrobe ideas to life with Vastrivo.</h2></div><Link className="button" to="/register">Get started <ArrowRight size={17} /></Link></section>
  </div>
)

export default PublicHome
