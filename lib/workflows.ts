import { audit, config, db, list, put } from './server';
import type { Asset } from './data';
import type { JobInput } from './validation';

export type Step = {
  path: string;
  method: 'POST' | 'DELETE';
  params: Record<string, string>;
  label: string;
  assetType?: string;
  assetName?: string;
  parent?: string;
  resultId?: string;
  status?: string;
  error?: string;
};

export type Job = JobInput & {
  id: string;
  created: string;
  status: string;
  reason: string;
  completed: number;
  steps?: Step[];
  cursor?: number;
  nextAt?: number;
  startedAt?: number;
};

const waitingStatuses = new Set([
  'Chờ cấu hình Meta',
  'Đã lưu cấu hình',
  'Chá» cáº¥u hÃ¬nh Meta',
  'ÄÃ£ lÆ°u cáº¥u hÃ¬nh',
]);

export function metaId(asset: Asset | undefined) {
  if (!asset || asset.source !== 'meta') {
    throw new Error('Chỉ thực thi với tài nguyên thật đã đồng bộ từ Meta.');
  }
  const id = asset.id.split('meta:')[1];
  if (!/^(act_)?\d+$/.test(id || '')) throw new Error('ID Meta không hợp lệ.');
  return id;
}

export function plan(job: JobInput, assets: Asset[]): Step[] {
  const steps: Step[] = [];
  const parent = assets.find((asset) => asset.id === job.parent);
  const name = job.prefix || job.name;

  if (job.operation === 'create') {
    if (job.type === 'BM' && !job.businessEmail) {
      throw new Error('Cần email doanh nghiệp để tạo BM.');
    }
    if (job.type === 'Page' && !job.category) {
      throw new Error('Cần ID danh mục Meta để tạo Page.');
    }
    if (job.type === 'TKQC' && parent?.type !== 'BM') {
      throw new Error('Chọn BM sở hữu TKQC.');
    }
    if (job.type === 'Dataset/Pixel' && parent?.type !== 'TKQC') {
      throw new Error('Chọn TKQC sở hữu Pixel.');
    }

    for (let i = 0; i < job.count; i++) {
      const resourceName = `${name} ${String(i + 1).padStart(3, '0')}`;
      const params: Record<string, string> = { name: resourceName };
      let path = '';

      if (job.type === 'BM') {
        path = 'me/businesses';
        Object.assign(params, {
          email: job.businessEmail!,
          timezone_id: String(job.timezone),
          vertical: 'ADVERTISING',
        });
      } else if (job.type === 'TKQC') {
        const id = metaId(parent);
        path = `${id}/adaccount`;
        Object.assign(params, {
          currency: job.currency,
          timezone_id: String(job.timezone),
          end_advertiser: id,
          media_agency: 'NONE',
          partner: 'NONE',
        });
      } else if (job.type === 'Page') {
        path = 'me/accounts';
        Object.assign(params, {
          category: job.category!,
          about: job.about || resourceName,
        });
      } else if (job.type === 'Dataset/Pixel') {
        path = `${metaId(parent)}/adspixels`;
      } else {
        throw new Error('Loại tài nguyên không hợp lệ.');
      }

      steps.push({
        path,
        method: 'POST',
        params,
        label: `Tạo ${resourceName}`,
        assetType: job.type,
        assetName: resourceName,
        parent: job.parent,
      });

      if (job.type === 'BM' && job.email) {
        steps.push({
          path: `$result:${steps.length - 1}/business_users`,
          method: 'POST',
          params: {
            email: job.email,
            role: job.role === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE',
          },
          label: `Mời ${job.email} vào ${resourceName}`,
        });
      }
    }
  } else if (job.operation === 'share') {
    if (!job.partner || !['ANALYZE', 'ADVERTISE', 'MANAGE'].includes(job.role)) {
      throw new Error('ID đối tác hoặc quyền chia sẻ không hợp lệ.');
    }
    if (!job.assetIds.length) throw new Error('Chọn tài khoản quảng cáo.');

    for (const id of job.assetIds) {
      const asset = assets.find((item) => item.id === id);
      if (asset?.type !== 'TKQC' || asset.parent !== job.parent) {
        throw new Error('TKQC không thuộc BM được chọn.');
      }
      steps.push({
        path: `${metaId(asset)}/agencies`,
        method: 'POST',
        params: {
          business: job.partner,
          permitted_tasks: JSON.stringify([job.role]),
        },
        label: `Chia sẻ ${asset.name} cho ${job.partner}`,
      });
    }
  } else if (job.operation === 'member') {
    if (parent?.type !== 'BM' || !job.email) {
      throw new Error('Chọn BM và email thành viên.');
    }
    steps.push({
      path: `${metaId(parent)}/business_users`,
      method: 'POST',
      params: {
        email: job.email,
        role: job.role === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE',
      },
      label: `Mời ${job.email}`,
    });
  } else {
    throw new Error('Thao tác này cần thực hiện trong Meta Business Settings. Cấu hình đã được lưu để đối chiếu.');
  }

  return steps;
}

