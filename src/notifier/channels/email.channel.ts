import { Resend } from 'resend';
import { RunReportDraft } from '../../types/unified';
import { childLogger } from '../../logger/logger.service';

const log = childLogger({ component: 'email.channel' });

export class EmailChannel {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly to: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async sendRunReport(draft: RunReportDraft): Promise<void> {
    const subject = this.subject(draft);
    const html = this.renderHtml(draft);
    try {
      await this.client.emails.send({ from: this.from, to: this.to, subject, html });
      log.info({ runId: draft.runId, to: this.to }, 'email_sent');
    } catch (err) {
      log.error({ err: (err as Error).message, runId: draft.runId }, 'email_send_failed');
    }
  }

  async sendDailySummary(reports: RunReportDraft[]): Promise<void> {
    const totalFetched = reports.reduce((s, r) => s + r.recordsFetched, 0);
    const totalFailed = reports.reduce((s, r) => s + r.recordsFailed, 0);
    const sources = [...new Set(reports.map((r) => r.source))].join(', ');
    const subject = `[buffalo] Daily summary — ${sources} | ${totalFetched} records, ${totalFailed} failed`;
    const html = this.renderDailySummaryHtml(reports);
    try {
      await this.client.emails.send({ from: this.from, to: this.to, subject, html });
      log.info({ sources, totalFetched, totalFailed }, 'daily_summary_email_sent');
    } catch (err) {
      log.error({ err: (err as Error).message }, 'daily_summary_email_failed');
    }
  }

  private subject(draft: RunReportDraft): string {
    const state = draft.recordsFailed > 0 ? 'FAILURE' : draft.fullBackfillTriggered ? 'RECOVERY' : 'OK';
    return `[buffalo] ${state} — ${draft.source}:${draft.entity} | run ${draft.runId.slice(0, 8)}`;
  }

  private renderHtml(d: RunReportDraft): string {
    const rows = d.failedRecords
      .map(
        (f) =>
          `<tr>
            <td>${f.externalId ?? 'n/a'}</td>
            <td>${f.stage}</td>
            <td>${this.esc(f.error)}</td>
            <td><code>${this.esc(f.rawPreview.slice(0, 200))}</code></td>
          </tr>`,
      )
      .join('');

    return `
<h2>Run report — ${d.source}:${d.entity}</h2>
<table border="1" cellpadding="4">
  <tr><th>Run ID</th><td>${d.runId}</td></tr>
  <tr><th>Mode</th><td>${d.mode}</td></tr>
  <tr><th>Started</th><td>${d.startedAt.toISOString()}</td></tr>
  <tr><th>Finished</th><td>${d.finishedAt?.toISOString() ?? 'n/a'}</td></tr>
  <tr><th>Pages fetched</th><td>${d.pagesFetched}</td></tr>
  <tr><th>Records fetched</th><td>${d.recordsFetched}</td></tr>
  <tr><th>Records upserted</th><td>${d.recordsUpserted}</td></tr>
  <tr><th>Records deduped</th><td>${d.recordsDeduped}</td></tr>
  <tr><th>Records failed</th><td>${d.recordsFailed}</td></tr>
  <tr><th>Stale cursor detected</th><td>${d.staleCursorDetected}</td></tr>
  <tr><th>Full backfill triggered</th><td>${d.fullBackfillTriggered}</td></tr>
  ${d.fullBackfillReason ? `<tr><th>Backfill reason</th><td>${this.esc(d.fullBackfillReason)}</td></tr>` : ''}
</table>
${
  d.failedRecords.length > 0
    ? `<h3>Failed records</h3>
<table border="1" cellpadding="4">
  <tr><th>External ID</th><th>Stage</th><th>Error</th><th>Raw preview</th></tr>
  ${rows}
</table>`
    : '<p>No failed records.</p>'
}`;
  }

  private renderDailySummaryHtml(reports: RunReportDraft[]): string {
    const rows = reports
      .map(
        (r) =>
          `<tr>
            <td>${r.source}</td>
            <td>${r.entity}</td>
            <td>${r.mode}</td>
            <td>${r.recordsFetched}</td>
            <td>${r.recordsUpserted}</td>
            <td>${r.recordsFailed}</td>
            <td>${r.staleCursorDetected ? 'yes' : 'no'}</td>
            <td>${r.fullBackfillTriggered ? 'yes' : 'no'}</td>
          </tr>`,
      )
      .join('');

    return `
<h2>Buffalo — Daily sync summary</h2>
<p>Date: ${new Date().toISOString().split('T')[0]}</p>
<table border="1" cellpadding="4">
  <tr>
    <th>Source</th><th>Entity</th><th>Mode</th>
    <th>Fetched</th><th>Upserted</th><th>Failed</th>
    <th>Stale cursor</th><th>Full backfill</th>
  </tr>
  ${rows}
</table>`;
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
