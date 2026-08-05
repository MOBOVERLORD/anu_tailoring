import { Palette, ShoppingBag } from "lucide-react"
import { NavLink } from "react-router-dom"

export const VendorStudioNav = () => (
  <nav aria-label="Vendor studio sections" className="vendor-studio-nav">
    <NavLink end to="/vendor">
      <Palette size={17} />
      <span><strong>Designs</strong><small>Tailoring collection</small></span>
    </NavLink>
    <NavLink to="/vendor/products">
      <ShoppingBag size={17} />
      <span><strong>Products</strong><small>Clothes for sale</small></span>
    </NavLink>
  </nav>
)
