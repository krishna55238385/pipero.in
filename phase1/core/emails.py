import re


_NON_ALPHA = re.compile(r"[^a-z]")


def _clean_part(part: str) -> str:
    return _NON_ALPHA.sub("", part.lower())


def generate_patterns(full_name: str, domain: str) -> list[str]:
    if not full_name or not full_name.strip():
        return []
    if not domain or not domain.strip():
        return []

    domain_clean = domain.strip().lower()
    raw_parts = [p for p in full_name.strip().split() if p]
    cleaned_parts = [_clean_part(p) for p in raw_parts]
    cleaned_parts = [p for p in cleaned_parts if p]

    if not cleaned_parts:
        return []

    if len(cleaned_parts) == 1:
        return [f"{cleaned_parts[0]}@{domain_clean}"]

    first = cleaned_parts[0]
    last = cleaned_parts[-1]
    first_initial = first[0]

    return [
        f"{first}.{last}@{domain_clean}",
        f"{first}{last}@{domain_clean}",
        f"{first_initial}{last}@{domain_clean}",
        f"{first_initial}.{last}@{domain_clean}",
        f"{first}_{last}@{domain_clean}",
        f"{first}@{domain_clean}",
    ]
