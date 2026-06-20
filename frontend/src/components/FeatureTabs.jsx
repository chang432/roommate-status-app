import { useState } from 'react'
import { cx } from '../utils/classNames.js'
import styles from './styling/FeatureTabs.module.css'

export default function FeatureTabs({ tabs, defaultTabId }) {
  const [activeId, setActiveId] = useState(defaultTabId ?? tabs[0]?.id)
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]

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
              onClick={() => setActiveId(tab.id)}
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
