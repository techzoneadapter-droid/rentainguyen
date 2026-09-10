import { owner } from '../../../lib/server';
import { pause, resume, start, tick } from '../../../lib/workflows';

type QueueAction = 'start' | 'pause' | 'resume' | 'tick';

function validAction(value: unknown): value is QueueAction {
  return value === 'start' || value === 'pause' || value === 'resume' || value === 'tick';
}

export async function POST(req: Request) {
  try {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin) {
      return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
    }

    const user = await owner();
    const input = (await req.json()) as { action?: unknown; id?: unknown };
    if (!validAction(input.action)) {
      return Response.json({ error: 'Thao tác không hợp lệ.' }, { status: 400 });
    }

    if (input.action === 'tick') {
      return Response.json({ changed: await tick(user) });
    }

    if (typeof input.id !== 'string' || !input.id || input.id.length > 200) {
      return Response.json({ error: 'ID workflow không hợp lệ.' }, { status: 400 });
    }

    if (input.action === 'start') {
      await start(user, input.id);
      return Response.json({ message: 'Đã bắt đầu workflow. Giữ ứng dụng mở để xử lý hàng đợi.' });
    }

    if (input.action === 'pause') {
      await pause(user, input.id);
      return Response.json({ message: 'Đã tạm dừng workflow.' });
    }

    await resume(user, input.id);
    return Response.json({ message: 'Đã tiếp tục workflow.' });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
