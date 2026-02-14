import React from 'react';
import styles from './DateSeparator.module.css';

export default function DateSeparator({ label }) {
  return (
    <div className={styles.separator}>
      {label}
    </div>
  );
}
