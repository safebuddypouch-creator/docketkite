// @polsia:user-owned — exercises the permit route with controlled Tampa proxy snapshots.
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { PermitPortalCheckMutation } from '@/lib/contracts/permit-portal-check';

const prisma = new PrismaClient();
const fixtureTeamIds: string[] = [];
const fixtureUserIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];

const sampledRecords = [
  {
    permitNumber: 'BLD-27-0529173',
    portalUrl:
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA&IsToShowInspection=',
    status: 'Awaiting Client Reply',
  },
  {
    permitNumber: 'BLD-27-0529154',
    portalUrl:
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UHO&agencyCode=TAMPA&IsToShowInspection=',
    status: 'Awaiting Client Reply',
  },
  {
    permitNumber: 'BLD-27-0529153',
    portalUrl:
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UH8&agencyCode=TAMPA&IsToShowInspection=',
    status: 'Awaiting Client Reply',
  },
] as const;

async function createSignedInUser(browser: Browser, origin: string) {
  const email = `qa-tampa-sample-${randomUUID()}@example.test`;
  const password = `Qa-${randomUUID()}-9a`;
  const storageStatePath = `/tmp/polsia-tampa-sample-${randomUUID()}.json`;
  execFileSync(
    'node',
    [
      '.agents/auth-session.cjs',
      '--as',
      'user',
      '--base-url',
      origin,
      '--email',
      email,
      '--password',
      password,
      '--out',
      storageStatePath,
    ],
    { cwd: process.cwd(), stdio: 'pipe' },
  );
  const context = await browser.newContext({ storageState: storageStatePath });
  fixtureContexts.push(context);
  const session = await context.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  expect(session.status()).toBe(200);
  const sessionBody = (await session.json()) as { user?: { id?: string } };
  const userId = sessionBody.user?.id;
  if (!userId) throw new Error('The test account session did not include a user id.');
  fixtureUserIds.push(userId);
  return { context, userId };
}

test.afterEach(async () => {
  await Promise.all(fixtureContexts.map((context) => context.close()));
  fixtureContexts.length = 0;
  if (fixtureTeamIds.length > 0) {
    await prisma.permit.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamCheckout.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamMembership.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamSpace.deleteMany({ where: { id: { in: fixtureTeamIds } } });
    fixtureTeamIds.length = 0;
  }
  if (fixtureUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
    fixtureUserIds.length = 0;
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('controlled portal snapshots exercise on-demand checks for public Tampa record shapes', async ({
  browser,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? process.env.BASE_URL ?? 'http://localhost:3000').origin;
  const { context, userId } = await createSignedInUser(browser, origin);
  const team = await prisma.teamSpace.create({
    data: {
      name: `QA Tampa sample team ${randomUUID()}`,
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId, role: 'owner' } });
  await prisma.teamCheckout.create({
    data: {
      teamId: team.id,
      userId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });

  for (const record of sampledRecords) {
    const permit = await prisma.permit.create({
      data: {
        userId,
        teamId: team.id,
        projectName: `Public record ${record.permitNumber}`,
        address: 'Tampa public portal sample',
        permitNumber: record.permitNumber,
        permitType: 'Building',
        status: 'Planning',
        notes: '',
        portalUrl: record.portalUrl,
      },
    });
    const response = await context.request.post(
      `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}`,
      { headers: { origin }, data: { teamId: team.id } },
    );
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(201);
    const outcome = PermitPortalCheckMutation.parse(body);
    expect(outcome.check).toMatchObject({
      permitNumber: record.permitNumber,
      sourceUrl: record.portalUrl,
      result: 'checked',
      status: record.status,
      message: null,
    });
    expect(
      await prisma.permitPortalStatusCheck.findUnique({ where: { id: outcome.check.id } }),
    ).toMatchObject({
      permitNumber: record.permitNumber,
      sourceUrl: record.portalUrl,
      result: 'checked',
      status: record.status,
      message: null,
    });
  }
});
