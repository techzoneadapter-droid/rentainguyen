/** Full scope set matching a Power Editor user token debug screen. */
export const TOKEN_FULL_SCOPES = [
  'public_profile',
  'user_friends',
  'publish_actions',
  'read_insights',
  'whitelisted_offline_access',
  'pages_show_list',
  'ads_management',
  'ads_read',
  'business_management',
  'pages_messaging',
  'business_creative_management',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_read_user_content',
  'pages_manage_ads',
  'pages_manage_posts',
  'pages_manage_engagement',
] as const;

export const TOKEN_FULL_SCOPE_LABELS: Array<[string, string]> = [
  ['public_profile', 'Profile: đọc thông tin cơ bản'],
  ['user_friends', 'Bạn bè'],
  ['publish_actions', 'Publish actions'],
  ['read_insights', 'Ads/Page: đọc Insights'],
  ['whitelisted_offline_access', 'Offline access'],
  ['pages_show_list', 'Page: liệt kê Page'],
  ['ads_management', 'Ads: quản lý chiến dịch'],
  ['ads_read', 'Ads: đọc trạng thái'],
  ['business_management', 'BM: đọc/tạo/mời người'],
  ['pages_messaging', 'Page: nhắn tin'],
  ['business_creative_management', 'Creative: quản lý asset'],
  ['pages_read_engagement', 'Page: đọc tương tác'],
  ['pages_manage_metadata', 'Page: metadata'],
  ['pages_read_user_content', 'Page: đọc nội dung user'],
  ['pages_manage_ads', 'Page: gắn ads'],
  ['pages_manage_posts', 'Page: đăng/quản lý bài'],
  ['pages_manage_engagement', 'Page: quản lý tương tác'],
];

/**
 * Scopes asked on a 3rd-party OAuth dialog.
 * Internal/removed scopes from the Power Editor screen are omitted so the dialog does not 400.
 */
export const META_OAUTH_SCOPES = [
  'public_profile',
  'read_insights',
  'pages_show_list',
  'ads_management',
  'ads_read',
  'business_management',
  'pages_messaging',
  'business_creative_management',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_read_user_content',
  'pages_manage_ads',
  'pages_manage_posts',
  'pages_manage_engagement',
] as const;

export const META_OAUTH_REQUIRED_SCOPES = [
  'business_management',
  'pages_show_list',
] as const;

export function uniqueScopes(...lists: Array<Iterable<string> | undefined>) {
  const set = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) {
      const scope = String(item || '').trim();
      if (scope) set.add(scope);
    }
  }
  return Array.from(set).sort();
}
