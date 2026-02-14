/**
 * Tests for src/utils/format.js
 *
 * Tests all formatting utility functions used throughout the frontend:
 * - formatDuration: ISO 8601 duration -> human-readable
 * - timeAgo: date -> relative time string
 * - formatViews: number -> compact view count
 * - getDateLabel: date -> Today/Yesterday/weekday/month+day
 * - parseDurationToMinutes: ISO 8601 duration -> total minutes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDuration,
  timeAgo,
  formatViews,
  getDateLabel,
  parseDurationToMinutes,
} from '../../../src/utils/format.js';

describe('formatDuration', () => {
  it('converts PT4M13S to "4:13"', () => {
    expect(formatDuration('PT4M13S')).toBe('4:13');
  });

  it('converts PT1H2M3S to "1:02:03"', () => {
    expect(formatDuration('PT1H2M3S')).toBe('1:02:03');
  });

  it('converts PT30S to "0:30"', () => {
    expect(formatDuration('PT30S')).toBe('0:30');
  });

  it('returns empty string for empty/null/undefined input', () => {
    expect(formatDuration('')).toBe('');
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });

  it('converts PT0S to "0:00"', () => {
    expect(formatDuration('PT0S')).toBe('0:00');
  });

  it('converts PT1H0M0S to "1:00:00"', () => {
    expect(formatDuration('PT1H0M0S')).toBe('1:00:00');
  });
});

describe('timeAgo', () => {
  beforeEach(() => {
    // Fix "now" to a known time for consistent testing
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-13T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for times less than 60 seconds ago', () => {
    const result = timeAgo('2026-02-13T11:59:30Z');
    expect(result).toBe('just now');
  });

  it('returns minutes ago for times 1-59 minutes ago', () => {
    const result = timeAgo('2026-02-13T11:45:00Z');
    expect(result).toBe('15m');
  });

  it('returns hours ago for times 1-23 hours ago', () => {
    const result = timeAgo('2026-02-13T07:00:00Z');
    expect(result).toBe('5h');
  });

  it('returns days ago for times 1-6 days ago', () => {
    const result = timeAgo('2026-02-11T12:00:00Z');
    expect(result).toBe('2d');
  });

  it('returns weeks for times 7+ days ago', () => {
    const result = timeAgo('2026-01-30T12:00:00Z');
    expect(result).toBe('2w');
  });
});

describe('formatViews', () => {
  it('formats small numbers as-is: 500 -> "500"', () => {
    expect(formatViews(500)).toBe('500');
  });

  it('formats thousands: 1234 -> "1.2K"', () => {
    expect(formatViews(1234)).toBe('1.2K');
  });

  it('formats millions: 1234567 -> "1.2M"', () => {
    expect(formatViews(1234567)).toBe('1.2M');
  });

  it('formats exact thousands: 1000 -> "1.0K"', () => {
    expect(formatViews(1000)).toBe('1.0K');
  });

  it('returns empty string for null/undefined', () => {
    expect(formatViews(null)).toBe('');
    expect(formatViews(undefined)).toBe('');
  });

  it('handles string input: "5678" -> "5.7K"', () => {
    expect(formatViews('5678')).toBe('5.7K');
  });
});

describe('getDateLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-13T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Today" for today\'s date', () => {
    expect(getDateLabel('2026-02-13T08:00:00Z')).toBe('Today');
  });

  it('returns "Yesterday" for yesterday\'s date', () => {
    expect(getDateLabel('2026-02-12T15:00:00Z')).toBe('Yesterday');
  });

  it('returns a weekday name for dates within the past week', () => {
    // Feb 13 is a Friday (2026). Feb 10 would be Tuesday.
    const result = getDateLabel('2026-02-10T12:00:00Z');
    // Should be a weekday name like "Tuesday"
    expect(result).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
  });

  it('returns month + day for dates older than a week', () => {
    const result = getDateLabel('2026-01-15T12:00:00Z');
    // Should be something like "January 15"
    expect(result).toContain('January');
    expect(result).toContain('15');
  });
});

describe('parseDurationToMinutes', () => {
  it('converts PT1H30M to 90', () => {
    expect(parseDurationToMinutes('PT1H30M')).toBe(90);
  });

  it('converts PT4M13S to approximately 4.22 minutes', () => {
    const result = parseDurationToMinutes('PT4M13S');
    expect(result).toBeCloseTo(4.2167, 2);
  });

  it('converts PT30S to 0.5 minutes', () => {
    expect(parseDurationToMinutes('PT30S')).toBe(0.5);
  });

  it('returns null for empty/undefined input', () => {
    expect(parseDurationToMinutes('')).toBe(null);
    expect(parseDurationToMinutes(null)).toBe(null);
    expect(parseDurationToMinutes(undefined)).toBe(null);
  });
});