async function findJob(user: string, id: string) {
  const jobs = (await list(user, 'job')) as Job[];
  const job = jobs.find((item) => item.id === id);
  if (!job) throw new Error('Không tìm thấy workflow.');
  return job;
}

async function compareAndSwap(user: string, previous: Job, next: Job) {
  const update = await db()
    .prepare('UPDATE records SET payload = ? WHERE owner = ? AND id = ? AND payload = ?')
    .bind(JSON.stringify(next), user, previous.id, JSON.stringify(previous))
    .run();

  if (!update.meta.changes) {
    throw new Error('Workflow vừa thay đổi. Tải lại để tiếp tục.');
  }
}

export async function start(user: string, id: string) {
  if (!config().token) throw new Error('Chưa kết nối Meta.');
  const job = await findJob(user, id);
  if (!waitingStatuses.has(job.status)) {
    throw new Error('Workflow đã bắt đầu, đã hủy hoặc không còn ở trạng thái chờ.');
  }

  const steps = plan(job, (await list(user, 'asset')) as Asset[]);
  if (!steps.length) throw new Error('Workflow không có bước thực thi.');

  const value: Job = {
    ...job,
    steps,
    cursor: 0,
    completed: 0,
    status: 'Đang chạy',
    reason: 'Hàng đợi xử lý khi ứng dụng đang mở. Mỗi thao tác được ghi nhận riêng.',
    nextAt: Date.now(),
  };

  await compareAndSwap(user, job, value);
  await audit(user, `Bắt đầu ${job.name}`).run();
}

export async function pause(user: string, id: string) {
  const job = await findJob(user, id);
  if (job.status !== 'Đang chạy') {
    throw new Error('Chỉ có thể tạm dừng workflow giữa các bước xử lý.');
  }

  const value: Job = {
    ...job,
    status: 'Tạm dừng',
    reason: 'Đã tạm dừng. Không có bước mới được gửi sang Meta cho đến khi tiếp tục.',
  };

  await compareAndSwap(user, job, value);
  await audit(user, `Tạm dừng ${job.name}`, 'Tạm dừng').run();
}

export async function resume(user: string, id: string) {
  if (!config().token) throw new Error('Chưa kết nối Meta.');
  const job = await findJob(user, id);
  if (job.status !== 'Tạm dừng') {
    throw new Error('Workflow không ở trạng thái tạm dừng.');
  }

  const value: Job = {
    ...job,
    status: 'Đang chạy',
    reason: 'Đã tiếp tục workflow. Bước kế tiếp sẽ chạy khi hàng đợi được kiểm tra.',
    nextAt: Date.now(),
  };

  await compareAndSwap(user, job, value);
  await audit(user, `Tiếp tục ${job.name}`).run();
}

