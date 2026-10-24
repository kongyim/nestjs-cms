const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const {
  notificationReducer,
  NotificationSnackbar,
} = require('../dist/components/notifications');

test('messages queue in order, deduplicate pending errors, and can recur after dismissal', () => {
  let state = { nextId: 0, queue: [] };
  const error = { type: 'show', message: 'Upload failed', severity: 'error' };
  state = notificationReducer(state, error);
  assert.equal(notificationReducer(state, error), state);
  state = notificationReducer(state, {
    type: 'show',
    message: 'Saved',
    severity: 'success',
  });
  assert.deepEqual(
    state.queue.map((item) => item.message),
    ['Upload failed', 'Saved'],
  );
  state = notificationReducer(state, { type: 'dismiss', id: 0 });
  assert.equal(state.queue[0].message, 'Saved');
  state = notificationReducer(state, error);
  assert.equal(state.queue[1].id, 2);
  assert.equal(
    notificationReducer(state, { type: 'show', message: '', severity: 'info' }),
    state,
  );
  assert.equal(
    notificationReducer(state, { type: 'dismiss', id: 0 }).queue.length,
    2,
  );
});

test('snackbar uses bottom-right, dismisses explicitly, ignores clickaway and preserves retry', () => {
  let dismisses = 0;
  let retries = 0;
  const notification = {
    id: 0,
    message: 'Could not load field options',
    severity: 'error',
    action: { label: 'Retry', onClick: () => retries++ },
  };
  const element = NotificationSnackbar({
    notification,
    onDismiss: () => dismisses++,
  });
  assert.deepEqual(element.props.anchorOrigin, {
    vertical: 'bottom',
    horizontal: 'right',
  });
  assert.equal(element.props.autoHideDuration, null);
  element.props.onClose({}, 'clickaway');
  assert.equal(dismisses, 0);
  element.props.onClose({}, 'escapeKeyDown');
  assert.equal(dismisses, 1);
  const buttons = React.Children.toArray(
    element.props.children.props.action.props.children,
  );
  buttons[0].props.onClick();
  assert.equal(retries, 1);
  assert.equal(dismisses, 2);
  buttons[1].props.onClick();
  assert.equal(dismisses, 3);
  const html = renderToStaticMarkup(element);
  assert.match(html, /MuiSnackbar-anchorOriginBottomRight/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Could not load field options/);
});

test('success and informational messages auto-dismiss and announce as status', () => {
  for (const severity of ['success', 'info']) {
    const element = NotificationSnackbar({
      notification: { id: 1, message: 'Complete', severity },
      onDismiss: () => {},
    });
    assert.equal(element.props.autoHideDuration, 6000);
    assert.equal(element.props.children.props.role, 'status');
  }
});
