import { Palette, ShoppingBag, Users } from "lucide-react"
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
    <NavLink to="/vendor/customers">
      <Users size={17} />
      <span><strong>Customers</strong><small>Directory and measurements</small></span>
    </NavLink>
  </nav>
)
