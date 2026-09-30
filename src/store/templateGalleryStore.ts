import { useSyncExternalStore } from 'react'

/**
 * 模板画廊全局开关。
 *
 * 多个入口（EmptyState / InputToolbar / SidebarFooter）都能打开同一个画廊。
 * 调用方可提供一个 onSelect 回调：
 *   - 提供时：选中模板后把文本交给调用方（例如插入到输入框）
 *   - 未提供时：画廊内部走「复制到剪贴板 + 内联已复制反馈」
 */
type SelectHandler = (text: string) => void

interface TemplateGalleryState {
  isOpen: boolean
  onSelect: SelectHandler | null
}

class TemplateGalleryStore {
  private state: TemplateGalleryState = { isOpen: false, onSelect: null }
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): TemplateGalleryState => this.state

  private emit() {
    this.listeners.forEach(listener => listener())
  }

  open(onSelect?: SelectHandler) {
    this.state = { isOpen: true, onSelect: onSelect ?? null }
    this.emit()
  }

  close() {
    // 保留 onSelect 引用直到完全关闭，避免动画期间丢失回调
    this.state = { isOpen: false, onSelect: null }
    this.emit()
  }

  /** 选中模板时调用：若有 onSelect 走它，否则返回 false 由画廊自行复制 */
  select(text: string): boolean {
    const handler = this.state.onSelect
    if (handler) {
      handler(text)
      this.close()
      return true
    }
    return false
  }
}

export const templateGalleryStore = new TemplateGalleryStore()

export function useTemplateGalleryOpen(): boolean {
  const state = useSyncExternalStore(templateGalleryStore.subscribe, templateGalleryStore.getSnapshot)
  return state.isOpen
}
