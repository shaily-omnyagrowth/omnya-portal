// api/_utils/meta.js
//
// One place for the Meta Graph API version.
//
// It used to be hard-coded per call: v19.0 in six places, v21.0 in two more.
// v19.0 reached end of life on 2026-05-21. Meta does not reject calls to a
// retired version -- it silently runs them on the oldest version still
// supported -- so responses drift underneath the code without anything
// throwing, and the next forced upgrade lands with no warning.
//
// v25.0 is supported until 2028-07-29
// (developers.facebook.com/docs/graph-api/changelog/versions).
// META_GRAPH_VERSION overrides it, e.g. "v26.0", without a code change.

const DEFAULT_GRAPH_VERSION = 'v25.0';

function graphVersion() {
  const v = (process.env.META_GRAPH_VERSION || '').trim();
  return /^v\d+\.\d+$/.test(v) ? v : DEFAULT_GRAPH_VERSION;
}

// graph.facebook.com — Facebook Login tokens (pages, IG via a linked Page).
function facebookGraph(path = '') {
  return `https://graph.facebook.com/${graphVersion()}/${String(path).replace(/^\//, '')}`;
}

// graph.instagram.com — Instagram Business Login tokens.
function instagramGraph(path = '') {
  return `https://graph.instagram.com/${graphVersion()}/${String(path).replace(/^\//, '')}`;
}

// Credentials for the Instagram Business Login flow (instagram.com/oauth/...).
//
// THIS IS NOT THE FACEBOOK APP ID, and the two are not interchangeable.
//
// A Meta app that has "API setup with Instagram login" configured carries a
// SECOND, separate id -- App Dashboard -> Instagram -> API setup with
// Instagram login -> Business login settings -> "Instagram App ID". Sending
// the Facebook/Meta app id to instagram.com/oauth/authorize is answered with
//
//     Invalid Request: Request parameters are invalid: Invalid platform app
//
// on a black Instagram page the creator cannot act on. That is what the portal
// was doing: both routes read INSTAGRAM_APP_ID with a fallback chain onto
// META_APP_ID and FACEBOOK_APP_ID, and INSTAGRAM_APP_ID had been set to the
// Facebook app id -- so the fallback was not even needed to produce it.
//
// There is deliberately no fallback here. A missing Instagram app id is a
// configuration error we can name; a Facebook app id silently substituted for
// it is an error only Instagram can report, and only in that dead end.
function instagramAppCredentials() {
  const appId = (process.env.INSTAGRAM_APP_ID || '').trim();
  const appSecret = (process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '').trim();
  const facebookAppId = (process.env.FACEBOOK_APP_ID || process.env.META_APP_ID || '').trim();

  if (!appId) {
    return { error: 'INSTAGRAM_APP_ID is not set. It is the Instagram App ID from App Dashboard -> Instagram -> API setup with Instagram login, not the Facebook app ID.' };
  }
  if (facebookAppId && appId === facebookAppId) {
    return { error: 'INSTAGRAM_APP_ID is set to the Facebook app ID. Instagram Business Login needs the separate Instagram App ID from App Dashboard -> Instagram -> API setup with Instagram login (Business login settings).' };
  }
  if (!appSecret) {
    return { error: 'INSTAGRAM_APP_SECRET is not set.' };
  }
  return { appId, appSecret };
}

module.exports = {
  DEFAULT_GRAPH_VERSION,
  graphVersion,
  facebookGraph,
  instagramGraph,
  instagramAppCredentials,
};
