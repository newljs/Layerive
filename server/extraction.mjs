export const extractionModes = ['selection', 'clothing', 'accessory', 'pattern', 'background'];

export const extractionLabels = {
  selection: '框选提取', clothing: '服装提取', accessory: '饰品提取', pattern: '表面图案', background: '背景提取',
};

// Append these constraints to the image prompt too, so a terse vision response
// cannot silently fall back to ordinary subject cutout in a specialized mode.
export function extractionRules(mode) {
  const faithful = '保留原图目标的身份、款式、形状比例、颜色、材质、纹理、图案、标识和可见文字，不改款、不换色、不新增品牌、文字或装饰；不把截图补边当成真实内容。';
  const showcase = '输出为精致的商品橱窗展示图：主体完整清晰、居中摆正，四周留出适度空间；使用干净的暖白或浅灰中性背景、柔和棚拍光线和自然轻微接触阴影，突出材质细节；不添加橱窗玻璃、边框、展台、道具、包装、标签、价格或广告文字。';
  const rules = {
    selection: '结合框选范围、中心位置、目标完整度和补充说明识别用户最可能想提取的主体，忽略误圈入的边缘杂物；仅保留该主体，移除其余背景与干扰，清晰居中并保留合理留白，保持原图画风与可见细节。',
    clothing: `只提取服装，不提取穿戴者、皮肤、头发、首饰或场景。用户指定单件则仅保留该件；明确要求整套则有序展示整套，未指定时优先选区中央最完整的服装。把服装整理为自然舒展、端正的平铺商品展示，消除身体穿戴姿态造成的扭曲和无关褶皱，保留裁剪、结构、缝线、印花及面料特征。对少量遮挡仅按可见结构保守补全，不虚构不可见的复杂设计；大面积遮挡且无法确认款式时拒绝。${showcase}`,
    accessory: `只提取饰品或配饰，例如首饰、手表、眼镜、帽子；去掉穿戴者、皮肤、头发、服装及环境。优先用户指定的目标，未指定时选框选中心最完整的配饰；语义成对的耳环等可作为一组，不复制成额外数量。把配饰按自然产品形态摆正，有序展示，保留真实结构、金属质感、宝石颜色和精细连接。对少量遮挡保守补全，不猜造不可见设计。${showcase}`,
    pattern: '只提取物体表面的印花、标志、纹样或装饰图案，不保留承载它的衣服、杯子、包装或其他物体。校正表面透视、弯曲和褶皱，整理为正视的平面图案素材；保留原有图形、线条、文字、色彩和元素相对位置，移除载体纹理与场景光影；使用干净纯色背景，不增加新图案，不把载体当成提取主体。',
    background: '提取选区内的背景环境，保留原有建筑、地面、天空、山水及构成环境的植物和固定陈设；移除前景人物、动物、商品等遮挡主体及其专属阴影、倒影，自然补全遮挡区域。保持背景构图、透视、画风、色彩与光照连续；不要清空背景、输出孤立前景或改成白底商品图；无法看到足够环境依据时拒绝。',
  };
  return `${faithful}\n${rules[mode]}`;
}

export function extractionPlanningInstruction({ mode, hint, padded }) {
  return `你是素材提取规划助手。当前输入是用户框选区域的截图。当前场景：${extractionLabels[mode]}。${hint ? `用户补充说明：${hint}。在当前场景内优先按说明确定目标。` : '根据当前场景与框选范围判断提取意图。'}${padded ? '截图边缘有为满足比例限制产生的拉伸补边，应忽略，不属于真实主体或环境。' : ''}
${extractionRules(mode)}
详细描述目标及需要保留的可辨识细节，为图片编辑模型生成完整中文提示词。场景内没有合适目标、多个目标无法确定且不能合理成组、或目标无法可靠还原时，返回 applicable:false 和简短 reason，不要自行改成其他场景。
返回严格 JSON：{"applicable":true,"subject":"目标简短名称","edit_prompt":"完整中文提示词","reason":"判断依据或无法提取的原因"}。不要返回 Markdown。`;
}
