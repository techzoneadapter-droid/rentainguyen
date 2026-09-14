import { demoAssets, types, type Asset } from '../../../lib/data';
import { audit, config, db, list, owner, put } from '../../../lib/server';
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
      const assets = (await list(user, 'asset')) as Asset[];
      await db().batch([audit(user, `Đồng bộ local ${assets.length} hồ sơ • không gọi Meta Graph`)]);
      message = `Đã đọc ${assets.length} hồ sơ trong workspace. Không gọi Graph API.`;
    } else if (action === 'health') {
      const assets = (await list(user, 'asset')) as Asset[];
      const chosen = assets.filter((asset) => !body.ids?.length || body.ids.includes(asset.id));
      if (!chosen.length) throw new Error('Chưa có tài nguyên để kiểm tra.');
      const results = chosen.map((asset) => ({
        ...asset,
        checked: new Date().toISOString(),
        healthNote: 'Kiểm tra local: không gọi Graph API từ workspace token chung.',
      }));
      await db().batch([
        ...results.map((asset) => put(user, 'asset', asset)),
        audit(user, `Health local ${results.length} hồ sơ • không gọi Graph`),
      ]);
      message = 'Đã cập nhật ghi chú kiểm tra local. Không gọi Graph API.';
    } else {
      throw new Error('Thao tác không được hỗ trợ.');
    }

    return Response.json({ message });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
