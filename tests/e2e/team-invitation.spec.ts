// @polsia:user-owned — verifies the emailed project-manager invitation journey.
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

const prisma = new PrismaClient();
const capturedEmailsPath = '/tmp/polsia-team-invitation-emails.ndjson';
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];

type SessionResponse = { user?: { id?: string; email?: string; emailVerified?: boolean } };
type TeamResponse = { id?: string; name?: string; role?: string };
type InvitationEmail = { to: string; subject: string; html: string };

function isInvitationEmail(value: unknown): value is InvitationEmail {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.to === 'string' &&
    typeof record.subject === 'string' &&
    typeof record.html === 'string'
  );
}

async function capturedEmail(
  recipient: string,
  subjectMatches: (subject: string) => boolean,
): Promise<InvitationEmail | null> {
  const captured = await readFile(capturedEmailsPath, 'utf8');
  for (const line of captured.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (
        isInvitationEmail(value) &&
        value.to.toLowerCase() === recipient.toLowerCase() &&
        subjectMatches(value.subject)
      ) {
        return value;
      }
    } catch {
      // Ignore incomplete or unrelated records from other mocked email requests.
    }
  }
  return null;
}

function emailLink(html: string, pathname: string): string | null {
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
    match[1]?.replaceAll('&amp;', '&'),
  );
  return (
    hrefs.find((href) => {
      if (!href) return false;
      try {
        const url = new URL(href);
        return url.pathname === pathname;
      } catch {
        return false;
      }
    }) ?? null
  );
}

async function createSignedInAccount(page: Page, origin: string, email: string, name: string) {
  const password = `Qa-${randomUUID()}-9a`;
  const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: { name, email, password },
  });
  expect(signup.status(), await signup.text()).toBe(200);

  const sessionResponse = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  const session = (await sessionResponse.json()) as SessionResponse;
  const userId = session.user?.id;
  expect(userId).toBeTruthy();
  if (!userId) throw new Error('Sign-up did not create a signed-in user.');

  fixtureUserIds.push(userId);
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  const signIn = await page.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin },
    data: { email, password, callbackURL: '/' },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);
  return { userId, email, password };
}

