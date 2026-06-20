import { useState } from 'react'
import { cx } from '../utils/classNames.js'
import styles from './styling/FeatureTabs.module.css'

export default function FeatureTabs({
  tabs,
  defaultTabId,
  activeTabId,
  onActiveTabChange,
  actions,
}) {
  const [internalActiveId, setInternalActiveId] = useState(
    defaultTabId ?? tabs[0]?.id,
  )
  const activeId = activeTabId ?? internalActiveId
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]

  function selectTab(id) {
    setInternalActiveId(id)
    onActiveTabChange?.(id)
  }

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <p className="ui-sectionLabel">Household board</p>
        <div className={styles.tabList} role="tablist" aria-label="Household board">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab.id === tab.id}
              aria-controls={`${tab.id}-panel`}
              id={`${tab.id}-tab`}
              onClick={() => selectTab(tab.id)}
              className={cx(
                styles.tab,
                activeTab.id === tab.id ? styles.tabActive : '',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
      <div
        id={`${activeTab.id}-panel`}
        role="tabpanel"
        aria-labelledby={`${activeTab.id}-tab`}
        className={styles.panel}
      >
        {activeTab.content}
      </div>
    </section>
  )
}
