import { isTauri } from '../utils/tauri'

/**
 * 解析默认 API 基础地址：
 * - 显式设置了 VITE_API_BASE_URL 时优先使用
 * - Tauri 环境：前端与 opencode 同机，直连本机端口
 * - Web 环境：使用同源 /api 前缀（vite dev 代理 / 反向代理 / Docker 部署），
 *   避免跨设备访问时请求落到访问者自己的 127.0.0.1
 */
function resolveDefaultBaseUrl(): string {
  if (isTauri()) return 'http://127.0.0.1:4096'
  return '/api'
}

/** API 基础地址 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || resolveDefaultBaseUrl()
