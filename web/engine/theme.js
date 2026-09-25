/* Wiki Engine - theming: color modes, rarity glow helper. Game-agnostic; shares globals. */
    const COLOR_MODES = {
      dark: {
        bg01: '#07090f',
        bg02: '#10141f',
        panel: 'rgba(255, 255, 255, 0.045)',
        stroke: 'rgba(255, 255, 255, 0.11)',
        chip: 'rgba(255, 255, 255, 0.065)',
        text: '#e5e7eb',
        muted: '#94a3b8',
        nav: 'rgba(8, 10, 16, 0.92)',
        glass: '#141821',
        ghost: 'rgba(255, 255, 255, 0.05)',
        ghostStrong: 'rgba(255, 255, 255, 0.16)',
        shadowSoft: '0 8px 30px rgba(0, 0, 0, 0.35)',
        shadowStrong: '0 16px 60px rgba(0, 0, 0, 0.45)',
        appShellBg: 'linear-gradient(180deg, #07090f, #10141f)',
        ambientGlow: 'radial-gradient(120% 120% at 20% 20%, rgba(56, 189, 248, 0.08), transparent 55%)',
        ambientOpacity: '0.35',
        selectionBg: 'rgba(56, 189, 248, 0.2)',
        selectionText: '#ffffff',
        accent: '#fafafa',
        accentSoft: 'rgba(250, 250, 250, 0.14)'
      },
      light: {
        bg01: '#ffffff',
        bg02: '#ffffff',
        panel: '#ffffff',
        stroke: '#c8ccd1',
        chip: '#f8f9fa',
        text: '#202122',
        muted: '#54595d',
        nav: '#ffffff',
        glass: '#f8f9fa',
        ghost: 'rgba(0, 24, 73, 0.027)',
        ghostStrong: 'rgba(0, 24, 73, 0.082)',
        shadowSoft: '0 1px 3px rgba(0, 0, 0, 0.08)',
        shadowStrong: '0 4px 16px rgba(0, 0, 0, 0.16)',
        appShellBg: '#ffffff',
        ambientGlow: 'none',
        ambientOpacity: '0',
        selectionBg: 'rgba(51, 102, 204, 0.22)',
        selectionText: '#202122',
        accent: '#3366cc',
        accentSoft: 'rgba(51, 102, 204, 0.12)'
      },
      oled: {
        bg01: '#000000',
        bg02: '#000000',
        panel: 'rgba(233, 225, 210, 0.03)',
        stroke: 'rgba(233, 225, 210, 0.14)',
        chip: 'rgba(233, 225, 210, 0.045)',
        text: '#eae8e2',
        muted: '#8f8a80',
        nav: 'rgba(0, 0, 0, 0.95)',
        glass: '#0a0a0a',
        ghost: 'rgba(233, 225, 210, 0.04)',
        ghostStrong: 'rgba(233, 225, 210, 0.14)',
        shadowSoft: '0 8px 30px rgba(0, 0, 0, 0.5)',
        shadowStrong: '0 16px 60px rgba(0, 0, 0, 0.6)',
        appShellBg: '#000000',
        ambientGlow: 'radial-gradient(120% 120% at 20% 0%, rgba(250, 250, 250, 0.035), transparent 55%)',
        ambientOpacity: '0.3',
        selectionBg: 'rgba(56, 189, 248, 0.2)',
        selectionText: '#ffffff',
        accent: '#fafafa',
        accentSoft: 'rgba(250, 250, 250, 0.14)'
      }
    };
    const RARITY_GLOWS = {
      common: 'rgba(255,255,255,0.10)',
      uncommon: 'rgba(255,255,255,0.16)',
      rare: 'rgba(255,255,255,0.22)',
      veryrare: 'rgba(255,255,255,0.28)',
      ultrarare: 'rgba(255,255,255,0.36)',
      visceral: 'rgba(255,255,255,0.36)',
      event: 'rgba(255,255,255,0.28)',
    };
    const getRarityGlow = (rarity, enabled = true) => {
      if (!enabled) return 'none';
      const r = (rarity || '').toLowerCase();
      const color = RARITY_GLOWS[r] || RARITY_GLOWS.common;
      return `0 0 12px ${color}, 0 0 4px ${color}`;
    };
