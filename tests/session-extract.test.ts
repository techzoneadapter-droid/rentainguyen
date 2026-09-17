import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAssetsFromHtml,
  reconcileSessionAssets,
  sessionSurfaceFromUrl,
} from '../lib/session-extract.ts';

const UID = '61594176005919';

test('homepage HTML with Page next to the word business is not a BM', () => {
  const html = `
    {"NAME":"Bao Van","USER_ID":"${UID}"}
    {"id":"1329730833552992","name":"Dưới Những Cơn Mưa","category":"page"}
    Some copy about Facebook business tools and business.facebook.com.
  `;
  const extracted = extractAssetsFromHtml(html, UID, 'home');
  assert.deepEqual(extracted, { businesses: [], adAccounts: [], pages: [] });
});

test('Page typename stays Page; it is not also classified as BM', () => {
  const html = `
    {"__typename":"Page","id":"1329730833552992","name":"Dưới Những Cơn Mưa"}
    {"business":{"help":true},"id":"1329730833552992","name":"Dưới Những Cơn Mưa"}
  `;
  const extracted = extractAssetsFromHtml(html, UID, 'business');
  assert.equal(extracted.pages.length, 1);
  assert.equal(extracted.pages[0].id, '1329730833552992');
  assert.equal(extracted.businesses.length, 0);
});

test('explicit Business typename is kept as BM', () => {
  const html = `{"__typename":"Business","id":"123456789012345","name":"AGC Media"}`;
  const extracted = extractAssetsFromHtml(html, UID, 'business');
  assert.equal(extracted.businesses.length, 1);
  assert.equal(extracted.businesses[0].name, 'AGC Media');
});

test('generic account_id next to a person name is not an ad account', () => {
  const html = `{"account_id":"2140693549867732","name":"Bảo Vân","profile":true}`;
  const extracted = extractAssetsFromHtml(html, UID, 'ads');
  assert.equal(extracted.adAccounts.length, 0);
});

test('AdAccount typename is kept as TKQC', () => {
  const html = `{"__typename":"AdAccount","id":"act_52826761712454","name":"Bảo Vân Ads","account_status":1,"currency":"USD"}`;
  const extracted = extractAssetsFromHtml(html, UID, 'ads');
  assert.equal(extracted.adAccounts.length, 1);
  assert.equal(extracted.adAccounts[0].id, '52826761712454');
});

test('account_id with account_status is treated as TKQC', () => {
  const html = `{"account_id":"52826761712454","account_status":1,"name":"Personal Ads","currency":"USD"}`;
  const extracted = extractAssetsFromHtml(html, UID, 'ads');
  assert.equal(extracted.adAccounts.length, 1);
});

test('uid is never a BM, Page, or Ads', () => {
  const html = `
    {"__typename":"Business","id":"${UID}","name":"Me"}
    {"__typename":"Page","id":"${UID}","name":"Me"}
    {"__typename":"AdAccount","id":"${UID}","name":"Me","account_status":1}
  `;
  const extracted = extractAssetsFromHtml(html, UID, 'graphql');
  assert.equal(extracted.businesses.length, 0);
  assert.equal(extracted.pages.length, 0);
  assert.equal(extracted.adAccounts.length, 0);
});

test('same id in pages wins over businesses and ads', () => {
  const reconciled = reconcileSessionAssets({
    pages: [{ id: '1329730833552992', name: 'Dưới Những Cơn Mưa' }],
    businesses: [{ id: '1329730833552992', name: 'Dưới Những Cơn Mưa' }],
    adAccounts: [{ id: '1329730833552992', name: 'Ad account 1329730833552992' }],
  }, UID);
  assert.equal(reconciled.pages.length, 1);
  assert.equal(reconciled.businesses.length, 0);
  assert.equal(reconciled.adAccounts.length, 0);
});

test('adsmanager URL maps to ads surface, facebook.com homepage maps to home', () => {
  assert.equal(sessionSurfaceFromUrl('https://adsmanager.facebook.com/adsmanager/manage/accounts'), 'ads');
  assert.equal(sessionSurfaceFromUrl('https://www.facebook.com/'), 'home');
  assert.equal(sessionSurfaceFromUrl('https://business.facebook.com/settings'), 'business');
});
