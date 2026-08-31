import type { NormalizedSequenceResult } from '../../types/poster-generation'

export const PROVIDER_CONSENT_TEXT =
  '我已知晓并同意：上传的商品参考图将发送至火山引擎方舟 Seedream，用于顺序生成三张完整广告海报。'

export function overallStatusMessages(result: NormalizedSequenceResult) {
  const completed = result.completedPosterCount
  if (result.status === 'queued') {
    return ['任务排队中…', '正在为您加急生成中，请耐心等待哦~']
  }
  if (result.status === 'running') {
    const primary = result.currentPosterIndex
      ? `正在生成第 ${result.currentPosterIndex} / 3 张海报…`
      : `已完成 ${completed} / 3 张，准备下一张…`
    return [primary, '正在为您加急生成中，请耐心等待哦~']
  }
  if (result.status === 'completed') {
    return ['三张海报已全部生成完成']
  }
  if (result.status === 'failed' || result.status === 'partial_failed') {
    const messages = [
      `生成结束（${result.status}），已完成 ${completed} / 3 张`,
    ]
    if (result.safeErrorCode) {
      messages.push(
        `顺序生成失败（${result.safeErrorCode}）。请检查设置后重新生成。`,
      )
    }
    return messages
  }
  if (result.status === 'interrupted') {
    return [
      `任务中断，已完成 ${completed} / 3 张`,
      '后端在生成过程中重启，任务已中断；已完成的海报仍可下载。',
    ]
  }
  return [`状态：${result.rawStatus}｜已完成 ${completed} / 3`]
}
