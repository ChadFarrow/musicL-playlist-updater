/**
 * XML text-content escaping. Mirrors RSSPlaylistGenerator.escapeXml
 * (RSSPlaylistGenerator.js:503-511).
 */
export function escapeXml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Reverse of escapeXml, used when reading values back out of published XML so
 * they round-trip to their canonical (raw) form.
 */
export function decodeXmlEntities(text) {
  if (!text) return '';
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Extract existing <podcast:remoteItem> entries from a published playlist.
 * Same regex approach as RSSPlaylistGenerator (RSSPlaylistGenerator.js:79-94).
 * Attribute values are XML-decoded back to canonical form so merge dedup keys
 * match fresh (raw) values and the XML builders escape exactly once.
 */
export function extractRemoteItems(xmlContent) {
  const items = [];
  const remoteItemRegex = /<podcast:remoteItem[^>]*\/>/g;
  let match;
  while ((match = remoteItemRegex.exec(xmlContent)) !== null) {
    const tag = match[0];
    const feedGuidMatch = tag.match(/feedGuid=["']([^"']+)["']/);
    const itemGuidMatch = tag.match(/itemGuid=["']([^"']+)["']/);
    if (feedGuidMatch && itemGuidMatch) {
      items.push({
        feedGuid: decodeXmlEntities(feedGuidMatch[1]),
        itemGuid: decodeXmlEntities(itemGuidMatch[1])
      });
    }
  }
  return items;
}
