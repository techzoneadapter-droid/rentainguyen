import { demoAssets, types, type Asset } from '../../../lib/data';
import { audit, config, db, graph, graphList, list, owner, put } from '../../../lib/server';
import { requestSchema } from '../../../lib/validation';

function isAssetType(value: unknown): value is string {
  return typeof value === 'string' && types.includes(value);
}

export async function GET() {
  try {
    const user = await owner();
    const [assets, jobs, logs, services] = await Promise.all(
      ['asset', 'job', 'log', 'service'].map((kind) => list(user, kind)),
    );
    return Response.json({ assets, jobs, logs, services, connected: Boolean(config().token) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }
}

export async function POST(req: Request) {
  try {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin) {
      return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
    }

    const user = await owner();
    const body = requestSchema.parse(await req.json());
    const { action } = body;
    let message = 'Đã lưu';

    if (action === 'seed') {
      await db().batch([
        ...demoAssets.map((asset) =>
          put(user, 'asset', {
            ...asset,
            id: `${user}:${asset.id}`,
            parent: asset.parent ? `${user}:${asset.parent}` : '',
          }),
        ),
        audit(user, 'Nạp 24 tài nguyên mẫu • không kết nối Meta'),
      ]);
      message = 'Đã nạp bộ dữ liệu mẫu';
    } else if (action === 'asset') {
      const asset = body.asset as Asset;
      if (!asset || !isAssetType(asset.type) || !asset.name?.trim() || asset.name.length > 150) {
        throw new Error('Tên hoặc loại tài nguyên không hợp lệ.');
      }

      if (asset.id) {
        const existing = ((await list(user, 'asset')) as Asset[]).find((item) => item.id === asset.id);
        if (!existing) throw new Error('Không tìm thấy tài nguyên.');
        await db().batch([
          put(user, 'asset', {
            ...existing,
            name: asset.name,
            country: asset.country,
            tier: asset.tier,
            limit: existing.source === 'meta' ? existing.limit : asset.limit,
          }),
          audit(user, `Cập nhật nhãn: ${asset.name}`),
        ]);
      } else {
        await db().batch([
          put(user, 'asset', {
            ...asset,
            id: crypto.randomUUID(),
            source: 'manual',
            status: 'Chưa kiểm tra',
            verified: false,
          }),
          audit(user, `Thêm hồ sơ thủ công: ${asset.name}`),
        ]);
      }
      message = 'Đã lưu hồ sơ tài nguyên';
    } else if (action === 'delete') {
      const ids = body.ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 100) {
        throw new Error('Chọn từ 1 đến 100 hồ sơ.');
      }
      await db().batch([
        ...ids.map((id) =>
          db().prepare('DELETE FROM records WHERE owner = ? AND kind = ? AND id = ?').bind(user, 'asset', id),
        ),
        audit(user, `Xóa ${ids.length} hồ sơ khỏi ứng dụng (không xóa trên Meta)`),
      ]);
      message = 'Đã xóa hồ sơ khỏi ứng dụng';
    } else if (action === 'job') {
      const job = body.job;
      if (!job) throw new Error('Workflow không hợp lệ.');

      const count = Number(job.count);
      const interval = Number(job.interval);
      if (!Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(interval) || interval < 5 || interval > 3600) {
        throw new Error('Số lượng 1–100; khoảng nghỉ 5–3600 giây.');
      }

      const assets = (await list(user, 'asset')) as Asset[];
      const ids = Array.isArray(job.assetIds) ? job.assetIds : [];
      if (ids.some((id) => !assets.some((asset) => asset.id === id))) {
        throw new Error('Tài nguyên không thuộc workspace.');
      }

      if (job.operation === 'share') {
        if (!/^\d{5,30}$/.test(job.partner || '')) {
          throw new Error('ID đối tác phải gồm 5–30 chữ số.');
        }
        if (!ids.length || ids.some((id) => !assets.some((asset) => asset.id === id && asset.type === 'TKQC'))) {
          throw new Error('Chọn tài khoản quảng cáo để chia sẻ.');
        }
      }

      if (job.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.email)) {
        throw new Error('Email quản trị viên không hợp lệ.');
      }
      if (job.operation === 'member' && !job.email) {
        throw new Error('Nhập email thành viên.');
      }
      if (job.operation === 'create' && (!job.type || !isAssetType(job.type) || !job.name?.trim())) {
        throw new Error('Nhập tên và loại tài nguyên.');
      }

      const value = {
        ...job,
        id: crypto.randomUUID(),
        count,
        interval,
        assetIds: ids,
        name: job.name || 'Workflow tài nguyên',
        status: 'Chờ cấu hình Meta',
        created: new Date().toISOString(),
        completed: 0,
        reason: 'Đã lưu cấu hình. Chưa thực thi: cần kết nối Meta và xác nhận endpoint, quyền của app cho thao tác này.',
      };

      await db().batch([
        put(user, 'job', value),
        audit(user, `Lưu workflow: ${value.name}`, 'Đã lưu cấu hình'),
      ]);
      message = 'Đã lưu workflow; chưa thực hiện thay đổi trên Meta';
    } else if (action === 'cancel') {
      const job = ((await list(user, 'job')) as Array<Record<string, unknown>>).find(
        (item) => item.id === body.id,
      );
      if (!job) throw new Error('Không tìm thấy workflow.');
      await db().batch([
        put(user, 'job', { ...job, status: 'Đã hủy' }),
        audit(user, `Hủy workflow: ${String(job.name || body.id)}`),
      ]);
      message = 'Đã hủy workflow';
    } else if (action === 'service') {
      const service = body.service;
      if (!service?.name?.trim() || !service?.provider?.trim() || service.name.length > 150 || service.provider.length > 150) {
        throw new Error('Nhập tên dịch vụ và nhà cung cấp.');
      }
      if (service.url) {
        const url = new URL(service.url);
        if (!['http:', 'https:'].includes(url.protocol)) {
          throw new Error('Đường dẫn phải là HTTP/HTTPS.');
        }
      }
      await db().batch([
        put(user, 'service', {
          ...service,
          id: crypto.randomUUID(),
          created: new Date().toISOString(),
          status: 'Chưa thẩm định',
        }),
        audit(user, `Thêm dịch vụ: ${service.name}`),
      ]);
      message = 'Đã thêm dịch vụ';
    } else if (action === 'sync') {
      const businesses = await graphList('me/businesses', 'id,name,verification_status');
      const synced: Asset[] = [];

      for (const business of businesses) {
        const businessId = String(business.id);
        synced.push({
          id: `meta:${businessId}`,
          name: String(business.name),
          type: 'BM',
          verified: business.verification_status === 'verified',
          status: 'Truy cập được',
          country: 'Chưa rõ',
          tier: 'Chưa rõ',
          limit: 'Chưa rõ',
          parent: '',
          source: 'meta',
          checked: new Date().toISOString(),
        });

        const accounts = await graphList(
          `${businessId}/owned_ad_accounts`,
          'id,name,account_status,spend_cap,currency',
        );
        for (const account of accounts) {
          const accountStatus = Number(account.account_status);
          const spendCap = account.spend_cap;
          const currency = String(account.currency || '');
          synced.push({
            id: `meta:${String(account.id)}`,
            name: String(account.name),
            type: 'TKQC',
            status: accountStatus === 1 ? 'LIVE' : accountStatus === 2 ? 'DIE' : 'Hạn chế',
            verified: false,
            country: 'Chưa rõ',
            tier: '—',
            limit: spendCap && spendCap !== '0' ? `${String(spendCap)} ${currency} (đơn vị API)` : 'Chưa thiết lập',
            currency,
            metaStatus: accountStatus,
            parent: `meta:${businessId}`,
            source: 'meta',
            checked: new Date().toISOString(),
          });
        }

        for (const [edge, type] of [
          ['owned_pages', 'Page'],
          ['adspixels', 'Dataset/Pixel'],
        ] as const) {
          const data = await graphList(`${businessId}/${edge}`, 'id,name');
          for (const item of data) {
            synced.push({
              id: `meta:${String(item.id)}`,
              name: String(item.name),
              type,
              status: 'Truy cập được',
              verified: false,
              country: 'Chưa rõ',
              tier: '—',
              limit: '—',
              parent: `meta:${businessId}`,
              source: 'meta',
              checked: new Date().toISOString(),
            });
          }
        }
      }

      const previous = (await list(user, 'asset')) as Asset[];
      await db().batch([
        ...synced.map((asset) =>
          put(user, 'asset', {
            ...asset,
            id: `${user}:${asset.id}`,
            parent: asset.parent ? `${user}:${asset.parent}` : '',
          }),
        ),
        ...previous
          .filter(
            (asset) =>
              asset.source === 'meta' &&
              !synced.some((next) => `${user}:${next.id}` === asset.id),
          )
          .map((asset) =>
            put(user, 'asset', {
              ...asset,
              status: 'Cần kiểm tra quyền',
              checked: new Date().toISOString(),
            }),
          ),
        audit(user, `Đồng bộ ${synced.length} tài nguyên từ Meta`),
      ]);
      message = `Đã đồng bộ ${synced.length} tài nguyên`;
    } else if (action === 'health') {
      const assets = (await list(user, 'asset')) as Asset[];
      const chosen = assets.filter(
        (asset) => !body.ids?.length || body.ids.includes(asset.id),
      );
      if (!chosen.length) throw new Error('Chưa có tài nguyên để kiểm tra.');

      const results: Asset[] = [];
      for (const asset of chosen) {
        if (asset.source !== 'meta') {
          results.push({
            ...asset,
            checked: new Date().toISOString(),
            healthNote:
              asset.source === 'demo'
                ? 'Dữ liệu mẫu, không kiểm tra Meta'
                : 'Cần liên kết ID Meta trước khi kiểm tra',
          });
          continue;
        }

        try {
          const id = asset.id.split('meta:')[1];
          if (!id) throw new Error('ID Meta không hợp lệ.');
          const result = await graph(id, {
            fields: asset.type === 'TKQC' ? 'id,account_status' : 'id',
          });
          const accountStatus = Number(result.account_status);
          results.push({
            ...asset,
            checked: new Date().toISOString(),
            status:
              asset.type === 'TKQC'
                ? accountStatus === 1
                  ? 'LIVE'
                  : accountStatus === 2
                    ? 'DIE'
                    : 'Hạn chế'
                : 'Truy cập được',
            healthNote: 'Đã đọc từ Meta',
          });
        } catch (error) {
          results.push({
            ...asset,
            checked: new Date().toISOString(),
            status: 'Không xác định',
            healthNote: (error as Error).message,
          });
        }
      }

      await db().batch([
        ...results.map((asset) => put(user, 'asset', asset)),
        audit(
          user,
          `Kiểm tra ${results.length} hồ sơ; ${chosen.filter((asset) => asset.source === 'meta').length} tài nguyên Meta`,
        ),
      ]);
      message = 'Đã cập nhật kết quả kiểm tra';
    } else {
      throw new Error('Thao tác không được hỗ trợ.');
    }

    return Response.json({ message });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
