// public/oauth-complete.js
//
// Runs on /oauth-complete.html, where every OAuth callback redirects to
// (api/_utils/oauth.js -> finishOAuth). A plain file, not a bundle: it has to
// work with no build step and under `script-src 'self'`.
//
// TWO WAYS THIS PAGE GETS OPENED
//
//   popup      The portal opened the provider in a popup and is still sitting
//              in its own tab. Tell that tab what happened, then close.
//   full page  The popup was blocked, so the portal navigated itself to the
//              provider. There is no other tab; carry on to the portal.
//
// The page cannot simply look at window.opener to tell which: the portal is
// served with Cross-Origin-Opener-Policy: same-origin, so the opener link is
// severed the moment the popup visits the provider and it is null here either
// way. Instead the result is announced on a BroadcastChannel (scoped by origin,
// not by opener) and the portal ACKS it. An ack means a portal tab is
// listening, so this is a popup. Silence means full page.
//
// Nothing from the query string is ever written as HTML — textContent only.

(function () {
  'use strict';

  var CHANNEL = 'omnya-oauth';
  var STORAGE_KEY = 'omnya_oauth_result';
  var ACK_WAIT_MS = 1500;

  var PLATFORMS = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' };

  // What the creator can actually do about each failure. Keyed by the part of
  // the code after the platform prefix (tiktok_token_failed -> token_failed).
  var HINTS = {
    auth_denied: 'The sign-in was cancelled, or access was not granted. Try again and choose Allow / Continue on every screen.',
    missing_params: 'The provider sent you back without an authorization code. Please start the connection again from the portal.',
    invalid_state: 'This sign-in link expired or was already used. Links are valid for 10 minutes — start again from the portal.',
    misconfigured: 'This platform is not fully set up on our side yet. Please let your account manager know.',
    token_failed: 'The provider refused to complete the sign-in. This is almost always a configuration issue on our side — please let your account manager know.',
    token_exchange_failed: 'The provider refused to complete the sign-in. This is almost always a configuration issue on our side — please let your account manager know.',
    encryption_failed: 'We could not store the connection securely, so nothing was saved. Please let your account manager know.',
    storage_failed: 'The sign-in worked but we could not save it. Please try again in a moment.',
    server_error: 'Something went wrong on our side. Please try again in a moment.'
  };

  function $(id) { return document.getElementById(id); }

  var params = new URLSearchParams(window.location.search);
  var rawPlatform = String(params.get('platform') || '').toLowerCase();
  var platform = Object.prototype.hasOwnProperty.call(PLATFORMS, rawPlatform) ? rawPlatform : null;
  var label = platform ? PLATFORMS[platform] : 'your account';
  var error = String(params.get('error') || '').replace(/[^a-z0-9_]/gi, '').slice(0, 64);
  var ok = params.get('status') === 'success' && !error;

  // Where the portal picks the result up in the full-page flow.
  var portalQs = new URLSearchParams({ page: 'social-connections' });
  if (ok) portalQs.set('connected', platform || 'account');
  else portalQs.set('error', error || 'unknown_error');
  if (!ok && platform) portalQs.set('platform', platform);
  var portalUrl = '/?' + portalQs.toString();

  // ---- render ---------------------------------------------------------------
  $('returnLink').setAttribute('href', portalUrl);

  if (ok) {
    $('icon').textContent = '✅';
    $('title').textContent = label + ' connected';
    $('message').textContent = 'Your ' + label + ' account is linked. Taking you back to the portal…';
    document.title = 'Connected — Omnya Portal';
  } else {
    var key = platform && error.indexOf(platform + '_') === 0 ? error.slice(platform.length + 1) : error.replace(/^meta_/, '');
    $('icon').textContent = '⚠️';
    $('title').textContent = 'We couldn’t connect ' + label;
    $('message').textContent = 'Nothing was changed on your account. You can go back to the portal or try again.';
    $('hint').textContent = HINTS[key] || 'Please try again. If it keeps happening, let your account manager know.';
    $('hint').hidden = false;
    if (error) { $('code').textContent = 'Reference: ' + error; $('code').hidden = false; }
    $('retryBtn').hidden = false;
    document.title = 'Connection problem — Omnya Portal';
  }

  // ---- report ---------------------------------------------------------------
  var result = {
    type: 'oauth_result',
    platform: platform,
    status: ok ? 'success' : 'error',
    error: ok ? null : (error || 'unknown_error'),
    at: Date.now()
  };

  var acked = false;
  var channel = null;

  function tryClose() {
    try { window.close(); } catch (e) { /* not script-closable */ }
    // Still here a moment later: the browser would not let us close it.
    setTimeout(function () {
      $('message').textContent = ok
        ? 'All done. You can close this window and go back to the portal tab.'
        : 'You can close this window and try again from the portal tab.';
      $('retryBtn').hidden = true;
      $('returnLink').textContent = 'Open the portal here instead';
    }, 400);
  }

  function onAck() {
    if (acked) return;
    acked = true;
    // A portal tab heard us, so this is the popup. It shows the outcome — and
    // its own Try Again, which has the user gesture a new popup needs.
    tryClose();
  }

  try {
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = function (ev) {
        if (ev && ev.data && ev.data.type === 'oauth_ack') onAck();
      };
      channel.postMessage(result);
    }
  } catch (e) { channel = null; }

  // Belt and braces for browsers without BroadcastChannel: other same-origin
  // tabs get a `storage` event. Also lets the portal pick the result up if it
  // was mid-reload when the broadcast went out.
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result)); } catch (e) { /* private mode */ }
  try {
    window.addEventListener('storage', function (ev) {
      if (ev.key === STORAGE_KEY + '_ack') onAck();
    });
  } catch (e) { /* ignore */ }

  // Nobody answered: there is no portal tab, this IS the tab. Success goes
  // straight home; an error stays put so it can be read, with both ways out.
  setTimeout(function () {
    if (acked) return;
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    if (ok) window.location.replace(portalUrl);
  }, ACK_WAIT_MS);

  $('retryBtn').addEventListener('click', function () {
    var qs = new URLSearchParams({ page: 'social-connections' });
    if (platform) qs.set('retry', platform);
    window.location.assign('/?' + qs.toString());
  });
})();
