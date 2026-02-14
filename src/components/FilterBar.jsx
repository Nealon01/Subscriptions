import React from 'react';
import styles from './FilterBar.module.css';

const TIME_RANGES = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
];

export default function FilterBar({ searchQuery, onSearchChange, timeRange, onTimeRangeChange }) {
  return (
    <div className={styles.filterBar}>
      <input
        type="text"
        className={styles.searchInput}
        placeholder="Search videos or channels..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {TIME_RANGES.map((range) => (
        <button
          key={range.value}
          className={`${styles.chip} ${timeRange === range.value ? styles.chipActive : ''}`}
          onClick={() => onTimeRangeChange(range.value)}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
