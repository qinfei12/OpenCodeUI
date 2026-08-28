import { useMemo, useState, useCallback, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../components/ui/Dialog'
import {
  SparklesIcon,
  SearchIcon,
  CodeIcon,
  WrenchIcon,
  CheckIcon,
  EyeIcon,
  PencilIcon,
  LayersIcon,
  GitCommitIcon,
  CloseIcon,
  type IconProps,
} from '../../components/Icons'
import { templateGalleryStore, useTemplateGalleryOpen } from '../../store/templateGalleryStore'

// ============================================
// 模板定义
// ============================================
// 每个模板带一个语义渐变，复用 index.css 的 --grad-* 令牌，
// 保证与主题一致。文案走 i18n：title / desc / prompt。

type GradKey = 'brand' | 'info' | 'success' | 'warning' | 'danger'

interface TemplateDef {
  id: string
  icon: ComponentType<IconProps>
  grad: GradKey
  titleKey: string
  descKey: string
  promptKey: string
}

const TEMPLATES: TemplateDef[] = [
  {
    id: 'explain',
    icon: EyeIcon,
    grad: 'info',
    titleKey: 'templates.items.explain.title',
    descKey: 'templates.items.explain.desc',
    promptKey: 'templates.items.explain.prompt',
  },
  {
    id: 'review',
    icon: SearchIcon,
    grad: 'brand',
    titleKey: 'templates.items.review.title',
    descKey: 'templates.items.review.desc',
    promptKey: 'templates.items.review.prompt',
  },
  {
    id: 'fixBug',
    icon: WrenchIcon,
    grad: 'danger',
    titleKey: 'templates.items.fixBug.title',
    descKey: 'templates.items.fixBug.desc',
    promptKey: 'templates.items.fixBug.prompt',
  },
  {
    id: 'tests',
    icon: CheckIcon,
    grad: 'success',
    titleKey: 'templates.items.tests.title',
    descKey: 'templates.items.tests.desc',
    promptKey: 'templates.items.tests.prompt',
  },
  {
    id: 'refactor',
    icon: LayersIcon,
    grad: 'info',
    titleKey: 'templates.items.refactor.title',
    descKey: 'templates.items.refactor.desc',
    promptKey: 'templates.items.refactor.prompt',
  },
  {
    id: 'docs',
    icon: PencilIcon,
    grad: 'warning',
    titleKey: 'templates.items.docs.title',
    descKey: 'templates.items.docs.desc',
    promptKey: 'templates.items.docs.prompt',
  },
  {
    id: 'feature',
    icon: CodeIcon,
    grad: 'brand',
    titleKey: 'templates.items.feature.title',
    descKey: 'templates.items.feature.desc',
    promptKey: 'templates.items.feature.prompt',
  },
  {
    id: 'commit',
    icon: GitCommitIcon,
    grad: 'success',
    titleKey: 'templates.items.commit.title',
    descKey: 'templates.items.commit.desc',
    promptKey: 'templates.items.commit.prompt',
  },
]

const GRAD_BADGE: Record<GradKey, string> = {
  brand: 'badge-grad',
  info: 'text-info-100 bg-info-bg',
  success: 'text-success-100 bg-success-bg',
  warning: 'text-warning-100 bg-warning-bg',
  danger: 'text-danger-100 bg-danger-bg',
}

const GRAD_RING: Record<GradKey, string> = {
  brand: 'group-hover:border-accent-main-100/45',
  info: 'group-hover:border-info-100/45',
  success: 'group-hover:border-success-100/45',
  warning: 'group-hover:border-warning-100/45',
  danger: 'group-hover:border-danger-100/45',
}

// ============================================
// Component
// ============================================

export function TemplatesGallery() {
  const { t } = useTranslation(['chat', 'common'])
  const isOpen = useTemplateGalleryOpen()
  const [query, setQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return TEMPLATES
    return TEMPLATES.filter(tpl => {
      const title = t(tpl.titleKey).toLowerCase()
      const desc = t(tpl.descKey).toLowerCase()
      return title.includes(q) || desc.includes(q)
    })
  }, [query, t])

  const handlePick = useCallback(
    async (tpl: TemplateDef) => {
      const promptText = t(tpl.promptKey)
      // 若调用方提供了 onSelect（如输入框插入），交给 store 处理
      if (templateGalleryStore.select(promptText)) return

      // 否则复制到剪贴板 + 内联反馈
      try {
        await navigator.clipboard?.writeText(promptText)
      } catch {
        // 剪贴板不可用时静默失败，仍给反馈让用户知道动作已触发
      }
      setCopiedId(tpl.id)
      window.setTimeout(() => {
        setCopiedId(prev => (prev === tpl.id ? null : prev))
      }, 1600)
    },
    [t],
  )

  const handleClose = useCallback(() => {
    setQuery('')
    setCopiedId(null)
    templateGalleryStore.close()
  }, [])

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      ariaLabel={t('templates.title')}
      width="min(92vw, 640px)"
      showCloseButton={false}
      rawContent
    >
      <div className="flex min-h-0 flex-col max-h-[82vh]">
        {/* Header */}
        <div className="relative shrink-0 px-5 pt-5 pb-4 border-b border-border-100/50">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl badge-grad flex items-center justify-center shrink-0">
              <SparklesIcon size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[length:var(--fs-heading-2)] font-semibold text-text-100 leading-tight">
                {t('templates.title')}
              </h2>
              <p className="text-[length:var(--fs-sm)] text-text-400 mt-0.5">{t('templates.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label={t('common:close')}
              title={t('common:close')}
              className="shrink-0 p-2 -mr-1 text-text-400 hover:text-text-200 hover:bg-bg-200 rounded-md transition-colors"
            >
              <CloseIcon size={18} />
            </button>
          </div>

          {/* Search */}
          <div className="mt-4 relative">
            <SearchIcon
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-500 pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('templates.searchPlaceholder')}
              className="w-full pl-8 pr-3 py-2 bg-bg-200/60 border border-border-200/50 rounded-lg text-[length:var(--fs-base)] text-text-100 placeholder:text-text-500 focus:outline-none focus:border-accent-main-100/45 transition-colors"
            />
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-[length:var(--fs-sm)] text-text-500">{t('templates.noResults')}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filtered.map((tpl, index) => {
                const Icon = tpl.icon
                const copied = copiedId === tpl.id
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => handlePick(tpl)}
                    style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
                    className={`group text-left tile-interactive animate-rise-in relative flex gap-3 p-3 rounded-xl bg-bg-100/60 border border-border-200/45 ${GRAD_RING[tpl.grad]} overflow-hidden`}
                  >
                    {/* 角标渐变光（悬停时浮现） */}
                    <span
                      className={`pointer-events-none absolute -right-6 -top-6 w-16 h-16 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-xl`}
                      style={{ background: 'hsl(var(--accent-main-100) / 0.22)' }}
                    />
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${GRAD_BADGE[tpl.grad]}`}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[length:var(--fs-base)] font-medium text-text-100 truncate">
                          {t(tpl.titleKey)}
                        </span>
                      </div>
                      <p className="text-[length:var(--fs-sm)] text-text-400 mt-0.5 line-clamp-2 leading-snug">
                        {t(tpl.descKey)}
                      </p>
                    </div>
                    {copied && (
                      <span className="absolute right-2 top-2 flex items-center gap-1 text-[length:var(--fs-xxs)] font-medium text-success-100 bg-success-bg/80 px-1.5 py-0.5 rounded-md">
                        <CheckIcon size={11} />
                        {t('templates.copied')}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="shrink-0 px-5 py-2.5 border-t border-border-100/50 text-[length:var(--fs-xxs)] text-text-500 text-center">
          {t('templates.footerHint')}
        </div>
      </div>
    </Dialog>
  )
}
