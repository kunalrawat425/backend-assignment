import { AppConfig } from '../config/config.service';
import { childLogger } from '../logger/logger.service';
import { RunReportDraft } from '../types/unified';
import { EmailChannel } from './channels/email.channel';

const log = childLogger({ component: 'notifier' });

type NotifyEvent = 'failure' | 'recovery' | 'daily' | 'success';

export class NotifierService {
  private readonly email: EmailChannel | null;
  private readonly notifyOn: NotifyEvent[];

  constructor(cfg: AppConfig) {
    this.notifyOn = cfg.NOTIFY_ON as NotifyEvent[];
    if (cfg.RESEND_API_KEY) {
      this.email = new EmailChannel(cfg.RESEND_API_KEY, cfg.NOTIFY_TO, cfg.NOTIFY_FROM);
    } else {
      this.email = null;
      log.warn({}, 'resend_api_key_missing_notifications_disabled');
    }
  }

  async notifyRunReport(draft: RunReportDraft): Promise<void> {
    if (!this.email) return;
    const event = this.classifyRun(draft);
    if (!this.notifyOn.includes(event)) return;
    await this.email.sendRunReport(draft);
  }

  async notifyDailySummary(reports: RunReportDraft[]): Promise<void> {
    if (!this.email || !this.notifyOn.includes('daily')) return;
    await this.email.sendDailySummary(reports);
  }

  private classifyRun(draft: RunReportDraft): NotifyEvent {
    if (draft.recordsFailed > 0) return 'failure';
    if (draft.fullBackfillTriggered) return 'recovery';
    return 'success';
  }
}
