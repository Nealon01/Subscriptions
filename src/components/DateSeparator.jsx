import React from 'react';
import styles from './DateSeparator.module.css';

export default function DateSeparator({ label, count, collapsed, onToggle }) {
  return (
    <div
      className={`${styles.separator} ${onToggle ? styles.clickable : ''}`}
      onClick={onToggle}
    >
      {onToggle && (
        <svg
          className={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      )}
      {label}
      {count != null && <span className={styles.count}>{count}</span>}
    </div>
  );
}