test.afterEach(async () => {
  await Promise.all(fixtureContexts.map((context) => context.close()));
  fixtureContexts.length = 0;

  if (fixtureTeamIds.length > 0) {
    await prisma.teamInvitation.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamMembership.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamCheckout.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
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

test('an emailed project-manager invitation survives signup, explicit acceptance, and reaches its team', async (
  { page, browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? process.env.BASE_URL ?? 'http://localhost:3000').origin;
  const ownerEmail = `qa-owner-${randomUUID()}@example.test`;
  const managerEmail = `qa-manager-${randomUUID()}@example.test`;
  const owner = await createSignedInAccount(page, origin, ownerEmail, 'QA Team Owner');

  const createdTeam = await page.request.post(`${origin}/api/teams`, {
    headers: { origin },
    data: { action: 'create', name: 'QA Invitation Team' },
  });
  expect(createdTeam.status()).toBe(201);
  const team = (await createdTeam.json()) as TeamResponse;
  expect(team.id).toBeTruthy();
  if (!team.id) throw new Error('Team creation did not return an id.');
  fixtureTeamIds.push(team.id);

  const sentInvitation = await page.request.post(`${origin}/api/team-invitations`, {
    headers: { origin },
    data: { teamId: team.id, email: managerEmail },
  });
  expect(sentInvitation.status(), await sentInvitation.text()).toBe(201);

  const deliveredEmail = await capturedEmail(managerEmail, (subject) =>
    subject.startsWith('Project manager invitation for '),
  );
  expect(deliveredEmail).not.toBeNull();
  if (!deliveredEmail) throw new Error('The mocked email proxy did not capture the invitation.');
  const inviteUrl = emailLink(deliveredEmail.html, '/team-invite');
  expect(inviteUrl).not.toBeNull();
  if (!inviteUrl) throw new Error('The invitation email did not include the team-invite link.');

  const invite = new URL(inviteUrl);
  const token = invite.searchParams.get('token');
  expect(invite.origin).toBe(origin);
  expect(invite.pathname).toBe('/team-invite');
  expect(token).toMatch(/^[A-Za-z0-9_-]{20,128}$/);
  if (!token) throw new Error('The invitation email link is missing its token.');

  const managerContext = await browser.newContext();
  fixtureContexts.push(managerContext);
  const invitePage = await managerContext.newPage();
  const inviteResponse = await invitePage.goto(inviteUrl);
  expect(inviteResponse?.status()).toBe(200);
  await expect(invitePage).toHaveURL(inviteUrl);
  await expect(invitePage.getByRole('link', { name: 'Create an account' })).toBeVisible();
  await invitePage.getByRole('link', { name: 'Create an account' }).click();
  await expect(invitePage).toHaveURL(`${origin}/signup?invite=${token}`);
  await invitePage.getByLabel('Name').fill('QA Project Manager');
  await invitePage.getByLabel('Email address').fill(managerEmail);
  await invitePage.getByLabel('Password').fill('Qa-Invitation-Password-9a');
  await invitePage.getByRole('button', { name: 'Create account' }).click();
  await expect(invitePage).toHaveURL(inviteUrl);
  await expect(invitePage.getByText('Verify this email to continue')).toBeVisible();

  const managerSessionResponse = await invitePage.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  const managerSession = (await managerSessionResponse.json()) as SessionResponse;
  const managerId = managerSession.user?.id;
  expect(managerSession.user?.email).toBe(managerEmail);
  expect(managerSession.user?.emailVerified).toBe(false);
  expect(managerId).toBeTruthy();
  if (!managerId) throw new Error('The invited account did not remain signed in.');
  fixtureUserIds.push(managerId);

  const unverifiedAccept = await invitePage.request.post(`${origin}/api/team-invitations/accept`, {
    headers: { origin },
    data: { token },
  });
  expect(unverifiedAccept.status()).toBe(403);
  expect((await unverifiedAccept.json()).error).toBe('email_verification_required');

  const verificationEmail = await capturedEmail(
    managerEmail,
    (subject) => subject === 'Verify your email',
  );
  expect(verificationEmail).not.toBeNull();
  if (!verificationEmail) throw new Error('The mocked email proxy did not capture verification.');
  const verificationUrl = emailLink(verificationEmail.html, '/api/auth/verify-email');
  expect(verificationUrl).not.toBeNull();
  if (!verificationUrl) throw new Error('The verification email did not include its link.');
  expect(new URL(verificationUrl).origin).toBe(origin);

  const verificationResponse = await invitePage.goto(verificationUrl);
  expect(verificationResponse?.status()).toBe(200);
  await expect(invitePage).toHaveURL(inviteUrl);
  const verifiedSessionResponse = await invitePage.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  const verifiedSession = (await verifiedSessionResponse.json()) as SessionResponse;
  expect(verifiedSession.user?.id).toBe(managerId);
  expect(verifiedSession.user?.emailVerified).toBe(true);

  const mismatchContext = await browser.newContext();
  fixtureContexts.push(mismatchContext);
  const mismatchPage = await mismatchContext.newPage();
  const mismatchEmail = `qa-mismatch-${randomUUID()}@example.test`;
  const mismatchUser = await createSignedInAccount(
    mismatchPage,
    origin,
    mismatchEmail,
    'QA Different User',
  );
  const mismatchAccept = await mismatchPage.request.post(
    `${origin}/api/team-invitations/accept`,
    { headers: { origin }, data: { token } },
  );
  expect(mismatchAccept.status()).toBe(403);
  expect((await mismatchAccept.json()).error).toBe('invitation_email_mismatch');
  expect(
    await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: team.id, userId: mismatchUser.userId } },
    }),
  ).toBeNull();

  await invitePage.reload();
  await expect(invitePage.getByRole('button', { name: 'Accept invitation' })).toBeVisible();

  const invalidToken = randomUUID().replaceAll('-', '') + 'invalid';
  const invalidAccept = await invitePage.request.post(`${origin}/api/team-invitations/accept`, {
    headers: { origin },
    data: { token: invalidToken },
  });
  expect(invalidAccept.status()).toBe(404);
  expect((await invalidAccept.json()).error).toBe('invitation_not_found');

  const wrongRoleToken = randomUUID().replaceAll('-', '');
  await prisma.teamInvitation.create({
    data: {
      teamId: team.id,
      invitedByUserId: owner.userId,
      invitedEmail: managerEmail,
      tokenHash: createHash('sha256').update(wrongRoleToken).digest('hex'),
      role: 'owner',
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const wrongRoleAccept = await invitePage.request.post(
    `${origin}/api/team-invitations/accept`,
    { headers: { origin }, data: { token: wrongRoleToken } },
  );
  expect(wrongRoleAccept.status()).toBe(404);
  expect((await wrongRoleAccept.json()).error).toBe('invitation_not_found');
  expect(
    await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: team.id, userId: managerId } },
    }),
  ).toBeNull();

  const expiredToken = `expired-${randomUUID().replaceAll('-', '')}`;
  await prisma.teamInvitation.create({
    data: {
      teamId: team.id,
      invitedByUserId: owner.userId,
      invitedEmail: managerEmail,
      tokenHash: createHash('sha256').update(expiredToken).digest('hex'),
      role: 'project_manager',
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  const expiredAccept = await invitePage.request.post(`${origin}/api/team-invitations/accept`, {
    headers: { origin },
    data: { token: expiredToken },
  });
  expect(expiredAccept.status()).toBe(410);
  expect((await expiredAccept.json()).error).toBe('invitation_expired');

  await invitePage.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(
    invitePage.getByText(`You joined ${team.name ?? 'QA Invitation Team'}`),
  ).toBeVisible();
  await invitePage.getByRole('link', { name: 'Open team workspace' }).click();
  await expect(invitePage).toHaveURL(`${origin}/dashboard?teamId=${team.id}`);
  await expect(invitePage.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
  await expect(
    invitePage.getByText('QA Invitation Team is waiting for owner billing', { exact: true }),
  ).toBeVisible();
  await expect(invitePage.getByText(/Your project-manager membership is set/)).toBeVisible();
  const acceptedMembership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId: team.id, userId: managerId } },
  });
  expect(acceptedMembership?.role).toBe('project_manager');

  const usedAgain = await invitePage.request.post(`${origin}/api/team-invitations/accept`, {
    headers: { origin },
    data: { token },
  });
  expect(usedAgain.status()).toBe(409);
  expect((await usedAgain.json()).error).toBe('invitation_already_used');
  expect(
    await prisma.teamMembership.count({ where: { teamId: team.id, userId: managerId } }),
  ).toBe(1);

  await invitePage.screenshot({
    path: testInfo.outputPath('accepted-project-manager-workspace.png'),
    fullPage: true,
  });
});

