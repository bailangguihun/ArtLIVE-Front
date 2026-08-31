from __future__ import annotations

from typing import List

from my_agent.backend.prompts.poster_style_templates import (
    PosterStyleTemplate,
    resolve_poster_style_template,
)


SEQUENCE_CONCEPTS = ("centered_hero", "editorial_closeup", "minimal_brand")

VISUAL_STYLE_PROMPTS = {
    "premium": (
        "Luxury editorial advertising with a refined premium visual identity, "
        "controlled professional studio lighting, a sophisticated color palette, "
        "premium materials, elegant composition, polished commercial photography, "
        "controlled highlights, and realistic reflections."
    ),
    "vibrant": (
        "Bold high-impact advertising with vivid color contrast, dynamic lighting, "
        "energetic composition, strong visual hierarchy, and contemporary commercial "
        "campaign styling."
    ),
}

_CONCEPT_DIRECTIONS = {
    "centered_hero": (
        "Use a centered hero composition. Keep the complete product clearly "
        "recognizable, use a balanced premium campaign layout, controlled studio "
        "lighting, and a strong main-subject hierarchy. Leave clean empty regions "
        "for later local text overlay."
    ),
    "editorial_closeup": (
        "Use a dramatic editorial composition with closer framing. Emphasize material "
        "detail, gemstone brilliance, reflections, and craftsmanship while preserving "
        "the full recognizable product identity. Make the direction visibly distinct "
        "from a centered hero composition. Leave clean empty regions for later local "
        "text overlay."
    ),
    "minimal_brand": (
        "Use a minimal luxury brand-campaign composition with refined negative space "
        "and a clean premium background. Make the direction visibly distinct from "
        "centered hero and editorial close-up layouts. Leave generous empty space "
        "for later local text overlay."
    ),
}

_TEMPLATE_CONCEPT_DIRECTIONS = {
    "centered_hero": (
        "Keep the 2×2 grid rigorously intact while giving each panel a balanced "
        "hero-product composition and a clearly readable product silhouette."
    ),
    "editorial_closeup": (
        "Keep the 2×2 grid rigorously intact while varying closer editorial product "
        "details, material texture, reflections, and product interaction framing "
        "inside the four required panels."
    ),
    "minimal_brand": (
        "Keep the 2×2 grid rigorously intact while using the template's generous "
        "warm-paper whitespace and restrained editorial brand treatment around it."
    ),
}

_SINGLE_TEMPLATE_CONCEPT_DIRECTIONS = {
    "centered_hero": (
        "Use a centered hero composition with generous negative space and "
        "restrained styling that stays faithful to the selected template."
    ),
    "editorial_closeup": (
        "Use a closer editorial framing that emphasizes material texture, packaging "
        "detail, and reflections while preserving the full recognizable product identity."
    ),
    "minimal_brand": (
        "Use a minimal luxury brand-campaign composition with refined negative space "
        "and a clean premium background."
    ),
}

_TEMPLATE_SPECIFIC_CONCEPT_DIRECTIONS: dict[str, dict[str, str]] = {
    "warm_collectible_poster": {
        "centered_hero": (
            "Use a centered hero composition with generous warm-paper whitespace and "
            "restrained black doodle interactions around the product."
        ),
        "editorial_closeup": (
            "Use a closer editorial framing that emphasizes material texture, packaging "
            "detail, reflections, and playful doodle interactions while preserving the "
            "full recognizable product identity."
        ),
        "minimal_brand": (
            "Use a minimal luxury brand-campaign composition with refined negative space, "
            "restrained doodle accents, and a clean warm-paper background."
        ),
    },
    "soft_floral_flatlay": {
        "centered_hero": (
            "Use a centered flat-lay with the product resting on white paper, soft glow "
            "lighting, and delicate pink-and-white florals arranged around it."
        ),
        "editorial_closeup": (
            "Use a closer flat-lay or soft-angle composition emphasizing packaging "
            "detail, mist-bottle texture, soft highlights, and floral accents while "
            "preserving brand identity."
        ),
        "minimal_brand": (
            "Use a minimal luxury composition with refined white negative space, sparse "
            "pink-and-white floral accents, and a calm premium hair-care atmosphere."
        ),
    },
}


def _template_concept_direction(
    concept: str,
    template: PosterStyleTemplate,
) -> str:
    if template.allow_multi_panel:
        return _TEMPLATE_CONCEPT_DIRECTIONS[concept]
    specific = _TEMPLATE_SPECIFIC_CONCEPT_DIRECTIONS.get(template.id)
    if specific is not None:
        return specific[concept]
    return _SINGLE_TEMPLATE_CONCEPT_DIRECTIONS[concept]