export async function tick(user: string) {
  const jobs = (await list(user, 'job')) as Job[];
  const job = jobs.find(
    (item) => item.status === 'Đang chạy' && (item.nextAt || 0) <= Date.now(),
  );
  if (!job) return false;

  const index = job.cursor || 0;
  const step = job.steps?.[index];
  if (!step) throw new Error('Không tìm thấy bước thực thi.');

  const busy: Job = {
    ...job,
    status: 'Đang thực thi',
    startedAt: Date.now(),
    reason: 'Đang chờ kết quả Meta. Nếu mất kết nối, cần đối chiếu trước khi chạy lại.',
  };

  const claimed = await db()
    .prepare('UPDATE records SET payload = ? WHERE owner = ? AND id = ? AND payload = ?')
    .bind(JSON.stringify(busy), user, job.id, JSON.stringify(job))
    .run();
  if (!claimed.meta.changes) return false;

  try {
    let path = step.path;
    if (path.startsWith('$result:')) {
      const match = /^\$result:(\d+)(\/.*)$/.exec(path);
      if (!match) throw new Error('Đường dẫn phụ thuộc kết quả trước không hợp lệ.');
      const result = job.steps![Number(match[1])].resultId;
      if (!result) throw new Error('Không có ID của bước tạo trước.');
      path = result + match[2];
    }

    const connection = config();
    if (!connection.token) throw new Error('Kết nối Meta bị thiếu.');

    const response = await fetch(`https://graph.facebook.com/${connection.version}/${path}`, {
      method: step.method,
      headers: {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(step.params),
      signal: AbortSignal.timeout(25000),
    });

    const data = (await response.json()) as {
      id?: string;
      success?: boolean;
      error?: { message: string; code: number };
    };

    if (!response.ok || data.error) {
      throw new Error(
        `Meta ${data.error?.code || response.status}: ${data.error?.message || 'Không thể thực hiện thao tác'}`,
      );
    }
    if (step.assetType && !data.id) {
      throw new Error('Meta không trả ID tài nguyên. Cần đối chiếu kết quả, không tự thử lại.');
    }

    const steps = job.steps!.map((item, i) =>
      i === index ? { ...item, status: 'Hoàn tất', resultId: data.id } : item,
    );
    const done = index + 1 === steps.length;
    const completed = steps.filter((item) => item.status === 'Hoàn tất').length;

    const updated: Job = {
      ...job,
      steps,
      cursor: index + 1,
      completed,
      status: done ? 'Hoàn tất' : 'Đang chạy',
      nextAt: Date.now() + job.interval * 1000,
      reason: done
        ? 'Đã hoàn tất các bước. Đồng bộ Meta để cập nhật đầy đủ trạng thái.'
        : `Đã xong ${index + 1}/${steps.length} thao tác. Đang chờ khoảng nghỉ.`,
    };

    const writes = [put(user, 'job', updated), audit(user, step.label)];
    if (step.assetType && data.id) {
      writes.push(
        put(user, 'asset', {
          id: `${user}:meta:${data.id}`,
          name: step.assetName || data.id,
          type: step.assetType,
          source: 'meta',
          status: 'Chưa kiểm tra',
          verified: false,
          country: 'Chưa rõ',
          tier: 'Chưa rõ',
          limit: 'Chưa rõ',
          parent: step.parent || '',
        }),
      );
    }
    await db().batch(writes);
  } catch (error) {
    const message = (error as Error).message;
    await db().batch([
      put(user, 'job', {
        ...job,
        status: 'Cần đối chiếu',
        reason: message,
        steps: job.steps!.map((item, i) =>
          i === index ? { ...item, status: 'Cần đối chiếu', error: message } : item,
        ),
      }),
      audit(user, `${step.label} • ${message}`, 'Cần đối chiếu'),
    ]);
  }

  return true;
}
