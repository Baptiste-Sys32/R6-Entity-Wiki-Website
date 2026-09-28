/* Wiki Engine - app core: haptics gate, launch-context router input, entity note keys. Game-agnostic; shares globals. */
    const triggerHaptic = async (style = 'Medium') => {
      try {
        // Adapter storage key first (R6), legacy DBD key as fallback —
        // never hardcode one game's key in shared engine code.
        const keys = [];
        try {
          if (typeof R6_STORAGE_KEYS !== 'undefined' && R6_STORAGE_KEYS.settings) keys.push(R6_STORAGE_KEYS.settings);
        } catch { /* adapter without storage keys */ }
        keys.push('dbd_settings_v1');
        for (const key of keys) {
          const stored = localStorage.getItem(key);
          if (stored) {
            const s = JSON.parse(stored);
            if (s.hapticEnabled === false) return;
            break;
          }
        }
        if (window.Capacitor?.Plugins?.Haptics) {
          await window.Capacitor.Plugins.Haptics.impact({ style });
        }
      } catch (e) {
      }
    };
    const readLaunchContext = () => {
      try {
        const params = new URLSearchParams(window.location.search || '');
        const hasRoute = ['view', 'search', 'mode', 'tab', 'targetId', 'targetType', 'profileId', 'cosmeticId'].some((key) => params.has(key));
        const view = params.get('view') || 'home';
        const context = {};
        ['search', 'mode', 'tab', 'targetId', 'targetType', 'id', 'cosmeticId', 'scroll'].forEach((key) => {
          const value = params.get(key);
          if (value) context[key] = value;
        });
        return {
          view,
          context,
          profileId: params.get('profileId') || '',
          cosmeticId: params.get('cosmeticId') || '',
          hasRoute
        };
      } catch (error) {
        return { view: 'home', context: {}, profileId: '', cosmeticId: '', hasRoute: false };
      }
    };
    const getNoteKey = (type, id) => `${type}:${id}`;
