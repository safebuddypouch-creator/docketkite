// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ExampleCreate, ExampleItem, ExampleList } from '@/lib/contracts/example';

// Neutralize server-only so the route handler can be unit-tested directly.
vi.mock('server-only', () => ({}));

describe('example shared contract', () => {
  it('ExampleCreate rejects an empty name and accepts a valid one', () => {
    expect(ExampleCreate.safeParse({ name: '' }).success).toBe(false);
    expect(ExampleCreate.safeParse({ name: 'Acme' }).success).toBe(true);
  });

  it('ExampleItem requires the server-generated id on top of the create fields', () => {
    expect(ExampleItem.safeParse({ name: 'Acme' }).success).toBe(false);
    expect(ExampleItem.safeParse({ id: 'x1', name: 'Acme' }).success).toBe(true);
  });

  it('ExampleList wraps an array of items and rejects id-less records', () => {
    expect(ExampleList.safeParse({ items: [] }).success).toBe(true);
    expect(ExampleList.safeParse({ items: [{ id: 'x1', name: 'Acme' }] }).success).toBe(true);
    expect(ExampleList.safeParse({ items: [{ name: 'Acme' }] }).success).toBe(false);
  });
});

describe('example route handler branches', () => {
  it('GET is disabled for public launch', async () => {
    const { GET } = await import('@/app/api/example/route');
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('POST is disabled for public launch', async () => {
    const { POST } = await import('@/app/api/example/route');
    const res = await POST();
    expect(res.status).toBe(404);
  });
});

describe('example-secure route handler branches', () => {
  it('GET/POST/PATCH are disabled for public launch', async () => {
    const { GET, POST, PATCH } = await import('@/app/api/example-secure/route');
    expect((await GET()).status).toBe(404);
    expect((await POST()).status).toBe(404);
    expect((await PATCH()).status).toBe(404);
  });
});