test('an existing invited manager can sign in and return to the same invitation', async (
  { page, browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? process.env.BASE_URL ?? 'http://localhost:3000').origin;
  const ownerEmail = `qa-signin-owner-${randomUUID()}@example.test`;
  const managerEmail = `qa-signin-manager-${randomUUID()}@example.test`;
  await createSignedInAccount(page, origin, ownerEmail, 'QA Sign-in Owner');

  const createdTeam = await page.request.post(`${origin}/api/teams`, {
    headers: { origin },
    data: { action: 'create', name: 'QA Sign-in Invitation Team' },
  });
  expect(createdTeam.status()).toBe(201);
  const team = (await createdTeam.json()) as TeamResponse;
  expect(team.id).toBeTruthy();
  if (!team.id) throw new Error('Team creation did not return an id.');
  fixtureTeamIds.push(team.id);

  const managerContext = await browser.newContext();
  fixtureContexts.push(managerContext);
  const managerPage = await managerContext.newPage();
  const manager = await createSignedInAccount(
    managerPage,
    origin,
    managerEmail,
    'Existing QA Project Manager',
  );
  await managerContext.clearCookies();

  const sentInvitation = await page.request.post(`${origin}/api/team-invitations`, {
    headers: { origin },
    data: { teamId: team.id, email: managerEmail },
  });
  expect(sentInvitation.status(), await sentInvitation.text()).toBe(201);

  const deliveredEmail = await capturedEmail(managerEmail, (subject) =>
    subject.startsWith('Project manager invitation for '),
  );
  expect(deliveredEmail).not.toBeNull();
  if (!deliveredEmail) throw new Error('The mocked email proxy did not capture the invitation.');
  const inviteUrl = emailLink(deliveredEmail.html, '/team-invite');
  expect(inviteUrl).not.toBeNull();
  if (!inviteUrl) throw new Error('The invitation email did not include the team-invite link.');

  const invite = new URL(inviteUrl);
  const token = invite.searchParams.get('token');
  expect(invite.origin).toBe(origin);
  expect(invite.pathname).toBe('/team-invite');
  expect(token).toMatch(/^[A-Za-z0-9_-]{20,128}$/);
  if (!token) throw new Error('The invitation email link is missing its token.');

  const inviteResponse = await managerPage.goto(inviteUrl);
  expect(inviteResponse?.status()).toBe(200);
  await expect(managerPage).toHaveURL(inviteUrl);
  await managerPage.getByRole('main').getByRole('link', { name: 'Sign in' }).click();
  await expect(managerPage).toHaveURL(`${origin}/login?invite=${token}`);
  await managerPage.getByLabel('Email address').fill(managerEmail);
  await managerPage.getByLabel('Password').fill(manager.password);
  await managerPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(managerPage).toHaveURL(inviteUrl);
  await expect(managerPage.getByRole('button', { name: 'Accept invitation' })).toBeVisible();

  await managerPage.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(
    managerPage.getByText(`You joined ${team.name ?? 'QA Sign-in Invitation Team'}`),
  ).toBeVisible();
  await managerPage.getByRole('link', { name: 'Open team workspace' }).click();
  await expect(managerPage).toHaveURL(`${origin}/dashboard?teamId=${team.id}`);
  await expect(managerPage.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
  await expect(
    managerPage.getByText('QA Sign-in Invitation Team is waiting for owner billing', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(managerPage.getByText(/Your project-manager membership is set/)).toBeVisible();

  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId: team.id, userId: manager.userId } },
  });
  expect(membership?.role).toBe('project_manager');
  await managerPage.screenshot({
    path: testInfo.outputPath('signed-in-project-manager-workspace.png'),
    fullPage: true,
  });
});
