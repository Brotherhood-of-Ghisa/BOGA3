/** @jest-environment node */
import { handleNotificationRequest, notificationServiceKeys, type Rpc } from '../../../supabase/functions/notification-worker/handler';

const secretKeys = JSON.stringify({ default: 'sb_secret_worker', other: 'sb_secret_other' });

test.each(['sb_secret_worker', 'runtime-service-key'])('the worker accepts a configured service credential: %s', async apikey => {
  const rpc = jest.fn<ReturnType<Rpc>, Parameters<Rpc>>().mockResolvedValue({ jobs: [], disabled: false }) as jest.MockedFunction<Rpc>;
  const response = await handleNotificationRequest(new Request('https://local/worker', {
    method: 'POST', headers: { apikey },
  }), { serviceKeys: notificationServiceKeys('runtime-service-key', secretKeys), rpc });
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('notification_prune');
});

test.each(['', 'normal-user-jwt', 'sb_publishable_public', 'sb_secret_other', 'old-management-service-key'])(
  'an unconfigured credential cannot reach privileged RPCs: %s', async apikey => {
    const rpc = jest.fn() as jest.MockedFunction<Rpc>;
    const response = await handleNotificationRequest(new Request('https://local/worker', {
      method: 'POST', headers: { apikey },
    }), { serviceKeys: notificationServiceKeys('runtime-service-key', secretKeys), rpc });
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  },
);

test('the default secret authenticates database access ahead of the deployment-specific legacy credential', () => {
  expect(notificationServiceKeys('runtime-service-key', secretKeys)).toEqual(['sb_secret_worker', 'runtime-service-key']);
  expect(notificationServiceKeys('local-service-key')).toEqual(['local-service-key']);
  expect(notificationServiceKeys('', secretKeys)).toEqual(['sb_secret_worker']);
});

test.each(['sb_secret_worker', 'wrong-key'])('the read-only release probe checks authentication without draining: %s', async apikey => {
  const rpc = jest.fn() as jest.MockedFunction<Rpc>;
  const response = await handleNotificationRequest(new Request('https://local/worker', { headers: { apikey } }), {
    serviceKeys: notificationServiceKeys('runtime-service-key', secretKeys), rpc,
  });
  expect(response.status).toBe(apikey === 'sb_secret_worker' ? 200 : 401);
  expect(rpc).not.toHaveBeenCalled();
});

test.each(['{', 'null', '[]', '"text"', '{"default":null}', '{"default":123}', '{"default":""}'])(
  'missing or malformed credentials fail closed: %s', async json => {
    const rpc = jest.fn() as jest.MockedFunction<Rpc>;
    const response = await handleNotificationRequest(new Request('https://local/worker', { method: 'POST' }), {
      serviceKeys: notificationServiceKeys('', json), rpc,
    });
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  },
);