def _required_text(value: str, field_name: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{field_name} is required")
    return cleaned


def build_product_poster_sequence_prompts(
    *,
    product_info: str,
    product_short_name: str,
    creative_note: str,
    visual_style: str,
    generated_marketing_copy: str = "",
    exact_poster_title: str = "",
    exact_headline: str = "",
    exact_subline: str = "",
    marketing_advice_context: str = "",
    output_aspect_ratio: str,
    style_template_id: str | None = None,
    sequence_typography_mode: str | None = None,
) -> List[str]:
    """Build three category-free prompts with an optional fixed style layer.

    Marketing slogans are intentionally not rendered by the provider; they are
    kept for API compatibility and edited locally after generation when no
    fixed template explicitly allows restrained provider typography.
    """

    if visual_style not in VISUAL_STYLE_PROMPTS:
        raise ValueError("unsupported visual style")
    template = resolve_poster_style_template(style_template_id)
    product = _required_text(product_info, "product_info")
    ratio = _required_text(output_aspect_ratio, "output_aspect_ratio")
    short_name = product_short_name.strip()
    creative = creative_note.strip()
    # Compatibility: no-template callers remain byte-for-byte on the established
    # textless prompt path. Template mode can use contextual copy terms only.
    if template is None:
        _ = (generated_marketing_copy, exact_poster_title, exact_headline, exact_subline)

    prompts: List[str] = []
    for concept in SEQUENCE_CONCEPTS:
        if template is None:
            lines = [
                "Create exactly one complete vertical advertising poster image.",
                "Use the uploaded image as the primary product reference.",
                f"Output aspect ratio: {ratio}.",
                f"Visual style: {VISUAL_STYLE_PROMPTS[visual_style]}",
                f"Composition concept: {concept}.",
                _CONCEPT_DIRECTIONS[concept],
                "Generate the complete environment, lighting, shadows, reflections, and final visual layout.",
                "CRITICAL: This must be a TEXTLESS visual base. Do not render any advertising copy, "
                "titles, headlines, slogans, captions, subtitles, price tags, promotional badges, "
                "watermarks, QR codes, barcodes, or invented logos floating in the scene.",
                "Do not add typography of any kind outside the product itself.",
                "Preserve the recognizable product silhouette, proportions, structure, colors, "
                "materials, gemstones, metal details, packaging print, brand marks, and distinctive "
                "design features from the reference as faithfully as possible.",
                "Keep on-product logos, labels, and packaging text that already exist on the "
                "reference product; do not erase, rewrite, or replace them.",
                "Do not duplicate the product, replace it with a generic alternative, invent "
                "additional products or packaging, or materially alter its structure.",
                "Do not cover important product details with decorations.",
                "Do not create multiple poster frames or a multi-panel layout.",
                f"Product information: {product}",
            ]
            if short_name:
                lines.append(f"Product short name: {short_name}")
            if creative:
                lines.append(
                    f"User creative direction for mood and scene only (do not paint as text): {creative}"
                )
            if marketing_advice_context:
                lines.append(
                    "Validated marketing direction for visual hierarchy and mood only "
                    "(never render this guidance as text): " + marketing_advice_context
                )
            lines.append(
                "Output a clean textless commercial poster base ready for local typography overlay."
            )
            prompts.append("\n".join(lines))
            continue

        lines = [
            "Create exactly one complete vertical advertising poster image.",
            "Use the uploaded image as the primary product reference.",
            f"Output aspect ratio: {ratio}.",
            f"Visual style: {VISUAL_STYLE_PROMPTS[visual_style]}",
            f"Selected fixed poster style template: {template.id} v{template.version} ({template.alias}).",
            template.full_fixed_prompt,
            f"Template-compatible candidate variation for {concept}: "
            f"{_template_concept_direction(concept, template)}",
            "Generate the complete environment, lighting, shadows, reflections, and final visual layout.",
            "Preserve the recognizable product silhouette, proportions, structure, colors, "
            "materials, packaging print, brand marks, and distinctive design features from "
            "the uploaded reference as faithfully as possible.",
            "Keep on-product logos, labels, and packaging text that already exist on the "
            "reference product; do not erase, rewrite, replace, or obscure them.",
            "Do not substitute an unrelated product or materially alter the product structure.",
            "Do not cover important product details with decorations.",
        ]
        if not template.allow_multi_panel:
            lines.append("Do not create multiple poster frames or a multi-panel layout.")
        lines.extend([
            f"Product information: {product}",
        ])
        if short_name:
            lines.append(f"Product short name: {short_name}")
        if creative:
            lines.append(
                f"User creative direction for mood and scene only: {creative}"
            )
        copy_context = "\n".join(
            value.strip()
            for value in (
                generated_marketing_copy,
                exact_poster_title,
                exact_headline,
                exact_subline,
            )
            if value.strip()
        )
        if copy_context:
            lines.append(
                "Current poster-copy context: use its relevant brand and product terms "
                "with restraint; do not force unrelated sample wording into the image.\n"
                + copy_context
            )
        if marketing_advice_context:
            lines.append(
                "Validated marketing direction for visual hierarchy and mood: "
                + marketing_advice_context
            )
        provider_text = sequence_typography_mode == "with_text"
        if provider_text:
            lines.append(
                "Adapt the following marketing copy creatively for restrained on-poster "
                "CN/EN typography. Rephrase, condense, and compose for visual impact; "
                "do not mechanically paste full paragraphs or long blocks."
            )
            if template.allow_multi_panel:
                lines.append(
                    "Deliver the required 2×2 four-panel paper-doodle poster with restrained "
                    "provider-rendered CN/EN brand typography and faithful product identity."
                )
            else:
                lines.append(
                    "Deliver the required single-frame collectible brand poster with restrained "
                    "provider-rendered CN/EN brand typography and faithful product identity."
                )
        else:
            lines.append(
                "CRITICAL: This must be a TEXTLESS visual base for the selected template. "
                "Do not render any advertising copy, titles, headlines, slogans, captions, "
                "subtitles, price tags, promotional badges, watermarks, QR codes, barcodes, "
                "or invented logos floating in the scene."
            )
            lines.append(
                "Do not add typography of any kind outside the product itself."
            )
            lines.append(
                "Output a clean textless commercial poster base ready for local typography overlay."
            )
        prompts.append("\n".join(lines))
    return prompts
