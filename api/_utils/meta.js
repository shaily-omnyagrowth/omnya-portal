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

module.exports = {
  DEFAULT_GRAPH_VERSION,
  graphVersion,
  facebookGraph,
  instagramGraph,
};
