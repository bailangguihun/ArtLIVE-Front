from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal, Mapping, Optional


PosterStyleTemplateId = Literal[
    "paper_doodle_grid",
    "warm_collectible_poster",
    "soft_floral_flatlay",
]


@dataclass(frozen=True)
class PosterStyleTemplate:
    id: PosterStyleTemplateId
    version: int
    alias: str
    full_fixed_prompt: str
    allow_multi_panel: bool
    allow_repeated_product: bool
    typography_mode: Literal["textless", "provider_generated"]


PAPER_DOODLE_GRID = PosterStyleTemplate(
    id="paper_doodle_grid",
    version=1,
    alias="纸上奇想四格",
    full_fixed_prompt="""
整体风格：极简暖白纸张背景，大面积留白，黑色精致手绘涂鸦，真实产品包装或产品本体作为主视觉，少量品牌主色点缀。整体要简洁、高级、清新、诙谐、有创意，像收藏级品牌广告海报。

版式要求：海报内部采用2×2四宫格结构，四个正方形画面均匀排列，画面之间保留细微间距。四格风格统一，但每一格都有不同的产品互动创意。

产品要求：根据上传的商品参考图识别最具代表性的产品包装或产品形态。产品要真实、立体、清晰，有包装质感、高光、阴影和体积感，品牌识别度高。整体像真实产品摄影与手绘涂鸦插画融合。

四格互动：第一格让产品成为飞行装置，配云朵、小鸟、风线、星星。第二格让产品成为运动结构，配滑板坡道、冲浪浪面、跳台或滑梯，以及涂鸦小人和动态线。第三格让产品成为音乐音箱或派对扩音器，配音符、声波、跳舞小人和节奏线。第四格让产品开口成为想象世界入口，配漩涡、箭头、小梯子、探险小人、漂浮物和与品牌相关的符号。

文字要求：允许少量克制的中英文品牌文案，字体轻盈现代、有编辑感，不要大字报；文案清晰但不能喧宾夺主。示例短句仅表示语气和排版感，不得机械照抄，也不得把食品表达迁移到不相关商品。

禁止：不要电商主图感，不要廉价宣传单，不要背景杂乱，不要产品变形，不要品牌标识模糊，不要文字凌乱，不要插画低幼，不要过度装饰，不要信息过满，不要产品与插画脱节。
""".strip(),
    allow_multi_panel=True,
    allow_repeated_product=True,
    typography_mode="provider_generated",
)

WARM_COLLECTIBLE_POSTER = PosterStyleTemplate(
    id="warm_collectible_poster",
    version=1,
    alias="收藏级暖白海报",
    full_fixed_prompt="""
整体风格：极简暖白纸张背景，大面积留白，黑色精致手绘涂鸦，真实产品包装或产品本体作为主视觉，少量品牌主色点缀。整体要简洁、高级、清新、诙谐、有创意，像收藏级品牌广告海报。

版式要求：单一完整海报画面，大面积留白，产品包装或产品本体占据主视觉，黑色精致手绘涂鸦围绕产品与留白区域互动点缀，构图简洁、有编辑感。不要多宫格、不要分屏、不要拼贴板布局。

产品要求：根据品牌自动识别最具代表性的产品包装或产品形态。产品要真实、立体、清晰，有包装质感、高光、阴影和体积感，品牌识别度高。整体像真实产品摄影与手绘涂鸦插画融合。
""".strip(),
    allow_multi_panel=False,
    allow_repeated_product=False,
    typography_mode="provider_generated",
)

SOFT_FLORAL_FLATLAY = PosterStyleTemplate(
    id="soft_floral_flatlay",
    version=1,
    alias="柔光粉白花漾",
    full_fixed_prompt="""
整体风格：粉白柔光美学，简约优雅，宁静奢华氛围，捕捉高端护发或美妆产品的精髓。整体构图简洁雅致，柔和发光，氛围静谧、贵气，像高端护发产品广告摄影。

产品呈现：根据上传的商品参考图识别真实产品包装或产品本体（如喷雾、精华、护肤或护发类产品），产品清晰立体，保留包装质感、高光、阴影与体积感。可参考粉白美妆喷雾类产品的平铺视觉语言，但须忠于参考图品牌与包装，不得机械照搬无关示例品牌名或文案。

版式要求：产品平铺于白色纸张或柔白背景上，精致粉白色花朵环绕点缀，俯拍平铺或轻微俯角，柔光辉映。单一完整画面，构图简洁优雅。不要多宫格、不要分屏、不要拼贴板布局。

氛围与光影：柔和漫射光、浅粉与纯白配色，花朵细腻精致，背景干净留白，突出产品与柔光质感。

禁止：不要杂乱堆叠，不要廉价电商主图感，不要颜色过艳刺眼，不要产品变形，不要品牌标识模糊，不要过度装饰，不要信息过满。
""".strip(),
    allow_multi_panel=False,
    allow_repeated_product=False,
    typography_mode="provider_generated",
)

POSTER_STYLE_TEMPLATE_REGISTRY: Mapping[PosterStyleTemplateId, PosterStyleTemplate] = (
    MappingProxyType({
        PAPER_DOODLE_GRID.id: PAPER_DOODLE_GRID,
        WARM_COLLECTIBLE_POSTER.id: WARM_COLLECTIBLE_POSTER,
        SOFT_FLORAL_FLATLAY.id: SOFT_FLORAL_FLATLAY,
    })
)


def poster_style_template_id_openapi_schema() -> dict[str, object]:
    return {
        "anyOf": [
            {"const": template_id, "type": "string"}
            for template_id in POSTER_STYLE_TEMPLATE_REGISTRY
        ]
        + [{"type": "null"}],
        "description": (
            "Optional fixed poster style template. Omit or use null "
            "for the default smart-match behavior."
        ),
    }


def resolve_poster_style_template(
    style_template_id: Optional[str],
) -> Optional[PosterStyleTemplate]:
    if style_template_id is None:
        return None
    template = POSTER_STYLE_TEMPLATE_REGISTRY.get(style_template_id)
    if template is None:
        raise ValueError("unsupported poster style template")
    return template
