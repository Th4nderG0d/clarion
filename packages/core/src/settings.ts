/**
 * Deep-link helpers for showing the system Settings app when permission
 * errors surface with `openSettings: true`. RN provides `Linking.openSettings()`;
 * we wrap it so callers don't need to import RN themselves and so we can
 * degrade gracefully when running outside RN (e.g. unit tests).
 */

interface LinkingLike {
  openSettings: () => Promise<void>;
}

const loadLinking = (): LinkingLike | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native').Linking as LinkingLike;
  } catch {
    return null;
  }
};

/**
 * Opens the host app's entry in the system Settings app (iOS Settings → your
 * app's permission row; Android Settings → Apps → your app).
 *
 * Returns `true` when the deep link succeeded, `false` when RN's `Linking`
 * module isn't available (e.g. running in a Node test).
 *
 * Typical use:
 * ```ts
 * engine.on(e => {
 *   if (e.type === 'error' && e.error.openSettings) {
 *     showAlert(e.error.userMessage ?? e.error.message, {
 *       primary: { label: 'Open Settings', onPress: () => openAppSettings() }
 *     });
 *   }
 * });
 * ```
 */
export const openAppSettings = async (): Promise<boolean> => {
  const linking = loadLinking();
  if (!linking) return false;
  try {
    await linking.openSettings();
    return true;
  } catch {
    return false;
  }
};
