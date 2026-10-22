'use client';

import { useMemo, type ReactNode } from 'react';
import type { ThemeOptions } from '@mui/material/styles';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';

const theme = createTheme({
  palette: {
    primary: { main: '#3155a5' },
    background: { default: '#f5f7fb', paper: '#ffffff' },
  },
  typography: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    h4: { fontWeight: 700, fontSize: '1.75rem' },
    h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
    },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600, backgroundColor: '#f8fafc', color: '#526078' },
      },
    },
  },
});

export default function AdminTheme({
  children,
  options,
}: {
  children: ReactNode;
  options?: ThemeOptions;
}) {
  const resolved = useMemo(
    () => (options ? createTheme(theme, options) : theme),
    [options],
  );
  return (
    <ThemeProvider theme={resolved}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
