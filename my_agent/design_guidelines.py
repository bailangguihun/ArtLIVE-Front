# coding: utf-8
"""爆款专用：人工设计规范目录。高端路线请勿使用本文件。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


# 分类 key 必须稳定，供 LLM 路由与配置查找
CATEGORY_KEYS = [
    "快消品_日化",
    "快消品_零食",
    "快消品_饮料",
    "快消品_日用品",
    "快消品_宠物零食",
    "快消品_平价背包",
    "耐用品_家电",
    "耐用品_家具",
    "耐用品_手机数码",
    "耐用品_耳机",
    "奢侈品_大牌箱包",
    "奢侈品_腕表",
    "奢侈品_高端酒水",
    "保健品",
]


DESIGN_GUIDELINES: Dict[str, Dict[str, Any]] = {
    "快消品_日化": {
        "label_zh": "快消品 · 日化（洗护/护肤/彩妆）",
        "tone": "干净、无添加、水润透亮、治愈感",
        "bg_source": "unsplash",  # unsplash | solid | either
        "palettes": [
            {"name": "暖米色", "colors": ["米色", "奶油白", "浅杏"], "hint": "warm beige cream apricot soft morning light"},
            {"name": "柔和马卡龙", "colors": ["淡粉", "奶油白", "浅桃"], "hint": "gentle pastel pink cream peach soft light"},
            {"name": "现代极简", "colors": ["纯白", "冷灰", "透明"], "hint": "pure white cool gray minimal clean"},
        ],
        "scenes": [
            {
                "name_zh": "浴室织物台",
                "unsplash": [
                    "folded beige towels bathroom vanity eye level",
                    "soft towels spa counter morning light",
                ],
                "prompt": (
                    "bathroom vanity lifestyle stage, neatly folded soft beige towels, "
                    "small vase with fresh camellia flowers, warm cream tones, "
                    "clear props, empty center for product"
                ),
            },
            {
                "name_zh": "花瓣浅水台",
                "unsplash": [
                    "camellia petals on shallow water surface eye level",
                    "flower petals water ripples soft light",
                ],
                "prompt": (
                    "shallow water reflective stage with floating camellia petals, "
                    "soft warm beige mood, visible water and petals as clear props, "
                    "empty center podium for product"
                ),
            },
            {
                "name_zh": "丝绸花海台",
                "unsplash": [
                    "silk fabric with camellia flowers soft light",
                    "beige silk drape floral still life eye level",
                ],
                "prompt": (
                    "warm beige LUSTROUS SILK SATIN fabric drape with soft specular highlights, "
                    "smooth elegant silk folds (not cotton, not terry towel, not ragged cloth), "
                    "abundant camellia blossoms and petals, soft golden morning light, "
                    "empty center for product, no bottles no packages no text"
                ),
            },
        ],
        "decor": ["camellia flowers", "camellia petals", "folded towels", "silk fabric", "dew drops"],
        "lighting": "soft morning natural light, soft translucent contact shadow, no harsh hard shadow",
    },
    "快消品_零食": {
        "label_zh": "快消品 · 零食（膨化/糖果/糕点）",
        "tone": "食欲爆发、活力趣味、分享快乐、多巴胺",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "活力多巴胺", "colors": ["明黄", "暖橙"], "hint": "bright yellow warm orange appetite"},
            {"name": "时尚撞色", "colors": ["克莱因蓝", "日落桔"], "hint": "klein blue sunset orange color clash"},
            {"name": "粉嫩甜美", "colors": ["草莓粉", "奶油白"], "hint": "strawberry pink cream white sweet"},
        ],
        "scenes": [
            {
                "name_zh": "纯色摄影棚",
                "unsplash": ["solid color seamless paper backdrop studio", "bright colored photography backdrop eye level"],
                "prompt": "high saturation seamless studio paper backdrop with slight paper texture, empty center",
            },
            {
                "name_zh": "野餐聚会",
                "unsplash": ["picnic cloth tabletop closeup soft bokeh", "checkered picnic fabric texture studio"],
                "prompt": "picnic checkered cloth tabletop closeup, soft blurred background, empty center",
            },
            {
                "name_zh": "波普波纹",
                "unsplash": ["colorful geometric wall pop art", "abstract colorful geometric panels"],
                "prompt": "pop art colorful geometric wall panels, playful backdrop, empty center stage",
            },
        ],
        "decor": ["nuts crumbs", "chocolate drizzle", "flying chips", "colorful ribbons", "shopping cart or gift box accent"],
        "lighting": "bright dual soft fill, glossy packaging highlights",
    },
    "快消品_饮料": {
        "label_zh": "快消品 · 饮料（气泡水/果汁/茶饮）",
        "tone": "极致冰爽、解渴、能量、新鲜",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "冰川冷色", "colors": ["冰蓝", "薄荷绿", "银白"], "hint": "ice blue mint silver refreshing"},
            {"name": "热带果色", "colors": ["柠檬黄", "西柚橙", "芒果绿"], "hint": "lemon yellow grapefruit mango tropical"},
            {"name": "复古茶系", "colors": ["琥珀", "墨绿", "竹青"], "hint": "amber dark green bamboo tea vintage"},
        ],
        "scenes": [
            {
                "name_zh": "冰块基座",
                "unsplash": ["crushed ice pile blue mist studio", "ice cubes cold fog blue studio backdrop"],
                "prompt": "product stage of crystal crushed ice, deep blue cold mist studio backdrop, empty center",
            },
            {
                "name_zh": "夏日海滩",
                "unsplash": ["golden sand texture closeup product stage", "fine beach sand soft bokeh studio"],
                "prompt": "golden sand texture stage, heavily blurred soft blue bokeh (not ocean panorama), bright sunlight, empty center",
            },
            {
                "name_zh": "动感水面",
                "unsplash": ["rippling water surface eye level", "water ripples product reflection"],
                "prompt": "rippling water surface stage, dynamic gentle waves, empty center for bottle",
            },
        ],
        "decor": ["water splash", "condensation droplets", "lemon lime slices", "rising bubbles"],
        "lighting": "strong rim or backlight through liquid, crystal edge light",
    },
    "快消品_日用品": {
        "label_zh": "快消品 · 日用品（纸巾/洗衣液/清洁剂）",
        "tone": "温馨、安全信赖、干净整洁、家庭氛围",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "大地暖色", "colors": ["米色", "驼色", "浅杏"], "hint": "beige camel apricot warm home"},
            {"name": "洁净冷色", "colors": ["天蓝", "纯白"], "hint": "sky blue pure white clean fresh"},
            {"name": "生态绿意", "colors": ["淡绿", "浅木色"], "hint": "light green soft wood eco"},
        ],
        "scenes": [
            {
                "name_zh": "温馨阳光房",
                "unsplash": ["sunlit linen curtain wood table eye level", "warm sunlight wooden tabletop home"],
                "prompt": "warm sunroom wood tabletop, soft light spots on linen curtains, empty center",
            },
            {
                "name_zh": "现代洗漱台",
                "unsplash": ["white stone bathroom vanity small plant", "clean bathroom countertop eye level"],
                "prompt": "clean white stone vanity, small green plant aside, empty center for product",
            },
            {
                "name_zh": "舒适客厅",
                "unsplash": ["beige living room soft sofa corner", "cozy living room carpet wall eye level"],
                "prompt": "beige living room wall, soft sofa or carpet corner texture, empty center",
            },
        ],
        "decor": ["cotton fluff", "green leaves", "blinds window light stripes", "fluffy towel"],
        "lighting": "large soft diffuse light, very soft shadow edges",
    },
    "快消品_宠物零食": {
        "label_zh": "快消品 · 宠物零食",
        "tone": "健康活力、趣味陪伴、天然无添加、萌宠诱惑",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "温暖阳光", "colors": ["暖黄", "原木色"], "hint": "warm yellow wood pet home"},
            {"name": "天然草木", "colors": ["淡绿", "燕麦色"], "hint": "soft green oatmeal natural"},
            {"name": "活泼多巴胺", "colors": ["天蓝", "亮橙"], "hint": "sky blue bright orange playful"},
        ],
        "scenes": [
            {
                "name_zh": "单宠全身并排（强制）",
                "unsplash": [
                    "one single dog full body sitting side view outdoor",
                    "one golden retriever puppy full body sitting entire animal",
                ],
                "prompt": (
                    "ONE single dog full body sitting beside empty product space, "
                    "entire animal head to paws visible, side-by-side layout only, "
                    "NO closeup head, NO multiple dogs, NO animal behind package"
                ),
            },
            {
                "name_zh": "户外虚化空镜",
                "unsplash": ["sunny green grass soft bokeh empty background", "blue sky white clouds soft bokeh"],
                "prompt": "soft outdoor bokeh empty stage, no animals in background plate",
            },
            {
                "name_zh": "微水泥极简台",
                "unsplash": ["microcement wall soft daylight empty", "minimal gray plaster wall product stage"],
                "prompt": "minimal microcement empty product stage, soft daylight, no clutter",
            },
        ],
        "decor": [],  # 禁止目录默认脑补道具；动物仅由用户提示驱动
        "lighting": "warm bright natural side light, soft shadows",
        "pet_rules": {
            "max_animals": 1,
            "require_full_body": True,
            "layout": "side_by_side_or_product_front_pet_side",
            "forbid_head_only_behind_product": True,
        },
    },
    "快消品_平价背包": {
        "label_zh": "快消品 · 普通平价背包",
        "tone": "青春校园、都市通勤、实用耐看、生活化",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "文艺冷淡", "colors": ["水泥灰", "燕麦白", "海军蓝"], "hint": "concrete gray oatmeal navy"},
            {"name": "校园青春", "colors": ["米白", "淡卡其"], "hint": "off white khaki campus"},
            {"name": "街头运动", "colors": ["军绿", "炭黑"], "hint": "army green charcoal street"},
        ],
        "scenes": [
            {
                "name_zh": "咖啡馆水泥台",
                "unsplash": ["cafe concrete table eye level", "minimal cafe tabletop warm bokeh"],
                "prompt": "minimal cafe concrete or wood tabletop, warm blurred cafe lights, empty center",
            },
            {
                "name_zh": "校园长椅",
                "unsplash": ["park bench wood texture shade bokeh closeup", "wooden bench surface soft leaf shadow"],
                "prompt": "park wooden bench surface closeup under soft tree shade bokeh, empty space for backpack",
            },
            {
                "name_zh": "极简玄关",
                "unsplash": ["minimalist entryway eye level", "home entryway bench daily lifestyle"],
                "prompt": "minimal entryway shoe bench corner, ready-to-go daily mood, empty center",
            },
        ],
        "decor": ["notebook", "water bottle", "cute bag charm", "tablet or earphone cable corner"],
        "lighting": "bright everyday white light, optional blinds or leaf shadow mottling",
    },
    "耐用品_家电": {
        "label_zh": "耐用品 · 家电",
        "tone": "现代感、家居一体化、静谧高档、科技生活",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "经典黑白灰", "colors": ["纯黑", "太空灰", "哑光白"], "hint": "matte black space gray white"},
            {"name": "复古奶油", "colors": ["奶油白", "香槟金"], "hint": "cream champagne wood vintage"},
            {"name": "高智深蓝", "colors": ["深蓝", "拉丝银"], "hint": "deep blue brushed silver smart"},
        ],
        "scenes": [
            {
                "name_zh": "现代开放式厨房",
                "unsplash": ["modern kitchen microcement cabinet eye level", "open kitchen wood cabinet corner"],
                "prompt": "modern open kitchen microcement wall, dark wood cabinet corner, empty center",
            },
            {
                "name_zh": "北欧风客厅",
                "unsplash": ["scandinavian living room concrete floor", "minimal gray living room spotlight"],
                "prompt": "nordic living room gray concrete floor, soft wall spotlight, empty center",
            },
            {
                "name_zh": "极简展台",
                "unsplash": ["minimal stone pedestal empty studio", "floating stone product pedestal eye level"],
                "prompt": "minimal rock or metal floating pedestal, seamless clean wall, empty center",
            },
        ],
        "decor": ["single dry branch vase", "geometric light lines", "soft natural glow"],
        "lighting": "precise side natural light, show matte or brushed metal materials",
    },
    "耐用品_家具": {
        "label_zh": "耐用品 · 家具",
        "tone": "空间美学、舒适承托、自然呼吸、慵懒",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "秋日大地", "colors": ["胡桃木", "焦糖", "米灰"], "hint": "walnut caramel beige warm"},
            {"name": "森林绿野", "colors": ["墨绿", "原木"], "hint": "forest green natural wood"},
            {"name": "冷寂侘寂", "colors": ["燕麦", "水泥灰", "麻布"], "hint": "oatmeal concrete linen wabi"},
        ],
        "scenes": [
            {
                "name_zh": "大落地窗旁",
                "unsplash": ["living room afternoon sunlight wood floor", "window shadow living room eye level"],
                "prompt": "living room by large window, afternoon sunlight and window shadows on wood floor, empty center",
            },
            {
                "name_zh": "艺术画廊墙",
                "unsplash": ["textured lime plaster wall wool rug", "gallery wall limewash carpet eye level"],
                "prompt": "textured limewash gallery wall, quality wool rug floor, empty center",
            },
            {
                "name_zh": "绿植阳台",
                "unsplash": ["indoor plants fiddle leaf fig balcony", "monstera indoor garden background"],
                "prompt": "balcony or atrium with tall fiddle leaf fig or monstera, empty center",
            },
        ],
        "decor": ["soft cushion", "knit throw on chair", "warm floor lamp corner"],
        "lighting": "3pm slanted sunlight, long warm comfortable shadows",
    },
    "耐用品_手机数码": {
        "label_zh": "耐用品 · 手机/数码/电脑",
        "tone": "硬核科技、极客未来、硬朗精密",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "暗夜赛博", "colors": ["深黑", "荧光绿", "电光蓝"], "hint": "dark cyber neon green electric blue"},
            {"name": "极客银白", "colors": ["钛银", "纯白"], "hint": "titanium silver pure white geek"},
            {"name": "撞色电竞", "colors": ["红", "黑"], "hint": "red black gaming contrast"},
        ],
        "scenes": [
            {
                "name_zh": "科技机房",
                "unsplash": ["server rack blur dark tech room", "carbon fiber texture dark studio eye level"],
                "prompt": "blurred server racks or carbon fiber panel backdrop, empty center stage",
            },
            {
                "name_zh": "悬浮几何空间",
                "unsplash": ["dark geometric abstract studio cubes", "minimal dark geometric product space"],
                "prompt": "dark geometric cube micro space, floating empty center podium",
            },
            {
                "name_zh": "赛博都市夜景",
                "unsplash": ["neon bokeh abstract lights blur studio", "cyberpunk neon light bokeh no buildings"],
                "prompt": "blurred neon light bokeh abstract (no buildings, no streetscape), wet reflection hints, empty center",
            },
        ],
        "decor": ["glowing tech lines", "holographic shapes", "floating metal parts"],
        "lighting": "strong rim light on metal edges, cool-warm dual light contrast",
    },
    "耐用品_耳机": {
        "label_zh": "耐用品 · 耳机",
        "tone": "潮流律动、沉浸音乐、个性标榜",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "潮流街头", "colors": ["荧光黄", "撞色粉"], "hint": "neon yellow clash pink street"},
            {"name": "奢华声学", "colors": ["黑金", "银灰", "皮质棕"], "hint": "black gold silver leather brown"},
            {"name": "清新马卡龙", "colors": ["薄荷绿", "雾霾蓝", "樱花粉"], "hint": "mint haze blue sakura pink"},
        ],
        "scenes": [
            {
                "name_zh": "声学空间",
                "unsplash": ["acoustic foam triangle wall studio", "recording studio acoustic panels eye level"],
                "prompt": "professional triangle acoustic foam wall, quiet studio, empty center",
            },
            {
                "name_zh": "虚化街头夜色",
                "unsplash": ["neon light bokeh abstract night red blue", "colorful neon bokeh soft blur studio"],
                "prompt": "blurred neon red blue night bokeh abstract (no street, no buildings), empty center",
            },
            {
                "name_zh": "极简悬浮台",
                "unsplash": ["brushed metal circular pedestal studio", "minimal metal product stand eye level"],
                "prompt": "brushed metal circular display pedestal, empty center",
            },
        ],
        "decor": ["colorful soundwave lines", "light orbs", "floating dust motes", "water drops waterproof hint"],
        "lighting": "strong stage spotlight, clear light-shadow edge on leather and metal",
    },
    "奢侈品_大牌箱包": {
        "label_zh": "奢侈品 · 大牌箱包",
        "tone": "高定硬照、艺术格调、低调显贵",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "经典黑白", "colors": ["纯黑", "纯白"], "hint": "pure black white fashion"},
            {"name": "皇家尊贵", "colors": ["香槟金", "皇室蓝", "马鞍棕"], "hint": "champagne royal blue saddle brown"},
            {"name": "复古酒红", "colors": ["酒红", "墨绿"], "hint": "burgundy dark green renaissance"},
        ],
        "scenes": [
            {
                "name_zh": "法式石雕墙",
                "unsplash": ["french plaster molding wall white", "classic ornate wall molding eye level"],
                "prompt": "french white plaster molding wall, elegant empty center stage",
            },
            {
                "name_zh": "皮革大理石",
                "unsplash": ["black marble pedestal velvet backdrop", "dark velvet curtain marble table eye level"],
                "prompt": "black marble pedestal, dark velvet curtain backdrop, empty center",
            },
            {
                "name_zh": "沙龙光影",
                "unsplash": ["soft gray wall geometric arch shadow", "studio gray backdrop hard shadow arch"],
                "prompt": "simple light gray salon wall with geometric arch shadow, empty center",
            },
        ],
        "decor": ["plaster statue fragment", "silk ribbon", "single rose"],
        "lighting": "hard dramatic light, sharp reflections on leather stitching and metal hardware",
    },
    "奢侈品_腕表": {
        "label_zh": "奢侈品 · 腕表",
        "tone": "极致精工、时间重量、尊贵身份",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "黑金典雅", "colors": ["深黑", "玫瑰金"], "hint": "deep black rose gold elegant"},
            {"name": "绅士深棕", "colors": ["胡桃木", "人字纹灰"], "hint": "walnut herringbone gray gentleman"},
            {"name": "深海幽蓝", "colors": ["深蓝黑渐变"], "hint": "deep sea blue black dive watch"},
        ],
        "scenes": [
            {
                "name_zh": "机械微距",
                "unsplash": ["watch gears brass steel macro blur", "mechanical watch movement bokeh"],
                "prompt": "heavily blurred brass steel watch gears background, empty center",
            },
            {
                "name_zh": "绅士书房",
                "unsplash": ["leather desk fountain pen suit fabric", "gentleman study desk eye level"],
                "prompt": "premium leather desk, suit fabric or fountain pen corner, empty center",
            },
            {
                "name_zh": "自然岩石",
                "unsplash": ["black volcanic rock surface eye level", "rough dark stone product stage"],
                "prompt": "rough black volcanic rock surface, cold powerful mood, empty center",
            },
        ],
        "decor": ["crystal glass", "subtle starburst flare", "brushed metal lines"],
        "lighting": "point light on dial area, cool blue AR coating hint, gradient shadow on strap side",
    },
    "奢侈品_高端酒水": {
        "label_zh": "奢侈品 · 高端酒水",
        "tone": "岁月沉淀、尊贵品味、奢华社交",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "琥珀金光", "colors": ["暗金", "琥珀"], "hint": "dark gold amber whisky"},
            {"name": "深邃酒红", "colors": ["暗红", "黑"], "hint": "deep red black wine"},
            {"name": "冰川纯净", "colors": ["黑白", "冰蓝"], "hint": "minimal black white ice blue vodka"},
        ],
        "scenes": [
            {
                "name_zh": "橡木酒窖",
                "unsplash": ["oak wine barrel cellar stone wall", "wine cellar barrels eye level blur"],
                "prompt": "blurred oak barrels and stone cellar wall, empty center for bottle",
            },
            {
                "name_zh": "私人吧台",
                "unsplash": ["marble bar counter warm liquor shelf", "luxury home bar marble eye level"],
                "prompt": "marble private bar counter, warm liquor shelf backdrop, empty center",
            },
            {
                "name_zh": "暗色岩石",
                "unsplash": ["dark wet stone slab surface", "rough dark stone with water stain"],
                "prompt": "dark rough stone slab with slight water stain, empty center",
            },
        ],
        "decor": ["crystal glass with ice ball", "wheat or grapes", "subtle cold mist"],
        "lighting": "must use backlight through liquid, weak front fill for label readability",
    },
    "保健品": {
        "label_zh": "保健品（维生素/鱼油/人参等）",
        "tone": "科技活性、天然萃取、安全信赖、生命力",
        "bg_source": "unsplash",
        "palettes": [
            {"name": "医学科技蓝", "colors": ["亮白", "科技蓝"], "hint": "clinical white pure tech blue"},
            {"name": "生命草本绿", "colors": ["草绿", "淡黄"], "hint": "herb green soft yellow natural"},
            {"name": "活力维他命", "colors": ["亮橙", "白"], "hint": "vitamin orange white energetic"},
        ],
        "scenes": [
            {
                "name_zh": "科研微观",
                "unsplash": ["lab beakers blue reflection blur", "clean laboratory glassware bokeh"],
                "prompt": "blurred lab beakers with clean blue reflections, empty center",
            },
            {
                "name_zh": "阳光森林",
                "unsplash": ["sunlight leaf shadow bokeh abstract", "forest light beams soft bokeh no landscape"],
                "prompt": "soft golden leaf-shadow bokeh and sunbeams abstract (not full forest landscape), empty center",
            },
            {
                "name_zh": "三维活性空间",
                "unsplash": ["white minimal studio soft bubbles", "clean white abstract science space"],
                "prompt": "clean white minimal space with soft molecular bubble accents, empty center",
            },
        ],
        "decor": ["DNA helix soft ghost", "glowing energy orbs", "raw ingredients like ginseng fish"],
        "lighting": "bright shadowless diffuse light, local gold or blue micro glow accents",
    },
}


def list_category_keys() -> List[str]:
    return list(CATEGORY_KEYS)


def get_guideline(category_key: str) -> Dict[str, Any]:
    key = (category_key or "").strip()
    if key not in DESIGN_GUIDELINES:
        key = "快消品_日用品"
    return DESIGN_GUIDELINES[key]


def catalog_brief_for_llm() -> str:
    """给 DeepSeek 的精简目录（路由用）。"""
    lines = []
    for key in CATEGORY_KEYS:
        g = DESIGN_GUIDELINES[key]
        pals = " / ".join(
            f"{i}:{p.get('name')}({','.join(p.get('colors') or [])})"
            for i, p in enumerate(g.get("palettes") or [])
        )
        scs = " / ".join(
            f"{i}:{s.get('name_zh')}" for i, s in enumerate(g.get("scenes") or [])
        )
        lines.append(f"- {key}: {g['label_zh']}｜调性:{g['tone']}｜色板[{pals}]｜场景[{scs}]")
    return "\n".join(lines)


# 用户中文提示 → 强制英文视觉词（本地，不依赖模型）
# 更长短语优先；未列出的词不会被「目录默认」偷偷补上
_USER_WORD_MAP = [
    (("蓝天草地",), "blue sky green grass field"),
    (("蓝天白云",), "blue sky white clouds"),
    (("蓝天",), "blue sky"),
    (("白云",), "white clouds"),
    (("草地", "草坪", "绿草", "草甸"), "green grass lawn field"),
    (("天空",), "blue sky"),
    (("米色", "米白", "奶油", "燕麦", "卡其"), "warm beige cream oatmeal soft neutrals"),
    (("浅色系", "浅色", "淡色", "轻盈色"), "light pastel soft pale bright airy tones"),
    (("暖光", "柔光", "暖柔光", "柔和光"), "warm soft diffused golden morning light"),
    (("温暖", "暖色", "温馨", "柔和暖"), "warm cozy soft golden morning light"),
    (("山茶花", "山茶", "茶花"), "camellia flowers"),
    (("玫瑰花", "玫瑰"), "rose flowers"),
    (("花瓣",), "flower petals"),
    (("花朵", "鲜花"), "flowers"),
    (("花海",), "many flowers blossoms"),
    (("柔顺", "柔软", "丝滑"), "silky soft gentle feel"),
    (("丝绸", "真丝", "丝缎", "缎面"), "luxurious lustrous silk satin fabric folds"),
    (("温柔", "治愈", "呵护"), "gentle tender healing calm mood"),
    (("冷色", "冰蓝", "清爽", "清凉", "冰感", "冰霜", "冰雾", "水雾", "薄荷叶", "薄荷", "凉风", "风感", "冰雪", "冰块", "凉爽"), "cool ice blue mint frost mist"),
    (("蓝色", "蓝调"), "blue tones"),
    (("风扇", "送风", "静音风"), "cool airflow breeze"),
    (("撞色", "多巴胺", "活力"), "bold color clash dopamine vibrant"),
    (("彩带", "缎带"), "colorful ribbons"),
    (("纯色", "极简", "留白"), "minimal solid color empty negative space"),
    (("大理石", "岩板"), "marble stone countertop"),
    (("木质", "原木"), "natural wood texture"),
    (("狗粮",), "dog food"),
    (("猫粮",), "cat food"),
    (("狗狗", "犬"), "dog"),
    (("狗",), "dog"),
    (("猫咪",), "cat"),
    (("猫",), "cat"),
    (("宠物",), "pet"),
]


def _phrase_to_en_parts(phrase: str) -> List[str]:
    """一段用户词可拆出多个英文视觉词（如「蓝天草地」→ sky + grass）。"""
    text = (phrase or "").strip()
    if not text:
        return []
    for keys, en in _USER_WORD_MAP:
        if text in keys or any(k == text for k in keys):
            return [en]
    ranked = []
    for keys, en in _USER_WORD_MAP:
        for k in keys:
            ranked.append((len(k), k, en))
    ranked.sort(key=lambda x: -x[0])
    parts = []
    remaining = text
    for _, k, en in ranked:
        if k and k in remaining:
            parts.append(en)
            remaining = remaining.replace(k, "｜", 1)
    if not parts:
        if text.isascii():
            return [text.lower()]
        return [text]
    # 去重保序
    out = []
    seen = set()
    for p in parts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _phrase_to_en(phrase: str) -> str:
    return ", ".join(_phrase_to_en_parts(phrase))


def user_wants_light_warm(text: str) -> bool:
    """米色/浅色/暖柔光/阳光等——画面必须偏亮暖，不能走深红暗调。"""
    keys = (
        "米色", "米白", "奶油", "燕麦", "浅色", "浅色系", "淡色", "暖光", "柔光",
        "温暖", "暖色", "温馨", "浅杏", "卡其", "阳光", "明亮", "清透",
        "beige", "cream", "oatmeal", "pastel", "warm soft", "light tone",
        "sunlight", "sunny", "bright", "airy",
    )
    t = (text or "").lower()
    return any(k.lower() in t if k.isascii() else k in (text or "") for k in keys)


def color_lock_from_user(text: str) -> str:
    """给 SD/检索用的强制色调句，用户色词优先。"""
    raw = text or ""
    parts = []
    if any(k in raw for k in ("米色", "米白", "奶油", "燕麦", "卡其", "浅杏")):
        parts.append("warm beige cream oatmeal soft neutrals")
    if any(k in raw for k in ("浅色", "浅色系", "淡色", "轻盈")):
        parts.append("bright airy light pastel pale tones")
    if any(k in raw for k in ("暖光", "柔光", "温暖", "暖色", "温馨", "阳光")):
        parts.append("warm soft diffused golden morning sunlight")
    if any(k in raw for k in ("丝绸", "真丝", "丝缎", "绸缎")):
        parts.append("lustrous beige silk satin fabric")
    if not parts and user_wants_light_warm(raw):
        parts.append("warm beige cream soft light")
    return ", ".join(parts)


# 与用户亮暖/阳光简报冲突的目录词（流程级拦截）
_CATALOG_DARK_CONFLICT = (
    "bathroom vanity", "bathroom", "vanity",
    "dark", "navy", "night", "noir", "basement", "dungeon",
    "dim ", "moody", "gothic", "black backdrop", "underexposed",
    "hallway", "corridor", "neon underground",
)


def catalog_tag_conflicts_user(tag: str, user_raw: str, light_warm: bool = False) -> bool:
    """目录补缺词是否与用户亮暖/阳光/浅色简报冲突。"""
    if not (light_warm or user_wants_light_warm(user_raw)):
        return False
    tlow = (tag or "").lower()
    return any(c in tlow for c in _CATALOG_DARK_CONFLICT)


def user_wants_nature(text: str) -> bool:
    keys = (
        "蓝天", "白云", "草地", "草坪", "绿草", "天空", "户外", "草原",
        "sky", "cloud", "grass", "lawn", "field", "meadow", "outdoor",
    )
    t = (text or "").lower()
    return any(k.lower() in t if k.isascii() else k in (text or "") for k in keys)


def expand_user_prompt_to_en(user_prompt: str) -> str:
    """只展开用户写过的词，绝不注入目录默认元素。"""
    text = (user_prompt or "").strip()
    if not text:
        return ""
    parts = []
    # 先整句命中长词
    for keys, en in _USER_WORD_MAP:
        if any(k in text for k in keys):
            parts.append(en)
    # 再按分隔符拆段，补漏
    import re

    for seg in re.split(r"[,，、;；|/]+", text):
        seg = seg.strip()
        if not seg:
            continue
        en = _phrase_to_en(seg)
        if en and en not in parts:
            # 避免重复（整句已命中时）
            if not any(en in p or p in en for p in parts):
                parts.append(en)
    for token in re_split_tokens(text):
        if token.isascii() and token.isalpha() and len(token) > 2:
            low = token.lower()
            if low not in " ".join(parts).lower():
                parts.append(low)
    seen = set()
    out = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return ", ".join(out)


def user_allows_floral(text: str) -> bool:
    keys = ("花", "玫瑰", "山茶", "花瓣", "花朵", "花海", "floral", "flower", "rose", "camellia", "petal", "bloom")
    t = (text or "").lower()
    return any(k.lower() in t if k.isascii() else k in (text or "") for k in keys)


def is_pet_theme(text: str = "", category_key: str = "", product_info: str = "") -> bool:
    """宠物目录 / 提示词含狗猫宠 → 启用单只全身动物规则。"""
    blob = f"{text or ''} {category_key or ''} {product_info or ''}"
    if "宠物" in (category_key or ""):
        return True
    keys = (
        "狗", "猫", "犬", "宠", "狗粮", "猫粮", "宠物",
        "dog", "cat", "puppy", "kitten", "pet",
    )
    t = blob.lower()
    return any(k.lower() in t if k.isascii() else k in blob for k in keys)


def re_split_tokens(text: str):
    import re
    return re.findall(r"[A-Za-z]+|[\u4e00-\u9fff]+", text or "")


def _is_cool_theme(text: str) -> bool:
    keys = (
        "清凉", "冰", "霜", "雾", "薄荷", "凉", "风", "冷", "冰蓝",
        "冰雪", "冰块", "凉爽", "mint",
        "cool", "ice", "frost", "mist", "breeze", "fresh", "fan",
    )
    t = (text or "").lower()
    return any(k.lower() in t if k.isascii() else k in (text or "") for k in keys)


def _as_studio_query(query: str, kind: str = "bg") -> str:
    """轻量后缀：不追加会改变语义的材质/花卉词。"""
    q = " ".join(str(query or "").split())
    if not q:
        return "empty soft studio backdrop" if kind == "bg" else "object close up photo"
    low = q.lower()
    if kind == "bg":
        if any(k in low for k in ("background", "backdrop", "sky", "clouds", "studio")):
            return q[:100]
        return f"{q} background photo"[:100]
    if any(k in low for k in ("close up", "closeup", "macro", "photo")):
        return q[:100]
    return f"{q} close up photo"[:100]


def build_stock_search_plan(
    user_prompt: str = "",
    intent_tags: str = "",
    category_key: str = "",
    dominant_color: str = "",
    product_info: str = "",
    scene_idx: Optional[int] = None,
    palette_idx: Optional[int] = None,
    allow_catalog_fill: bool = False,
    pure_user_only: bool = False,
) -> Dict[str, Any]:
    """
    素材检索计划（与 P1 路由对齐）：
    1) 翻译器全部有效英文词 100% 进入 user_queries / bg_queries（禁止截断丢弃）
    2) 有用户提示时默认关闭目录补缺；开启时也须冲突过滤且排在末尾
    3) pure_user_only=True：质检重试，仅用户词
    """
    from keyword_translator import translate_user_prompt_to_search_queries

    user_raw = (user_prompt or "").strip()
    pet = is_pet_theme(user_raw, category_key, product_info)
    nature = user_wants_nature(user_raw)
    light_warm = user_wants_light_warm(user_raw)
    g = get_guideline(category_key) if category_key else {}
    scenes = g.get("scenes") or []
    palettes = g.get("palettes") or []

    s_idx = 0
    if scenes:
        s_idx = int(scene_idx if scene_idx is not None else 0) % len(scenes)
    p_idx = 0
    if palettes:
        p_idx = int(palette_idx if palette_idx is not None else 0) % len(palettes)
    selected_scene = scenes[s_idx] if scenes else {}
    selected_palette = palettes[p_idx] if palettes else {}

    # 有用户提示 → 默认不补目录，防越权
    use_catalog = bool(allow_catalog_fill) and not pure_user_only and bool(user_raw)
    if not user_raw:
        use_catalog = False

    if user_raw:
        tr = translate_user_prompt_to_search_queries(user_raw)
        atom_queries: List[str] = list(tr.get("queries") or [])
        lead = (tr.get("lead") or "")[:200]
        translate_items = tr.get("items") or []

        prop_queries: List[str] = []
        animal_en = ("dog", "cat", "pet", "puppy", "kitten")
        cleaned_atoms: List[str] = []
        for q in atom_queries:
            low = q.lower()
            if pet and any(a in low.split() or f" {a} " in f" {low} " for a in animal_en):
                species = "cat" if "cat" in low or "kitten" in low else "dog"
                if not prop_queries:
                    prop_queries = [
                        f"{species} sitting full body",
                        f"{species} standing full body",
                    ]
                # 宠物词仍保留在 user_queries 全量清单里，检索走道具
                continue
            cleaned_atoms.append(q)
        # 背景用清洗后的原子词；全量清单仍含翻译器全部有效词
        bg_atoms = cleaned_atoms if cleaned_atoms else list(atom_queries)

        def _uniq(items: List[str]) -> List[str]:
            seen = set()
            out = []
            for x in items:
                x = " ".join(str(x).split())
                if x and x.lower() not in seen:
                    seen.add(x.lower())
                    out.append(x[:120])
            return out

        # 100% 保留翻译器输出（含宠物词），供确认 UI / 质检
        user_queries = _uniq(list(atom_queries))
        display_keywords = [it.get("en") for it in translate_items if (it.get("en") or "").strip()]
        display_keywords = _uniq(display_keywords)

        composed: List[str] = []
        if lead:
            composed.append(lead[:120])
        elif bg_atoms:
            composed.append(" ".join(bg_atoms)[:120])
        color_hint = (
            (dominant_color or "").strip()
            or color_lock_from_user(user_raw)
            or (selected_palette.get("hint") or "").strip()
        )
        if color_hint and composed:
            composed.append(f"{composed[0]} {color_hint}".strip()[:120])

        catalog_bg: List[str] = []
        catalog_blocked: List[str] = []
        if use_catalog and selected_scene:
            animal_words = ("dog", "cat", "pet", "puppy", "kitten", "animal")
            for tag in (selected_scene.get("unsplash") or [])[:2]:
                t = " ".join(str(tag or "").split())[:90]
                if not t:
                    continue
                tlow = t.lower()
                if any(a in tlow for a in animal_words):
                    continue
                if not user_allows_floral(user_raw) and any(
                    k in tlow for k in ("flower", "floral", "rose", "camellia", "petal")
                ):
                    continue
                if catalog_tag_conflicts_user(t, user_raw, light_warm=light_warm):
                    catalog_blocked.append(t)
                    continue
                catalog_bg.append(t)

        # 用户词绝对优先且不截断；目录仅末尾且可为空
        user_bg = _uniq(composed + bg_atoms)
        merged_bg = user_bg + [c for c in catalog_bg if c.lower() not in {x.lower() for x in user_bg}]

        _ = intent_tags

        return {
            "bg_queries": merged_bg,
            "user_queries": user_queries,
            "display_keywords": display_keywords,
            "prop_queries": _uniq(prop_queries)[:4],
            "user_lead": lead,
            "theme": "pet" if pet else ("cool" if _is_cool_theme(user_raw) else "general"),
            "strict_user": True,
            "allow_floral": user_allows_floral(user_raw),
            "use_stock": True,
            "pet_single_fullbody": pet,
            "allow_nature_bg": nature or pet,
            "catalog_fill": catalog_bg[:2],
            "catalog_blocked": catalog_blocked,
            "catalog_enabled": use_catalog,
            "light_warm": light_warm,
            "color_lock": color_lock_from_user(user_raw) or (selected_palette.get("hint") or "")[:80],
            "translate_items": translate_items,
            "scene_idx": s_idx,
            "palette_idx": p_idx,
            "scene_name": selected_scene.get("name_zh") or "",
            "scene_prompt": (selected_scene.get("prompt") or "").strip(),
            "pure_user_only": pure_user_only,
        }

    _ = (intent_tags, category_key, dominant_color, scene_idx, palette_idx, allow_catalog_fill)
    return {
        "bg_queries": [],
        "user_queries": [],
        "display_keywords": [],
        "prop_queries": [],
        "user_lead": "",
        "theme": "blank",
        "strict_user": True,
        "allow_floral": False,
        "use_stock": False,
        "pet_single_fullbody": False,
        "allow_nature_bg": False,
        "catalog_fill": [],
        "catalog_blocked": [],
        "catalog_enabled": False,
        "light_warm": False,
        "color_lock": "",
        "translate_items": [],
        "scene_idx": 0,
        "palette_idx": 0,
        "scene_name": "",
        "scene_prompt": "",
        "pure_user_only": pure_user_only,
    }


def align_palette_idx(category_key: str, user_prompt: str, llm_idx: int = 0) -> int:
    """用户颜色词优先匹配色板，避免模型乱选鼠尾草绿盖过「米色」。"""
    g = get_guideline(category_key)
    palettes = g.get("palettes") or []
    if not palettes:
        return 0
    text = user_prompt or ""
    if not text.strip():
        return int(llm_idx) % len(palettes)

    scores = []
    for i, pal in enumerate(palettes):
        blob = (pal.get("name") or "") + "：" + "、".join(pal.get("colors") or []) + (pal.get("hint") or "")
        score = 0
        # 米色/暖 → 抬暖米色/奶油，压薰衣草紫与绿植
        if any(k in text for k in ("米色", "米白", "奶油", "温暖", "暖色", "温馨", "浅色", "浅色系")):
            if any(k in blob for k in ("米", "奶油", "杏", "驼", "暖米色", "大地")):
                score += 8
            if any(k in blob for k in ("粉", "桃", "马卡龙", "暖")) and "紫" not in blob:
                score += 3
            if any(k in blob for k in ("紫", "薰衣草", "lavender")):
                score -= 6
            if any(k in blob for k in ("绿", "鼠尾草", "草木", "生态")):
                score -= 4
        if any(k in text for k in ("绿", "天然", "植物", "草本")):
            if any(k in blob for k in ("绿", "天然", "草木", "鼠尾草", "生态")):
                score += 4
        if any(k in text for k in ("粉", "甜美", "马卡龙")):
            if any(k in blob for k in ("粉", "马卡龙", "甜美")):
                score += 4
        if any(k in text for k in ("白", "灰", "极简", "科技")):
            if any(k in blob for k in ("白", "灰", "极简", "银", "黑")):
                score += 3
        # 名称直接命中
        if pal.get("name") and pal["name"] in text:
            score += 6
        scores.append((score, i))
    scores.sort(key=lambda x: (-x[0], x[1]))
    if scores[0][0] > 0:
        return scores[0][1]
    return int(llm_idx) % len(palettes)


def align_scene_idx(category_key: str, user_prompt: str, llm_idx: int = 0) -> int:
    """用户场景词优先；提到花/山茶时偏向能放植物/水感的场景。"""
    g = get_guideline(category_key)
    scenes = g.get("scenes") or []
    if not scenes:
        return 0
    text = user_prompt or ""
    if not text.strip():
        return int(llm_idx) % len(scenes)

    prefer_keys = []
    if any(k in text for k in ("浴室", "洗漱", "台面")):
        prefer_keys += ["浴室", "洗漱"]
    if any(k in text for k in ("水", "水波", "水感")):
        prefer_keys += ["水"]
    if any(k in text for k in ("磨砂", "玻璃", "植物影")):
        prefer_keys += ["磨砂", "玻璃"]
    # 丝绸/花海/山茶+米色 → 丝绸花海，不要误推浴室台
    if any(k in text for k in ("丝绸", "真丝", "丝缎", "花海")):
        prefer_keys += ["丝绸", "花海"]
    elif any(k in text for k in ("山茶", "花瓣", "花")) and any(
        k in text for k in ("米色", "温暖", "柔光", "暖光", "浅色")
    ):
        prefer_keys += ["丝绸", "花", "花瓣"]
    elif any(k in text for k in ("山茶", "花", "花瓣", "温柔", "柔顺")):
        prefer_keys += ["花", "丝绸", "水"]

    best_i, best_s = int(llm_idx) % len(scenes), -1
    for i, sc in enumerate(scenes):
        name = sc.get("name_zh") or ""
        s = sum(1 for k in prefer_keys if k in name)
        if s > best_s:
            best_s, best_i = s, i
    return best_i if best_s > 0 else int(llm_idx) % len(scenes)


def align_dominant_color(user_prompt: str, llm_color: str = "") -> str:
    text = user_prompt or ""
    if _is_cool_theme(text):
        return "ice blue mint frost"
    if any(k in text for k in ("米色", "米白", "奶油", "燕麦")):
        return "warm beige cream"
    if any(k in text for k in ("粉",)):
        return "soft pastel pink"
    if any(k in text for k in ("绿",)) and "山茶" not in text:
        return "sage green"
    if any(k in text for k in ("蓝", "冰")):
        return "ice blue"
    return (llm_color or "soft neutral").strip()[:40]


def build_unsplash_queries(
    category_key: str,
    palette_idx: int = 0,
    scene_idx: int = 0,
    dominant_color: str = "",
    user_tags: str = "",
) -> List[str]:
    g = get_guideline(category_key)
    palettes = g.get("palettes") or [{}]
    scenes = g.get("scenes") or [{}]
    palette = palettes[palette_idx % len(palettes)]
    scene = scenes[scene_idx % len(scenes)]
    color_hint = (dominant_color or palette.get("hint") or "").strip()
    user_tags = (user_tags or "").strip()
    base_tags = list(scene.get("unsplash") or ["commercial product empty stage"])
    queries = []
    # 用户词放最前；全品类统一棚拍化，避免风景/建筑检索
    if user_tags:
        queries.append(
            _as_studio_query(f"{user_tags} {color_hint} empty product stage", kind="bg")
        )
        queries.append(
            _as_studio_query(f"{user_tags} soft natural light commercial photography", kind="bg")
        )
    for tag in base_tags[:2]:
        q = f"{user_tags} {color_hint} {tag}".strip()
        queries.append(_as_studio_query(" ".join(q.split()), kind="bg"))
    if not queries:
        queries = [_as_studio_query(f"commercial empty product stage {color_hint}", kind="bg")]
    return queries[:6]


def build_background_scene_prompt(
    category_key: str,
    palette_idx: int = 0,
    scene_idx: int = 0,
    dominant_color: str = "",
    user_prompt: str = "",
    user_tags: str = "",
    output_ratio: str = "3:4",
    product_type: str = "bag_heavy",
) -> str:
    """Build provider-neutral instructions for a background-only advertising asset."""
    g = get_guideline(category_key)
    palettes = g.get("palettes") or [{}]
    scenes = g.get("scenes") or [{}]
    palette = palettes[palette_idx % len(palettes)]
    scene = scenes[scene_idx % len(scenes)]
    decor = ", ".join((g.get("decor") or [])[:3])
    color = dominant_color or palette.get("hint") or ""
    tags = (user_tags or expand_user_prompt_to_en(user_prompt) or "").strip()
    user_raw = (user_prompt or "").strip()[:80]
    creative = tags or user_raw or "clean contemporary commercial styling"
    product_zone = {
        "bag_heavy": "reserve a large clean lower-center placement region",
        "bottle_upright": "reserve a tall clean lower-center placement region",
        "flat_small": "reserve a wide clean upper-middle placement region",
    }.get(product_type, "reserve a large clean center placement region")
    text_zone = (
        "reserve a separate clean text-safe region away from the product placement region"
    )
    prompt = (
        "Create an advertising background only. "
        f"Creative direction: {creative}. "
        f"Scene: {scene.get('prompt', 'commercial empty product stage')}. "
        f"Palette: {color or 'balanced commercial palette'}. "
        f"Lighting: {g.get('lighting', 'soft natural light')}. "
        f"Optional background accents: {decor}. "
        f"Composition: {product_zone}; {text_zone}; "
        "place no important decoration inside either safe region. "
        f"Use a vertical advertising composition suitable for a {output_ratio} output ratio. "
        "Do not generate any product, package, bottle, bag, box, container, title, letters, "
        "numbers, price, readable text, logo, watermark, QR code, or barcode. "
        "Do not create duplicated packaging, a poster mockup, or a surrounding frame. "
        "Use realistic materials and a polished commercial-photography finish."
    )
    return prompt[:1100]


def describe_plan_zh(
    category_key: str,
    palette_idx: int = 0,
    scene_idx: int = 0,
) -> Dict[str, str]:
    g = get_guideline(category_key)
    palettes = g.get("palettes") or [{}]
    scenes = g.get("scenes") or [{}]
    palette = palettes[palette_idx % len(palettes)]
    scene = scenes[scene_idx % len(scenes)]
    return {
        "category_key": category_key if category_key in DESIGN_GUIDELINES else "快消品_日用品",
        "label_zh": g.get("label_zh", ""),
        "tone": g.get("tone", ""),
        "palette_name": palette.get("name", ""),
        "palette_colors": "、".join(palette.get("colors") or []),
        "scene_name": scene.get("name_zh", ""),
        "lighting": g.get("lighting", ""),
        "decor": "、".join(g.get("decor") or [])[:80],
    }
