// ============================================
// MobileHome - 移动端首页 Work/Code 双 Tab 外壳
//
// 仅在移动端视口 + home（无 session）+ 单 pane 时
// 由 ChatPane 渲染。Work 复用原 home 内容，
// Code 提供 GitHub 仓库克隆入口。
// ============================================

import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquareIcon, CodeIcon } from '../../components/Icons'
import { GitHubProjectBrowser } from './GitHubProjectBrowser'

interface MobileHomeProps {
  serverId: string
  children: ReactNode
  onStartCoding: (directory: string) => void | Promise<void>
}

type HomeTab = 'work' | 'code'

export function MobileHome({ serverId, children, onStartCoding }: MobileHomeProps) {
  const { t } = useTranslation(['chat'])
  const [activeTab, setActiveTab] = useState<HomeTab>('work')

  const tabs: { id: HomeTab; label: string; icon: ReactNode }[] = [
    { id: 'work', label: t('mobileHome.tab.work'), icon: <MessageSquareIcon className="h-4 w-4" /> },
    { id: 'code', label: t('mobileHome.tab.code'), icon: <CodeIcon className="h-4 w-4" /> },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-100">
      {/* 顶部 Tab 切换 */}
      <div className="flex shrink-0 items-center justify-center gap-1 px-4 pt-3 pb-2">
        <div role="tablist" aria-label={t('mobileHome.title')} className="flex items-center gap-1 rounded-xl bg-bg-200/60 p-1">
          {tabs.map(tab => {
            const active = tab.id === activeTab
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-5 py-1.5 text-[length:var(--fs-md)] font-medium transition-colors ${
                  active ? 'bg-bg-100 text-text-100 shadow-sm' : 'text-text-400 active:text-text-200'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab 内容 */}
      <div role="tabpanel" className="min-h-0 flex-1">
        {activeTab === 'work' ? (
          children
        ) : (
          <GitHubProjectBrowser
            serverId={serverId}
            onStartCoding={async directory => {
              await onStartCoding(directory)
            }}
          />
        )}
      </div>
    </div>
  )
}
