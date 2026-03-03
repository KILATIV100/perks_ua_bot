export type TelegramHapticImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
export type TelegramHapticNotificationType = 'error' | 'success' | 'warning';

export interface TelegramWebAppUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  allows_write_to_pm?: boolean;
}

interface TelegramMainButton {
  show: () => void;
  hide: () => void;
  setParams: (params: { text?: string; color?: string; text_color?: string; is_active?: boolean }) => void;
  onClick: (callback: () => void) => void;
  offClick: (callback: () => void) => void;
}

interface TelegramBackButton {
  show: () => void;
  hide: () => void;
  onClick: (callback: () => void) => void;
  offClick: (callback: () => void) => void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
    start_param?: string;
  };
  themeParams: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    button_color?: string;
    button_text_color?: string;
    secondary_bg_color?: string;
  };
  MainButton: TelegramMainButton;
  BackButton: TelegramBackButton;
  HapticFeedback?: {
    impactOccurred: (style: TelegramHapticImpactStyle) => void;
    notificationOccurred: (type: TelegramHapticNotificationType) => void;
  };
  ready: () => void;
  expand: () => void;
  close: () => void;
  setHeaderColor: (colorKey: 'bg_color' | 'secondary_bg_color' | string) => void;
  setBackgroundColor: (colorKey: 'bg_color' | 'secondary_bg_color' | string) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

const noop = (): void => {};

const fallbackWebApp: TelegramWebApp = {
  initData: '',
  initDataUnsafe: undefined,
  themeParams: {},
  MainButton: {
    show: noop,
    hide: noop,
    setParams: noop,
    onClick: noop,
    offClick: noop,
  },
  BackButton: {
    show: noop,
    hide: noop,
    onClick: noop,
    offClick: noop,
  },
  HapticFeedback: {
    impactOccurred: noop,
    notificationOccurred: noop,
  },
  ready: noop,
  expand: noop,
  close: noop,
  setHeaderColor: noop,
  setBackgroundColor: noop,
};

export function useTelegram() {
  const webApp = window.Telegram?.WebApp ?? fallbackWebApp;

  return {
    webApp,
    user: webApp.initDataUnsafe?.user,
    onClose: () => webApp.close(),
    tgHaptic: {
      impact: (style: TelegramHapticImpactStyle) => webApp.HapticFeedback?.impactOccurred(style),
      notification: (type: TelegramHapticNotificationType) => webApp.HapticFeedback?.notificationOccurred(type),
    },
    MainButton: webApp.MainButton,
    BackButton: webApp.BackButton,
  };
}
