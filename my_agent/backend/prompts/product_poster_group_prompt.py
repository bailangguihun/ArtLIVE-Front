from __future__ import annotations


VISUAL_STYLE_PROMPTS = {
    "premium": (
        "Luxury editorial advertising with a refined premium visual identity, "
        "controlled professional studio lighting, a sophisticated color palette, "
        "premium materials, an elegant composition, polished commercial photography, "
        "controlled highlights, and realistic reflections."
    ),
    "vibrant": (
        "Bold high-impact advertising with vivid color contrast, dynamic lighting, "
        "an energetic composition, strong visual hierarchy, and contemporary "
        "commercial campaign styling."
    ),
}


def _required_text(value: str, field_name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def build_product_poster_group_prompt(
    *,
    product_info: str,
    product_short_name: str,
    creative_note: str,
    visual_style: str,
    generated_marketing_copy: str,
    exact_poster_title: str,
    exact_headline: str,
    exact_subline: str,
    output_aspect_ratio: str,
    requested_poster_count: int,
) -> str:
    """Build the category-free prompt for one complete-poster group request."""
    if requested_poster_count != 3:
        raise ValueError("complete-poster group prompt requires exactly three posters")
    if visual_style not in VISUAL_STYLE_PROMPTS:
        raise ValueError("unsupported visual style")

    product = _required_text(product_info, "product_info")
    title = _required_text(exact_poster_title, "exact_poster_title")
    headline = _required_text(exact_headline, "exact_headline")
    ratio = _required_text(output_aspect_ratio, "output_aspect_ratio")
    short_name = product_short_name.strip()
    creative = creative_note.strip()
    copy_context = generated_marketing_copy.strip()
    subline = exact_subline.strip()

    lines = [
        "Create exactly three separate complete vertical advertising poster images using the uploaded image as the primary product reference.",
        "Return them as one coordinated campaign set with a coherent visual identity and three visually distinct compositions.",
        "Generate each poster as a complete final advertisement: integrate the product, environment, lighting, shadows, reflections, typography, and overall composition.",
        "No local product compositing or local text compositing is expected afterward.",
        f"Output aspect ratio: {ratio}.",
        f"Visual style: {VISUAL_STYLE_PROMPTS[visual_style]}",
        "",
        "Product reference and fidelity requirements:",
        f"- Product information: {product}",
    ]
    if short_name:
        lines.append(f"- Product short name: {short_name}")
    if creative:
        lines.append(f"- User creative direction: {creative}")
    lines.extend(
        [
            "- Faithfully preserve the recognizable silhouette, proportions, structure, colors, materials, gemstones, metal details, packaging geometry when present, visible logos and brand marks, and distinctive product design features.",
            "- Do not duplicate the product or create additional products.",
            "- Do not invent packaging that is not present.",
            "- Do not materially alter the product structure or replace it with a generic alternative.",
            "- Do not cover important product details with text or decorations.",
            "",
            "Advertising copy:",
            f"- Title (render exactly and legibly): {title}",
            f"- Headline (render exactly and legibly): {headline}",
            f"- Subline (render exactly and legibly): {subline}",
        ]
    )
    if copy_context:
        lines.append(f"- Marketing-copy context: {copy_context}")
    lines.extend(
        [
            "- Render only the supplied advertising copy; do not invent prices, promotional claims, legal claims, QR codes, or barcodes.",
            "",
            "Three-poster campaign concepts:",
            "1. Poster 1 — Centered hero composition: make the product the main visual subject, use a balanced premium campaign composition, preserve strong product recognition, and deliver a complete advertising layout.",
            "2. Poster 2 — Dramatic editorial close-up: use closer product framing, stronger light and material detail, and a more dramatic commercial visual hierarchy while preserving the complete product identity.",
            "3. Poster 3 — Minimal brand-campaign composition: use refined negative space, an elegant premium layout, and a clear typography region that is visually distinct from Posters 1 and 2.",
            "",
            "Generate exactly three separate images and return them as a coordinated campaign set.",
            "Do not combine all three designs into one contact sheet.",
            "Do not create a three-panel collage.",
            "Do not place three posters inside one generated image.",
        ]
    )
    return "\n".join(lines)
