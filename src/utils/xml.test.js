import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, decodeXmlEntities, extractRemoteItems } from './xml.js';

test('escapeXml escapes all five XML special characters', () => {
  assert.equal(
    escapeXml(`Tom & Jerry's <"show">`),
    'Tom &amp; Jerry&apos;s &lt;&quot;show&quot;&gt;'
  );
});

test('escapeXml returns an empty string for empty input', () => {
  assert.equal(escapeXml(undefined), '');
  assert.equal(escapeXml(''), '');
});

test('decodeXmlEntities decodes &amp; last so double-escaped text decodes once', () => {
  assert.equal(decodeXmlEntities('a &amp;lt; b &#39;c&#39;'), "a &lt; b 'c'");
});

test('extractRemoteItems returns decoded feedGuid/itemGuid pairs in document order', () => {
  const xml = `<rss><channel>
    <podcast:remoteItem feedGuid="f1" itemGuid="https://x.com/?a=1&amp;p=2"/>
    <podcast:remoteItem feedGuid='f2' itemGuid='i2'/>
    <podcast:remoteItem feedGuid="f3"/>
  </channel></rss>`;
  assert.deepEqual(extractRemoteItems(xml), [
    { feedGuid: 'f1', itemGuid: 'https://x.com/?a=1&p=2' },
    { feedGuid: 'f2', itemGuid: 'i2' }
  ]);
});
