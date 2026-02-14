/**
 * Tests for src/components/VideoCard.jsx
 *
 * Tests the video card component's rendering and interactions:
 * - Renders video title and channel name
 * - Shows duration badge when duration is provided
 * - Adds "queued" class when video is in queue
 * - Calls onThumbnailClick when thumbnail is clicked
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoCard from '../../../src/components/VideoCard.jsx';

const baseVideo = {
  videoId: 'test_vid_001',
  title: 'How to Test React Components',
  channelName: 'Testing Academy',
  channelId: 'UC_test_channel',
  published: '2026-02-10T12:00:00Z',
  thumbnail: 'https://i.ytimg.com/vi/test_vid_001/mqdefault.jpg',
  description: '',
  duration: '',
  views: '0',
};

const noop = () => {};

describe('VideoCard', () => {
  it('renders video title and channel name', () => {
    render(
      <VideoCard
        video={baseVideo}
        isQueued={false}
        onThumbnailClick={noop}
        onTitleClick={noop}
        onChannelClick={noop}
      />
    );

    expect(screen.getByText('How to Test React Components')).toBeInTheDocument();
    expect(screen.getByText('Testing Academy')).toBeInTheDocument();
  });

  it('shows duration badge when duration is provided', () => {
    const videoWithDuration = { ...baseVideo, duration: 'PT4M13S' };
    render(
      <VideoCard
        video={videoWithDuration}
        isQueued={false}
        onThumbnailClick={noop}
        onTitleClick={noop}
        onChannelClick={noop}
      />
    );

    expect(screen.getByText('4:13')).toBeInTheDocument();
  });

  it('does not show duration badge when duration is empty', () => {
    render(
      <VideoCard
        video={baseVideo}
        isQueued={false}
        onThumbnailClick={noop}
        onTitleClick={noop}
        onChannelClick={noop}
      />
    );

    // No duration text should appear (no "0:00" or similar)
    expect(screen.queryByText(/^\d+:\d+/)).not.toBeInTheDocument();
  });

  it('adds "queued" class when video is in queue', () => {
    const { container } = render(
      <VideoCard
        video={baseVideo}
        isQueued={true}
        onThumbnailClick={noop}
        onTitleClick={noop}
        onChannelClick={noop}
      />
    );

    const card = container.querySelector('[data-video-id="test_vid_001"]');
    expect(card.className).toContain('queued');
  });

  it('does not have "queued" class when not in queue', () => {
    const { container } = render(
      <VideoCard
        video={baseVideo}
        isQueued={false}
        onThumbnailClick={noop}
        onTitleClick={noop}
        onChannelClick={noop}
      />
    );

    const card = container.querySelector('[data-video-id="test_vid_001"]');
    expect(card.className).not.toContain('queued');
  });

  it('calls onThumbnailClick when thumbnail is clicked', () => {
    const handleClick = vi.fn();
    const { container } = render(
      <VideoCard
        video={baseVideo}
        isQueued={false}
        onThumbnailClick={handleClick}
        onTitleClick={noop}
        onChannelClick={noop}
      />
    );

    // The thumbWrap div has the click handler, click the img inside it
    const img = container.querySelector('img');
    fireEvent.click(img);

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick).toHaveBeenCalledWith(baseVideo);
  });
});
