import React, { useCallback, useRef, useEffect } from 'react';
import styles from './FilterBar.module.css';

const TIME_RANGES = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
];

const DEBOUNCE_MS = 300;

export default function FilterBar({ searchQuery, onSearchChange, onSearchSubmit, timeRange, onTimeRangeChange, isSearching, searchSort, onSearchSortChange }) {
  const debounceRef = useRef(null);

  const handleInputChange = useCallback((e) => {
    const value = e.target.value;
    onSearchChange(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      // Immediately clear search when input is empty — no 300ms wait
      if (onSearchSubmit) onSearchSubmit(value);
    } else {
      debounceRef.current = setTimeout(() => {
        if (onSearchSubmit) onSearchSubmit(value);
      }, DEBOUNCE_MS);
    }
  }, [onSearchChange, onSearchSubmit]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className={styles.filterBar}>
      <div className={styles.searchWrapper}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search videos, channels, or descriptions..."
          value={searchQuery}
          onChange={handleInputChange}
        />
        {isSearching && <span className={styles.searchSpinner} />}
        {searchQuery && !isSearching && (
          <button
            className={styles.clearButton}
            onClick={() => {
              onSearchChange('');
              if (onSearchSubmit) onSearchSubmit('');
            }}
            aria-label="Clear search"
          >
            &times;
          </button>
        )}
      </div>
      {TIME_RANGES.map((range) => (
        <button
          key={range.value}
          className={`${styles.chip} ${timeRange === range.value ? styles.chipActive : ''}`}
          onClick={() => onTimeRangeChange(range.value)}
        >
          {range.label}
        </button>
      ))}
      {searchQuery && searchQuery.trim() && onSearchSortChange && (
        <>
          <span className={styles.sortDivider} />
          <button
            className={`${styles.chip} ${searchSort === 'date' ? styles.chipActive : ''}`}
            onClick={() => onSearchSortChange('date')}
          >
            Newest
          </button>
          <button
            className={`${styles.chip} ${searchSort === 'relevance' ? styles.chipActive : ''}`}
            onClick={() => onSearchSortChange('relevance')}
          >
            Best Match
          </button>
        </>
      )}
    </div>
  );
}
