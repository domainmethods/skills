// Enrichment eval — extends window.__martechCore with additional fields.
// Run this AFTER martech-eval-core.js via a second evaluate_script call.
() => {
  const allScriptText = Array.from(document.querySelectorAll('script')).map(s => {
    const src = s.src || s.getAttribute('data-rocket-src') || s.getAttribute('data-src') || '';
    let decodedContent = '';
    if (src.startsWith('data:') && src.includes('base64,')) {
      try { decodedContent = atob(src.split('base64,')[1]); } catch(e) {}
    }
    return src + ' ' + (s.innerHTML || '').substring(0, 2000) + ' ' + decodedContent.substring(0, 2000);
  }).join(' ');
  const r = window.__martechCore || {};

  // --- Enrichment fields (previously SKILL.md-only, now canonical) ---

  // DataLayer sequencing — race condition detection
  r.dataLayerSequencing = (() => {
    const dl = window.dataLayer || [];
    const gtmJsIndex = dl.findIndex(item => item && item.event === 'gtm.js');
    const gtmDomIndex = dl.findIndex(item => item && item.event === 'gtm.dom');
    const gtmLoadIndex = dl.findIndex(item => item && item.event === 'gtm.load');
    const customDataPushes = dl.map((item, i) => {
      if (!item || typeof item !== 'object') return null;
      if (item.event && (item.event.startsWith('gtm.') || item.event.includes('consent'))) return null;
      const keys = Object.keys(item);
      const businessKeys = keys.filter(k =>
        /^(user_?id|user_?type|company_?name|company_?id|industry|plan_?type|tier|segment_?id|revenue|lead_?score|account_?id|buying_?stage)/i.test(k)
      );
      if (businessKeys.length > 0) return { index: i, keys: businessKeys, event: item.event || null };
      return null;
    }).filter(Boolean);
    const latePushes = customDataPushes.filter(p => gtmJsIndex >= 0 && p.index > gtmJsIndex);
    return { gtmJsIndex, gtmDomIndex, gtmLoadIndex, customDataPushes, latePushes, hasRaceCondition: latePushes.length > 0 };
  })();

  // Tracking scripts outside GTM (bypass Consent Mode)
  r.scriptsOutsideGTM = (() => {
    const trackingDomains = [
      'facebook.net', 'fbevents', 'snap.licdn.com', 'platform.twitter.com',
      'analytics.tiktok.com', 'bat.bing.com', 'hotjar.com', 'clarity.ms',
      'fullstory.com', 'heapanalytics.com', 'cdn.amplitude.com', 'cdn.segment.com',
      'js.hs-scripts.com', 'hs-analytics',
    ];
    const rogueTracking = Array.from(document.querySelectorAll('head > script[src], body > script[src]')).filter(s => {
      if (s.hasAttribute('data-gtmsrc') || s.hasAttribute('data-gtmscriptid') ||
          s.className.includes('gtm') || s.id.includes('gtm')) return false;
      const scriptType = (s.type || '').toLowerCase();
      if (scriptType && scriptType !== 'text/javascript' && scriptType !== 'module') return false;
      if (s.hasAttribute('data-cookieconsent') || s.hasAttribute('data-categories') ||
          s.className.includes('optanon') || s.hasAttribute('data-consent')) return false;
      return trackingDomains.some(d => s.src.includes(d));
    }).map(s => s.src.substring(0, 150));
    return { scripts: rogueTracking, count: rogueTracking.length };
  })();

  // YouTube iframes using youtube.com instead of youtube-nocookie.com
  r.iframeCookieRisk = Array.from(document.querySelectorAll('iframe')).filter(i =>
    i.src && i.src.includes('youtube.com/embed') && !i.src.includes('youtube-nocookie.com')
  ).map(i => i.src.substring(0, 200));

  // CRM cookie subdomain scoping
  r.crmCookieScope = (() => {
    const crmCookies = { hubspotutk: 'HubSpot', _mkto_trk: 'Marketo', messagesUtk: 'HubSpot Chat' };
    const found = {};
    for (const [name, platform] of Object.entries(crmCookies)) {
      if (document.cookie.includes(name)) found[name] = platform;
    }
    return { hostname: location.hostname, found };
  })();

  // Chatbot auto-interaction events
  r.chatAutoInteraction = (() => {
    const earlyEvents = (window.dataLayer || []).filter(item =>
      item && item.event && (item.event.includes('drift') || item.event.includes('intercom') ||
        item.event.includes('qualified') || item.event.includes('hubspot_chat') ||
        item.event.includes('chat_') || item.event.includes('message_'))
    ).map(item => item.event);
    return { earlyEventsOnLoad: earlyEvents };
  })();

  // LinkedIn Insight Tag details
  r.linkedinInsightTag = (() => {
    const hasInsightTag = allScriptText.includes('snap.licdn.com') || allScriptText.includes('_linkedin_partner_id') || allScriptText.includes('insight.min.js');
    const hasLintrkFunction = typeof window.lintrk === 'function';
    const hasConversionCall = allScriptText.includes('lintrk(') && allScriptText.includes('conversion_id');
    return { hasInsightTag, hasLintrkFunction, hasConversionCall };
  })();

  // Pardot tracking domain check
  r.pardotTracking = (() => {
    const thirdPartyPardot = r.scripts.some(s => s.includes('pi.pardot.com') || s.includes('go.pardot.com') || s.includes('cdn.pardot.com'));
    const hasPardot = thirdPartyPardot || allScriptText.includes('piAId') || allScriptText.includes('pardot');
    return { detected: hasPardot, usesThirdPartyDomain: thirdPartyPardot };
  })();

  // Google Ads Enhanced Conversions — check allScriptText AND dataLayer (Arguments-object format)
  r.googleAdsEnhanced = (() => {
    const hasGoogleAds = r.pixels.google_ads;
    const hasEnhancedConfig = allScriptText.includes('enhanced_conversions') || allScriptText.includes('user_data') || allScriptText.includes('enhanced_conversion_data') ||
      (window.dataLayer || []).some(item => {
        if (!item || typeof item !== 'object') return false;
        // Check direct config: {allow_enhanced_conversions: true}
        if (item.allow_enhanced_conversions) return true;
        // Check Arguments-object format: {"0":"config","1":"AW-xxx","2":{allow_enhanced_conversions:true}}
        if (item[0] === 'config' && item[2] && item[2].allow_enhanced_conversions) return true;
        return false;
      });
    const hasUserDataInDL = (window.dataLayer || []).some(item => {
      if (!item || typeof item !== 'object') return false;
      // Direct property format
      if (item.enhanced_conversion_data || item.user_data) return true;
      if (item.eventModel && item.eventModel.enhanced_conversion_data) return true;
      // Arguments-object format: {"0":"set","1":"user_data","2":{...}}
      if (item[0] === 'set' && item[1] === 'user_data' && item[2]) return true;
      return false;
    });
    return { hasGoogleAds, hasEnhancedConfig, hasUserDataInDL };
  })();

  // Page indexability (for thank-you page check)
  r.pageIndexability = {
    robotsMeta: document.querySelector('meta[name="robots"]')?.content || null,
    hasNoindex: (document.querySelector('meta[name="robots"]')?.content || '').includes('noindex'),
    url: location.href,
  };

  // HubSpot form embed type
  r.hubspotForms = {
    iframeEmbeds: Array.from(document.querySelectorAll('iframe[src*="share.hsforms.com"], iframe[src*="hsforms.com"]')).length,
    jsEmbeds: Array.from(document.querySelectorAll('.hbspt-form, [id*="hbspt-form"]')).length,
    hasHbsptObject: typeof hbspt !== 'undefined',
  };

  // Cloudflare Zaraz
  r.cloudflareZaraz = {
    detected: r.scripts.some(s => s.includes('/cdn-cgi/zaraz/')) || allScriptText.includes('zaraz'),
    scriptSrc: r.scripts.find(s => s.includes('/cdn-cgi/zaraz/')) || null,
  };

  // SPA framework detection
  r.spaFramework = {
    nextjs: !!document.querySelector('#__next') || typeof __NEXT_DATA__ !== 'undefined',
    nuxt: !!document.querySelector('#__nuxt') || typeof __NUXT__ !== 'undefined',
    react: !!document.querySelector('[data-reactroot], #root[data-react-helmet]'),
    angular: !!document.querySelector('[ng-app], [ng-version]'),
  };

  return r;
}
