import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAssetsFromHtml,
  extractBusinessProfileFromHtml,
  protectKnownBusinesses,
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

test('ad account name and billing metadata stay inside the matching object', () => {
  const html = [
    '{"__typename":"AdAccount","id":"act_52826761712454","name":"Correct Ads","account_status":1,"disable_reason":0,"currency":"USD","amount_spent":"12500","balance":"3400","spend_cap":"50000","is_prepay_account":true,"timezone_name":"Asia/Ho_Chi_Minh"}',
    '{"__typename":"AdAccount","id":"act_62826761712455","name":"Other Ads","account_status":2,"currency":"VND"}',
  ].join('');
  const extracted = extractAssetsFromHtml(html, UID, 'ads');
  const account = extracted.adAccounts.find((item) => item.id === '52826761712454');
  assert.equal(account?.name, 'Correct Ads');
  assert.equal(account?.accountStatus, 1);
  assert.equal(account?.currency, 'USD');
  assert.equal(account?.amountSpent, '12500');
  assert.equal(account?.balance, '3400');
  assert.equal(account?.spendCap, '50000');
  assert.equal(account?.isPrepayAccount, true);
  assert.equal(account?.timezoneName, 'Asia/Ho_Chi_Minh');
});

test('ad account ownership, owner BM, and country are read from the matching object', () => {
  const html = '{"__typename":"AdAccount","id":"act_52826761712454","name":"Owned Ads","business_object_relationship_to_business":"OWNED","owning_business":{"id":"123456789012345","name":"Owner BM"},"country_code":"VN"}';
  const extracted = extractAssetsFromHtml(html, UID, 'ads');
  const account = extracted.adAccounts[0];
  assert.equal(account?.ownerId, '123456789012345');
  assert.equal(account?.ownership, 'owned');
  assert.equal(account?.country, 'VN');
});

test('partner/client relationship is never counted as an owned ad account', () => {
  const html = '{"__typename":"AdAccount","id":"act_62826761712455","name":"Shared Ads","relationshipToBusiness":"PARTNER_SHARED","business_owner":{"id":"223456789012346"}}';
  const extracted = extractAssetsFromHtml(html, UID, 'ads');
  assert.equal(extracted.adAccounts[0]?.ownerId, '223456789012346');
  assert.equal(extracted.adAccounts[0]?.ownership, 'client');
});

test('escaped session JSON is decoded before extracting the resource name', () => {
  const html = String.raw`{\"__typename\":\"Page\",\"id\":\"1329730833552992\",\"name\":\"Trang \\u0110\u00fang\",\"category\":\"Local Business\"}`;
  const extracted = extractAssetsFromHtml(html, UID, 'business');
  assert.equal(extracted.pages[0]?.name, 'Trang Đúng');
  assert.equal(extracted.pages[0]?.category, 'Local Business');
});

test('business profile is read from the object containing the requested BM id', () => {
  const html = [
    '{"__typename":"Business","id":"123456789012345","name":"Real Commerce","account_capacity":5,"ad_account_count":2,"page_count":1,"verification_status":"verified","timezone_id":"140","vertical":"ADVERTISING"}',
    '{"__typename":"Business","id":"223456789012346","name":"Different Business","account_capacity":10,"ad_account_count":8}',
  ].join('');
  const profile = extractBusinessProfileFromHtml(html, '123456789012345');
  assert.equal(profile?.name, 'Real Commerce');
  assert.equal(profile?.accountCapacity, 5);
  assert.equal(profile?.adAccountCount, 2);
  assert.equal(profile?.pageCount, 1);
  assert.equal(profile?.verificationStatus, 'verified');
  assert.equal(profile?.timezoneId, '140');
  assert.equal(profile?.vertical, 'ADVERTISING');
});

test('business profile reads owned account count and creation country without timezone inference', () => {
  const html = '{"__typename":"Business","id":"123456789012345","name":"Owned Commerce","owned_ad_account_count":4,"business_country_code":"US","timezone_id":"140"}';
  const profile = extractBusinessProfileFromHtml(html, '123456789012345');
  assert.equal(profile?.ownedAdAccountCount, 4);
  assert.equal(profile?.country, 'US');
});

test('business profile does not borrow the adjacent BM name', () => {
  const html = [
    '{"__typename":"Business","id":"123456789012345"}',
    '{"__typename":"Business","id":"223456789012346","name":"Wrong Neighbor"}',
  ].join('');
  const profile = extractBusinessProfileFromHtml(html, '123456789012345');
  assert.equal(profile?.name, '');
});

test('Business Settings navigation label is not accepted as a BM name', () => {
  const html = '{"name":"SETTINGS","business_id":"123456789012345","route":"business_settings"}';
  const profile = extractBusinessProfileFromHtml(html, '123456789012345');
  assert.equal(profile?.name, '');
});

test('typed Business object wins over an earlier navigation candidate', () => {
  const html = [
    '{"name":"MONETIZATION","business_id":"123456789012345","route":"monetization"}',
    '{"__typename":"Business","id":"123456789012345","name":"Actual BM Name","account_capacity":5}',
  ].join('');
  const profile = extractBusinessProfileFromHtml(html, '123456789012345');
  assert.equal(profile?.name, 'Actual BM Name');
  assert.equal(profile?.accountCapacity, 5);
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

test('known BM ids from the account list are protected from Page and Ads route noise', () => {
  const protectedAssets = protectKnownBusinesses({
    businesses: [{ id: '123456789012345', name: 'Confirmed BM' }],
    pages: [
      { id: '123456789012345', name: 'False Page' },
      { id: '223456789012346', name: 'Real Page' },
    ],
    adAccounts: [{ id: '123456789012345', name: 'False Ads' }],
  }, ['123456789012345']);
  const reconciled = reconcileSessionAssets(protectedAssets, UID);
  assert.equal(reconciled.businesses.length, 1);
  assert.equal(reconciled.businesses[0]?.name, 'Confirmed BM');
  assert.equal(reconciled.pages.length, 1);
  assert.equal(reconciled.pages[0]?.id, '223456789012346');
  assert.equal(reconciled.adAccounts.length, 0);
});

test('adsmanager URL maps to ads surface, facebook.com homepage maps to home', () => {
  assert.equal(sessionSurfaceFromUrl('https://adsmanager.facebook.com/adsmanager/manage/accounts'), 'ads');
  assert.equal(sessionSurfaceFromUrl('https://www.facebook.com/'), 'home');
  assert.equal(sessionSurfaceFromUrl('https://business.facebook.com/settings'), 'business');
});
