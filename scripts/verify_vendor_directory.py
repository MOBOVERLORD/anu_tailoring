"""Read-only schema checks for vendor onboarding, profiles, and custom orders."""

from app.main import app
from sqlalchemy.orm import configure_mappers


def main() -> None:
    configure_mappers()
    schema = app.openapi()
    paths = schema["paths"]
    expected = {
        "/api/vendors",
        "/api/vendors/{vendor_id}",
        "/api/vendors/request",
        "/api/vendors/profile",
        "/api/vendors/{vendor_id}/favorite",
        "/api/vendors/{vendor_id}/custom-design",
        "/api/admin/vendor-requests",
        "/api/admin/vendor-requests/{user_id}/review",
        "/api/media/profile-image",
        "/api/media/vendor-logo",
        "/api/media/users/{user_id}/profile-image",
        "/api/media/vendors/{vendor_id}/logo",
    }
    missing = expected - set(paths)
    assert not missing, f"Missing vendor APIs: {sorted(missing)}"

    design_fields = schema["components"]["schemas"]["DesignResponse"]["properties"]
    invoice_fields = schema["components"]["schemas"]["VendorInvoiceUpsert"]["properties"]
    user_fields = schema["components"]["schemas"]["VendorApplicationResponse"]["properties"]
    assert "is_custom_request_template" in design_fields
    assert "service_amount" in invoice_fields
    assert {"profile_image_url", "shop_name", "vendor_logo_url", "vendor_request_status"} <= set(user_fields)
    vendor_design_parameter_names = {
        item["name"] for item in paths["/api/designs"]["get"]["parameters"]
    }
    vendor_product_parameter_names = {
        item["name"] for item in paths["/api/products"]["get"]["parameters"]
    }
    assert "vendor_id" in vendor_design_parameter_names
    assert "vendor_id" in vendor_product_parameter_names
    print("Vendor directory, onboarding, media, and custom-order schemas passed")


if __name__ == "__main__":
    main()
