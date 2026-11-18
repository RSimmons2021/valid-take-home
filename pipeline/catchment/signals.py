"""Place signals: how Overture's taxonomy maps onto things a growth team reasons about.

Each cleaned place maps to at most one signal. Rules are checked in order, so the more
specific rules come first (a "Whole Foods Market" is a premium grocer before it is a
grocery store). The definitions are exported with the data so the app's labels can't
drift from what the pipeline counted.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Signal:
    id: str
    label: str
    description: str
    primaries: frozenset[str] = field(default_factory=frozenset)  # taxonomy.primary
    basics: frozenset[str] = field(default_factory=frozenset)  # basic_category
    brands: frozenset[str] = field(default_factory=frozenset)  # brand.names.primary
    exclude: frozenset[str] = field(default_factory=frozenset)  # taxonomy.primary


def _s(*xs: str) -> frozenset[str]:
    return frozenset(xs)


CLEANING = _s(
    "home_cleaning",
    "carpet_cleaning",
    "air_duct_cleaning_service",
    "cleaning_service",
    "window_washing",
    "pressure_washing",
    "gutter_service",
)

SIGNALS: list[Signal] = [
    Signal(
        "premium_grocers",
        "Premium grocers",
        "Whole Foods, Trader Joe's and similar. A rough proxy for household spending power.",
        brands=_s(
            "Whole Foods Market",
            "Trader Joe's",
            "Sprouts Farmers Market",
            "Erewhon",
            "Natural Grocers",
            "Central Market",
            "Mariano's",
            "Lazy Acres",
            "Bristol Farms",
        ),
    ),
    Signal(
        "home_cleaning",
        "Cleaning services",
        "Home, carpet and duct cleaning businesses.",
        primaries=CLEANING,
    ),
    Signal(
        "home_trades",
        "Home repair trades",
        "Handymen, contractors, plumbers, electricians, painters, HVAC and roofing.",
        basics=_s("home_service"),
        exclude=CLEANING | _s("mover", "furniture_rental_service", "home_staging"),
    ),
    Signal(
        "home_retail",
        "Home & hardware stores",
        "Hardware, home goods, furniture and garden stores.",
        basics=_s("hardware_home_and_garden_store"),
    ),
    Signal(
        "moving",
        "Moves & real estate",
        "Real estate offices, movers and self storage. A sign that households turn over.",
        primaries=_s("mover", "self_storage_facility", "storage_facility"),
        basics=_s("real_estate_service"),
    ),
    Signal(
        "pet_care",
        "Pet sitters & boarding",
        "Pet sitting, boarding, dog walking and training.",
        primaries=_s(
            "pet_sitting",
            "pet_boarding",
            "dog_walker",
            "dog_trainer",
            "animal_or_pet_service",
        ),
    ),
    Signal(
        "pet_life",
        "Pet owners nearby",
        "Vets, pet stores, groomers and dog parks: places that exist where pets live.",
        primaries=_s(
            "veterinarian",
            "veterinary_care",
            "animal_hospital",
            "pet_groomer",
            "pet_store",
            "aquatic_pet_store",
            "dog_park",
        ),
        basics=_s("animal_and_pet_store", "dog_park"),
    ),
    Signal(
        "families",
        "Young families",
        "Preschools, elementary schools, childcare, playgrounds and pediatricians.",
        primaries=_s("child_care_and_day_care", "day_care_preschool"),
        basics=_s("preschool", "elementary_school", "middle_school", "playground", "pediatric_clinic"),
    ),
    Signal(
        "tutoring",
        "Tutoring & classes",
        "Tutors, learning centres and specialty schools.",
        basics=_s("tutoring_service", "specialty_school", "educational_service"),
    ),
    Signal(
        "fitness",
        "Gyms & studios",
        "Gyms, yoga, pilates and other fitness studios.",
        basics=_s("gym", "fitness_studio", "sport_or_fitness_facility"),
    ),
    Signal(
        "nightlife",
        "Nightlife",
        "Bars, clubs, lounges and music venues.",
        basics=_s("bar", "dance_club", "nightlife_venue", "lounge", "music_venue"),
    ),
    Signal(
        "offices",
        "Offices",
        "Corporate and business offices. Daytime population, not residents.",
        basics=_s("corporate_or_business_office"),
        primaries=_s("coworking_space"),
    ),
    Signal(
        "daily_needs",
        "Everyday errands",
        "Groceries, coffee, pharmacies and laundromats: the texture of residential streets.",
        basics=_s(
            "food_and_beverage_store",
            "coffee_shop",
            "cafe",
            "convenience_store",
            "pharmacy_and_drug_store",
            "laundry_service",
        ),
    ),
    Signal(
        "seniors",
        "Senior living",
        "Retirement homes and senior living facilities.",
        basics=_s("senior_living_facility"),
        primaries=_s("retirement_home"),
    ),
]

SIGNAL_INDEX = {s.id: i for i, s in enumerate(SIGNALS)}


def _sql_list(xs: frozenset[str]) -> str:
    return ", ".join("'" + x.replace("'", "''") + "'" for x in sorted(xs))


def signal_case_sql(primary: str = "taxonomy.primary", basic: str = "basic_category", brand: str = "brand") -> str:
    """A SQL CASE expression that returns the signal index of a place, or NULL."""
    arms = []
    for i, s in enumerate(SIGNALS):
        conds = []
        if s.brands:
            conds.append(f"{brand} IN ({_sql_list(s.brands)})")
        if s.primaries:
            conds.append(f"{primary} IN ({_sql_list(s.primaries)})")
        if s.basics:
            conds.append(f"{basic} IN ({_sql_list(s.basics)})")
        cond = "(" + " OR ".join(conds) + ")"
        if s.exclude:
            cond += f" AND coalesce({primary}, '') NOT IN ({_sql_list(s.exclude)})"
        arms.append(f"WHEN {cond} THEN {i}")
    return "CASE " + " ".join(arms) + " ELSE NULL END"


def classify(primary: str | None, basic: str | None, brand: str | None = None) -> str | None:
    """Pure-Python twin of `signal_case_sql`, used by tests and for spot checks."""
    for s in SIGNALS:
        hit = (
            (brand is not None and brand in s.brands)
            or (primary is not None and primary in s.primaries)
            or (basic is not None and basic in s.basics)
        )
        if hit and (primary or "") not in s.exclude:
            return s.id
    return None


def manifest() -> list[dict]:
    return [{"id": s.id, "label": s.label, "description": s.description} for s in SIGNALS]
