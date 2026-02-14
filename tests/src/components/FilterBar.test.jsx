/**
 * Tests for src/components/FilterBar.jsx
 *
 * Tests the filter bar component's rendering and interactions:
 * - Renders search input and filter chips
 * - Calls onSearchChange when typing in search
 * - Calls onTimeRangeChange and highlights active chip when clicked
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterBar from '../../../src/components/FilterBar.jsx';

describe('FilterBar', () => {
  it('renders search input and filter chips', () => {
    render(
      <FilterBar
        searchQuery=""
        onSearchChange={() => {}}
        timeRange="all"
        onTimeRangeChange={() => {}}
      />
    );

    // Should render the search input
    const searchInput = screen.getByPlaceholderText('Search videos or channels...');
    expect(searchInput).toBeInTheDocument();

    // Should render all 4 time range chips
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('This Week')).toBeInTheDocument();
    expect(screen.getByText('This Month')).toBeInTheDocument();
  });

  it('calls onSearchChange when typing in search', () => {
    const handleSearch = vi.fn();
    render(
      <FilterBar
        searchQuery=""
        onSearchChange={handleSearch}
        timeRange="all"
        onTimeRangeChange={() => {}}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search videos or channels...');
    fireEvent.change(searchInput, { target: { value: 'react tutorial' } });

    expect(handleSearch).toHaveBeenCalledTimes(1);
    expect(handleSearch).toHaveBeenCalledWith('react tutorial');
  });

  it('calls onTimeRangeChange when a chip is clicked', () => {
    const handleTimeRange = vi.fn();
    render(
      <FilterBar
        searchQuery=""
        onSearchChange={() => {}}
        timeRange="all"
        onTimeRangeChange={handleTimeRange}
      />
    );

    // Click the "This Week" chip
    fireEvent.click(screen.getByText('This Week'));

    expect(handleTimeRange).toHaveBeenCalledTimes(1);
    expect(handleTimeRange).toHaveBeenCalledWith('week');
  });

  it('highlights active chip with chipActive class', () => {
    const { container } = render(
      <FilterBar
        searchQuery=""
        onSearchChange={() => {}}
        timeRange="today"
        onTimeRangeChange={() => {}}
      />
    );

    // The "Today" button should have the active class
    const todayButton = screen.getByText('Today');
    // CSS modules will transform chipActive to something like _chipActive_xxx
    // but the class should still contain "chipActive" (or the CSS module hash)
    expect(todayButton.className).toContain('chipActive');

    // The "All" button should NOT have the active class
    const allButton = screen.getByText('All');
    expect(allButton.className).not.toContain('chipActive');
  });
});
