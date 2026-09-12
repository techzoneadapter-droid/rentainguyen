import { list, owner } from '../../../lib/server';
import { getMetaTokens } from '../../../lib/meta-tokens';
import type { Asset } from '../../../lib/data';

type HealthStatus = 'LIVE' | 'DIE' | 'RESTRICTED' | 'UNKNOWN' | 'N/A';
type LifecycleStatus = 'NEW' | 'CHECKING' | 'READY' | 'BLOCKED' | 'PUSHED';

type GuideAsset = {
  id: string;
  title?: string;
  created?: string;
  crmPushStatus?: string;
  crmPushAt?: string;
  crmGuideId?: string;
  crmGuideCode?: string;
  crmPushError?: string;
};

type ResourceRow = {
  key: string;
  id: string;
  metaId?: string;
  name: string;
  type: 'BM' | 'TKQC' | 'Page' | 'Dataset/Pixel' | 'Bí kíp';
  health: HealthStatus;
  lifecycle: LifecycleStatus;
  source: string;
  sourceLabel: string;
  sourceToken?: string;
  createdAt?: string;
  checkedAt?: string;
  crmPushAt?: string;
  crmPushStatus?: string;
  lastError?: string;
  verified?: boolean;
  tier?: string;
};

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function upper(value: unknown) {
  return text(value).toUpperCase();
}

function pushed(value: unknown) {
  const normalized = text(value).toLowerCase();
  return normalized.includes('đã đẩy') || normalized.includes('pushed') || normalized.includes('success');
}

function healthOf(asset: Asset): HealthStatus {
  const raw = upper(asset.status);
  if (raw === 'LIVE' || raw.includes('TRUY CẬP ĐƯỢC') || raw.includes('HOÀN TẤT')) return 'LIVE';
  if (raw === 'DIE' || raw.includes('DISABLED') || raw.includes('VÔ HIỆU')) return 'DIE';
  if (raw.includes('HẠN CHẾ') || raw.includes('RESTRICTED') || raw.includes('CẦN KIỂM TRA QUYỀN')) return 'RESTRICTED';
  return 'UNKNOWN';
}

function lifecycleOf(asset: Asset, health: HealthStatus): LifecycleStatus {
  if (asset.crmResourceId || pushed(asset.crmPushStatus)) return 'PUSHED';
  const raw = upper(asset.status);
  if (raw.includes('ĐANG KIỂM TRA') || raw.includes('CHECKING')) return 'CHECKING';
  if (health === 'LIVE') return 'READY';
  if (asset.checked || health === 'DIE' || health === 'RESTRICTED') return 'BLOCKED';
  return 'NEW';
}

function sourceLabel(source: string) {
  if (source === 'meta') return 'Meta API';
  if (source === 'manual') return 'Thủ công';
  if (source === 'demo') return 'Dữ liệu mẫu';
  return source || 'Không rõ';
}

export async function GET() {
  try {
    const workspaceOwner = await owner();
    const [assets, guides, tokens] = await Promise.all([
      list(workspaceOwner, 'asset') as Promise<Asset[]>,
      list(workspaceOwner, 'guide_asset') as Promise<GuideAsset[]>,
      getMetaTokens(workspaceOwner),
    ]);

    const tokenByMetaUser = new Map(
      tokens
        .filter((token) => token.metaUserId)
        .map((token) => [String(token.metaUserId), token.label] as const),
    );

    const assetRows: ResourceRow[] = assets.map((asset) => {
      const health = healthOf(asset);
      const createdById = text(asset.createdById);
      const sourceToken = createdById ? tokenByMetaUser.get(createdById) : undefined;
      const lastError = health === 'LIVE'
        ? text(asset.adminInviteError)
        : text(asset.healthNote || asset.adminInviteError);

      return {
        key: `asset:${asset.id}`,
        id: asset.id,
        metaId: text(asset.metaId) || text(asset.id).split('meta:').pop() || '',
        name: asset.name || 'Tài nguyên Meta',
        type: asset.type as ResourceRow['type'],
        health,
        lifecycle: lifecycleOf(asset, health),
        source: asset.source || '',
        sourceLabel: sourceLabel(asset.source || ''),
        sourceToken: sourceToken || (createdById ? text(asset.createdByName) || `Meta user ${createdById}` : undefined),
        createdAt: text(asset.creationTime) || undefined,
        checkedAt: text(asset.checked) || undefined,
        crmPushAt: text(asset.crmPushAt) || undefined,
        crmPushStatus: text(asset.crmPushStatus) || undefined,
        lastError: lastError || undefined,
        verified: Boolean(asset.verified),
        tier: text(asset.tier) || undefined,
      };
    });

    const guideRows: ResourceRow[] = guides.map((guide) => {
      const isPushed = Boolean(guide.crmGuideId) || pushed(guide.crmPushStatus);
      return {
        key: `guide:${guide.id}`,
        id: guide.id,
        name: text(guide.title) || 'Bí kíp',
        type: 'Bí kíp',
        health: 'N/A',
        lifecycle: isPushed ? 'PUSHED' : guide.crmPushError ? 'BLOCKED' : 'READY',
        source: 'manual-upload',
        sourceLabel: 'Tải lên thủ công',
        createdAt: text(guide.created) || undefined,
        crmPushAt: text(guide.crmPushAt) || undefined,
        crmPushStatus: text(guide.crmPushStatus) || undefined,
        lastError: text(guide.crmPushError) || undefined,
      };
    });

    const resources = [...assetRows, ...guideRows].sort((a, b) => {
      const aTime = new Date(a.createdAt || a.checkedAt || 0).getTime();
      const bTime = new Date(b.createdAt || b.checkedAt || 0).getTime();
      return bTime - aTime;
    });

    return Response.json({ resources });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }
}
