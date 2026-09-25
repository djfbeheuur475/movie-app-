import { Alert, Platform, type AlertButton } from 'react-native';

// react-native-web ships Alert.alert as a no-op, so on the web every error
// message and confirmation in the app would silently vanish. Map it onto the
// browser's own dialogs: one button → alert(), several → confirm() where OK
// runs the first non-cancel button and Cancel runs the cancel one.
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    const actions = buttons ?? [];
    if (actions.length <= 1) {
      window.alert(text);
      actions[0]?.onPress?.();
      return;
    }
    const cancel = actions.find((b) => b.style === 'cancel');
    const confirm = actions.find((b) => b.style !== 'cancel') ?? actions[0];
    if (window.confirm(text)) confirm.onPress?.();
    else cancel?.onPress?.();
  };
}
