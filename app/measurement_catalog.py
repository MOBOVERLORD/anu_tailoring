FIELD_LABELS = {
    "bust": "Bust",
    "upper_bust": "Upper bust",
    "under_bust": "Under bust",
    "chest": "Chest",
    "waist": "Waist",
    "hip": "Hip / seat",
    "shoulder": "Shoulder",
    "neck": "Neck round",
    "armhole": "Armhole",
    "bicep": "Upper arm / bicep",
    "sleeve_length": "Sleeve length",
    "wrist": "Wrist / cuff",
    "front_neck_depth": "Front neck depth",
    "back_neck_depth": "Back neck depth",
    "blouse_length": "Blouse length",
    "garment_length": "Garment length",
    "kameez_length": "Kameez length",
    "skirt_length": "Skirt length",
    "thigh": "Thigh",
    "knee": "Knee round",
    "bottom": "Bottom / ankle round",
    "inseam": "Inside leg / inseam",
    "outseam": "Outside leg",
    "rise": "Crotch / rise",
}

COMMON_UPPER = ["shoulder", "neck", "armhole", "bicep", "sleeve_length", "wrist"]

DEFAULT_MEASUREMENT_CATEGORIES = [
    ("Saree blouse", "saree_blouse", "women", ["bust", "upper_bust", "under_bust", "waist", *COMMON_UPPER, "front_neck_depth", "back_neck_depth", "blouse_length"]),
    ("Salwar / kameez", "salwar_kameez", "women", ["bust", "waist", "hip", *COMMON_UPPER, "kameez_length", "thigh", "knee", "bottom", "inseam", "rise"]),
    ("Lehenga set", "lehenga", "women", ["bust", "under_bust", "waist", "hip", "shoulder", "armhole", "sleeve_length", "blouse_length", "skirt_length"]),
    ("Women’s kurta", "womens_kurta", "women", ["bust", "waist", "hip", *COMMON_UPPER, "garment_length"]),
    ("Dress / gown", "dress", "women", ["bust", "waist", "hip", *COMMON_UPPER, "garment_length"]),
    ("Men’s kurta", "kurta", "men", ["chest", "waist", "hip", *COMMON_UPPER, "garment_length"]),
    ("Shirt", "shirt", "men", ["chest", "waist", "hip", *COMMON_UPPER, "garment_length"]),
    ("Trouser / pyjama", "trouser", "men", ["waist", "hip", "thigh", "knee", "bottom", "rise", "inseam", "outseam"]),
    ("Sherwani", "sherwani", "men", ["chest", "waist", "hip", *COMMON_UPPER, "garment_length"]),
]


def default_category_rows() -> list[dict]:
    return [
        {
            "name": name,
            "garment_type": garment_type,
            "gender": gender,
            "measurement_fields": [
                {"key": key, "label": FIELD_LABELS[key]} for key in fields
            ],
            "standard_sizes": {},
            "is_active": True,
            "sort_order": index,
        }
        for index, (name, garment_type, gender, fields) in enumerate(
            DEFAULT_MEASUREMENT_CATEGORIES
        )
    ]
