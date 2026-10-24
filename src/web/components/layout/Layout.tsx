// F.4.99.17 — Layout
// Sidebar + Header + Content. Обёртка для всех защищённых страниц.

import type { ReactElement, ReactNode } from 'react';

import { colors, spacing } from '../../theme';
import { ToastContainer } from '../ui/Notifications';
import { CommandPalette, useSearchShortcut } from '../ui/Search';

import { Header } from './Header';
import { Sidebar } from './Sidebar';

export function Layout({ children }: { children: ReactNode }): ReactElement {
  useSearchShortcut();

  return (
    <div style={styles.root}>
      <Sidebar />
      <div style={styles.main}>
        <Header />
        <main style={styles.content}>{children}</main>
      </div>
      <ToastContainer />
      <CommandPalette />
    </div>
  );
}

const styles = {
  root: {
    display: 'flex',
    height: '100vh',
    background: colors.bg,
    color: colors.text,
    fontFamily: 'system-ui, sans-serif',
    overflow: 'hidden',
  },
  main: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minWidth: 0,
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: spacing.lg,
  },
};