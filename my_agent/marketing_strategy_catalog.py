# coding: utf-8
"""Product-category marketing strategies (from Desktop/AI「不同产品的营销策略」).

After poster generation, the system classifies the product and returns the
matched strategy block for the UI.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


CATEGORY_ORDER = (
    "fmcg",
    "durable",
    "service",
    "digital",
    "luxury",
    "b2b",
    "health",
)

STRATEGY_CATALOG: Dict[str, Dict[str, Any]] = {
    "fmcg": {
        "id": "fmcg",
        "name": "快消品",
        "examples": "日化、零食、饮料、日用品（如矿泉水、护肤品、速食、洗衣液）",
        "traits": [
            "复购极高、客单价低",
            "决策时间几秒到几分钟",
            "同质化严重，依赖渠道铺货",
        ],
        "tactics": [
            "渠道为王：商超、便利店、电商货架、自动售货机全覆盖，让用户随手能买到。",
            "高频促销：第二件半价、满减、组合装、临期打折，拉高单次购买量。",
            "短视频种草+明星/达人广告：TVC、抖音、网红测评洗脑曝光，打造品牌记忆。",
            "包装差异化：颜值与便携设计吸引冲动消费。",
        ],
        "one_liner": "低价高频快消：拼铺货和广告洗脑。",
    },
    "durable": {
        "id": "durable",
        "name": "耐用品",
        "examples": "家电、家具、手机、数码硬件（冰箱、电脑、耳机）",
        "traits": [
            "复购周期 1~5 年、客单价高",
            "决策周期长",
            "看重参数、售后与性价比",
        ],
        "tactics": [
            "专业测评背书：科技博主、测评机构拆解参数，对比竞品优势。",
            "线下体验店：商场专柜真机试用，降低决策顾虑。",
            "大促集中放量：618、双11 降价+以旧换新+分期免息。",
            "售后保障营销：延保、全国联保、上门维修作为核心卖点。",
        ],
        "one_liner": "高价低频实物：拼测评、体验、大促优惠。",
    },
    "service": {
        "id": "service",
        "name": "服务类产品",
        "examples": "保洁、外卖、医美、培训、咨询",
        "traits": [
            "无实物交付，靠体验、口碑、专业度取胜",
            "边际成本低",
        ],
        "tactics": [
            "低价体验引流：9.9 元体验课、上门保洁首单半价，先获客再转化长期套餐。",
            "口碑裂变：老客推荐返现、赠送服务时长。",
            "案例展示：培训上岸、医美前后对比、咨询成功案例增强信任。",
            "标准化套餐打包：月度/年度会员锁定长期收入。",
        ],
        "one_liner": "服务产品：拼体验引流、口碑裂变与案例信任。",
    },
    "digital": {
        "id": "digital",
        "name": "虚拟数字化产品",
        "examples": "API、AI 工具、课程、软件、会员",
        "traits": [
            "0 仓储成本、可无限复制",
            "研发成本高，使用门槛分新手/专业用户",
        ],
        "tactics": [
            "免费额度试用：新用户送算力/Token/会员时长，先体验再付费。",
            "分层定价：免费版、个人版、企业版阶梯收费。",
            "开发者/教程生态：实操案例与文档降低门槛。",
            "渠道分销：博主、技术 UP 主推广返佣。",
        ],
        "one_liner": "虚拟软件工具：拼免费试用+教程生态。",
    },
    "luxury": {
        "id": "luxury",
        "name": "奢侈品/高端礼品",
        "examples": "大牌箱包、腕表、高端酒水、珠宝礼盒、大牌香水",
        "traits": [
            "价格不依托成本，核心是身份与社交属性",
            "拒绝低价促销",
        ],
        "tactics": [
            "稀缺限量：限定款、限量发售，制造溢价。",
            "高端场景投放：高端商圈、杂志、名人圈层营销。",
            "杜绝打折：靠礼盒、定制服务提升附加值。",
            "故事营销：品牌历史、工艺文化塑造价值感。",
        ],
        "one_liner": "高端奢侈品：拼稀缺和品牌价值。",
    },
    "b2b": {
        "id": "b2b",
        "name": "工业B端产品",
        "examples": "设备、原材料、企业系统、服务器算力",
        "traits": [
            "采购方是企业，决策人多",
            "单客成交额极高，周期极长",
        ],
        "tactics": [
            "商务直销为主：销售团队上门对接，定制化方案报价。",
            "样板案例营销：展示同行头部企业合作案例。",
            "招投标渠道：入驻政企采购平台，参与公开竞标。",
            "长期运维绑定：售后运维、技术升级锁定长期合作。",
        ],
        "one_liner": "企业B端产品：拼商务对接和标杆案例。",
    },
    "health": {
        "id": "health",
        "name": "医疗健康类产品",
        "examples": "药品、体检、理疗、保健品",
        "traits": [
            "监管严格，不能夸大宣传",
            "用户刚需性强",
        ],
        "tactics": [
            "专业权威背书：医生、医疗机构科普推荐。",
            "科普内容营销：健康知识科普，软性植入产品。",
            "药房、医院渠道优先铺货，线上合规科普引流。",
            "套餐化健康管理：体检年卡、慢病管理套餐。",
        ],
        "one_liner": "医疗健康：拼权威背书与合规科普。",
    },
}

# (category_id, weight, keywords)
# Prefer concrete product nouns over vague adjectives. Longer, more specific
# terms should generally carry higher weights so sparse FMCG terms do not win
# on accidental substring collisions.
_KEYWORD_RULES: List[Tuple[str, int, Tuple[str, ...]]] = [
    (
        "fmcg",
        2,
        (
            "洗衣液",
            "柔顺剂",
            "洗护",
            "日化",
            "洗发水",
            "沐浴露",
            "牙膏",
            "纸巾",
            "湿巾",
            "零食",
            "饮料",
            "矿泉水",
            "速食",
            "方便面",
            "护肤",
            "护肤品",
            "面霜",
            "精华液",
            "面膜",
            "口红",
            "唇膏",
            "彩妆",
            "洗面奶",
            "柔护衣",
            "牛仔裙",
            "半身裙",
            "连衣裙",
            "T恤",
            "卫衣",
            "服装",
            "服饰",
            "食品",
            "饼干",
            "酸奶",
            "咖啡",
            "茶饮",
            "牛奶",
            "果汁",
            "调味",
            "酱料",
            "洗洁精",
            "清洁剂",
            "日用品",
            "美妆",
            "化妆品",
            "平价香水",
            "身体喷雾",
            "香体喷雾",
            "入门香水",
            "益智玩具",
            "宠物粮",
            "猫粮",
            "狗粮",
            "纸尿裤",
            "母婴",
            "运动鞋",
            "箱包",
            "双肩包",
        ),
    ),
    (
        "durable",
        2,
        (
            "冰箱",
            "洗衣机",
            "空调",
            "家电",
            "手机",
            "iphone",
            "华为手机",
            "小米手机",
            "电脑",
            "笔记本",
            "笔记本电脑",
            "laptop",
            "耳机",
            "蓝牙耳机",
            "音箱",
            "电视",
            "家具",
            "沙发",
            "床垫",
            "相机",
            "平板",
            "ipad",
            "路由器",
            "键盘",
            "显示器",
            "扫地机",
            "扫地机器人",
            "吸尘器",
            "洗碗机",
            "烤箱",
            "微波炉",
            "热水器",
            "打印机",
            "投影仪",
            "数码",
            "智能手表",
            "手表",
            "手环",
            "音响",
            "游戏机",
            "无人机",
            "电动车",
            "自行车",
            "行李箱",
            "办公椅",
            "书桌",
            "灯具",
            "空气净化器",
            "净水器",
            "吹风机",
            "电动牙刷",
            "剃须刀",
            "平板电脑",
            "风扇",
            "小风扇",
            "电扇",
            "循环扇",
            "便携风扇",
            "加湿器",
            "取暖器",
            "小家电",
            "厨房电器",
            "破壁机",
            "咖啡机",
            "空气炸锅",
        ),
    ),
    (
        "service",
        2,
        (
            "保洁",
            "外卖",
            "医美",
            "培训",
            "课程咨询",
            "咨询服务",
            "家政",
            "维修上门",
            "上门维修",
            "摄影跟拍",
            "设计服务",
            "代运营",
            "上门服务",
            "家政服务",
            "维修服务",
            "摄影服务",
            "装修",
            "搬家",
            "洗车",
            "美容美发",
            "美甲",
            "外卖配送",
            "跑腿",
            "代驾",
            "顾问",
            "体验课",
            "私教",
            "陪练",
            "上门保洁",
            "月嫂",
            "保姆",
        ),
    ),
    (
        "digital",
        2,
        (
            "软件",
            "saas",
            "api",
            "会员订阅",
            "订阅制",
            "网课",
            "ai工具",
            "ai 工具",
            "插件",
            "app订阅",
            "云计算",
            "token",
            "数字人",
            "小程序",
            "应用程序",
            "在线课程",
            "知识付费",
            "视频会员",
            "流媒体",
            "云盘",
            "云服务",
            "开发者工具",
            "自动化工具",
            "chatgpt",
            "大模型",
            "生成式ai",
            "绘图软件",
            "设计软件",
            "剪辑软件",
            "虚拟产品",
            "数字产品",
            "软件会员",
            "ai绘画",
            "绘画工具",
            "办公软件",
            "效率工具",
            "在线工具",
        ),
    ),
    (
        "luxury",
        3,
        (
            "奢侈",
            "奢侈品",
            "大牌",
            "腕表",
            "手表限量",
            "珠宝",
            "钻石",
            "黄金首饰",
            "高端礼盒",
            "lv",
            "hermes",
            "爱马仕",
            "香奈儿",
            "chanel",
            "香水",
            "香氛",
            "淡香水",
            "调香",
            "木质调",
            "香调",
            "大牌香水",
            "高端香水",
            "香水礼盒",
            "茅台",
            "礼品定制",
            "限量款",
            "限量发售",
            "高端定制",
            "名表",
            "钻石项链",
            "项链礼盒",
            "珠宝礼盒",
            "高端酒",
            "红酒礼盒",
            "雪茄",
            "轻奢",
            "设计师品牌",
            "高端珠宝",
            "项链",
            "手镯",
            "耳环",
            "戒指",
            "翡翠",
        ),
    ),
    (
        "b2b",
        3,
        (
            "工业",
            "原材料",
            "服务器",
            "企业采购",
            "b端",
            "b2b",
            "oem",
            "生产线",
            "招投标",
            "erp",
            "mes",
            "算力集群",
            "企业系统",
            "企业软件",
            "供应链",
            "仓储物流",
            "工厂设备",
            "机床",
            "工控",
            "plc",
            "saas企业版",
            "对公",
            "政企",
            "解决方案",
            "批量采购",
            "行业解决方案",
        ),
    ),
    (
        "health",
        3,
        (
            "药品",
            "保健品",
            "体检",
            "理疗",
            "医疗",
            "药店",
            "维生素",
            "益生菌",
            "慢病",
            "中药",
            "护眼",
            "补钙",
            "健康管理",
            "体检套餐",
            "体检卡",
            "药店",
            "处方药",
            "非处方",
            "蛋白粉",
            "鱼油",
            "胶原蛋白",
            "口腔护理",
            "牙科",
            "康复",
            "养生",
            "中医",
            "营养补充",
            "血糖",
            "血压计",
        ),
    ),
]


_LUXURY_TIER_SIGNALS = (
    "奢侈",
    "奢侈品",
    "大牌",
    "高端",
    "限量",
    "礼盒",
    "送礼",
    "顶奢",
    "轻奢",
    "设计师品牌",
    "hermes",
    "爱马仕",
    "香奈儿",
    "chanel",
    "dior",
    "迪奥",
    "祖马龙",
    "jo malone",
    "tom ford",
    "ysl",
    "圣罗兰",
    "gucci",
    "古驰",
    "lv",
    "劳力士",
    "茅台",
)

_MASS_TIER_SIGNALS = (
    "平价",
    "入门",
    "身体喷雾",
    "香体喷雾",
    "走量",
    "快消",
    "9.9",
    "19.9",
)

_FRAGRANCE_TERMS = (
    "香水",
    "香氛",
    "淡香水",
    "调香",
    "木质调",
    "香调",
    "前调",
    "后调",
    "留香",
)


def _blob_contains_any(blob: str, terms: Tuple[str, ...]) -> bool:
    return any(term.lower() in blob for term in terms)


def _apply_fragrance_positioning_override(
    blob: str,
    best_id: str,
    scores: Dict[str, int],
    hits: Dict[str, List[str]],
) -> Tuple[str, str, List[str]]:
    """Re-tier fragrance products using luxury vs mass market signals."""
    if not _blob_contains_any(blob, _FRAGRANCE_TERMS):
        return best_id, "", hits.get(best_id, [])

    if _blob_contains_any(blob, _LUXURY_TIER_SIGNALS):
        hits.setdefault("luxury", [])
        for term in _FRAGRANCE_TERMS:
            if term.lower() in blob and term not in hits["luxury"]:
                hits["luxury"].append(term)
        return (
            "luxury",
            "香氛/香水结合大牌或高端礼盒信号，按奢侈品策略判定。",
            hits["luxury"],
        )

    if _blob_contains_any(blob, _MASS_TIER_SIGNALS):
        hits.setdefault("fmcg", [])
        return (
            "fmcg",
            "香氛/香水结合平价走量信号，按快消策略判定。",
            hits.get("fmcg", []),
        )

    if best_id == "luxury" and scores.get("luxury", 0) > 0:
        return (
            best_id,
            "香氛/香水命中高端品类词，按奢侈品策略判定。",
            hits.get("luxury", []),
        )

    if scores.get("luxury", 0) > 0 or scores.get("fmcg", 0) > 0:
        return (
            "luxury",
            "香氛/香水未明确平价信号，默认按高端礼品/品牌溢价方向参考。",
            hits.get("luxury", []) or hits.get("fmcg", []),
        )

    return best_id, "", hits.get(best_id, [])


def _score_keyword_rules(blob: str) -> Tuple[Dict[str, int], Dict[str, List[str]]]:
    scores = {key: 0 for key in CATEGORY_ORDER}
    hits: Dict[str, List[str]] = {key: [] for key in CATEGORY_ORDER}
    for category_id, weight, keywords in _KEYWORD_RULES:
        # Longer keywords first so "扫地机器人" counts before a shorter sibling.
        for word in sorted(keywords, key=len, reverse=True):
            needle = word.lower()
            if not needle or needle not in blob:
                continue
            # Prefer more specific terms: base weight + length bonus.
            term_score = weight + max(0, len(needle) - 2) // 2
            scores[category_id] += term_score
            if word not in hits[category_id]:
                hits[category_id].append(word)
    return scores, hits


def classify_product_category(
    product_info: str,
    product_short_name: str = "",
    creative_note: str = "",
) -> Dict[str, Any]:
    """Score keywords and return the best-matching strategy payload.

    Classification uses product identity text only. Creative notes describe
    visual mood for posters and must not pollute category detection.
    """
    _ = creative_note
    blob = " ".join(
        [
            str(product_info or ""),
            str(product_short_name or ""),
        ]
    ).lower()
    scores, hits = _score_keyword_rules(blob)

    # Prefer higher score; on ties prefer later, more specific categories
    # so equal FMCG/durable hits do not always collapse to FMCG.
    best_id = max(
        CATEGORY_ORDER,
        key=lambda key: (scores[key], CATEGORY_ORDER.index(key)),
    )
    best_score = scores[best_id]
    if best_score <= 0:
        # Soft default when nothing matches. Keep a usable strategy block, but
        # do not label the product as FMCG — that misleads the UI.
        best_id = "fmcg"
        confidence = "low"
        reason = (
            "未识别到明确品类关键词，暂以通用消费策略作参考；"
            "建议在产品信息中补充品类词（如手机、软件、珠宝、体检、风扇等）后重新生成。"
        )
        matched: List[str] = []
        strategy = dict(STRATEGY_CATALOG[best_id])
        strategy["name"] = "通用参考"
        strategy["one_liner"] = (
            "品类尚未明确识别：先按通用消费营销思路参考，补充品类词后可重新判定。"
        )
        return {
            "category_id": best_id,
            "category_name": "未明确品类",
            "confidence": confidence,
            "matched_keywords": matched,
            "reason": reason,
            "score": best_score,
            "strategy": strategy,
            "source": "desktop_ai_different_product_marketing_strategies",
        }

    confidence = "high" if best_score >= 8 else "medium"
    matched = hits[best_id]
    reason = f"根据关键词命中判定为「{STRATEGY_CATALOG[best_id]['name']}」。"

    override_id, override_reason, override_matched = _apply_fragrance_positioning_override(
        blob, best_id, scores, hits
    )
    if override_id != best_id:
        best_id = override_id
        best_score = max(best_score, scores.get(best_id, 0), 6)
        matched = override_matched
        reason = override_reason or reason
        confidence = "medium" if confidence == "low" else confidence

    strategy = dict(STRATEGY_CATALOG[best_id])
    return {
        "category_id": best_id,
        "category_name": strategy["name"],
        "confidence": confidence,
        "matched_keywords": matched,
        "reason": reason,
        "score": best_score,
        "strategy": strategy,
        "source": "desktop_ai_different_product_marketing_strategies",
    }


def strategy_for_category(category_id: str) -> Optional[Dict[str, Any]]:
    item = STRATEGY_CATALOG.get(category_id)
    return dict(item) if item else None
