'use client';

import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  type ReactNode,
} from 'react';
import { Alert, Button, Snackbar } from '@mui/material';

export type NotificationSeverity = 'success' | 'info' | 'warning' | 'error';
export type NotificationAction = { label: string; onClick: () => void };
export type Notify = (
  message: string,
  severity?: NotificationSeverity,
  action?: NotificationAction,
) => void;
type Notification = {
  id: number;
  message: string;
  severity: NotificationSeverity;
  action?: NotificationAction;
};
type State = { nextId: number; queue: Notification[] };
type Event =
  | {
      type: 'show';
      message: string;
      severity: NotificationSeverity;
      action?: NotificationAction;
    }
  | { type: 'dismiss'; id: number };

export function notificationReducer(state: State, event: Event): State {
  if (event.type === 'dismiss')
    return {
      ...state,
      queue: state.queue.filter((item) => item.id !== event.id),
    };
  if (
    !event.message.trim() ||
    state.queue.some(
      (item) =>
        item.message === event.message &&
        item.severity === event.severity &&
        item.action?.label === event.action?.label,
    )
  )
    return state;
  return {
    nextId: state.nextId + 1,
    queue: [...state.queue, { ...event, id: state.nextId }],
  };
}

const NotificationContext = createContext<Notify>(() => {});
export const useNotifications = () => useContext(NotificationContext);

export function NotificationSnackbar({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: () => void;
}) {
  return (
    <Snackbar
      open
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      autoHideDuration={
        notification.severity === 'error' || notification.severity === 'warning'
          ? null
          : 6000
      }
      onClose={(_event, reason) => {
        if (reason !== 'clickaway') onDismiss();
      }}
      sx={{ maxWidth: { sm: 560 } }}
    >
      <Alert
        severity={notification.severity}
        variant="filled"
        role={
          notification.severity === 'error' ||
          notification.severity === 'warning'
            ? 'alert'
            : 'status'
        }
        sx={{ width: '100%', overflowWrap: 'anywhere', alignItems: 'center' }}
        action={
          <>
            {notification.action && (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  onDismiss();
                  notification.action?.onClick();
                }}
              >
                {notification.action.label}
              </Button>
            )}
            <Button
              color="inherit"
              size="small"
              onClick={onDismiss}
              aria-label="Dismiss notification"
            >
              Dismiss
            </Button>
          </>
        }
      >
        {notification.message}
      </Alert>
    </Snackbar>
  );
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(notificationReducer, {
    nextId: 0,
    queue: [],
  });
  const notify = useCallback<Notify>((message, severity = 'info', action) => {
    dispatch({ type: 'show', message, severity, action });
  }, []);
  const current = state.queue[0];
  return (
    <NotificationContext.Provider value={notify}>
      {children}
      {current && (
        <NotificationSnackbar
          key={current.id}
          notification={current}
          onDismiss={() => dispatch({ type: 'dismiss', id: current.id })}
        />
      )}
    </NotificationContext.Provider>
  );
}
