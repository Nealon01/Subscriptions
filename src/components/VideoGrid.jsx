import React from 'react';
import styles from './VideoGrid.module.css';

export default function VideoGrid({ children, videosPerRow, density }) {
  const isGrid = videosPerRow > 1;

  const classNames = [
    styles.grid,
    isGrid ? styles.gridLayout : '',
    density === 'compact' ? styles.compact : '',
    density === 'comfortable' ? styles.comfortable : '',
  ]
    .filter(Boolean)
    .join(' ');

  const gridStyle = isGrid ? { '--videos-per-row': videosPerRow } : undefined;

  return (
    <div className={classNames} style={gridStyle}>
      {children}
    </div>
  );
}
