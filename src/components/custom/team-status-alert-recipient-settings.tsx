// @polsia:user-owned — owner-facing controls for verified team status alert emails.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { apiFetch } from '@/lib/api-client';
import {
  type TeamStatusAlertRecipientMember,
  TeamStatusAlertRecipientsResponse,
} from '@/lib/contracts/team-status-alert-recipients';

function errorCode(error: unknown): string | null {
  if (!(error instanceof Error) || typeof error.cause !== 'object' || error.cause === null) {
    return null;
  }
  return 'error' in error.cause && typeof error.cause.error === 'string' ? error.cause.error : null;
}

function accessErrorMessage(error: unknown): string {
  const code = errorCode(error);
  if (code === 'team_subscription_required') {
    return 'These settings require a verified $299/month checkout and an active team subscription.';
  }
  if (code === 'billing_status_unavailable') {
    return 'Team billing could not be confirmed. Recipient settings remain locked until billing is available.';
  }
  return 'Recipient settings could not be loaded. Try again.';
}

function memberLabel(member: TeamStatusAlertRecipientMember): string {
  return `${member.name} (${member.role})`;
}

export function TeamStatusAlertRecipientSettings({ teamId }: { teamId: string }) {
  const [members, setMembers] = useState<TeamStatusAlertRecipientMember[]>([]);
  const [recipientUserIds, setRecipientUserIds] = useState<string[]>([]);
  const [usesDefault, setUsesDefault] = useState(true);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const applyResponse = useCallback((response: TeamStatusAlertRecipientsResponse) => {
    setMembers(response.members);
    setRecipientUserIds(response.recipientUserIds);
    setUsesDefault(response.usesAssignedProjectManagerDefault);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(
        `/api/team-status-alert-recipients?teamId=${encodeURIComponent(teamId)}`,
        { schema: TeamStatusAlertRecipientsResponse },
      );
      applyResponse(response);
    } catch (loadError) {
      setError(accessErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [applyResponse, teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSelection() {
    if (recipientUserIds.length === 0) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/team-status-alert-recipients', {
        method: 'PUT',
        body: JSON.stringify({ action: 'save', teamId, recipientUserIds }),
        schema: TeamStatusAlertRecipientsResponse,
      });
      applyResponse(response);
      setNotice('Custom recipients saved for this team.');
    } catch (saveError) {
      setError(accessErrorMessage(saveError));
    } finally {
      setWorking(false);
    }
  }

  async function resetToAssignedDefault() {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/team-status-alert-recipients', {
        method: 'PUT',
        body: JSON.stringify({ action: 'use_assigned_project_manager', teamId }),
        schema: TeamStatusAlertRecipientsResponse,
      });
      applyResponse(response);
      setNotice('Alerts will go to each permit’s assigned project manager when eligible.');
    } catch (saveError) {
      setError(accessErrorMessage(saveError));
    } finally {
      setWorking(false);
    }
  }

  function toggleRecipient(userId: string, checked: boolean | 'indeterminate') {
    setNotice('');
    setRecipientUserIds((current) =>
      checked === true
        ? current.includes(userId)
          ? current
          : [...current, userId]
        : current.filter((id) => id !== userId),
    );
  }

  return (
    <Card aria-labelledby="status-alert-recipient-title">
      <CardHeader>
        <h3
          id="status-alert-recipient-title"
          className="text-base font-semibold leading-none tracking-tight"
        >
          Status alert recipients
        </h3>
        <CardDescription>
          Choose current team members for verified Florida Accela Record Status changes. Until you
          save a custom selection, an alert goes only to that permit’s assigned project manager.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {loading ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Loading team members…
          </p>
        ) : error ? (
          <div className="grid gap-3">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button type="button" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            {usesDefault ? (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Current setting: assigned project manager on each permit.
              </p>
            ) : (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Current setting: custom team recipients.
              </p>
            )}
            <fieldset className="grid gap-3" disabled={working}>
              <legend className="text-sm font-medium">Choose one or more current members</legend>
              {members.map((member) => (
                <div
                  key={member.userId}
                  className="flex min-w-0 items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/40"
                >
                  <Checkbox
                    id={`status-recipient-${member.userId}`}
                    aria-label={memberLabel(member)}
                    checked={recipientUserIds.includes(member.userId)}
                    onCheckedChange={(checked) => toggleRecipient(member.userId, checked)}
                  />
                  <label
                    htmlFor={`status-recipient-${member.userId}`}
                    className="grid min-w-0 cursor-pointer gap-1"
                  >
                    <span className="break-words text-sm font-medium">{memberLabel(member)}</span>
                    <span className="break-all text-xs text-muted-foreground">{member.email}</span>
                  </label>
                </div>
              ))}
              {members.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No current team members are available.
                </p>
              ) : null}
            </fieldset>
            {notice ? (
              <output className="text-sm text-foreground" aria-live="polite">
                {notice}
              </output>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={working || recipientUserIds.length === 0 || members.length === 0}
                onClick={() => void saveSelection()}
              >
                {working ? 'Saving…' : 'Save recipients'}
              </Button>
              {!usesDefault ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={working}
                  onClick={() => void resetToAssignedDefault()}
                >
                  Use assigned project manager default
                </Button>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
